"use strict";

/**
 * db.js — STUB.
 *
 * jTraspaso se accede exclusivamente via navegador Playwright con certificado FNMT.
 * No hay conexión directa a base de datos.
 *
 * Cualquier código legacy que importe queryJTraspaso recibirá un error descriptivo.
 */

async function queryJTraspaso() {
  throw new Error(
    "queryJTraspaso() está deshabilitado. " +
    "Usa jtraspasoLive.diagnoseFull() que accede via navegador con certificado."
  );
}

async function testConnection() {
  return { connected: false, error: "Acceso solo via navegador (Playwright + certificado FNMT)" };
}

async function closePool() {}

module.exports = { queryJTraspaso, testConnection, closePool };
