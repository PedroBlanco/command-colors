# CCW-015 — Puente experimental del diario de cartas de sección hacia CCWB

**Fecha:** 11/11/2026. **Base:** PR #84. **Alcance:** partidas de laboratorio expresamente inicializadas, sin HTTP propio ni motor de combate. **No modificar la base de producción.**

## Objetivo y arquitectura

La PR #84 tenía un SQLite experimental propio, `CCHL`. Este incremento añade un adaptador **optativo** que utiliza exactamente el almacenamiento de partidas `CCWB`, sin nuevas tablas, columnas, migraciones ni cambios en `CURRENT_SCHEMA_VERSION=1`.

El puente está en `packages/ancients-rules/sqlite-section-ccwb-bridge.mjs`, conectado desde `packages/sqlite-store/sqlite.mjs`. Usa tres tablas **ya existentes**:

- `matches.private_state`: nueva propiedad interna `ancientsSectionHistoryLab`, con estado inicial privado, lista de comandos privados y estado actual. El resto de propiedades sintéticas preexistentes se conservan para compatibilidad, pero **nunca se proyectan mientras está activo este modo**.
- `game_events`: **solo eventos públicos sanitizados**; las instancias de cartas, órdenes, manos y futuros robos **no se guardan en el payload público**.
- `game_commands`: actor, firma semántica, clave de idempotencia y revisión confirmada, en la misma transacción que los eventos y el estado.

Se mantienen `accounts`, `sessions` e `invitations` sin cambios. El modo **no utiliza ni migra** las tablas `CCHL` ni `CCRL`.

## Selección explícita del modo

La composición de la partida añade el método interno:

```js
const store = composition.getStore(matchId);
// Solo para fixtures controlados por el servidor; NO existe ruta HTTP:
store.initializeExperimentalSectionHistory('A', trustedLabSetup);
```

Solo se permite en una partida con ambos jugadores admitidos, revisión de juego 0, sin mazo sintético ya iniciado y sin comandos ni eventos anteriores. El propietario debe iniciar el laboratorio; la operación no permite sobrescribir una configuración existente. La configuración del mazo, el tablero y el mapa de sectores **no pueden proceder de un cliente**.

Una vez iniciado, `getStore().view(actor)` ofrece exclusivamente la proyección privada del modo experimental. **La ruta genérica `getStore().dispatch(request)` se bloquea siempre con `SECTION_LAB_INTERNAL_ONLY`**, incluso para comandos del laboratorio. El nuevo método **interno exclusivamente de pruebas** `getStore().dispatchExperimentalSectionHistory(request)` permite realizar las transiciones solo desde código confiable del servidor, sin ruta HTTP asociada. La inicialización del mazo sintético responde `SECTION_LAB_MODE_ACTIVE`; `pass_demo_turn` queda rechazado tanto en la ruta genérica como en el adaptador. **Una partida no puede mezclar ambas secuencias de comandos.** Las partidas que no activan este modo conservan su funcionamiento anterior.

**No hay un endpoint HTTP para activar este modo.** La lectura del estado continúa disponible en una proyección privada, pero la ruta genérica de comandos del navegador **no puede disparar acciones experimentales**, aunque un programador haya habilitado ese modo mediante una llamada interna. La composición todavía expone la infraestructura sintética de demostración: este incremento prepara una ruta interna de persistencia, **no autoriza su despliegue con escenarios reales o jugadores invitados de producción**.

## Protección de estado, concurrencia y privacidad

En cada consulta o comando del puente se reconstruye el diario desde el estado inicial y los comandos privados, comprobando cada transición y su correlación con las tablas `game_events` y `game_commands`. Se verifican revisión, secuencia, actor, firma semántica y formato público. La comparación con `matches.private_state` detecta pérdidas o alteraciones parciales; una alteración coordinada de la base por un adversario con acceso directo **no** queda protegida criptográficamente.

El comando utiliza `BEGIN IMMEDIATE` del almacenamiento principal. Coteja la revisión esperada y la clave de idempotencia antes de actualizar estado privado, evento público y registro del comando en **una sola transacción**. Si falla cualquiera de las inserciones, se revierte también la actualización de bloques de datos y revisiones. No existe un comando que aplique bajas.

El actor debe ser derivado por el servidor a partir de la sesión/autorización del participante; **nunca** de un campo de rol que pueda elegir un navegador. La lectura solo devuelve la mano del jugador autorizado, el número de cartas del oponente, las definiciones públicas del descarte y la carta visible.

`END_EXPERIMENTAL_TURN` continúa siendo un atajo de **laboratorio sin combate** y debe permanecer fuera de los endpoints de juego oficial.

## Verificación realizada

**14/14 pruebas nativas PASS**, 0 fallos, 0 omitidos, Node.js **22.16.0/Linux**, **sin WSL ni GitHub Actions**:

```sh
node --test --test-reporter=tap packages/ancients-rules/sqlite-section-ccwb-bridge.test.mjs
```

El fixture utiliza un SQLite con los **seis nombres de tabla y columnas relevantes para el adaptador**, más claves foráneas y restricciones; no sustituye la prueba del servicio completo `openSqliteComposition`. Cubre el alta exclusiva, confidencialidad de manos y de datos sintéticos antiguos, juego de carta y órdenes, seis tablas sin migración, conservación, concurrencia de conexiones SQLite, revisiones, claves de idempotencia, entrada maliciosa, alteraciones de eventos/comandos/estado, fin de turno experimental y **rollback tras fallo simulado de inserción de evento**.

SHA-256 del TAP reproducido: `ca181a5d7a6969f504f7c1ceb9071a50b541dd422dbfe727136023db62179393`.

Los archivos publicados y comprobados por hash Git:
- `sqlite-section-ccwb-bridge.mjs`: `447e2ba9059358aabdde8919610067af8a47b3dc`.
- `sqlite-section-ccwb-bridge.test.mjs`: `ca8f03b4a334b36db52dbc43241bb00312fb1a15`.

La integración adicional `packages/sqlite-store/ancients-section-history.test.mjs` incorpora **3 pruebas preparadas, pero pendientes de ejecución**, incluyendo el rechazo de comandos por la ruta genérica y el uso exclusivo del despacho interno; con el repositorio completo: cuentas reales de prueba e invitación, exclusividad entre modos y persistencia tras reinicio, y comportamiento intacto de partidas sintéticas no modificadas.

El manifiesto `scripts/check-browser-lab.mjs` registra ahora **63 suites**, no ejecutadas conjuntamente. También siguen pendientes Windows nativo, HTTP/SSE, pruebas de dos navegadores, recuperación completa y validación manual del reglamento.

## Pendientes para completar la integración

1. Sustituir los fixtures por **configuración autorizada de escenarios**, mapa de secciones del tablero, mano inicial y mazo real de Ancients, incluida la composición completa de cartas.
2. Preservar el historial con **identidad de usuario comprobada** en la capa HTTP y eventos SSE respetuosos con manos privadas; no exportar las llamadas internas `initializeExperimentalSectionHistory` ni el control de fin de turno de laboratorio.
3. Conectar la orden válida a un historial de movimiento real y al ataque posterior **en la misma revisión autorizada**. Mientras falten cartas especiales y excepciones de terreno/escenario, la comprobación no autoriza combates.
4. Ejecutar las 63 suites y comprobar instalación/uso local en Windows **sin WSL** antes de decidir fusiones. **No desplegar.**

**Resultado:** avance real en la reutilización del almacén principal, pero en modo explícitamente experimental, separado de la partida sintética y sin aplicar combates.
