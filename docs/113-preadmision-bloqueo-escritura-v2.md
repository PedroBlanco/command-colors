# Ancients — preadmisión V2 bajo bloqueo de escritura, sin confirmación

**Fecha:** 15/11/2026 · **Issue:** [#97](https://github.com/PedroBlanco/command-colors/issues/97) · **Base:** PR #125 (`feat/ancients-v2-stage-read-audit`).

## Objetivo

La PR #125 demostró la coherencia del borrador privado V2 contra la historia de cartas/órdenes **verificada desde SQL** bajo un mismo snapshot WAL de lectura. Para una futura transacción oficial de movimiento hará falta efectuar esos mismos controles **dentro del bloqueo de escritor** —después de autenticar de nuevo la sesión y antes de decidir sobre revisiones y claves de comando—. Esta PR incorpora una **preadmisión experimental y no ejecutable** que reproduce esa secuencia de comprobaciones; **no confirma movimiento alguno**.

### Nueva API interna de SQLite

```js
store.precheckExperimentalSectionFootPathV2Locked(
  {
    sessionToken,
    expectedRevision,
    idempotencyKey
  },
  trustedScenario // EXCLUSIVAMENTE DEL SERVIDOR, sintético
)
```

No hay método HTTP/SSE ni estado público nuevo. El navegador **no** puede proponer actor, escenario, tablero, ruta, transición, firma, estado de las cartas, unidad ni permisos. La ruta y el resto del comando de movimiento deben recuperarse **exclusivamente del borrador interno** previamente almacenado, que tampoco confiere autoridad.

La función `snapshotFootPathV2LockedPreflightRequest` copia la petición por **descriptores de datos propios**, sin ejecutar getters ni trampas `Proxy.get`, antes de entrar en la transacción. Rechaza campos extra y verifica límites de sesión, revisión e identificador de idempotencia.

### Secuencia interna, toda en un `BEGIN IMMEDIATE`

1. Resolver sesión **viva** y pertenencia actual a la partida, obteniendo `actor` del servidor; jamás de una cabecera o campo de la petición.
2. Comprobar que la partida tiene el historial CCWB privado y que `matches.game_revision` sigue siendo exactamente la revisión esperada.
3. `preflightFootPathV2UnderWriterLock` ejecuta nuevamente `verify(row)` del puente CCWB: reconstruye el **historial completo** de cartas, órdenes y fin de turno, verifica cada comando, cada firma, su clave y revisión contra `game_commands`, y cada evento/visibilidad/payload contra `game_events`. No confía en que exista un borrador V2 bien formado.
4. Recuperar desde SQL el **espacio de claves ya confirmadas** para `(actor, idem_key)`. El comprobador puro valida los registros y rechaza cualquier intento de usar una clave ya presente en `game_commands`. Que el rival haya usado la misma cadena no crea, por sí solo, una colisión: el ámbito es actor + partida.
5. `assessFootPathV2LockedPreflight` verifica la revisión y el diario V2 con la auditoría de #125, vinculándolo a la **política sintética del servidor**, estado inicial, órdenes y camino, y exige que la clave de la petición sea exactamente la clave del borrador que se está comprobando. Una clave distinta nunca genera un comando nuevo ni reserva la clave.
6. Devuelve exclusivamente un resultado **no ejecutable**, con número de hexágonos y revisión hipotética, o un rechazo **sin detalles privados**. No altera ninguna fila, ni siquiera para guardar resultados de idempotencia.

La puerta de entrada del almacén siempre oculta los detalles de bloqueo/integridad detrás de `SECTION_LAB_FOOT_V2_LOCKED_PREFLIGHT_REJECTED`. El resultado aceptado `SECTION_LAB_FOOT_V2_LOCKED_PREFLIGHT_ONLY` mantiene explícitamente:

```js
{
  movementAuthorized: false,
  officialMovementAuthorized: false,
  canCommit: false,
  dbChanged: false,
  gameRevisionChanged: false,
  publicEventWritten: false,
  needsOfficialScenario: true,
  needsOfficialReplay: true,
  needsCommittedIdempotency: true
}
```

**No es un token, permiso, firma, aprobación reutilizable ni compromiso de admitir ese movimiento posteriormente**. Si las circunstancias cambian después de liberar el bloqueo, esta comprobación deja de ser válida. Un método futuro de movimiento oficial deberá volver a comprobar todo en su **propia transacción atómica**.

## Invariantes y compatibilidad

- No se crea ninguna forma nueva de acción ejecutable; `game_revision`, tablero oficial, `game_commands`, `game_events`, `private_state` y las tablas de sesión quedan sin modificaciones.
- No cambia el diario V1 ni el V2, sus firmas ni sus reglas de replay.
- La comprobación de clave abarca **comandos ya confirmados**; la existencia de un borrador V2 no se interpreta como clave oficial reservada.
- La revisión pública esperada es la de CCWB, **no** la revisión hipotética del borrador V2 (que es +1).
- Un escenario/tabla de terreno distintos, un actor ajeno, una sesión revocada, una clave falsa, un historial SQL manipulado y un borrador corrupto nunca se convierten en autorización.
- La arquitectura sigue siendo un motor geométrico único y perfiles/regímenes por tipo de tropa. Esta etapa solo opera sobre el subconjunto **infantería en terreno totalmente abierto** con órdenes ordinarias de laboratorio.
- La firma semántica del diario no es criptográfica ni sustituye la procedencia reglamentaria.

## Pruebas

Se incorpora `packages/ancients-rules/private-foot-path-v2-locked-preflight.test.mjs` como **suite 92**, con **18 pruebas** de petición estricta, interposición de getters/Proxy, anclaje independiente, un/dos hexágonos, colisiones en el espacio real de claves, clave idéntica usada por otro actor, clave inventada, revisión, escenario, firma/ruta/evento falsos, listas SQL malformadas, respuesta sin secretos y todas las banderas de no autorización.

En `packages/sqlite-store/ancients-section-history.test.mjs` se añaden **10 pruebas de integración SQLite** para durabilidad entre conexiones, ausencia de borrador, clave discordante, datos no autorizados, rival y usuario externo, sesión revocada, escenario/revisión obsoletos, clave confirmada con firma provisional reconstruida, tampering de `game_events` y de `game_commands`, y comprobación de sesión **dentro** del bloqueo `BEGIN IMMEDIATE` frente a otro escritor.

**Ejecución aislada V8:** **18/18** pruebas nuevas más **19/19** de la auditoría de lectura V2 y **20/20** de la etapa SQLite anterior: **57/57 correctas** con código y tests reales de GitHub, emulación de `node:test` y clonación JSON. **No equivale a ejecución nativa Node ni SQLite**.

La última regresión Windows acreditada por el usuario corresponde a PR #108 (**1045/1045 en 80 suites**). El manifiesto alcanza **92 suites** y la regresión completa acumulada se estima en **1404 pruebas**, que permanecen pendientes de ejecución nativa en la cadena experimental. No solicitar pruebas locales ahora.

## Bloqueos para una implementación de juego real

Permanecen pendientes el **origen oficial autenticable del escenario/reglas** (incluidos terreno y líderes), comprobación del estado de turno/cartas/órdenes de la partida oficial, validación de todas las reglas y prioridades de errores SEC-001 (#94), idempotencia confirmada en la misma transacción y persistencia indivisible de estado, `game_revision`, `game_commands` y `game_events`, con rollback y replay posterior (#97).

Mantener esta PR **draft** sobre #125, sin fusionar `main` ni habilitar movimientos oficiales.
