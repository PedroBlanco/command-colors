# CCW-014 — Movimiento persistente en SQLite y API autorizada (laboratorio)

**Fecha:** 7 de noviembre de 2026. **Estado:** incremento en PR apilada, pendiente de regresión HTTP real y revisión; no es *Ancients* jugable.

## Objetivo alcanzado en código

El comando `move_synthetic_unit` ahora atraviesa la API HTTP existente (que deriva `actor` de la sesión, nunca del cuerpo JSON) hasta `createSqliteCommandDeckStore.dispatch`. La carga admitida por el servicio tiene `type`, `expectedRevision`, `idempotencyKey`, `unitId` y `path` con coordenadas `{col,row}` por cada hexágono de recorrido. `board`, `maxStepsByUnit`, `blockedCells`, `movedUnitIds` y el bando no proceden del cliente.

La política se obtiene de `packages/movement/server-policy.mjs` a partir del tablero persistido de la partida; **asigna únicamente por convenio dos pasos por unidad y cero celdas infranqueables**. No representa ninguna unidad, terreno ni regla oficial. `transitionSyntheticMovement` mantiene las comprobaciones de turno, revisión, unidad previamente ordenada, bando, ocupación, vecinos, destino y desplazamiento máximo.

Dentro del mismo `BEGIN IMMEDIATE` de SQLite se confirma el nuevo tablero, la lista privada `movedUnitIds`, la revisión, el evento público `UNIT_MOVED_SIMULATED` con recorrido y la clave de idempotencia. El evento no contiene el mazo, la mano rival ni la política. La vista de ambos jugadores conserva el tablero público actualizado y la revisión correspondiente. SSE ya emite cambios de `gameRevision`; **su comportamiento específico con los nuevos movimientos debe comprobarse en una prueba HTTP/SSE completa**.

El primer arranque del mazo experimental crea `movedUnitIds=[]`. Cada movimiento añade una unidad a esa lista y no puede repetirse durante el turno. Tras mover alguna unidad, el comando `undo_synthetic_orders` se rechaza: el deshacer de órdenes ya no sería una acción sin efectos. El cierre completo del turno mediante `acknowledge_synthetic_draw` reinicia la lista. Las partidas anteriores sin campo `movedUnitIds` no se actualizan silenciosamente; al intentar mover devuelven `MOVEMENT_STATE_UNAVAILABLE`. Para continuar una partida antigua deberá diseñarse una migración explícita o crear una nueva partida sintética.

## Ejemplo de solicitud de laboratorio (solo sesión autorizada)

```json
{
  "type": "move_synthetic_unit",
  "expectedRevision": 2,
  "idempotencyKey": "move_synthetic_a_0001",
  "unitId": "synthetic-a",
  "path": [{"col": 4, "row": 4}]
}
```

La API existente expone `POST /api/matches/:uuid/commands`. No publicar por Internet ni utilizar credenciales/datos reales. Tras una respuesta `APPLIED`, las dos sesiones deben obtener el tablero de la revisión siguiente mediante GET. Los avisos SSE tienen que activarse por la revisión pública, sin transmitir datos privados.

## Pruebas y evidencia

Ejecutado realmente con Node.js **22.16.0**, sin WSL, Docker, VPS ni GitHub Actions:

```powershell
node --test packages/order-validator/*.test.mjs packages/movement/*.test.mjs packages/command-deck/movement-sqlite.test.mjs
```

**48 pruebas superadas, 0 fallos**, incluidas nueve de transacciones SQLite **reales**, que cubren persistencia de tablero/evento, idempotencia, rechazos, bloqueo de deshacer, cambio de turno, recuperación al reabrir la base de datos, rollback mediante trigger SQL y resistencia a políticas manipuladas. Los cinco tests de política del servidor son idénticos a los publicados (SHA Git contrastado).

Se añadió también una nueva prueba con dos sesiones/cookies al archivo `packages/local-api/command-deck-cookie.test.mjs`: envía un movimiento mediante HTTP, comprueba que ambos participantes ven la misma posición y revisión y que un tercero no accede; **la prueba HTTP nueva aún no ha sido ejecutada**, por lo que no se proclama su éxito. La batería general enumera **31 suites**, todavía no ejecutadas conjuntamente en PowerShell de Windows 11. La validación visual de la PR #27 también sigue pendiente.

## Dependencias y límites

- PR #45: validación de órdenes HTTP/SQLite, en borrador y pendiente de regresión.
- PR #46: movimiento puro hexagonal, apilada sobre #45, pendiente de fusión.
- Esta PR se apila sobre la #46. No adelantar la fusión mientras haya suites y dependencia sin comprobar.
- El laboratorio y su política son **sintéticos**: sin datos oficiales, escenarios, costes de terreno, combates, líderes, cartas reglamentarias o aplicación multijugador segura para Internet.
- CCW-014 y R-05 continúan abiertos hasta validar un reglamento concreto, sus excepciones y las pruebas en navegador.

**Siguiente tarea:** verificar la suite HTTP/SQLite nueva y SSE con movimiento; ejecutar la regresión de 31 suites en Windows; después integrar las PR en orden, sin alterar la PR #27 hasta la prueba visual.
