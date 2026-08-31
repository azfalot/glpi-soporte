"use strict";

const path = require("path");
const fs   = require("fs");
const { firefox } = require("playwright");
const { getFirefoxPids, killPids } = require("./ffKiller");

const FF_PREFS = {
  "security.osclientcerts.autoload":   true,
  "security.default_personal_cert":    "Select Automatically",
  "security.ask_for_token_init":       false,
  "security.ssl.enable_ocsp_stapling": false,
  "network.trr.mode":                  5,
  "network.proxy.type":                0
};

/**
 * Elimina los lock files de un perfil de Firefox si quedó bloqueado por cierre forzoso.
 */
function unlockProfile(profilePath) {
  if (!fs.existsSync(profilePath)) return;
  for (const lockFile of ["lock", ".parentlock"]) {
    try { fs.unlinkSync(path.join(profilePath, lockFile)); } catch (_) {}
  }
}

/**
 * Lanza un contexto persistente de Playwright Firefox con soporte para certificados y modo headless configurable.
 *
 * @param {string} profileDirName  Nombre de la carpeta del perfil (ej: ".profile-glpi-ff")
 * @param {object} options         Opciones adicionales (headless, viewport, etc.)
 */
async function launchContext(profileDirName, options = {}) {
  const profilePath = path.isAbsolute(profileDirName)
    ? profileDirName
    : path.join(process.cwd(), profileDirName);

  unlockProfile(profilePath);

  const isHeadless = options.headless !== undefined
    ? Boolean(options.headless)
    : process.env.HEADLESS === "true";

  const context = await firefox.launchPersistentContext(profilePath, {
    headless: isHeadless,
    viewport: options.viewport || { width: 1440, height: 900 },
    ignoreHTTPSErrors: options.ignoreHTTPSErrors !== undefined
      ? options.ignoreHTTPSErrors === true
      : process.env.IGNORE_HTTPS_ERRORS === "true",
    firefoxUserPrefs: { ...FF_PREFS, ...(options.firefoxUserPrefs || {}) }
  });

  const page = context.pages()[0] || await context.newPage();
  page.on("dialog", async d => { await d.accept().catch(() => {}); });

  return { context, page };
}

/**
 * Cierra un contexto de Firefox de forma segura y elimina procesos huérfanos asociados.
 */
async function closeContextSafe(context, label = "Firefox") {
  if (!context) return;
  const pidsBefore = getFirefoxPids();
  try {
    await context.close();
  } catch (_) {}

  const kill = () => {
    const now = getFirefoxPids();
    const toKill = [...new Set([...pidsBefore, ...now])];
    if (toKill.length) {
      console.log(`[browserManager] Cerrando ${toKill.length} procesos Firefox (${label})`);
      killPids(toKill);
    }
  };

  setTimeout(kill, 1000);
  setTimeout(kill, 2500);
}

module.exports = {
  launchContext,
  closeContextSafe,
  unlockProfile,
  FF_PREFS
};
