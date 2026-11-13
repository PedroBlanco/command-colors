# LAB-ANC — Presupuesto provisional de órdenes y bloqueos por líderes

**Fecha:** 13/11/2026. **Seguimiento:** [#97](https://github.com/PedroBlanco/command-colors/issues/97). **Base:** [PR #108](https://github.com/PedroBlanco/command-colors/pull/108), HEAD validado en Windows `11c9ced46a2c6d7416749f93ff4d51851e99cd04` (1045/1045 pruebas, 80 suites). Esta rama está separada de `main`.

## Objetivo

Registrar de manera **determinista, privada e inmutable** qué órdenes quedarían usadas o bloqueadas tras una secuencia de movimiento de unidades y líderes. La distinción evita atribuir falsamente una segunda orden al líder transportado por una unidad, y distingue una orden todavía disponible de otra que, aunque no se gastó, ya no puede utilizarse por las reglas de secuencia de movimiento.

**No es un contador real del turno ni un reductor reglamentario:** no actualiza la partida, no consume órdenes, no modifica revisiones, no crea comandos/eventos y no autoriza movimientos.

## Semántica del planificador

`previewStagedAncientsOrderBudget({state,actor,expectedRevision,actions,serverContext})`, en `packages/ancients-rules/staged-order-budget.mjs`, llama a `projectStagedAncientsBoard`. Solo si toda la secuencia devuelve `PRIVATE_BOARD_CANDIDATE`, calcula el uso hipotético de **cada orden** contenida en `state.orderSnapshot.pieces`:

| Estado | Significado provisional |
|---|---|
| `USED` | La pieza ha ejecutado directamente una acción en la secuencia hipotética |
| `LOCKED` | La pieza tenía una orden independiente, pero el transporte/incorporación de un líder impide que la use después |
| `AVAILABLE` | La pieza tenía una orden y ni la utilizó ni quedó bloqueada por la secuencia simulada |

Casos críticos:

- Una unidad que transporta a un líder ordenado de manera independiente produce **unidad USED**, **líder LOCKED**. No implica gastar dos órdenes.
- El líder ordenado se separa de una unidad que después se mueve: **dos USED**, sin órdenes bloqueadas.
- Si el líder se separa, pero su unidad no se mueve: **líder USED**, **unidad AVAILABLE**.
- Un líder que se incorpora a una unidad ordenada y todavía estacionaria: **líder USED**, **unidad LOCKED**.
- Una unidad que entra en el hexágono de un líder estacionario también ordenado: **unidad USED**, **líder LOCKED**.
- Una acción posterior que intente mover una pieza bloqueada es rechazada por el preflight de secuencia; ninguna acción parcial se publica.

En éxito se devuelve `PRIVATE_ORDER_BUDGET_CANDIDATE` con `orders:[{kind,id,status}]`, `wouldUseCount`, `lockedCount`, `availableCount`, `totalOrders`, el tablero público tentativo y la secuencia provisional de pasos. Toda la estructura queda congelada; solo contiene identificadores/posiciones públicos del tablero y **órdenes propias del actor**, no manos, cartas, tokens, traza CCWB ni metadatos privados del escenario. Aunque las posiciones son públicas, **la clasificación de órdenes es privada** y no debe emitirse en SSE/HTTP.

En denegación se devuelve `BLOCKED` sin tablero, movimientos ni órdenes: los contadores son cero. Todas las respuestas, incluido éxito, tienen `movementAuthorized:false`, `officialMovementAuthorized:false`, `attackAuthorized:false`, `canCommit:false`, `stateChanged:false`, `labSimulationOnly:true` y `needsFullLegalityCheck:true`.

## Composición privada CCWB/SQLite

Se añade exclusivamente el método interno `precheckExperimentalSectionOrderBudget(request,trustedContext)`:

1. Captura la petición de sesión/revisión/secuencia mediante `snapshotStagedSequenceRequest`, sin getters ni relecturas del objeto original.
2. Dentro de **una sola lectura WAL**, autentica sesión y pertenencia, verifica el modo de laboratorio y obtiene actor/bando servidor.
3. El puente `previewOrderBudget` verifica **replay íntegro CCWB** del diario privado y entonces calcula el presupuesto provisional sobre el estado verificado.
4. Devuelve `SECTION_LAB_ORDER_BUDGET_PREVIEW` únicamente al llamador interno. La petición no puede proporcionar actor, tablero, terreno, mano o resultados calculados.

No se agrega ninguna ruta HTTP/SSE, operación de escritura, cambio de esquema, idempotencia o transición del diario privado.

## Pruebas y límites

**17 pruebas nuevas en 2 suites existentes** (el manifiesto permanece en 80):

- **10 puras**, sobre uso, disponibilidad y bloqueos de órdenes, separación/incorporación de líderes, secuencias incompletas, rechazo sin tablero parcial, identidad/revisión, determinismo, inmutabilidad y privacidad.
- **7 de integración CCWB/SQLite**, sobre replay/WAL sin escrituras, líder transportado, unidad disponible, pertenencia/revocación, petición ilegal, Proxy y getter, y lectura mientras otra conexión tiene `BEGIN IMMEDIATE`.

Verificaciones aisladas disponibles: **9/9 escenarios** con los 11 módulos puros reales; **9/9 pruebas reales de la suite pura** bajo simulador de `node:test` en V8 (antes de añadir el décimo caso); **9/9 verificaciones V8** del método interno SQLite y puente CCWB reales con base/sesiones/replay **simulados**; y sintaxis V8 correcta de los cinco archivos modificados antes de las dos últimas pruebas añadidas.

**No se ha ejecutado la nueva rama mediante `node:test` nativo ni SQLite real.** Los resultados Windows previos de **1045/1045** son solo de la versión base de PR #108; con 17 casos nuevos el total previsto es **1062 pruebas en 80 suites**, pendiente de verificar. No atribuir a esta rama la regresión de la base.

## Requisitos antes de confirmar movimientos

Debe existir reductor oficial que maneje las excepciones de cartas, terreno, líderes y combatientes, verificaciones completas bajo `BEGIN IMMEDIATE`, consumo real de órdenes, actualización atómica de tablero/comandos/eventos, revisión e idempotencia, replay determinista y cierre de SEC-001 (#94). Los estados `USED/LOCKED/AVAILABLE` de esta vista **no son una autorización ni pueden emplearse como prueba de una jugada válida**.
