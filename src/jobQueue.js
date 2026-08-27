"use strict";

/**
 * jobQueue.js — Cola de jobs en background con notificación SSE.
 *
 * Los jobs son funciones async que se ejecutan secuencialmente
 * (o en paralelo limitado). La UI recibe actualizaciones por SSE
 * sin necesidad de polling.
 *
 * Eventos SSE emitidos:
 *   { type: "job:start",    jobId, label }
 *   { type: "job:progress", jobId, label, step, detail }
 *   { type: "job:done",     jobId, label, result }
 *   { type: "job:error",    jobId, label, error }
 *   { type: "ticket:ready", ticketId, data }   ← ticket leído de GLPI
 *   { type: "diag:ready",   ticketId, data }   ← diagnóstico completo
 *   { type: "draft:ready",  ticketId, data }   ← borradores generados
 */

const EventEmitter = require("events");

class JobQueue extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
    this._jobs   = new Map();   // jobId → { status, result, error, label }
    this._sseClients = new Set(); // res objects de SSE
    this._running = 0;
    this._concurrency = 2;
  }

  // ── SSE ────────────────────────────────────────────────────────────────

  /** Registra un cliente SSE (res de Express) */
  addClient(res) {
    res.writeHead(200, {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write("retry: 3000\n\n");
    this._sseClients.add(res);

    // Heartbeat cada 20s
    const hb = setInterval(() => {
      try { res.write(": ping\n\n"); } catch (_) {}
    }, 20000);

    res.on("close", () => {
      clearInterval(hb);
      this._sseClients.delete(res);
    });
  }

  /** Emite evento SSE a todos los clientes conectados */
  broadcast(event) {
    const data = "data: " + JSON.stringify(event) + "\n\n";
    for (const res of this._sseClients) {
      try { res.write(data); } catch (_) { this._sseClients.delete(res); }
    }
    // También emitir como EventEmitter local (para tests / encadenado)
    this.emit(event.type, event);
  }

  // ── Jobs ───────────────────────────────────────────────────────────────

  /**
   * Encola y ejecuta un job en background.
   * @param {string}   jobId    Identificador único (ej: "diag-1565896")
   * @param {string}   label    Texto legible para la UI
   * @param {Function} fn       async () => result
   */
  async run(jobId, label, fn) {
    // Si ya está corriendo este jobId, no duplicar
    const existing = this._jobs.get(jobId);
    if (existing && existing.status === "running") return existing;

    const job = { jobId, label, status: "running", result: null, error: null, startedAt: Date.now() };
    this._jobs.set(jobId, job);
    this.broadcast({ type: "job:start", jobId, label });

    // Ejecutar async sin bloquear el caller
    setImmediate(async () => {
      try {
        job.result = await fn((step, detail) => {
          // Callback de progreso que el job puede llamar
          this.broadcast({ type: "job:progress", jobId, label, step, detail });
        });
        job.status = "done";
        job.doneAt = Date.now();
        this.broadcast({ type: "job:done", jobId, label, result: job.result });
      } catch (e) {
        job.status  = "error";
        job.error   = e.message;
        job.doneAt  = Date.now();
        this.broadcast({ type: "job:error", jobId, label, error: e.message });
      }
    });

    return job;
  }

  /** Estado de un job */
  status(jobId) {
    return this._jobs.get(jobId) || null;
  }

  /** Lista todos los jobs */
  list() {
    return [...this._jobs.values()].map(j => ({
      jobId: j.jobId, label: j.label, status: j.status,
      error: j.error, startedAt: j.startedAt, doneAt: j.doneAt
    }));
  }
}

// Singleton global
const queue = new JobQueue();
module.exports = queue;
