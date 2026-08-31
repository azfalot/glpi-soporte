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

function classify(ticket, diagnoseResult) {
  const text    = textFrom(ticket);
  const matches = kbSearch(text, 3);
  const best    = matches[0];
  const confidence = best.score >= 2 ? "alta" : best.score === 1 ? "media" : "baja";
  return {
    kbMatch:         best,
    kbMatches:       matches,
    confidence,
    matchedKeywords: best.score > 0
      ? (best.category.keywords || []).filter(kw => text.includes(kw))
      : []
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
    body = `hemos recibido su incidencia relativa al Modelo 620 (${tramiteRef}). Estamos revisando el estado y los datos de la solicitud. Le informaremos en cuanto este resuelto.`;
  } else if (cat.id === "MODELO_600_JSON") {
    body = `hemos recibido su incidencia relativa al Modelo 600 (${tramiteRef}). Estamos revisando los datos. Le contactaremos en breve.`;
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
  return { classification, task, followup };
}

module.exports = { classify, buildDrafts, KB_CATEGORIES };
