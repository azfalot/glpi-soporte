"use strict";

const { execSync } = require("child_process");

function getFirefoxPids() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq firefox.exe" /FO CSV /NH',
      { encoding: "utf8", timeout: 5000 });
    const pids = [];
    const re = /"firefox\.exe","(\d+)"/gi;
    let m;
    while ((m = re.exec(out)) !== null) pids.push(parseInt(m[1]));
    return pids;
  } catch (_) { return []; }
}

function killPids(pids) {
  for (const pid of pids) {
    // process.kill() usa la API nativa de Node.js — funciona donde taskkill falla
    try { process.kill(pid, "SIGTERM"); } catch (_) {}
    try { process.kill(pid, "SIGKILL"); } catch (_) {}
  }
}

function killOrphanPlaywrightFirefox() {
  const pids = getFirefoxPids();
  if (!pids.length) return;
  killPids(pids);
  setTimeout(() => killPids(getFirefoxPids()), 1200);
}

module.exports = { getFirefoxPids, killPids, killOrphanPlaywrightFirefox };
