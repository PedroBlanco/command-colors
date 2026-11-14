# ANC — Propuesta atómica no ejecutable de persistencia de movimientos

**Fecha:** 14/11/2026 · **Issue:** [#97](https://github.com/PedroBlanco/command-colors/issues/97) · **Base:** PR #117, sobre PR #116 → #115 → #114 → #113 → #112 → #111 → PR consolidada #108.

## Propósito

Conectar conceptualmente el diario privado reproducible de #115 con el contrato existente de las tablas `matches`, `game_commands` y `game_events` **sin ejecutar ninguna transacción** ni habilitar el movimiento oficial de *Command & Colors: Ancients*.

`prepareFootAtomicCommitEnvelope` (`packages/ancients-rules/foot-atomic-commit-envelope.mjs`) construye una propuesta de **tres componentes diferenciados**:

1. `privateBoardStateProposal`: posición y marcas de movimiento tras reproducir el paso con el reductor restringido de #112; exclusivamente para uso interno.
2. `commandRowProposal`: identificador de partida, actor, clave privada de idempotencia, firma de consistencia no criptográfica y revisión propuesta, en formato semánticamente equivalente a las columnas `game_commands`.
3. `publicEventRowProposal`: identificador de partida, secuencia, visibilidad pública y evento mínimo `FOOT_STEP_PUBLIC_EVENT_PROPOSAL_V1`, **sin clave de idempotencia, firma, carta, token o mano**.

Los campos son **propuestas no ejecutables**. La salida es `PRIVATE_FOOT_ATOMIC_ENVELOPE_CANDIDATE`, nunca `ANCIENTS_MOVEMENT_COMMITTED_V1`, `ALREADY_APPLIED` ni una operación SQL autorizada. Todas las respuestas contienen:

```js
movementAuthorized: false
officialMovementAuthorized: false
canCommit: false
dbChanged: false
gameRevisionChanged: false
publicEventWritten: false
needsServerTransaction: true
```

## Entrada desde el servidor

La función recibe `{journal,trustedMatchId,trustedInitialState,trustedPolicy,currentGameRevision,recordedCommands,recordedEvents}`.

**Todas las entradas deben proceder del servidor dentro de una única transacción futura `BEGIN IMMEDIATE`**, tras autenticar sesión/pertenencia. Ninguna puede ser suministrada por el navegador ni aceptarse como prueba de autorización simplemente por su forma o porque un hash coincide.

Se exige:

- UUID de partida coincidente con el diario y con todos los registros históricos.
- `currentGameRevision` entero seguro, sin desbordamiento; exactamente **un paso propuesto**, desde esa revisión hasta la siguiente.
- Estado inicial y política de movimiento derivados **independientemente** del diario. `checkFootJournalAnchor` reproduce todas las entradas y compara estado, reglas, partida y revisión; copiar los propios campos del diario para «verificarlos» supondría una comprobación circular.
- Lista de claves de comandos como proyección de filas SQL **`{match_id,actor,idem_key,committed_revision}`**.
- Lista de secuencias de eventos como proyección SQL **`{match_id,sequence,visibility}`**.
- Una entrada de cada clase por revisión histórica entre 1 y `currentGameRevision`, sin repeticiones, saltos, revisiones fuera de rango, partidas ajenas ni claves duplicadas dentro de un mismo actor. Las consultas deben estar limitadas por `match_id`. Se admite diferente orden de filas, pero no contenido contradictorio.
- La clave nueva `(actor,idem_key)` no debe existir ya en `game_commands`. **No se reconoce automáticamente un reintento previo**: una consulta de ocupación no equivale a comprobar firma y estado confirmado.

Se realiza **copia estricta por descriptores** de todos los datos de entrada, incluida la raíz de la petición con sus siete campos exactos (se rechazan extras como `canCommit`, `actor` o `sessionToken`): objetos de datos sin propiedades especiales, arrays densos y acotados, sin getters ejecutados, símbolos, ciclos, prototipos ajenos o cantidades desmedidas. La propuesta de salida se congela profundamente.

La verificación de `recordedCommands` y `recordedEvents` aquí es **solo una comprobación de ocupación/secuencia de revisiones**, no una verificación criptográfica ni de los payloads históricos. El replay íntegro de comandos y eventos oficiales deberá implementarse aparte, dentro de la futura autoridad.

## Secuencia transaccional futura (NO implementada)

Para pasar de propuesta a confirmación oficial se necesita, de manera inseparable:

1. Autenticar sesión viva y pertenencia a la partida **bajo `BEGIN IMMEDIATE`**.
2. Reconstruir un estado **reglamentario y oficial** desde escenarios, cartas, órdenes, terreno, líderes y movimientos efectivamente confirmados. No utilizar como fuente de autoridad el `LAB_ONLY` de #116.
3. Verificar todos los comandos/eventos históricos completos y la correspondencia con la revisión actual de `matches`.
4. Resolver la clave de idempotencia bajo el bloqueo; si ya existe, comprobar firma semántica y resultado aplicado, no devolver automáticamente `ALREADY_APPLIED`.
5. Ejecutar las reglas pertinentes y calcular estado siguiente. Solo entonces preparar la propuesta de evento público mínimo y el comando de juego.
6. Actualizar `matches.private_state` y `matches.game_revision`, insertar `game_commands` y `game_events` **en una sola transacción**, con comprobación de filas afectadas y rollback ante cualquier error.
7. Reproducir lo confirmado desde los datos persistidos y verificar que el SSE/HTTP no expone manos, claves, firmas ni diario. Resolver antes SEC-001 (#94) y la autorización de escenarios/expansiones.

En particular, `commandRowProposal` y `publicEventRowProposal` **no deben pasarse directamente a `db.prepare(...).run()`** ni interpretarse como un permiso de escritura.

## Pruebas

Nueva suite `packages/ancients-rules/foot-atomic-commit-envelope.test.mjs` como número **84** del manifiesto fail-closed. **20 casos** de:

- Separación de estado, comando y evento, ausencia de datos privados en payload público y congelación profunda.
- Replay reproducible desde JSON y equivalencia independiente del orden de filas SQL.
- Revisión duplicada, ausente o fuera de rango; evento privado; partida ajena; claves de comando repetidas y colisión de la nueva clave con un comando confirmado.
- Conflicto de revisión, política o tablero de origen; diario manipulado o con entradas adicionales.
- Rechazo de getters en raíz o datos anidados, arrays dispersos, símbolos, campos adicionales de autoridad y evitación de trampas `get` de `Proxy`.

**Verificación realizada: 20/20 pruebas en V8 estricto, con el código real del repositorio y un simulador de `node:test`; `structuredClone` sustituido por clonación JSON.** No son pruebas Node nativas ni validan SQLite real. El último resultado completo de Windows aportado por el usuario (1045/1045, 80 suites) corresponde solamente a #108. Las PR #111–#117 añaden 131 tests y esta PR 20: **1196 pruebas previstas en 84 suites**, sin ejecución nativa de estas ramas.

Mantener la nueva PR **draft**, sin fusionar `main`, desplegar ni abrir endpoints. El usuario no puede realizar pruebas locales por ahora y no es necesario solicitarlas.
