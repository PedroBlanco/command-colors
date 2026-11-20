# CCWB — persistencia privada de rutas V2 de infantería (laboratorio)

**Integración:** #172, sobre `main@1ddd15f87a387dcdf82bd93c27bd7155b9d939fb`. Reutilización selectiva de la PR histórica #124.

La operación interna `store.stageExperimentalSectionFootPathV2Journal({sessionToken,expectedRevision,idempotencyKey,actions}, trustedScenario)` guarda **una trayectoria candidata de 1–2 hexágonos** en `matches.private_state.ancientsFootPathJournalV2Lab`. El escenario y tipos de tropa llegan de código de servidor, nunca de la petición. Se emplea `snapshotFootPathV2StageRequest` antes de SQL para copiar campos propios mediante descriptores, sin ejecutar getters.

Bajo `BEGIN IMMEDIATE`, el almacén revalida sesión y pertenencia, revisión pública y clave usada por comandos reales. El puente CCWB verifica completamente el historial persistido de cartas, órdenes, eventos y revisiones, compara el primer paso V1/V2 y calcula la propuesta y su firma semántica. Solo se actualiza el documento privado de la partida; no se modifica el tablero CCWB real, `game_revision`, `game_commands`, `game_events` ni la mano de nadie. No se incorpora ningún endpoint HTTP/SSE.

Un reintento exacto devuelve `SECTION_LAB_FOOT_PATH_V2_ALREADY_RECORDED` sin nueva escritura; una clave reutilizada con otro camino se rechaza. Una orden real de sección que supera las validaciones caduca el borrador en **la misma transacción** y prohíbe reutilizar su clave. Si el diario fue manipulado, se bloquea el avance antes de escribir. Un fallo de inserción de eventos revierte conjuntamente caducidad y revisión.

**Limitación:** esto NO autoriza ni ejecuta un movimiento de Ancients; no incorpora líderes, terreno, cartas especiales, ataques ni escenarios oficiales. Se conservan barreras del modo experimental SEC-001. La API es **interna**, no pública. La convivencia con antiguos diarios V1 se rechaza por clave y no se promueve automáticamente.

### Pruebas
Se recupera la suite pura de 20 casos de #124 y se incorporan 10 casos de integración SQLite seleccionados, sin las dos pruebas históricas que requieren un escritor V1 inexistente en este `main`. El inventario pasa **92 → 93 suites**. Quedan pendientes pruebas nativas sobre SHA exacto de esta rama y la regresión completa conjunta de `main` tras #169/#170.
