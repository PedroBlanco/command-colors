# CCW-015 — Diario persistente experimental de cartas de sección (*Ancients*)

**Fecha:** 11/11/2026. **Base:** PR #83. **Alcance:** nueve definiciones de cartas ordinarias de sección (2, 3 o 4 órdenes; izquierda, centro o derecha), **solo laboratorio**. No hay autorizaciones de combate ni integración con la base principal de partidas.

## Problema y decisión

Las PR anteriores comprobaban una fotografía de `handAtPlay`, `cardPlay` y `orderSnapshot`. Eso permitía detectar incoherencias internas, pero **no** demostrar que la fotografía proviniera del historial real de manos y jugadas.

Este incremento desarrolla un diario **persistente y reconstruible** para el laboratorio, donde las operaciones aceptadas proceden de una transacción del servidor y la mano inicial de una configuración controlada por el servidor. No se pretende que una fotografía enviada por el navegador pruebe la propiedad de una carta. Se mantiene la frontera con la aplicación real: las cartas y escenarios oficiales siguen pendientes de configurar, y no se ejecuta ningún combate.

## Módulo puro: `section-history-journal.mjs`

- `initializeSectionHistoryLab`: exige instancias de carta únicas, definiciones pertenecientes a las nueve cartas soportadas, tamaños de mano explícitos, piezas y mapa de sectores aportados por el servidor. Reparte tras un **Fisher–Yates con `crypto.randomInt`**; la inyección `randomIndex` existe exclusivamente para fixtures y no debe cruzar ninguna ruta HTTP.
- `applySectionHistoryLabCommand`: transiciones **deterministas** con revisión, fase y actor ya validado:
  - `PLAY_SECTION_CARD`: localiza el identificador de instancia **en la mano del jugador activo**, guarda la mano anterior y registra la carta pública por definición, no por identificador privado.
  - `ASSIGN_SECTION_ORDERS`: recoge solo IDs elegidos y **deriva las posiciones y la pertenencia a sectores del tablero del servidor**. Invoca el control de #83 para comprobar límites y propiedad de las piezas. Guarda una instantánea de órdenes; **no las autoriza como órdenes oficiales**.
  - `END_EXPERIMENTAL_TURN`: **salto exclusivo del laboratorio**, pasa la carta al descarte, roba de un mazo privado prebarajado y alterna jugador. Emite `LAB_TURN_ENDED_WITHOUT_COMBAT`; **nunca** confirma un combate ni debe exponerse en producción.
- `assertSectionHistoryLab`: conservación exacta de cada instancia en mazo, manos, carta activa y descarte; verifica fases y registros relacionados.
- `replaySectionHistoryLab`: reconstruye un estado desde el estado inicial y la secuencia privada de comandos.
- `projectSectionHistoryLab`: entrega al jugador **solo su propia mano**; del oponente, únicamente número de cartas. El mazo oculto no aparece, y el descarte solo expone definiciones públicas.

## SQLite aislado: `sqlite-section-history-lab.mjs`

`openExperimentalSectionHistoryLab({file})` crea o abre exclusivamente un fichero **CCHL**, con `application_id=0x4343484c` y `user_version=1`, rechazando ficheros con otro esquema, versión o tablas adicionales. Tres tablas:

| Tabla | Contenido |
|---|---|
| `history_matches` | Jugadores, revisión y estado privado completo |
| `history_events` | Secuencia, evento privado (comando o estado inicial) y proyección pública |
| `history_commands` | Actor autenticado, clave de idempotencia, firma semántica y revisión confirmada |

`seedFixture` instala un tablero y mazo **de prueba** controlados por el servidor; no es un endpoint HTTP y no debe usarse con cartas o datos de usuarios reales.

`dispatch` admite únicamente los campos necesarios para cada tipo de operación. **La identidad de jugador procede del `sessionUserId` confiable**, nunca de un `actor` elegido por el cliente. Para cada transacción `BEGIN IMMEDIATE`:

