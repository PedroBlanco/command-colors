# SEC-001 — validación nativa parcial del guardia, SSE y gateway

**Fecha:** 13/11/2026  
**Rama:** `feat/lab-anc-movement-candidate-audit-trail` (PR #96).  
**Entorno:** contenedor Linux con Node.js 22.16.0; sin Docker, WSL, Actions ni pruebas en el equipo del usuario. Se ejecutó un servidor HTTP real escuchando exclusivamente en `127.0.0.1`.

## Preparación reproducible y control de integridad

Debido a que la red del contenedor no resuelve `github.com`, se reconstruyeron en un directorio temporal los **siete archivos** recuperados mediante el conector de GitHub. Antes de dar validez a los resultados se verificó **cada blob** con `git hash-object`; todos coincidieron con los hashes exactos publicados en esta rama:

| Archivo | Blob Git verificado |
|---|---|
| `packages/sqlite-store/section-mutation-session-guard.mjs` | `da1dfc312cd59761dc42e1300d60a1af08d6aafa` |
| `packages/sqlite-store/section-mutation-session-guard.test.mjs` | `a410ea0e48b15b913c8cc29dd3e21196b4131694` |
| `packages/local-api/revision-stream.mjs` | `e57db1cf13564104a23f541194a410266b286288` |
| `packages/local-api/revision-stream-lab-isolation.test.mjs` | `9f37f3a32852142d042bb0217071207a5a0c1ab0` |
| `packages/local-api/browser-session.mjs` | `0d23fc813d515bc3a618752426f4f0f0064852b9` |
| `packages/local-api/gateway.mjs` | `3b97a34b46c3d7b056750001eda7005d4056baa5` |
| `packages/local-api/gateway.test.mjs` | `7b324dc07d0567709c9aa9670af849b6af992c19` |

Las rutas de los archivos se preservaron de forma relativa dentro del mismo directorio para ejecutar imports ESM, sin modificar su contenido. La nueva regresión de inicialización de mazo se ejecutó **antes** de publicar y se compararon los blobs Git del módulo y prueba después de publicar.

## Resultado

Se ejecutó `node --test --test-reporter=tap` sobre las tres suites indicadas:

- `section-mutation-session-guard.test.mjs`: **8/8 PASS**. `DatabaseSync` real sobre SQLite/WAL temporal, revocación y cambio de bando entre preflight y `BEGIN IMMEDIATE`, rechazo sin transacción y bloqueo de escrituras concurrentes.
- `revision-stream-lab-isolation.test.mjs`: **8/8 PASS**. Módulo SSE auténtico de la rama con respuesta/eventos de prueba; cierra tras revocación, expulsión, laboratorio privado, revisión inválida y revocación mientras espera el almacén.
- `gateway.test.mjs`: **11/11 PASS**. Servidor HTTP **real** en loopback y solicitudes mediante `fetch`; los servicios de identidad/invitaciones/almacén son *dobles de prueba*. Incluye separación de manos por jugador, rechazo de terceros, seguridad de rutas privadas y un nuevo caso de proyección cruzada de inicialización de mazo.

**Resultado agregado: 27 PASS, 0 FAIL, 0 SKIP, exit 0**.  
**SHA-256 de salida TAP conjunta:** `186872586809fff93e663f85cd2edfbe71183ae350669540385c819056be9705`.

## Corrección incorporada a raíz de la revisión

La ruta `POST /api/matches/{matchId}/deck/initialize` enviaba la vista `result.view` sin verificar su identificador de partida. En cambio, `POST /commands` ya negaba resultados cuyo `view.matchId` difiriese de la partida consultada. Esta asimetría podía exponer datos privados si un adaptador o almacén devolvía una proyección incorrecta.

El gateway **ahora devuelve 503 `SERVICE_UNAVAILABLE` sin vista** si la inicialización del mazo devuelve un `matchId` ajeno. La nueva regresión inyecta deliberadamente `yourHand:['OTHER_MATCH_PRIVATE_DECK']` en una vista de otra partida, y exige que nunca salga en la respuesta HTTP. El caso número 11 de `gateway.test.mjs` pasó usando el gateway real. Se ha incorporado el mismo guardia y una prueba equivalente a la PR #93, aunque **la variante de PR #93 todavía no se ha ejecutado nativamente**.

## Límites explícitos

Esta validación **no** comprueba el gateway conectado al almacén CCWB/SQLite completo, ni la resolución de sesión real en HTTP, ni las nueve pruebas anteriores y la nueva regresión del diario `ancients-section-history.test.mjs`, ni las diez pruebas de seguridad trasladadas desde #93, ni el conjunto de **80 suites**. La suite de guardia sí usa `node:sqlite` real; las otras dos usan dobles para la identidad o el almacén.

No se ha ejecutado ni autorizado un movimiento reglamentario ni publicado un endpoint de laboratorio. SEC-001 (#93) continúa abierta, ambas PR permanecen en borrador y `main` no se ha modificado. No es una garantía de seguridad de despliegue en Internet.
