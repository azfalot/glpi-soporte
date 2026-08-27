"use strict";

/**
 * schemaExplorer.js
 *
 * Explora y cachea el esquema relacional de cada entorno de jTraspaso.
 * Los esquemas se persisten en schema-cache/<entorno>.json para no repetir
 * el discovery en cada sesión.
 *
 * Entornos conocidos y sus esquemas principales:
 *   OVCONTRI    → PPFDATOS, PPFEVENTO, PASAPAGO.PAGO, ...
 *   PASARELA    → PAGO, PETICION, ENTIDAD, ...
 *   ARECA/DOMI  → DOMIDOM, TRILOCA, PEPAORI, ...
 *
 * Queries de discovery (SQL*Plus sobre Oracle):
 *   - USER_TABLES          → tablas del esquema actual
 *   - ALL_TABLES           → tablas accesibles (otros esquemas)
 *   - USER_TAB_COLUMNS     → columnas + tipo + nullable
 *   - ALL_CONSTRAINTS      → PKs, FKs (relaciones)
 *   - USER_INDEXES         → índices (rendimiento)
 */

const fs   = require("fs");
const path = require("path");

const CACHE_DIR = path.join(process.cwd(), "schema-cache");

// Asegurar directorio de caché
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// ── Caché en memoria (evita leer disco en cada llamada) ───────────────────
const _memCache = {};

function cacheFile(entorno) {
  return path.join(CACHE_DIR, `${sanitize(entorno)}.json`);
}

function sanitize(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").toUpperCase();
}

/** Lee caché de disco para un entorno */
function loadCache(entorno) {
  if (_memCache[entorno]) return _memCache[entorno];
  const f = cacheFile(entorno);
  if (fs.existsSync(f)) {
    try {
      _memCache[entorno] = JSON.parse(fs.readFileSync(f, "utf8"));
      return _memCache[entorno];
    } catch (_) {}
  }
  return null;
}

/** Guarda caché en disco */
function saveCache(entorno, data) {
  _memCache[entorno] = data;
  fs.writeFileSync(cacheFile(entorno), JSON.stringify(data, null, 2), "utf8");
}

/** Lista entornos con caché disponible */
function listCachedEntornos() {
  if (!fs.existsSync(CACHE_DIR)) return [];
  return fs.readdirSync(CACHE_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => ({
      entorno: f.replace(".json", ""),
      file:    path.join(CACHE_DIR, f),
      mtime:   fs.statSync(path.join(CACHE_DIR, f)).mtime.toISOString()
    }));
}

// ── SQL de discovery ──────────────────────────────────────────────────────

/**
 * SQL para descubrir todas las tablas accesibles en el entorno actual.
 * Incluye esquema propietario, nº de columnas y comentario si existe.
 */
const SQL_TABLES = `-- =========================
-- CONFIG SQL*Plus
-- =========================
SET PAGESIZE 50000
SET LINESIZE 32767
SET TRIMSPOOL ON
SET TAB OFF
SET FEEDBACK ON
SET VERIFY OFF
SET HEADING ON
SET COLSEP ' | '

PROMPT ==== SCHEMA_TABLES ====
SELECT t.OWNER, t.TABLE_NAME, t.NUM_ROWS,
       NTC.COMMENTS AS TABLE_COMMENT
FROM ALL_TABLES t
LEFT JOIN ALL_TAB_COMMENTS NTC
  ON NTC.OWNER = t.OWNER AND NTC.TABLE_NAME = t.TABLE_NAME
WHERE t.OWNER NOT IN (
  'SYS','SYSTEM','OUTLN','DBSNMP','WMSYS','EXFSYS','CTXSYS',
  'ORDSYS','ORDDATA','MDSYS','OLAPSYS','SYSMAN','XDB','APEX_030200',
  'APEX_PUBLIC_USER','FLOWS_FILES','HR','OE','SH','PM','IX','BI'
)
ORDER BY t.OWNER, t.TABLE_NAME;`;

/**
 * SQL para descubrir columnas de las tablas clave del entorno.
 * Se ejecuta tras conocer qué tablas existen.
 */