1. Verifica que la sesión corresponda a un participante de la partida.
2. **Reejecuta todos los eventos privados desde el estado inicial**, comprobando secuencias, eventos públicos, revisión y estado guardado.
3. Comprueba asimismo que cada evento posterior al inicial corresponda a una entrada de `history_commands` con actor, revisión y firma semántica coincidentes.
4. Compara clave de idempotencia y revisión. La repetición idéntica se reconoce; reutilizar la misma clave para otro comando se rechaza.
5. Si se acepta, actualiza revisión/estado y añade evento privado/público y registro del comando **atómicamente**. Una operación inválida no registra nada.

`view` y `publicEvents` verifican la integridad antes de responder y no exponen la secuencia privada. Usuarios ajenos reciben `NOT_FOUND`; los participantes solo acceden a las proyecciones de su propia mano. Un cambio inconsistente de eventos, comandos o estado devuelve `HISTORY_INTEGRITY_UNAVAILABLE`.

**Alcance de la integridad:** la comparación detecta borrados y alteraciones aisladas. No es una firma digital contra alguien que controle SQLite y pueda falsificar simultáneamente el estado inicial, los eventos y las firmas de comandos. Faltan un origen de autoridad externo, autentificación real del escenario y la mano inicial, almacenamiento seguro y auditoría.

## Pruebas reproducidas

Se ejecutó Node.js **v22.16.0** nativo en Linux, **sin WSL ni GitHub Actions**:

```sh
node --test --test-reporter=tap \
  packages/ancients-rules/section-history-journal.test.mjs \
  packages/ancients-rules/sqlite-section-history-lab.test.mjs
```

**33/33 casos correctos, 0 fallos, 0 omitidos:**
- 15 pruebas puras: conservación, mano propia, denegación de carta ajena, órdenes y líderes, fase/revisión, reconstrucción desde comandos, robo y descarte de laboratorio, privacidad.
- 18 pruebas SQLite: esquema diferente, dos jugadores, eventos públicos/privados, reapertura, transacciones y varias conexiones, idempotencia, fases, denegaciones, alteraciones de eventos/estado/comandos y segundo jugador.

SHA-256 de la salida TAP nativa: `aae045ad7cf7f48c7729b0477f944ac6159efeaae8e210e3e55e04c1f83d4b05`. Se contrastaron los **hashes Git exactos** de los cuatro archivos con los copiados a GitHub. Adicionalmente, se ejecutaron **52/52 pruebas nativas PASS**, 0 fallos y 0 omitidos, al combinar las **19 pruebas anteriores de cartas de sección** con las 33 del diario y SQLite (3 suites, Node.js v22.16.0/Linux). SHA-256 del TAP combinado: `9ea880736ff822403f8ce8e877cf918cb6e4c8ce7fa5a98ff2f2ba3170e2b5ce`. El manifiesto general registra ahora **61 suites**, pero **no** se ha ejecutado su regresión completa ni pruebas Windows, HTTP/SSE o dos navegadores.

## Pendiente antes de usarlo en partidas

1. Construir el **mazo oficial completo**, límites de mano, reparto y configuración de escenario, vinculando órdenes a la orientación real del campo de batalla. Las cartas de tropas, liderazgo y tácticas quedan fuera del incremento.
2. Integrar un diario autorizado equivalente en el almacén **CCWB de seis tablas**, sin adoptar el fichero experimental CCHL ni mezclar sus esquemas.
3. Validar las órdenes y movimientos con el turno reglamentario de Ancients y vincular esa evidencia a la **misma revisión** del combate, sin aceptar como autenticidad un `sectionOrderProof` libre o un permiso previo reutilizable.
4. Exponer únicamente proyecciones seguras mediante autenticación real y SSE, y probar simultaneidad, privacidad de dos navegadores y recuperación ante fallos.
5. Ejecutar las 61 suites nativas y la integración en Windows antes de decidir fusiones/despliegue.

**No hay autorización de cartas, órdenes, impacto, bajas ni combate completo. Mantener en borrador.**
