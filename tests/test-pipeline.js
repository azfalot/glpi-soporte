"use strict";

const assert = require("assert");
const extract = require("../src/extract");
const kb = require("../src/kb");
const classify = require("../src/classify");
const enrich = require("../src/glpiEnrich");
const jtras = require("../src/jtraspasoLive");

console.log("▶ Iniciando suite de pruebas...");

// ── Test 1: Extracción de entidades ──────────────────────────────────────────
{
  const ticket = {
    ticketId: "1565896",
    title: "[BUZON] [1197] {BtzRD5JqSAlYjCgVg1c4} ERROR EN FIRMA",
    timeline: [
      {
        content: "El ciudadano con DNI 12345678Z y matrícula 1234BBB indica que no puede firmar en Autofirma.",
        attachments: []
      }
    ]
  };

  const entities = extract.extractEntities(ticket);
  assert.strictEqual(entities.codsol, "BtzRD5JqSAlYjCgVg1c4", "Debe extraer CODSOL de las llaves del título");
  assert.strictEqual(entities.procedimiento, "1197", "Debe extraer procedimiento del corchete");
  assert.strictEqual(entities.dnis[0], "12345678Z", "Debe extraer DNI");
  assert.strictEqual(entities.matriculas[0], "1234BBB", "Debe extraer matrícula");
  console.log("  ✔ Test 1: Extracción de entidades OK");
}

// ── Test 2: Clasificación KB ────────────────────────────────────────────────
{
  const ticket = {
    ticketId: "1565896",
    title: "No puede firmar con Autofirma en la sede electrónica",
    timeline: [
      {
        content: "Error: firma no valida en ningun procedimiento para todos los usuarios",
        attachments: []
      }
    ]
  };

  const diagBase = {
    entities: { codsol: "BtzRD5JqSAlYjCgVg1c4", procedimiento: "1197", dnis: ["12345678Z"], nies: [], matriculas: [] }
  };

  const classification = classify.classify(ticket, diagBase);
  assert.strictEqual(classification.kbMatch.category.id, "AUTOFIRMA_GLOBAL", "Debe clasificar como AUTOFIRMA_GLOBAL");
  console.log("  ✔ Test 2: Clasificación KB OK");
}

// ── Test 3: Generación de variables y borradores con datos reales de jTraspaso
{
  const ticket = {
    ticketId: "1559652",
    title: "No pudo firmar en Autofirma tras realizar el pago del modelo 620",
    timeline: [{ content: "Presentación pendiente: el pago está realizado pero dio error al firmar en presentador.", attachments: [] }]
  };

  const diagBase = {
    ticketId: "1559652",
    entities: { codsol: "ABC123XYZ", procedimiento: "620", dnis: ["48000000A"], nies: [], matriculas: ["5678CCC"] },
    ppfdatos: {
      IDDATOS: "7894561",
      IDESTADO: "5",
      CODFORM: "M620",
      CODSOLICITUD: "ABC123XYZ"
    },
    pago: {
      IDPAGO: "334455",
      CODESTADO: "PA",
      IMPORTE: "45.50",
      N28: "1234567890123456789012345678",
      IDDESCOESTADO: "Pagado"
    },
    clobParsed: {
      guid: "ES_A14036665_2026_DOCH_999888777",
      solicitud: { proc: "620", codsol: "ABC123XYZ" }
    }
  };

  const drafts = classify.buildDrafts(ticket, diagBase);
  assert.ok(drafts.task.includes("7894561"), "La tarea debe incluir IDDATOS real");
  assert.ok(drafts.task.includes("45.50"), "La tarea debe incluir importe real");
  assert.ok(drafts.task.includes("1234567890123456789012345678"), "La tarea debe incluir N28 real");
  assert.ok(drafts.task.includes("ES_A14036665_2026_DOCH_999888777"), "La tarea debe incluir GUID real");
  assert.ok(!drafts.task.includes("NNNNNNNNNNNNNNNNNNNNNNNNNNNN"), "No debe haber placeholder de N28");

  assert.ok(drafts.followup.includes("https://sede.carm.es/presentador"), "El seguimiento debe contener URL de presentador");
  assert.ok(drafts.followup.includes("ES_A14036665_2026_DOCH_999888777"), "El seguimiento debe contener GUID real");
  console.log("  ✔ Test 3: Generación de borradores con datos reales OK");
}

// ── Test 4: Propuesta de enriquecimiento GLPI ─────────────────────────────────
{
  const ticket = {
    ticketId: "1565896",
    title: "[BUZON] Ticket - Incidencia en pago y firma"
  };

  const diagBase = {
    ticketId: "1565896",
    entities: { codsol: "BtzRD5JqSAlYjCgVg1c4", procedimiento: "1197", dnis: [], nies: [], matriculas: [] },
    kbMatches: [{ category: { ambito: "PAETRIBUTOS" } }],
    clobParsed: { codForm: "F1197.V2" }
  };

  const proposal = enrich.proposeEnrichment(ticket, diagBase);
  assert.strictEqual(proposal.ticketId, "1565896", "Ticket ID debe ser 1565896");
  assert.strictEqual(proposal.titleProposal, "[1197] {BtzRD5JqSAlYjCgVg1c4} Incidencia en pago y firma", "Título enriquecido correcto");
  assert.strictEqual(proposal.titleChanged, true, "titleChanged debe ser true");
  assert.strictEqual(proposal.elementos.length, 2, "Debe proponer Aplicacion y Procedimientocarm");
  assert.strictEqual(proposal.elementos[0].nombre, "PAETRIBUTOS", "Aplicación debe ser PAETRIBUTOS");
  assert.strictEqual(proposal.elementos[1].nombre, "1197", "Procedimiento debe ser 1197");
  console.log("  ✔ Test 4: Propuesta de enriquecimiento GLPI OK");
}

// ── Test 5: Generación de SQL de diagnóstico y CLOB ──────────────────────────
{
  const diagSQL = jtras.buildDiagSQL("CODSOL123", "99999");
  assert.ok(diagSQL.includes("CODSOL123"), "Diag SQL debe incluir CODSOL");
  assert.ok(diagSQL.includes("PPFDATOS"), "Diag SQL debe consultar PPFDATOS");
  assert.ok(diagSQL.includes("PASAPAGO.PAGO"), "Diag SQL debe consultar PAGO");
  assert.ok(diagSQL.includes("PPFEVENTO"), "Diag SQL debe consultar PPFEVENTO");

  const clobSQL = jtras.buildClobSQL("CODSOL123", "99999");
  assert.ok(clobSQL.includes("99999"), "Clob SQL debe incluir IDDATOS");
  assert.ok(clobSQL.includes("DBMS_LOB.substr"), "Clob SQL debe incluir DBMS_LOB");
  console.log("  ✔ Test 5: Generación de SQLs de diagnóstico y CLOB OK");
}

console.log("\n✅ ¡Todas las pruebas han pasado exitosamente!");
