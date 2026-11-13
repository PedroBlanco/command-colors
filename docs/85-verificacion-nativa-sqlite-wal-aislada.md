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
