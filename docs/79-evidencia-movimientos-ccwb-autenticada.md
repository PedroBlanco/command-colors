# LAB-ANC — Consulta autenticada de evidencia candidata (CCWB/SQLite)

**Fecha:** 12/11/2026. **PR:** #96 (apilada sobre #95). **Estado:** laboratorio privado, solo lectura; **no permite confirmar ni ejecutar movimientos**.

## Objetivo

La traza de la [etapa anterior](78-traza-auditoria-movimientos-candidatos.md) permite construir un registro inmutable y determinista a partir de un tablero y rutas. Hasta ahora era un módulo puro: no validaba la sesión, las órdenes del diario ni la versión persistida de la partida. Esta iteración lo conecta con la composición **CCWB privada**, manteniéndolo separado del reductor reglamentario de movimientos y de cualquier publicación HTTP o SSE.

## Fronteras de confianza

El único punto de entrada de composición es el método **interno**:

`getStore(matchId).precheckExperimentalSectionMovementEvidence(request, trustedContext)`

- `request` contiene **exactamente** `sessionToken`, `expectedRevision` y `actions`. Se bloquean campos extra, `actor` y `matchId` suministrados por clientes, rutas vacías o fuera de límites y estructuras con campos adicionales. Se comparte el validador estricto del preflight secuencial ya existente; no se añade ruta pública.
- `matchId` procede de `getStore`. El servidor deriva `actor` de la **sesión activa y de la pertenencia a esa partida**, no del cuerpo de la petición.
- `sqlite.mjs` agrupa **validación de identidad, consulta de pertenencia, comprobación de modo y respuesta de evidencia** dentro de `readSnapshot` (SQLite/WAL). No adquiere un bloqueo escritor ni inserta datos. Una revocación confirmada antes de abrir la instantánea impide el acceso; un lector conserva una instantánea consistente durante la consulta.
- El puente `sqlite-section-ccwb-bridge.mjs` reconstruye antes el **diario privado** de cartas y órdenes, comprueba eventos e idempotencia y detecta divergencias respecto de `matches.private_state`. Solo tras esa comprobación permite prevalidar la secuencia.
- `precheckStagedAncientsMovementEvidence` comprueba turno, fase, revisión, identidad, posiciones y órdenes del diario. Obtiene perfiles de unidades y terreno desde el argumento **confiable y separado** `trustedContext={unitTypes,terrain}`, no desde `actions`.
- La nueva evidencia se construye desde ese estado ya verificado, con `contextDigest` y una cadena SHA-256 de entradas ordenadas. Los identificadores se ordenan mediante **comparación fija de puntos de código**, no con `localeCompare`, para evitar diferencias entre configuraciones regionales e ICU.

### Resultados y denegaciones

El resultado válido devuelve `code:'SECTION_LAB_CANDIDATE_EVIDENCE'`, `evidence.status:'CANDIDATE_EVIDENCE'` y una traza solo para el actor autorizado. Una acción bloqueada, una revisión obsoleta, una secuencia con más acciones que órdenes o un bando no actuante produce `status:'BLOCKED'` y **`journal:null`**; no crea una traza parcial.

La evidencia y su respuesta mantienen expresamente `movementAuthorized:false`, `attackAuthorized:false`, `stateChanged:false`, `needsFullLegalityCheck:true`, y `boardChanged:false` en la composición. No se guardan rutas ni resúmenes en `matches`, `game_events` o `game_commands`. Tampoco se altera `game_revision`, la mano, el turno, las invitaciones ni el tablero. **No existe ningún endpoint HTTP/SSE para este método.**

### Limitaciones

El encadenamiento SHA-256 es útil para detección de alteraciones al reconstruir el mismo contexto, **no una MAC ni firma del servidor**. El método no crea eventos históricos de jugadas ni convierte `CANDIDATE_EVIDENCE` en movimiento legal. Todavía faltan un validador completo de reglas, consumo de órdenes, resolución de excepciones, combates y un reductor transaccional de movimientos confirmados.

## Pruebas y evidencia verificable

Se han agregado **9 casos** a la PR #96 respecto de su primera versión:

