"use strict";

const { getSharedPage, closeContextSafe } = require("./browserManager");
const { processAttachments } = require("./attachmentProcessor");

const PROFILE = ".profile-glpi-ff";

let _ctx = null, _page = null;

async function getPage() {
  if (_ctx && _page && !_page.isClosed()) return _page;
  const page = await getSharedPage(PROFILE, { headless: process.env.HEADLESS === "true" });
  _ctx = page.context();
  _page = page;
  return _page;
}

async function closeContext() {
  const ctx = _ctx;
  _ctx = null;
  _page = null;
  if (ctx) await closeContextSafe(ctx, "GLPI");
}
async function ensureCentral(page) {
  if (page.url().includes("/front/central.php")) return;

  await page.goto("https://glpi.carm.es/front/central.php", {
    waitUntil: "domcontentloaded", timeout: 40000
  });

  const deadline = Date.now() + 3 * 60 * 1000;
  while (Date.now() < deadline) {
    const cur = page.url();
    if (cur.includes("/front/central.php")) return;

    if (cur.includes("pase.carm.es")) {
      await page.evaluate(() => {
        const f = document.getElementById("clavecertificado");
        if (f) { f.submit(); return; }
        for (const form of document.querySelectorAll("form")) {
          const op = form.querySelector("input[name='opcionclave']");
          if (op && op.value === "idpafirma") { form.submit(); return; }
        }
      }).catch(() => {});
      await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000);
      continue;
    }

    if (cur.includes("conclave.carm.es") || cur.includes("pasarela.clave.gob.es")) {
      await page.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(2000);
      continue;
    }

    await page.waitForTimeout(1500);
  }
  throw new Error("Timeout: no se alcanzo central.php");
}

async function listTicketsToProcess() {
  const page = await getPage();
  await ensureCentral(page);

  // Esperar a que el widget "Tickets a ser procesados" esté en el DOM
  // (puede cargarse por AJAX después de networkidle)
  try {
    await page.waitForFunction(
      () => {
        const ths = Array.from(document.querySelectorAll("th, td"));
        return ths.some(el => (el.textContent||"").toLowerCase().includes("tickets a ser procesados"));
      },
      { timeout: 15000 }
    );
  } catch (_) {
    // Si no aparece el widget, devolver vacío sin error
  }

  return page.evaluate(() => {
    const clean = s => (s||"").replace(/\s+/g," ").trim();

    // Buscar la tabla que contiene "Tickets a ser procesados" en un th
    const allTh = Array.from(document.querySelectorAll("th"));
    const targetTh = allTh.find(th =>
      clean(th.textContent).toLowerCase().includes("tickets a ser procesados")
    );

    if (!targetTh) {
      return { tickets: [], warning: "No se encontró el widget 'Tickets a ser procesados'" };
    }

    // Subir a la tabla contenedora
    const table = targetTh.closest("table");
    if (!table) return { tickets: [], warning: "Tabla no encontrada" };

    // Extraer todos los links a ticket.form.php de esa tabla
    const links = Array.from(table.querySelectorAll("a[href*='ticket.form.php?id=']"));
    const seen = new Set();
    const tickets = [];
    for (const a of links) {
      const m = (a.getAttribute("href")||"").match(/id=(\d+)/);
      if (!m) continue;
      const id = m[1];
      if (seen.has(id)) continue;
      seen.add(id);
      const tr = a.closest("tr");
      const cells = tr ? Array.from(tr.querySelectorAll("td")) : [];
      tickets.push({
        id,
        title:      clean(a.textContent),
        elementos:  cells[2] ? clean(cells[2].textContent) : ""
      });
    }
    return { tickets };
  });
}

async function readTicket(ticketId) {
  const page = await getPage();
  await ensureCentral(page);

  await page.goto(
    `https://glpi.carm.es/front/ticket.form.php?id=${encodeURIComponent(ticketId)}`,
    { waitUntil: "domcontentloaded", timeout: 30000 }
  );

  try {
    await page.waitForSelector(".timeline_history .h_item", { timeout: 15000 });
  } catch {
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);
  }

  const ticket = await page.evaluate((targetId) => {
    const clean    = s => (s||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
    const cleanHtml = s => (s||"").replace(/\s+/g," ").trim();
    const ticketId = (document.title.match(/Tickets?\s*[#\-]?\s*(\d+)/i)||[])[1]
                  || (location.href.match(/id=(\d+)/)||[])[1]
                  || targetId || null;
    const titleEl = document.querySelector(".navigationheader h3")
                 || document.querySelector(".navigationheader")
                 || document.querySelector("h3.ticket_heading")
                 || document.querySelector(".ticket_title")
                 || document.querySelector("input[name='name']");
    const title = cleanHtml(titleEl?.value || titleEl?.innerText || document.title || "");
    const items = Array.from(document.querySelectorAll(
      ".timeline_history .h_item, .itil-timeline-item, .timeline-item, .timeline_history .item, [id^='viewitem']"
    ));
    const timeline = items.map(item => {
      const dateEl = item.querySelector(".h_date, .timeline-item-date, .date, [class*='date']");
      const date   = dateEl ? cleanHtml((dateEl.innerText||"").replace(/^\S+\s*/,"").trim()) : "";
      const userEl = item.querySelector(".h_user_name a, .h_user_name, .user_name, .user, [class*='user']");
      const user   = cleanHtml(userEl?.innerText||"");
      const contentEl = item.querySelector(".h_content, .timeline-item-content, .content");
      const type = contentEl ? Array.from(contentEl.classList).find(c=>c!=="h_content"&&c!=="timeline-item-content")||"" : "";
      const bodyEl = item.querySelector(".rich_text_container")||item.querySelector(".title")||item.querySelector(".displayed_content")||contentEl;
      const content = bodyEl ? clean(bodyEl.innerText) : "";
      const attachments = Array.from(item.querySelectorAll(
        "a[href*='document.send.php'], a[href*='document.php'], a[href*='front/document.php'], a[href*='download'], a[href*='upload'], a[href*='document']"
      ))
        .map(a => ({ label: cleanHtml(a.textContent||a.getAttribute("title")||""), href: a.href || a.getAttribute("href")||"" }))
        .filter(a => a.href && (a.href.includes("document") || a.href.includes("download") || a.href.includes("upload") || a.href.includes("file")));
      return { date, user, type, content, attachments };
    }).filter(e => e.content.length>1 || e.attachments.length>0);
    return { ticketId: String(ticketId), title, timelineCount: timeline.length, timeline,
             _debug: { url: location.href, h_items_raw: items.length } };
  }, String(ticketId));

  const allAttachments = ticket.timeline.flatMap(entry => entry.attachments || []);
  if (allAttachments.length) {
    const processed = await processAttachments(ticketId, allAttachments, page.request, page.url());
    let index = 0;
    for (const entry of ticket.timeline) {
      entry.attachments = (entry.attachments || []).map(() => processed[index++]);
      for (const attachment of entry.attachments) {
        if (attachment.text) entry.content = `${entry.content}\n\n[Texto extraído de ${attachment.label}]\n${attachment.text}`;
      }
    }
  }
  return ticket;
}

/** Devuelve la página activa SIN lanzar Firefox. Null si el contexto está cerrado. */
function getActivePage() {
  if (_ctx && _page && !_page.isClosed()) return _page;
  return null;
}

module.exports = { getPage, getActivePage, closeContext, listTicketsToProcess, readTicket };


