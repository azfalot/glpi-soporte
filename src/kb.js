"use strict";

/**
 * KB — Base de conocimiento basada en los tickets históricos del equipo.
 *
 * Categorías reales detectadas en el KB:
 *   AUTOFIRMA_ESTADO5  — AutoFirma/Presentador: estado 5, pago OK, presentación pendiente
 *   PASARELA_CCO       — Actualización CCO (ajustaCCOPagoCorrecto)
 *   PASARELA_FN        — Actualización estado FN (PAGO.CODESTADO='FN')
 *   PASARELA_PA        — Actualización estado PA (PAGO.CODESTADO='PA')
 *   MODELO_620_ESTADO  — Actualizar IDESTADO de solicitud 620 (PPFDATOS)
 *   MODELO_620_JSON    — Reconstruir/actualizar JSON CLOB Modelo 620
 *   MODELO_600_JSON    — Reconstruir/actualizar JSON CLOB Modelo 600
 *   MODELO_651_JSON    — Reconstruir/actualizar JSON CLOB Modelo 651
 *   IVTM_PERMISOS      — Alta en grupo con acceso a consulta IVTM (GRUPOUSUA)
 *   SIRA_NOTIFICACIONES — Errores SIRA/notificaciones (FRIOPETI, FRIOERROR, CORREO, NOTIF)
 *   DOMI_PLAZOS        — Domiciliaciones: plazos, fechas efectos, cintas
 *   PADRONES           — Alta/actualización de padrones (PEPAORI, TRILOCA, etc.)
 *   GENERAL            — No clasificado / consulta general
 */

const path = require("path");
const fs   = require("fs");

const KB_ROOT = process.env.KB_ROOT ||
  path.join(
    process.env.USERPROFILE || "C:\\Users\\cajotero",
    "OESIA NETWORKS SOCIEDAD LIMITADA",
    "Oesia-Accenture - Documentos"
  );

// ── Definición de categorías KB ────────────────────────────────────────────

