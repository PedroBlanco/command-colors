# Ancients — Contrato de diario privado, replay e idempotencia de movimientos

**Fecha:** 14/11/2026 · **Seguimiento:** issue #97 · **Base:** PR #114 (borrador), sobre PR #113 → #112 → #111 → #108.

## Objetivo y alcance exacto

Esta etapa introduce **un formato de diario privado que puede serializarse**, una propuesta de anexado determinista, un replay íntegro, control semántico de reintentos y una comprobación de procedencia externa. Aún **no existe ninguna operación de escritura SQLite**, ningún movimiento confirmado ni evento público efectivo.

El módulo nuevo `packages/ancients-rules/foot-movement-journal.mjs` reutiliza exclusivamente `reduceCoreOpenFootStep` y `replayCoreOpenFootSteps` del núcleo de infantería restringido de #112. Se permiten solamente propuestas de movimiento de **un hexágono adyacente en terreno completamente abierto, sin líderes ni excepciones de carta/escenario**, y con órdenes emitidas previamente.

Las funciones y objetos resultantes no son una autoridad y todos conservan:

```js
movementAuthorized: false
officialMovementAuthorized: false
canCommit: false
dbChanged: false
needsServerTransaction: true
```

## Formato de almacenamiento propuesto

El diario, **solo en la parte privada del servidor**, tiene estructura exacta:

```js
{
  kind: 'PRIVATE_CORE_FOOT_JOURNAL_V1',
  schemaVersion: 1,
  matchId: '11111111-2222-4333-8444-555555555555', // UUID de partida, ejemplo
  initialState: { /* proyección validada del núcleo foot */ },
  policy: { /* política propia del servidor, ligada al escenario */ },
  entries: [
    {
      idempotencyKey: 'foot_commit_id_001',
      command: {actor:'A',expectedRevision:2,unitId:'unitA',
                to:{col:3,row:4}},
      signature: 'CCW_FOOT_STEP_V1:...', // consistencia, NO autenticación
      transition: { /* paso derivado exclusivamente por el reductor */ },
      publicEventProposal: {
        type:'FOOT_STEP_PUBLIC_EVENT_PROPOSAL_V1',
        visibility:'public',
        revision:3,side:'A',unitId:'unitA',
        from:{col:2,row:4},to:{col:3,row:4}
      }
    }
  ],
  state: { /* resultado del replay determinista, revisado */ }
}
```

El prefijo `CCW_FOOT_STEP_V1:` identifica una **firma de consistencia semántica, no un MAC, hash autenticado ni prueba de origen**. Codifica en orden canónico de campos `matchId`, actor, revisión esperada, unidad, destino y clave de idempotencia. Su propósito es detectar divergencias del diario y evitar confundir peticiones distintas bajo una misma clave, **no** defender por sí sola de una persona capaz de reescribir toda la base de datos.

El `matchId` debe ser un UUID de la partida y se vincula tanto a la firma como a la comprobación de procedencia. La lista `entries` tiene límite estricto de 117 movimientos. Solo se aceptan objetos y arrays densos de datos, sin getters, símbolos, referencias circulares, herencia ajena ni propiedades `__proto__`. Se limitan además las profundidades y el número de nodos leídos para rechazar entradas malformadas.

## Operaciones puras

### `initializeFootMovementJournal({matchId,initialState,policy})`

Compara el estado y la política con el reductor; exige que **ninguna unidad esté ya marcada como movida** en el estado inicial. Genera el diario inicial vacío como `PRIVATE_FOOT_JOURNAL_INITIAL_CANDIDATE`.

### `proposeFootMovementJournalAppend({journal,command,idempotencyKey})`

1. Vuelve a reproducir **todas** las entradas y confronta el estado final guardado con el reconstruido.
2. Verifica firma privada y evento mínimo de cada movimiento ya incorporado al diario.
3. Si la clave `(actor,idempotencyKey)` existe con el **mismo** comando y revisión, responde `FOOT_JOURNAL_ALREADY_PROPOSED`, sin diario nuevo ni evento. Esto **no es `ALREADY_APPLIED`**: todavía no hay confirmación SQLite.
4. Si la misma clave identifica otro comando o revisión, devuelve `FOOT_IDEMPOTENCY_CONFLICT`.
5. Si la clave es nueva, comprueba revisión y aplica el reductor oficial restringido a una copia. Un movimiento imposible o repetido devuelve `BLOCKED` sin estado parcial.
6. Solo para el cálculo aceptado devuelve `PRIVATE_FOOT_JOURNAL_APPEND_CANDIDATE` con el diario privado completo inmutable y un **evento público mínimo propuesto**, sin token, mano, firma ni clave de idempotencia.

