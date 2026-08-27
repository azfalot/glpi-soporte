"use strict";

/**
 * Capa de acceso a jTraspaso LIVE (SQL Server).
 * Configura las variables de entorno:
 *   JTRAS_SERVER, JTRAS_DATABASE, JTRAS_USER, JTRAS_PASSWORD, JTRAS_PORT (opt)
 * O bien JTRAS_DSN para una cadena de conexión completa.
 *
 * La query estándar busca por CODSOL, DNI o matrícula y reconstruye el CLOB JSON.
 */

let sql;
try {
  sql = require("mssql");
} catch {
  sql = null;
}

/** @type {import('mssql').ConnectionPool|null} */
let pool = null;

function getConfig() {
  if (process.env.JTRAS_DSN) return process.env.JTRAS_DSN;
  return {
    server: process.env.JTRAS_SERVER || "localhost",
    database: process.env.JTRAS_DATABASE || "jTraspaso",
    user: process.env.JTRAS_USER || "",
    password: process.env.JTRAS_PASSWORD || "",
    port: Number(process.env.JTRAS_PORT || 1433),
    options: {
      encrypt: process.env.JTRAS_ENCRYPT !== "false",
      trustServerCertificate: process.env.JTRAS_TRUST_CERT === "true",
      enableArithAbort: true
    },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 }
  };
}

async function getPool() {
  if (!sql) throw new Error("El módulo 'mssql' no está instalado. Ejecuta: npm install mssql");
  if (!pool || !pool.connected) {
    pool = await sql.connect(getConfig());
  }
  return pool;
}

/**
 * Consulta estándar de jTraspaso.
 * Acepta uno o varios criterios: codsol, dni, matricula.
 * Devuelve filas con el CLOB JSON reconstruido como objeto.
 */
async function queryJTraspaso({ codsol, dni, matricula } = {}) {
  if (!codsol && !dni && !matricula) {
    throw new Error("Se requiere al menos uno de: codsol, dni, matricula");
  }
  const p = await getPool();
  const req = p.request();

  const conditions = [];
  if (codsol) {
    req.input("codsol", sql.NVarChar, String(codsol).trim().toUpperCase());
    conditions.push("UPPER(LTRIM(RTRIM(t.CODSOL))) = @codsol");
  }
  if (dni) {
    req.input("dni", sql.NVarChar, String(dni).trim().toUpperCase());
    conditions.push("UPPER(LTRIM(RTRIM(t.DNI_NIE))) = @dni");
  }
  if (matricula) {
    req.input("matricula", sql.NVarChar, String(matricula).trim().toUpperCase());
    conditions.push("UPPER(LTRIM(RTRIM(t.MATRICULA))) = @matricula");
  }

  const where = conditions.join(" OR ");

  // Query estándar — adaptar nombres de tabla/columnas a tu esquema real.
  // El CLOB se reconstruye concatenando fragmentos si está troceado,
  // o se devuelve directamente si es nvarchar(max).
  const queryText = `
    SELECT TOP 50
      t.ID_TRAMITE,
      t.CODSOL,
      t.DNI_NIE,
      t.MATRICULA,
      t.PROCEDIMIENTO,
      t.FECHA_REGISTRO,
      t.ESTADO,
      t.USUARIO_TRAMITE,
      -- Reconstrucción del CLOB JSON (columna puede llamarse DATOS_JSON, JSON_CLOB, etc.)
      COALESCE(
        CAST(t.DATOS_JSON AS NVARCHAR(MAX)),
        CAST(t.JSON_CLOB  AS NVARCHAR(MAX)),
        CAST(t.CLOB_DATOS AS NVARCHAR(MAX)),
        NULL
      ) AS JSON_RAW
    FROM dbo.TRAMITES t
    WHERE ${where}
    ORDER BY t.FECHA_REGISTRO DESC
  `;

  const result = await req.query(queryText);

  return result.recordset.map((row) => {
    let jsonParsed = null;
    if (row.JSON_RAW) {
      try { jsonParsed = JSON.parse(row.JSON_RAW); } catch { jsonParsed = { raw: row.JSON_RAW }; }
    }
    return {
      idTramite: row.ID_TRAMITE,
      codsol: row.CODSOL,
      dniNie: row.DNI_NIE,
      matricula: row.MATRICULA,
      procedimiento: row.PROCEDIMIENTO,
      fechaRegistro: row.FECHA_REGISTRO,
      estado: row.ESTADO,
      usuario: row.USUARIO_TRAMITE,
      jsonData: jsonParsed
    };
  });
}

/** Cierra el pool (para shutdown limpio) */
async function closePool() {
  if (pool) { await pool.close(); pool = null; }
}

/** Estado de la conexión para la UI */
async function testConnection() {
  try {
    const p = await getPool();
    const r = await p.request().query("SELECT 1 AS ok");
    return { connected: true, server: process.env.JTRAS_SERVER || "localhost" };
  } catch (e) {
    return { connected: false, error: e.message };
  }
}

module.exports = { queryJTraspaso, testConnection, closePool };