const KB_CATEGORIES = [
  {
    id: "AUTOFIRMA_GLOBAL",
    label: "AutoFirma — Incidencia global (todos los usuarios afectados)",
    keywords: [
      "autofirma", "auto firma", "firma electronica", "firma no valida",
      "no es valida", "no podemos realizar", "ningun procedimiento",
      "todos los usuarios", "incidencia tecnica", "afectando a la firma",
      "presentador", "no es posible finalizar", "1197", "error procedimientos carm",
      "sede electronica", "no puede firmar"
    ],
    area: "FRONTALES",
    ambito: "PAETRIBUTOS",
    priority: "alta",
    solution: `Incidencia global de AutoFirma/Presentador (todos los usuarios afectados):
1. Verificar si ya existe ticket de seguimiento de la incidencia global (ej: GLPI 1566026).
2. Si la incidencia global YA ESTÁ RESUELTA: seguir el flujo Estado 5 — localizar CODSOL en jTraspaso,
   obtener GUID, construir URL Presentador y facilitar al ciudadano.
3. Si la incidencia global SIGUE ABIERTA: responder al ciudadano indicando que se está trabajando
   en la resolución y que se le notificará cuando pueda completar el trámite.
4. Mantener ticket en espera hasta resolución de incidencia global.`,
    sqlTemplate: `-- Verificar estado de la solicitud cuando se resuelva la incidencia global
SELECT IDDATOS, IDESTADO, CODFORM, CODSOL, SUBSTR(JSON, 1, 500) AS JSON_PREVIEW
FROM PPFDATOS
WHERE CODSOL = '{{CODSOL}}'
ORDER BY IDDATOS DESC;

-- Si IDESTADO=5: construir URL Presentador
-- https://sede.carm.es/presentador?proc={{PROC}}&sol={{CODSOL}}&dptotram={{DPTO}}&guid={{GUID}}`,
    checkQueries: [
      `SELECT IDDATOS, IDESTADO, CODFORM, CODSOL FROM PPFDATOS WHERE CODSOL = '{{CODSOL}}';`
    ],
    followupTemplate: {
      pendiente: `Att CAU UTE-ACCENTURE-OESIA-ATRM

Hay que indicar la siguiente solución a la persona solicitante:

"Buenos días,

Sentimos las molestias ocasionadas.

Actualmente existe una incidencia técnica que está afectando a la firma electrónica de las solicitudes, por lo que no es posible finalizar la presentación de los trámites. Se está trabajando en su resolución.

Una vez solucionada la incidencia, podrá completar la presentación de su solicitud. Le notificaremos en cuanto esté disponible.

Gracias.

Un saludo."`,
      resuelta: `Att CAU UTE-ACCENTURE-OESIA-ATRM

Hay que indicar la siguiente solución a la persona solicitante:

"Buenos días,

La incidencia técnica que afectaba a la firma electrónica ha sido resuelta.

Le facilitamos la siguiente URL para que pueda continuar con la presentación de su solicitud y finalizar correctamente el trámite:

{{URL_PRESENTADOR}}

**Advertencia:** el acceso a esta URL solo está disponible para la persona que realizó el procedimiento.

Una vez completada la presentación podrá obtener el justificante correspondiente.

Gracias.

Un saludo."`,
    },
    taskTemplate: `Se revisa el ticket relativo a la incidencia de AutoFirma / Presentador reportada por el ciudadano (Proc. {{PROC}}).

El ciudadano indica que no puede realizar procedimientos en la sede electrónica de la CARM porque la firma electrónica de las solicitudes no es válida.

Se verifica que se trata de una incidencia global que afecta a todos los usuarios del Presentador. Se crea/referencia el ticket de seguimiento de la incidencia global (GLPI {{GLPI_GLOBAL}}).

El ticket queda en espera de la resolución de la incidencia en Presentador.

Una vez resuelta la incidencia global, se deberá:
  1. Localizar la solicitud del ciudadano en jTraspaso (PPFDATOS) por CODSOL.
  2. Verificar IDESTADO y GUID.
  3. Construir URL Presentador y facilitar al ciudadano.

Se adjuntan capturas de las comprobaciones realizadas.`,
    tidExamples: ["1565896", "1566026"]
  },
  {
    id: "AUTOFIRMA_ESTADO5",
    label: "AutoFirma / Presentador — Estado 5 (pago OK, presentación pendiente)",
    keywords: [
      "autofirma", "auto firma", "presentador", "estado 5", "estado5",
      "guid", "urloktributos", "cod012", "presentacion pendiente",
      "no ha podido firmar", "no pudo firmar",
      "pago realizado", "pago correcto", "pago ok",
      "no finalizo", "corte de red", "cierre del navegador",
      "modelo 600", "modelo 620",
      "facilitar url", "url presentador", "recuperar presentacion",
      "n28", "doch"
    ],
    area: "FRONTALES",
    ambito: "PAETRIBUTOS",
    priority: "alta",
    solution: `FLUJO AUTOFIRMA Estado 5 (pago OK, presentacion pendiente):
1. Localizar solicitud en jTraspaso: CODSOL, PROC, IDESTADO, GUID, N28.
2. Verificar pago: buscar "estado":"PAGADO" o N28 (28 digitos) en JSON de PPFDATOS.
3. Confirmar IDESTADO=5.
4. Verificar GUID (formato ES_A14036665_YYYY_DOCH...).
5. Construir URL Presentador y facilitar al ciudadano.
   — Si COD012 (ya presentada): facilitar URLOKTRIBUTOS.
   — Si documentos ya generados: reenviar enlace de acceso.`,
    sqlTemplate: `-- AutoFirma Estado 5: localizar solicitud en jTraspaso
SELECT IDDATOS, IDESTADO, CODFORM, CODSOL, SUBSTR(JSON,1,500) AS JSON_PREVIEW
FROM PPFDATOS
WHERE CODSOL = '{{CODSOL}}'
ORDER BY IDDATOS DESC;

SELECT IDDATOS, IDESTADO, CODFORM, CODSOL, JSON
FROM PPFDATOS WHERE IDDATOS = {{IDDATOS}};

-- URL Presentador:
-- https://sede.carm.es/presentador?proc={{PROC}}&sol={{CODSOL}}&dptotram={{DPTO}}&guid={{GUID}}
-- Si COD012 -> URLOKTRIBUTOS:
-- https://sede.carm.es/paetributos/formularios/URLOKTRIBUTOS?codForm=M{{MODELO}}&proc={{PROC}}&sol={{CODSOL}}&dptotram={{DPTO}}&guid={{GUID}}`,
    checkQueries: [
      `SELECT IDDATOS, IDESTADO, CODFORM, CODSOL FROM PPFDATOS WHERE CODSOL = '{{CODSOL}}';`,
      `SELECT IDDATOS, IDESTADO, SUBSTR(JSON,1,2000) FROM PPFDATOS WHERE IDDATOS = {{IDDATOS}};`
    ],
    followupTemplate: {
      standard: `Att CAU UTE-ACCENTURE-OESIA-ATRM

Hay que indicar la siguiente solución a la persona solicitante:

"Buenos días,

Sentimos las molestias ocasionadas.

Le facilitamos la siguiente URL para que pueda continuar con la presentación de su solicitud y finalizar correctamente el trámite:

{{URL_PRESENTADOR}}

Una vez completada la presentación podrá obtener el justificante correspondiente.

Gracias.

Un saludo."`,
      alreadyPresented: `**Att CAU UTE-ACCENTURE-OESIA-ATRM**

Hay que indicar la siguiente solución a la persona solicitante:

> {{SALUDO}},
>
> Hemos comprobado que su solicitud del modelo {{MODELO}} figura como presentada correctamente, por lo que el trámite ya ha finalizado con éxito.
>
> Le facilitamos nuevamente la URL de confirmación y acceso a la documentación:
>
> [{{URL_DOCS}}]({{URL_DOCS}})
>
> **Advertencia:** solo el presentador puede acceder a la URL.
>
> Quedamos a su disposición para cualquier aclaración adicional.
>
> Disculpe las molestias ocasionadas.
>
> Gracias.
>
> Un saludo.`,
    },
    taskTemplate: `Se revisa la solicitud {{CODSOL}} correspondiente al modelo {{MODELO}} y procedimiento {{PROC}}.

Se comprueba que la autoliquidación asociada al expediente consta correctamente generada y que el pago figura como {{ESTADO_PAGO}} por importe de {{IMPORTE}}, asociado al justificante N28 {{N28}}.

Asimismo, se verifica la correcta generación del GUID {{GUID}} y de la URL de Presentador asociada al expediente.

{{SITUACION_SOLICITUD}}

{{ACCION_PROPUESTA}}

URL Presentador: {{URL_PRESENTADOR}}
URL documentos/confirmación: {{URL_DOCS}}

Se revisan asimismo los eventos de jTraspaso y se conservan como evidencia las respuestas y adjuntos analizados.

{{EVIDENCIA_ERROR}}`,
    taskTemplatePresented: `Se revisa la solicitud {{CODSOL}} correspondiente al modelo {{MODELO}} y procedimiento {{PROC}}.

Se comprueba que la autoliquidación asociada al expediente consta correctamente generada y que el pago figura como {{ESTADO_PAGO}} por importe de {{IMPORTE}}, asociado al justificante N28 {{N28}}.

Asimismo, se verifica la correcta generación del GUID {{GUID}} y la existencia de la solicitud en jTraspaso.

Aunque el registro conserva IDESTADO {{IDESTADO}}, la URL de Presentador devuelve {{ERROR_PRESENTADOR}}, indicio de que la solicitud ya ha sido presentada y no debe reintentarse desde dicho enlace.

Como actuación, se facilita al interesado la URL de confirmación/documentos y se deja constancia de la respuesta del Presentador y de los eventos de jTraspaso.

URL de confirmación/documentos: {{URL_DOCS}}

{{EVIDENCIA_ERROR}}`,
    tidExamples: ["1559652", "1560114", "1565516", "1530381"]
  },

  {
    id: "PASARELA_CCO",
    label: "Pasarela de Pagos — Actualización CCO",
    keywords: ["cco", "ajustaccopago", "cajamar", "n28", "fragmento", "pasarela"],
    area: "FRONTALES",
    ambito: "PASARELADEPAGO",
    priority: "alta",
    solution: "Ejecutar utiliglpi.ajustaCCOPagoCorrecto() con los datos del pago (fecha, entidad, N28, importe, IDPETITPV, fragmento CCO, GLPI).",
    sqlTemplate: `-- Actualización CCO Pasarela de Pagos
set serveroutput on
begin
  dbms_output.put_line('Inicio --------');
  UC_SESION.idusuario(0);
  -- Fecha, entidad (siempre es la misma), n28, importe, idpetitpv, fragmento_cco_desde_cajamar, GLPI
  utiliglpi.ajustaCCOPagoCorrecto(
    '{{FECHA}}',        -- Fecha pago (DD/MM/YYYY)
    '{{ENTIDAD}}',      -- Código entidad (ej: '3058')
    '{{N28}}',          -- N28 de Cajamar (28 dígitos)
    {{IMPORTE}},        -- Importe numérico
    '{{IDPETITPV}}',    -- Referencia TPV
    '{{FRAGMENTO_CCO}}', -- Fragmento CCO desde Cajamar
    {{GLPI}}            -- Nº GLPI
  );
END;
/`,
    checkQueries: [
      `SELECT * FROM PAGO WHERE IDPETITPV = '{{IDPETITPV}}';`,
      `SELECT * FROM PAGO WHERE N28 = '{{N28}}';`
    ],
    tidExamples: ["1530120", "1531133", "1533634", "1536327", "1537277", "1537314", "1538877"]
  },
  {
    id: "PASARELA_FN",
    label: "Pasarela de Pagos — Actualización a FN",
    keywords: ["fn", "finalizado", "estado fn", "actualizar fn", "pasarela", "pago finalizado"],
    area: "FRONTALES",
    ambito: "PASARELADEPAGO",
    priority: "alta",
    solution: "Actualizar PAGO.CODESTADO='FN' y lanzar job AVISO_ERROR_NOTI_PAGO_ENTIDAD para notificar a la entidad.",
    sqlTemplate: `-- Actualización estado FN Pasarela de Pagos
SET SERVEROUTPUT ON;
DECLARE
  referencia_   PAGO.IDPETITPV%TYPE := '{{IDPETITPV}}'; -- "REFERENCIA TPV"
  n28DeCajamar_ PAGO.N28%TYPE       := TRIM('{{N28}}');  -- "REFERENCIA N28"
  glpi_         PLS_INTEGER         := {{GLPI}};

  aux         PLS_INTEGER;
  n28_        PAGO.N28%TYPE;
  PROCEDURE provocaError(texto_ VARCHAR2) IS BEGIN
    DBMS_OUTPUT.PUT_LINE('****** ' || texto_ || ' *******');
    Raise_Application_Error(-20001, texto_);
  END;
BEGIN
  referencia_ := LOWER(referencia_);
  UC_SESION.idusuario(0);
  UC_SESION.nombreprograma('GLPI '|| TO_CHAR(glpi_) ||'. Actualización estado FN para lanzar JOB y generar CCO');
  IF glpi_ IS NULL THEN provocaError('No has indicado un nº del glpi'); END IF;
  BEGIN
    SELECT N28 INTO n28_ FROM PAGO WHERE IDPETITPV = referencia_;
  EXCEPTION WHEN NO_DATA_FOUND THEN
    provocaError('No he encontrado ningun pago con esa referencia:' || referencia_);
  END;
  IF n28_ <> TRIM(n28DeCajamar_) THEN
    provocaError('El n28 de Cajamar no corresponde con el n28 asociado a la referencia');
  END IF;
  UPDATE PAGO SET CODESTADO = 'FN', FECESTADO = SYSDATE WHERE IDPETITPV = referencia_;
  DBMS_OUTPUT.PUT_LINE('Actualizado estado FN: '||SQL%ROWCOUNT||' fila(s)');
ROLLBACK; -- Cambiar a COMMIT tras verificar
EXCEPTION WHEN OTHERS THEN ROLLBACK;
  DBMS_OUTPUT.put_line('ERROR: [' || SQLCODE || ' / ' || SQLERRM || ']');
END;
/
exec dbms_scheduler.run_job(job_name => 'AVISO_ERROR_NOTI_PAGO_ENTIDAD');
/`,
    checkQueries: [
      `SELECT IDPETITPV, CODESTADO, FECESTADO, N28, IMPORTE FROM PAGO WHERE IDPETITPV = LOWER('{{IDPETITPV}}');`
    ],
    tidExamples: ["1529832", "1533634", "1536327", "1539644", "1542650", "1547048"]
  },
  {
    id: "PASARELA_PA",
    label: "Pasarela de Pagos — Actualización a PA",
    keywords: ["pa", "estado pa", "actualizar pa", "pasarela", "pago anticipado"],
    area: "FRONTALES",
    ambito: "PASARELADEPAGO",
    priority: "alta",
    solution: "Actualizar PAGO.CODESTADO='PA' usando IDPAGO y verificando N28.",
    sqlTemplate: `-- Actualización estado PA Pasarela de Pagos
SET SERVEROUTPUT ON;
DECLARE
  idPago_       PAGO.IDPAGO%TYPE     := {{IDPAGO}};       -- "IDPAGO"
  n28DeCajamar_ PAGO.N28%TYPE        := TRIM('{{N28}}');  -- "REFERENCIA N28"
  glpi_         PLS_INTEGER          := {{GLPI}};

  n28_          PAGO.N28%TYPE;
  PROCEDURE provocaError(texto_ VARCHAR2) IS BEGIN
    DBMS_OUTPUT.PUT_LINE('****** ' || texto_ || ' *******');
    Raise_Application_Error(-20001, texto_);
  END;
BEGIN
  UC_SESION.idusuario(0);
  UC_SESION.nombreprograma('GLPI '|| TO_CHAR(glpi_) ||'. Actualización estado PA.');
  IF glpi_ IS NULL THEN provocaError('No has indicado un nº del glpi'); END IF;
  BEGIN
    SELECT N28 INTO n28_ FROM PAGO WHERE IDPAGO = idPago_;
  EXCEPTION WHEN NO_DATA_FOUND THEN
    provocaError('No he encontrado ningun pago con ese IDPAGO:' || idPago_);
  END;
  IF n28_ <> TRIM(n28DeCajamar_) THEN
    provocaError('El n28 de Cajamar no corresponde con el n28 asociado al IDPAGO');
  END IF;
  UPDATE PAGO SET CODESTADO = 'PA', FECESTADO = SYSDATE WHERE IDPAGO = idPago_;
  DBMS_OUTPUT.PUT_LINE('Actualizado estado PA: '||SQL%ROWCOUNT||' fila(s)');
ROLLBACK; -- Cambiar a COMMIT tras verificar
EXCEPTION WHEN OTHERS THEN ROLLBACK;
  DBMS_OUTPUT.put_line('ERROR: [' || SQLCODE || ' / ' || SQLERRM || ']');
END;
/`,
    checkQueries: [
      `SELECT IDPAGO, CODESTADO, FECESTADO, N28, IMPORTE FROM PAGO WHERE IDPAGO = {{IDPAGO}};`
    ],
    tidExamples: ["1547561"]
  },
  {
    id: "MODELO_620_ESTADO",
    label: "Modelo 620 — Actualizar estado solicitud (PPFDATOS.IDESTADO)",
    keywords: ["modelo 620", "620", "idestado", "ppfdatos", "estado solicitud", "pagado", "estado pagado"],
    area: "FRONTALES",
    ambito: "PAETRIBUTOS",
    priority: "alta",
    solution: "Actualizar PPFDATOS.IDESTADO=9 (pagado) para el IDDATOS de la solicitud. Verificar el JSON CLOB si también hay datos de pago a actualizar.",
    sqlTemplate: `-- Actualizar estado solicitud Modelo 620
SET SERVEROUTPUT ON
DECLARE
  glpi_         PLS_INTEGER := {{GLPI}};
BEGIN
  UC_SESION.idusuario(0);
  UC_SESION.nombreprograma('GLPI '|| TO_CHAR(glpi_) ||'. Actualización idestado de solicitud 620');
  UPDATE PPFDATOS SET IDESTADO = 9 WHERE IDDATOS = {{IDDATOS}};
  DBMS_OUTPUT.put_line('operaciones actualizadas: '||SQL%ROWCOUNT);
ROLLBACK; -- Cambiar a COMMIT tras verificar
EXCEPTION WHEN OTHERS THEN ROLLBACK;
  DBMS_OUTPUT.put_line(SQLERRM);
END;
/
SELECT * FROM PPFDATOS WHERE IDDATOS = {{IDDATOS}};`,
    checkQueries: [
      `SELECT IDDATOS, IDESTADO, CODFORM, CODSOL, DNISOLICITANTE FROM PPFDATOS WHERE IDDATOS = {{IDDATOS}};`,
      `SELECT IDDATOS, IDESTADO, CODFORM FROM PPFDATOS WHERE CODSOL = '{{CODSOL}}' ORDER BY IDDATOS DESC;`
    ],
    tidExamples: ["1511935", "1514169", "1530381", "1537539", "1539614", "1559652"]
  },
  {
    id: "MODELO_620_JSON",
    label: "Modelo 620 — Reconstruir JSON CLOB",
    keywords: ["modelo 620", "620", "json", "clob", "json clob", "reconstru", "datos incorrectos", "reconstrucción"],
    area: "FRONTALES",
    ambito: "PAETRIBUTOS",
    priority: "alta",
    solution: "Reconstruir el JSON CLOB del Modelo 620 en PPFDATOS. El JSON se divide en stra/strb por el límite de 32767 chars de PL/SQL y se concatena antes del UPDATE.",
    sqlTemplate: `-- Reconstruir JSON CLOB Modelo 620 en PPFDATOS
SET SERVEROUTPUT ON;
DECLARE
  json   clob;
  stra   clob;
  strb   clob;
  idDatos_  PPFDATOS.IDDATOS%TYPE := {{IDDATOS}};
  codForm_  PLS_INTEGER           := '620';
  glpi_     PLS_INTEGER           := {{GLPI}};
BEGIN
  UMBELACOMUN.sesion.idusuario(0);
  UMBELACOMUN.sesion.nombreprograma('Actualizar json formulario '|| TO_CHAR(codForm_) ||' GLPI:'|| TO_CHAR(glpi_) ||'');

  -- Pegar el JSON en stra (y strb si supera 32767 chars):
  stra := '{{JSON_PARTE_A}}';
  strb := '{{JSON_PARTE_B}}'; -- dejar vacío si cabe en stra
  json := stra || strb;

  UPDATE PPFDATOS SET JSON = json WHERE IDDATOS = idDatos_;
  DBMS_OUTPUT.put_line('JSON actualizado: '||SQL%ROWCOUNT||' fila(s)');

ROLLBACK; -- Cambiar a COMMIT tras verificar
EXCEPTION WHEN OTHERS THEN ROLLBACK;
  DBMS_OUTPUT.put_line('ERROR: '||SQLERRM);
END;
/
SELECT IDDATOS, IDESTADO, SUBSTR(JSON,1,200) JSON_PREVIEW FROM PPFDATOS WHERE IDDATOS = {{IDDATOS}};`,
    checkQueries: [
      `SELECT IDDATOS, IDESTADO, CODFORM, CODSOL, SUBSTR(JSON,1,500) JSON_PREVIEW FROM PPFDATOS WHERE IDDATOS = {{IDDATOS}};`
    ],
    tidExamples: ["1511935", "1530381", "1537539", "1539614"]
  },
  {
    id: "MODELO_600_JSON",
    label: "Modelo 600 — Reconstruir JSON CLOB",
    keywords: ["modelo 600", "600", "json", "clob", "reconstru", "datos incorrectos"],
    area: "FRONTALES",
    ambito: "PAETRIBUTOS",
    priority: "alta",
    solution: "Reconstruir el JSON CLOB del Modelo 600 en PPFDATOS, siguiendo la misma pauta que el 620 (stra/strb).",
    sqlTemplate: `-- Reconstruir JSON CLOB Modelo 600 en PPFDATOS
SET SERVEROUTPUT ON;
DECLARE
  json   clob;
  stra   clob;
  strb   clob;
  idDatos_  PPFDATOS.IDDATOS%TYPE := {{IDDATOS}};
  codForm_  PLS_INTEGER           := '600';
  glpi_     PLS_INTEGER           := {{GLPI}};
BEGIN
  UMBELACOMUN.sesion.idusuario(0);
  UMBELACOMUN.sesion.nombreprograma('Actualizar json formulario '|| TO_CHAR(codForm_) ||' GLPI:'|| TO_CHAR(glpi_) ||'');
  stra := '{{JSON_PARTE_A}}';
  strb := '{{JSON_PARTE_B}}';
  json := stra || strb;
  UPDATE PPFDATOS SET JSON = json WHERE IDDATOS = idDatos_;
  DBMS_OUTPUT.put_line('JSON actualizado: '||SQL%ROWCOUNT||' fila(s)');
ROLLBACK; -- Cambiar a COMMIT tras verificar
EXCEPTION WHEN OTHERS THEN ROLLBACK;
  DBMS_OUTPUT.put_line('ERROR: '||SQLERRM);
END;
/`,
    checkQueries: [
      `SELECT IDDATOS, IDESTADO, CODFORM, CODSOL, SUBSTR(JSON,1,500) FROM PPFDATOS WHERE IDDATOS = {{IDDATOS}};`
    ],
    tidExamples: ["1532583", "1559306", "1559710", "1559727", "1560100"]
  },
  {
    id: "MODELO_651_JSON",
    label: "Modelo 651 — Reconstruir JSON CLOB",
    keywords: ["modelo 651", "651", "json", "clob"],
    area: "FRONTALES",
    ambito: "PAETRIBUTOS",
    priority: "alta",
    solution: "Reconstruir el JSON CLOB del Modelo 651 en PPFDATOS.",
    sqlTemplate: `-- Reconstruir JSON CLOB Modelo 651 en PPFDATOS
SET SERVEROUTPUT ON;
DECLARE
  json   clob;
  stra   clob;
  idDatos_  PPFDATOS.IDDATOS%TYPE := {{IDDATOS}};
  codForm_  PLS_INTEGER           := '651';
  glpi_     PLS_INTEGER           := {{GLPI}};
BEGIN
  UMBELACOMUN.sesion.idusuario(0);
  UMBELACOMUN.sesion.nombreprograma('Actualizar json formulario '|| TO_CHAR(codForm_) ||' GLPI:'|| TO_CHAR(glpi_) ||'');
  stra := '{{JSON_PARTE_A}}';
  json := stra;
  UPDATE PPFDATOS SET JSON = json WHERE IDDATOS = idDatos_;
  DBMS_OUTPUT.put_line('JSON actualizado: '||SQL%ROWCOUNT||' fila(s)');
ROLLBACK;
EXCEPTION WHEN OTHERS THEN ROLLBACK;
  DBMS_OUTPUT.put_line('ERROR: '||SQLERRM);
END;
/`,
    checkQueries: [
      `SELECT IDDATOS, IDESTADO, CODFORM, CODSOL FROM PPFDATOS WHERE IDDATOS = {{IDDATOS}};`
    ],
    tidExamples: ["1559836", "1565516"]
  },
  {
    id: "IVTM_PERMISOS",
    label: "IVTM — Alta de usuarios en grupo de acceso (GRUPOUSUA)",
    keywords: ["ivtm", "grupo", "permiso", "acceso", "grupousua", "permigru", "usuario", "alta usuario"],
    area: "ARECA",
    ambito: "IVTM",
    priority: "media",
    solution: "Identificar el grupo de acceso al formulario (PERMIGRU) y hacer INSERT en GRUPOUSUA. Lanzar en bloques si hay muchos usuarios (jTraspaso tiene límite).",
    sqlTemplate: `-- Paso 1: Identificar el grupo de acceso al formulario
SELECT *
FROM PERMIGRU P
WHERE P.COD_ACCESO = 'E'
  AND P.COD_TIFUN  = UPPER('FMB')
  AND P.COD_NOMFUN = UPPER('{{COD_FORMULARIO}}') -- Ej: 'IGPID10P'
  AND EXISTS (SELECT 'X' FROM GRUPOUSUA GU, GRUPO G
              WHERE GU.COD_GRUPO = G.COD_GRUPO AND G.COD_ESTADO = 'AC'
                AND GU.COD_USUA = '{{COD_USUA_REF}}' AND GU.COD_GRUPO = P.COD_GRUPO)
  AND ROWNUM <= 1;

-- Paso 2: Dar de alta usuarios en el grupo identificado
BEGIN
  sesion.nombreprograma('GLPI {{GLPI}} - ALTA EN GRUPO ACCESO {{COD_FORMULARIO}}');
  INSERT INTO GRUPOUSUA (COD_GRUPO, COD_USUA) VALUES ('{{COD_GRUPO}}', '{{COD_USUA}}');
  -- Añadir más INSERT para cada usuario
  COMMIT;
EXCEPTION WHEN OTHERS THEN ROLLBACK;
END;
/

-- Paso 3: Verificar
SELECT GU.*, G.COD_ESTADO
FROM GRUPOUSUA GU JOIN GRUPO G ON GU.COD_GRUPO = G.COD_GRUPO
WHERE GU.COD_GRUPO = '{{COD_GRUPO}}'
ORDER BY GU.COD_USUA;`,
    checkQueries: [
      `SELECT GU.COD_GRUPO, GU.COD_USUA FROM GRUPOUSUA GU WHERE GU.COD_USUA = '{{COD_USUA}}';`
    ],
    tidExamples: ["1556840"]
  },
  {
    id: "SIRA_NOTIFICACIONES",
    label: "SIRA / Notificaciones — Error en envío o tramitación",
    keywords: ["sira", "sicer", "notificacion", "notificaciones", "friopeti", "frioerror", "correo", "lote", "deh", "correos", "apremio", "embargo"],
    area: "ARECA",
    ambito: "SIRA",
    priority: "alta",
    solution: "Revisar estado en FRIOPETI/FRIOERROR. Los errores típicos son: documentos no generados (publicar), tipo de recurso no parametrizado en TIPODEUDA. Contactar con Gisela para sanciones de tráfico. Una vez resuelto, relanzar impresión de 26D/27D.",
    sqlTemplate: `-- Diagnóstico SIRA/Notificaciones
-- 1. Verificar el correo/lote
SELECT * FROM CORREO WHERE EJE_CORREO = {{EJE_CORREO}} AND NUM_CORREO IN ({{NUM_CORREO}}) ORDER BY AUD_FECHA DESC;

-- 2. Buscar en SOLISICER
SELECT * FROM SOLISICER WHERE EJE_CORREO = {{EJE_CORREO}} AND NUM_CORREO IN ({{NUM_CORREO}});

-- 3. Buscar en NOTIF
SELECT * FROM NOTIF WHERE EJE_CORREO = {{EJE_CORREO}} AND NUM_CORREO IN ({{NUM_CORREO}}) ORDER BY AUD_FECHA DESC;

-- 4. Ver FRIOPETI en error para el envío
SELECT A.* FROM FRIOPETI A,
  (SELECT COLUMN_VALUE AS patron FROM TABLE(SYS.ODCIVARCHAR2LIST('( {{EJE_CORREO}}, {{NUM_CORREO}}%'))) lst_param
WHERE A.EJE_PETI = {{EJE_CORREO}} AND a.eje_peti_ref IS NULL AND DES_PARA LIKE patron ORDER BY 2 DESC;

-- 5. Ver errores
SELECT * FROM FRIOERROR WHERE EJE_PETI = {{EJE_CORREO}} AND NUM_PETI IN ({{NUM_PETI}}) ORDER BY 2 DESC;

-- 6. (Si aplica) Ver estado de reimpresas 26D/27D
SELECT EJE_PETI, NUM_PETI, COD_USUA, COD_DOCU, FEC_PETI, COD_ESTADOGENE
FROM FRIOPETI WHERE EJE_PETI = {{EJE_CORREO}} AND COD_DOCU IN ('RCNOT26D','RCNOT27D') ORDER BY 2 DESC;`,
    checkQueries: [
      `SELECT * FROM CORREO WHERE EJE_CORREO={{EJE_CORREO}} AND NUM_CORREO={{NUM_CORREO}};`,
      `SELECT * FROM FRIOERROR WHERE EJE_PETI={{EJE_CORREO}} ORDER BY 2 DESC FETCH FIRST 20 ROWS ONLY;`
    ],
    tidExamples: ["1549330", "1556318", "1545681", "1558612"]
  },
  {
    id: "DOMI_PLAZOS",
    label: "Domiciliaciones — Problemas con plazos, cintas o fechas",
    keywords: ["domiciliacion", "domiciliaciones", "cinta", "plazo", "plazos", "fecha efectos", "bonificacion", "saldo", "recibo domiciliado"],
    area: "ARECA",
    ambito: "DOMI",
    priority: "media",
    solution: "Según el sub-tipo: actualizar número de plazos, corregir fecha de efectos, regenerar cinta o anular domiciliación. Ver scripts históricos del KB.",
    sqlTemplate: `-- Diagnóstico Domiciliaciones
-- 1. Verificar deudas/plazos de un contribuyente
SELECT * FROM DOMIDOM WHERE DNI_NIE = '{{DNI}}' ORDER BY FEC_DOMICILIACION DESC;

-- 2. Comprobar cintas
SELECT * FROM DOMICINTA WHERE NUM_CINTA = {{NUM_CINTA}};

-- 3. Actualizar número de plazos (si aplica)
-- UPDATE DOMIDOM SET NUM_PLAZOS = {{NUM_PLAZOS}} WHERE ID_DOMICILIACION = {{ID_DOMI}};

-- 4. Actualizar fecha de efectos (si aplica)
-- UPDATE DOMIDOM SET FEC_EFECTOS = TO_DATE('{{FECHA}}','DD/MM/YYYY') WHERE ID_DOMICILIACION = {{ID_DOMI}};`,
    checkQueries: [
      `SELECT * FROM DOMIDOM WHERE DNI_NIE = '{{DNI}}' ORDER BY FEC_DOMICILIACION DESC;`
    ],
    tidExamples: ["1490615", "1522060", "1524611", "1538128", "1557069"]
  },
  {
    id: "PADRONES",
    label: "Padrones — Alta o actualización de padrón (PEPAORI, TRILOCA)",
    keywords: ["padron", "padrón", "pepaori", "triloca", "basura", "ibo", "ibi", "vado", "alta padrón", "tarifa"],
    area: "ARECA",
    ambito: "PADRONES",
    priority: "media",
    solution: "Verificar tarifas en TRILOCA, preparar INSERT en PEPAORI y ejecutar scripts de alta de padrón. Siempre ejecutar primero rollback de prueba.",
    sqlTemplate: `-- Diagnóstico / Alta de Padrón
-- 1. Consultar tarifas disponibles
SELECT * FROM TRILOCA WHERE COD_MUNI = '{{COD_MUNI}}' AND COD_CONCEPTO = '{{CONCEPTO}}';

-- 2. Verificar si ya existe el sujeto en el padrón
SELECT * FROM PEPAORI WHERE DNI_NIE = '{{DNI}}' AND COD_CONCEPTO = '{{CONCEPTO}}';

-- 3. Insertar en padrón (adaptar campos)
-- INSERT INTO PEPAORI (COD_MUNI, COD_CONCEPTO, DNI_NIE, ...) VALUES ('{{COD_MUNI}}', '{{CONCEPTO}}', '{{DNI}}', ...);`,
    checkQueries: [
      `SELECT * FROM PEPAORI WHERE DNI_NIE='{{DNI}}' AND COD_CONCEPTO='{{CONCEPTO}}';`,
      `SELECT * FROM TRILOCA WHERE COD_MUNI='{{COD_MUNI}}' AND COD_CONCEPTO='{{CONCEPTO}}';`
    ],
    tidExamples: ["1512174", "1512194", "1513516", "1522994", "1547226"]
  },
  {
    id: "GENERAL",
    label: "Consulta / incidencia no clasificada",
    keywords: [],
    area: "AMBOS",
    ambito: "GENERAL",
    priority: "baja",
    solution: "Revisar manualmente. Escalar al grupo de soporte de segundo nivel si es necesario.",
    sqlTemplate: null,
    checkQueries: [],
    tidExamples: []
  }
];

