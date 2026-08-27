# Soporte Incidencias GLPI & jTraspaso (Standalone)

Herramienta standalone de diagnóstico automático, clasificación KB y enriquecimiento de incidencias en GLPI y jTraspaso.

---

## 🚀 Puesta en marcha

### 1. Desarrollo Offline / Sin VPN (Modo MOCK)
Permite trabajar, desarrollar la interfaz, ajustar reglas de diagnóstico y probar el flujo completo **sin acceso a la red CARM ni certificados FNMT**.

```bash
# Instalar dependencias
npm install

# Ejecutar suite de pruebas unitarias
npm test

# Arrancar servidor en modo MOCK (por defecto)
npm start
```
Abre en tu navegador: `http://127.0.0.1:8788`

---

### 2. Puesto de Origen / Producción (Modo LIVE)
Requiere acceso a la red corporativa (VPN) y certificado digital FNMT instalado en el sistema.

```bash
# 1. Configurar entorno
copy .env.example .env
# En .env: configurar DATA_MODE=live (y HEADLESS=true si no requieres interfaz de navegador)

# 2. Instalar navegador Firefox en Playwright (solo la primera vez)
npx playwright install firefox

# 3. Arrancar servidor
npm start
```

---

## 🧭 Flujo de Funcionamiento

```
Bandeja de Tickets
  └─ [Cargar tickets]  →  Lee tickets pendientes de "Tickets a ser procesados" (o fixtures en mock).
  └─ [Seleccionar ticket]  →  Lanza automáticamente el pipeline de 5 pasos en segundo plano con SSE:
       1. 📥 Lectura de ticket (historial completo y adjuntos).
       2. 🔎 Extracción de entidades (DNI, matrícula, CODSOL, procedimiento, fecha) y clasificación KB.
       3. 🗄 Consulta diagnóstica jTraspaso (PPFDATOS, PASAPAGO.PAGO, eventos y JSON CLOB).
       4. 📝 Generación de borradores de TAREA y SEGUIMIENTO con validación de variables.
       5. ✏️ Propuesta de enriquecimiento GLPI (título normalizado y elementos asociados).
```

---

## ⚙️ Variables de Entorno (`.env`)

| Variable | Descripción | Valores / Default |
|---|---|---|
| `PORT` | Puerto del servidor Express | `8788` |
| `DATA_MODE` | Modo de datos: `mock` (fixtures offline) o `live` (Playwright) | `mock` |
| `HEADLESS` | Ejecutar Firefox en background sin ventana gráfica | `false` |

---

## 📂 Estructura del Proyecto

```
glpi-soporte/
├── .github/workflows/ci.yml   — Integración continua con GitHub Actions
├── data/
│   └── kb_rules.json          — Reglas de clasificación y plantillas KB editables en caliente
├── fixtures/                  — Datos y respuestas simuladas para desarrollo offline
│   ├── tickets.json           — Tickets GLPI mock
│   └── jtraspaso.json         — Respuestas jTraspaso mock
├── src/
│   ├── adapters/              — Capa de adaptadores (Live Playwright vs Mock Fixtures)
│   ├── storage/ticketStore.js — Persistencia local de tickets analizados
│   ├── browserManager.js      — Gestión unificada del ciclo de vida de Playwright Firefox
│   ├── ffKiller.js            — Limpieza de procesos huérfanos
│   ├── glpiLive.js            — Automatización GLPI (Playwright)
│   ├── glpiEnrich.js          — Normalización de títulos y enriquecimiento de tickets
│   ├── jtraspasoLive.js       — Ejecución SQL*Plus en jTraspaso y reconstrucción CLOB
│   ├── extract.js             — Extracción de entidades por regex
│   ├── kb.js                  — Motor de conocimiento y reglas dinámicas
│   ├── classify.js            — Clasificador y generador de tareas/seguimientos
│   ├── schemaExplorer.js      — Explorador y discovery de esquemas Oracle
│   ├── jobQueue.js            — Cola de tareas async y streaming SSE
│   └── main.js                — API REST Express y servidor web
├── public/
│   └── index.html             — SPA frontend con streaming en tiempo real y filtros
└── tests/
    └── test-pipeline.js       — Suite de pruebas unitarias y de integración
```
