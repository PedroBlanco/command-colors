# LAB-ANC / SEC-001 — verificación nativa aislada del contrato SQLite/WAL

**Fecha:** 13/11/2026. **Ámbito:** laboratorio; **no** es una certificación de la composición real CCWB, de las reglas de *Ancients* ni de movimientos confirmados.

## Objetivo

Reproducir con Node.js y SQLite reales los supuestos de concurrencia de los que depende el diseño de lectura privada de CCWB: una sola instantánea WAL para sesión, pertenencia, revisión y eventos; visibilidad después del commit; rollback completo ante fallos; lectores que no bloquean escritores.

Suite autocontenida: `packages/sqlite-store/wal-snapshot-boundary.test.mjs`.

No importa los módulos de aplicación. Crea archivos SQLite en una carpeta temporal del sistema, usa dos conexiones `node:sqlite`, habilita WAL y `synchronous=FULL`, y elimina los archivos al terminar. Solo necesita Node.js con `node:sqlite` (probado con la versión 22.16.0). No requiere Docker, WSL, aplicaciones externas ni un servidor instalado.

## Pruebas nativas realizadas

1. Una revocación de sesión no confirmada no modifica una instantánea lectora ya fijada por su primera consulta.
2. Una revocación confirmada solo es visible para una lectura nueva; una instantánea ya abierta observa el estado anterior.
3. La lectura de sesión y pertenencia dentro de un mismo snapshot no mezcla información de dos commits distintos.
4. Revisión de partida y número de eventos se leen de la misma versión, aunque otra conexión confirme un cambio entre dos SELECT.
5. Un fallo de transacción escritora seguido de `ROLLBACK` conserva sin cambios tanto el registro de partida como los eventos.
6. Una transacción lectora bajo WAL no impide a otra conexión obtener `BEGIN IMMEDIATE`, confirmar una escritura y hacerla visible a una instantánea posterior.

### Evidencia verificada

- **Node.js:** `v22.16.0`, usando `node:sqlite` (SQLite `3.49.1`).
- Ejecución: `node --test --test-reporter=tap packages/sqlite-store/wal-snapshot-boundary.test.mjs` en el archivo exacto reconstruido localmente.
- Resultado: **6 PASS, 0 FAIL, 0 SKIP**, código de salida **0**; duración TAP aproximada de 145 ms.
- Blob Git SHA-1 del archivo probado y publicado: `1ceee42133c5333752f7440d7f709bb04e49db53` (coincidencia comprobada contra el contenido de GitHub).
- Hash SHA-256 de la salida TAP: `14efff4875061103f04460f45886ceec607adc3242680b67f8c2a06a88dcaa0c`.
- Incluida en el manifiesto estricto `scripts/check-browser-lab.mjs`: **80 suites declaradas** después de esta incorporación.

## Lo que estas pruebas NO verifican

La suite utiliza deliberadamente **tablas mínimas de laboratorio**, no el esquema completo de CCWB. Por tanto, **NO** se han ejecutado ni superado los **8 nuevos casos** de composición auténtica de `packages/sqlite-store/ancients-section-history.test.mjs`, los **10 casos** de `packages/local-api/gateway.test.mjs` con servidor HTTP, ni la regresión completa de 80 suites.

No demuestra la autorización de movimientos, reglas oficiales, garantías de privacidad del gateway ni la resolución de SEC-001 (#93). La simulación de un hexágono sigue siendo de solo lectura, con `movementAuthorized:false`, `canCommit:false` y sin eventos o movimientos confirmados.

## Pendientes de integración

Ejecutar las suites reales de CCWB/SQLite, HTTP/SSE y regresión de 80 suites en un árbol completo idéntico al SHA de la PR, sin WSL/Docker/Actions; revisar SEC-001 y únicamente después considerar fusiones a `main`. La falta de conectividad DNS a GitHub desde este contenedor impide actualmente obtener ese árbol completo para sus pruebas nativas.

No se requiere validación local del usuario todavía.


## Ampliación nativa a 8 casos (13/11/2026)

La suite se ha ampliado con **dos pruebas adicionales** aplicables
al futuro commit reglamentario de *Ancients*:

7. **Rechazo de promoción de una lectura obsoleta a escritura**:
   un lector fija una revisión antigua, otra conexión confirma una
   revisión nueva y el primero no puede sobrescribirla al intentar
   escribir desde el mismo snapshot. Al revertir su transacción, la
   revisión confirmada por el otro escritor se conserva.
8. **Exclusividad de `BEGIN IMMEDIATE` durante la revalidación**:
   la conexión que obtiene primero el bloqueo escritor puede comprobar
   la sesión y realizar el cambio de revisión sin que otro escritor
   revoque la sesión entre medias. La revocación del segundo escritor
   solo se ejecuta al liberarse el bloqueo.

En Node 22.16.0, el primer intento de la prueba 7 falló por una
**expectativa incorrecta del código de excepción**: la API
`node:sqlite` expone `ERR_SQLITE_ERROR` y el mensaje
`database is locked`, no necesariamente el código extendido
`SQLITE_BUSY_SNAPSHOT`. Se adaptó la aserción para aceptar el error
real de bloqueo y se volvió a ejecutar.

**Resultado final nativo:** **8 PASS, 0 FAIL, 0 SKIP, exit 0** con
Node 22.16.0 y SQLite 3.49.1. Se confirmó mediante
`git hash-object` que el archivo ejecutado coincide exactamente
con el publicado en GitHub:
`75b75c202c527d1414a40cb52d43d1ecfdf2a80f`.
SHA-256 del TAP de la última repetición:
`898eab28183c1fafe7a8198d8e40f2ed22809b1373aef5c2a42e8b6c63043ad8`.
La suite sigue siendo **una** entrada en el manifiesto, que permanece
en **80 suites**, aunque contiene ahora ocho casos.

**Límite invariable:** solo demuestra propiedades nativas de SQLite/WAL
sobre tablas reducidas, no el código de producción CCWB ni la
seguridad de las manos y eventos. Permanecen pendientes **9 casos
nuevos de integración CCWB/SQLite**, 10 casos HTTP y la regresión
completa; PR #96 sigue en borrador y `main` no cambia.
