# LAB-ANC — Borrador privado persistente de movimientos (sin ejecución reglamentaria)

**Fecha:** 12/11/2026. **Rama:** `feat/lab-anc-leader-movement-preflight` (PR #95). **Estado:** laboratorio interno y privado. Ningún borrador permite mover unidades ni líderes en una partida.

## Decisión de diseño

La prevalidación de órdenes y trayectorias de `docs/75` y `docs/76` produce *candidatos*, no movimientos reglamentarios. Para conservar una propuesta durante una sesión o un reinicio de SQLite sin adelantar la autorización de movimiento, se incorpora un único **borrador privado persistente de la secuencia completa**, asociado a una partida, bando y revisión concreta del diario de cartas. El borrador no modifica la posición de las piezas, no registra un evento público, no consume órdenes y no altera `game_revision` ni `lobby_revision`.

El estado privado de la partida contiene la clave opcional `ancientsSectionMovementDraft`, con el contrato `ANCIENTS_PRIVATE_MOVEMENT_DRAFT_V1`. Se incorpora como dato privado adjunto en `matches.private_state`; **no se añaden tablas ni migraciones**. El campo no pertenece a `ancientsSectionHistoryLab` ni al replay de cartas y órdenes: el diario existente sigue conservando su propia integridad, eventos, revisión e idempotencia. El borrador no forma parte de la vista pública ni del protocolo SSE.

### Contrato interno

`packages/ancients-rules/movement-draft-contract.mjs` proporciona:
- `proposeMovementDraft`: exige datos válidos, revisión esperada del borrador, clave de idempotencia y firma SHA-256 determinista de la propuesta; el reintento idéntico devuelve `ALREADY_APPLIED`, el uso de la misma clave con contenido distinto se rechaza, y una edición con revisión antigua devuelve `STALE_DRAFT_REVISION`.
- `assertMovementDraft`: verifica formato, pertenencia al identificador de partida y coherencia del resumen SHA-256, para **detectar corrupción accidental**. El resumen guardado en la misma fila no es una firma de seguridad frente a un administrador de BD malicioso capaz de modificar ambos datos.
- `projectMovementDraft`: devuelve solo la propuesta del bando que la guardó y solo mientras `gameRevision` coincide. No expone clave de idempotencia ni resumen; marca `movementAuthorized:false`, `attackAuthorized:false`, `stateChanged:false` y `needsFullLegalityCheck:true`.

La revisión del borrador (`draftRevision`) es **independiente** de la revisión del juego. Si cambia el turno, cambia el bando o se avanza el diario, el borrador anterior deja de ser visible como propuesta vigente; no se promueve automáticamente al siguiente turno.

### Persistencia controlada en SQLite

En `packages/sqlite-store/sqlite.mjs` se añaden **exclusivamente para el laboratorio interno**:
- `saveExperimentalSectionMovementDraft({sessionToken,expectedRevision,expectedDraftRevision,idempotencyKey,actions},trustedContext)`: exige los campos exactos, obtiene el bando exclusivamente de la sesión y valida su pertenencia **dentro de `BEGIN IMMEDIATE`**. Comprueba la revisión actual del diario y vuelve a ejecutar `previewMovementSequence`, que verifica el historial privado de cartas/órdenes desde SQLite. Solo se persiste el borrador si toda la secuencia obtiene `CANDIDATE_SEQUENCE`, mediante `UPDATE matches SET private_state=?` atómico. Las secuencias bloqueadas no se guardan. El resultado indica expresamente `boardChanged:false`, `movementAuthorized:false`, `attackAuthorized:false`.
- `viewExperimentalSectionMovementDraft({sessionToken})`: obtiene sesión, pertenencia, estado, verificación del diario y borrador propio en una **misma instantánea WAL de solo lectura**. Un rival recibe `draft:null` (sin saber si el otro jugador dispone de borrador); un tercero recibe `NOT_FOUND`; una sesión revocada devuelve `UNAUTHENTICATED`.

El contexto `trustedContext={unitTypes,terrain}` se suministra por código confiable del servidor, **nunca dentro de `actions`**. No se crea ruta HTTP, se modifican reglas públicas ni se despliega servidor. Una propuesta es un *registro de trabajo*, no un movimiento autorizado.

## Pruebas, evidencia y pendientes

Esta ampliación añade:
- **9 casos** en `movement-draft-contract.test.mjs` (reintento, colisión de clave, revisión, privacidad, caducidad por juego, corrupción, validación e inmutabilidad). Los **9/9** se superaron con **Node.js 22.16.0 nativo (Linux, sin WSL)** y el SHA-256 real de `node:crypto`. Se copiaron al entorno aislado los **tres blobs Git exactos** del módulo, de su suite y de `hex-grid/hex.mjs`; sus hashes coincidieron con GitHub antes de la ejecución. Informe TAP SHA-256: `507d4c960f934b25934fc782adb8b2f9da2c5c49f8bc12ace3f570ba8822b600`. La primera evaluación V8 con digest simulado queda como control auxiliar, no como sustituto.
- **6 casos SQLite de integración preparados** en `sqlite-store/ancients-section-history.test.mjs`: persistencia tras reabrir la conexión, ausencia de eventos y mutaciones de tablero, idempotencia, rechazo de rutas/entradas, revocación y aislamiento del rival, caducidad al terminar el turno y autenticación bajo bloqueo de escritura/lectura WAL concurrente. **Pendientes de ejecución nativa sobre el código exacto de la PR**.

Total de la PR #95: **49 casos nuevos preparados** (34 previos + 15 de borrador). El manifiesto de su rama pasa a **74 suites**, incluidas dos suites de líder/secuencia y una nueva de contrato de borrador. La suite pura del borrador pasa **9/9 con Node.js nativo** y el trío previo de líder/secuencia/órdenes pasó **38/38 en V8 aislado**; **estos resultados no constituyen una regresión de SQLite/HTTP ni de las 74 suites**. Los nuevos casos SQLite de toda la PR están sin ejecutar (12: tres de líder, tres de secuencia y seis del borrador).

### Siguientes hitos y bloqueo de seguridad

1. Ejecutar las suites nativas del mismo SHA: contrato, secuencia, órdenes, composición SQLite real y regresión completa, preservando evidencia TAP y código de salida.
2. Resolver el bloqueo SEC-001 de [PR #93](https://github.com/PedroBlanco/command-colors/pull/93) antes de integrar servicios públicos.
3. Diseñar el reductor **reglamentario de movimientos reales** con consumo de órdenes y replay persistido: su contrato es **diferente** del borrador privado, y deberá validar por completo cartas, terreno, líderes, efectos, turnos y excepciones de escenarios.
4. Revisar contra las reglas de la edición física y realizar aceptación con dos jugadores y navegadores PC/móvil.

**No fusionar PR #95 a `main`, no exponer los métodos internos por HTTP y no confundir `CANDIDATE_SEQUENCE` o `SECTION_LAB_DRAFT_SAVED` con un movimiento ejecutado.**


### Identificación de archivos contrastados en la ejecución nativa

| Archivo | Blob Git SHA-1 | Resultado |
|---|---|---|
| `packages/ancients-rules/movement-draft-contract.mjs` | `1bbbdf90b0961574855efba3e025b648e5517cc0` | Exacto |
| `packages/ancients-rules/movement-draft-contract.test.mjs` | `417ce42486f6ec459a5d09546b39503994a5f5e5` | Exacto |
| `packages/hex-grid/hex.mjs` | `ae0e4526b8e91c4c0d5d94aebc52077b60f410da` | Exacto |

`node --test --test-reporter=tap packages/ancients-rules/movement-draft-contract.test.mjs` finalizó **9 PASS / 0 FAIL / 0 SKIP**, salida 0, tras reconstruir estos tres archivos en un árbol aislado. **Esta ejecución sí usa Node.js y SHA-256 nativo**, pero no llega a SQLite ni valida el servidor HTTP.


## Evidencia SQLite/WAL nativa adicional (12/11/2026)

Se añade `packages/ancients-rules/movement-draft-sqlite-contract.test.mjs`,
una suite independiente que ejecuta el **contrato puro del borrador contra
`node:sqlite` REAL** con archivo en disco, WAL, múltiples conexiones y
transacciones `BEGIN IMMEDIATE`. El archivo se reconstruyó exactamente
desde el blob `a686c5822c1045a45901d442c752f51266c816c0` de GitHub;
los blobs del contrato y la geometría son los mismos que en la prueba
nativa de nueve casos.

Los **8 casos nuevos** cubren:

1. Persistencia real tras abrir una segunda conexión, sin modificar
   `game_revision`, tablero ni tabla de eventos de la muestra.
2. Reintentos idempotentes, conflicto de clave y rechazo de revisión
   obsoleta sin sobrescribir los bytes anteriores.
3. Snapshot WAL antiguo estable mientras otra conexión confirma una
   actualización de borrador.
4. Exclusión entre escritores con `BEGIN IMMEDIATE` y ausencia de
   pérdida de actualización.
5. Caducidad del borrador tras avanzar la revisión del juego.
6. Detección de contenido alterado en la fila almacenada.
7. Lectura WAL del último valor confirmado mientras otra conexión
   mantiene un bloqueo de escritura y una modificación sin confirmar.
8. Rollback real al intentar almacenar un borrador inválido.

**Ejecución conjunta exacta:** `node --test --test-reporter=tap
packages/ancients-rules/movement-draft-contract.test.mjs
packages/ancients-rules/movement-draft-sqlite-contract.test.mjs`
con Node.js 22.16.0 nativo. Resultado: **17 PASS, 0 FAIL, 0 SKIP**,
código de salida **0**. Informe TAP SHA-256:
`278c4034328c38a5244a15e51740f1424a0284f77d6f66c1d2adf83333ef07b9`.
Hashes Git: contrato `1bbbdf90b0961574855efba3e025b648e5517cc0`,
test del contrato `417ce42486f6ec459a5d09546b39503994a5f5e5`,
geometría `ae0e4526b8e91c4c0d5d94aebc52077b60f410da`,
suite SQLite `a686c5822c1045a45901d442c752f51266c816c0`.

**Distinción importante de alcance:** esta suite contiene un esquema mínimo
`matches/public_events` y un adaptador de prueba para guardar el
contrato. **No ejecuta `openSqliteComposition` ni el servicio completo**,
por lo que **no valida** autorización real, invitaciones, reconstrucción
de cartas, integración de sesiones, ni las 12 pruebas SQLite agregadas
a `ancients-section-history.test.mjs`. Estas 12 pruebas y la regresión
completa siguen pendientes de ejecución. Tampoco se prueba HTTP/SSE.

**Estado acumulado de PR #95 en esta fecha:** **57 casos nuevos preparados**
(49 anteriores + 8 de SQLite/WAL nativo), **75 suites inventariadas y presentes**,
**17 casos nativos aprobados** en el subcontrato de borrador, 38 verificaciones
aisladas del movimiento/órdenes y 12 nuevos casos de composición SQLite sin
ejecutar. Ninguna acción de juego está autorizada ni se ha fusionado `main`.
