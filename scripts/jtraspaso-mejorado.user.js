// ==UserScript==
// @name         jTraspaso - interfaz mejorada
// @namespace    soporte-incidencias-live
// @version      2.0.0
// @description  Mejora la lectura y el uso del formulario SQLPlus de jTraspaso: layout completo + reconstrucción/formateo de CLOBs (JSON_LEN/EVT_LEN) y resaltado de errores ORA.
// @match        https://jtraspaso.carm.es/jTraspaso/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const STYLE_ID = "soporte-jtraspaso-style";
  const PANEL_ID = "soporte-jtraspaso-panel";

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      :root {
        --st-bg: #f3f6fa;
        --st-card: #ffffff;
        --st-border: #d8e0ea;
        --st-text: #1f2937;
        --st-muted: #64748b;
        --st-primary: #155eef;
        --st-primary-dark: #0b3b9e;
        --st-code: #111827;
      }
      body {
        background: var(--st-bg) !important;
        color: var(--st-text) !important;
        font-family: "Segoe UI", Arial, sans-serif !important;
        margin: 0 !important;
      }
      #st-header {
        background: linear-gradient(120deg, #0f2d59, #155eef);
        color: #fff;
        padding: 22px clamp(20px, 5vw, 70px);
        box-shadow: 0 2px 10px #0f2d5938;
      }
      #st-header h1 { margin: 0 0 5px; font-size: 25px; }
      #st-header p { margin: 0; opacity: .86; }
      #st-layout {
        display: block;
        max-width: 1500px;
        margin: 24px auto;
        padding: 0 20px;
      }
      #st-main {
        background: var(--st-card);
        border: 1px solid var(--st-border);
        border-radius: 12px;
        box-shadow: 0 4px 15px #33415512;
        padding: 20px;
        min-width: 0;
      }
      /* Botón flotante para abrir/cerrar la ayuda rápida (no ocupa columna propia) */
      #st-help-toggle {
        position: fixed;
        top: 18px;
        right: 18px;
        z-index: 1001;
        width: 42px;
        height: 42px;
        border-radius: 50%;
        border: none;
        background: var(--st-primary);
        color: #fff;
        font-size: 18px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 4px 12px #0f2d5945;
      }
      #st-help-toggle:hover { background: var(--st-primary-dark); }
      #${PANEL_ID} {
        position: fixed;
        top: 0;
        right: 0;
        height: 100vh;
        width: min(340px, 90vw);
        overflow-y: auto;
        background: var(--st-card);
        border-left: 1px solid var(--st-border);
        box-shadow: -6px 0 20px #33415524;
        padding: 20px;
        box-sizing: border-box;
        z-index: 1000;
        transform: translateX(100%);
        transition: transform .2s ease;
      }
      #${PANEL_ID}.st-open { transform: translateX(0); }
      #${PANEL_ID} #st-help-close {
        position: absolute; top: 12px; right: 12px;
        background: transparent; border: none; color: var(--st-muted);
        font-size: 20px; line-height: 1; cursor: pointer; padding: 4px 8px;
      }
      #${PANEL_ID} #st-help-close:hover { color: var(--st-text); }
      #st-main > h1, #st-main > h2, #st-main > h3,
      #st-main .title, #st-main .sectionTitle {
        color: #0f2d59 !important;
        border-bottom: 1px solid var(--st-border);
        padding-bottom: 8px;
      }
      #st-main textarea {
        width: 100% !important;
        box-sizing: border-box !important;
        padding: 14px !important;
        border: 1px solid #aebdce !important;
        border-radius: 8px !important;
        background: var(--st-code) !important;
        color: #e5edf8 !important;
        font: 13px/1.5 Consolas, "Courier New", monospace !important;
        resize: vertical !important;
      }
      /* Solo el textarea de la sentencia SQL necesita altura grande */
      #st-main textarea#trassqlplus\:sql {
        min-height: 430px !important;
      }
      /* El campo "Comentario" no se usa en el flujo de diagnóstico: pequeño y discreto */
      #st-main textarea#trassqlplus\:comentario {
        min-height: 60px !important;
        opacity: .6 !important;
      }
      #st-main select, #st-main input:not([type="submit"]):not([type="button"]) {
        border: 1px solid #aebdce !important;
        border-radius: 6px !important;
        padding: 8px !important;
        max-width: 100%;
      }
      #st-main input[type="submit"], #st-main input[type="button"],
      #st-main button {
        background: var(--st-primary) !important;
        border: 0 !important;
        border-radius: 6px !important;
        color: #fff !important;
        cursor: pointer !important;
        font-weight: 600 !important;
        padding: 9px 14px !important;
        margin: 4px 4px 4px 0 !important;
      }
      #st-main input[type="submit"]:hover, #st-main input[type="button"]:hover,
      #st-main button:hover { background: var(--st-primary-dark) !important; }
      #st-main table {
        border-collapse: collapse !important;
        width: 100% !important;
        background: #fff !important;
        margin: 12px 0 !important;
      }
      #st-main th {
        background: #e8f0ff !important;
        color: #0f2d59 !important;
        text-align: left !important;
      }
      #st-main th, #st-main td {
        border: 1px solid var(--st-border) !important;
        padding: 8px !important;
        vertical-align: top !important;
      }
      #st-main tr:nth-child(even) { background: #f8fafc !important; }
      #${PANEL_ID} h2 { color: #0f2d59; font-size: 18px; margin: 0 0 14px; }
      #${PANEL_ID} h3 { color: #334155; font-size: 14px; margin: 18px 0 7px; }
      #${PANEL_ID} ul { padding-left: 18px; margin: 7px 0; }
      #${PANEL_ID} li { margin: 5px 0; color: var(--st-muted); }
      #${PANEL_ID} .st-badge {
        display: inline-block; background: #e8f0ff; color: #0b3b9e;
        border-radius: 999px; font-size: 12px; font-weight: 600; padding: 4px 9px;
      }
      #${PANEL_ID} button {
        background: var(--st-primary); border: 0; border-radius: 6px;
        color: #fff; cursor: pointer; padding: 8px 11px; font-weight: 600;
      }
      #${PANEL_ID} button:hover { background: var(--st-primary-dark); }
      /* Formateo de resultados JSON / CLOB reconstruido */
      #st-main td.atrm-json pre,
      .atrm-clob-resultado pre {
        width: 100% !important;
        max-height: 500px !important;
        margin: 0 !important;
        padding: 12px !important;
        box-sizing: border-box !important;
        overflow: auto !important;
        background: #17202b !important;
        color: #e5edf5 !important;
        border-radius: 5px !important;
        white-space: pre-wrap !important;
        word-break: break-word !important;
        font: 13px/1.5 Consolas, Monaco, monospace !important;
      }
      /* Celdas JSON en tablas normales: colapsadas por defecto detrás de <details> */
      #st-main td.atrm-json details {
        width: 100%;
      }
      #st-main td.atrm-json summary {
        cursor: pointer;
        font-weight: 600;
        color: var(--st-primary-dark);
        padding: 4px 0;
        list-style: none;
      }
      #st-main td.atrm-json summary::-webkit-details-marker { display: none; }
      #st-main td.atrm-json summary::before { content: "▶ "; }
      #st-main td.atrm-json details[open] summary::before { content: "▼ "; }
      #st-main td.atrm-json summary:hover { text-decoration: underline; }
      .atrm-clob-resultado {
        display: block !important;
        margin: 14px 0 !important;
        padding: 10px !important;
        border: 1px solid #cbd5e1 !important;
        border-radius: 8px !important;
        background: #fff !important;
      }
      .atrm-clob-resultado summary {
        padding: 8px !important;
        cursor: pointer !important;
        font-weight: 600 !important;
        background: #eef4f9 !important;
      }
      .atrm-clob-error { border-color: #f2b8b5 !important; background: #fdf2f2 !important; }
      .atrm-clob-error summary { background: #fbe4e2 !important; color: #b42318 !important; }
      /* Botón para desplegar/ocultar los campos SQL y Comentario tras ver resultados */
      .atrm-toggle-campo {
        display: inline-block;
        margin-top: 6px !important;
        font-size: 12px !important;
        padding: 4px 8px !important;
        background: #eef4f9 !important;
        color: #0b3b9e !important;
        border: 1px solid var(--st-border) !important;
      }
      .atrm-toggle-campo:hover { background: #dfeaf7 !important; }
    `;
    document.head.appendChild(style);
  }

  function makeLayout() {
    if (document.getElementById("st-layout")) return;

    const header = document.createElement("header");
    header.id = "st-header";
    header.innerHTML = "<h1>jTraspaso SQLPlus</h1><p>Consulta y revisión de solicitudes</p>";

    const layout = document.createElement("div");
    layout.id = "st-layout";
    const main = document.createElement("main");
    main.id = "st-main";

    // Panel de ayuda: cajón lateral oculto por defecto, no reserva espacio en el layout
    const panel = document.createElement("aside");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <button type="button" id="st-help-close" title="Cerrar">✕</button>
      <h2>Ayuda rápida</h2>
      <span class="st-badge">Modo consulta</span>
      <h3>Flujo recomendado</h3>
      <ul>
        <li>Selecciona el entorno correcto.</li>
        <li>Pega la plantilla SQL y sustituye los parámetros.</li>
        <li>Revisa la salida antes de copiar evidencias.</li>
        <li>No compartas datos personales fuera del canal autorizado.</li>
      </ul>
      <h3>Acciones</h3>
      <button type="button" id="st-copy-output">Copiar salida visible</button>
    `;

    const helpToggle = document.createElement("button");
    helpToggle.type = "button";
    helpToggle.id = "st-help-toggle";
    helpToggle.title = "Ayuda rápida";
    helpToggle.textContent = "?";

    while (document.body.firstChild) main.appendChild(document.body.firstChild);
    layout.append(main);
    document.body.append(header, layout, panel, helpToggle);

    helpToggle.addEventListener("click", () => panel.classList.toggle("st-open"));
    document.getElementById("st-help-close").addEventListener("click", () => panel.classList.remove("st-open"));

    document.getElementById("st-copy-output").addEventListener("click", async function () {
      const text = document.getElementById("st-main").innerText;
      try {
        await navigator.clipboard.writeText(text);
        this.textContent = "Salida copiada";
        setTimeout(() => { this.textContent = "Copiar salida visible"; }, 1800);
      } catch (error) {
        this.textContent = "No se pudo copiar";
        console.warn("jTraspaso: no se pudo usar el portapapeles", error);
      }
    });
  }

  // ── Formateo de resultados: JSON en tablas + reconstrucción de CLOBs ────────
  // Reconoce ambos marcadores emitidos por el SQL estándar de diagnóstico:
  //   [[JSON_LEN=... IDDATOS=...]]  -> CLOB DATOS (PPFDATOS.DATOS)
  //   [[EVT_LEN=...  IDEVENTO=...]] -> CLOB RESPUESTA del último evento (PPFEVENTO.RESPUESTA)
  // Los chunks van terminados en '~' y se reconstruyen concatenándolos.

  function limpiarTexto(texto) {
    return String(texto || "").replace(/~/g, "").replace(/\r/g, "").replace(/\n/g, "");
  }

  function parsearJSON(texto) {
    try { return JSON.parse(texto); } catch (e) { return null; }
  }

  function pareceJSON(texto) {
    const valor = String(texto || "").trim();
    return (valor.startsWith("{") && valor.endsWith("}")) ||
           (valor.startsWith("[") && valor.endsWith("]"));
  }

  function normalizarJSON(valor, profundidad = 0) {
    if (profundidad > 12) return valor;
    if (typeof valor === "string") {
      const texto = limpiarTexto(valor).trim();
      if (pareceJSON(texto)) {
        const anidado = parsearJSON(texto);
        if (anidado !== null) return normalizarJSON(anidado, profundidad + 1);
      }
      return valor;
    }
    if (Array.isArray(valor)) return valor.map(el => normalizarJSON(el, profundidad + 1));
    if (valor && typeof valor === "object") {
      const resultado = {};
      for (const [clave, val] of Object.entries(valor)) resultado[clave] = normalizarJSON(val, profundidad + 1);
      return resultado;
    }
    return valor;
  }

  // Extrae el primer objeto {...} balanceando llaves, tolerando strings escapadas
  function extraerObjeto(texto) {
    const inicio = texto.indexOf("{");
    if (inicio === -1) return null;
    let nivel = 0, dentroString = false, escapado = false;
    for (let i = inicio; i < texto.length; i++) {
      const c = texto[i];
      if (dentroString) {
        if (escapado) escapado = false;
        else if (c === "\\") escapado = true;
        else if (c === "\"") dentroString = false;
        continue;
      }
      if (c === "\"") dentroString = true;
      else if (c === "{") nivel++;
      else if (c === "}") { nivel--; if (nivel === 0) return texto.slice(inicio, i + 1); }
    }
    return null;
  }

  // Detecta si el bloque corresponde a un ORA-XXXXX para no intentar parsearlo como JSON
  function esErrorOracle(texto) {
    return /ORA-\d{5}/.test(texto) || texto.includes("ERROR :::");
  }

  function procesarBloqueClob(contenido, marcador, titulo) {
    const parrafo = [...contenido.querySelectorAll("p, pre")]
      .find(p => p.textContent.includes(`[[${marcador}=`));
    if (!parrafo) return;

    const texto = limpiarTexto(parrafo.textContent);
    const posicionMarca = texto.indexOf("]]");
    const despuesDeMarca = texto.slice(posicionMarca + 2);

    if (esErrorOracle(despuesDeMarca) || esErrorOracle(texto)) {
      const visorErr = document.createElement("details");
      visorErr.className = "atrm-clob-resultado atrm-clob-error";
      visorErr.open = true;
      const t = document.createElement("summary");
      t.textContent = `⚠️ Error Oracle en bloque ${titulo}`;
      const pre = document.createElement("pre");
      pre.textContent = texto;
      visorErr.append(t, pre);
      parrafo.replaceWith(visorErr);
      return;
    }

    const candidato = extraerObjeto(despuesDeMarca);
    const objeto = candidato ? parsearJSON(candidato) : null;

    const visor = document.createElement("details");
    visor.className = "atrm-clob-resultado";
    visor.open = true;
    const t = document.createElement("summary");
    t.textContent = titulo;
    const pre = document.createElement("pre");
    pre.textContent = objeto !== null
      ? JSON.stringify(normalizarJSON(objeto), null, 2)
      : despuesDeMarca.trim().substring(0, 20000) + " (sin JSON detectado, texto crudo)";
    visor.append(t, pre);
    parrafo.replaceWith(visor);
  }

  function formatearResultados() {
    const contenido = document.getElementById("trassqlplus:salida");
    if (!contenido) return;

    // Evitar reprocesar si ya se formateó esta salida
    if (contenido.dataset.atrmFormateado === "1") return;
    contenido.dataset.atrmFormateado = "1";

    // Solo tiene sentido colapsar SQL/Comentario si ya hay una salida real (no en la carga inicial)
    const haySalida = contenido.textContent.trim().length > 0;

    // JSON en celdas de tablas normales (columnas CLOB cortas, previews, etc.)
    // Se envuelve en <details> colapsado cuando el contenido es largo, para no inundar la tabla.
    const UMBRAL_COLAPSO = 400;
    contenido.querySelectorAll("td").forEach(td => {
      const texto = limpiarTexto(td.textContent).trim();
      if (!pareceJSON(texto) || esErrorOracle(texto)) return;
      const valor = parsearJSON(texto);
      if (valor === null) return;
      const formateado = JSON.stringify(normalizarJSON(valor), null, 2);
      const pre = document.createElement("pre");
      pre.textContent = formateado;

      if (formateado.length > UMBRAL_COLAPSO) {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = `Ver JSON (${formateado.length} caracteres)`;
        details.append(summary, pre);
        td.replaceChildren(details);
      } else {
        td.replaceChildren(pre);
      }
      td.classList.add("atrm-json");
    });

    procesarBloqueClob(contenido, "JSON_LEN", "JSON DATOS extraído del CLOB (PPFDATOS.DATOS)");
    procesarBloqueClob(contenido, "EVT_LEN", "JSON RESPUESTA extraído del CLOB (PPFEVENTO.RESPUESTA, último evento)");

    colapsarCamposEntrada(haySalida);

    console.log("ATRM: tablas conservadas, bloques JSON_LEN/EVT_LEN formateados, errores ORA resaltados.");
  }

  // ── Colapsar SQL/Comentario cuando ya hay resultados, para dar espacio a la Salida ──
  function colapsarCamposEntrada(colapsarPorDefecto) {
    const filaSQL = document.getElementById("trassqlplus:lsql")?.closest("tr");
    const filaComentario = [...document.querySelectorAll("tr")]
      .find(tr => tr.querySelector('span.label')?.textContent.trim() === "Comentario");

    [filaSQL, filaComentario].forEach(fila => {
      if (!fila || fila.dataset.atrmColapsable === "1") return;
      fila.dataset.atrmColapsable = "1";

      const etiquetaTd = fila.children[0];
      const contenidoTd = fila.children[1];
      if (!etiquetaTd || !contenidoTd) return;

      const boton = document.createElement("button");
      boton.type = "button";
      boton.className = "atrm-toggle-campo";
      boton.title = "Mostrar/ocultar este campo";
      etiquetaTd.appendChild(boton);

      contenidoTd.style.display = colapsarPorDefecto ? "none" : "";
      boton.textContent = colapsarPorDefecto ? "▶ Mostrar" : "▼ Ocultar";

      boton.addEventListener("click", () => {
        const oculto = contenidoTd.style.display === "none";
        contenidoTd.style.display = oculto ? "" : "none";
        boton.textContent = oculto ? "▼ Ocultar" : "▶ Mostrar";
      });
    });
  }

  addStyles();
  makeLayout();
  formatearResultados();
})();