// ── Carga dinámica de reglas ───────────────────────────────────────────────
const RULES_FILE = path.join(process.cwd(), "data", "kb_rules.json");
let _activeRules = KB_CATEGORIES;

function loadRules() {
  try {
    if (fs.existsSync(RULES_FILE)) {
      const data = JSON.parse(fs.readFileSync(RULES_FILE, "utf8"));
      if (Array.isArray(data) && data.length > 0) {
        _activeRules = data;
        return _activeRules;
      }
    }
  } catch (err) {
    console.warn("[KB] Error leyendo data/kb_rules.json, usando reglas por defecto:", err.message);
  }
  _activeRules = KB_CATEGORIES;
  return _activeRules;
}

function reloadRules() {
  return loadRules();
}

// Cargar reglas al iniciar
loadRules();

// ── Búsqueda en el KB ──────────────────────────────────────────────────────

/**
 * Busca en el KB las categorías más relevantes para el texto dado.
 * @param {string} text  Texto del ticket (título + timeline)
 * @param {number} [top=3]  Número de resultados a devolver
 * @returns {Array<{category, score, sqlTemplate, checkQueries, tidExamples}>}
 */
function kbSearch(text, top = 3) {
  const t = text.toLowerCase();
  const rules = _activeRules || KB_CATEGORIES;
  const scored = rules
    .filter(c => c.id !== "GENERAL")
    .map(cat => {
      const score = (cat.keywords || []).filter(kw => t.includes(kw.toLowerCase())).length;
      return { cat, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, top);

  if (!scored.length) {
    const generalCat = rules.find(c => c.id === "GENERAL") || rules[rules.length - 1];
    return [{ category: generalCat, score: 0, sqlTemplate: null, checkQueries: [], tidExamples: [] }];
  }

  return scored.map(x => ({
    category: x.cat,
    score: x.score,
    matchedKeywords: (x.cat.keywords || []).filter(kw => t.includes(kw.toLowerCase())),
    sqlTemplate: x.cat.sqlTemplate,
    checkQueries: x.cat.checkQueries,
    tidExamples: x.cat.tidExamples
  }));
}

/**
 * Devuelve la categoría KB que mejor encaja con el ticket.
 * @param {string} text
 * @returns {object} categoría KB
 */
function kbClassify(text) {
  return kbSearch(text, 1)[0];
}

/**
 * Rellena los placeholders {{VAR}} de un template SQL con los datos extraídos.
 * Los valores no encontrados se dejan como {{VAR}} para que el técnico los complete.
 */
function fillTemplate(template, vars = {}) {
  if (!template) return null;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return key in vars ? vars[key] : `{{${key}}}`;
  });
}

