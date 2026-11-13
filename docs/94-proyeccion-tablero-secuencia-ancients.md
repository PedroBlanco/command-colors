# LAB-ANC — Proyección determinista de tablero para secuencias de unidades y líderes

**Fecha:** 13/11/2026. **Rama:** `feat/ancients-staged-board-projection`, apilada sobre PR #106.  
**Seguimiento:** [#97](https://github.com/PedroBlanco/command-colors/issues/97). **Estado:** prevalidación privada, no autorización reglamentaria.

## Problema

La simulación `clear-lab-movement-reducer.mjs` estaba restringida a movimiento de unidades de un hexágono, sin líderes, sin terreno y con una política sintética. La consulta `precheckStagedAncientsMovementSequence` podía describir una secuencia hipotética con unidades y líderes, pero no ofrecía una **proyección pública de las posiciones finales**, sin persistir ni comprometer una partida. El siguiente paso previo al reductor definitivo es comprobar esas transformaciones sobre una copia separada.

## Implementación

`packages/ancients-rules/staged-board-projection.mjs` exporta `projectStagedAncientsBoard` y una versión de contrato `PRIVATE_STAGED_BOARD_PREVIEW_V1`.

1. Exige que `precheckStagedAncientsMovementSequence` devuelva `CANDIDATE_SEQUENCE` tras comprobar fase, revisión, bando, órdenes completas, tipos, trayectorias y terreno de servidor. La persona que lo invoque **debe autenticar** y verificar antes el replay CCWB de esa partida.
2. Construye una copia de tablero exclusivamente con `{id,side,col,row}` de unidades y líderes. No conserva atributos extra, mano, carta, diario, identidad de sesión ni datos privados.
3. Reproduce cada paso calculado comprobando otra vez posición de origen, ocupación en destino, líder transportado, separación y llegada a una unidad. Si detecta desajustes, descarta el tablero provisional completo.
4. Comprueba después de cada paso que los identificadores y las posiciones no se dupliquen y que un líder no termine junto a una unidad enemiga.
5. Devuelve exclusivamente un objeto congelado `PRIVATE_BOARD_CANDIDATE` con `projectedBoard`, `moves` y banderas de **no autorización**: `movementAuthorized:false`, `officialMovementAuthorized:false`, `attackAuthorized:false`, `canCommit:false`, `stateChanged:false`, `needsFullLegalityCheck:true`.

Ante cualquier rechazo recuperable del preflight se devuelve `BLOCKED` con `projectedBoard:null`, `moves:null` y `moveCount:0`. Los errores de contexto interno no válido mantienen el comportamiento de fallo de contrato del preflight; el módulo no pretende sanear datos de red de forma independiente.

No introduce una ruta HTTP/SSE, no escribe en SQLite ni altera `game_events`, `game_commands`, el estado de cartas o los contadores de revisión.

## Pruebas y evidencia

Se han añadido **seis casos** a la suite registrada `staged-movement-preflight.test.mjs`: líder que se separa y unidad que avanza después; unidad que transporta líder; segunda acción ilegítima sin resultado parcial; orden hermana falsificada, bando o revisión incorrectos; eliminación de datos privados e inmutabilidad; determinismo y ausencia de cambios en origen.

Verificación disponible: **10/10 escenarios V8 aislados** sobre el código exacto publicado del nuevo módulo (blob `ab44a20618f4adb3117e98a61a05fc9380d83583`) con el preflight sustituido por un doble deliberado. Incluye ataques de posición, líder incorrecto, colisiones, estado parcial, privacidad y respuesta de denegación. **No es** una ejecución de las seis pruebas integradas, ni `node:test` sobre la rama, ni integración SQLite/CCWB/HTTP/SSE. El manifiesto se conserva sin suites nuevas y sigue enumerando 80 archivos.

## Límites y siguiente etapa

La proyección no decide legalidad oficial ni excepciones de cartas, líderes, terreno, combate, escenarios o edición concreta. No confundir `PRIVATE_BOARD_CANDIDATE` con `ANCIENTS_MOVEMENT_COMMITTED_V1`. Para alcanzar el objetivo #97 aún falta un reductor reglamentario verificado; autorización en `BEGIN IMMEDIATE` frente a la sesión y órdenes reales; consumo atómico, idempotencia, eventos mínimos, replay y cierre de SEC-001 #94. Mantener las PR apiladas en borrador, `main` intacta, sin despliegue y sin solicitar pruebas locales al usuario mientras dure su pausa.