- **4** casos puros a `staged-movement-preflight.test.mjs`: orden y revisión correctas, reconstrucción de evidencia, rechazo de bando contrario o de órdenes insuficientes, incoherencia del historial y cambios de contexto.
- **4** casos de composición a `sqlite-store/ancients-section-history.test.mjs`: consulta privada sin escrituras, permisos y revocación, peticiones manipuladas/obsoletas y lectura WAL durante otro bloqueo escritor. **Preparados, todavía no ejecutados con `openSqliteComposition` real**.
- **1** caso a `movement-candidate-journal.test.mjs`: ordenación canónica independiente del locale; la nueva prueba compara el resumen de contexto con una construcción explícita mediante SHA-256.

**Evidencia ejecutada:**

| Alcance | Resultado | Precaución |
|---|---|---|
| `staged-movement-preflight.test.mjs`, código recuperado de GitHub | **24/24** en V8 aislado | Dependencias puras reconstruidas y resumen criptográfico simulado |
| `movement-candidate-journal.test.mjs`, código recuperado de GitHub | **11/11** en V8 aislado | Resumen simulado, **no** SHA-256 nativo |
| Módulo exacto `movement-candidate-journal.mjs`, blob `849f6f4023c966f51c505a5270b1750a9997f533` | **4/4** con Node.js 22.16.0 y SHA-256 real | Prevalidación de movimientos sustituida por un doble controlado; informe TAP SHA-256 `fadd3636754dea9e2fbce5459a264aa52b98d8532d9d05df68da319f9addfce0` |
| Ficheros nuevos/modificados de módulo, pruebas, puente y composición | **7/7** sintaxis correcta en V8 | No demuestra integración Node.js/SQLite |
| Nuevas pruebas de composición de la PR #96 | **4 pendientes** | Sin ejecución nativa de la composición, sesiones y SQLite |
| Inventario local de esta rama | **76 suites** | Regresión completa pendiente |

Los datos de pruebas ejecutadas distinguen siempre el **blob exacto** y el tipo de entorno. Las cuatro pruebas de SHA-256 real están en un test de humo aislado, **no constituyen la ejecución nativa del archivo completo de 11 pruebas**. Las suites de composición pendientes de PR #95 se mantienen abiertas y separadas.

## Condiciones de integración

1. Ejecutar la composición real de SQLite y los casos pendientes de la PR #95 y #96 con el mismo SHA y registrar TAP, hashes y salida.
2. Resolver la seguridad de sesiones, privacidad, HTTP/SSE y snapshot WAL de [SEC-001, PR #93](https://github.com/PedroBlanco/command-colors/pull/93).
3. Ejecutar la regresión completa del manifiesto de 76 suites y aceptación de dos jugadores antes de cualquier fusión o despliegue.
4. Implementar **en otra fase** el movimiento autorizado, que necesitará revisión de reglas, transición atómica del tablero y replay de comandos persistidos. No reutilizar esta traza como autorización.

**Se mantiene PR #96 en borrador; no fusionar en `main`, no desplegar y no solicitar pruebas locales al usuario por ahora.**

## Continuación — verificación semántica de evidencia JSON (12/11/2026)

Se corrigió un falso rechazo de `verifyAncientsCandidateJournal`: el método
comparaba `JSON.stringify` de objetos completos y, por tanto, consideraba
distintas dos trazas de igual contenido cuyos campos se habían serializado
en otro orden. La comparación utiliza ahora `isDeepStrictEqual` de Node.js:
el orden de propiedades JSON deja de importar, pero siguen rechazándose
campos omitidos o añadidos, estructuras alteradas, rutas modificadas,
resúmenes incorrectos y `movementAuthorized:true`. Una instancia de
prototipo no ordinario tampoco se admite como el mismo objeto JSON.

Se añadieron **dos pruebas** a
`movement-candidate-journal.test.mjs` (reescritura del orden de campos a
todos los niveles y prototipo no JSON), elevando esa suite de 11 a **13**
casos y los casos nuevos de esta PR de 19 a **21**. Hay **76 suites**
declaradas; **no se ha ejecutado** la suite de 13 casos en el árbol nuevo,
ni la integración CCWB/SQLite, ni la regresión. Se verificaron aparte
tres comparaciones nativas con `node:util.isDeepStrictEqual` en Node
22.16.0, pero **no son** evidencia de ejecución del módulo completo.

El diseño de la futura transición transaccional, reglamentariamente
autorizada y **separada de esta traza** está en
[contrato de movimientos confirmados](80-contrato-futuro-movimiento-autorizado-ancients.md).
No se añade ejecución de jugadas ni ruta pública. Se conserva el bloqueo
de fusión y despliegue.
