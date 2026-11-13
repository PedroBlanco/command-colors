# LAB-ANC — Cartas ordinarias de sección y comprobación histórica de órdenes

**Fecha:** 11/11/2026. **Dependencia:** PR #82. **Reglas:** *Command & Colors: Ancients*, juego básico, tercera edición (2009). **Estado:** comprobación parcial, sin autorización de cartas ni de combate.

## Alcance

Se incorpora `packages/ancients-rules/section-card-order-screen.mjs`, un **control puro y no ejecutable** para las nueve cartas de sección ordinarias: ordenar hasta **2, 3 o 4** unidades y/o líderes en **izquierda, centro o derecha**. No se incluyen *Coordinated Attack*, *Out Flanked*, cartas de tropas, liderazgo ni tácticas. Las denominaciones son identificadores técnicos; no se reproducen textos de las cartas.

Referencia: [cartas de sección](https://www.commandsandcolors.net/ancients/the-game/main/command-cards/section-cards-27-cards.html) y [órdenes a unidades y líderes](https://www.commandsandcolors.net/ancients/the-game/main/07-order-units-and-leaders.html).

### Evidencia exigida — solo datos del servidor

`screenBaseAncientsSectionCardOrders({turnState,sessionSide,expectedRevision,handAtPlay,cardPlay,orderSnapshot})` compara:

- `turnState`: partida activa de Ancients básico, fase `COMBAT`, bando activo, revisión y listas únicas **explícitas** `orderedUnitIds` y `orderedLeaderIds`. Esta segunda lista todavía no forma parte del contrato anterior de turnos; **debe añadirse y mantenerse en el historial auténtico**, no fabricarse en producción.
- `handAtPlay`: fotografía de la mano **anterior a jugar la carta**, con bando, revisión y pares únicos de instancia/definición. Se rechaza una carta inexistente en esa mano o cuya definición haya cambiado.
- `cardPlay`: bando, revisión, instancia y definición de carta jugada, posteriores a la fotografía de la mano.
- `orderSnapshot`: órdenes y posiciones **cuando se asignaron las órdenes**, no las posiciones actuales tras mover. Contiene registros de unidades y líderes, así como la pertenencia a secciones tomada del tablero y orientación **de ese jugador en ese momento**.
- Se comprueban identidad/propietario, secuencia de revisiones, máximo de órdenes, duplicados, hexágonos incompatibles, piezas enemigas, secciones no autorizadas, miembros de la frontera entre dos secciones y coincidencia de las listas de órdenes con el turno.

**Importante:** el objeto `sectorCells` debe provenir de la representación oficial de sectores del escenario, suministrada por el servidor. El módulo exige datos coherentes, pero **no valida todavía toda la geometría oficial de sectores**: no deduce sectores desde la coordenada ni certifica la orientación o el mapa. Del mismo modo, cotejar una fotografía de mano no prueba todavía su autenticidad frente al mazo y a los eventos de robo, juego y descarte.

Una unidad con líder asociado que **no se ordena por separado** cuenta como una sola orden. Si el líder recibe una orden distinta, contabiliza otra orden; la legalidad de separarlo, sus desplazamientos y las restricciones particulares requieren otro módulo.

El resultado `CANDIDATE` incorpora **solo conteos y tipo de sección**, nunca identificadores de cartas, mano ni piezas. Conserva explícitamente `cardHandEventVerified:false`, `sectionGeometryVerified:false`, `cardPlayAuthorized:false`, `ordersAuthorized:false`, `attackAuthorized:false` y `needsFullLegalityCheck:true`.

## Consulta SQLite de solo lectura

El laboratorio `packages/ancients-rules/sqlite-reservation-lab.mjs` incorpora:

```js
previewSectionOrderProof({matchId,sessionUserId,expectedRevision})
```

La función recupera `turnState.sectionOrderProof` de SQLite **en una transacción**, exige usuario participante derivado de la sesión, revisión válida y una prueba histórica coherente. Solo devuelve un resultado resumido `SECTION_ORDERS_SCREENED`, sin `handAtPlay`, `cardPlay` ni identificadores de unidades. Cuando falta o es contradictoria la prueba histórica, responde `SECTION_ORDER_PROOF_UNAVAILABLE`.

- No se añade endpoint HTTP ni se acepta la mano, las cartas o los sectores enviados por el cliente.
- No modifica el tablero, turno, eventos, comandos ni revisiones.
- Es una **API experimental de consulta**; el laboratorio puede poblar `sectionOrderProof` mediante fixtures de prueba. **No existe todavía el flujo real** que emita esa evidencia desde el mazo, las cartas del jugador, el escenario y las órdenes oficiales.
- Los preflight anteriores de impactos permanecen **sin autorización**. Esta consulta tampoco se trata como un permiso reutilizable para confirmar bajas.

## Pruebas

**19/19 pruebas nativas superadas** con Node.js **v22.16.0** en Linux (sin WSL ni GitHub Actions):

```sh
node --test --test-reporter=tap packages/ancients-rules/section-card-order-screen.test.mjs
```

Se verificó que los dos archivos publicados en GitHub coinciden **exactamente por hash Git** con los ejecutados:

- `section-card-order-screen.mjs`: `eee8e3829f68c7f65e109ea9b772749fc46f7f9b`.
- `section-card-order-screen.test.mjs`: `0f2b84ed112f0fca3a3709f8dfefc13ec8cb1fa4`.

Se añadieron además **cinco casos SQLite** a `sqlite-block-loss-preview.test.mjs`: lectura privada de evidencias, ausencia de pruebas históricas, otro jugador/revisión antigua, manipulación de instancias o sectores y rechazo de parámetros arbitrarios. **Todavía no se han ejecutado nativamente** con toda la base de dependencias.

El manifiesto general pasa a **59 suites registradas**; las 59 suites no se han ejecutado como regresión integral.

## Próximo objetivo imprescindible

Implementar la **autoridad real** de una mano, un mazo, descarte, carta jugada, órdenes y sectores del escenario con eventos persistidos y revisiones, manteniendo la privacidad entre jugadores. Solo entonces se podrá integrar esta comprobación en un comando de autorización de combate; todavía faltan cartas especiales, ataques excepcionales, movimiento completo y comprobaciones de escenario.

**Mantener en borrador. No fusionar, activar bajas ni desplegar.**


> **Clasificación de seguimiento (12/11/2026):** se corrige el identificador inicial de esta documentación, que vinculaba incorrectamente esta fase a `CCW-015` (reservado para dados digitales). El trabajo histórico y sus PR conservan sus números originales; este documento se clasifica ahora como `LAB-ANC` (laboratorio privado de cartas, órdenes o movimiento de *Ancients*).
