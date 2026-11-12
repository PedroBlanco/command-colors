# CCW-015 — Lecturas públicas en snapshot WAL sin proyección del laboratorio

**12/11/2026.** Corrección experimental apilada sobre la PR #83. El laboratorio privado de cartas y órdenes de *Ancients* no es una partida reglamentaria ni está habilitado por HTTP.

## Problema que resuelve

El almacenamiento `getStore(matchId).view(actor)` seleccionaba el modo de partida con una primera consulta SQLite y construía la proyección a partir de nuevas consultas sin compartir una transacción de lectura. Una segunda conexión SQLite/WAL podía cambiar la modalidad entre ambas operaciones, provocando una respuesta incoherente o un error al proyectar una fila distinta. Además, el gateway HTTP bloqueaba `status:'LAB_ONLY'` **después** de construir la vista privada, pese a que no debía solicitarla.

## Contrato nuevo

- `store.view(actor, {denyExperimentalLab = false})` reúne elección de modalidad y construcción de vista en una sola transacción **`BEGIN` de solo lectura**. El primer SELECT fija el snapshot WAL. La transacción termina con `COMMIT`, o `ROLLBACK` si hay un error. No se requiere bloqueo reservado de escritura.
- Con `denyExperimentalLab:true`, si la partida está en modo privado, el método devuelve **`{status:409,code:'SECTION_LAB_INTERNAL_ONLY'}` sin invocar la proyección privada**.
- Las llamadas internas existentes `view(actor)` conservan su contrato anterior; se mantiene el control de filas mixtas y la verificación del diario experimental.
- El gateway solicita la nueva modalidad denegada para **GET de partida, GET eventos, POST comandos y negociación inicial SSE**. Comprueba el resultado de denegación antes de examinar `matchId`. Mantiene también el rechazo de `status:'LAB_ONLY'` de otros almacenes como defensa complementaria.
- El flujo SSE solicita el modo denegado en cada tick y **cierra la conexión** ante el resultado 409 o un estado privado legado, sin emitir revisiones del laboratorio.
- La lectura HTTP de eventos conserva su segunda comprobación dentro del propio snapshot de `publicEvents`; no se eliminan protecciones existentes. Tampoco se modifica el esquema ni se añade una ruta pública.

Esta protección vincula la selección y proyección del estado en una instantánea; **no sustituye todavía un contrato unificado de autorización de sesión + lectura de cualquier modo en la misma instantánea**. Ese endurecimiento requerirá diseño y pruebas específicos. La modalidad privada ya dispone de sus operaciones propias ligadas a sesión.

## Evidencia y pruebas

Se agregan **cinco casos** en tres suites existentes:

1. Vista normal con `denyExperimentalLab:true`, sin escrituras ni transacción abierta.
2. Vista de laboratorio denegada para A y B antes de proyectar manos, manteniendo una vista interna autorizada.
3. Activación del laboratorio desde una segunda conexión seguida de nueva instantánea: ninguna mano pasa a la respuesta pública.
4. Gateway HTTP con SQLite real: las rutas de partida, eventos y comandos solicitan todas `denyExperimentalLab:true`.
5. SSE: el servicio solicita el modo denegado y cierra ante el resultado interno `SECTION_LAB_INTERNAL_ONLY`.

**Ejecuciones realizadas en este cambio:**
- **7/7 PASS** de la suite SSE nativa `revision-stream-lab-isolation.test.mjs` con Node.js 22.16.0. Se verificaron los blobs Git exactos del módulo `d75290d52bf3a839effed33d8ec0f328bcd68acc` y su suite `4489a78912e4b08c69ff47dfcfdb4464a1f33587`. Informe local `ccw-pr93-sse-native-7.tap`.
- Cinco comprobaciones aisladas del manejador `gateway.mjs` (blob `c08ce7a71750931b56bf83ecb1d5e4a0c3d2abea`) usando respuestas/almacén simulados: 409 al laboratorio en GET/eventos/comandos, 200 para lectura y eventos ordinarios, sin despachos indebidos y con `denyExperimentalLab:true` en todas las consultas. **No equivalen a una prueba nativa HTTP + SQLite**.

Los tres casos nuevos de composición SQLite y el caso HTTP+SQLite **no se han ejecutado todavía**, y tampoco la regresión global de esta nueva rama. Las **71 suites** del manifiesto no cambian; se ampliaron casos dentro de ellas.

## Validación propuesta en Windows 11 sin WSL

Desde un worktree independiente de la nueva rama:

```powershell
git fetch origin
git worktree add ..\command-colors-read-93 origin/fix/i4-ccwb-public-view-wal-snapshot
Set-Location ..\command-colors-read-93
.\scripts\validate-ccwb-http.ps1
# Si termina con código 0:
.\scripts\validate-ccwb-http.ps1 -FullRegression
```

El validador prioriza ahora **8 suites**, incluidas `browser-sqlite-smoke.test.mjs` y `command-deck-sse.test.mjs`, además de pruebas de los límites del laboratorio, SQLite y las reglas iniciales. Los informes TAP se guardan con SHA-256 en `.local-test-reports/` sin sobrescribir ejecuciones anteriores.

**Criterio de fusión:** no fusionar esta rama fuera del árbol experimental antes de ejecutar las nuevas pruebas con HTTP + SQLite real y verificar que no hay regresiones. No modifica `main`, no permite movimientos ni combates reglamentarios y no habilita despliegue de producción.
