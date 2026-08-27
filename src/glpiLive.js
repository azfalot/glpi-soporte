"use strict";

const path = require("path");
const fs   = require("fs");
const { firefox } = require("playwright");
const { getFirefoxPids, killPids, killOrphanPlaywrightFirefox } = require("./ffKiller");

const PROFILE = path.join(process.cwd(), ".profile-glpi-ff");

const FF_PREFS = {
  "security.osclientcerts.autoload":   true,
  "security.default_personal_cert":    "Select Automatically",
  "security.ask_for_token_init":       false,
  "security.ssl.enable_ocsp_stapling": false,
  "network.trr.mode":                  5,
  "network.proxy.type":                0
};

let _ctx = null, _page = null;

/** Elimina el lock file del perfil Firefox (lo deja si Firefox muere de golpe) */
function unlockProfile(profilePath) {
  for (const lockFile of ["lock", ".parentlock"]) {
    try { fs.unlinkSync(path.join(profilePath, lockFile)); } catch (_) {}
  }
}

async function getPage() {
  if (_ctx && _page && !_page.isClosed()) return _page;
  // Desbloquear perfil antes de lanzar (por si quedó lock de una sesión anterior)
  unlockProfile(PROFILE);
  _ctx = await firefox.launchPersistentContext(PROFILE, {
    headless: true,
    args: ["--headless"],
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
    firefoxUserPrefs: FF_PREFS
  });
  _page = _ctx.pages()[0] || await _ctx.newPage();
  _page.on("dialog", async d => { await d.accept().catch(() => {}); });
  return _page;
}

async function closeContext() {
  // Capturar PIDs ANTES de cerrar (mientras aún son hijos del servidor)
  const pidsBefore = getFirefoxPids();
  try { if (_ctx) await _ctx.close(); } catch (_) {}
  _ctx = null; _page = null;
  // Matar exactamente los PIDs que teníamos (+ cualquier hijo nuevo)
  const kill = () => {
    const now = getFirefoxPids();
    const toKill = [...new Set([...pidsBefore, ...now])];
    if (toKill.length) {
      console.log(`[ffKiller] cerrando ${toKill.length} procesos Firefox (GLPI)`);
      killPids(toKill);
    }
  };
  setTimeout(kill, 1000);
  setTimeout(kill, 3000); // segunda pasada
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

  return page.evaluate(() => {
    const clean    = s => (s||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
    const cleanHtml = s => (s||"").replace(/\s+/g," ").trim();
    const ticketId = (document.title.match(/Tickets?\s*[#\-]?\s*(\d+)/i)||[])[1]
                  || (location.href.match(/id=(\d+)/)||[])[1] || null;
    const titleEl = document.querySelector(".navigationheader h3")
                 || document.querySelector(".navigationheader")
                 || document.querySelector("h3.ticket_heading");
    const title = cleanHtml(titleEl?.innerText || document.title || "");
    const items = Array.from(document.querySelectorAll(".timeline_history .h_item"));
    const timeline = items.map(item => {
      const dateEl = item.querySelector(".h_date");
      const date   = dateEl ? cleanHtml((dateEl.innerText||"").replace(/^\S+\s*/,"").trim()) : "";
      const userEl = item.querySelector(".h_user_name a")||item.querySelector(".h_user_name");
      const user   = cleanHtml(userEl?.innerText||"");
      const contentEl = item.querySelector(".h_content");
      const type = contentEl ? Array.from(contentEl.classList).find(c=>c!=="h_content")||"" : "";
      const bodyEl = item.querySelector(".rich_text_container")||item.querySelector(".title")||item.querySelector(".displayed_content");
      const content = bodyEl ? clean(bodyEl.innerText) : "";
      const attachments = Array.from(item.querySelectorAll("a[href*='document.send.php']"))
        .map(a => ({ label: cleanHtml(a.textContent||""), href: a.getAttribute("href")||"" }));
      return { date, user, type, content, attachments };
    }).filter(e => e.content.length>1 || e.attachments.length>0);
    return { ticketId, title, timelineCount: timeline.length, timeline,
             _debug: { url: location.href, h_items_raw: items.length } };
  });
}

/** Devuelve la página activa SIN lanzar Firefox. Null si el contexto está cerrado. */
function getActivePage() {
  if (_ctx && _page && !_page.isClosed()) return _page;
  return null;
}

module.exports = { getPage, getActivePage, closeContext, listTicketsToProcess, readTicket };




