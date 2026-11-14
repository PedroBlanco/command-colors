# LAB-ANC — Frontera transaccional de admisión de un movimiento de infantería

**Fecha:** 14/11/2026 · **Seguimiento:** [issue #97](https://github.com/PedroBlanco/command-colors/issues/97) · **Base:** PR #113, sobre PR #112 → #111 → PR consolidada #108.

## Propósito

Preparar el límite de concurrencia necesario para una **futura** confirmación de movimiento, sin hacer posible ninguna confirmación todavía. El laboratorio no tiene persistencia ni replay de movimientos autorizados y no puede convertir un estado `LAB_RESOLUTION_PENDING` en la fase reglamentaria de movimiento de un juego oficial.

Se incorpora el método **exclusivamente interno** de store:

`probeExperimentalSectionFootCommit(request,trustedScenario)`

Una entrada sintácticamente correcta **jamás devuelve un estado de movimiento aplicado**, incluso aunque todas las comprobaciones sean favorables. La salida correspondiente es siempre:

```js
{
  status:409,code:'SECTION_LAB_FOOT_COMMIT_DISABLED',
  checkedRevision:2,ruleSubset:'BASE_FOOT_OPEN_ONE_HEX_V1',
  movementAuthorized:false,officialMovementAuthorized:false,
  canCommit:false,boardChanged:false,dbChanged:false
}
```

No produce `ANCIENTS_MOVEMENT_COMMITTED_V1`, ni firma, ni evento, ni tablero para persistir; no reserva ninguna clave de idempotencia.

## Captura inmutable de la petición

`snapshotFootTransactionProbeRequest` en `staged-sequence-request-snapshot.mjs` admite exactamente los cuatro campos:

- `sessionToken`: credencial para resolver en el servidor y **jamás devolver al cliente**.
- `expectedRevision`: revisión entera segura no negativa.
- `idempotencyKey`: cadena de 8 a 80 caracteres `[A-Za-z0-9_-]`; solo consulta su colisión, **no crea reserva**.
- `actions`: lista de **una** acción `UNIT`, de un solo hexágono `{col,row}`, con ID estricto.

Se rechazan campos adicionales (`actor`, `board`, `terrain`, `contextDigest`, `candidateEvidence`, `movementAuthorized`, etc.), objetos heredados, símbolos, getters y arrays dispersos o con elementos extra. La captura usa descriptores propios de datos, sin ejecutar `get` sobre el objeto original; todos los valores de la copia quedan congelados.

La selección de `trustedScenario` compete exclusivamente al servidor. Un parámetro `scope:'SYNTHETIC_OPEN_HEX_V1'` no acredita por sí solo la procedencia de un escenario oficial.

## Orden estricto del bloqueo

Tras capturar los campos:

1. **`BEGIN IMMEDIATE`** en la base SQLite/WAL del servidor CCWB. Es la misma base que controla sesiones, membresía, comandos y eventos.
2. Resolver **sesión viva y pertenencia** bajo ese bloqueo; derivar el actor del servidor, nunca del cliente.
3. Leer la fila de la partida; exigir modo experimental Section LAB y `game_revision===expectedRevision`.
4. Consultar `game_commands` por `(match_id, actor, idem_key)` bajo el mismo bloqueo. Una clave ya usada por una orden o carta se rechaza con `SECTION_LAB_FOOT_IDEMPOTENCY_KEY_IN_USE`. Ni siquiera un payload igual puede devolver `ALREADY_APPLIED`, porque el sistema **no ha confirmado ningún movimiento de infantería**.
5. Invocar `sectionHistory.previewVerifiedFootCore(actor,stable,trustedScenario)`, que reconstruye el diario íntegro de cartas/órdenes, verifica su coherencia con SQLite y ejecuta el reductor del subconjunto permitido sobre una copia.
6. Si la propuesta es inviable, rechazarla con `SECTION_LAB_FOOT_PROBE_REJECTED`. Si es viable, devolver siempre `SECTION_LAB_FOOT_COMMIT_DISABLED` con código **409** y bandera `canCommit:false`.
7. Terminar la transacción **sin ninguna escritura**. Si el replay detecta una divergencia, propagar la excepción y hacer `ROLLBACK`.

No hay INSERT, UPDATE, DELETE, ningún nuevo evento, ni cambios en `matches`, `game_commands`, `game_events` o `private_state`; no se altera revisión ni mano. La ruta HTTP/SSE no incorpora este método.

## Diferencias respecto al commit futuro

El bloqueo de escritura prepara la *condición de carrera*, pero no implementa una autoridad reglamentaria. El futuro `ANCIENTS_MOVEMENT_COMMITTED_V1` necesitará:

- Estado de partida **oficial** independiente del diario sintético `LAB_ONLY`, cartas y escenarios oficiales verificados, todos los casos reglamentarios pertinentes.
- Un libro de movimientos consumidos/marcadores realmente persistido y reproducible, sin inventar `movedUnitIds:[]` cuando existan jugadas previas.
- Firma semántica privada y mecanismo de reintento idempotente: reintento idéntico devuelve respuesta confirmada anterior, reutilización de clave con payload diferente rechazada; verificación en `BEGIN IMMEDIATE`.
- Un único commit atómico para estado privado/estado de tablero, revisión, comandos y eventos públicos mínimos, con rollback en cada punto y replay de movimientos capaz de reproducir el estado final.
- Barrera SEC-001 (#94), revisión de exposición HTTP/SSE y pruebas de dos jugadores y concurrencia.

Nada de eso queda sustituido por una salida de código `SECTION_LAB_FOOT_COMMIT_DISABLED`.

## Cobertura añadida y evidencia

**13 pruebas nuevas** en dos suites ya registradas (81 suites en el manifiesto):

- **4 tests puros**: inmutabilidad del snapshot, extras/autoridad falsa/claves inválidas, accessors y `Proxy` sin invocar getters.
- **9 tests CCWB/SQLite preparados**: clave libre y ninguna escritura, claves históricas usadas, entrada inválida antes del lock, revisión obsoleta/rival, revocación/no pertenencia, escenario inválido, mutación durante autenticación dentro de writer lock, competición por `BEGIN IMMEDIATE` y replay manipulado que obliga a rollback.

Se han ejecutado **35/35 casos puros de la suite acumulada** en V8 estricto sobre código del repositorio, con emulación de `node:test` y clonación JSON; el nuevo método transaccional real extraído pasó **10/10 escenarios aislados**, pero con transacción/sesión/base/replay **simulados**. Sintaxis de los cuatro archivos modificados correcta.

**No se han ejecutado tests nativos de Node ni SQLite sobre esta rama.** Las pruebas anteriores en Windows **1045/1045** corresponden solo a PR #108. PR #111 aporta 17 casos, #112 aporta 20, #113 aporta 18 y esta aporta 13 adicionales: total acumulado **esperado** `1113` tests en **81 suites**, pendiente de ejecutar en Windows cuando el usuario tenga disponibilidad. No se debe interpretar este número como PASS.

Mantener esta PR en borrador, sin fusionar en `main`, sin abrir endpoints ni desplegar. No requerir pruebas locales al usuario por el momento.
