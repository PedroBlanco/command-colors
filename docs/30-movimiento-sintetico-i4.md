# CCW-014 — Contrato puro de movimiento hexagonal (I4)

**Fecha:** 7 de noviembre de 2026. **Ámbito:** movimiento sintético de laboratorio, no reglas oficiales de *Command & Colors: Ancients*.

## Contrato

El módulo `packages/movement/movement.mjs` exporta `transitionSyntheticMovement(state, command, policy)`. Utiliza la geometría *odd-q* existente de 13×9 (`hex-grid`) y no altera los argumentos. Un comando tiene tipo `move_synthetic_unit`, `actor`, `expectedRevision`, `unitId` y una secuencia `path` de celdas destino **sin incluir la celda de origen**. El cliente **no** debe poder definir `policy`, `phaseState`, `board` ni `movedUnitIds`.

El estado fiable `state` contiene `board`, `phaseState` (incluyendo `phase='MOVEMENT'`, `turn`, `revision` y `orderedUnits`) y `movedUnitIds`. La política fiable `policy` contiene `maxStepsByUnit`, número máximo por unidad (0–32), y `blockedCells`, lista de hexágonos infranqueables. Son **valores inventados y configurables para tests**; todavía no se conocen rangos, costes ni terrenos oficiales.

Se validan la fase, revisión y jugador habilitado; que la unidad exista, sea propia, haya recibido orden y no se haya movido ya; que la ruta sea una sucesión de **hexágonos contiguos**, nunca salte ni repita una celda, permanezca en el tablero y respete el máximo de pasos; y que no atraviese ni termine sobre una unidad u obstáculo. La ausencia de perfil devuelve `MOVEMENT_POLICY_UNAVAILABLE` (fallo cerrado). Datos corruptos del servidor se consideran errores, no movimientos permitidos.

Un movimiento correcto devuelve un **nuevo estado** con el tablero y `movedUnitIds` actualizados, la revisión incrementada una vez y un evento público `UNIT_MOVED_SIMULATED` con origen, destino y recorrido. No publica información de manos o mazos. La unidad inicial y los obstáculos nunca se aceptan como destinos. Permitir un movimiento no implica permitir otro con la misma unidad ese turno.

## Pruebas reproducibles

```powershell
node --test packages/movement/movement.test.mjs
node --test packages/movement/movement.test.mjs packages/order-validator/validator.test.mjs packages/order-validator/server-context.test.mjs
.\scripts\test-local.ps1
```

- **17/17 pruebas del módulo** ejecutadas correctamente con Node.js 22.16.0.
- **34/34 pruebas juntas**, combinando 17 de movimiento con 17 de validación de órdenes. Sin WSL, VPS ni GitHub Actions.
- Los archivos de código/prueba publicados se cotejan por sus hashes de objeto Git.
- La batería global del proyecto queda enumerada en **29 suites** en esta rama apilada. Su ejecución global, las pruebas integradas HTTP/SQLite y la aceptación visual en Windows **siguen pendientes**.

## Próxima integración (no incluida)

La PR se apila sobre el incremento SQLite de órdenes [PR #45](https://github.com/PedroBlanco/command-colors/pull/45), aún en borrador. Este contrato de movimiento **todavía no se ejecuta por HTTP ni se persiste**. El próximo incremento debe:

1. Incorporar el comando `move_synthetic_unit` a la pasarela con el actor derivado de sesión, pasando únicamente `unitId` y `path` del cliente.
2. Obtener `board`, `movedUnitIds` y `maxStepsByUnit` exclusivamente de la partida en SQLite; la configuración debe ser fiable, versionada y de ejemplo hasta verificar las reglas.
3. En la misma transacción `BEGIN IMMEDIATE`, comprobar revisión e idempotencia, validar, aplicar, guardar tablero y revisión e insertar evento; rechazos sin efectos persistentes.
4. Restablecer el seguimiento de unidades movidas al iniciar un turno nuevo, impedir cambios de fase inconsistente y probar reinicios/reintentos/concurrencia.
5. Verificar las reglas reales (terrenos, unidades, líderes, excepciones, distancias) contra la edición física identificada. **R-05 y CCW-014 permanecen abiertos**.

El tablero SVG continúa separado en PR #27 hasta comprobar su comportamiento en navegadores reales. No desplegar el laboratorio en una red pública.
