"use strict";

/**
 * scrapeJtraspaso.js
 *
 * Explora jTraspaso con Playwright y guarda:
 *   schema-cache/_app_structure.json  — estructura de la aplicación (páginas, menús, formularios)
 *   schema-cache/_entornos.json       — lista de entornos y sus selects
 *
 * Se ejecuta una sola vez al arrancar el servidor (si no hay caché)
 * o al llamar a POST /api/schema/discover.
 */

const path = require("path");
const fs   = require("fs");

const CACHE_DIR   = path.join(process.cwd(), "schema-cache");
const APP_CACHE   = path.join(CACHE_DIR, "_app_structure.json");
const JTRAS_URL   = "https://jtraspaso.carm.es/jTraspaso/faces/trasSQLPlus.jsp";

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

/**
 * Scraping completo de la aplicación jTraspaso.
 * @param {object} page      Playwright page ya autenticada en jTraspaso
 * @param {Function} progress Callback(step, detail) para SSE
 */
async function scrapeApp(page, progress = () => {}) {
  const report = {
    scrapedAt:  new Date().toISOString(),
    entornos:   [],
    form:       {},
    pages:      [],
    sqlTemplate: null,
    errors:     []
  };

  // ── 1. Navegar a SQLPlus ───────────────────────────────────────────────
  progress("navigate", "Navegando a jTraspaso SQLPlus...");
  await page.goto(JTRAS_URL, { waitUntil: "domcontentloaded", timeout: 40000 });
  await page.waitForTimeout(2000);

  // Esperar formulario (máx 3 min — login manual si es necesario)
  const deadline = Date.now() + 3 * 60 * 1000;
  while (Date.now() < deadline) {
    const url = page.url();
    if (url.includes("pase.carm.es")) {
      progress("auth", "Esperando login con certificado...");
      await page.waitForTimeout(3000);
      continue;
    }
    if (url.includes("jtraspaso.carm.es") && !url.includes("trasSQLPlus")) {
      await page.goto(JTRAS_URL, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1500);
      continue;
    }
    const ta = await page.$("textarea").catch(() => null);
    if (ta) break;
    await page.waitForTimeout(1500);
  }

  // ── 2. Scrape del formulario principal ────────────────────────────────
  progress("form", "Leyendo formulario SQLPlus...");
  const formData = await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll("select")).map(s => ({
      id: s.id, name: s.name,
      options: Array.from(s.options).map(o => ({ value: o.value, text: o.text.trim() })),
      selected: s.value
    }));
    const buttons = Array.from(document.querySelectorAll("input[type=submit],input[type=button],button"))
      .map(b => ({ id: b.id, name: b.name, value: (b.value || b.textContent).trim(), type: b.type }));
    const checks = Array.from(document.querySelectorAll("input[type=checkbox],input[type=radio]"))
      .map(c => ({
        id: c.id, name: c.name, value: c.value, checked: c.checked,
        label: (document.querySelector(`label[for="${c.id}"]`) || {}).textContent || ""
      }));
    const ta = document.querySelector("textarea");
    const textarea = ta ? { id: ta.id, name: ta.name, rows: ta.rows } : null;
    const links = Array.from(document.querySelectorAll("a"))
      .map(a => ({ text: a.textContent.trim().substring(0, 80), href: a.href, id: a.id }))
      .filter(a => a.href && a.href.includes("jtraspaso.carm.es") && a.text)
      .slice(0, 30);
    // Contenido inicial del textarea (plantilla por defecto si la hay)
    const taContent = ta ? ta.value.substring(0, 1000) : "";
    return { url: location.href, title: document.title, selects, buttons, checks, textarea, links, taContent };
  });

  report.form = formData;
  report.pages.push({ step: "sqlplus", url: formData.url, title: formData.title });

  // Extraer entornos
  const envSel = formData.selects.find(s =>
    s.options.some(o => o.text.match(/PRODUCCION|ARECA|PASARELA|OVCONTRI|PREPRODUCCION|BBDD/i))
  );
  if (envSel) {
    report.entornos = envSel.options;
    progress("entornos", `${envSel.options.length} entornos encontrados`);
  }

  // Guardar plantilla SQL inicial si hay algo en el textarea
  if (formData.taContent.trim()) {
    report.sqlTemplate = formData.taContent;
  }

  // ── 3. Explorar páginas del menú ──────────────────────────────────────
  const jtrasLinks = formData.links.filter(l =>
    l.href && !l.href.includes("trasSQLPlus") && l.text.length > 1
  );
  progress("nav", `Explorando ${jtrasLinks.length} secciones del menú...`);

  for (const link of jtrasLinks.slice(0, 12)) {
    try {
      progress("nav", `Visitando: ${link.text}`);
      await page.goto(link.href, { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForTimeout(1500);

      const snap = await page.evaluate(() => ({
        url:   location.href,
        title: document.title,
        h1h2:  Array.from(document.querySelectorAll("h1,h2,h3,h4,.sectionTitle,.title"))
                  .map(h => h.textContent.trim()).filter(Boolean).slice(0, 6),
        selects: Array.from(document.querySelectorAll("select")).map(s => ({
          id: s.id, name: s.name,
          options: Array.from(s.options).map(o => ({ value: o.value, text: o.text.trim() }))
        })),
        buttons: Array.from(document.querySelectorAll("input[type=submit],button"))
          .map(b => ({ id: b.id, value: (b.value || b.textContent).trim() })),
        links: Array.from(document.querySelectorAll("a"))
          .map(a => ({ text: a.textContent.trim().substring(0, 60), href: a.href }))
          .filter(a => a.href && a.href.includes("jtraspaso") && a.text)
          .slice(0, 20),
        bodyText: document.body.innerText.substring(0, 1500)
      }));

      report.pages.push({ step: link.text.replace(/\W+/g, "_"), ...snap });
    } catch (e) {
      report.errors.push({ page: link.href, error: e.message });
    }
  }

  // ── 4. Volver a SQLPlus y guardar caché ──────────────────────────────
  await page.goto(JTRAS_URL, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});

  report.summary = {
    entornos:    report.entornos.map(e => e.text),
    pagesFound:  report.pages.length,
    buttons:     formData.buttons.map(b => b.value),
    selects:     formData.selects.map(s => `${s.name||s.id}(${s.options.length} opts)`),
    checks:      formData.checks.map(c => `${c.label||c.name}=${c.value}[${c.checked?"✓":""}]`),
    textareaId:  formData.textarea?.id,
    textareaName: formData.textarea?.name
  };

  fs.writeFileSync(APP_CACHE, JSON.stringify(report, null, 2), "utf8");

  // Guardar también entornos separado
  if (report.entornos.length) {
    fs.writeFileSync(
      path.join(CACHE_DIR, "_entornos.json"),
      JSON.stringify({ scrapedAt: report.scrapedAt, entornos: report.entornos }, null, 2),
      "utf8"
    );
  }

  progress("done", `Scraping completo: ${report.entornos.length} entornos, ${report.pages.length} páginas`);
  return report;
}

/** Lee la estructura guardada (si existe) */
function loadAppStructure() {
  if (!fs.existsSync(APP_CACHE)) return null;
  try { return JSON.parse(fs.readFileSync(APP_CACHE, "utf8")); } catch (_) { return null; }
}

/** Lee entornos guardados */
function loadEntornos() {
  const f = path.join(CACHE_DIR, "_entornos.json");
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (_) { return null; }
}

module.exports = { scrapeApp, loadAppStructure, loadEntornos, APP_CACHE };
