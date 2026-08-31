# Informe de auditoria: alerta de navegacion y posible malware

**Fecha de comprobacion:** 2026-08-28 08:52 (CEST)  
**Equipo/proyecto revisado:** `soporte-incidencias-live`  
**Alcance:** estado local observable y codigo del proyecto. No sustituye un analisis forense del equipo ni la investigacion del SOC.

## Conclusion provisional

No hay evidencia, en el codigo revisado ni en el estado observado, de una integracion con servicios de IA, exfiltracion a terceros o malware dentro de este proyecto.

La aplicacion **no estaba ejecutandose** durante la comprobacion: no habia proceso Node ni escucha en el puerto 8788, y tampoco habia procesos Firefox. Por tanto, la alerta detectada por la administracion no puede atribuirse directamente a una ejecucion activa de esta aplicacion en ese momento.

La pagina concreta que genero la alerta **no puede identificarse con la evidencia disponible**. El historial del navegador y los registros de proxy/DNS/SOC deben correlacionarse con la hora exacta de la alerta.

## Evidencias

### Procesos y red

- No se observaron procesos `node.exe` ni `firefox.exe`.
- Se observaron procesos `msedge.exe` con ruta firmada de Microsoft:
  `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`.
- Edge tenia una conexion HTTPS establecida a `74.242.255.116:443`. No se obtuvo nombre PTR, por lo que no es posible atribuirla a una pagina concreta solo con esta captura.
- No habia escucha local en `127.0.0.1:8788`.

### Proyecto

- Las unicas navegaciones previstas son:
  - `https://glpi.carm.es`
  - `https://jtraspaso.carm.es`
  - `https://sede.carm.es`
- No se encontraron referencias a OpenAI, ChatGPT, Anthropic, Gemini, Claude, Ollama, Hugging Face u otros proveedores de IA.
- La clasificacion usa reglas y KB local, no un modelo remoto.
- La ejecucion de comandos encontrada solo usa `tasklist` con una cadena fija para localizar procesos Firefox.
- No se detectaron rutinas de descarga, persistencia, ocultacion o envio de datos a dominios ajenos a los servicios institucionales configurados.

### Proteccion del equipo

- Microsoft Defender aparece habilitado, pero la proteccion en tiempo real aparece **deshabilitada**.
- No se devolvieron detecciones en `Get-MpThreatDetection`.
- No constaba una antiguedad valida de analisis rapido ni completo (`QuickScanAge` y `FullScanAge` sin datos validos).
- Esto no demuestra que el equipo este limpio: reduce la fuerza de la evidencia y requiere una comprobacion completa por el equipo de sistemas.

## Riesgos del codigo que deben corregirse

1. `browserManager.js` usa `ignoreHTTPSErrors: true`; en produccion debe validarse TLS.
2. `/api/jtraspaso/query` acepta SQL desde localhost sin autenticacion adicional.
3. `/api/glpi/enrich/apply` acepta propuestas del cliente y puede modificar GLPI.

Estos son riesgos de seguridad de la aplicacion, pero no son por si mismos evidencia de malware.

## Acciones recomendadas para cerrar la investigacion

1. Solicitar al SOC/administracion la URL completa, hora exacta, proceso y regla que genero la alerta.
2. Exportar del proxy/DNS las conexiones del equipo en una ventana de +/- 15 minutos alrededor de la alerta.
3. Ejecutar una actualizacion de firmas y un analisis completo de Microsoft Defender con proteccion en tiempo real habilitada.
4. Revisar extensiones de Edge, tareas programadas y elementos de inicio no reconocidos.
5. Correlacionar las URLs con el historial de Edge sin enviar ese historial a servicios externos.
6. Mantener `DATA_MODE=mock` hasta que el acceso LIVE sea necesario y validado.

## Comprobaciones adicionales realizadas (09:00 CEST)

### Proxy/DNS y conexiones

- WinHTTP esta configurado en acceso directo, sin proxy.
- La configuracion de proxy del usuario no muestra servidor ni URL PAC.
- La caché DNS no devolvio entradas coincidentes con GLPI, jTraspaso, CARM, ChatGPT, OpenAI o Copilot en el momento de la consulta.
- La conexion observada anteriormente a `74.242.255.116:443` pertenecia a Edge, pero no se pudo resolver mediante PTR. No permite identificar una pagina por si sola.
- No se pudo exportar el proxy corporativo ni sus registros desde este equipo; esa evidencia debe solicitarse a OSEG/SOC.

### Extensiones, inicio y tareas

Se encontraron estas extensiones en el perfil `Default` de Edge:

- Microsoft Edge Unminification Extension.
- Edge relevant text changes.
- Microsoft Edge DevTools Enhancements.
- Authenticator: 2FA Client.
- Una extension con nombre localizado (`__MSG_extName__`) y permisos limitados a `docs.google.com` y `drive.google.com`; debe identificarse desde `edge://extensions` o mediante inventario corporativo.

No se observaron permisos de extensiones con acceso global a todas las paginas. Los elementos de inicio y tareas no Microsoft encontrados corresponden a OneDrive, Teams, Edge, Postman Agent, OpenNAC, CrowdStrike, KeePass, Oesia y componentes de gestion corporativa. No se identifico un ejecutable aleatorio o una ruta temporal entre ellos.

Edge tiene politicas corporativas configuradas. La pagina de inicio y nueva pestaña apuntan a `intraweb.oesia.com`, lo que es coherente con un equipo gestionado por Oesia y no es evidencia de malware.

### Correlacion local de URLs

La configuracion del perfil contiene referencias a GitHub, Copilot de Microsoft, Google/Bing y dominios CARM, incluidos GLPI y jTraspaso. Estas referencias pueden ser listas de permisos, politicas o datos de navegacion persistidos; **no demuestran que se hayan visitado en la hora de la alerta**.

La aplicacion revisada solo contiene navegaciones institucionales CARM y no controla el perfil normal de Edge. No fue posible recuperar de forma segura el historial SQLite mientras Edge estaba en uso sin riesgo de obtener una copia inconsistente. OSEG/SOC debe correlacionar el evento con el historial/proxy corporativo.

## Dictamen

**Estado actual:** sin indicios confirmados de malware en este proyecto; incidente de navegacion no atribuido.  
**Nivel de certeza:** medio para el codigo, bajo para la actividad historica del equipo.  
**Bloqueo principal:** falta la alerta original o los registros corporativos que contienen la URL y la hora.