/**
 * Construye el mapa de variables a partir de los datos extraídos del ticket y del diagnóstico de jTraspaso.
 */
function buildVars(entities = {}, diagData = {}, ticketId = null) {
  const isArray = Array.isArray(diagData);
  const tramites = isArray ? diagData : (diagData.tramites || []);
  const t0 = tramites[0] || null;

  const ppf = diagData.ppfdatos || (diagData.jtraspasoResult && diagData.jtraspasoResult.ppfdatos) || null;
  const pago = diagData.pago || (diagData.jtraspasoResult && diagData.jtraspasoResult.pago) || null;
  const clobParsed = diagData.clobParsed || (diagData.jtraspasoResult && diagData.jtraspasoResult.clobParsed) || null;
  const rawOutput = (diagData.jtraspasoResult && diagData.jtraspasoResult.rawOutput) || diagData.rawOutput || "";

  // CODSOL
  const codsol = (entities && entities.codsol)
    || (diagData.jtraspasoResult && diagData.jtraspasoResult.codsol)
    || (ppf && (ppf.CODSOLICITUD || ppf.codsolicitud || ppf.CODSOL || ppf.codsol))
    || (t0 && t0.codsol)
    || (clobParsed && (clobParsed.solicitud?.codsol || clobParsed.codsolicitud))
    || "NNNNNNN";

  // IDDATOS
  const iddatos = (ppf && (ppf.IDDATOS || ppf.iddatos))
    || (t0 && (t0.idTramite || t0.iddatos || t0.IDDATOS))
    || "NNNNNNN";

  // DNI / NIF
  // Nota: PPFDATOS no tiene columna DNI/NIF real; solo procede del CLOB o de PPFEVENTO.NIFSOLICITANTE
  const dni = (entities.dnis && entities.dnis[0])
    || (entities.nies && entities.nies[0])
    || (pago && (pago.NIF || pago.nif))
    || (diagData.eventos && diagData.eventos[0] && (diagData.eventos[0].NIFSOLICITANTE || diagData.eventos[0].nifsolicitante))
    || (clobParsed && (clobParsed.solicitud?.nif || clobParsed.persona?.nif || clobParsed.datospersonales?.nif))
    || (t0 && t0.dniNie)
    || "NNNNNNN";

  // Matrícula (solo disponible en el CLOB, PPFDATOS no tiene columna propia)
  const matricula = (entities.matriculas && entities.matriculas[0])
    || (clobParsed && (clobParsed.vehiculo?.matricula || clobParsed.datosvehiculo?.matricula))
    || (t0 && t0.matricula)
    || "NNNNNNN";

  // Procedimiento y Modelo
  // Nota: PPFDATOS no tiene CODFORM; procedimiento/modelo llegan del ticket, del CLOB
  // o de PPFEVENTO.CODPROCEDIMIENTO (columna real confirmada por DESCRIBE)
  const proc = (entities && entities.procedimiento)
    || (clobParsed && (clobParsed.solicitud?.proc || clobParsed.codigoProcedimiento))
    || (diagData.eventos && diagData.eventos[0] && (diagData.eventos[0].CODPROCEDIMIENTO || diagData.eventos[0].codprocedimiento))
    || (t0 && t0.procedimiento)
    || "1197";

  const modelo = (entities && entities.modelo)
    || (clobParsed && clobParsed.codForm && String(clobParsed.codForm).match(/[FfMm]?(\d{3,6})/)?.[1])
    || "620";

  // IDPAGO, CODESTADO e IMPORTE
  const idPago = (pago && (pago.IDPAGO || pago.idpago)) || "NNNNNNN";
  const importe = (pago && (pago.IMPORTE || pago.importe))
    || (clobParsed && (clobParsed.pago?.importe || clobParsed.datospago?.importe))
    || "0.00";

  // N28 (28 dígitos)
  let n28 = (pago && (pago.N28 || pago.n28)) || null;
  if (!n28 && pago && (pago.URLVUELTA || pago.urlvuelta)) {
    const m = String(pago.URLVUELTA || pago.urlvuelta).match(/\b(\d{28})\b/);
    if (m) n28 = m[1];
  }
  if (!n28 && clobParsed) {
    const m = JSON.stringify(clobParsed).match(/\b(\d{28})\b/);
    if (m) n28 = m[1];
  }
  if (!n28 && rawOutput) {
    const m = rawOutput.match(/\b(\d{28})\b/);
    if (m) n28 = m[1];
  }
  if (!n28) n28 = "NNNNNNNNNNNNNNNNNNNNNNNNNNNN";

  // GUID (preferir columna real IDGUID de PASAPAGO.PAGO sobre el regex sobre texto)
  let guid = (pago && (pago.IDGUID || pago.idguid)) || null;
  if (!guid && clobParsed) {
    if (clobParsed.guid) guid = clobParsed.guid;
    else if (clobParsed.solicitud?.guid) guid = clobParsed.solicitud.guid;
    else {
      const m = JSON.stringify(clobParsed).match(/ES_A14036665[^"'\s,}]+/);
      if (m) guid = m[0];
    }
  }
  if (!guid && rawOutput) {
    const m = rawOutput.match(/ES_A14036665[^"'\s,}]+/);
    if (m) guid = m[0];
  }
  if (!guid) guid = "ES_A14036665_YYYY_DOCH...";

  // URLs
  const urlPresentador = `https://sede.carm.es/presentador?proc=${proc}&sol=${codsol}&dptotram=175&guid=${guid}`;
  const urlDocs = `https://sede.carm.es/paetributos/formularios/URLOKTRIBUTOS?codForm=M${modelo}&proc=${proc}&sol=${codsol}&dptotram=175&guid=${guid}`;

  // JSON CLOB Partes
  let jsonParteA = "PEGAR_JSON_AQUI";
  let jsonParteB = "";
  if (clobParsed && !clobParsed._raw) {
    const fullJsonStr = JSON.stringify(clobParsed);
    if (fullJsonStr.length <= 32000) {
      jsonParteA = fullJsonStr.replace(/'/g, "''");
    } else {
      jsonParteA = fullJsonStr.substring(0, 32000).replace(/'/g, "''");
      jsonParteB = fullJsonStr.substring(32000).replace(/'/g, "''");
    }
  }

  // Fecha (preferir FECPAGO —fecha real de pago— sobre FECESTADO —fecha de cambio de estado—)
  const fecha = (pago && (pago.FECPAGO || pago.fecpago))
    || (pago && (pago.FECESTADO || pago.fecestado))
    || (ppf && (ppf.FECALTA || ppf.fecalta))
    || (entities && entities.fecha)
    || "DD/MM/YYYY";

  // IDPETITPV
  const idpetitpv = (pago && (pago.IDPETITPV || pago.idpetitpv)) || "NNNNNNN";

  return {
    GLPI:      ticketId || "NNNNNNN",
    IDDATOS:   String(iddatos),
    CODSOL:    String(codsol),
    DNI:       String(dni),
    MATRICULA: String(matricula),
    // Pasarela
    IDPETITPV: String(idpetitpv),
    N28:       String(n28),
    IMPORTE:   String(importe),
    FECHA:     String(fecha),
    ENTIDAD:   "3058",
    FRAGMENTO_CCO: String((pago && (pago.CCO || pago.cco)) || "NNNNNNNNNNNNNN"),
    IDPAGO:    String(idPago),
    // AutoFirma / Presentador
    PROC:      String(proc),
    DPTO:      "175",
    GUID:      String(guid),
    MODELO:    String(modelo),
    URL_PRESENTADOR: urlPresentador,
    URL_DOCS:  urlDocs,
    SALUDO: new Date().getHours() < 14 ? "Buenos días" : "Buenas tardes",
    IDESTADO: String((ppf && (ppf.IDESTADO || ppf.idestado)) || "NNNNNNN"),
    ESTADO_PAGO: String((pago && (pago.IDDESCOESTADO || pago.CODESTADO || pago.codestado)) || "no confirmado"),
    // SIRA
    EJE_CORREO: new Date().getFullYear(),
    NUM_CORREO: "NNNNN",
    NUM_PETI:   "NNNNNNN",
    // IVTM
    COD_FORMULARIO: "NNNNNNNN",
    COD_USUA_REF:   "NNNNN",
    COD_GRUPO:      "NNNNNNN",
    COD_USUA:       "NNNNN",
    // Padrón
    COD_MUNI:   "NNNNN",
    CONCEPTO:   "NNN",
    // JSON
    JSON_PARTE_A: jsonParteA,
    JSON_PARTE_B: jsonParteB
  };
}

function kbCategories() { return _activeRules || KB_CATEGORIES; }

module.exports = {
  KB_CATEGORIES,
  kbSearch,
  kbClassify,
  kbCategories,
  fillTemplate,
  buildVars,
  loadRules,
  reloadRules
};
