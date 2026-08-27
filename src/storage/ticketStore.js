"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "ticket_history.json");

if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
}

class TicketStore {
  constructor() {
    this._cache = new Map();
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(STORE_FILE)) {
        const raw = fs.readFileSync(STORE_FILE, "utf8");
        const obj = JSON.parse(raw);
        for (const [k, v] of Object.entries(obj)) {
          this._cache.set(String(k), v);
        }
      }
    } catch (err) {
      console.warn("[TicketStore] Error cargando historial de tickets:", err.message);
    }
  }

  save() {
    try {
      const obj = {};
      for (const [k, v] of this._cache.entries()) {
        obj[k] = v;
      }
      fs.writeFileSync(STORE_FILE, JSON.stringify(obj, null, 2), "utf8");
    } catch (err) {
      console.warn("[TicketStore] Error guardando historial de tickets:", err.message);
    }
  }

  get(ticketId) {
    return this._cache.get(String(ticketId)) || null;
  }

  set(ticketId, key, value) {
    const id = String(ticketId);
    if (!this._cache.has(id)) {
      this._cache.set(id, { status: "running", updatedAt: new Date().toISOString() });
    }
    const item = this._cache.get(id);
    item[key] = value;
    item.updatedAt = new Date().toISOString();
    this.save();
  }

  init(ticketId) {
    const id = String(ticketId);
    if (!this._cache.has(id)) {
      this._cache.set(id, { status: "running", updatedAt: new Date().toISOString() });
    } else {
      this._cache.get(id).status = "running";
      this._cache.get(id).updatedAt = new Date().toISOString();
    }
    this.save();
  }

  done(ticketId) {
    const item = this._cache.get(String(ticketId));
    if (item) {
      item.status = "done";
      item.updatedAt = new Date().toISOString();
      this.save();
    }
  }

  error(ticketId, errMsg) {
    const id = String(ticketId);
    if (!this._cache.has(id)) {
      this._cache.set(id, {});
    }
    const item = this._cache.get(id);
    item.status = "error";
    item.error = errMsg;
    item.updatedAt = new Date().toISOString();
    this.save();
  }

  getAllStatuses() {
    const result = {};
    for (const [id, c] of this._cache.entries()) {
      result[id] = c.status || "unknown";
    }
    return result;
  }

  list() {
    return Array.from(this._cache.entries()).map(([id, data]) => ({
      id,
      title: data.ticket?.title || `Ticket #${id}`,
      status: data.status,
      updatedAt: data.updatedAt
    }));
  }
}

const store = new TicketStore();
module.exports = store;
