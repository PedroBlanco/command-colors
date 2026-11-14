# Ancients — persistencia privada y caducidad del diario V2 de trayectorias

**Fecha:** 15/11/2026 · **Issue:** [#97](https://github.com/PedroBlanco/command-colors/issues/97) · **Base:** PR #123 (`feat/ancients-foot-path-v2-private-journal`) sobre la cadena experimental hasta PR #108.

## Decisión y ámbito

El diario de trayectorias V2 de PR #123 puede almacenarse **como borrador interno de laboratorio**, de manera durable y con reintentos idempotentes, sin transformarlo en movimiento oficial. Se reutilizan las garantías transaccionales del CCWB V1: **identidad autenticada y pertenencia a la partida, revisión pública, historial completo de cartas/órdenes y escritura privada en una misma transacción `BEGIN IMMEDIATE`**.

La API incorporada es exclusivamente interna del almacén local:

```js
store.stageExperimentalSectionFootPathV2Journal(
  {sessionToken,expectedRevision,idempotencyKey,actions},
  trustedScenario // EXCLUSIVAMENTE servidor/laboratorio
)
```

`actions` contiene **una** acción `{kind:'UNIT',id,path}` con camino de **uno o dos hexágonos**. La sesión identifica al actor; **ninguna petición puede indicar actor, escenario, tablero, mano, carta, firma, resultado ni permisos**. La entrada es copiada y congelada por `snapshotFootPathV2StageRequest` antes de adquirir el bloqueo SQL, sin ejecutar getters ni trampas `Proxy.get`; los arrays son densos, acotados y sin campos ajenos.

## Admisión bajo bloqueo de escritura

En `sqlite.mjs`, la nueva operación ejecuta:

1. Verificación estricta de estructura y copia de `sessionToken`, revisión, clave y trayectoria antes de la transacción.
2. `BEGIN IMMEDIATE`: comprobación de **sesión viva** y pertenencia actual a la partida; bloqueo común con otros escritores, también de procesos diferentes.
3. Lectura de `matches` y validación de la revisión pública esperada. Rechazo de `(actor,idem_key)` ya presente en `game_commands`.
4. Exclusión **mutua V1/V2**: si existe `ancientsFootMovementJournalLab`, no se permite guardar `ancientsFootPathJournalV2Lab`, y viceversa. Una versión existente, aunque esté corrupta, no se sobrescribe silenciosamente.
5. `sectionHistory.proposeFootPathV2JournalStage`: vuelve a verificar el historial CCWB completo contra `game_events`, `game_commands`, firmas y revisión. Deriva la política y el estado inicial del **replay verificado de carta/órdenes** y del escenario sintético interno. `previewVerifiedSectionFootCore` valida la **primera arista**, las órdenes activas y la carta; el reductor V2 evalúa de nuevo esa arista y su resultado debe coincidir con V1. El reductor y diario V2 verifican entonces **toda la trayectoria**.
6. Si ya existe un diario V2, se recalcula desde CCWB y se comprueba contra partida, política, estado inicial y revisión provisional; **solo el reintento idéntico** de clave y camino devuelve `SECTION_LAB_FOOT_PATH_V2_ALREADY_RECORDED` sin escritura. Reutilizar la clave para otro recorrido o utilizar otra clave se rechaza. Un diario manipulado bloquea tanto el reintento como el posterior avance real de CCWB.
7. Para una propuesta nueva, una única actualización condicional `UPDATE matches SET private_state=? WHERE id=? AND game_revision=?` guarda el diario en `ancientsFootPathJournalV2Lab`. Si no se actualiza exactamente una fila se aborta; el rollback de `atomic` garantiza que no se produzcan escrituras parciales.

La operación no modifica `game_revision`, `lobby_revision`, el estado real de CCWB, `game_commands` ni `game_events`. La revisión del diario es **provisional**: una ruta de dos hexágonos incrementa **una sola revisión hipotética**. No se devuelve ni emite un evento oficial, ni se presenta la ruta privada a jugadores contrarios, HTTP o SSE.

## Caducidad transaccional en el siguiente comando real de sección

El CCWB `dispatch` incorpora `inspectFootPathV2StageForSectionAdvance` bajo el **mismo** bloqueo `BEGIN IMMEDIATE` y después de comprobar identidad, replay del historial completo, revisión e idempotencia confirmada. Si el comando oficial de carta/órdenes/fin de turno está aceptado:

- **Borrador ausente:** no impide avanzar.
- **Borrador V2 válido, misma revisión y partida, otra clave:** se elimina `ancientsFootPathJournalV2Lab` de `private_state` en el mismo `UPDATE` que cambia la revisión real. No aparece evento de movimiento V2.
- **Clave V2 igual a la del nuevo comando del mismo actor:** rechazo `SECTION_LAB_FOOT_PATH_V2_KEY_IN_USE` (no convertir el borrador en comando confirmado).
- **Diario corrupto, trasplantado de otra partida o con revisión desactualizada:** rechazo `SECTION_LAB_FOOT_PATH_V2_INTEGRITY_FAILED`, sin limpiar ni actualizar.
- **Borradores V1 y V2 coexistentes por manipulación externa:** rechazo explícito de conflicto de versiones.
- **Comando rechazado, revisión caducada, reintento confirmado o error en inserción real de evento/comando:** no se elimina el diario; el rollback preserva `private_state` y la revisión antigua.

La caducidad V1 de PR #117 permanece operativa de forma independiente; sus campos y contratos no se modifican.

## Límites de confianza

La nueva ruta sigue siendo **sintética y de laboratorio**, no una validación completa del reglamento. Las comprobaciones de la primera arista, órdenes y escenario requieren datos **del servidor**, nunca pruebas aportadas por un cliente. Las firmas del diario son de consistencia semántica, **no MAC ni prueba criptográfica de procedencia**. La comprobación al caducar verifica integridad interna y vínculo a partida/revisión; no certifica por sí sola el escenario oficial.

**Sin nuevo endpoint HTTP/SSE ni migración de esquema**, sin autorización de juego, sin reglas de terreno/líderes/cartas especiales y sin escritura oficial. Se mantienen todos los resultados `movementAuthorized:false`, `officialMovementAuthorized:false`, `canCommit:false`, `boardChanged:false`, `gameRevisionChanged:false`.

## Pruebas y ejecución

- Nueva suite **90**: `private-foot-path-v2-sqlite-stage.test.mjs`, **20 pruebas** de capturas inmutables, entradas hostiles, derivación CCWB, ruta de uno/dos hexágonos, primer paso concordante con V1, replay, idempotencia, segundo intento, escenario inválido, privados excluidos y caducidad.
- Ampliación de `ancients-section-history.test.mjs`: **12 nuevos tests nativos de SQLite**, escritos y pendientes de ejecución, para transacción duradera entre conexiones, privacidad ante ambos jugadores, reintentos, colisiones, actor/sesión, validación de escenario, V1/V2 excluyentes, caducidad, integridad y rollback con triggers de escritura y de inserción de evento.
- **20/20 pruebas aisladas** superadas con los módulos y tests recuperados de GitHub, en V8 estricto con emulación de `node:test` y clonación JSON. **No se han ejecutado los 12 tests nativos SQLite ni la regresión completa** en este entorno.
- Última regresión real de Windows aportada por el usuario: **1045/1045 en 80 suites** sobre PR #108. La cadena hasta PR #123 apuntaba a **1318 pruebas en 89 suites**; esta PR añade 20 + 12 = **1350 pruebas previstas en 90 suites**, **todavía no acreditadas en ejecución nativa**.

Mantener PR en **borrador** sobre #123, fuera de `main`, sin desplegar ni pedir pruebas locales mientras el usuario las mantiene pospuestas. SIGUEN pendientes reglas oficiales y escenario confiable, idempotencia persistida en `game_commands` para movimientos reales, commit atómico del estado oficial/registro/evento, replay y SEC-001 #94.
