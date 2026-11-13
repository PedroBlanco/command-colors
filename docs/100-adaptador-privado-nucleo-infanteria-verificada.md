# LAB-ANC — Adaptador privado de historial verificado al núcleo de infantería

**Fecha:** 13/11/2026 · **Issue:** #97 · **Base:** PR #112 (`feat/ancients-core-foot-open-step-reducer`), apilada sobre PR #111 → #108.

## Objetivo y frontera de confianza

La PR #112 introdujo `reduceCoreOpenFootStep`, un reductor puro que **no puede confiar** en un estado inventado por el cliente. Esta iteración aporta el primer ensamblador de entrada para dicho reductor desde **un estado de cartas y órdenes reconstruido mediante replay CCWB**.

La función `previewVerifiedSectionFootCore`, en `packages/ancients-rules/verified-foot-core-preview.mjs`, recibe un `verifiedState` exclusivamente del puente interno. Por sí sola no autentica ni verifica el origen; quien garantiza la procedencia es `createSqliteAncientsSectionBridge.verify(resultRow())`, invocado dentro de una lectura WAL en que ya se validaron la sesión y la pertenencia.

**Este ensamblador es una consulta de laboratorio, no una implementación de jugadas reales.** El diario experimental de cartas/órdenes todavía no conserva movimientos confirmados. Por eso solo se permite **el primer paso hipotético de una unidad**, sin movimientos previos, sin persistirlo y sin encadenarlo como autoridad.

## Secuencia del flujo interno

1. Un llamador de servidor prepara `trustedScenario` con exactamente `{scope,ruleset,unitTypes,terrain,scenarioExceptions}`. `scope` debe ser `SYNTHETIC_OPEN_HEX_V1` y `ruleset` debe ser `ancients-base-3e-2009`. Ambos arrays de terreno y excepciones deben estar **vacíos en todo el escenario**. Los tipos deben cubrir exactamente el censo de unidades.
2. El método privado `store.precheckExperimentalSectionVerifiedFootCore(request,trustedScenario)` captura `{sessionToken,expectedRevision,actions}` mediante descriptores propios y copia inmutable de `snapshotStagedSequenceRequest`. Deniega propiedades falsas, getters y arrays irregulares.
3. `readSnapshot()` abre **una única instantánea de lectura SQLite/WAL**; dentro, `resolveSectionLabActor()` verifica credencial vigente y pertenencia y se comprueba que la partida sigue en modo de laboratorio.
4. `sectionHistory.previewVerifiedFootCore` ejecuta `verify(resultRow())`: comprueba el replay de comandos privados, eventos públicos, firmas, revisiones y coincidencia con la instantánea del diario almacenada.
5. El adaptador comprueba fase `LAB_RESOLUTION_PENDING`, turno, revisión, orden emitida de la unidad, censo, posiciones de todas las órdenes, equivalencia semántica de mapas de sectores, coherencia de carta ordinaria/sección/mano y ausencia de líderes.
6. Se construye por **lista blanca** una proyección mínima para el reductor: `board.units:[{id,side,col,row}]`, `leaders:[]`, `orderLedger.issuedUnitIds` de las órdenes verificadas y `movedUnitIds:[]`. La fase sintética de cálculo se fija a `MOVE` **solo en esa proyección**; la fase del diario CCWB **no cambia**.
7. Se forma la política **solo a partir del contexto confiable** y se ejecuta el reductor independiente `reduceCoreOpenFootStep` sobre un paso unitario. Este último comprueba por sí mismo tipo de infantería admitido, colisiones, geometría de un hexágono, orden propia y estado de movimiento.
8. Se devuelve `SECTION_LAB_VERIFIED_FOOT_CORE_PREVIEW` con `PRIVATE_CORE_FOOT_PROPOSAL` o una denegación sin `proposal`. Nunca se copia la mano, el mazo, el token de sesión, el historial de claves privadas, el tablero extendido ni ningún resultado de autorización del cliente.

