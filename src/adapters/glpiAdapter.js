"use strict";

const fs = require("fs");
const path = require("path");
const glpiLive = require("../glpiLive");

const FIXTURES_FILE = path.join(__dirname, "..", "..", "fixtures", "tickets.json");

function loadMockTickets() {
  try {
    if (fs.existsSync(FIXTURES_FILE)) {
      return JSON.parse(fs.readFileSync(FIXTURES_FILE, "utf8"));
    }
  } catch (_) {}
  return { tickets: [] };
}

class GlpiAdapter {
  constructor(mode = process.env.DATA_MODE || "live") {
    this.mode = mode;
  }

  isMock() {
    return this.mode === "mock";
  }

  async listTicketsToProcess() {
    if (this.isMock()) {
      const data = loadMockTickets();
      return { tickets: data.tickets || [], mock: true };
    }
    return glpiLive.listTicketsToProcess();
  }

  async readTicket(ticketId) {
    if (this.isMock()) {
      const data = loadMockTickets();
      const found = (data.tickets || []).find(t => String(t.id) === String(ticketId));
      if (found) {
        return {
          ticketId: String(found.id),
          title: found.title,
          timelineCount: (found.timeline || []).length,
          timeline: found.timeline || [],
          mock: true
        };
      }
      // Generar ticket mock genérico si no está en fixture
      return {
        ticketId: String(ticketId),
        title: `[BUZON] Ticket #${ticketId} — Incidencia general simulada`,
        timelineCount: 1,
        timeline: [
          {
            date: new Date().toISOString().replace("T", " ").substring(0, 16),
            user: "Usuario Simulado",
            type: "description",
            content: `Incidencia simulada en modo mock para ticket #${ticketId}. Procedimiento 1197. DNI 12345678Z.`,
            attachments: []
          }
        ],
        mock: true
      };
    }
    return glpiLive.readTicket(ticketId);
  }

  async getPage() {
    if (this.isMock()) return null;
    return glpiLive.getPage();
  }

  getActivePage() {
    if (this.isMock()) return null;
    return glpiLive.getActivePage();
  }

  async closeContext() {
    if (this.isMock()) return;
    return glpiLive.closeContext();
  }
}

module.exports = GlpiAdapter;
