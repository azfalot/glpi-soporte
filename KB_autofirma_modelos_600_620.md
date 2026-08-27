# KB - Incidencias de Autofirma (Modelos 600/620)

## Objetivo

Estandarizar el diagnóstico y resolución de incidencias de firma/presentación en modelos 600/620.

## Datos mínimos a obtener

- CODSOLICITUD
- IDDATOS
- IDESTADO
- PROC
- GUID
- URL Presentador
- N28
- Estado del pago

## SQL base de trabajo

```sql
-- =========================
-- CONFIG SQL*Plus
-- =========================
SET PAGESIZE 50000
SET LINESIZE 32767
SET LONG 2000000
SET LONGCHUNKSIZE 32767
SET TRIMSPOOL ON
SET TAB OFF
SET FEEDBACK ON
SET VERIFY OFF
SET HEADING ON
SET COLSEP ' | '
SET SERVEROUTPUT ON SIZE UNLIMITED

-- =========================
-- BUSQUEDA INICIAL
-- =========================
-- SELECT * FROM PPFDATOS WHERE FECALTA LIKE '%MM/YY%' AND DATOS like '%<TOKEN>%';

DEFINE CODSOL = '<CODSOL>'
DEFINE IDDATOS = <IDDATOS>

PROMPT ==== 2) REVISION SOLICITUD ====
SELECT IDDATOS, IDESTADO, DATOS, CODSOLICITUD
FROM PPFDATOS
WHERE UPPER(CODSOLICITUD) = UPPER('&CODSOL');

PROMPT ==== 3) REVISION PAGO ====
SELECT IDPAGO, IDDESCOESTADO, CODESTADO, NIF, IMPORTE, URLVUELTA
FROM PASAPAGO.PAGO
WHERE URLVUELTA LIKE '%' || '&CODSOL' || '%';

PROMPT ==== 4) REVISION EVENTOS ====
SELECT *
FROM PPFEVENTO
WHERE UPPER(CODSOLICITUD) = UPPER('&CODSOL')
ORDER BY FECEVENTO;

-- =========================
-- 5) EXTRACCION CLOB DATOS
-- =========================
SET FEEDBACK OFF
SET LINESIZE 32767

DECLARE
    l_offset   NUMBER := 1;
    l_chunk    NUMBER := 2000;
    l_total    NUMBER;
    l_clob     CLOB;
    c_fin      CONSTANT VARCHAR2(1) := '~';
BEGIN
    SELECT datos
      INTO l_clob
      FROM ovcontri.ppfdatos
     WHERE UPPER(codsolicitud) = UPPER('&CODSOL')
       AND iddatos = TO_NUMBER('&IDDATOS');

    l_total := DBMS_LOB.getlength(l_clob);
    DBMS_OUTPUT.put_line('[[JSON_LEN=' || l_total || ']]');

    WHILE l_offset <= l_total LOOP
        DBMS_OUTPUT.put_line(DBMS_LOB.substr(l_clob, l_chunk, l_offset) || c_fin);
        l_offset := l_offset + l_chunk;
    END LOOP;
END;
/
SET FEEDBACK ON
```

## Clasificación operativa

### Caso A: IDESTADO=5 + no presentado
- Diagnóstico: solicitud creada, presentación no completada.
- Acción: facilitar URL de Presentador.

### Caso B: Presentador devuelve COD012
- Diagnóstico: solicitud ya presentada.
- Acción: facilitar URLOKTRIBUTOS (confirmación/documentos).

### Caso C: Presentación completada y documentos disponibles
- Diagnóstico: trámite finalizado.
- Acción: facilitar acceso documental / cierre ticket.

## Regla rápida

1. Estado 5 + pago correcto -> Presentador  
2. COD012 -> URLOKTRIBUTOS  
3. Documentación disponible -> cierre/confirmación

## Plantilla de tarea interna (resumen)

1) Identificación solicitud y evidencias (capturas/salidas SQL).  
2) Revisión solicitud + pago + eventos + CLOB.  
3) Resultado: estado, pago, GUID, URL, clasificación.  
4) Acción propuesta al usuario.  
5) Tiempo dedicado (acción GLPI).

## Plantilla de seguimiento (base)

> Buenos días,  
> Hemos revisado su incidencia y comprobado que `<DIAGNOSTICO>`.  
> Para continuar, le facilitamos: `<URL/INDICACION>`.  
> Quedamos a la espera de su confirmación.  
> Gracias.  
> Un saludo.

