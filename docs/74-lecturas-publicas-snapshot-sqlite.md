# SEC-001 — Autorización de sesión, vistas públicas y escrituras SQLite/WAL

**12/11/2026.** Seguimiento: [SEC-001, issue #94](https://github.com/PedroBlanco/command-colors/issues/94). Rama experimental sobre la cadena de la PR #83. **Sin despliegue ni fusión en `main`.** La composición CCWB contiene un laboratorio interno *Ancients*; no es una partida reglamentaria y sus manos, diario y operaciones no deben salir por la API pública.

## Riesgo original

La API obtenía `identity.resolveSession(token)`, `invitations.getMatch(...)` y un bando `actor` antes de buscar el almacenamiento y construir la proyección. Otra conexión o proceso SQLite podía revocar la sesión o cambiar la pertenencia/modo durante el intervalo. La versión inicial de #93 protegió la selección de modo y la proyección en un `BEGIN` WAL de solo lectura, pero todavía confiaba en el bando obtenido *fuera* de esa instantánea. Además, el código HTTP construía anteriormente una mano `LAB_ONLY` antes de descartarla.

## Contrato implementado

- `view(actor,{denyExperimentalLab:true})` conserva el contrato interno anterior: selección de modalidad y proyección dentro de una instantánea `BEGIN`/SELECT/`COMMIT`; devuelve `SECTION_LAB_INTERNAL_ONLY` antes de calcular una mano de laboratorio.
- `invitations.getMatch({sessionToken,matchId})` consulta **sesión, pertenencia, revision del lobby y lista de participantes** en una instantánea WAL única. Revocaciones o cambios de pertenencia confirmados por otra conexión antes de la primera lectura se reflejan en la respuesta; la transacción finaliza antes de responder.
- `viewForSession({sessionToken})` **siempre deniega el laboratorio** y consulta la sesión, su vencimiento y la pertenencia a la partida **dentro de la misma instantánea WAL** que emplea para seleccionar el modo, reconstruir la vista y determinar el bando. No acepta el bando del cliente. Fallos: `401 UNAUTHENTICATED`, `404 NOT_FOUND`, `409 SECTION_LAB_INTERNAL_ONLY`.
- `publicEventsForSession({sessionToken})` vincula sesión, pertenencia, modalidad y consulta de eventos públicos en su propia instantánea, aunque el estado se haya consultado anteriormente. Mantiene el comportamiento interno de `publicEvents(actor,{denyExperimentalLab:true})` para adaptadores y pruebas precedentes.
- El gateway utiliza los métodos de sesión cuando los proporciona el almacén real. En los adaptadores antiguos conserva los métodos basados en `actor`. GET de partida, GET de eventos, POST de comandos y negociación SSE deniegan el laboratorio antes de serializar información. Un rechazo de sesión se convierte en 401/404, sin exponer objetos privados ni detalles de SQLite.
- Cada tick SSE revalida sesión y pertenencia, solicita `viewForSession` si existe y cierra el flujo ante revocación, estado inconsistente o laboratorio; solo emite números de revisión, nunca cartas.
- `dispatchForSession({sessionToken,...command})` determina el bando desde la sesión en el servidor y pasa una guardia que se **ejecuta dentro de `BEGIN IMMEDIATE`**, tanto para comandos de demostración como para el mazo sintético. La guardia comprueba que la sesión siga vigente y que la pertenencia coincida con el bando previamente derivado. Se verifica antes de consultar idempotencia, proyectar manos de error o modificar tablas.
- `initializeCommandDeckForSession({sessionToken})` somete la inicialización sintética a idéntica comprobación bajo bloqueo de escritura. La API HTTP usa el nuevo contrato cuando existe; los métodos antiguos `initializeCommandDeck(actor)` y `dispatch({actor,...})` se mantienen para los consumidores internos y las pruebas previas.
- No hay nuevas rutas públicas, datos de usuario en el navegador, migraciones de esquema, acciones reglamentarias de *Ancients* ni exposición de funciones internas del laboratorio.

### Semántica temporal

Una revocación que **se ha confirmado antes de la primera lectura del snapshot** invalida la vista y los eventos. Si la revocación ocurre después de esa primera lectura, la respuesta se interpreta respecto al snapshot autorizado anterior (comportamiento consistente de WAL). Para una escritura, `BEGIN IMMEDIATE` serializa con el cierre de sesión: si la revocación ganó primero, la guardia falla; si la escritura adquirió y validó primero el bloqueo, la revocación espera a la transacción. No se promete la retirada de respuestas ya generadas ni una política de producción para sesiones distribuidas.

## Pruebas y evidencia

La PR #93 tenía cinco casos nuevos de snapshot/laboratorio en tres suites. Esta ampliación añade **14 casos de prueba** (8 SQLite, 4 HTTP y 2 SSE) dentro de suites existentes:

- SQLite: sesión vigente y bando correcto, usuario ajeno, revocación desde segunda conexión WAL, pérdida de pertenencia, laboratorio sin exposición de mano, guardia transaccional de comandos demo/mazo e inicialización autenticada. También se verifica la lectura de lobby tras logout desde otra conexión o cambio de guest confirmado.

Total nuevos en esta PR: **19 casos** (5 iniciales y 14 adicionales) sobre las **71 suites existentes**.
- HTTP: revocación entre lobby y lectura de partida/eventos/comandos, revocación entre vista y consulta de eventos, revocación entre vista y escritura, y revocación durante inicialización de mazo. Nunca se publican manos ni eventos privados.
- SSE: preferencia obligatoria de vista vinculada a sesión y cierre al revocar durante una espera asíncrona de almacenamiento.

**Evidencia ejecutada ANTES de esta ampliación:** 7/7 pruebas SSE, Node.js 22.16.0, sobre los blobs exactos `revision-stream.mjs` y su suite anteriores; cinco comprobaciones simuladas del gateway; 41 pruebas nativas de #92 y una regresión integral Windows reportada por el usuario en la rama anterior. **No prueban el árbol actual.**

**Comprobación del árbol actual:** se ha verificado el **parseo sintáctico** de los siete archivos JavaScript modificados (retirando `import/export` únicamente para analizar con V8; sustituyendo `import.meta.url` en el gateway). **No se han ejecutado aquí tests de integración, HTTP real ni regresión completa.** La PR continúa en borrador. El manifiesto conserva **71 suites** y el lanzador prioriza ocho, incluidas las tres suites ampliadas.

## Validación pendiente, sin solicitarla ahora al usuario

Cuando exista una ejecución nativa disponible, verificar primero las ocho suites prioritarias de `scripts/validate-ccwb-http.ps1` en Windows 11/PowerShell nativo (**sin WSL**) y después la regresión completa de 71 suites. Alternativamente, verificar Node.js + SQLite nativos en un entorno aislado controlado y contrastar las dos ejecuciones. No consumir GitHub Actions innecesariamente.

Criterio de fusión: evidencia SQLite + HTTP/SSE real, pruebas de concurrencia y regresión completa **sobre el mismo SHA**; revisión de la frontera del gateway antes de promocionar los cambios. La preparación para producción, HTTPS inverso y reglas oficiales tienen alcance separado.
