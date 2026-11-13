# Ancients — reductor puro restringido de infantería, terreno abierto

**Fecha:** 13/11/2026 · **Seguimiento:** [issue #97](https://github.com/PedroBlanco/command-colors/issues/97) · **Base:** PR #111 (`feat/ancients-staged-order-budget-preview`). Se mantiene `main` separado.

## Referencia reglamentaria

La fuente primaria es el reglamento de *Command & Colors: Ancients*, tercera edición (GMT Games, revisado el 20/10/2009), secciones 5–8, especialmente ordenación y movimiento de infantería:
https://www.gmtgames.com/living_rules/CC_Rules_2009.pdf

La base define que el movimiento se realiza de una unidad en una unidad, que las órdenes se asignan antes del movimiento y que una unidad no puede moverse más de una vez por turno. El motor actual contempla una fracción deliberadamente menor de las posibilidades completas: **un hexágono adyacente para infantería básica en terreno enteramente abierto y sin líderes**. No reproduce contenido protegido de las cartas.

## Separación del laboratorio

El módulo nuevo `packages/ancients-rules/core-open-foot-movement.mjs` es **independiente** de `staged-movement-preflight.mjs`, `staged-board-projection.mjs`, `clear-lab-movement-reducer.mjs`, `staged-order-budget.mjs` y de `CANDIDATE_EVIDENCE`.

- `reduceCoreOpenFootStep({state,action,policy})`: comprueba las restricciones propias de este subconjunto y **propone** un nuevo estado, marcando la unidad como movida en `orderLedger.movedUnitIds` y aumentando la revisión de la propuesta. Devuelve `RULE_TRANSITION_CANDIDATE` o `BLOCKED`.
- `replayCoreOpenFootSteps({initialState,actions,policy})`: reproduce una secuencia determinista sobre estados nuevos. Si alguna acción es inválida, devuelve `BLOCKED`, con `nextState:null` y `transitions:null`, sin exponer resultados parciales. Devuelve `RULE_REPLAY_CANDIDATE` si todas las acciones se comprueban correctamente.

Las estructuras devueltas son profundamente inmutables; la entrada nunca se modifica. La transición propuesta puede contener solo `side`, `revision`, `unitId`, `from` y `to`, sin datos privados ni credenciales.

## Contrato de estado mínimo

`state` es una **proyección servidor verificable**, no un objeto que deba aceptarse desde el navegador:

```js
{
  kind: 'ANCIENTS_OPEN_FOOT_MOVEMENT_CORE_V1',
  schemaVersion: 1,
  ruleset: 'ancients-base-3e-2009',
  revision: 2,
  turn: 'A',
  phase: 'MOVE',
  board: {
    units: [{id:'unitA',side:'A',col:2,row:4}],
    leaders: []
  },
  orderLedger: {
    issuedUnitIds: ['unitA'],
    movedUnitIds: []
  }
}
```

El reductor comprueba campos exactos, geometría 13×9, identificadores y posiciones sin duplicados, órdenes referidas exclusivamente a piezas propias y unidades movidas que sean subconjunto de las ordenadas. La lista `issuedUnitIds` **no se consume**: `movedUnitIds` registra la prohibición de mover una misma unidad dos veces, pero esa unidad puede conservar sus opciones de combate cuando se implemente su fase.

La **acción mínima**, suministrada por el servidor después de examinar y normalizar la intención, es `{actor,expectedRevision,unitId,to:{col,row}}`. No se admiten `sessionToken`, `matchId`, `CANDIDATE_EVIDENCE`, tablero, cartas, terreno, firmas ni ningún resultado de autorización calculado por el cliente.

La `policy` es un contexto **de confianza del servidor**: `{scope:'BASE_FOOT_OPEN_ONE_HEX_V1',ruleset:'ancients-base-3e-2009',cardFamily:'ORDINARY_SECTION',terrain:[],scenarioExceptions:[],unitTypes:{...}}`. Debe cubrir **todas** las unidades presentes con perfiles conocidos. Ni `scope` ni `cardFamily` son credenciales; en producción debe demostrarse su procedencia del reglamento, escenario y replay de órdenes, dentro de la transacción.

## Casos contemplados y denegados

En esta primera iteración se permiten, con destino libre y adyacente, **infantería ligera, ligera con honda, ligera con arco, auxilia, media y pesada**. Se excluye el movimiento de cualquier otra clase; una unidad de otro tipo puede estar en el tablero como obstáculo sin poder ejecutar una acción con este reductor.

Se rechazan por defecto:

- Ausencia de orden de la unidad, bando contrario, revisión obsoleta, fase distinta de `MOVE` y unidades ya movidas.
- Destino ocupado por unidad propia o enemiga, fuera del tablero, igual al origen o no adyacente.
- Presencia de **cualquier líder**, aun cuando no acompañe a la unidad que se mueve.
- **Cualquier terreno** en el escenario, incluso fuera de la trayectoria, y **cualquier regla especial** de escenario o carta que no sea una carta ordinaria de sección.
- Caballería, guerreros con carga, elefantes, carros, máquinas de guerra, movimientos de más de un hexágono, combate, retirada, evasión y reglas de expansión.
- Estados o órdenes alterados, perfiles de unidades ausentes/sobrantes y peticiones con campos de autoridad fabricados.

El rechazo no entrega tablero parcial ni evento de movimiento.

## Garantías y límites de autorización

**No existe una API de confirmación.** Las banderas `movementAuthorized`, `officialMovementAuthorized`, `attackAuthorized` y `canCommit` siguen siendo siempre `false`; `dbChanged:false`. El marcador `BASE_FOOT_OPEN_STEP_PROPOSAL_V1` **no** es un evento de juego y no puede guardarse como `ANCIENTS_MOVEMENT_COMMITTED_V1`.

Para convertirlo en movimiento confirmado sigue siendo necesario:

1. Reconstruir estado, órdenes emitidas y marcadores ya movidos **exclusivamente desde historial servidor**.
2. Verificar reglas/escenarios/cartas reales, pertenencia y sesión **dentro de `BEGIN IMMEDIATE`** y denegar modos no soportados.
3. Ejecutar el reductor sobre una copia y registrar de forma atómica el tablero, órdenes, revisión, idempotencia, `game_commands` y `game_events` mínimos, con rollback ante cualquier fallo.
4. Reproducir el estado desde eventos/órdenes persistidos; revisar SSE y HTTP (SEC-001 #94) antes de desplegar.

## Pruebas

Nueva suite: `packages/ancients-rules/core-open-foot-movement.test.mjs`, registrada en `LOCAL_TEST_FILES` como **suite 81**. Contiene **20 pruebas**: tipos permitidos, movimiento simple y consecutivo, no-movimiento, duplicado, órdenes ajenas, geometría, colisiones, perfiles no cubiertos, terreno/líderes/excepciones, manipulación de entradas, desbordamiento, inmutabilidad, replay y atomicidad de fallos.

**Verificación inicial aislada:** 20/20 casos ejecutados sobre el código real recuperado de GitHub mediante V8 estricto, con un simulador de `node:test` y sustituyendo `structuredClone` por copia JSON. **No es una ejecución nativa con Node, no hay SQLite real y no se ha verificado la regresión completa de esta rama.**

La base PR #108 fue validada con **1045/1045 pruebas en 80 suites**; la PR #111, intermedia, incluye **17 casos nuevos** sin validación nativa comunicada. Con los 20 casos nuevos de esta rama, el total **previsto** es **1082 pruebas en 81 suites**, todavía pendiente de confirmar en Windows. No fusionar a `main` ni habilitar movimientos reales.
