"use strict";

const path = require("path");
const fs   = require("fs");
const { firefox } = require("playwright");
const { getFirefoxPids, killPids, killOrphanPlaywrightFirefox } = require("./ffKiller");

const JTRAS_URL = "https://jtraspaso.carm.es/jTraspaso/faces/trasSQLPlus.jsp";
const PROFILE   = path.join(process.cwd(), ".profile-jtras-ff");

const FF_PREFS = {
  "security.osclientcerts.autoload":   true,
  "security.default_personal_cert":    "Select Automatically",
  "security.ask_for_token_init":       false,
  "security.ssl.enable_ocsp_stapling": false,
  "network.trr.mode":                  5,
  "network.proxy.type":                0
};

let _ctx = null, _page = null;

function unlockProfile(profilePath) {
  for (const lockFile of ["lock", ".parentlock"]) {
    try { fs.unlinkSync(path.join(profilePath, lockFile)); } catch (_) {}
  }
}

async function getPage() {
  if (_ctx && _page && !_page.isClosed()) return _page;
  unlockProfile(PROFILE);
  _ctx = await firefox.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
    firefoxUserPrefs: FF_PREFS
  });
  _page = _ctx.pages()[0] || await _ctx.newPage();
  _page.on("dialog", async d => { await d.accept().catch(() => {}); });
  return _page;
}

async function closeContext() {
  const pidsBefore = getFirefoxPids();
  try { if (_ctx) await _ctx.close(); } catch (_) {}
  _ctx = null; _page = null;
  const kill = () => {
    const now = getFirefoxPids();
    const toKill = [...new Set([...pidsBefore, ...now])];
    if (toKill.length) {
      console.log(`[ffKiller] cerrando ${toKill.length} procesos Firefox (jTraspaso)`);
      killPids(toKill);
    }
  };
  setTimeout(kill, 1000);
  setTimeout(kill, 3000);
}
async function ensureJTraspaso(page) {
  const url = page.url();
  if (url.includes("jtraspaso.carm.es") && url.includes("trasSQLPlus")) {
    const ta = await page.$("textarea").catch(() => null);
    if (ta) return;
  }
  if (!url.includes("jtraspaso.carm.es")) {
    await page.goto(JTRAS_URL, { waitUntil: "domcontentloaded", timeout: 40000 });
    await page.waitForTimeout(2000);
  }
  const deadline = Date.now() + 3 * 60 * 1000;
  while (Date.now() < deadline) {
    const cur = page.url();

    // PASE: enviar form de certificado FNMT automaticamente
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

    // Conclave/Proxy2 — Chrome usa el certificado auto (CERT_ARGS)
    if (cur.includes("conclave.carm.es") || cur.includes("pasarela.clave.gob.es")) {
      await page.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(2000);
      continue;
    }

    if (cur.includes("jtraspaso.carm.es") && !cur.includes("trasSQLPlus")) {
      await page.goto(JTRAS_URL, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1500);
      continue;
    }

    const ta = await page.$("textarea").catch(() => null);
    if (ta) return;
    await page.waitForTimeout(1500);
  }
  throw new Error("jTraspaso: timeout. Verifica acceso a la red CARM.");
}

// ── Deteccion de formulario ───────────────────────────────────────────────

async function detectForm(page) {
  return page.evaluate(() => {
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
        label: (document.querySelector('label[for="' + c.id + '"]') || {}).textContent || ""
      }));
    const ta = document.querySelector("textarea");
    return {
      url: location.href, title: document.title,
      selects, buttons, checks,
      textarea: ta ? { id: ta.id, name: ta.name, rows: ta.rows } : null,
      taContent: ta ? ta.value.substring(0, 500) : "",
      links: Array.from(document.querySelectorAll("a"))
        .map(a => ({ text: a.textContent.trim().substring(0,80), href: a.href, id: a.id }))
        .filter(a => a.href && a.href.includes("jtraspaso.carm.es") && a.text)
        .slice(0, 30)
    };
  });
}

// ── Ejecucion de SQL ──────────────────────────────────────────────────────

