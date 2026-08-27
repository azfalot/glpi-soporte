"use strict";

/**
 * Extrae datos clave (DNI/NIE, matrícula, CODSOL, procedimiento, fecha)
 * del texto del ticket (título + timeline) y lanza la query en jTraspaso.
 */

const { queryJTraspaso } = require("./db");

// ── Patrones ───────────────────────────────────────────────────────────────
const RE_DNI  = /\b(\d{8}[A-Z])\b/gi;
const RE_NIE  = /\b([XYZ]\d{7}[A-Z])\b/gi;
// Matrícula española (clásica y actual)
const RE_MAT  = /\b([A-Z]{0,2}\d{4}[A-Z]{0,3}|[A-Z]\d{4}[A-Z]{2}|\d{4}[A-Z]{3})\b/g;

// CODSOL: varias formas de aparición:
//   1. Explícito: "CODSOL: XYZ123"
//   2. En título entre llaves: "[BUZON] [1197] {BtzRD5JqSAlYjCgVg1c4} ERROR..."
const RE_CODSOL_EXPLICIT = /(?:CODSOL|C[ÓO]D(?:IGO)?[_\s.-]?SOL(?:ICITUD)?)\s*[:=]\s*([A-Za-z0-9_-]{6,40})/i;
const RE_CODSOL_BRACES   = /\{([A-Za-z0-9]{10,40})\}/;  // {BtzRD5JqSAlYjCgVg1c4}

// Proc: solo si es explícito con delimitador, o entre corchetes en el título
// RE_PROC_BRACKET busca [1197] en el título (número de 3-6 dígitos entre [])
const RE_PROC_EXPLICIT = /(?:procedimiento|proc)\s*[:=#]\s*([A-Z0-9_.\-]{3,50})/i;
const RE_PROC_BRACKET  = /\[(\d{3,6})\]/;  // [1197]
const RE_FECHA  = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/;

/** Extrae todos los matches únicos de un regex en un texto */
function extractAll(text, re) {
  const seen = new Set();
  const out = [];
  let m;
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  while ((m = r.exec(text)) !== null) {
    const v = (m[1] || m[0]).toUpperCase();
    if (!seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}

/** Normaliza la fecha extraída a ISO */
function normalizeDate(match) {
  if (!match) return null;
  const [, d, mo, y] = match;
  const year = y.length === 2 ? "20" + y : y;
  return `${year}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/**
 * Construye texto plano a partir del objeto ticket de GLPI.
 */
function ticketToText(ticket) {
  const parts = [ticket.title || ""];
  for (const entry of ticket.timeline || []) {
    parts.push(entry.content || "");
  }
  return parts.join("\n");
}

/**
 * Extrae las entidades del texto del ticket.
 * @param {object} ticket  Resultado de readTicket()
 * @returns {object} campos extraídos
 */
function extractEntities(ticket) {
  const text = ticketToText(ticket);
  const title = ticket.title || "";

  const dnis       = extractAll(text, RE_DNI);
  const nies       = extractAll(text, RE_NIE);
  const matriculas = extractAll(text, RE_MAT).filter(isMaybeMatricula);

  // CODSOL: primero explícito, luego entre llaves en el título
  const codsolExplicit = RE_CODSOL_EXPLICIT.exec(text);
  const codsolBraces   = RE_CODSOL_BRACES.exec(title) || RE_CODSOL_BRACES.exec(text);
  const codsolRaw = codsolExplicit ? codsolExplicit[1].trim()
                  : codsolBraces   ? codsolBraces[1].trim()
                  : null;
  // Preservar case original (Oracle usa UPPER() en la query)
  const codsol = codsolRaw || null;

  // Procedimiento: solo explícito con delimitador estricto, o entre corchetes en el título
  const procExplicit = RE_PROC_EXPLICIT.exec(text);
  const procBracket  = RE_PROC_BRACKET.exec(title);
  const procedimiento = procExplicit ? procExplicit[1].trim().toUpperCase()
                      : procBracket  ? procBracket[1].trim()
                      : null;

  const fechaM = RE_FECHA.exec(text);

  return {
    dnis,
    nies,
    matriculas,
    codsol,
    procedimiento,
    fecha: normalizeDate(fechaM ? [, fechaM[1], fechaM[2], fechaM[3]] : null)
  };
}

/** Filtra ruido en matrículas (muy cortas o solo dígitos) */
function isMaybeMatricula(s) {
  if (s.length < 5 || s.length > 10) return false;
  if (/^\d+$/.test(s)) return false;   // solo números: probablemente fecha
  return true;
}

/**
 * Extrae entidades del ticket y hace la consulta LIVE en jTraspaso.
 * @param {object} ticket  Resultado de readTicket()
 * @returns {{ entities, tramites, dbError }}
 */
async function diagnose(ticket) {
  const entities = extractEntities(ticket);

  let tramites = [];
  let dbError = null;

  const criteria = {};
  if (entities.codsol)  criteria.codsol   = entities.codsol;
  if (entities.dnis[0]) criteria.dni       = entities.dnis[0];
  else if (entities.nies[0]) criteria.dni  = entities.nies[0];
  if (entities.matriculas[0]) criteria.matricula = entities.matriculas[0];

  if (Object.keys(criteria).length > 0) {
    try {
      tramites = await queryJTraspaso(criteria);
    } catch (e) {
      dbError = e.message;
    }
  }

  return { entities, tramites, dbError };
}

module.exports = { extractEntities, diagnose, ticketToText };
