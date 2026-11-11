# CCW-015 — Revalidación de sesión dentro de la transacción CCWB

**Fecha:** 11/11/2026. **Dependencia:** PR #87. **Ámbito:** únicamente el laboratorio interno de cartas de sección de *Ancients*. No añadir HTTP, migraciones ni permisos reglamentarios.

## Condición de carrera identificada

La integración de la PR #86 resolvía el bando a partir de `sessions.resolveSession(token)` y de los participantes de `matches`, pero hacía esa consulta **antes** de que el puente `sqlite-section-ccwb-bridge.mjs` obtuviera `BEGIN IMMEDIATE`. Otro proceso conectado al mismo SQLite podía, en principio, cerrar la sesión entre ambas operaciones. La escritura podía acabar con un actor que ya no tuviera sesión válida en el momento de comenzar la transacción.

## Implementación

La composición mantiene la comprobación inicial para proporcionar un error temprano y añade una segunda comprobación **dentro de la transacción de escritura**. En `sqlite.mjs`, `mutationSessionGuard(token,expectedActor)` comprueba `db.isTransaction` y vuelve a obtener el usuario de la sesión y su vínculo con `matches.owner_id/guest_id`; responde con la misma denegación `401 UNAUTHENTICATED` o `404 NOT_FOUND` ante revocación o falta de membresía. Comprueba también que el bando no haya cambiado desde la prevalidación.

`createSqliteAncientsSectionBridge` acepta un tercer parámetro interno opcional de autorización en `initialize(actor,setup,guard)` y un segundo en `dispatch(request,guard)`. El puente lo ejecuta **después de `BEGIN IMMEDIATE` y antes de leer/escribir el estado del diario**, de modo que se valida bajo el mismo bloqueo de escritura que protege revisión, eventos, comandos e idempotencia. La función opcional conserva la compatibilidad del fixture puro que usa un actor confiable, **no debe convertirse en un mecanismo público de autorización**.

No se cambia la lectura del laboratorio: `viewExperimentalSectionHistory({sessionToken})` sigue autenticando la sesión al entrar, pero no afirma que una lectura sea atómica con una eventual revocación posterior por otra conexión. La lectura de eventos y las demás rutas existentes mantienen sus controles específicos; este incremento solo resuelve las **mutaciones experimentales** de inicio y comando.

## Casos de prueba añadidos

En `packages/ancients-rules/sqlite-section-ccwb-bridge.test.mjs` se han preparado tres pruebas que comprueban que el guard ve `DatabaseSync.isTransaction === true`; una denegación no escribe `matches`, `game_events` ni `game_commands`; y una autorización positiva permite las operaciones con exactamente una comprobación dentro de cada transacción.

En `packages/sqlite-store/ancients-section-history.test.mjs` se han preparado dos pruebas que simulan revocación **entre prevalidación y entrada en el puente**, sustituyendo temporalmente el resolvedor de sesiones por un doble de prueba. La segunda llamada debe ocurrir con `isTransaction===true`, rechazar la operación sin mutar el diario y permitir un nuevo intento válido después de restaurar la sesión simulada.

Son simulaciones deterministas, **no** una demostración multiproceso del orden temporal en Windows. Para esa validación real habría que coordinar dos conexiones/procesos, cierre de sesión e intento simultáneo de operación.

## Evidencia disponible y límites

- El código y las cinco pruebas nuevas están publicados en una rama apilada y los cuatro archivos modificados se han leído de GitHub y analizado sintácticamente en V8 con las declaraciones `import/export` omitidas **solo para comprobar sintaxis**. No equivale a ejecutar pruebas `node --test`.
- El entorno local dispone de Node.js **22.16.0**, y `DatabaseSync.isTransaction` se ha verificado en transacciones `BEGIN IMMEDIATE`, pero no se ha ejecutado aún la suite de integración del repositorio completo.
- Sigue pendiente la batería SQLite, la regresión integral de **65 suites**, Windows 11, HTTP/SSE, dos usuarios y concurrencia multiproceso. Sin WSL ni GitHub Actions.
- Esta revalidación no impide a un administrador con control total de la base falsificar datos ni transforma el diario experimental en un motor reglamentario.

### Reproducción en Windows 11, sin WSL

Desde el checkout íntegro de esta rama:

```powershell
node --test --test-reporter=tap packages/ancients-rules/sqlite-section-ccwb-bridge.test.mjs packages/sqlite-store/ancients-section-history.test.mjs
$LASTEXITCODE
.\scripts\test-local.ps1
$LASTEXITCODE
```

**Criterio de fusión:** pruebas transaccionales nativas y regresión completa sin fallos, luego evaluación de privacidad y concurrencia real de dos sesiones. Hasta entonces mantener en borrador, sin desplegar ni modificar `main`.
