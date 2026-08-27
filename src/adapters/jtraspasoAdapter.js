"use strict";

const fs = require("fs");
const path = require("path");
const jtrasLive = require("../jtraspasoLive");

const FIXTURES_FILE = path.join(__dirname, "..", "..", "fixtures", "jtraspaso.json");

function loadMockJtras() {
  try {
    if (fs.existsSync(FIXTURES_FILE)) {
      return JSON.parse(fs.readFileSync(FIXTURES_FILE, "utf8"));
    }
  } catch (_) {}
  return {};
}

class JtraspasoAdapter {
  constructor(mode = process.env.DATA_MODE || "live") {
    this.mode = mode;
  }

  isMock() {
    return this.mode === "mock";
  }

  async diagnoseFull(codsol, progress = () => {}, entities = {}) {
    if (this.isMock()) {
      progress("mock-jtras", `[MODO MOCK] Simulando diagnóstico para ${codsol || "token"}...`);
      const all = loadMockJtras();

      // Si no hay CODSOL, buscar en las fixtures por DNI o CODSOL de entities
      let targetCodsol = codsol;
      if (!targetCodsol && entities) {
        const dni = entities.dnis?.[0] || entities.nies?.[0];
        for (const [cs, item] of Object.entries(all)) {
          if (dni && (item.pago?.NIF === dni || item.clobParsed?.solicitud?.nif === dni)) {
            targetCodsol = cs;
            break;
          }
        }
      }

      const match = targetCodsol ? all[targetCodsol] : null;
      if (match) {
        return {
          mock: true,
          codsol: targetCodsol,
          ppfdatos: match.ppfdatos || null,
          pago: match.pago || null,
          eventos: match.eventos || [],
          clobRaw: JSON.stringify(match.clobParsed || {}),
          clobParsed: match.clobParsed || null,
          errors: [],
          rawOutput: `[MOCK OUTPUT jTraspaso para ${targetCodsol}]`,
          tokenSearch: null
        };
      }

      // Si no hay match específico, generar respuesta simulada coherente
      const genCodsol = targetCodsol || entities.codsol || "MockSol" + Math.floor(Math.random() * 100000);
      const dni = entities.dnis?.[0] || "12345678Z";
      const proc = entities.procedimiento || "1197";

      return {
        mock: true,
        codsol: genCodsol,
        ppfdatos: {
          IDDATOS: "8899001",
          IDESTADO: "5",
          CODFORM: `M${proc}`,
          CODSOLICITUD: genCodsol,
          FECALTA: "27/08/26"
        },
        pago: {
          IDPAGO: "554999",
          CODESTADO: "PA",
          IDDESCOESTADO: "Pagado",
          NIF: dni,
          IMPORTE: "25.00",
          N28: "3058000000000000000000009999",
          FECESTADO: "27/08/2026"
        },
        eventos: [],
        clobRaw: `{"codForm":"F${proc}.V1","guid":"ES_A14036665_2026_DOCH_8899001_MOCK","solicitud":{"proc":"${proc}","codsol":"${genCodsol}","nif":"${dni}"}}`,
        clobParsed: {
          codForm: `F${proc}.V1`,
          guid: "ES_A14036665_2026_DOCH_8899001_MOCK",
          solicitud: { proc, codsol: genCodsol, nif: dni },
          pago: { importe: "25.00", estado: "PAGADO", n28: "3058000000000000000000009999" }
        },
        errors: [],
        rawOutput: `[MOCK GENERADO AUTOMÁTICAMENTE para ${genCodsol}]`,
        tokenSearch: null
      };
    }

    return jtrasLive.diagnoseFull(codsol, progress, entities);
  }

  async runQuery(sqlText, entorno) {
    if (this.isMock()) {
      return {
        mock: true,
        rows: [{ RESULT: "OK_MOCK" }],
        rawOutput: `[MOCK RUN QUERY en ${entorno || "OVCONTRI PRODUCCION"}]\n${sqlText}\n1 fila seleccionada.`
      };
    }
    return jtrasLive.runQuery(sqlText, entorno);
  }

  async getPage() {
    if (this.isMock()) return null;
    return jtrasLive.getPage();
  }

  async ensureJTraspaso(page) {
    if (this.isMock()) return;
    return jtrasLive.ensureJTraspaso(page);
  }

  async closeContext() {
    if (this.isMock()) return;
    return jtrasLive.closeContext();
  }

  buildDiagSQL(codsol, iddatos) {
    return jtrasLive.buildDiagSQL(codsol, iddatos);
  }

  buildClobSQL(codsol, iddatos) {
    return jtrasLive.buildClobSQL(codsol, iddatos);
  }

  buildTokenSearchSQL(token, fechaMM_YY) {
    return jtrasLive.buildTokenSearchSQL(token, fechaMM_YY);
  }
}

module.exports = JtraspasoAdapter;
