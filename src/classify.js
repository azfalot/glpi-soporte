"use strict";

/**
 * Clasificacion de incidencias y generacion de borradores.
 * Usa el KB real del equipo (src/kb.js) como fuente primaria de categorias
 * y templates SQL.
 */

const { kbSearch, fillTemplate, buildVars, KB_CATEGORIES } = require("./kb");

function textFrom(ticket) {
  const parts = [ticket.title || ""];
  for (const e of ticket.timeline || []) parts.push(e.content || "");
  return parts.join(" ").toLowerCase();
}

function diagText(diagData = {}) {
  const pieces = [];
  if (diagData.jtraspasoResult) pieces.push(JSON.stringify(diagData.jtraspasoResult));
  if (diagData.ppfdatos) pieces.push(JSON.stringify(diagData.ppfdatos));
  if (diagData.pago) pieces.push(JSON.stringify(diagData.pago));
  if (diagData.clobParsed) pieces.push(JSON.stringify(diagData.clobParsed));
  if (Array.isArray(diagData.eventos)) pieces.push(JSON.stringify(diagData.eventos));
  if (diagData.rawOutput) pieces.push(String(diagData.rawOutput));
  return pieces.join(" ").toLowerCase();
}

function hasModel(text, model) {
  return new RegExp(`\\b${model}\\b`).test(text);
}

function scoreDiagnostics(cat, text, diagData = {}) {
  const dText = diagText(diagData);
  const ppf = diagData.ppfdatos || (diagData.jtraspasoResult && diagData.jtraspasoResult.ppfdatos) || null;
  const pago = diagData.pago || (diagData.jtraspasoResult && diagData.jtraspasoResult.pago) || null;
  const clob = diagData.clobParsed || (diagData.jtraspasoResult && diagData.jtraspasoResult.clobParsed) || null;
  const proc = String(
    (diagData.entities && diagData.entities.procedimiento)
    || (ppf && (ppf.CODFORM || ppf.codform || ppf.PROC || ppf.proc))
    || (clob && (clob.solicitud?.proc || clob.codigoProcedimiento))
    || ""
  ).trim();

  let bonus = 0;
  let penalty = 0;

  if (cat.id === "AUTOFIRMA_GLOBAL") {
    const hasGlobalSignals = /todos los usuarios|incidencia global|afectando a la firma|presentador/.test(text);
    const hasSpecificSignals = ppf || pago || clob || hasModel(text, "600") || hasModel(text, "620") || hasModel(text, "651");
    if (hasGlobalSignals) bonus += 2;
    if (hasSpecificSignals) penalty += 3;
  }

  if (cat.id === "AUTOFIRMA_ESTADO5") {
    if (ppf || pago || clob) bonus += 2;
    if ((pago && String(pago.CODESTADO || pago.codestado || "").toUpperCase() === "PA") || /estado 5|pagado|pago ok|presentacion pendiente/.test(text + " " + dText)) {
      bonus += 3;
    }
    if (/cod012|urloktributos|presentado correctamente|ya ha sido presentada/.test(text + " " + dText)) {
      bonus += 2;
    }
  }

  if (cat.id === "PASARELA_CCO") {
    if (pago) bonus += 2;
    if (/cco|ajustaccopago|fragmento/.test(text + " " + dText)) bonus += 3;
  }
  if (cat.id === "PASARELA_FN") {
    if (pago) bonus += 2;
    if (/fn|finalizado|actualizar fn/.test(text + " " + dText)) bonus += 3;
  }
  if (cat.id === "PASARELA_PA") {
    if (pago) bonus += 2;
    if (/pa|pago anticipado|actualizar pa/.test(text + " " + dText)) bonus += 3;
  }

  if (cat.id === "MODELO_620_ESTADO" || cat.id === "MODELO_620_JSON") {
    if (ppf || /620/.test(proc) || hasModel(text, "620")) bonus += 3;
    if (/idestado|json|clob|ppfdatos/.test(text + " " + dText)) bonus += 2;
  }
  if (cat.id === "MODELO_600_JSON") {
    if (ppf || /600/.test(proc) || hasModel(text, "600")) bonus += 3;
    if (/json|clob|ppfdatos/.test(text + " " + dText)) bonus += 2;
  }
  if (cat.id === "MODELO_651_JSON") {
    if (ppf || /651/.test(proc) || hasModel(text, "651")) bonus += 3;
    if (/json|clob|ppfdatos/.test(text + " " + dText)) bonus += 2;
  }

  if (cat.id === "GENERAL" && (ppf || pago || clob)) {
    bonus += 1;
  }

  return { bonus, penalty };
}

