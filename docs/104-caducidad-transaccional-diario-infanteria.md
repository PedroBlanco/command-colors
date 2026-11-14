# LAB-ANC — Caducidad transaccional del diario provisional de infantería

**Fecha:** 14/11/2026 · **Issue:** #97 · **Base:** PR #116 (`feat/ancients-private-foot-sqlite-stage`) · **Seguridad:** SEC-001 #94 abierta.

## Incidencia detectada

PR #116 añadió el diario privado `matches.private_state.ancientsFootMovementJournalLab`. El puente CCWB ya eliminaba `ancientsSectionMovementDraft` al confirmar una carta u orden, pero **no eliminaba el nuevo diario de infantería**.

El diario provisional está anclado a `matchId`, estado de partida, política y revisión CCWB. Si se acepta `END_EXPERIMENTAL_TURN`, CCWB cambia de revisión y de jugador; conservar el diario como si siguiera vigente deja una propuesta obsoleta en `private_state`, susceptible de interpretaciones erróneas por futuras operaciones.

## Invariantes corregidos

Se añade `inspectFootStageForSectionAdvance`, módulo puro `packages/ancients-rules/private-foot-stage-lifecycle.mjs`. Devuelve exclusivamente uno de estos estados privados inmutables:

| Estado | Significado |
|---|---|
| `ABSENT` | No existe diario provisional |
| `REPLACEABLE` | Existe un diario íntegro vinculado a la partida y revisión; un comando CCWB distinto puede desplazarlo |
| `KEY_CONFLICT` | El comando CCWB nuevo usa el mismo `(actor,idempotencyKey)` que el paso provisional |
| `CORRUPT` | Diario malformado, replay divergente, revisión, partida, contador o transición incoherente |

`REPLACEABLE` no significa «movimiento autorizado». La comprobación es únicamente de **coherencia interna**; no reemplaza la comprobación de procedencia independiente del escenario ni la autorización reglamentaria. El módulo usa `replayFootMovementJournal` y además comprueba `matchId`, revisión del estado inicial, revisión provisional y unicidad del paso.

En `createSqliteAncientsSectionBridge.dispatch`, dentro del **mismo `BEGIN IMMEDIATE`**, tras validar sesión/pertenencia, replay CCWB, idempotencia de comandos **ya confirmados**, revisión y aceptación reglada del nuevo comando del laboratorio:

1. Si el diario provisional es `CORRUPT`, devuelve `409 SECTION_LAB_FOOT_STAGE_INTEGRITY_FAILED` sin escritura; **nunca elimina evidencia corrupta silenciosamente**.
2. Si el comando nuevo reutiliza su clave, devuelve `409 SECTION_LAB_FOOT_STAGE_KEY_IN_USE` sin escritura. Esta comprobación es por partida y actor, compatible con la clave de `game_commands`.
3. Si el diario es `ABSENT` o `REPLACEABLE`, el comando CCWB sigue sus reglas y, **solo si queda confirmado**, elimina tanto `ancientsSectionMovementDraft` como `ancientsFootMovementJournalLab` del próximo `private_state`.
4. `matches`, `game_events` y `game_commands` se mantienen dentro de la transacción original. Si falla cualquier escritura (incluida la inserción del evento), `ROLLBACK` recupera el diario provisional exactamente como estaba.
5. **Ni un reintento `ALREADY_APPLIED`, ni una revisión obsoleta, ni un movimiento/carta rechazado** eliminan el diario; esas rutas retornan antes de la invalidación.

No se introducen cambios de esquema, nuevo endpoint HTTP/SSE ni movimientos oficiales. La operación que **sí confirma** una carta u orden es la operación de laboratorio CCWB ya existente; **el movimiento provisional de infantería no queda confirmado ni convertido en evento**. Los datos de órdenes y cartas ocultas siguen aislados.

## Pruebas añadidas

Se incorporan **11 casos**, todos en suites ya registradas (el manifiesto sigue en 83):

- **5 pruebas puras** en `private-foot-sqlite-stage.test.mjs`: ausencia del diario, invalidación permitida, colisión de clave y actor, diario alterado/revisión obsoleta/partida ajena y contexto mal formado.
- **6 pruebas de integración CCWB/SQLite** en `ancients-section-history.test.mjs`: `END_EXPERIMENTAL_TURN` elimina solo el diario provisional; clave cruzada bloqueada; comando rechazado u obsoleto conserva el diario; corrupción bloquea la transición; trigger temporal fuerza fallo de `game_events` y comprueba rollback sin borrar el diario; repetir una carta ya confirmada deja el borrador intacto.

**Verificaciones aisladas realizadas:** 14/14 casos puros de la suite ampliada en V8 estricto usando módulos reales del repositorio y una emulación de `node:test`; 6/6 escenarios del método `dispatch` real (5 con diario y transacción simulados, más un rechazo temprano de fase con `structuredClone` simulado). **No se han ejecutado los seis casos nuevos con SQLite real ni la regresión completa Node.**

Último resultado Windows confirmado sobre la PR #108: **1045/1045 pruebas, 80 suites**. Cadena posterior: #111–#116 suman 120 nuevas pruebas y esta etapa 11 adicionales. Objetivo **previsto y aún no verificado: 1176 pruebas en 83 suites**.

## Bloqueos siguientes

La corrección es requisito de seguridad y consistencia para la persistencia futura, pero **no entrega el movimiento oficial**. Quedan pendientes: autorización de reglas y escenarios verificables, replay de movimientos confirmados (no propuestas), idempotencia real de comandos, actualización atómica de tablero/revisiones/comandos/eventos y cierre de SEC-001 (#94). Mantener en borrador, sin integrar `main`, sin despliegue y sin exigir pruebas locales al usuario por ahora.