function buildColumnsSQL(tables) {
  // Limitar a máx 80 tablas para no saturar
  const subset = tables.slice(0, 80);
  const inClause = subset
    .map(t => `('${t.OWNER}','${t.TABLE_NAME}')`)
    .join(",\n  ");

  return `-- =========================
-- CONFIG SQL*Plus
-- =========================
SET PAGESIZE 50000
SET LINESIZE 32767
SET TRIMSPOOL ON
SET TAB OFF
SET FEEDBACK ON
SET VERIFY OFF
SET HEADING ON
SET COLSEP ' | '

PROMPT ==== SCHEMA_COLUMNS ====
SELECT c.OWNER, c.TABLE_NAME, c.COLUMN_NAME,
       c.DATA_TYPE, c.DATA_LENGTH, c.NULLABLE, c.COLUMN_ID,
       cc.COMMENTS AS COL_COMMENT
FROM ALL_TAB_COLUMNS c
LEFT JOIN ALL_COL_COMMENTS cc
  ON cc.OWNER = c.OWNER AND cc.TABLE_NAME = c.TABLE_NAME AND cc.COLUMN_NAME = c.COLUMN_NAME
WHERE (c.OWNER, c.TABLE_NAME) IN (
  ${inClause}
)
ORDER BY c.OWNER, c.TABLE_NAME, c.COLUMN_ID;`;
}

/**
 * SQL para descubrir PKs y FKs (relaciones entre tablas).
 */
const SQL_CONSTRAINTS = `-- =========================
-- CONFIG SQL*Plus
-- =========================
SET PAGESIZE 50000
SET LINESIZE 32767
SET TRIMSPOOL ON
SET TAB OFF
SET FEEDBACK ON
SET VERIFY OFF
SET HEADING ON
SET COLSEP ' | '

PROMPT ==== SCHEMA_CONSTRAINTS ====
SELECT c.OWNER, c.TABLE_NAME, c.CONSTRAINT_NAME, c.CONSTRAINT_TYPE,
       cc.COLUMN_NAME,
       c.R_OWNER, c.R_CONSTRAINT_NAME,
       rc.TABLE_NAME AS R_TABLE_NAME
FROM ALL_CONSTRAINTS c
JOIN ALL_CONS_COLUMNS cc
  ON cc.OWNER = c.OWNER AND cc.CONSTRAINT_NAME = c.CONSTRAINT_NAME
LEFT JOIN ALL_CONSTRAINTS rc
  ON rc.OWNER = c.R_OWNER AND rc.CONSTRAINT_NAME = c.R_CONSTRAINT_NAME
WHERE c.CONSTRAINT_TYPE IN ('P','R')
AND c.OWNER NOT IN (
  'SYS','SYSTEM','OUTLN','DBSNMP','WMSYS','EXFSYS','CTXSYS',
  'ORDSYS','ORDDATA','MDSYS','OLAPSYS','SYSMAN','XDB'
)
ORDER BY c.OWNER, c.TABLE_NAME, c.CONSTRAINT_TYPE, cc.POSITION;`;

// ── Discovery y parseo ────────────────────────────────────────────────────

/**
 * Parsea la salida de jTraspaso (texto pipe-separated) en array de objetos.
 * Formato: HEADER1 | HEADER2 | ...
 *          val1    | val2    | ...
 */
function parsePipeTable(rawText, sectionName) {
  const rows = [];

  // Extraer sección del output
  const secRe = new RegExp(`====\\s*${sectionName}\\s*====([\\s\\S]*?)(?====|$)`, "i");
  const secMatch = rawText.match(secRe);
  const section = secMatch ? secMatch[1] : rawText;

  const lines = section.split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("--") && !l.startsWith("SET ") && !l.startsWith("PROMPT"));

  if (lines.length < 2) return rows;

  // Primera línea no vacía = cabecera
  const headerLine = lines.find(l => l.includes("|"));
  if (!headerLine) return rows;

  const headers = headerLine.split("|").map(h => h.trim()).filter(Boolean);
  const headerIdx = lines.indexOf(headerLine);

  // Líneas de separador (-----)
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(/^[-\s|]+$/)) continue; // separador
    if (!line.includes("|")) continue;

    const vals = line.split("|").map(v => v.trim());
    const obj  = {};
    headers.forEach((h, idx) => { obj[h] = vals[idx] !== undefined ? vals[idx] : ""; });
    rows.push(obj);
  }
  return rows;
}

/**
 * Agrupa columnas por tabla y construye modelo relacional.
 */