function classify(ticket, diagnoseResult) {
  const text    = textFrom(ticket);
  const matches = kbSearch(text, 10).map(match => {
    const tweak = scoreDiagnostics(match.category, text, diagnoseResult);
    return {
      ...match,
      score: match.score + tweak.bonus - tweak.penalty,
      baseScore: match.score,
      diagBonus: tweak.bonus,
      diagPenalty: tweak.penalty
    };
  }).sort((a, b) => b.score - a.score || b.baseScore - a.baseScore);
  const best    = matches[0];
  const confidence = best.score >= 4 ? "alta" : best.score >= 2 ? "media" : "baja";
  return {
    kbMatch:         best,
    kbMatches:       matches.slice(0, 3),
    confidence,
    matchedKeywords: best.score > 0
      ? (best.category.keywords || []).filter(kw => text.includes(kw))
      : [],
    evidence: {
      hasPpfdatos: !!(diagnoseResult.ppfdatos || (diagnoseResult.jtraspasoResult && diagnoseResult.jtraspasoResult.ppfdatos)),
      hasPago: !!(diagnoseResult.pago || (diagnoseResult.jtraspasoResult && diagnoseResult.jtraspasoResult.pago)),
      hasClob: !!(diagnoseResult.clobParsed || (diagnoseResult.jtraspasoResult && diagnoseResult.jtraspasoResult.clobParsed)),
      eventCount: Array.isArray(diagnoseResult.eventos) ? diagnoseResult.eventos.length : 0
    }
  };
}

