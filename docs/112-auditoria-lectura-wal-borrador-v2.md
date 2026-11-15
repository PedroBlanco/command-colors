# Ancients — inspección privada de solo lectura del diario de movimientos V2

**Fecha:** 15/11/2026 · **Issue:** [#97](https://github.com/PedroBlanco/command-colors/issues/97) · **Base:** PR #124 (`feat/ancients-foot-path-v2-sqlite-stage`), apilada sobre #123–#111 y la PR consolidada #108.

## Objetivo

La PR #124 añadió persistencia de un borrador **privado, provisional** de un recorrido de infantería de uno o dos hexágonos. Se incorpora ahora una **inspección sin escritura que verifique sus anclajes históricos completos desde SQLite**, incluida la posible suplantación de claves de comandos ya confirmados, antes de confiar siquiera en sus metadatos internos.

Es una capa de integridad, **no** una autorización de movimiento. El diario V2 sigue sin poder confirmarse como jugada, alterar el tablero oficial, generar un comando de juego o emitir un evento público.

## Contrato interno

Se incorpora el método de almacén `store.inspectExperimentalSectionFootPathV2Stage({sessionToken}, trustedScenario)`. **No tiene ruta HTTP/SSE**; `trustedScenario` procede exclusivamente del servidor/laboratorio y no de la petición.

1. `snapshotFootPathV2ReadAuditRequest` exige **un solo campo propio** `sessionToken`, lo copia por descriptor sin ejecutar getters, y rechaza `actor`, `board`, `ruleset`, `scenario`, `canCommit` y campos extra.
2. Se abre una única transacción de lectura **WAL `BEGIN`**: se comprueban sesión viva y membresía, fila de partida y disponibilidad del CCWB sintético, con un único snapshot.
3. El puente `createSqliteAncientsSectionBridge.verify(row)` **reconstruye todo el historial real de cartas y órdenes** desde el estado inicial y `ancientsSectionHistoryLab.commands`; verifica contra `game_revision`, todas las filas de `game_events` (secuencia, `visibility='public'`, payload exacto) y de `game_commands` (actor, revisión, clave, firma y orden). La referencia para el tablero de la auditoría no se toma del propio borrador.
4. La nueva función pura `auditPrivateFootPathV2Stage` comprueba separación de versiones V1/V2, reproduce por completo el **diario V2** y obtiene la acción y clave almacenadas. Con esos datos llama al planificador V2 de la PR #124, **que reconstruye otra vez los perfiles, órdenes, primera arista y estado inicial desde el CCWB verificado y el escenario sintético del servidor**, compara el anclaje histórico y exige un reintento semánticamente idéntico. Una ruta alterada, política discordante, otro escenario, revisión desfasada o diario corrupto se rechaza.
5. Antes de informar de éxito, el puente comprueba que la clave provisional no colisiona con ningún `(match_id,actor,idem_key)` ya registrado en `game_commands`; **no** acepta un diario internamente consistente si intenta reutilizar una clave realmente confirmada.
6. La salida es **solo** `VERIFIED` con revisión provisional y número de hexágonos, `ABSENT`, `NOT_FOUND` o rechazo de integridad. **No expone partida, actor, unidad, recorrido, clave, firma, mano, estado, diario ni eventos.** El jugador sin el turno recibe `NOT_FOUND` independientemente de si existe o no un borrador del rival, para evitar una fuga de existencia.

Todas las respuestas correctas contienen `movementAuthorized:false`, `officialMovementAuthorized:false`, `canCommit:false` y `dbChanged:false`. La inspección no inserta ni modifica filas y no elimina borradores válidos o corruptos. Un fallo al verificar el historial CCWB revierte también la transacción de lectura.

## Protección adicional detectada durante la revisión

En `snapshotFootPathV2StageRequest`, la función interna `dense` validaba la longitud de arrays mediante descriptores, pero luego utilizaba `xs.length` y `path.length`: **si un array estaba envuelto en un `Proxy`, esas lecturas podían activar su trampa `get`**. Se ha corregido para utilizar exclusivamente `Object.getOwnPropertyDescriptor(...,'length').value`, también en los bucles.

La inspección V2 copia por descriptores cada celda de una ruta persistida validada **antes de pasarla de nuevo al planificador**, evitando ejecutar `Proxy.get` mediante operaciones posteriores de arrays. Rechaza getters, prototipos exóticos, listas dispersas, rutas manipuladas, símbolos y entradas inválidas sin devolver estado parcial.

Estos controles defienden los componentes puros ante entradas de prueba hostiles, aunque los datos SQL reales se recuperen normalmente de `JSON.parse` y, por tanto, sean objetos de datos ordinarios.

## Resultados y límites

- Nueva suite `private-foot-path-v2-read-audit.test.mjs` (**suite 91**) con **19 pruebas**: ausencia y visibilidad del borrador, comparación con CCWB, cambio de escenario, revisión o tablero, manipulación de firma/ruta/evento, getters y proxies anidados, privacidad, y respuesta indistinguible para el jugador contrario.
- La suite anterior `private-foot-path-v2-sqlite-stage.test.mjs` contiene **20 pruebas** y vuelve a ejecutarse como regresión tras corregir `dense`.
- Se añaden **7 pruebas de integración SQLite** a `ancients-section-history.test.mjs`: lectura WAL sin escrituras y tras abrir otra conexión, ausencia, rival/externo, sesión revocada, historial real de eventos manipulado, firma o política V2 alterada y colisión con una clave previamente confirmada.
- **20/20** regresión pura y **19/19** nueva suite se han ejecutado de modo aislado en V8 sobre fuentes/tests reales recuperados de GitHub, con `node:test` emulado y clonación JSON: **39/39** en conjunto. Las siete nuevas integraciones SQLite están **escritas, pero no ejecutadas de forma nativa**.
- Última validación nativa Windows proporcionada por el usuario: **1045/1045 pruebas en 80 suites**, en PR #108. La cadena hasta #124 tiene **1350 pruebas previstas en 90 suites**; esta PR añade 19 + 7 = **1376 pruebas previstas en 91 suites**, sin regresión completa nativa ejecutada.

**No se modifica la estructura SQL, el motor oficial de movimientos, el sistema de eventos, la idempotencia confirmada ni HTTP/SSE.** No solicitar pruebas locales al usuario por el momento. Mantener esta PR en **borrador** sobre #124, `main` sin cambios.

## Próximos bloqueos

Esta auditoría prueba coherencia contra el **CCWB sintético de laboratorio** y contra sus filas SQL, pero **no certifica todavía las reglas ni los escenarios oficiales de Ancients**. Sigue pendiente resolver SEC-001 (#94), introducir la procedencia reglamentaria completa y la verificación real de carta/órdenes/terreno/líderes y, solamente después, diseñar una transacción oficial que confirme atómicamente **estado, revisión, comando idempotente y evento público** con replay de hechos confirmados (#97).
