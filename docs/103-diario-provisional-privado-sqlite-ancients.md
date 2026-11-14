# LAB-ANC — Persistencia privada de un paso hipotético de infantería en SQLite

**Fecha:** 14/11/2026 · **Issue:** #97 · **Base:** PR #115, sobre #114 → #113 → #112 → #111 → #108.

## Alcance y aislamiento

Esta etapa conecta el contrato de diario reproducible de PR #115 con SQLite, **pero únicamente como un borrador privado y sintético**: nunca confirma una jugada de *Command & Colors: Ancients*. Se permite **exactamente un paso provisional de una unidad de infantería** en terreno íntegramente abierto, sin líderes ni reglas especiales, de una secuencia de órdenes CCWB validada.

No existe ruta HTTP/SSE para esta operación. No se genera ni almacena `ANCIENTS_MOVEMENT_COMMITTED_V1`, ni siquiera se escribe el evento de propuesta `FOOT_STEP_PUBLIC_EVENT_PROPOSAL_V1` en `game_events`.

Se mantiene el esquema SQLite v1 original de **seis tablas**, sin migraciones. Solo se añade en `matches.private_state` la propiedad **`ancientsFootMovementJournalLab`**, que contiene el diario privado y reproducible creado por `foot-movement-journal.mjs`. Se conserva íntegramente la instantánea de cartas/órdenes `ancientsSectionHistoryLab`.

**Las columnas `matches.game_revision` y `matches.lobby_revision` no cambian**. Tampoco se añaden filas a `game_commands` ni a `game_events`. El campo `journal.state.revision` es una **revisión provisional exclusivamente privada** (p. ej. 3 tras un paso sobre la revisión CCWB 2) que no debe confundirse con `game_revision` ni exponerse como SSE de juego.

## Flujo de `stageExperimentalSectionFootJournal(request,trustedScenario)`

1. Captura una única vez `{sessionToken,expectedRevision,idempotencyKey,actions}` mediante `snapshotFootTransactionProbeRequest`, que solo admite una acción `UNIT` y un hexágono, y rechaza propiedades extra, getters, símbolos y listas mal formadas.
2. Abre **`BEGIN IMMEDIATE`** en el mismo SQLite/WAL que contiene sesiones, usuarios y partidas.
3. Dentro del bloqueo, verifica sesión viva, pertenencia a la partida, inicialización LAB y coincidencia estricta de `expectedRevision` con `matches.game_revision`.
4. Comprueba que la clave no pertenece ya a una carta u orden existente en `game_commands` para el mismo actor/partida.
5. Carga `private_state`. Si existe `ancientsFootMovementJournalLab` con `null` o estructura básica inválida, **no lo sustituye silenciosamente**: devuelve `FOOT_LAB_PERSISTED_JOURNAL_DRIFT`.
6. El puente `sectionHistory.proposeFootJournalStage` verifica de nuevo **todo el replay CCWB de cartas/órdenes, eventos, claves y snapshot**; solo entonces llama a `planPrivateFootSqliteStage`.
7. El planificador ejecuta `previewVerifiedSectionFootCore` de #113 para validar turno, carta, órdenes, posiciones, escenario sintético y el primer movimiento. Reconstruye **por lista blanca** el estado inicial del reductor y su política del contexto servidor.
8. `initializeFootMovementJournal` y `proposeFootMovementJournalAppend` generan un diario privado que debe reproducir exactamente el mismo estado hipotético que el reductor independiente. `checkFootJournalAnchor` lo vincula a `matchId`, estado inicial y política recién derivados del historial CCWB, así como a la revisión provisional esperada.
9. Si no había diario, se almacena `{...persisted,ancientsFootMovementJournalLab:plan.journal}` mediante `UPDATE matches SET private_state=? WHERE id=? AND game_revision=?`. En caso de error o conflicto, `atomic` ejecuta rollback.
10. Si el diario ya contiene un paso, se comprueba replay y anclaje contra el CCWB verificado. **El mismo actor, clave y comando** devuelve `SECTION_LAB_FOOT_STAGE_ALREADY_RECORDED` **sin escribir otra vez**; el mismo actor/clave con otra intención devuelve `FOOT_LAB_IDEMPOTENCY_CONFLICT`. Otra clave devuelve `FOOT_LAB_ONE_STEP_ONLY`. Nunca se añade un segundo paso.

La clave de idempotencia queda **persistida en el propio diario privado** y no se registra en `game_commands`: esta última tabla sigue reservada para los comandos de cartas/órdenes realmente aplicados. El tipo `ALREADY_APPLIED` queda excluido, porque no se ha aplicado movimiento real.