/**
 * Ejecuta SQL en jTraspaso:
 * 1. Selecciona entorno OVCONTRI PRODUCCION
 * 2. Rellena textarea
 * 3. Pulsa Aceptar
 * 4. Espera y parsea resultado
 */
async function runQuery(sqlText, entorno) {
  const page = await getPage();
  await ensureJTraspaso(page);
  const form = await detectForm(page);

  // DEBUG: ver qué encontró detectForm
  console.log("[jTraspaso] detectForm:", JSON.stringify({
    taId:   form.textarea?.id,
    taName: form.textarea?.name,
    btnId:  form.buttons[0]?.id,
    btnVal: form.buttons[0]?.value,
    envId:  form.selects[0]?.id,
    envOpts: form.selects[0]?.options?.length
  }));

  // 1. Seleccionar entorno — usar [id="..."] para IDs con caracteres especiales
  const envTarget = entorno || "OVCONTRI PRODUCCION";
  const envSel = form.selects.find(s =>
    s.options.some(o => o.text.match(/PRODUCCION|ARECA|PASARELA|OVCONTRI/i))
  );
  if (envSel) {
    const match = envSel.options.find(o =>
      o.text.toUpperCase().includes(envTarget.toUpperCase()) ||
      o.value.toUpperCase().includes(envTarget.toUpperCase())
    );
    if (match) {
      // Usar [id="..."] en vez de #id para soportar IDs con ":" (JSF component IDs)
      const sel = envSel.id ? `[id="${envSel.id}"]` : `[name="${envSel.name}"]`;
      await page.selectOption(sel, match.value).catch(() => {});
    }
  }

  // 2. Rellenar textarea usando Playwright page.fill() (dispara eventos JSF correctamente)
  const ta = form.textarea;
  const taAttr = ta
    ? (ta.id   ? `[id="${ta.id}"]`   : `[name="${ta.name}"]`)
    : "textarea";
  try {
    await page.locator(taAttr).first().fill(sqlText);
    // JSF necesita blur para actualizar el modelo de servidor
    await page.locator(taAttr).first().evaluate(el => el.dispatchEvent(new Event("blur")));
  } catch (_) {
    // Fallback: setter nativo
    await page.evaluate(({ taId, taName, sql }) => {
      const el = taId ? document.getElementById(taId)
               : taName ? document.querySelector(`[name="${taName}"]`)
               : document.querySelector("textarea");
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(el, sql);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, { taId: ta?.id || null, taName: ta?.name || null, sql: sqlText });
  }
  await page.waitForTimeout(300);

  // 3. Pulsar Aceptar usando Playwright locator (dispara eventos JSF correctamente)
  const acceptBtn = form.buttons.find(b => /Aceptar|Ejecutar|Run/i.test(b.value));
  try {
    const btnAttr = acceptBtn?.id ? `[id="${acceptBtn.id}"]` : "input[type=submit]";
    await page.locator(btnAttr).first().click();
  } catch (_) {
    // Fallback
    await page.evaluate(id => {
      const el = id ? document.getElementById(id) : document.querySelector("input[type=submit]");
      if (el) el.click();
    }, acceptBtn?.id || null);
  }

  // 4. Esperar resultado de jTraspaso
  const prevContent = await page.evaluate(() => {
    const el = document.querySelector("[id*='salida'], [id*='output'], [id*='resultado'], textarea, pre");
    return el ? (el.innerText || el.value || "").substring(0, 100) : "";
  }).catch(() => "");

  await page.waitForFunction(
    (prev) => {
      const allEls = Array.from(document.querySelectorAll("textarea, div, td, pre, [id*='salida'], [id*='output'], [id*='resultado']"));
      const salidaEl = allEls.find(el => {
        const t = el.innerText || el.value || "";
        return t.includes("SQL*Plus:") || t.includes("Oracle Database") ||
               t.includes("IDDATOS") || t.includes("IDESTADO") || t.includes("CODSOLICITUD") ||
               t.includes("resultados") || t.includes("IDPAGO") || t.includes("IDEVENTO") ||
               t.includes("JSON_LEN") || t.includes("ORA-") || t.includes("no rows selected") ||
               t.includes("filas seleccionadas");
      });
      if (!salidaEl) return false;
      const cur = (salidaEl.innerText || salidaEl.value || "").substring(0, 100);
      return cur.length > 0 && cur !== prev;
    },
    prevContent,
    { timeout: 90000 }
  ).catch(() => {});
  await page.waitForTimeout(1500);

  return parseResult(page);
}

// ── Parseo de resultados ──────────────────────────────────────────────────

async function parseResult(page) {
  return page.evaluate(() => {
    const result = { rows: [], rawOutput: "", sections: {}, error: null };

    // 1. Extraer el texto de la zona "Salida" de jTraspaso
    const allEls = Array.from(document.querySelectorAll("textarea, div, td, pre, [id*='salida'], [id*='output'], [id*='resultado']"));
    const salidaEl = allEls.find(el => {
      const t = el.innerText || el.value || "";
      return t.includes("SQL*Plus:") || t.includes("Oracle Database") ||
             t.includes("IDDATOS") || t.includes("IDESTADO") || t.includes("CODSOLICITUD") ||
             t.includes("resultados") || t.includes("IDPAGO") || t.includes("IDEVENTO") ||
             t.includes("JSON_LEN");
    });
    const salidaText = salidaEl ? (salidaEl.innerText || salidaEl.value || "") : "";
    result.rawOutput = salidaText.substring(0, 80000) || (document.body.innerText || "").substring(0, 80000);

    // 2. Parsear secciones PROMPT (==== 2) REVISION SOLICITUD ====, etc.)
    const raw = result.rawOutput;
    const re  = /====\s*(.+?)\s*====/g;
    const positions = [];
    let m;
    while ((m = re.exec(raw)) !== null) {
      positions.push({ title: m[1].trim(), start: m.index, end: m.index + m[0].length });
    }
    for (let i = 0; i < positions.length; i++) {
      const start = positions[i].end;
      const end   = i + 1 < positions.length ? positions[i+1].start : raw.length;
      result.sections[positions[i].title] = raw.substring(start, end).trim();
    }

    // Helper para parsear un bloque de tabla delimitado por pipes
    function parsePipeText(text) {
      const parsedRows = [];
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      let currentHeaders = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.match(/^[-\s|]+$/)) continue; // línea separadora ----
        if (line.startsWith("==") || line.startsWith("SET ") || line.startsWith("PROMPT") || line.startsWith("DEFINE")) continue;
        if (line.toLowerCase().includes("selected") || line.toLowerCase().includes("seleccionada") || line.includes("rows selected")) continue;

        if (line.includes("|")) {
          const parts = line.split("|").map(p => p.trim());
          const looksLikeHeader = parts.filter(Boolean).length >= 2 &&
            parts.some(p => /^(IDDATOS|IDESTADO|DATOS|CODSOLICITUD|IDPAGO|IDDESCOESTADO|CODESTADO|NIF|IMPORTE|URLVUELTA|IDEVENTO|FECEVENTO|RESPUESTA|RESPUESTA_PREVIEW|CODFORM|FECALTA|OWNER|TABLE_NAME|COLUMN_NAME|CONSTRAINT_NAME)/i.test(p));

          if (looksLikeHeader) {
            currentHeaders = parts.filter(Boolean);
          } else if (currentHeaders) {
            const obj = {};
            currentHeaders.forEach((h, idx) => {
              obj[h.toUpperCase()] = parts[idx] !== undefined ? parts[idx] : "";
            });
            if (Object.values(obj).some(v => v !== "")) {
              parsedRows.push(obj);
            }
          }
        }
      }
      return parsedRows;
    }

    // Parsear cada sección o todo el texto
    if (Object.keys(result.sections).length > 0) {
      for (const [secTitle, secContent] of Object.entries(result.sections)) {
        const secRows = parsePipeText(secContent);
        result.rows.push(...secRows);
      }
    } else {
      result.rows = parsePipeText(raw);
    }

    // 4. Nº resultados desde el encabezado de jTraspaso
    const countMatch = raw.match(/(\d+)\s+resultados\s*-\s*P.gina\s*\d+\s*de\s*\d+/i);
    if (countMatch) result.totalRows = parseInt(countMatch[1]);

    const errEl = document.querySelector(".error, .errorMessage, .mensajeError");
    if (errEl) result.error = errEl.innerText.trim();

    return result;
  });
}