function draftTask(ticket, entities, classification, diagData) {
  const ts  = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
  const cat = classification.kbMatch.category;
  const vars = buildVars(entities, diagData, ticket.ticketId);

  const ppf = diagData?.ppfdatos || (diagData?.jtraspasoResult && diagData.jtraspasoResult.ppfdatos);
  const pago = diagData?.pago || (diagData?.jtraspasoResult && diagData.jtraspasoResult.pago);
  const tramites = Array.isArray(diagData) ? diagData : (diagData?.tramites || []);

  let tramiteInfo = "";
  if (ppf || pago) {
    const lines = [];
    if (ppf) {
      lines.push(`  - PPFDATOS: IDDATOS ${ppf.IDDATOS || ppf.iddatos || "-"} | IDESTADO: ${ppf.IDESTADO || ppf.idestado || "-"} | CODFORM: ${ppf.CODFORM || ppf.codform || "-"} | CODSOL: ${vars.CODSOL}`);
    }
    if (pago) {
      lines.push(`  - PAGO: IDPAGO ${pago.IDPAGO || pago.idpago || "-"} | CODESTADO: ${pago.CODESTADO || pago.codestado || "-"} | IMPORTE: ${vars.IMPORTE} | N28: ${vars.N28}`);
    }
    tramiteInfo = lines.join("\n");
  } else if (tramites.length) {
    tramiteInfo = tramites.map(t =>
      `  - CODSOL: ${t.codsol||"-"} | Estado: ${t.estado||"-"} | Fecha: ${t.fechaRegistro||"-"} | Proc: ${t.procedimiento||"-"}`
    ).join("\n");
  } else {
    tramiteInfo = "  (!) Sin registros encontrados en jTraspaso";
  }

  const diagEvidence = [
    `  - PPFDATOS: ${classification.evidence.hasPpfdatos ? "sí" : "no"}`,
    `  - PAGO: ${classification.evidence.hasPago ? "sí" : "no"}`,
    `  - CLOB: ${classification.evidence.hasClob ? "sí" : "no"}`,
    `  - EVENTOS: ${classification.evidence.eventCount}`
  ].join("\n");

  const tidSection = cat.tidExamples.length
    ? cat.tidExamples.map(id => `  - TID ${id}`).join("\n")
    : "  (ninguno)";

  let taskBody = "";
  const AUTOFIRMA_IDS = ["AUTOFIRMA_ESTADO5", "AUTOFIRMA_GLOBAL"];
  if (AUTOFIRMA_IDS.includes(cat.id) && cat.taskTemplate) {
    // Enriquecer vars con datos específicos del ticket
    vars.GLPI_GLOBAL = "1566026"; // ticket de incidencia global conocido
    taskBody = fillTemplate(cat.taskTemplate, vars);
  } else {
    const sqlHint = cat.sqlTemplate ? fillTemplate(cat.sqlTemplate, vars) : "(no aplica)";
    const checks  = cat.checkQueries.length
      ? cat.checkQueries.map(q => "  " + fillTemplate(q, vars)).join("\n")
      : "  (ninguna)";
    taskBody =
`SOLUCION PROPUESTA (KB):
  ${cat.solution}

QUERIES DE COMPROBACION:
${checks}

SQL SUGERIDO (adaptar {{PLACEHOLDER}} con datos reales):
${sqlHint}

ACCIONES A REALIZAR:
  [ ] Verificar con las queries de comprobacion
  [ ] Adaptar el SQL sugerido con los datos reales
  [ ] Ejecutar primero con ROLLBACK, luego con COMMIT
  [ ] Documentar la resolucion en el seguimiento`;
  }

  return [
    "=".repeat(50),
    `TAREA - Ticket #${ticket.ticketId || "?"}`,
    `Generado: ${ts}`,
    "=".repeat(50),
    `ASUNTO: ${ticket.title || "(sin titulo)"}`,
    "",
    "CLASIFICACION (KB):",
    `  Categoria : ${cat.label}`,
    `  Area      : ${cat.area} / ${cat.ambito}`,
    `  Prioridad : ${(cat.priority||"").toUpperCase()}`,
    `  Confianza : ${classification.confidence}`,
    `  KW match  : ${classification.matchedKeywords.join(", ") || "-"}`,
    "",
    "DATOS EXTRAIDOS DEL TICKET:",
    `  DNI/NIF   : ${entities.dnis.join(", ") || "-"}`,
    `  NIE       : ${entities.nies.join(", ") || "-"}`,
    `  Matricula : ${entities.matriculas.join(", ") || "-"}`,
    `  CODSOL    : ${vars.CODSOL !== "NNNNNNN" ? vars.CODSOL : (entities.codsol || "-")}`,
    `  Proc.     : ${vars.PROC !== "1197" ? vars.PROC : (entities.procedimiento || "-")}`,
    `  Fecha ref.: ${entities.fecha || "-"}`,
    "",
    "RESULTADOS jTraspaso:",
    tramiteInfo,
    "",
    "EVIDENCIA DEL DIAGNOSTICO:",
    diagEvidence,
    "",
    taskBody,
    "",
    "TICKETS SIMILARES EN KB:",
    tidSection,
    "=".repeat(50)
  ].join("\n").trim();
}