El reductor no se llama basándose únicamente en `CANDIDATE`, `CANDIDATE_SEQUENCE`, `CANDIDATE_EVIDENCE` o en un SHA-256: la verificación de órdenes sirve como precondición independiente y **la geometría la valida de nuevo el núcleo**.

## Comportamiento ante denegaciones

La operación rechaza en diferentes capas, sin exponer una propuesta parcial:

- Credencial inexistente/revocada: `401 UNAUTHENTICATED`.
- Ausencia de pertenencia: `404 NOT_FOUND`.
- No estar en laboratorio: `409 SECTION_LAB_NOT_INITIALIZED`.
- Formato manipulado: `400 INVALID_SECTION_LAB_FOOT_CORE_REQUEST`.
- Bando rival, revisión obsoleta, órdenes/cartas contradictorias, mapas de sector alterados: `BLOCKED` con `proposal:null`.
- Dos acciones, líder o trayectoria de más de un paso, escenario real/terreno/excepciones o tipos de unidad no soportados: `BLOCKED`.
- Diario SQLite manipulado: **error de integridad de replay**; nunca se construye la propuesta.

La salida de éxito y el rechazo incorporan **`movementAuthorized:false`, `officialMovementAuthorized:false`, `attackAuthorized:false`, `canCommit:false`, `dbChanged:false`** y `boardChanged:false` en el wrapper. Un `RULE_TRANSITION_CANDIDATE` **no es** `ANCIENTS_MOVEMENT_COMMITTED_V1`, ni aumenta `game_revision`.

## Pruebas y evidencia

Se agregan **18 casos** a dos suites **existentes**, manteniendo el manifiesto de **81 suites**:

- **11 puros** en `core-open-foot-movement.test.mjs`: propuesta, turno/revisión, carta y órdenes alteradas, sectores reordenados/equivalentes o manipulados, líderes, política sin terreno/excepciones, rechazo de varias acciones, colisión, perfiles, privacidad e inmutabilidad.
- **7 de integración SQLite/CCWB** en `ancients-section-history.test.mjs`: sesión auténtica y replay en WAL sin cambiar ninguna de las tablas, rival/no miembro/revocación, peticiones falsas, escenario excluido, captura inmutable ante mutación durante la sesión, WAL bajo bloqueo de otra conexión y diario persistido falsificado.

**Evidencia ejecutada en este desarrollo:**

- **31/31** pruebas de la suite pura (20 existentes de PR #112 y 11 nuevas) con código real descargado del repositorio, en V8 estricto y con simulador de `node:test`; `structuredClone` sustituido por clonación JSON.
- **9/9** escenarios de los métodos reales extraídos de CCWB/SQLite, con sesiones, lecturas WAL y replay **simulados**, no SQLite nativo.
- Sintaxis V8 correcta de los **cinco archivos** de código y pruebas modificados.

**No hay pruebas nativas de esta nueva rama**: no se han ejecutado `node:test` real, las 7 pruebas nuevas de SQLite, ni la regresión completa. Las pruebas previas reportadas por el usuario (**1045/1045**) corresponden solo al HEAD de la PR consolidada #108, no al árbol de #111/#112 ni a este.

Con 17 casos de #111 + 20 de #112 + 18 de esta rama, la regresión **prevista**, no comprobada, es **1100 pruebas en 81 suites**.

## Límites antes de autorizar movimientos

El paso siguiente requiere una **autoridad de escritura distinta** que trabaje exclusivamente con partidas reglamentarias (no la partida `LAB_ONLY`), escenarios/terreno/carta oficiales verificados, estado de movimiento anterior, validación de identidad y revisión **dentro de `BEGIN IMMEDIATE`**, idempotencia, consumo o reserva real de órdenes, modificación atómica de `matches`, `game_commands` y `game_events`, reversión íntegra y replay reproducible. Sigue pendiente SEC-001 (#94) y la comprobación del reglamento completo para cualquier movimiento fuera del subconjunto de infantería definido.

No publicar HTTP/SSE, no fusionar a `main`, no desplegar ni requerir pruebas locales al usuario en esta etapa.