// ── SQL Templates ─────────────────────────────────────────────────────────

/**
 * SQL estandar de diagnostico (FASE 1).
 * Incluye CONFIG SQL*Plus, revision solicitud, pago, eventos y
 * respuesta del ULTIMO evento via subquery (no hay que actualizar manualmente).
 */
function buildDiagSQL(codsol, iddatos) {
  const iddat = iddatos || "0";
  return [
    "-- =========================",
    "-- CONFIG SQL*Plus",
    "-- =========================",
    "SET PAGESIZE 50000",
    "SET LINESIZE 32767",
    "SET LONG 2000000",
    "SET LONGCHUNKSIZE 32767",
    "SET TRIMSPOOL ON",
    "SET TAB OFF",
    "SET FEEDBACK ON",
    "SET VERIFY OFF",
    "SET HEADING ON",
    "SET COLSEP ' | '",
    "SET SERVEROUTPUT ON SIZE UNLIMITED",
    "",
    "DEFINE CODSOL = '" + codsol + "'",
    "DEFINE IDDATOS = " + iddat,
    "",
    "PROMPT ==== 2) REVISION SOLICITUD ====",
    "SELECT IDDATOS, IDESTADO, DATOS, CODSOLICITUD",
    "FROM PPFDATOS",
    "WHERE UPPER(CODSOLICITUD) = UPPER('&CODSOL');",
    "",
    "PROMPT ==== 3) REVISION PAGO ====",
    "SELECT IDPAGO, IDDESCOESTADO, CODESTADO, NIF, IMPORTE, URLVUELTA",
    "FROM PASAPAGO.PAGO",
    "WHERE URLVUELTA LIKE '%' || '&CODSOL' || '%';",
    "",
    "PROMPT ==== 4) REVISION EVENTOS ====",
    "SELECT IDEVENTO, FECEVENTO, SUBSTR(TO_CHAR(RESPUESTA),1,300) AS RESPUESTA_PREVIEW",
    "FROM PPFEVENTO",
    "WHERE UPPER(CODSOLICITUD) = UPPER('&CODSOL')",
    "ORDER BY FECEVENTO;",
    "",
    "PROMPT ==== 4b) RESPUESTA ULTIMO EVENTO ====",
    "SELECT TO_CHAR(RESPUESTA)",
    "FROM OVCONTRI.PPFEVENTO",
    "WHERE IDEVENTO = (",
    "  SELECT MAX(IDEVENTO)",
    "  FROM OVCONTRI.PPFEVENTO",
    "  WHERE UPPER(CODSOLICITUD) = UPPER('&CODSOL')",
    ");"
  ].join("\n");
}

