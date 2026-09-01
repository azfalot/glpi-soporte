"use strict";

try { require("dotenv").config(); } catch {}

const express = require("express");
const path    = require("path");

const { glpi, jtras, getMode, setMode } = require("./adapters");
const enrich  = require("./glpiEnrich");
const extract = require("./extract");
const classify = require("./classify");
const kb      = require("./kb");
const schema  = require("./schemaExplorer");
const queue   = require("./jobQueue");
const scraper = require("../scripts/scrapeJtraspaso");
const { killOrphanPlaywrightFirefox } = require("./ffKiller");

const app = express();
app.use(express.json({ limit: "4mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

// ── Modo de datos (mock / live) ──────────────────────────────────────────────
app.get("/api/mode", (_req, res) => {
  res.json({ mode: getMode(), isMock: getMode() === "mock" });
});

app.post("/api/mode", (req, res) => {
  const { mode } = req.body || {};
  if (mode === "mock" || mode === "live") {
    setMode(mode);
    return res.json({ ok: true, mode: getMode(), isMock: getMode() === "mock" });
  }
  res.status(400).json({ error: "Modo debe ser 'mock' o 'live'" });
});

// ── SSE — canal de eventos para la UI ───────────────────────────────────────
app.get("/api/events", (req, res) => {
  queue.addClient(res);

  // Si no hay tickets en caché y el startup ya terminó (o nunca arrancó),
  // lanzar un refresh automático para que el nuevo cliente vea la bandeja
  setImmediate(() => {
    if (queue._lastTickets) return;  // ya hay datos, el replay los enviará
    const startup = queue.status("load-tickets-startup");
    const running = startup && startup.status === "running";
    if (!running) {
      // Startup ya terminó o nunca existió — relanzar silenciosamente
      queue.run("load-tickets-startup", "Cargando bandeja GLPI al iniciar", async (progress) => {
        progress("glpi", "Conectando con GLPI...");
        const result = await glpi.listTicketsToProcess();
        queue.broadcast({ type: "tickets:ready", data: result });
        scheduleTicketPipelines(result.tickets || []);
        return result;
      });
    }
  });
});

app.get("/api/jobs", (_req, res) => {
  res.json(queue.list());
});

const ticketStore = require("./storage/ticketStore");

function cacheGet(ticketId) {
  return ticketStore.get(ticketId);
}
function cacheSet(ticketId, key, value) {
  ticketStore.set(ticketId, key, value);
}
function cacheDone(ticketId) {
  ticketStore.done(ticketId);
}
function cacheError(ticketId, err) {
  ticketStore.error(ticketId, err);
}

// ── Pipeline completo de un ticket (reutilizable) ─────────────────────────────
/**
 * @param {string|number} ticketId
 * @param {Function}      progress   callback (step, detail)
 * @param {boolean}       closeAfter si true, cierra Firefox al terminar este ticket.
 *                                   Por defecto false: se mantiene la sesión persistente
 *                                   (login/certificado ya validado) para el siguiente ticket.
 */
async function runTicketPipeline(ticketId, progress, closeAfter = false, manualCodsol = null) {
  ticketStore.init(ticketId);
  try {
    // PASO 1: Leer ticket de GLPI
    progress("glpi", "Leyendo ticket de GLPI...");
    let ticket;
    try {
      ticket = await glpi.readTicket(ticketId);
    } catch (e) {
      queue.broadcast({ type: "ticket:error", ticketId, error: e.message });
      throw e;
    }
    cacheSet(ticketId, "ticket", ticket);
    queue.broadcast({ type: "ticket:ready", ticketId, data: ticket });

    // PASO 2: Extraer entidades + clasificar KB
    progress("extract", "Extrayendo datos y clasificando...");
    const entities  = extract.extractEntities(ticket);
    const manualValue = String(manualCodsol || "").trim();
    if (manualValue) {
      entities.codsol = manualValue.toUpperCase();
    }
    const fullText  = [ticket.title || ""]
      .concat((ticket.timeline || []).map(e => e.content || ""))
      .join(" ");
    const kbMatches = kb.kbSearch(fullText, 3);
    const diagBase  = { ticketId, entities, kbMatches, tramites: [], dbError: null };
    cacheSet(ticketId, "diag", diagBase);
    queue.broadcast({ type: "diag:ready", ticketId, data: diagBase });

    // PASO 3: Consultar jTraspaso
    const codsol = entities.codsol || null;
    if (codsol || entities.dnis.length || entities.nies.length || entities.matriculas.length) {
      const label = codsol
        ? `CODSOL ${codsol}`
        : `token (${entities.dnis[0] || entities.nies[0] || entities.matriculas[0]})`;
      progress("jtraspaso", `Consultando jTraspaso — ${label}...`);
      try {
        const jtResult = await jtras.diagnoseFull(codsol, progress, entities);
        cacheSet(ticketId, "jtras", jtResult);
        queue.broadcast({ type: "jtraspaso:ready", ticketId, codsol: jtResult.codsol, data: jtResult });
        diagBase.jtraspasoResult = jtResult;
        diagBase.ppfdatos   = jtResult.ppfdatos;
        diagBase.pago       = jtResult.pago;
        diagBase.eventos    = jtResult.eventos;
        diagBase.clobParsed = jtResult.clobParsed;
        if (jtResult.codsol && !codsol) entities.codsol = jtResult.codsol;
      } catch (e) {
        cacheSet(ticketId, "jtrasError", { error: e.message });
        queue.broadcast({ type: "jtraspaso:error", ticketId, error: e.message });
      }
    } else {
      const skip = {
        reason: "Sin datos identificativos en el ticket (CODSOL, DNI, matrícula)",
        sqlLog: [{
          label: "Diagnóstico jTraspaso",
          status: "skipped",
          startedAt: new Date().toISOString(),
          durationMs: 0,
          rowCount: 0,
          resultSummary: "No se ha ejecutado SQL: falta CODSOL, DNI/NIE o matrícula. Introduce un CODSOL manual para reconsultar.",
          sql: ""
        }]
      };
      cacheSet(ticketId, "jtrasSkip", skip);
      queue.broadcast({ type: "jtraspaso:skip", ticketId, reason: skip.reason, data: skip });
    }

    // PASO 4: Generar borradores
    progress("drafts", "Generando borradores TAREA y SEGUIMIENTO...");
    const drafts = classify.buildDrafts(ticket, diagBase);
    cacheSet(ticketId, "drafts", drafts);
    queue.broadcast({ type: "draft:ready", ticketId, data: drafts });

    // PASO 5: Propuesta enriquecimiento GLPI
    progress("enrich", "Generando propuesta de enriquecimiento...");
    const proposal = enrich.proposeEnrichment(ticket, diagBase);
    cacheSet(ticketId, "proposal", proposal);
    queue.broadcast({ type: "enrich:proposal", ticketId, data: proposal });

    cacheDone(ticketId);
    // Notificar a la bandeja que este ticket está listo
    queue.broadcast({ type: "ticket:cached", ticketId, status: "done" });
    return { ticketId, done: true };

  } catch (e) {
    cacheError(ticketId, e.message);
    queue.broadcast({ type: "ticket:cached", ticketId, status: "error", error: e.message });
    throw e;
  } finally {
    if (closeAfter) {
      setImmediate(async () => {
        await glpi.closeContext().catch(() => {});
        await jtras.closeContext().catch(() => {});
      });
    }
  }
}

// ── Pipeline automático de ticket ────────────────────────────────────────────
app.post("/api/ticket/process", async (req, res) => {
  const { ticketId, force = false, manualCodsol = null } = req.body || {};
  if (!ticketId) return res.status(400).json({ error: "ticketId requerido" });

  // Si ya está en caché y completo, devolver inmediatamente el estado
  const cached = cacheGet(ticketId);
  if (!force && cached && cached.status === "done") {
    res.json({ ok: true, ticketId, cached: true });
    // Re-emitir todos los eventos cacheados para este cliente (nuevo SSE replay)
    if (cached.ticket)   queue.broadcast({ type: "ticket:ready",     ticketId, data: cached.ticket });
    if (cached.diag)     queue.broadcast({ type: "diag:ready",       ticketId, data: cached.diag });
    if (cached.jtras)    queue.broadcast({ type: "jtraspaso:ready",  ticketId, codsol: cached.jtras.codsol, data: cached.jtras });
    if (cached.jtrasSkip) queue.broadcast({ type: "jtraspaso:skip",  ticketId, reason: cached.jtrasSkip.reason, data: cached.jtrasSkip });
    if (cached.jtrasError) queue.broadcast({ type: "jtraspaso:error", ticketId, error: cached.jtrasError.error });
    if (cached.drafts)   queue.broadcast({ type: "draft:ready",      ticketId, data: cached.drafts });
    if (cached.proposal) queue.broadcast({ type: "enrich:proposal",  ticketId, data: cached.proposal });
    return;
  }

  // Si ya está corriendo, solo responder OK (los eventos SSE ya están llegando)
  if (!force && cached && cached.status === "running") {
    return res.json({ ok: true, ticketId, running: true });
  }

  res.json({ ok: true, ticketId, message: "Procesando en background..." });
  queue.run(`ticket-${ticketId}`, `Procesando ticket #${ticketId}`, (progress) =>
    runTicketPipeline(ticketId, progress, false, manualCodsol)
  );
});

// Devuelve el estado cacheado de un ticket (para reconexiones / cambio de vista)
app.get("/api/ticket/:id/cache", (req, res) => {
  const cached = cacheGet(req.params.id);
  if (!cached) return res.json({ found: false });
  res.json({ found: true, ...cached });
});

// Devuelve el estado de todos los tickets en caché (status por ticketId)
app.get("/api/tickets/cache-status", (_req, res) => {
  res.json(ticketStore.getAllStatuses());
});

// ── GLPI Enriquecimiento ─────────────────────────────────────────────────────

/**
 * Aplica la propuesta de enriquecimiento en GLPI.
 * REQUIERE confirmación explícita del usuario (llamada manual desde la UI).
 * ⚠️ Solo se ejecuta cuando el usuario pulsa "Confirmar y aplicar en GLPI".
 */
app.post("/api/glpi/enrich/apply", async (req, res) => {
  const { proposal } = req.body || {};
  if (!proposal || !proposal.ticketId) {
    return res.status(400).json({ error: "Se requiere la propuesta (proposal)" });
  }
  try {
    const result = await enrich.applyEnrichment(proposal);
    queue.broadcast({ type: "enrich:applied", ticketId: proposal.ticketId, data: result });
    // Sesión persistente: no cerramos el contexto de GLPI tras aplicar.
    // Se cierra explícitamente vía /api/session/close si el técnico lo desea.
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GLPI — listar tickets ────────────────────────────────────────────────────
app.post("/api/tickets/load", async (_req, res) => {
  try {
    res.json({ ok: true, message: "Cargando bandeja..." });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Carga real de tickets en background — tras obtenerlos, lanza el pipeline de cada uno
app.post("/api/tickets/refresh", (_req, res) => {
  res.json({ ok: true });
  queue.run("load-tickets", "Cargando bandeja GLPI", async (progress) => {
    progress("glpi", "Conectando con GLPI...");
    const result = await glpi.listTicketsToProcess();
    queue.broadcast({ type: "tickets:ready", data: result });
    // NO cerrar Firefox — el pipeline de tickets lo reutiliza
    scheduleTicketPipelines(result.tickets || []);
    return result;
  });
});

/**
 * Lanza el pipeline de cada ticket de forma secuencial.
 * Firefox se mantiene abierto como sesión persistente entre tickets y entre
 * cadenas de bandeja — solo se cierra ante fallo de contexto o cierre manual
 * explícito vía /api/session/close.
 */
function scheduleTicketPipelines(tickets) {
  const pending = tickets.filter(t => {
    const c = cacheGet(t.id);
    return !c || (c.status !== "done" && c.status !== "running");
  });
  if (!pending.length) return;

  let chain = Promise.resolve();
  for (let i = 0; i < pending.length; i++) {
    const t = pending[i];
    const id = t.id;
    chain = chain.then(() => {
      ticketStore.init(id);
      queue.broadcast({ type: "ticket:cached", ticketId: id, status: "running" });
      return queue.run(
        `ticket-${id}`,
        `Procesando ticket #${id}`,
        // closeAfter=false: la sesión de Firefox persiste para el siguiente ticket
        (progress) => runTicketPipeline(id, progress, false)
      );
    }).catch(() => {
      // Si un ticket falla por contexto roto, cerrar y dejar que el siguiente relance uno nuevo
      glpi.closeContext().catch(() => {});
      jtras.closeContext().catch(() => {});
    });
  }
}

// Cierre explícito de la sesión persistente de Firefox (GLPI + jTraspaso).
// Útil cuando el técnico termina su turno o quiere forzar un relogin limpio.
app.post("/api/session/close", async (_req, res) => {
  try {
    await glpi.closeContext().catch(() => {});
    await jtras.closeContext().catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Schema Explorer (background) ─────────────────────────────────────────────
app.get("/api/schema/status", (_req, res) => {
  const cached = scraper.loadAppStructure();
  res.json({
    hasAppStructure: !!cached,
    scrapedAt:       cached ? cached.scrapedAt : null,
    entornos:        cached ? cached.summary.entornos : [],
    schemaEntornos:  schema.listCachedEntornos()
  });
});

app.post("/api/schema/scrape", (_req, res) => {
  res.json({ ok: true, message: "Scraping en background..." });
  queue.run("scrape-jtraspaso", "Explorando estructura de jTraspaso", async (progress) => {
    const page = await jtras.getPage();
    await jtras.ensureJTraspaso(page);
    return scraper.scrapeApp(page, progress);
  });
});

app.post("/api/schema/discover", async (req, res) => {
  const { entorno = "OVCONTRI PRODUCCION", force = false } = req.body || {};
  res.json({ ok: true, message: `Discovery de esquema en background para ${entorno}...` });
  queue.run(
    `schema-${entorno}`,
    `Discovery esquema: ${entorno}`,
    async (progress) => schema.discoverSchema(jtras.runQuery, entorno, { force, progress })
  );
});

app.get("/api/schema/search", (req, res) => {
  const { entorno = "OVCONTRI PRODUCCION", q } = req.query;
  if (!q) return res.status(400).json({ error: "q requerido" });
  res.json(schema.searchSchema(entorno, q));
});

// ── jTraspaso — query directa (para debug / técnico) ─────────────────────────
app.post("/api/jtraspaso/query", async (req, res) => {
  const { sql, entorno } = req.body || {};
  if (!sql) return res.status(400).json({ error: "Campo sql requerido" });
  try {
    const r = await jtras.runQuery(sql, entorno);
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── KB ────────────────────────────────────────────────────────────────────────
app.get("/api/kb/categories", (_req, res) => {
  res.json(kb.kbCategories().map(c => ({
    id: c.id, label: c.label, area: c.area, ambito: c.ambito, priority: c.priority
  })));
});

app.post("/api/kb/reload", (_req, res) => {
  try {
    const rules = kb.reloadRules();
    res.json({ ok: true, count: rules.length, message: `${rules.length} reglas KB recargadas correctamente` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/kb/search", (req, res) => {
  const q = String(req.query.q || "");
  if (!q) return res.status(400).json({ error: "q requerido" });
  res.json(kb.kbSearch(q, 5));
});

// ── Health + debug ────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ ok: true }));

// Estado del browser GLPI — NO lanza Firefox si no está ya abierto
app.get("/api/glpi/status", async (_req, res) => {
  try {
    // Solo consultar si hay contexto activo — no lanzar Firefox
    const page = glpi.getActivePage();
    if (!page) return res.json({ url: null, needsAuth: false, isReady: false, idle: true });
    const url   = page.url();
    const title = await page.title().catch(() => "");
    const needsAuth = url.includes("pase.carm.es") || url.includes("/login");
    res.json({ url, title, needsAuth, isReady: url.includes("/front/") });
  } catch (e) {
    res.json({ url: null, error: e.message, needsAuth: false, idle: true });
  }
});

// Inspeccionar la página actual del browser jTraspaso (entorno seleccionado, zona Salida)
app.get("/api/jtraspaso/inspect", async (_req, res) => {
  try {
    const page = await jtras.getPage();
    const info = await page.evaluate(() => {
      // Entorno seleccionado
      const envSel = Array.from(document.querySelectorAll("select")).find(s =>
        Array.from(s.options).some(o => o.text.match(/OVCONTRI|PRODUCCION|ARECA/i))
      );
      // Zonas con contenido relevante
      const salidas = Array.from(document.querySelectorAll("td,div,textarea,pre,span"))
        .filter(el => {
          const t = (el.innerText||el.value||"").trim();
          return t.length > 20 && (
            t.includes("resultados") || t.includes("SQL*Plus") ||
            t.includes("IDDATOS") || t.includes("Oracle") || t.includes("petici")
          );
        }).map(el => ({
          tag: el.tagName, id: el.id, cls: el.className.substring(0,40),
          text: (el.innerText||el.value||"").substring(0,300),
          htmlLen: (el.innerHTML||"").length
        })).slice(0, 8);
      // HTML completo del area de salida si existe
      const salidaEl = Array.from(document.querySelectorAll("[id*='salida'],[id*='output'],[id*='resultado']")).pop();
      return {
        url: location.href,
        entorno: envSel ? { id: envSel.id, value: envSel.value, text: envSel.options[envSel.selectedIndex]?.text } : null,
        salidas,
        salidaHtml: salidaEl ? salidaEl.innerHTML.substring(0, 2000) : null
      };
    });
    res.json({ ok: true, ...info });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Inspeccionar la página actual del browser GLPI
app.get("/api/glpi/inspect", async (_req, res) => {
  try {
    const page = await glpi.getPage();
    const info = await page.evaluate(() => ({
      url:   location.href,
      title: document.title,
      elements: Array.from(document.querySelectorAll("a,button,input[type=submit],input[type=button],input[name='_eventId']"))
        .map(e => ({
          tag: e.tagName, id: e.id, name: e.name||"",
          value: (e.value||e.textContent||"").trim().substring(0,80),
          href: e.href||"", type: e.type||""
        })).slice(0, 40),
      forms: Array.from(document.querySelectorAll("form")).map(f => ({
        id: f.id, action: f.action, method: f.method,
        inputs: Array.from(f.querySelectorAll("input,select,button")).map(i => ({
          tag: i.tagName, name: i.name, id: i.id, type: i.type||"", value: (i.value||"").substring(0,60)
        }))
      }))
    }));
    res.json(info);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Intentar hacer clic en el botón de certificado del PASE
app.post("/api/glpi/click-cert", async (_req, res) => {
  try {
    const page = await glpi.getPage();
    const url = page.url();
    if (!url.includes("pase.carm.es")) {
      return res.json({ ok: true, message: "No estamos en PASE — ya autenticado o en otra página", url });
    }
    // Buscar el botón/enlace de acceso con certificado en PASE
    const clicked = await page.evaluate(() => {
      // PASE tiene un form con hidden input _eventId=accesoConclave
      const certForm = Array.from(document.querySelectorAll("form")).find(f =>
        Array.from(f.querySelectorAll("input[name='_eventId']"))
          .some(i => i.value === "accesoConclave")
      );
      if (certForm) {
        // Buscar el botón submit de ese form
        const btn = certForm.querySelector("input[type=submit], button[type=submit], button");
        if (btn) { btn.click(); return { clicked: "form submit", value: (btn.value||btn.textContent||"").trim() }; }
        certForm.submit();
        return { clicked: "form.submit()", value: "" };
      }
      // Buscar link directo de certificado
      const links = Array.from(document.querySelectorAll("a")).filter(a =>
        (a.textContent||"").match(/certificado|Certificado|conclave|Conclave/i) ||
        (a.href||"").match(/certificado|conclave/i)
      );
      if (links[0]) { links[0].click(); return { clicked: "link", value: links[0].textContent.trim().substring(0,60) }; }
      // Fallback: todos los links y botones
      const all = Array.from(document.querySelectorAll("a[href],button,input[type=submit]"))
        .map(e => ({ text: (e.textContent||e.value||"").trim().substring(0,60), href: e.href||"" }));
      return { clicked: null, available: all.slice(0,20) };
    });
    if (clicked.clicked) {
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(2000);
      res.json({ ok: true, ...clicked, newUrl: page.url(), newTitle: await page.title() });
    } else {
      res.json({ ok: false, message: "No se encontró botón de certificado", ...clicked });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Arranque ──────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 8788);
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Soporte LIVE → http://127.0.0.1:${PORT}`);

  // Limpieza preventiva: procesos Firefox huérfanos de sesiones anteriores
  // (crashes, cierres forzosos del proceso Node, dobles instancias) bloquean
  // los perfiles persistentes (.profile-glpi-ff / .profile-jtras-ff) y provocan
  // "Failed to launch the browser process" al intentar relanzar el contexto.
  killOrphanPlaywrightFirefox();

  // Cargar bandeja al arrancar y lanzar pipeline de todos los tickets
  queue.run("load-tickets-startup", "Cargando bandeja GLPI al iniciar", async (progress) => {
    progress("glpi", "Conectando con GLPI...");
    const result = await glpi.listTicketsToProcess();
    queue.broadcast({ type: "tickets:ready", data: result });
    // Nota: NO cerramos Firefox aquí — la sesión persiste entre tickets y
    // entre recargas de bandeja. Se cierra solo con /api/session/close.
    scheduleTicketPipelines(result.tickets || []);
    return result;
  });
});

// Cierre limpio de la sesión persistente de Firefox al parar el servidor
// (Ctrl+C, kill, reinicio) — evita dejar procesos huérfanos que bloqueen
// los perfiles persistentes en el próximo arranque.
async function shutdown() {
  console.log("Cerrando sesión de Firefox antes de salir...");
  await glpi.closeContext().catch(() => {});
  await jtras.closeContext().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
