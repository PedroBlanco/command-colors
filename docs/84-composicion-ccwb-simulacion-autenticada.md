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

**Composición pura:** 11/11 casos evaluados sobre los módulos exactos recuperados de GitHub en un entorno **V8 aislado en modo estricto**. Se cargaron 14 módulos reales de geometría, perfiles, carta y órdenes, movimiento, reductor e intención. Se utilizó un sustituto JSON para `structuredClone` y dobles para imports `node:crypto`/`node:util` no invocados en esta suite; **no equivale a ejecutar `node:test` nativo**. Un primer intento en V8 sin modo estricto obtuvo 10/11 (una asignación a objeto congelado no lanzaba excepción); después se corrigió el arnés de comprobación y el resultado final fue 11/11, 0 fallos.

**Composición SQLite real:** se han escrito siete casos nuevos en la suite ya existente `packages/sqlite-store/ancients-section-history.test.mjs`:

1. Autenticación + replay, respuestas privadas y conservación exacta de `matches`, `game_events` y `game_commands` entre dos conexiones.
2. Usuario externo, bando rival y sesión revocada sin tablero autorizado.
3. Campos cliente falsificados, revisión obsoleta y movimientos fuera del alcance.
4. Política de escenario y terreno únicamente del servidor.
5. Lectura WAL bajo bloqueo escritor y revocación de sesión tras confirmación.
6. Alteración de eventos del diario: error y cierre correcto de la transacción.
7. Partida sin laboratorio: denegación en lugar de ejecutar juego normal.

**Los siete casos SQLite están preparados pero NO ejecutados con Node.js/SQLite real.** Tampoco se ha ejecutado la regresión completa del manifiesto de **79 suites** sobre el SHA final. Se ha verificado la sintaxis de los cinco archivos JS modificados o relevantes; la sintaxis no acredita funcionamiento integrado.

## Condiciones de consolidación

La PR #96 continúa en **borrador**, basada en #95, y la seguridad de HTTP/SSE de SEC-001 (#93) sigue independiente. Antes de fusionar en `main`, es obligatorio validar las pruebas de composición bajo SQLite/WAL y las 79 suites con Node.js 22.16.0 o superior, comprobar privacidad bilateral y resolver la revisión reglamentaria de *Ancients*. No usar WSL, Docker ni GitHub Actions; no solicitar pruebas locales al usuario en esta etapa.

**No existe todavía movimiento reglamentariamente confirmado.** La etiqueta `PRIVATE_LAB_SIMULATION` jamás debe convertirse en `APPLIED` mediante un alias, una traza candidata o una respuesta HTTP.