/**
 * SQL extraccion CLOB DATOS completo (FASE 2).
 * Requiere IDDATOS conocido. Emite chunks terminados en ~ para reconstruccion.
 */
function buildClobSQL(codsol, iddatos) {
  return [
    "SET PAGESIZE 50000",
    "SET LINESIZE 32767",
    "SET LONG 2000000",
    "SET LONGCHUNKSIZE 32767",
    "SET TRIMSPOOL ON",
    "SET TAB OFF",
    "SET FEEDBACK OFF",
    "SET VERIFY OFF",
    "SET HEADING ON",
    "SET COLSEP ' | '",
    "SET SERVEROUTPUT ON SIZE UNLIMITED",
    "",
    "DEFINE CODSOL = '" + codsol + "'",
    "DEFINE IDDATOS = " + iddatos,
    "",
    "PROMPT ==== 5) EXTRACCION CLOB DATOS ====",
    "DECLARE",
    "    l_offset   NUMBER := 1;",
    "    l_chunk    NUMBER := 2000;",
    "    l_total    NUMBER;",
    "    l_clob     CLOB;",
    "    c_fin      CONSTANT VARCHAR2(1) := '~';",
    "BEGIN",
    "    SELECT datos",
    "      INTO l_clob",
    "      FROM ovcontri.ppfdatos",
    "     WHERE UPPER(codsolicitud) = UPPER('&CODSOL')",
    "       AND iddatos = TO_NUMBER('&IDDATOS');",
    "    l_total := DBMS_LOB.getlength(l_clob);",
    "    DBMS_OUTPUT.put_line('[[JSON_LEN=' || l_total || ']]');",
    "    WHILE l_offset <= l_total LOOP",
    "        DBMS_OUTPUT.put_line(DBMS_LOB.substr(l_clob, l_chunk, l_offset) || c_fin);",
    "        l_offset := l_offset + l_chunk;",
    "    END LOOP;",
    "EXCEPTION",
    "    WHEN NO_DATA_FOUND THEN",
    "        DBMS_OUTPUT.put_line('ERROR ::: No existe registro para CODSOL/IDDATOS');",
    "    WHEN OTHERS THEN",
    "        DBMS_OUTPUT.put_line('ERROR ::: ' || SQLERRM);",
    "END;",
    "/",
    "SET FEEDBACK ON"
  ].join("\n");
}

