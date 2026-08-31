"use strict";

const GlpiAdapter = require("./glpiAdapter");
const JtraspasoAdapter = require("./jtraspasoAdapter");

let dataMode = process.env.DATA_MODE || "live";

const glpi = new GlpiAdapter(dataMode);
const jtras = new JtraspasoAdapter(dataMode);

function getMode() {
  return dataMode;
}

function setMode(mode) {
  dataMode = mode;
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