### Respuestas internas

| Situación | Código | ¿Cambia `private_state`? |
|---|---|---|
| Primera propuesta válida | `200 SECTION_LAB_FOOT_STAGE_SAVED` | **Sí**, solo diario privado |
| Reintento semánticamente idéntico | `200 SECTION_LAB_FOOT_STAGE_ALREADY_RECORDED` | No |
| Petición mal formada | `400 INVALID_SECTION_LAB_FOOT_STAGE_REQUEST` | No |
| Sesión no válida / no pertenece | `401 UNAUTHENTICATED` / `404 NOT_FOUND` | No |
| Revisión obsoleta | `409 STALE_REVISION` | No |
| Clave ya asignada a carta/orden | `409 SECTION_LAB_FOOT_IDEMPOTENCY_KEY_IN_USE` | No |
| Segunda propuesta, conflicto o diario corrupto | `409 SECTION_LAB_FOOT_STAGE_REJECTED` | No |

Solo se devuelve `provisionalRevision` y metadatos de control, nunca el diario, el tablero, el identificador de unidad, la mano del contrario, la clave o el token. Todas las respuestas de éxito incluyen `movementAuthorized:false`, `officialMovementAuthorized:false`, `canCommit:false`, `boardChanged:false` y `gameRevisionChanged:false`. `privateDraftChanged:true` **solo se usa cuando hubo escritura privada real**, sin afirmar que el juego se haya modificado.

## Invariantes y riesgos aún abiertos

- **La política `trustedScenario` se considera dato interno del servidor de pruebas.** No es una autorización para escenarios oficiales ni debe aceptar valores procedentes del navegador.
- Tras guardar el paso provisional, si cambia la carta, las órdenes o la revisión CCWB, el diario privado anterior queda obsoleto: la revisión/estado deben verificarse antes de permitir nuevos cálculos. Esta etapa no habilita reinicios automáticos ni sucesivos turnos de juego para ese diario.
- Una firma de coherencia versionada del diario no es un MAC ni protege de quien pueda modificar libremente toda la base. La comprobación de origen se apoya en el historial CCWB verificado y en la política suministrada por el servidor.
- La idempotencia persistida **solo cubre este paso hipotético privado**, no las futuras operaciones oficiales de movimiento. La reserva de claves en `game_commands` y el registro de eventos oficiales siguen pendientes.
- Antes de un verdadero commit hace falta una modalidad **reglamentaria** independiente de `LAB_ONLY`, reglas completas aplicables, procedencia verificada de escenarios/cartas/terreno, estado y órdenes reales, sesión y pertenencia dentro de `BEGIN IMMEDIATE`, operación atómica `matches`/`game_commands`/`game_events` y replay de movimientos realmente confirmados. Sigue abierta SEC-001 #94.

## Pruebas y evidencias

Nuevos **20 casos** en dos suites:

- **9 pruebas puras** en la nueva `packages/ancients-rules/private-foot-sqlite-stage.test.mjs` (suite **83**) para crear y repetir, conflicto de clave, un solo paso, diario alterado, otra partida, actor no autorizado, reglas excepcionales y privacidad.
- **11 pruebas CCWB/SQLite** añadidas a `packages/sqlite-store/ancients-section-history.test.mjs` (suite ya existente): persistencia y reapertura, no alteración del estado oficial o eventos, retry sin escrituras, clave en `game_commands`, entradas falsas, revocación/rival, mutación durante autenticación, bloqueo de otro escritor y diario corrupto o `null`.

**Evidencia ejecutada:** 9/9 pruebas puras nuevas sobre los módulos y la suite reales en V8 estricto con simulación de `node:test`; 10/10 escenarios aislados de la función de store real, con modelo/planificador/reglas reales pero sustituyendo SQLite y la verificación CCWB por dobles de prueba. **No se ha ejecutado la batería de integración con SQLite nativo ni la regresión Node real**: el entorno disponible no puede resolver GitHub para obtener un checkout completo y el usuario no puede probar localmente ahora.

El último resultado nativo aportado por el usuario es **1045/1045 pruebas, 80 suites** sobre la PR #108. Las PR #111–#115 sumaron 100 casos y esta añade 20: **regresión prevista, no validada: 1165 pruebas en 83 suites**. No debe usarse esta previsión como un resultado PASS.

Mantener esta PR en borrador, fuera de `main`, sin despliegue ni endpoints y sin solicitar pruebas al usuario en esta etapa.
