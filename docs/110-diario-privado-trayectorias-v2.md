# Ancients — diario privado V2 para trayectorias completas de infantería

**Fecha:** 14/11/2026 · **Seguimiento:** [issue #97](https://github.com/PedroBlanco/command-colors/issues/97) · **Base:** PR #122 (`feat/ancients-foot-path-v2-replay-audit`) sobre la cadena experimental #121–#111 y PR consolidada #108.

## Motivación y alcance

El diario de infantería **V1** (`foot-movement-journal.mjs`, PR #115) representa únicamente un paso de un hexágono mediante un comando `{actor,expectedRevision,unitId,to}`. El reductor V2 (PR #121) y su auditoría independiente (PR #122) representan **una trayectoria completa de uno o dos hexágonos** mediante `{actor,expectedRevision,unitId,path}`. No debe hacerse una reinterpretación implícita de un registro V1 como si fuese V2.

Se incorpora `packages/ancients-rules/foot-path-v2-journal.mjs`: un **diario privado, puro, versionado, reproducible y no autorizante**, independiente del formato V1. Sus cuatro funciones públicas son:

| Función | Propósito | Estado correcto |
|---|---|---|
| `initializeFootPathJournal` | Generar diario privado de partida y estado/política iniciales | `PRIVATE_FOOT_PATH_JOURNAL_INITIAL_CANDIDATE` |
| `proposeFootPathJournalAppend` | Proponer un comando de recorrido completo, su firma y propuesta de evento | `PRIVATE_FOOT_PATH_JOURNAL_APPEND_CANDIDATE` |
| `replayFootPathJournal` | Reproducir **todas** las entradas sin confiar en las transiciones guardadas | `PRIVATE_FOOT_PATH_JOURNAL_REPLAY_CANDIDATE` |
| `checkFootPathJournalAnchor` | Contrastar diario contra partida, política, estado inicial y revisión de fila **obtenidos independientemente** | `PRIVATE_FOOT_PATH_JOURNAL_ANCHORED_CANDIDATE` |

El diario usa `kind: PRIVATE_CORE_FOOT_PATH_JOURNAL_V2` y `schemaVersion: 2`; no comparte el `kind` ni el contrato de comandos y eventos con V1.

## Invariantes del diario

- Entrada estricta: UUID de partida, estado inicial `ANCIENTS_OPEN_FOOT_PATH_CORE_V2`, política `BASE_FOOT_OPEN_PATH_CORE_V2`, fase `MOVE`, carta de sección ordinaria, tablero sin líderes, terreno totalmente abierto y sin excepciones. La pertenencia a la partida y la autenticación **no se verifican en estas funciones**.
- La lista inicial `movedUnitIds` debe estar vacía: el diario parte del inicio de una fase de movimientos. Las unidades ordenadas permanecen ordenadas; **una unidad no puede moverse dos veces**.
- **Una entrada = una acción de trayectoria completa = un incremento hipotético de revisión.** Una trayectoria de dos hexágonos **no** consume dos revisiones. La marca `movedUnitIds` cambia una sola vez.
- Cada entrada contiene `idempotencyKey`, `command`, `signature`, `transition` y `publicEventProposal`, con el camino completo, las posiciones inicial y final y `battleAfterMovement`.
- La firma semántica `CCW_FOOT_PATH_V2:` incluye `matchId`, actor, revisión inicial, unidad, **toda la trayectoria** y clave. Una ruta alternativa que termine en el mismo hexágono **no es el mismo comando**.
- Repetir exactamente la clave y el contenido de un comando **ya propuesto** devuelve `PRIVATE_FOOT_PATH_JOURNAL_ALREADY_PROPOSED` sin mutar el diario. Reutilizar esa clave con otro camino, unidad o revisión da `FOOT_PATH_IDEMPOTENCY_CONFLICT`. Una nueva clave con revisión antigua da `STALE_REVISION`. **Esto no supone una idempotencia persistida en `game_commands` ni un comando confirmado.**
- El replay recomputa cada transición a través de `reduceCoreOpenFootPath` y verifica tipo, revisión, camino, final, posibilidad de combatir, firma y propuesta de evento. La auditoría global V2 vuelve a evaluar la secuencia completa y su estado final; cualquier alteración bloquea **todo** el resultado.
- `checkFootPathJournalAnchor` cruza `matchId`, `initialState`, `policy` y `rowRevision` **suministrados por una fuente distinta al propio diario**. Coincidir con sus datos no autentica al usuario ni certifica el escenario oficial.
- Datos copiados mediante **descriptores propios** (sin ejecutar getters o `Proxy.get`), acotados y sin ciclos, símbolos, arrays dispersos, funciones, objetos exóticos o claves de prototipo peligrosas. Los candidatos se congelan profundamente y los rechazos no devuelven un estado parcialmente modificado.

## Evento público propuesto, NO confirmado

`FOOT_PATH_PUBLIC_EVENT_PROPOSAL_V2` contiene solo tipo, visibilidad, revisión, bando, unidad, origen, destino, **ruta completa**, número de pasos y restricción de combate resultante. Se excluyen firma, clave privada de idempotencia, credenciales, mano, mazo y datos secretos.

El evento **no** tiene el tipo de confirmación `ANCIENTS_MOVEMENT_COMMITTED_V1` ni se escribe en `game_events`. Las salidas del módulo mantienen:

```js
movementAuthorized: false
officialMovementAuthorized: false
attackAuthorized: false
canCommit: false
dbChanged: false
publicEventWritten: false
needsServerTransaction: true
```

## Alcance pendiente

Esta etapa **no** agrega un método a SQLite, no modifica `matches.private_state`, `game_commands` ni `game_events`, no crea rutas HTTP/SSE y no convierte un movimiento hipotético en jugada real. El diario V1 persistido en #116 sigue funcionando en su propio formato y **no se sobrescribe ni migra**.

Para persistir o confirmar V2 deben definirse por separado: la fuente oficial y verificable de escenarios, terreno, cartas, líderes y órdenes; autenticación y revisión real bajo `BEGIN IMMEDIATE`; análisis de conflictos de claves con `game_commands`; **actualización atómica de tablero, revisión, comando y evento**, rollback y replay integral de confirmaciones. SEC-001 (#94) sigue pendiente. Se mantiene el enfoque de **un motor genérico con perfiles/regímenes reglamentarios**, no motores separados por tropa.

## Pruebas

Nueva suite `packages/ancients-rules/foot-path-v2-journal.test.mjs`, registrada como **suite 89**, con **27 casos**. Incluye:

- Inicialización inmutable; propuestas de un hexágono y de dos, revisión única, unidades ordenadas y restricciones de combate (incluida la excepción de las auxiliares tras recorrer dos hexágonos).
- Replay determinista tras serialización JSON; dos unidades distintas en la misma fase; rechazo de un segundo movimiento de la misma unidad.
- Reintentos exactos, colisión con trayectoria alternativa al mismo destino, revisión modificada, claves inválidas y nueva clave obsoleta.
- Alteraciones de firma, comando, recorrido, evento, resultado, ledger, revisión y procedencia.
- Separación explícita V1/V2, terreno/líderes no admitidos, entradas con getter/proxy, ciclos y arrays dispersos, privacidad y banderas sin autoridad.

**Verificación realizada:** **27/27** pruebas de esta suite y **31/31** del reductor V2 + **16/16** de la auditoría V2: **74/74 casos aislados correctos** sobre fuentes y pruebas reales de GitHub usando V8 estricto, emulación de `node:test` y clonación JSON en lugar de `structuredClone`. **No equivalen a pruebas nativas de Node ni de SQLite.**

Última regresión nativa Windows aportada por el usuario: **1045/1045, 80 suites en PR #108**. PR #111–#120 aportaban 199 pruebas, PR #121 aporta 31, PR #122 aporta 16 y esta PR 27: **1318 pruebas previstas en 89 suites**, pendientes de regresión nativa. No pedir pruebas locales ahora: el usuario ha indicado que no puede ejecutarlas por el momento.

Mantener esta PR **draft** sobre #122, sin fusionarla en `main` ni desplegar.
