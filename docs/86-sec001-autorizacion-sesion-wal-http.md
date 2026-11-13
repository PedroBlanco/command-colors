# SEC-001 — autorización HTTP/SSE vinculada a sesión y snapshot WAL

**Fecha:** 13/11/2026  
**Rama:** `feat/lab-anc-movement-candidate-audit-trail` — PR #96 (borrador).  
**Procedencia:** se ha trasladado selectivamente el diseño y las comprobaciones de la PR #93, **sin fusionarla ni cerrarla**. La PR #93 sigue pendiente de revisión y de ejecución nativa integral.

## Problema resuelto en el código experimental

Comprobar la identidad del participante antes de consultar una vista pública o antes de pedir un bloqueo escritor **no equivale a autorización válida en la transacción posterior**. Otra conexión SQLite puede revocar una sesión o modificar la pertenencia a una partida entre ambas operaciones. Además, una partida sintética puede convertirse en laboratorio de cartas privadas después de la primera consulta del gateway.

La solución introduce dos fronteras distintas: lectura pública dentro de una única instantánea WAL y escritura autenticada tras adquirir `BEGIN IMMEDIATE`. No convierte ninguna simulación en movimiento autorizado.

## Contratos implantados

| Capa | Control |
|---|---|
| `packages/sqlite-store/sqlite.mjs` — `invitations.getMatch` | La sesión, pertenencia, lista de participantes y revisión de lobby se leen dentro del **mismo `readSnapshot`**. |
| `sqlite.mjs` — mutaciones de invitaciones | `createMatch`, `issueInvitation`, `acceptInvitation`, `rejectInvitation` y `revokeInvitation` vuelven a validar la sesión **dentro de `atomic`** antes de modificar registros. |
| `getStore.viewForSession({sessionToken})` | Resuelve sesión/bando y construye una **proyección pública** en un único snapshot WAL. Si la partida está en `LAB_ONLY`, devuelve `SECTION_LAB_INTERNAL_ONLY` **sin construir ni proyectar manos privadas**. |
| `getStore.publicEventsForSession({sessionToken})` | Repite sesión, pertenencia, exclusión del laboratorio y lectura de eventos públicos dentro de **su propio** snapshot WAL. |
| `getStore.initializeCommandDeckForSession({sessionToken})` | Deriva el actor en servidor y utiliza `mutationSessionGuard` después de `BEGIN IMMEDIATE` del mazo. |
| `getStore.dispatchForSession(request)` | Deriva el actor del token y pasa el guardia al despacho genérico. El tablero, los eventos y el diario no se escriben hasta revalidar sesión y pertenencia en la **misma transacción escritora**. |
| `packages/command-deck/sqlite-game.mjs` | `initialize` y `dispatch` aceptan un guardia interno opcional que se ejecuta dentro de `atomic`, antes de leer o alterar estado. |
| `packages/local-api/gateway.mjs` | Prefiere las API vinculadas a sesión para GET partida, eventos, SSE inicial, inicialización de mazo y comandos. Conserva fallback actor-based para almacenes sintéticos antiguos. Trata denegaciones como 401/404/409, sin serializar manos o errores privados. |
| `packages/local-api/revision-stream.mjs` | Cada tick SSE utiliza la vista vinculada a sesión si está disponible; cierra el flujo ante revocación, expulsión o laboratorio privado. |

Los métodos actor-based existentes continúan disponibles **solo como contrato interno/compatibilidad de laboratorio**. Los métodos HTTP no aceptan `actor` ni resultados reglamentarios del cliente; la sesión real determina el bando.

## Regresiones incorporadas de la PR #93

Se han integrado **10 casos** en suites ya registradas:

- **4 SQLite** en `packages/sqlite-store/sqlite.test.mjs`: vista de lobby WAL coherente, logout en segunda conexión, revalidación bajo bloqueo escritor en cinco mutaciones y denegación de escrituras posteriores a logout.
- **4 HTTP** en `packages/local-api/section-history-http-isolation.test.mjs`: revocación entre lobby/almacén en vista-eventos-comandos, revocación tras la vista previa a eventos, revocación antes de obtener bloqueo de escritura y revocación previa a inicialización del mazo.
- **2 SSE** en `packages/local-api/revision-stream-lab-isolation.test.mjs`: preferencia de lectura autenticada frente a actor legado y cierre ante revocación durante una operación asíncrona.

Después de incorporar los casos, las respectivas suites contienen **14, 11 y 8 tests**. Siguen siendo las mismas tres entradas del manifiesto de **80 suites únicas**. No se han activado GitHub Actions ni se ha creado ningún endpoint adicional.

## Evidencia y límites

Se ha comprobado la **sintaxis de siete archivos exactos** recuperados de la rama GitHub: cuatro módulos operativos y tres suites de prueba (mediante evaluación sintáctica aislada con los imports despojados). También se repitió de manera independiente la suite **nativa y autocontenida** `wal-snapshot-boundary.test.mjs` con Node.js 22.16.0 y `node:sqlite`: **8/8 PASS, 0 FAIL**.

**No se han ejecutado todavía las 10 nuevas regresiones integradas con el servidor real**, ni los nueve casos nuevos de simulación CCWB/SQLite, ni las 80 suites completas. Las pruebas nativas WAL son solamente un contrato de concurrencia sobre tablas simplificadas y **no validan estas nuevas rutas de código**.

La PR #93 **no queda resuelta ni fusionada** por esta transferencia. Antes de integrar en `main` es imprescindible ejecutar y revisar seguridad HTTP/SSE, regresión completa de un SHA exacto, pruebas de dos conexiones con sesión y pertenencia y reglas oficiales de *Ancients*. La PR #96 mantiene `draft` y `main` permanece intacta.
