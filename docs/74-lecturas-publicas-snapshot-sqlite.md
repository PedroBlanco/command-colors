# SEC-001 — Autorización de sesión, vistas públicas y escrituras SQLite/WAL

**12/11/2026.** Seguimiento: [SEC-001, issue #94](https://github.com/PedroBlanco/command-colors/issues/94). Rama experimental sobre la cadena de la PR #83. **Sin despliegue ni fusión en `main`.** La composición CCWB contiene un laboratorio interno *Ancients*; no es una partida reglamentaria y sus manos, diario y operaciones no deben salir por la API pública.

## Riesgo original

La API obtenía `identity.resolveSession(token)`, `invitations.getMatch(...)` y un bando `actor` antes de buscar el almacenamiento y construir la proyección. Otra conexión o proceso SQLite podía revocar la sesión o cambiar la pertenencia/modo durante el intervalo. La versión inicial de #93 protegió la selección de modo y la proyección en un `BEGIN` WAL de solo lectura, pero todavía confiaba en el bando obtenido *fuera* de esa instantánea. Además, el código HTTP construía anteriormente una mano `LAB_ONLY` antes de descartarla.

## Contrato implementado

- `view(actor,{denyExperimentalLab:true})` conserva el contrato interno anterior: selección de modalidad y proyección dentro de una instantánea `BEGIN`/SELECT/`COMMIT`; devuelve `SECTION_LAB_INTERNAL_ONLY` antes de calcular una mano de laboratorio.
- Todas las operaciones que modifican partidas o invitaciones (`createMatch`, `issueInvitation`, `acceptInvitation`, `rejectInvitation` y `revokeInvitation`) resuelven la sesión **después de `BEGIN IMMEDIATE`**. Su pertenencia, propiedad de partida, caducidad y estado de la invitación también se contrastan dentro de ese bloqueo. Esto impide confirmar una invitación o crear una partida con una sesión revocada por otra conexión antes de adquirir el bloqueo. No se añaden rutas HTTP ni nuevas tablas.
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

La PR #93 tenía cinco casos nuevos de snapshot/laboratorio en tres suites. Esta ampliación añade **16 casos de prueba** (10 SQLite, 4 HTTP y 2 SSE) dentro de suites existentes:

- SQLite: sesión vigente y bando correcto, usuario ajeno, revocación desde segunda conexión WAL, pérdida de pertenencia, laboratorio sin exposición de mano, guardia transaccional de comandos demo/mazo e inicialización autenticada. También se verifica la lectura de lobby tras logout desde otra conexión o cambio de guest confirmado. Dos casos comprueban que las cinco mutaciones del lobby autentican tras adquirir el bloqueo y que un logout WAL desde otro proceso las deniega sin modificar tablas.

- HTTP: revocación entre lobby y lectura de partida/eventos/comandos, revocación entre vista y consulta de eventos, revocación entre vista y escritura, y revocación durante inicialización de mazo. Nunca se publican manos ni eventos privados.
- SSE: preferencia obligatoria de vista vinculada a sesión y cierre al revocar durante una espera asíncrona de almacenamiento.

Casos nuevos de seguridad en esta PR: **21** (5 iniciales y 16 adicionales). Se añadieron **8 casos de infraestructura**: 6 de la nueva suite del validador y 2 sobre auditoría del manifiesto en la suite existente. Total acumulado: **29 casos nuevos**. El manifiesto pasó de 71 a **72 suites**.

**Evidencia ejecutada ANTES de esta ampliación:** 7/7 pruebas SSE, Node.js 22.16.0, sobre los blobs exactos `revision-stream.mjs` y su suite anteriores; cinco comprobaciones simuladas del gateway; 41 pruebas nativas de #92 y una regresión integral Windows reportada por el usuario en la rama anterior. **No prueban el árbol actual.**

**Comprobación parcial del árbol actual:** se ha verificado el **parseo sintáctico V8** de los archivos JavaScript de SQLite y de las suites nuevas, además de comprobaciones previas del resto (retirando `import/export` únicamente para analizar con V8; sustituyendo `import.meta.url` en el gateway). **No se han ejecutado aquí tests de integración, HTTP real ni regresión completa.** La PR continúa en borrador. El manifiesto incorpora **72 suites**, al registrar la nueva suite del lanzador portátil. Se priorizan **12 suites**, incluidas las pruebas de lobby de `sqlite.test.mjs`, revocación WAL y guardias transaccionales.

## Validación pendiente, sin solicitarla ahora al usuario

Cuando exista una ejecución nativa disponible, verificar primero las 12 suites prioritarias con `scripts/validate-ccwb-http.ps1` en Windows 11/PowerShell nativo (**sin WSL**) o `node scripts/validate-ccwb-http.mjs` en Windows/Debian y después la regresión completa de **72 suites**. Alternativamente, verificar Node.js + SQLite nativos en un entorno aislado controlado y contrastar las dos ejecuciones. No consumir GitHub Actions innecesariamente.

Criterio de fusión: evidencia SQLite + HTTP/SSE real, pruebas de concurrencia y regresión completa **sobre el mismo SHA**; revisión de la frontera del gateway antes de promocionar los cambios. La preparación para producción, HTTPS inverso y reglas oficiales tienen alcance separado.


## Ejecución portable y evidencia no atribuible a la rama (12/11/2026)

El validador `scripts/validate-ccwb-http.mjs` funciona con Node.js nativo
**22.16.0 o superior**, en Windows 11 y Debian 13, sin WSL, Docker,
navegador, GitHub Actions ni despliegues. Sustituye la lista duplicada del
wrapper PowerShell, que conserva su opción `-FullRegression`.

```powershell
# Cuando se autoricen pruebas: Windows nativo
.\scripts\validate-ccwb-http.ps1 -FullRegression
```

```bash
# Cuando exista un checkout del mismo SHA en un entorno Debian nativo
node scripts/validate-ccwb-http.mjs --full
```

Antes de lanzar cualquier prueba, los dos ejecutores comparan el manifiesto con **todos los archivos `*.test.mjs` realmente presentes** en `packages/`, `scripts/` y `spikes/` (sin seguir enlaces simbólicos). Si hay archivos de prueba omitidos o entradas obsoletas, la ejecución **se detiene con `TEST_MANIFEST_DRIFT`**. La primera fase ejecuta doce suites predefinidas del manifiesto oficial. Si
fallan o falta un archivo, **no se inicia** la regresión completa. Ambas fases
guardan TAP inmutable, código de salida y hash SHA-256 en
`.local-test-reports/`; no se ejecutan comandos de shell arbitrarios ni se
aceptan rutas de log procedentes de argumentos del usuario.

Se añadió la suite `scripts/validate-ccwb-http.test.mjs` (seis casos para
manifiesto, versiones Node, CLI, secuencia de fases, corte ante fallos y detección de deriva). Además, dos nuevos casos en `scripts/check-browser-lab.test.mjs` cubren archivos omitidos, entradas obsoletas y enlaces simbólicos.
**Solo se ha comprobado su sintaxis y se han ejecutado comprobaciones
aisladas de la lógica del lanzador con lotes simulados.** La suite nativa,
las doce suites prioritarias y la regresión completa **no se han ejecutado
sobre este nuevo SHA**. La PR #93 debe seguir en borrador.


### Auditoría automática de cobertura del inventario (12/11/2026)

La ejecución canónica `scripts/run-test-suite.mjs` y el lanzador portátil
`scripts/validate-ccwb-http.mjs` usan el mismo
`auditLocalTestManifest(rootDir,manifest)`, función de solo lectura. Recorre
`packages/`, `scripts/` y `spikes/` y rechaza omisiones o entradas que ya no
se corresponden con archivos. Se ignoran enlaces simbólicos para no escanear
fuera del checkout. Se añaden tres casos de prueba (uno en el validador,
dos en el lanzador canónico) y no se añade otra suite al manifiesto.

**Comprobación aislada con datos reales del árbol GitHub** del mismo SHA de
esta iteración: 72 archivos de prueba encontrados y 72 declarados;
omitir una entrada o declarar otra inexistente produce un error, y el
modo estricto rechaza continuar. **No se ejecutó `node:test` sobre el checkout**:
la auditoría fue evaluada en V8 con una representación de solo lectura
del árbol real. El bloqueo de fusión de #93 permanece.
