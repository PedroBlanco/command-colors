# LAB-ANC — simulación autenticada de un hexágono en CCWB/SQLite

**Fecha:** 12/11/2026 · **Rama/PR:** `feat/lab-anc-movement-candidate-audit-trail` / #96. **Estado:** integración experimental exclusivamente interna, **sin** ejecutar movimientos, escribir en SQLite, consumir órdenes, abrir HTTP o emitir SSE.

## Objetivo y contrato

La [composición pura de intención y tablero hipotético](83-preview-privada-intencion-un-hexagono.md) ya se conecta con la autenticación de partidas y el diario privado CCWB a través de dos métodos internos:

- `getStore(matchId).precheckExperimentalSectionOneHexIntent(request, trustedContext, policy)` en `packages/sqlite-store/sqlite.mjs`.
- `createSqliteAncientsSectionBridge.previewOneHexIntent(actor,request,trustedContext,policy)` en `packages/ancients-rules/sqlite-section-ccwb-bridge.mjs`.

**No existen rutas HTTP/SSE nuevas** que llamen a estos métodos. No se incorporan al contrato público ni al reductor de partidas ordinarias. El modo continúa siendo privado `LAB_ONLY`.

### Flujo de seguridad

1. El método SQLite valida la forma del `request` con `screenAncientsMovementCommitIntent`, y rechaza campos adicionales con `400 INVALID_SECTION_LAB_ONE_HEX_REQUEST`.
2. Abre `readSnapshot` (`BEGIN`) y, **dentro de esa misma transacción SQLite/WAL**, resuelve el token de sesión activo, identidad y pertenencia a la partida. Las denegaciones de sesión y pertenencia mantienen los códigos `401 UNAUTHENTICATED` y `404 NOT_FOUND`.
3. Dentro de ese mismo snapshot confirma que la partida tiene el diario experimental inicializado. El puente reconstruye y verifica **todos los comandos y eventos** del historial privado; no acepta la fotografía de tablero si no coincide con el replay persistido.
4. El actor se obtiene exclusivamente de la sesión. El estado verificado procede de CCWB; perfiles, terreno y política sintética se aportan **por separado desde el código confiable del servidor**, nunca desde el request.
5. `previewPrivateOneHexAncientsIntent` vuelve a comprobar la forma y ejecuta `reduceOneHexClearLab` en memoria. Una simulación válida produce `200 SECTION_LAB_ONE_HEX_SIMULATION` con `simulation.status='PRIVATE_LAB_SIMULATION'`, tablero hipotético y lista de movimientos congelados, no un tablero de partida confirmado.
6. La respuesta lleva `canCommit:false`, `movementAuthorized:false`, `attackAuthorized:false`, `boardChanged:false`; en el resultado anidado también `stateChanged:false` y `needsFullLegalityCheck:true`. **No** devuelve manos, token, clave de idempotencia, diario de cartas ni autorización de juego.

El lector WAL puede consultar el estado previo a una revocación que aún no se ha confirmado en otra conexión; una vez confirmado el `COMMIT`, el token revocado debe ser rechazado por la siguiente lectura. No se usa `BEGIN IMMEDIATE` porque **no hay escrituras**. El futuro movimiento realmente autorizado necesitará su propia transacción escritora con nueva comprobación de identidad y reglas.

## Pruebas por nivel

**Composición pura (primera versión):** 11/11 casos evaluados sobre los módulos exactos recuperados de GitHub en un entorno **V8 aislado en modo estricto**. Se cargaron 14 módulos reales de geometría, perfiles, carta y órdenes, movimiento, reductor e intención. Se utilizó un sustituto JSON para `structuredClone` y dobles para imports `node:crypto`/`node:util` no invocados en esta suite; **no equivale a ejecutar `node:test` nativo**. Un primer intento en V8 sin modo estricto obtuvo 10/11 (una asignación a objeto congelado no lanzaba excepción); después se corrigió el arnés de comprobación y el resultado final fue 11/11, 0 fallos.

**Composición SQLite real:** se han escrito ocho casos nuevos en la suite ya existente `packages/sqlite-store/ancients-section-history.test.mjs`:

1. Autenticación + replay, respuestas privadas y conservación exacta de `matches`, `game_events` y `game_commands` entre dos conexiones.
2. Usuario externo, bando rival y sesión revocada sin tablero autorizado.
3. Campos cliente falsificados, revisión obsoleta y movimientos fuera del alcance.
4. Política de escenario y terreno únicamente del servidor.
5. Lectura WAL bajo bloqueo escritor y revocación de sesión tras confirmación.
6. Alteración de eventos del diario: error y cierre correcto de la transacción.
7. Partida sin laboratorio: denegación en lugar de ejecutar juego normal.
8. Metadatos privados añadidos al tablero y a las unidades del escenario persistido: exclusión rigurosa en la proyección.

