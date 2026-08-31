---
name: jtraspaso-diagnosis
description: Diagnose CARM requests through the jTraspaso web interface using date-bounded token searches, schema discovery, phased SQL, and CLOB reconstruction.
---

# jTraspaso Diagnosis

## Purpose

Use this workflow when a GLPI ticket lacks a CODSOL or when its evidence must be correlated with PPFDATOS, payment data, events, and the JSON CLOB.

## Workflow

1. Read the complete GLPI history, including attachments. Extract the first useful date from the email and preserve the original evidence.
2. Extract a search token from the DNI/NIE or another reliable value. For `Y9266444B`, use `9266444` rather than the leading `Y` when matching `DATOS`.
3. Search `PPFDATOS` with an inclusive date range, not a loose month string:

   ```sql
   SELECT IDDATOS, IDESTADO, FECALTA, CODSOLICITUD,
          DBMS_LOB.GETLENGTH(DATOS) AS LONGITUD_DATOS
   FROM PPFDATOS
   WHERE FECALTA >= TO_DATE('01/08/2026', 'DD/MM/YYYY')
     AND FECALTA <  TO_DATE('01/09/2026', 'DD/MM/YYYY')
     AND DATOS LIKE '%9266444%';
   ```

4. If the schema or columns are uncertain, run `DESCRIBE PPFDATOS`, `DESCRIBE PASAPAGO.PAGO`, and `DESCRIBE PPFEVENTO` through the web interface before composing dependent queries.
5. Once CODSOL and IDDATOS are known, run the diagnosis in phases:
   - request/`PPFDATOS` state and CLOB length;
   - payment in `PASAPAGO.PAGO` through `URLVUELTA`;
   - event list in `PPFEVENTO`;
   - selected event response;
   - complete CLOB extraction.
6. Reconstruct the CLOB from `[[JSON_LEN=...]]` and chunks delimited by `~`. Parse nested JSON strings recursively when possible, while retaining the raw response.
7. Use the resulting model/procedure, request state, payment state, event responses, and error codes to classify the ticket and generate evidence-backed drafts.

## GLPI conventions learned

- For a ticket whose first useful subject is `INCIDENCIA`, the title format is `INCIDENCIA [620] {CODSOL}`.
- The application element is selected by functional area (`PAETRIBUTOS`, `PAEARECA`, or `PASARELAPAGO`); the CARM procedure element uses the procedure code returned by the evidence, which may differ from the model number (for example, model `620` and procedure `3284`).
- A ticket can be diagnosable only after consuming an attachment. PDF text, image OCR, and pasted email content are part of the case evidence, not optional metadata.
- The initial token search must retain its rows and query text in the diagnosis so an operator can audit how CODSOL was found.

## Safety

- Never execute `UPDATE`, package calls, or other mutating SQL automatically as part of diagnosis.
- GLPI title/element changes must remain a visible, explicit confirmation step.
- Keep institutional URLs and raw evidence local; do not send ticket data to external AI or OCR services.