function buildRelationalModel(tables, columns, constraints) {
  const model = {};

  for (const t of tables) {
    const key = `${t.OWNER}.${t.TABLE_NAME}`;
    model[key] = {
      owner:    t.OWNER,
      table:    t.TABLE_NAME,
      numRows:  t.NUM_ROWS || "?",
      comment:  t.TABLE_COMMENT || "",
      columns:  [],
      pks:      [],
      fks:      []
    };
  }

  for (const c of columns) {
    const key = `${c.OWNER}.${c.TABLE_NAME}`;
    if (model[key]) {
      model[key].columns.push({
        name:     c.COLUMN_NAME,
        type:     c.DATA_TYPE,
        length:   c.DATA_LENGTH,
        nullable: c.NULLABLE === "Y",
        comment:  c.COL_COMMENT || ""
      });
    }
  }

  for (const con of constraints) {
    const key = `${con.OWNER}.${con.TABLE_NAME}`;
    if (!model[key]) continue;
    if (con.CONSTRAINT_TYPE === "P") {
      model[key].pks.push(con.COLUMN_NAME);
    } else if (con.CONSTRAINT_TYPE === "R") {
      model[key].fks.push({
        column:   con.COLUMN_NAME,
        refOwner: con.R_OWNER,
        refTable: con.R_TABLE_NAME,
        refConstraint: con.R_CONSTRAINT_NAME
      });
    }
  }

  return model;
}

// ── API pública ───────────────────────────────────────────────────────────

/**
 * Ejecuta el discovery completo de un entorno y guarda el caché.
 * @param {Function} runQuery  Función de jtraspasoLive.runQuery
 * @param {string}   entorno   Nombre del entorno (ej: "OVCONTRI PRODUCCION")
 * @param {object}   opts
 * @param {boolean}  opts.force  Si true, ignora caché existente
 */
async function discoverSchema(runQuery, entorno, opts = {}) {
  if (!opts.force) {
    const cached = loadCache(entorno);
    if (cached) return { cached: true, entorno, ...cached };
  }

  const result = {
    entorno,
    discoveredAt: new Date().toISOString(),
    tables:      [],
    model:       {},
    constraints: [],
    errors:      []
  };

  // Paso 1: Tablas
  try {
    const r1 = await runQuery(SQL_TABLES, entorno);
    result.tables = parsePipeTable(r1.rawOutput, "SCHEMA_TABLES");

    // Fallback: usar filas de tabla HTML si el parser de texto falla
    if (!result.tables.length && r1.rows && r1.rows.length) {
      result.tables = r1.rows.map(r => ({
        OWNER:         r.OWNER || r.owner || "",
        TABLE_NAME:    r.TABLE_NAME || r.table_name || "",
        NUM_ROWS:      r.NUM_ROWS || "",
        TABLE_COMMENT: r.TABLE_COMMENT || r.COMMENTS || ""
      }));
    }
  } catch (e) {
    result.errors.push("tables: " + e.message);
  }

  if (!result.tables.length) {
    result.errors.push("No se encontraron tablas — verifica acceso al entorno");
    saveCache(entorno, result);
    return { cached: false, entorno, ...result };
  }

  // Paso 2: Columnas (en lotes de 80 tablas)
  const allColumns = [];
  const batches = [];
  for (let i = 0; i < result.tables.length; i += 80) {
    batches.push(result.tables.slice(i, i + 80));
  }
  for (const batch of batches) {
    try {
      const sql2 = buildColumnsSQL(batch);
      const r2   = await runQuery(sql2, entorno);
      const cols = parsePipeTable(r2.rawOutput, "SCHEMA_COLUMNS");
      if (!cols.length && r2.rows && r2.rows.length) {
        r2.rows.forEach(r => allColumns.push({
          OWNER: r.OWNER||"", TABLE_NAME: r.TABLE_NAME||"",
          COLUMN_NAME: r.COLUMN_NAME||"", DATA_TYPE: r.DATA_TYPE||"",
          DATA_LENGTH: r.DATA_LENGTH||"", NULLABLE: r.NULLABLE||"",
          COLUMN_ID: r.COLUMN_ID||"", COL_COMMENT: r.COMMENTS||""
        }));
      } else {
        allColumns.push(...cols);
      }
    } catch (e) {
      result.errors.push("columns batch: " + e.message);
    }
  }

  // Paso 3: Constraints (PKs y FKs)
  try {
    const r3 = await runQuery(SQL_CONSTRAINTS, entorno);
    result.constraints = parsePipeTable(r3.rawOutput, "SCHEMA_CONSTRAINTS");
    if (!result.constraints.length && r3.rows && r3.rows.length) {
      result.constraints = r3.rows;
    }
  } catch (e) {
    result.errors.push("constraints: " + e.message);
  }

  // Construir modelo relacional
  result.model = buildRelationalModel(result.tables, allColumns, result.constraints);
  result.summary = {
    totalTables:  result.tables.length,
    totalColumns: allColumns.length,
    totalFKs:     result.constraints.filter(c => c.CONSTRAINT_TYPE === "R").length,
    owners:       [...new Set(result.tables.map(t => t.OWNER))].sort()
  };

  saveCache(entorno, result);
  return { cached: false, entorno, ...result };
}

