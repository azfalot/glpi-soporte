// ==UserScript==
// @name         jTraspaso - interfaz mejorada
// @namespace    soporte-incidencias-live
// @version      2.2.0
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
        --st-bg: #0d1117;
        --st-card: #151b23;
        --st-border: #2d3540;
        --st-text: #d7e0ea;
        --st-muted: #8b98a8;
        --st-primary: #2f81f7;
        --st-primary-dark: #1f5fc0;
        --st-code: #0a0e14;
      }
      html, body {
        background: var(--st-bg) !important;
        color: var(--st-text) !important;
        font-family: "Segoe UI", Arial, sans-serif !important;
        margin: 0 !important;
        height: 100%;
      }
      /* Cabecera propia eliminada: jTraspaso ya trae su propio titulo (informacionAplicacion) */
      #st-layout {
        display: flex;
        flex-direction: column;
        margin: 0;
        padding: 0 10px;
        min-height: 100vh;
        box-sizing: border-box;
      }
      #st-main {
        background: var(--st-card);
        border: 1px solid var(--st-border);
        padding: 6px;
        min-width: 0;
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      /* El maquetado original de jTraspaso (escudo, menus superiores, tablas de
         layout vacias) aporta poco en modo diagnostico: se reduce/oculta */
      #st-main img[src*="logo_javato"],
      #st-main img[src*="favicon"],
      #st-main a[href*="IDCONTENIDO"] {
        display: none !important;
      }
      /* Todo lo que hay por encima de "Entorno" (logo+titulo, reloj de sesion, indicador de sesion
         (panelReloj), aviso de sesion caducada, menu de pestañas, icono info + aviso de "peticion
         realizada correctamente", titulo "Traspaso BBDD") no aporta nada en modo diagnostico: se
         oculta entero, solo queda visible desde Entorno hacia abajo. */
      #st-main table.header.informacionAplicacion,
      #st-main table#url.relojSesion,
      #st-main table#panelReloj.relojSesion,
      #st-main table#sessionTimeoutMessageId,
      #st-main table.BarraMenu,
      #st-main ul#trassqlplus\:mensajeError {
        display: none !important;
      }
      #st-main table[width="0%"] {
        width: 100% !important;
      }
      /* La tabla de salida SQL viene con width="90%" inline y centrada: forzamos 100% */
      #st-main table[summary="Script output"] {
        width: max-content !important;
        min-width: 100% !important;
        margin: 4px 0 !important;
      }
      fieldset {
        margin: 0 !important;
        padding: 4px !important;
        border: none !important;
      }
      legend { font-size: 12px !important; color: var(--st-muted) !important; }
      #st-main fieldset > legend[data-atrm-colapsable="1"] {
        background: var(--st-code);
        border: 1px solid var(--st-border);
        border-radius: 4px;
        padding: 3px 8px !important;
        margin-bottom: 4px;
      }
      /* La Salida se saca del flujo de la tabla nativa (ver moverSalidaAFullscreen) y pasa a formar
         parte de la página normal, ocupando todo el espacio vertical restante (sin marco/ventana
         flotante propia: es una sección más, fundida con el resto de la página). */
      #st-salida-panel {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
      }
      #st-salida-panel .st-salida-cabecera {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 0 0 auto;
        padding-bottom: 6px;
        border-bottom: 1px solid var(--st-border);
        margin-bottom: 6px;
      }
      #st-salida-panel .st-salida-cabecera strong { color: var(--st-text); font-size: 13px; }
      /* El formulario (Entorno + botones + SQL colapsable) se queda en su sitio natural, arriba,
         compacto; no se reparenta. La Salida ocupa todo el espacio restante debajo. */
      #st-main #mainFormContainer {
        flex: 0 0 auto;
        margin: 0 !important;
      }
      /* jTraspaso reserva 300px fijos con .formulario-container (min-height, para el spinner de
         carga nativo). Al plegar "Traspaso BBDD" ese hueco se queda vacío: se anula el mínimo. */
      #st-main .formulario-container {
        min-height: 0 !important;
      }
      #st-salida-panel span#trassqlplus\:salida {
        display: block;
        flex: 1 1 auto;
        min-height: 0;
        width: 100%;
        max-width: none !important;
        height: auto !important;
        overflow: auto !important;
        background: transparent !important;
      }
      /* Compactar filas de metadatos (Entorno, tipo, checkboxes) para no perder alto */
      #st-main tr td { line-height: 1.25; }
      #st-main table td[class="label"],
      #st-main table td.label {
        padding: 2px 6px !important;
        white-space: nowrap;
        color: var(--st-muted) !important;
      }
      /* Botón flotante para abrir/cerrar la ayuda rápida (no ocupa columna propia) */
      #st-help-toggle {
        position: fixed;
        top: 12px;
        right: 12px;
        z-index: 1001;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border: none;
        background: var(--st-primary);
        color: #fff;
        font-size: 16px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 4px 12px #00000066;
      }
      #st-help-toggle:hover { background: var(--st-primary-dark); }
      /* Botón flotante para recuperar la última salida guardada sin reejecutar la consulta */
      #st-restaurar-toggle {
        position: fixed;
        top: 12px;
        right: 58px;
        z-index: 1001;
        height: 36px;
        padding: 0 12px;
        border-radius: 18px;
        border: none;
        background: #1c2530;
        color: #7db7ff;
        border: 1px solid var(--st-border);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 4px 12px #00000066;
      }
      #st-restaurar-toggle:hover { background: #26313f; }
      #${PANEL_ID} {
        position: fixed;
        top: 0;
        right: 0;
        height: 100vh;
        width: min(340px, 90vw);
        overflow-y: auto;
        background: var(--st-card);
        border-left: 1px solid var(--st-border);
        box-shadow: -6px 0 20px #00000066;
        padding: 20px;
        box-sizing: border-box;
        z-index: 1000;
        transform: translateX(100%);
        transition: transform .2s ease;
        color: var(--st-text);
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
        color: var(--st-text) !important;
        border-bottom: 1px solid var(--st-border);
        padding-bottom: 4px;
      }
      #st-main textarea {
        width: 100% !important;
        box-sizing: border-box !important;
        padding: 14px !important;
        border: 1px solid var(--st-border) !important;
        border-radius: 8px !important;
        background: var(--st-code) !important;
        color: #e5edf8 !important;
        font: 13px/1.5 Consolas, "Courier New", monospace !important;
        resize: vertical !important;
      }
      /* Solo el textarea de la sentencia SQL necesita altura grande, y solo si esta desplegado */
      #st-main textarea#trassqlplus\:sql {
        min-height: 380px !important;
      }
      /* El campo "Comentario" no se usa en el flujo de diagnóstico: casi invisible */
      #st-main textarea#trassqlplus\:comentario {
        min-height: 34px !important;
        opacity: .45 !important;
      }
      #st-main select, #st-main input:not([type="submit"]):not([type="button"]) {
        border: 1px solid var(--st-border) !important;
        border-radius: 6px !important;
        padding: 6px !important;
        max-width: 100%;
        background: var(--st-code) !important;
        color: var(--st-text) !important;
      }
      #st-main input[type="submit"], #st-main input[type="button"],
      #st-main button {
        background: var(--st-primary) !important;
        border: 0 !important;
        border-radius: 6px !important;
        color: #fff !important;
        cursor: pointer !important;
        font-weight: 600 !important;
        padding: 7px 12px !important;
        margin: 2px 4px 2px 0 !important;
      }
      #st-main input[type="submit"]:hover, #st-main input[type="button"]:hover,
      #st-main button:hover { background: var(--st-primary-dark) !important; }
      #st-main table {
        border-collapse: collapse !important;
        background: var(--st-card) !important;
        margin: 4px 0 !important;
      }
      #st-main th {
        background: #1c2530 !important;
        color: var(--st-text) !important;
        text-align: left !important;
        position: sticky;
        top: 0;
      }
      #st-main th, #st-main td {
        border: 1px solid var(--st-border) !important;
        padding: 6px !important;
        vertical-align: top !important;
        color: var(--st-text) !important;
      }
      #st-main tr:nth-child(even) td { background: #11161d !important; }
      #st-main pre { color: var(--st-text) !important; }
      #${PANEL_ID} h2 { color: var(--st-text); font-size: 18px; margin: 0 0 14px; }
      #${PANEL_ID} h3 { color: var(--st-muted); font-size: 14px; margin: 18px 0 7px; }
      #${PANEL_ID} ul { padding-left: 18px; margin: 7px 0; }
      #${PANEL_ID} li { margin: 5px 0; color: var(--st-muted); }
      #${PANEL_ID} .st-badge {
        display: inline-block; background: #16324f; color: #7db7ff;
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
        max-height: 600px !important;
        margin: 0 !important;
        padding: 12px !important;
        box-sizing: border-box !important;
        overflow: auto !important;
        background: #05070a !important;
        color: #d7e0ea !important;
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
        color: #7db7ff;
        padding: 4px 0;
        list-style: none;
      }
      #st-main td.atrm-json summary::-webkit-details-marker { display: none; }
      #st-main td.atrm-json summary::before { content: "▶ "; }
      #st-main td.atrm-json details[open] summary::before { content: "▼ "; }
      #st-main td.atrm-json summary:hover { text-decoration: underline; }
      /* Resaltado de líneas dentro de la Salida cruda (ver resaltarSalida) */
      .atrm-linea-error { color: #ff6b6b; font-weight: 700; }
      .atrm-linea-seccion { color: #58a6ff; font-weight: 700; }
      .atrm-linea-ok { color: #3fb950; }
      .atrm-linea-info { color: #d29922; }
      .atrm-clob-resultado {
        display: block !important;
        margin: 10px 0 !important;
        padding: 8px !important;
        border: 1px solid var(--st-border) !important;
        border-radius: 8px !important;
        background: var(--st-card) !important;
      }
      .atrm-clob-resultado summary {
        padding: 8px !important;
        cursor: pointer !important;
        font-weight: 600 !important;
        background: #1c2530 !important;
        color: var(--st-text) !important;
      }
      .atrm-clob-error { border-color: #7a2b28 !important; background: #2a1414 !important; }
      .atrm-clob-error summary { background: #3a1a18 !important; color: #ff8a80 !important; }
      /* Botón para desplegar/ocultar los campos SQL y Comentario tras ver resultados */
      .atrm-toggle-campo {
        display: inline-block;
        margin-top: 4px !important;
        font-size: 11px !important;
        padding: 3px 7px !important;
        background: #1c2530 !important;
        color: #7db7ff !important;
        border: 1px solid var(--st-border) !important;
      }
      .atrm-toggle-campo:hover { background: #26313f !important; }
    `;
    document.head.appendChild(style);
  }

  function makeLayout() {
    if (document.getElementById("st-layout")) return;

    // No se crea cabecera propia: jTraspaso ya trae su titulo nativo
    // (tabla "informacionAplicacion") dentro del contenido movido a #st-main.
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

    const restaurarToggle = document.createElement("button");
    restaurarToggle.type = "button";
    restaurarToggle.id = "st-restaurar-toggle";
    restaurarToggle.title = "Recuperar la última salida guardada sin volver a ejecutar la consulta";
    restaurarToggle.textContent = "↺ Restaurar salida";

    while (document.body.firstChild) main.appendChild(document.body.firstChild);
    layout.append(main);
    document.body.append(layout, panel, helpToggle, restaurarToggle);

    helpToggle.addEventListener("click", () => panel.classList.toggle("st-open"));
    document.getElementById("st-help-close").addEventListener("click", () => panel.classList.remove("st-open"));
    restaurarToggle.addEventListener("click", restaurarUltimaSalida);

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

    const formateado = objeto !== null
      ? JSON.stringify(normalizarJSON(objeto), null, 2)
      : despuesDeMarca.trim().substring(0, 20000) + " (sin JSON detectado, texto crudo)";

    const visor = document.createElement("details");
    visor.className = "atrm-clob-resultado";
    visor.open = false; // colapsado por defecto: son bloques muy grandes (decenas/cientos de KB)
    const t = document.createElement("summary");
    t.textContent = `${titulo} (${formateado.length} caracteres)`;
    const pre = document.createElement("pre");
    pre.textContent = formateado;
    visor.append(t, pre);
    parrafo.replaceWith(visor);
  }

  const STORAGE_KEY = "atrm-jtraspaso-ultima-salida";
  const DB_NAME = "atrm-jtraspaso";
  const DB_STORE = "salidas";

  // IndexedDB en vez de localStorage: la Salida puede superar fácilmente los ~5MB de cuota de
  // localStorage (un solo bloque CLOB ya puede rondar 150-200KB de texto formateado, y puede haber
  // varios), por lo que localStorage fallaba en silencio y "Restaurar salida" no encontraba nada.
  function abrirDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function guardarSalida(datos) {
    const db = await abrirDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(datos, STORAGE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function leerSalidaGuardada() {
    const db = await abrirDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).get(STORAGE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  // ── Resalta con color líneas reconocibles del texto crudo de SQL*Plus (cabeceras de sección,
  // errores ORA, filas seleccionadas) para facilitar la lectura visual rápida de la Salida. ──
  function resaltarSalida(contenido) {
    contenido.querySelectorAll("pre").forEach(pre => {
      if (pre.dataset.atrmResaltado === "1") return;
      // No tocar los <pre> ya generados por nosotros mismos (JSON formateado dentro de <details>)
      if (pre.closest("details.atrm-clob-resultado, details.atrm-json, td.atrm-json")) return;
      pre.dataset.atrmResaltado = "1";

      const lineas = pre.textContent.split("\n");
      pre.textContent = "";
      lineas.forEach((linea, indice) => {
        const span = document.createElement("span");
        span.textContent = linea;
        if (/ORA-\d{5}/.test(linea) || linea.includes("ERROR :::")) {
          span.className = "atrm-linea-error";
        } else if (/^====\s*\d+\)/.test(linea.trim())) {
          span.className = "atrm-linea-seccion";
        } else if (/petición se ha realizado correctamente/i.test(linea)) {
          span.className = "atrm-linea-ok";
        } else if (/\d+\s+filas?\s+seleccionadas?\./i.test(linea.trim())) {
          span.className = "atrm-linea-info";
        }
        pre.appendChild(span);
        if (indice < lineas.length - 1) pre.appendChild(document.createTextNode("\n"));
      });
    });
  }

  function formatearResultados() {
    const contenido = document.getElementById("trassqlplus:salida");
    if (!contenido) return;

    // Evitar reprocesar si ya se formateó esta salida
    if (contenido.dataset.atrmFormateado === "1") return;

    // Guarda el HTML crudo (antes de formatear) para poder restaurarlo tras recargar la página,
    // sin tener que volver a pulsar "Aceptar" ni reejecutar la consulta SQL.
    const haySalidaReal = contenido.textContent.trim().length > 0;
    if (haySalidaReal && contenido.dataset.atrmRestaurado !== "1") {
      const sqlActual = document.getElementById("trassqlplus:sql")?.value || "";
      guardarSalida({
        html: contenido.innerHTML,
        sql: sqlActual,
        guardadoEn: new Date().toISOString(),
      }).catch(error => {
        console.warn("ATRM: no se pudo guardar la salida para restaurar más tarde.", error);
      });
    }

    contenido.dataset.atrmFormateado = "1";

    // JSON en celdas de tablas normales (columnas CLOB cortas, previews, etc.)
    // TODO JSON detectado se envuelve en <details> colapsado por defecto con boton para desplegar.
    contenido.querySelectorAll("td").forEach(td => {
      const texto = limpiarTexto(td.textContent).trim();
      if (!pareceJSON(texto) || esErrorOracle(texto)) return;
      const valor = parsearJSON(texto);
      if (valor === null) return;
      const formateado = JSON.stringify(normalizarJSON(valor), null, 2);
      const pre = document.createElement("pre");
      pre.textContent = formateado;

      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = `Ver JSON (${formateado.length} caracteres)`;
      details.append(summary, pre);
      td.replaceChildren(details);
      td.classList.add("atrm-json");
    });

    procesarBloqueClob(contenido, "JSON_LEN", "JSON DATOS extraído del CLOB (PPFDATOS.DATOS)");
    procesarBloqueClob(contenido, "EVT_LEN", "JSON RESPUESTA extraído del CLOB (PPFEVENTO.RESPUESTA, último evento)");

    resaltarSalida(contenido);
    moverSalidaAFullscreen();
    colapsarBloqueFormulario();
    colapsarCamposEntrada(true);
    colapsarFilasVacias();

    console.log("ATRM: tablas conservadas, bloques JSON_LEN/EVT_LEN formateados, errores ORA resaltados.");
  }

  // ── Recupera la última salida guardada en IndexedDB sin volver a ejecutar la consulta ──
  // Útil mientras se depura el propio userscript: tras recargar/editar el script y pulsar
  // "Restaurar salida", se reinyecta el HTML crudo guardado y se relanza todo el pipeline
  // de formateo (JSON, CLOB, fullscreen, colapsables) sobre datos reales sin ir a Oracle otra vez.
  async function restaurarUltimaSalida() {
    let guardado = null;
    try {
      guardado = await leerSalidaGuardada();
    } catch (error) {
      console.error("ATRM: error leyendo la salida guardada.", error);
      alert("No se pudo leer la salida guardada (ver consola para más detalle).");
      return;
    }
    if (!guardado || !guardado.html) {
      alert("No hay ninguna salida guardada todavía. Ejecuta una consulta al menos una vez.");
      return;
    }

    // Si la Salida ya se movió a su propio panel fullscreen, el contenedor original
    // (#trassqlplus:textAreaSalida) puede estar dentro de #st-salida-panel en vez de en su
    // fila nativa: buscamos el span de contenido donde sea que esté.
    const contenido = document.getElementById("trassqlplus:salida");
    if (!contenido) {
      alert("No se encuentra el contenedor de salida en esta página.");
      return;
    }

    contenido.innerHTML = guardado.html;
    contenido.dataset.atrmFormateado = "";
    contenido.dataset.atrmRestaurado = "1"; // evita volver a sobrescribir el guardado con esta misma copia

    // Si el panel fullscreen ya existe, el contenedor cuelga de él: no lo tocamos, solo re-formateamos.
    // Si no existe todavía, formatearResultados() lo creará vía moverSalidaAFullscreen().
    formatearResultados();

    const boton = document.getElementById("st-restaurar-toggle");
    if (boton) {
      const original = boton.textContent;
      boton.textContent = "✔ Restaurada";
      setTimeout(() => { boton.textContent = original; }, 1800);
    }
  }


  // ── Pliega el bloque completo del formulario nativo (Entorno + SQL + botones) bajo su propio
  // <legend> "Traspaso BBDD (SQL*PLUS)", convertido en botón clicable. Colapsado por defecto para
  // dejar sitio a la Salida; el usuario lo despliega solo si necesita cambiar Entorno o relanzar SQL. ──
  function colapsarBloqueFormulario() {
    const legend = document.querySelector("#st-main fieldset > legend");
    if (!legend || legend.dataset.atrmColapsable === "1") return;
    legend.dataset.atrmColapsable = "1";

    const fieldset = legend.closest("fieldset");
    if (!fieldset) return;

    // Todo el contenido del fieldset excepto el propio legend se agrupa para poder ocultarlo entero.
    const contenido = document.createElement("div");
    contenido.className = "atrm-form-contenido";
    [...fieldset.children].forEach(hijo => {
      if (hijo !== legend) contenido.appendChild(hijo);
    });
    fieldset.appendChild(contenido);

    legend.style.cursor = "pointer";
    legend.style.userSelect = "none";
    legend.textContent = "▶ " + legend.textContent;
    contenido.style.display = "none";

    legend.addEventListener("click", () => {
      const oculto = contenido.style.display === "none";
      contenido.style.display = oculto ? "" : "none";
      legend.textContent = (oculto ? "▼ " : "▶ ") + legend.textContent.slice(2);
    });
  }

  // ── Oculta Comentario definitivamente y deja SQL colapsable con botón (no se usa en diagnóstico) ──
  function colapsarCamposEntrada(colapsarPorDefecto) {
    const filaSQL = document.getElementById("trassqlplus:lsql")?.closest("tr");
    const filaComentario = [...document.querySelectorAll("tr")]
      .find(tr => tr.querySelector('span.label')?.textContent.trim() === "Comentario");

    // Comentario no se usa nunca en este flujo: se oculta la fila entera, sin botón ni opción de mostrarla.
    if (filaComentario) filaComentario.style.display = "none";

    if (!filaSQL || filaSQL.dataset.atrmColapsable === "1") return;
    filaSQL.dataset.atrmColapsable = "1";

    const etiquetaTd = filaSQL.children[0];
    const contenidoTd = filaSQL.children[1];
    if (!etiquetaTd || !contenidoTd) return;

    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "atrm-toggle-campo";
    boton.title = "Mostrar/ocultar este campo";
    etiquetaTd.appendChild(boton);

    contenidoTd.style.display = colapsarPorDefecto ? "none" : "";
    boton.textContent = colapsarPorDefecto ? "▶ Mostrar" : "▼ Ocultar";
    filaSQL.style.padding = "0";
    etiquetaTd.style.padding = "3px 8px";

    boton.addEventListener("click", () => {
      const oculto = contenidoTd.style.display === "none";
      contenidoTd.style.display = oculto ? "" : "none";
      boton.textContent = oculto ? "▼ Ocultar" : "▶ Mostrar";
    });
  }

  // ── Saca únicamente el contenido de la Salida (de solo lectura) de su fila de tabla nativa
  // y lo cuelga directamente de #st-main, como una sección normal de la página. No se clona ni
  // se copia el HTML: se mueve el propio <span id="trassqlplus:salida"> (el que jTraspaso escribe
  // en cada ejecución) a un contenedor propio limpio, sin arrastrar el <div> nativo envolvente
  // (que trae estilos inline como max-width:1130px, height:300px, resize:both, border inset...).
  // El formulario (Entorno + botones + SQL) NO se toca ni se mueve: se queda en su sitio, arriba,
  // con su comportamiento e IDs intactos (solo se deduplica/oculta vía CSS y las otras funciones). ──
  function moverSalidaAFullscreen() {
    if (document.getElementById("st-salida-panel")) return;

    const spanSalida = document.getElementById("trassqlplus:salida");
    const divNativo = document.getElementById("trassqlplus:textAreaSalida");
    if (!spanSalida || !divNativo) return;

    const filaOriginal = divNativo.closest("tr");
    if (filaOriginal) {
      // La fila original se oculta (no se elimina, por si el propio jTraspaso vuelve a escribir en ella)
      filaOriginal.dataset.atrmOculta = "1";
      filaOriginal.style.display = "none";
    }

    // jTraspaso repite de fábrica la fila de botones (Aceptar/Limpiar/Buscar SQL/Descargar...) dos
    // veces: una con IDs "...2" (trassqlplus:botonAceptar2, etc., normalmente ya oculta de fábrica)
    // y otra con los IDs reales sin sufijo (trassqlplus:botonAceptar, la que usa el resto de la
    // automatización). Por si en algún render ambas quedan visibles, se oculta la duplicada por ID
    // exacto (nunca por posición en el DOM, para no arriesgarse a ocultar la fila equivocada).
    const filaBotonesDuplicada = document.getElementById("trassqlplus:botonAceptar2")?.closest("tr");
    if (filaBotonesDuplicada) filaBotonesDuplicada.style.display = "none";

    const cabecera = document.createElement("div");
    cabecera.className = "st-salida-cabecera";
    cabecera.innerHTML = `<strong>Salida</strong>`;

    const panel = document.createElement("section");
    panel.id = "st-salida-panel";
    panel.append(cabecera, spanSalida); // solo el span de contenido, no el div envolvente nativo

    document.getElementById("st-main").appendChild(panel);
  }

  // Colapsa filas de tabla completamente vacías (separadores de maquetado nativo)
  function colapsarFilasVacias() {
    document.querySelectorAll("#st-main tr").forEach(tr => {
      if (tr.dataset.atrmRevisada === "1") return;
      tr.dataset.atrmRevisada = "1";
      const texto = tr.textContent.replace(/\s|\u00a0/g, "");
      const tieneInput = tr.querySelector("input, select, textarea, button, img, a");
      if (texto === "" && !tieneInput) {
        tr.style.display = "none";
      }
    });
  }

  addStyles();
  makeLayout();
  formatearResultados();
})();
