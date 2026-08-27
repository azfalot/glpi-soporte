"use strict";

/**
 * glpiEnrich.js — Enriquecimiento de tickets GLPI
 *
 * ⚠️  RESTRICCIÓN: Este módulo NUNCA ejecuta acciones en GLPI sin confirmación
 *      explícita del usuario. El flujo es:
 *        1. proposeEnrichment() → genera propuesta (solo lectura)
 *        2. Usuario revisa en la UI y pulsa "Confirmar"
 *        3. applyEnrichment()   → ejecuta los cambios en GLPI
 *
 * Cambios que se pueden aplicar (con confirmación):
 *   - Actualizar título del ticket: [MODELO] {CODSOL} descripción
 *   - Añadir elemento Aplicación:   PAETRIBUTOS / PAEARECA / PASARELAPAGO
 *   - Añadir elemento Procedimientocarm: número de procedimiento (ej: 1197)
 *
 * Mapeo ambito KB → aplicación GLPI:
 *   PAETRIBUTOS  → categorías: AUTOFIRMA_*, MODELO_*
 *   PASARELAPAGO → categorías: PASARELA_*
 *   PAEARECA     → categorías: IVTM_*, SIRA_*, DOMI_*, PADRONES
 */

const { getPage } = require("./glpiLive");

// Mapeo de ámbito KB a aplicación GLPI
const AMBITO_TO_APP = {
  PAETRIBUTOS:  "PAETRIBUTOS",
  PASARELADEPAGO: "PASARELAPAGO",
  IVTM:         "PAEARECA",
  SIRA:         "PAEARECA",
  DOMI:         "PAEARECA",
  PADRONES:     "PAEARECA",
  GENERAL:      null
};

// ── Propuesta de enriquecimiento ──────────────────────────────────────────

/**
 * Genera una propuesta de enriquecimiento para un ticket.
 * NO modifica nada en GLPI. Solo analiza los datos y propone cambios.
 *
 * @param {object} ticket       Resultado de readTicket()
 * @param {object} diagData     Resultado del diagnóstico (entities, kbMatches, clobParsed)
 * @returns {object}            Propuesta con título sugerido y elementos a añadir
 */
function proposeEnrichment(ticket, diagData) {
  const entities  = diagData.entities || {};
  const kbMatch   = diagData.kbMatches && diagData.kbMatches[0];
  const clobParsed = diagData.clobParsed || diagData.jtraspasoResult?.clobParsed || {};

  const codsol = entities.codsol
    || diagData.jtraspasoResult?.codsol
    || (diagData.ppfdatos && (diagData.ppfdatos.CODSOLICITUD || diagData.ppfdatos.codsolicitud))
    || null;
  const proc   = extractProc(entities, clobParsed, diagData);
  const modelo = extractModelo(entities, clobParsed, diagData);
  const app    = resolveApp(kbMatch);

  // Construir título propuesto
  const currentTitle = ticket.title || "";
  const cleanTitle   = cleanTicketTitle(currentTitle);
  const titleProposal = buildTitle(modelo, codsol, cleanTitle);
  const titleChanged  = titleProposal !== currentTitle;

  // Propuesta de elementos
  const elementos = [];
  if (app) {
    elementos.push({ tipo: "Aplicacion", nombre: app, label: `Aplicación: ${app}` });
  }
  if (proc) {
    elementos.push({ tipo: "Procedimientocarm", nombre: proc, label: `Procedimiento CARM: ${proc}` });
  }

  const ticketId = ticket.ticketId || ticket.id || diagData.ticketId;

  return {
    ticketId:      ticketId ? String(ticketId) : null,
    currentTitle,
    titleProposal,
    titleChanged,
    elementos,
    codsol,
    proc,
    modelo,
    app,
    // Meta para la UI
    hasChanges: titleChanged || elementos.length > 0,
    summary: buildSummary(titleChanged, titleProposal, elementos)
  };
}

// ── Helpers de extracción ─────────────────────────────────────────────────

/** Extrae el número de procedimiento de entidades y/o JSON CLOB */
function extractProc(entities, clobParsed, diagData) {
  // 1. Del CLOB JSON (máxima fiabilidad)
  if (clobParsed) {
    const sol = clobParsed.solicitud;
    if (sol && sol.proc) return String(sol.proc);
    if (clobParsed.codigoProcedimiento) return String(clobParsed.codigoProcedimiento);
  }
  // 2. De las entidades extraídas del ticket
  if (entities.procedimiento) return String(entities.procedimiento);
  // 3. De PPFDATOS
  const ppf = diagData?.ppfdatos || diagData?.jtraspasoResult?.ppfdatos;
  if (ppf && ppf.CODFORM) {
    const m = String(ppf.CODFORM).match(/[FfMm]?(\d{3,6})/);
    if (m) return m[1];
  }
  return null;
}