// ── SQL búsqueda por token (fallback cuando no hay CODSOL) ───────────────────

/**
 * Construye SQL para buscar CODSOLICITUD por DNI u otro token + fecha.
 * La fecha debe venir en formato MM/YY (ej: "08/26" para agosto 2026).
 */
function buildTokenSearchSQL(token, fechaMM_YY) {
  const lines = [
    "SET PAGESIZE 50000",
    "SET LINESIZE 32767",
    "SET LONG 2000000",
    "SET COLSEP ' | '",
    "SET FEEDBACK ON",
    "SET HEADING ON",
    "",
    "-- Búsqueda por token (DNI / matrícula) y fecha aproximada",
    "SELECT IDDATOS, CODSOLICITUD, IDESTADO, FECALTA",
    "FROM PPFDATOS",
    "WHERE DATOS LIKE '%" + token.replace(/'/g, "''") + "%'"
  ];
  if (fechaMM_YY) {
    lines.push("  AND FECALTA LIKE '%" + fechaMM_YY.replace(/'/g, "''") + "%'");
  }
  lines.push("ORDER BY FECALTA DESC;");
  return lines.join("\n");
}

// ── Diagnostico de alto nivel ─────────────────────────────────────────────

/**
 * diagnoseFull — acepta codsol directo O entidades del ticket para fallback.
 * @param {string}   codsol     CODSOL conocido (o null)
 * @param {Function} progress   callback (step, detail)
 * @param {object}   entities   { dnis, nies, matriculas, fecha } para fallback
 */
async function diagnoseFull(codsol, progress, entities) {
  progress = progress || (() => {});
  const out = {
    codsol,
    ppfdatos:   null,
    pago:       null,
    eventos:    [],
    clobRaw:    null,
    clobParsed: null,
    errors:     [],
    rawOutput:  "",
    tokenSearch: null   // resultado de búsqueda por token si no había CODSOL
  };

  // ── FASE 0: si no hay CODSOL, buscar por DNI/matrícula + fecha ───────────
  if (!codsol && entities) {
    const token = (entities.dnis && entities.dnis[0])
               || (entities.nies && entities.nies[0])
               || (entities.matriculas && entities.matriculas[0]);
    if (token) {
      // Convertir fecha ISO (2026-08-15) → "08/26" para el LIKE
      let fechaMM_YY = null;
      if (entities.fecha) {
        const parts = entities.fecha.split("-"); // [2026, 08, 15]
        if (parts.length === 3) {
          const yy = parts[0].slice(2); // "26"
          fechaMM_YY = parts[1] + "/" + yy; // "08/26"
        }
      }
      progress("token-search", `Buscando CODSOL por token: ${token}${fechaMM_YY ? " fecha: " + fechaMM_YY : ""}...`);
      try {
        const r0 = await runQuery(buildTokenSearchSQL(token, fechaMM_YY));
        out.rawOutput = r0.rawOutput;
        out.tokenSearch = r0.rows || [];
        // Tomar el primer CODSOLICITUD encontrado
        if (r0.rows && r0.rows.length > 0) {
          const first = r0.rows[0];
          const foundCodsol = first.CODSOLICITUD || first.codsolicitud;
          if (foundCodsol) {
            codsol = foundCodsol;
            out.codsol = codsol;
          }
        }
      } catch (e) {
        out.errors.push("Fase 0 (token search): " + e.message);
      }
    }
  }

  if (!codsol) {
    out.errors.push("Sin CODSOL: no se puede continuar el diagnóstico.");
    return out;
  }
  // FASE 1: revision general
  progress("sql1", "Ejecutando diagnostico inicial en jTraspaso...");
  let iddatos = null;
  try {
    const r1 = await runQuery(buildDiagSQL(codsol));
    out.rawOutput = r1.rawOutput;
    if (r1.error) out.errors.push(r1.error);

    // Buscar PPFDATOS en filas
    for (const row of (r1.rows || [])) {
      const keys = Object.keys(row).map(k => k.toUpperCase());
      if (keys.includes("IDDATOS") || (keys.includes("CODSOLICITUD") && !keys.includes("IDPAGO"))) {
        out.ppfdatos = row;
        iddatos = row.IDDATOS || row.iddatos;
        break;
      }
    }
    // Buscar PAGO
    for (const row of (r1.rows || [])) {
      const keys = Object.keys(row).map(k => k.toUpperCase());
      if (keys.includes("IDPAGO") || keys.includes("CODESTADO") || keys.includes("IDDESCOESTADO")) {
        out.pago = row;
        break;
      }
    }
    // Eventos
    out.eventos = (r1.rows || []).filter(row => {
      const keys = Object.keys(row).map(k => k.toUpperCase());
      return keys.includes("IDEVENTO") || keys.includes("FECEVENTO");
    });

    // Fallback: extraer IDDATOS del texto si no hay filas
    if (!iddatos && r1.rawOutput) {
      const m = r1.rawOutput.match(/\b(\d{7,9})\b/);
      if (m) iddatos = m[1];
    }
  } catch (e) {
    out.errors.push("Fase 1: " + e.message);
  }

  // FASE 2: extraccion CLOB
  if (iddatos && iddatos !== "0") {
    progress("clob", "Extrayendo CLOB DATOS (IDDATOS=" + iddatos + ")...");
    try {
      const r2 = await runQuery(buildClobSQL(codsol, iddatos));
      out.rawOutput += "\n\n--- CLOB ---\n" + r2.rawOutput;

      // Reconstruir CLOB desde chunks terminados en ~
      const clobStr = r2.rawOutput
        .split("~")
        .map(s => s.trim())
        .filter(s => s && !s.startsWith("[[") && !s.startsWith("SET ") && !s.startsWith("DECLARE"))
        .join("");
      out.clobRaw = clobStr;

      if (clobStr) {
        try {
          const start = clobStr.indexOf("{");
          const end   = clobStr.lastIndexOf("}");
          if (start >= 0 && end > start) {
            out.clobParsed = JSON.parse(clobStr.substring(start, end + 1));
          }
        } catch (_) {
          out.clobParsed = { _raw: clobStr.substring(0, 5000) };
        }
      }
    } catch (e) {
      out.errors.push("Fase 2 CLOB: " + e.message);
    }
  }

  return out;
}

module.exports = {
  getPage,
  closeContext,
  ensureJTraspaso,
  detectForm,
  runQuery,
  diagnoseFull,
  buildDiagSQL,
  buildClobSQL,
  buildTokenSearchSQL,
  parseResult
};