/**
 * Devuelve el esquema cacheado de un entorno (o null si no existe).
 */
function getSchema(entorno) {
  return loadCache(entorno);
}

/**
 * Busca tablas/columnas en el esquema cacheado que coincidan con una búsqueda.
 */
function searchSchema(entorno, term) {
  const cache = loadCache(entorno);
  if (!cache || !cache.model) return { matches: [] };

  const q = term.toUpperCase();
  const matches = [];

  for (const [key, tbl] of Object.entries(cache.model)) {
    const tableMatch = tbl.table.includes(q) || tbl.owner.includes(q) || (tbl.comment || "").toUpperCase().includes(q);
    const colMatches = tbl.columns.filter(c =>
      c.name.includes(q) || (c.comment || "").toUpperCase().includes(q)
    );
    if (tableMatch || colMatches.length) {
      matches.push({
        key,
        owner:      tbl.owner,
        table:      tbl.table,
        comment:    tbl.comment,
        pks:        tbl.pks,
        columns:    tableMatch ? tbl.columns : colMatches,
        fks:        tbl.fks
      });
    }
  }

  return { term, entorno, matches: matches.slice(0, 30) };
}

/**
 * Devuelve un DESCRIBE compacto de una tabla específica.
 */
function describeTable(entorno, owner, tableName) {
  const cache = loadCache(entorno);
  if (!cache || !cache.model) return null;
  const key = `${owner.toUpperCase()}.${tableName.toUpperCase()}`;
  return cache.model[key] || null;
}

/**
 * SQL para describir una tabla concreta en tiempo real (sin caché).
 */
function buildDescribeSQL(owner, tableName) {
  return `SET PAGESIZE 50000
SET LINESIZE 32767
SET COLSEP ' | '
SET HEADING ON
SET FEEDBACK ON
SET VERIFY OFF

PROMPT ==== DESCRIBE_TABLE ====
SELECT c.COLUMN_NAME, c.DATA_TYPE, c.DATA_LENGTH, c.NULLABLE,
       c.DATA_DEFAULT, cc.COMMENTS
FROM ALL_TAB_COLUMNS c
LEFT JOIN ALL_COL_COMMENTS cc
  ON cc.OWNER = c.OWNER AND cc.TABLE_NAME = c.TABLE_NAME AND cc.COLUMN_NAME = c.COLUMN_NAME
WHERE c.OWNER = UPPER('${owner}') AND c.TABLE_NAME = UPPER('${tableName}')
ORDER BY c.COLUMN_ID;

PROMPT ==== DESCRIBE_PK_FK ====
SELECT con.CONSTRAINT_NAME, con.CONSTRAINT_TYPE, col.COLUMN_NAME,
       con.R_OWNER, rcon.TABLE_NAME AS R_TABLE
FROM ALL_CONSTRAINTS con
JOIN ALL_CONS_COLUMNS col
  ON col.OWNER = con.OWNER AND col.CONSTRAINT_NAME = con.CONSTRAINT_NAME
LEFT JOIN ALL_CONSTRAINTS rcon
  ON rcon.OWNER = con.R_OWNER AND rcon.CONSTRAINT_NAME = con.R_CONSTRAINT_NAME
WHERE con.OWNER = UPPER('${owner}') AND con.TABLE_NAME = UPPER('${tableName}')
  AND con.CONSTRAINT_TYPE IN ('P','R')
ORDER BY con.CONSTRAINT_TYPE, col.POSITION;`;
}

module.exports = {
  discoverSchema,
  getSchema,
  searchSchema,
  describeTable,
  buildDescribeSQL,
  buildColumnsSQL,
  listCachedEntornos,
  parsePipeTable,
  loadCache,
  saveCache
};
