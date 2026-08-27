# Soporte Incidencias LIVE (standalone)

Aplicación standalone para Windows — **independiente de PAETRIBUTOS**.

## Requisitos

- Node.js 20+
- SQL Server accesible (jTraspaso)
- Playwright Chromium (instalado automáticamente con `npx playwright install chromium`)

## Puesta en marcha

```bash
# 1. Copiar y rellenar credenciales DB
copy .env.example .env
# edita .env con JTRAS_SERVER, JTRAS_DATABASE, JTRAS_USER, JTRAS_PASSWORD

# 2. Instalar dependencias
npm install

# 3. (Primera vez) instalar navegador Playwright
npx playwright install chromium

# 4. Arrancar
npm start
```

Abre: `http://127.0.0.1:8788`

## Flujo de uso

```
Bandeja
  └─ [Cargar tickets]  →  GLPI abre navegador (login por certificado si es la 1ª vez)
                          Lista "tickets a ser procesados"

  └─ [Seleccionar ticket]  →  TAB "Ticket": metadatos + timeline completo + adjuntos

  └─ TAB "Diagnóstico"
       [Analizar & consultar jTraspaso]
         · Extrae DNI/NIE, matrícula, CODSOL, procedimiento, fecha del texto
         · Lanza query LIVE en jTraspaso (SQL Server)
         · Muestra resultados + JSON CLOB reconstruido

  └─ TAB "Borradores"
       [Generar borradores]
         · Clasifica la incidencia (8 categorías)
         · Genera borrador de TAREA (con evidencias)
         · Genera borrador de SEGUIMIENTO personalizado (para el ciudadano)
         · Botones de copia rápida
```

## Variables de entorno (.env)

| Variable | Descripción | Default |
|---|---|---|
| `JTRAS_SERVER` | Host SQL Server | `localhost` |
| `JTRAS_DATABASE` | Base de datos | `jTraspaso` |
| `JTRAS_USER` | Usuario SQL | _(vacío)_ |
| `JTRAS_PASSWORD` | Contraseña SQL | _(vacío)_ |
| `JTRAS_PORT` | Puerto | `1433` |
| `JTRAS_TRUST_CERT` | Certificado autofirmado | `false` |
| `PORT` | Puerto Express | `8788` |

## Estructura

```
src/
  main.js       — Servidor Express + endpoints REST
  glpiLive.js   — Playwright: login, bandeja, lectura de ticket
  db.js         — Conexión SQL Server (mssql), query jTraspaso
  extract.js    — Extracción de entidades (DNI, NIE, matrícula, CODSOL…)
  classify.js   — Clasificación + generación de borradores
public/
  index.html    — UI completa (bandeja → ticket → diagnóstico → borradores)
.env.example    — Plantilla de configuración
```

## Adaptación a tu esquema SQL

Edita `src/db.js` → función `queryJTraspaso()`:
- Ajusta el nombre de tabla (`dbo.TRAMITES`) y las columnas al esquema real.
- La columna del CLOB JSON puede llamarse `DATOS_JSON`, `JSON_CLOB` o `CLOB_DATOS` — el código prueba las tres con `COALESCE`.