El contador `orderLedger.movedUnitIds` registra que una unidad ya ha efectuado su movimiento, pero **no cancela su condición de ordenada para el eventual combate**, y no modifica actualmente la partida.

### `replayFootMovementJournal(journal)`

Reconstruye el estado desde `initialState` paso a paso, exige unicidad de clave, coherencia de firma, transición y evento de cada entrada, y confronta el resultado con `journal.state`. Devuelve `PRIVATE_FOOT_JOURNAL_REPLAY_CANDIDATE` o `BLOCKED`, sin información parcial.

### `checkFootJournalAnchor({journal,trustedMatchId,trustedInitialState,trustedPolicy,rowRevision})`

Reproduce el diario y exige que el identificador de partida, estado inicial y política **coincidan con los datos del servidor obtenidos de forma independiente**, y que la revisión reconstruida coincida con `rowRevision`. Su resultado `PRIVATE_FOOT_JOURNAL_ANCHORED_CANDIDATE` sigue **sin autorizar la jugada**.

**Condición innegociable:** el servidor no puede obtener esos anclajes simplemente copiando los campos del mismo diario no confiable: sería una comprobación circular. La procedencia debe vincularse a registro de escenario, carta/órdenes y eventos previos verificables, o a un mecanismo autenticado y versionado equivalente.

## Modelo de transacción futura — aún NO implementado

Una futura operación de escritura, exclusivamente sobre partida reglamentaria autorizada y tras resolver SEC-001, deberá ejecutarse en **una única transacción `BEGIN IMMEDIATE`**:

1. Normalizar una vez la petición y comprobar sesión/usuario y pertenencia dentro del bloqueo.
2. Validar `matchId`, versión, estado, carta, órdenes, terreno, líder y todas las excepciones oficiales pertinentes a ese movimiento.
3. Reproducir el historial **con anclajes independientes** y comparar revisión de `matches`.
4. Resolver `(match_id,actor,idem_key)` en `game_commands`. El reintento idéntico recuperará el resultado confirmado previo y la reutilización con otro comando será un conflicto.
5. Calcular la nueva transición, y persistir **atómicamente** `matches.private_state` y `game_revision`, una fila de `game_commands` con firma vinculada a la partida y una fila mínima de `game_events` cuyo tipo oficial aún está por definir/autorizar.
6. Verificar cambios de revisión, filas afectadas y rollback de todos los cambios ante cualquier error; después comprobar replay completo y privacidad del SSE.
7. **Solo al terminar** devolver estado de movimiento confirmado.

No se debe tomar el `FOOT_STEP_PUBLIC_EVENT_PROPOSAL_V1` de este módulo como un evento `ANCIENTS_MOVEMENT_COMMITTED_V1`. El eventual tipo oficial necesita revisión de reglas, diseño de compatibilidad y autorización transaccional separada. El diario privado **no se publica**: contiene claves, firmas y política.

## Cobertura y estado de validación

Se añade la suite `packages/ancients-rules/foot-movement-journal.test.mjs` como la número **82** en `scripts/check-browser-lab.mjs`.

**32 pruebas nuevas**, cubriendo inicialización, partidas UUID, transición y evento mínimos, replay desde JSON, dos pasos, repetición idempotente, conflicto de clave, revisión obsoleta, unidades ya movidas o no ordenadas, ocupación, inmutabilidad, rechazo de getters/proxies, arrays dispersos o sobredimensionados, alteraciones de firma/evento/transición/estado, equivalencia semántica de claves, anclajes independientes y fallo por traslado a otra partida.

Verificación efectuada en esta etapa: **32/32 pruebas aisladas correctas** ejecutadas sobre el código real recuperado de GitHub con V8 estricto y un simulador de `node:test`; `structuredClone` se sustituyó por una copia JSON. **No se han ejecutado Node nativo, SQLite real ni la regresión completa del repositorio.**

Regresión Windows más reciente validada por el usuario: **1045/1045, 80 suites**, corresponde a la PR #108. La cadena aún no validada aporta #111 (+17), #112 (+20), #113 (+18), #114 (+13) y esta PR (+32), total acumulado **previsto, no comprobado, de 1145 pruebas en 82 suites**.

No fusionar esta PR en `main`, no desplegar y no pedir pruebas locales al usuario por ahora.