function draftFollowup(ticket, entities, classification, diagData) {
  const cat = classification.kbMatch.category;
  const vars = buildVars(entities, diagData, ticket.ticketId);
  const tramites = Array.isArray(diagData) ? diagData : (diagData?.tramites || []);
  const tramiteRef = (vars.CODSOL && vars.CODSOL !== "NNNNNNN")
    ? `referencia ${vars.CODSOL}`
    : (tramites.length && (tramites[0].codsol || tramites[0].idTramite) ? `referencia ${tramites[0].codsol || tramites[0].idTramite}` : "su tramite");

  // AutoFirma global (incidencia masiva): plantilla pendiente/resuelta
  if (cat.id === "AUTOFIRMA_GLOBAL" && cat.followupTemplate) {
    // Si hay CODSOL y URL_PRESENTADOR, la incidencia se ha resuelto -> plantilla resuelta
    if (vars.CODSOL && vars.CODSOL !== "NNNNNNN" && vars.URL_PRESENTADOR && !vars.URL_PRESENTADOR.includes("NNNNNNN") && !vars.URL_PRESENTADOR.includes("...")) {
      return fillTemplate(cat.followupTemplate.resuelta, vars);
    }
    return fillTemplate(cat.followupTemplate.pendiente, vars);
  }

  // AutoFirma estado5: usar plantilla del manual
  if (cat.id === "AUTOFIRMA_ESTADO5" && cat.followupTemplate) {
    const diagnosisText = JSON.stringify(diagData).toUpperCase();
    const alreadyPresented = /\bCOD012\b/.test(diagnosisText)
      || /\bURLOKTRIBUTOS\b/.test(diagnosisText);
    if (alreadyPresented && cat.followupTemplate.alreadyPresented) {
      return fillTemplate(cat.followupTemplate.alreadyPresented, vars);
    }
    return fillTemplate(cat.followupTemplate.standard, vars);
  }

  let body = "";
  if (cat.id === "MODELO_620_ESTADO" || cat.id === "MODELO_620_JSON") {
    body = `hemos recibido su incidencia relativa al Modelo 620 (${tramiteRef}). Estamos revisando el estado, los eventos y los datos de la solicitud. Le informaremos en cuanto este resuelto.`;
  } else if (cat.id === "MODELO_600_JSON") {
    body = `hemos recibido su incidencia relativa al Modelo 600 (${tramiteRef}). Estamos revisando los datos y el JSON CLOB. Le contactaremos en breve.`;
  } else if (cat.id === "MODELO_651_JSON") {
    body = `hemos recibido su incidencia relativa al Modelo 651 (${tramiteRef}). Le informaremos a la mayor brevedad.`;
  } else if (cat.id === "PASARELA_CCO" || cat.id === "PASARELA_FN" || cat.id === "PASARELA_PA") {
    body = `hemos detectado una incidencia en el procesamiento del pago (${tramiteRef}). Estamos coordinando con la entidad bancaria para regularizar. Le notificaremos cuando el estado sea correcto.`;
  } else if (cat.id === "IVTM_PERMISOS") {
    body = `hemos procesado su solicitud de acceso a la consulta de vehiculos (IVTM). Los permisos seran actualizados en breve.`;
  } else if (cat.id === "SIRA_NOTIFICACIONES") {
    body = `hemos recibido la incidencia del lote/correo indicado. Estamos revisando el error en el sistema de notificaciones.`;
  } else if (cat.id === "DOMI_PLAZOS") {
    body = `hemos recibido la incidencia sobre la domiciliacion (${tramiteRef}). Estamos analizando plazos y cintas. Le notificaremos en cuanto se regularice.`;
  } else if (cat.id === "PADRONES") {
    body = `hemos recibido la solicitud de actualizacion del padron. Procederemos a la correccion y le informaremos.`;
  } else {
    body = `hemos recibido su incidencia y la estamos analizando. En breve le informaremos del estado de ${tramiteRef}.`;
  }

  return `Estimado/a ciudadano/a,

En respuesta a su solicitud de soporte (ticket #${ticket.ticketId || "?"}), ${body}

Quedamos a su disposicion para cualquier consulta adicional.

Atentamente,
Servicio de Soporte Tecnico`.trim();
}

function buildDrafts(ticket, diagnoseResult = {}) {
  const entities = diagnoseResult.entities || {};
  const classification = classify(ticket, diagnoseResult);
  const task     = draftTask(ticket, entities, classification, diagnoseResult);
  const followup = draftFollowup(ticket, entities, classification, diagnoseResult);
  return {
    classification,
    task,
    followup,
    evidence: classification.evidence
  };
}

module.exports = { classify, buildDrafts, KB_CATEGORIES };
