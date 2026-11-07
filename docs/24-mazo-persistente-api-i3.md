# CCW-012 — Mazo privado persistente y API de laboratorio (iteración 3)

**Estado:** incremento experimental con cartas y comandos **sintéticos**. No aplica reglas oficiales ni habilita partidas de *Ancients* con jugadores reales. El servidor HTTP continúa limitado a `127.0.0.1` y no es apto para Internet.

## Diseño

Se utiliza **el esquema SQLite v1 existente**, sin modificar sus seis tablas ni ejecutar migraciones. Para cada partida preparada, `matches.private_state` incorpora un campo opcional `commandSession`, con el mazo, ambas manos, carta en juego, descarte y `phaseState` completos. La misma fila conserva el tablero sintético original como referencia. El acceso a `private_state` queda restringido al backend.

- Las partidas anteriores, sin `commandSession`, mantienen el comando de demostración `pass_demo_turn` y sus proyecciones anteriores.
- Una partida nueva puede activar el mazo **una sola vez**, cuando ya hay dos participantes, no ha empezado ningún turno y el propietario (bando A) solicita la inicialización.
- La inicialización **no acepta** cartas, tamaño de mano ni semilla proporcionados por el cliente: por ahora el servidor genera **18 ejemplares ficticios** e inicia manos A=2, B=3. Son cantidades de prueba, no parámetros de una edición o escenario real.
- Al inicializar se incrementa `lobby_revision` para avisar al SSE, sin alterar la revisión de fases 0.
- Cada acción aceptada actualiza `game_revision`, `private_state`, `game_events` y `game_commands` bajo una **única transacción `BEGIN IMMEDIATE`**. Un fallo de inserción provoca `ROLLBACK`.
- `game_commands` distingue reintentos exactos de solicitudes con la misma clave pero **otros parámetros semánticos**. La revisión protege frente a acciones concurrentes o repetidas.
- No se han creado nuevas tablas ni cambiado `user_version`; el comprobador estricto de estructura SQLite y las herramientas de copia continúan usando la versión 1.

## API

Todos los ejemplos siguientes son **solo de laboratorio local**. La pasarela obtiene el bando de la **sesión autenticada** y lo ignora si el cliente intenta suplantarlo en el JSON.

`POST /api/matches/:uuid/deck/initialize` con cuerpo JSON `{}`: exige jugador A, sala `READY` y revisión de juego 0. Devuelve `201 DECK_INITIALIZED` y la vista **privada** de A. B recibe 403; usuarios ajenos reciben 404; una segunda inicialización o una partida ya empezada devuelve 409. No permite suministrar cartas mediante la solicitud.

`GET /api/matches/:uuid`: tras inicializar, devuelve `state` con `matchId`, `revision`, `phase`, `turn`, `actingSide`, tablero de prueba, `yourHand`, `opponentCardCount`, `drawPileCount`, `discardPile`, `cardInPlay` y la decisión defensiva pendiente. **No devuelve** `drawPile` ni `hands.B` a A, ni `hands.A` a B.

`POST /api/matches/:uuid/commands` usa la misma ruta de la API anterior; añade argumentos **explícitos** permitidos por el servidor para las acciones sintéticas:
- `play_synthetic_card`: `cardRef`, solo un ejemplar de la propia mano.
- `assign_synthetic_orders`: `unitIds`.
- `undo_synthetic_orders` y `finish_synthetic_movement`: sin argumentos adicionales.
- `ask_synthetic_defense`: `targetUnit`; `answer_synthetic_defense`: `choice` (STAND/EVADE sintéticos).
- `finish_synthetic_combat` y `acknowledge_synthetic_draw`: sin argumentos adicionales.

Todos incluyen `type`, `expectedRevision` e `idempotencyKey`. Los eventos de `GET /api/matches/:uuid/events` son **públicos**; contienen la carta al jugarla, nunca el orden del mazo ni la carta robada en secreto. SSE informa únicamente de revisiones y el navegador recupera su proyección privada por HTTP.

## Pruebas y evidencia

Archivos:
- `packages/command-deck/sqlite-game.mjs` y `sqlite-game.test.mjs`;
- `packages/local-api/command-deck-http.test.mjs`;
- adaptaciones de `packages/sqlite-store/sqlite.mjs` y `packages/local-api/gateway.mjs`.

**Pruebas ejecutadas:** 21 del mazo puro + **17 del adaptador SQLite real**, todas superadas (**38/38**). Las 17 incluyen conservación, autorización interna, revisión, idempotencia semántica, rollback, dos conexiones, recuperación desde otro proceso y respuesta del defensor persistente.

La suite HTTP contiene **cuatro casos de integración con servicios reales**, y su sintaxis Node.js se ha comprobado. **No se ha ejecutado todavía en este incremento** porque el entorno local de ensayo no disponía de todas las fuentes originales del backend; sus resultados no forman parte de las 33 pruebas superadas.

```powershell
node --test packages/command-deck/deck.test.mjs packages/command-deck/sqlite-game.test.mjs
node --test packages/local-api/command-deck-http.test.mjs
.\scripts\test-local.ps1
```

El diagnóstico y el script de PowerShell enumeran **21 suites** tras añadir las dos nuevas. La batería completa, el navegador físico y el envoltorio PowerShell continúan pendientes de comprobación conjunta en Windows 11.

## Fronteras y tareas pendientes

- El comando `pass_demo_turn` de partidas anteriores sigue disponible **solo antes de activar el mazo**. Una partida con mazo activado utiliza exclusivamente las acciones sintéticas del reducer; no se puede saltar directamente a otro turno.
- Las manos y el mazo residen sin cifrar en SQLite de laboratorio. No utilizar credenciales, partidas ni datos personales reales.
- Aún no se ha añadido interfaz de botones para las nuevas acciones; el laboratorio actual mantiene su interfaz de turnos ficticios. La API del mazo puede ensayarse con pruebas automatizadas sin modificar el tablero de PR #27.
- No se ha confirmado composición, número de cartas, reparto, excepciones o agotamiento del reglamento físico. Tampoco se han implementado órdenes legales, movimientos, dados, combates ni victoria.
- Faltan comprobación de límites y seguridad HTTP de producción, versión de reglas, migraciones de escenarios, persistencia del motor definitivo y aceptación visual.

Esta PR cumple el incremento **técnico** de persistencia, pero la issue CCW-012 seguirá abierta hasta completar el juego reglamentario, la seguridad y la verificación entre dos navegadores.

La suite ampliada cubre asimismo: rollback de inicialización SQL, dos conexiones intentando inicializar la misma partida, rechazo de un snapshot privado con cartas duplicadas, firma idempotente distinta para órdenes distintas y rechazo de `pass_demo_turn` después de activar el mazo. Todos estos casos se ejecutaron en SQLite real de laboratorio.