**Los ocho casos SQLite están preparados pero NO ejecutados con Node.js/SQLite real.** Tampoco se ha ejecutado la regresión completa del manifiesto de **79 suites** sobre el SHA final. Se ha verificado la sintaxis de los cinco archivos JS modificados o relevantes; la sintaxis no acredita funcionamiento integrado.

## Condiciones de consolidación

La PR #96 continúa en **borrador**, basada en #95, y la seguridad de HTTP/SSE de SEC-001 (#93) sigue independiente. Antes de fusionar en `main`, es obligatorio validar las pruebas de composición bajo SQLite/WAL y las 79 suites con Node.js 22.16.0 o superior, comprobar privacidad bilateral y resolver la revisión reglamentaria de *Ancients*. No usar WSL, Docker ni GitHub Actions; no solicitar pruebas locales al usuario en esta etapa.

**No existe todavía movimiento reglamentariamente confirmado.** La etiqueta `PRIVATE_LAB_SIMULATION` jamás debe convertirse en `APPLIED` mediante un alias, una traza candidata o una respuesta HTTP.


## Corrección de privacidad y prueba de ausencia de contexto (12/11/2026)

Una revisión posterior identificó dos riesgos de prueba/contrato:

- El reductor copiaba `state.board` entero. Ahora el resultado
  `simulatedBoard` solo contiene `units:[{id,side,col,row}]` y
  `leaders:[]`, eliminando cualquier metadato inesperado de tablero
  o de unidades. Existen regresiones tanto en el reductor como en el
  helper puro, y un caso de integración con el diario SQLite que inyecta
  metadatos secretos en un escenario persistido.
- La función auxiliar `oneHexPreview(..., ctx=movementContext())` hacía
  que pasar `undefined` en una prueba activase el contexto por defecto.
  La prueba se ha corregido: usa `null` para el caso negativo y además
  llama directamente al método del almacén con `undefined` explícito,
  verificando que no se permite simular sin contexto del servidor.

**Evidencia actual:** 12 casos del reductor + 12 de composición pura =
**24/24 evaluaciones correctas** en V8 aislado estricto, con 15 módulos
reales recuperados de GitHub, clonación JSON sustitutiva y dobles para
imports nativos no ejercitados. Sintaxis aislada **4/4** para el reductor
y tres archivos de pruebas pertinentes. Son ahora **8 nuevos casos
escritos de composición SQLite**, no siete. **No se ha ejecutado
`node:test` con SQLite/WAL real** sobre este árbol, ni la regresión
de las 79 suites. La PR continúa en borrador y no debe integrarse en
`main` por estas comprobaciones parciales.


## Barrera HTTP — regresión añadida (13/11/2026)

La simulación autenticada permanece exclusivamente en los métodos internos del
almacén. Se han añadido **dos tests de regresión de API HTTP** a la suite
existente `packages/local-api/gateway.test.mjs` para preservar esta frontera
aunque cambien posteriormente el reductor o el router:

1. Un actor autenticado intenta usar GET y POST contra cuatro variantes
   de ruta (`lab/one-hex`, `one-hex`, `preview` y el nombre del método
   interno): deben devolver **404 NOT_FOUND**, sin resolver siquiera un
   almacén ni llamar al método de simulación.
2. Con una partida cuyo almacén proyecta `status:'LAB_ONLY'`, dos
   participantes intentan invocar `precheckExperimentalSectionOneHexIntent`
   a través de POST `/commands`, así como leer GET de la partida y su
   colección de eventos. Los tres accesos deben devolver **409
   SECTION_LAB_INTERNAL_ONLY**; los dobles de prueba fallan inmediatamente
   si se llama a `dispatch`, `publicEvents` o al método privado.

Se verificó la **sintaxis V8** del archivo de pruebas exacto de GitHub,
blob `3fbcc652cf14bcb58a50a7eefd7bd2de80fe50a3`; se registran
**10 casos** en esa suite, incluidos estos dos. **No se ha ejecutado la
suite con Node.js/HTTP nativos** ni la regresión de 79 suites. No se crea
ninguna ruta nueva de laboratorio ni se modifica el gateway de producción.

La ejecución nativa de SQLite y HTTP permanece bloqueada en este entorno
por la falta de checkout y de resolución DNS para GitHub. Hay Node.js
22.16.0 y `node:sqlite` instalados, pero esa disponibilidad **no
equivale a haber ejecutado las pruebas**. SEC-001 (#93) y la integración
completa continúan pendientes antes de cualquier despliegue o fusión en
`main`.