/** Extrae el código de modelo (ej: "1197", "620", "600") */
function extractModelo(entities, clobParsed, diagData) {
  if (clobParsed) {
    // codForm: "F1197.V2" → "1197"
    if (clobParsed.codForm) {
      const m = String(clobParsed.codForm).match(/[FfMm]?(\d{3,6})/);
      if (m) return m[1];
    }
    if (clobParsed.solicitud?.proc) return String(clobParsed.solicitud.proc);
  }
  if (entities.procedimiento) return String(entities.procedimiento);
  const ppf = diagData?.ppfdatos || diagData?.jtraspasoResult?.ppfdatos;
  if (ppf && ppf.CODFORM) {
    const m = String(ppf.CODFORM).match(/[FfMm]?(\d{3,6})/);
    if (m) return m[1];
  }
  return null;
}

/** Resuelve la aplicación GLPI a partir de la categoría KB */
function resolveApp(kbMatch) {
  if (!kbMatch || !kbMatch.category) return null;
  const ambito = kbMatch.category.ambito || "";
  return AMBITO_TO_APP[ambito] || null;
}

/** Limpia el título actual eliminando prefijos ya procesados y redundancias */
function cleanTicketTitle(title) {
  return (title || "")
    .replace(/\[BUZON\]\s*/gi, "")
    .replace(/\[\d{3,6}\]\s*/g, "")
    .replace(/\{[A-Za-z0-9]{6,40}\}\s*/g, "")
    .replace(/\bTicket\s*(?:#\d+)?\s*[-–:]\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Construye el nuevo título */
function buildTitle(modelo, codsol, cleanTitle) {
  const parts = [];
  if (modelo) parts.push(`[${modelo}]`);
  if (codsol)  parts.push(`{${codsol}}`);
  parts.push(cleanTitle || "Incidencia");
  return parts.join(" ");
}

function buildSummary(titleChanged, title, elementos) {
  const lines = [];
  if (titleChanged) lines.push(`Título → "${title.substring(0, 60)}…"`);
  elementos.forEach(e => lines.push(`+ ${e.label}`));
  return lines.length ? lines.join("\n") : "Sin cambios propuestos";
}

// ── Aplicación de cambios en GLPI ─────────────────────────────────────────

/**
 * Ejecuta la propuesta de enriquecimiento en GLPI.
 * SOLO se llama tras confirmación explícita del usuario.
 *
 * @param {object} proposal  Resultado de proposeEnrichment()
 * @returns {object}         { ok, applied: [], errors: [] }
 */
async function applyEnrichment(proposal) {
  const result = { ok: true, applied: [], errors: [] };

  const page = await getPage();
  const ticketUrl = `https://glpi.carm.es/front/ticket.form.php?id=${proposal.ticketId}`;

  // Navegar al ticket
  if (!page.url().includes(`id=${proposal.ticketId}`)) {
    await page.goto(ticketUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
  }

  // ── 1. Actualizar título ────────────────────────────────────────────────
  if (proposal.titleChanged) {
    try {
      await updateTitle(page, proposal.titleProposal);
      result.applied.push(`Título actualizado: "${proposal.titleProposal.substring(0, 60)}"`);
    } catch (e) {
      result.errors.push(`Título: ${e.message}`);
      result.ok = false;
    }
  }

  // ── 2. Añadir elementos ────────────────────────────────────────────────
  for (const elem of proposal.elementos) {
    try {
      await addElemento(page, proposal.ticketId, elem);
      result.applied.push(`Elemento añadido: ${elem.label}`);
    } catch (e) {
      result.errors.push(`${elem.label}: ${e.message}`);
      result.ok = result.ok && false;
    }
  }

  return result;
}

// ── Acciones en GLPI ──────────────────────────────────────────────────────

/**
 * Actualiza el título del ticket en GLPI 9.5.
 * El título se edita haciendo clic en el campo name del formulario principal.
 */
async function updateTitle(page, newTitle) {
  // GLPI 9.5: el título está en input[name="name"] dentro del formulario del ticket
  const titleInput = await page.$('input[name="name"]').catch(() => null);

  if (!titleInput) {
    // Puede que necesitemos hacer clic en un botón de edición primero
    // En GLPI 9.5 a veces el título está en un h3 clicable
    const h3 = await page.$(".navigationheader h3, .ticket_heading").catch(() => null);
    if (h3) await h3.click().catch(() => {});
    await page.waitForTimeout(1000);
  }

  const input = await page.$('input[name="name"]').catch(() => null);
  if (!input) throw new Error("No se encontró el campo de título del ticket");

  await input.click({ clickCount: 3 }); // seleccionar todo
  await page.waitForTimeout(200);
  await input.fill(newTitle);
  await page.waitForTimeout(300);

  // Guardar — buscar botón de actualizar en el formulario
  const updateBtn = await page.$(
    'input[type="submit"][value*="Actualizar"], input[type="submit"][name*="update"], ' +
    'button[type="submit"]:has-text("Actualizar"), .submit[value*="Actualizar"]'
  ).catch(() => null);

  if (updateBtn) {
    await updateBtn.click();
    await page.waitForTimeout(2000);
  } else {
    // Enviar con Enter
    await input.press("Enter");
    await page.waitForTimeout(2000);
  }
}

/**
 * Añade un elemento al ticket desde la sección "Añadir elemento".
 *
 * Flujo UI GLPI 9.5:
 *   1. Clic en "Elementos" en el menú lateral izquierdo
 *   2. Seleccionar "O búsqueda completa" → tipo de elemento (Aplicacion / Procedimientocarm)
 *   3. Escribir el nombre en el input de búsqueda que aparece
 *   4. Seleccionar el resultado del autocomplete
 *   5. Clic en "Añadir"
 */
async function addElemento(page, ticketId, elem) {
  // Asegurar que estamos en la sección de Elementos del ticket
  const elemUrl = `https://glpi.carm.es/front/ticket.form.php?id=${ticketId}`;
  if (!page.url().includes(`id=${ticketId}`)) {
    await page.goto(elemUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
  }

  // Clic en "Elementos" en la barra lateral izquierda
  const elemLink = await page.$(
    'a[href*="item"]:has-text("Elementos"), li:has-text("Elementos") a, ' +
    '.leftMenu a:has-text("Elementos"), .navigationheader a:has-text("Elementos")'
  ).catch(() => null);
  if (elemLink) {
    await elemLink.click().catch(() => {});
    await page.waitForTimeout(1500);
  }

  // Buscar el select de "O búsqueda completa" (itemtype selector)
  // En GLPI 9.5 suele ser un select con name/id que contiene "itemtype"
  const itypeSelect = await page.$(
    'select[name="itemtype"], select[id*="itemtype"], select[name*="type_dropdown"]'
  ).catch(() => null);

  if (!itypeSelect) {
    throw new Error(`No se encontró el selector de tipo de elemento (${elem.tipo})`);
  }

  // Seleccionar el tipo de elemento
  // Los valores en GLPI para estos tipos suelen ser exactamente el nombre de la clase PHP
  // Probar varios formatos
  const tipoMap = {
    "Aplicacion":       ["Applicationsoftware", "Application", "Software", "Aplicacion"],
    "Procedimientocarm": ["Procedimientocarm", "PluginGenericobjectProcedimientocarm",
                          "Procedimiento", "procedimientocarm"]
  };
  const tiposACom = tipoMap[elem.tipo] || [elem.tipo];

  let selected = false;
  const opts = await page.evaluate(sel => {
    const el = document.querySelector(sel);
    return el ? Array.from(el.options).map(o => ({ v: o.value, t: o.text })) : [];
  }, 'select[name="itemtype"], select[id*="itemtype"]').catch(() => []);

  for (const buscar of tiposACom) {
    const match = opts.find(o =>
      o.v.toLowerCase().includes(buscar.toLowerCase()) ||
      o.t.toLowerCase().includes(buscar.toLowerCase())
    );
    if (match) {
      await page.selectOption(
        'select[name="itemtype"], select[id*="itemtype"]',
        match.v
      ).catch(() => {});
      selected = true;
      break;
    }
  }
  if (!selected) {
    throw new Error(`No se encontró el tipo "${elem.tipo}" en el selector. Opciones: ${opts.map(o => o.t).join(", ")}`);
  }

  await page.waitForTimeout(1000);

  // Escribir en el campo de búsqueda del elemento
  const searchInput = await page.$(
    'input[name*="search"], input[id*="search"], input[placeholder*="uscar"], ' +
    'input.select2-search__field, .autocomplete input'
  ).catch(() => null);

  if (!searchInput) {
    throw new Error(`No se encontró campo de búsqueda para ${elem.tipo}`);
  }

  await searchInput.fill(elem.nombre);
  await page.waitForTimeout(1500); // esperar autocomplete

  // Seleccionar el primer resultado del autocomplete
  const suggestion = await page.$(
    '.autocomplete-result, .select2-results__option, li[class*="autocomplete"], ' +
    '.ui-autocomplete li, .dropdown-item'
  ).catch(() => null);

  if (suggestion) {
    await suggestion.click().catch(() => {});
    await page.waitForTimeout(500);
  } else {
    // Intentar con Enter
    await searchInput.press("Enter");
    await page.waitForTimeout(500);
  }

  // Clic en botón "Añadir"
  const addBtn = await page.$(
    'input[type="submit"][value*="Adir"], input[type="submit"][value*="Añadir"], ' +
    'input[type="submit"][value*="Add"], button:has-text("Añadir")'
  ).catch(() => null);

  if (!addBtn) throw new Error(`No se encontró el botón "Añadir" para ${elem.tipo}`);

  await addBtn.click();
  await page.waitForTimeout(2000);
}

module.exports = { proposeEnrichment, applyEnrichment };
