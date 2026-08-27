"use strict";

const GlpiAdapter = require("./glpiAdapter");
const JtraspasoAdapter = require("./jtraspasoAdapter");

const DATA_MODE = process.env.DATA_MODE || "mock"; // Default a mock para permitir dev sin VPN

const glpi = new GlpiAdapter(DATA_MODE);
const jtras = new JtraspasoAdapter(DATA_MODE);

function getMode() {
  return DATA_MODE;
}

function setMode(mode) {
  process.env.DATA_MODE = mode;
  glpi.mode = mode;
  jtras.mode = mode;
}

module.exports = {
  glpi,
  jtras,
  getMode,
  setMode
};
