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


## Ampliación: lectura privada en instantánea WAL y liberación de bloqueos

La composición ahora dispone de dos tipos de transacción, con objetivos distintos:

- **Escritura:** `atomic()` emplea `BEGIN IMMEDIATE`; en él se revalida la sesión del participante antes de persistir una carta o sus órdenes.
- **Lectura:** `readSnapshot()` emplea `BEGIN` (diferido) para leer sesión, membresía, estado y proyección privada de `viewExperimentalSectionHistory({sessionToken})` desde **una misma instantánea SQLite/WAL**. La lectura de `publicEvents(actor)` también pasa a esta modalidad: conserva la verificación del replay y los eventos en la misma instantánea, pero **ya no reserva el bloqueo de escritura** para una simple lectura. `publicEvents(actor)` sigue siendo una API interna: el llamante debe autenticar el actor.

La primera consulta SELECT de una transacción de lectura define la instantánea. Si una sesión fue revocada antes de esa lectura, la respuesta será denegada; una revocación posterior no puede cambiar retroactivamente la instantánea ya observada. Esto es coherencia transaccional, **no promesa de revocación instantánea de una lectura ya iniciada**.

En `ancients-section-history.test.mjs` se añadieron **2 casos adicionales**, pendientes de ejecución en el repositorio completo: resolución de sesión bajo transacción de lectura y capacidad de consultar manos/eventos mientras una segunda conexión mantiene `BEGIN IMMEDIATE` en modo WAL.

### Prueba nativa reproducible del contrato SQLite/WAL

Nueva suite independiente `packages/sqlite-store/wal-transaction-contract.test.mjs`, añadida al manifiesto canónico local. Ejecutada en **Node.js 22.16.0, Linux nativo, sin WSL ni GitHub Actions**, con SQLite real y dos conexiones a un archivo temporal:

```sh
node --test --test-reporter=tap packages/sqlite-store/wal-transaction-contract.test.mjs
```

**Resultado: 5 PASS, 0 FAIL, 0 SKIP.** Comprueba lectura concurrente con bloqueo de escritura, instantánea consistente después de un segundo commit, bloqueo de revocación durante `BEGIN IMMEDIATE`, rollback de lectura y momento en que comienza la instantánea. El archivo ejecutado tiene SHA-256 `92be87a1442aa3380b5f4d0465722c3bcc25ad0b210b240fad452a794c3acd35` y blob SHA Git `83fafa1fffd5f4c09f0147cf0310698bd2a6b401`, **idéntico al publicado en GitHub**.

La suite es de **contrato de SQLite**, no sustituye las pruebas integradas del adaptador ni la de revocación real mediante procesos y sesiones del juego.

El inventario local contiene ahora **66 suites** (65 anteriores + este contrato WAL). **No se ha ejecutado conjuntamente la regresión de 66 suites**; siguen pendientes Windows, HTTP/SSE, dos navegadores y las pruebas de composición.

En Windows 11, sin WSL, añadir la verificación del nuevo contrato a las instrucciones anteriores:

```powershell
node --test --test-reporter=tap packages/sqlite-store/wal-transaction-contract.test.mjs packages/ancients-rules/sqlite-section-ccwb-bridge.test.mjs packages/sqlite-store/ancients-section-history.test.mjs
$LASTEXITCODE
.\scripts\test-local.ps1
$LASTEXITCODE
```


## Reproducción multiproceso real — orden de confirmación de sesión

Para no confundir el contrato de dos conexiones en un proceso con un conflicto real entre procesos, se añadió `packages/sqlite-store/wal-cross-process-revocation.test.mjs`. La suite abre la misma base SQLite/WAL desde **dos procesos distintos de Node.js** y coordina sus operaciones mediante IPC:

1. **Revocación primero.** El proceso A invalida la sesión mientras mantiene `BEGIN IMMEDIATE`. El proceso B intenta obtener el bloqueo; cuando A confirma y B comienza su transacción, lee la sesión revocada y **no escribe el comando**.
2. **Comando autorizado primero.** B obtiene `BEGIN IMMEDIATE` y verifica la sesión aún válida. La revocación concurrente de A recibe `SQLITE_BUSY` y no interrumpe la operación ya autorizada. B confirma el comando, y solo entonces A puede revocar la sesión.

La suite contiene **2 pruebas, ambas PASS**, Node.js 22.16.0 sobre Linux nativo, sin WSL y sin GitHub Actions; se ejecutó además **10 veces seguidas sin fallos** para comprobar estabilidad básica. Blob SHA Git del archivo ensayado y publicado: `90d876673d94b003a390eee5f854d87771795424`.

**Ejecución nativa conjunta:** `lab-idempotency-binding.test.mjs`, `lab-command-signature.test.mjs`, `wal-transaction-contract.test.mjs`, `wal-cross-process-revocation.test.mjs`: **26 PASS, 0 FAIL, 0 SKIP**, código de salida 0. SHA-256 del TAP: `00a27bbfb986952e67cab797cc40b13e07aecbf0447c04d666186646374cbfbf`.

El manifiesto contiene ahora **67 suites únicas**. Este ensayo multiproceso verifica directamente el contrato de serialización de SQLite y el momento de validar la sesión, pero **no sustituye** la integración de identidad, invitaciones y comandos del juego: los tests `sqlite-section-ccwb-bridge.test.mjs` y `ancients-section-history.test.mjs` y la regresión de 67 suites siguen pendientes de ejecutar desde un checkout completo.

### Comandos de reproducción — Windows 11 sin WSL

```powershell
node --test --test-reporter=tap packages/sqlite-store/wal-transaction-contract.test.mjs packages/sqlite-store/wal-cross-process-revocation.test.mjs
$LASTEXITCODE
node --test --test-reporter=tap packages/ancients-rules/sqlite-section-ccwb-bridge.test.mjs packages/sqlite-store/ancients-section-history.test.mjs
$LASTEXITCODE
.\scripts\test-local.ps1
$LASTEXITCODE
```


## Extracción de la guardia transaccional y prueba directa con SQLite (11/11/2026)

El doble control de sesión implementado en esta rama ya no queda oculto en una función local difícil de probar: se ha extraído a `packages/sqlite-store/section-mutation-session-guard.mjs`, que expone `makeSectionMutationSessionGuard` para uso **interno** de la composición.

La guardia recibe la conexión SQLite, la función de resolución de actor autenticado, el token y el bando inicialmente identificado. Su callback rechaza invocaciones fuera de una transacción, vuelve a consultar la identidad actual y exige que el bando coincida. Si la sesión ha desaparecido responde `401 UNAUTHENTICATED`; si ha cambiado la identidad/bando, `404 NOT_FOUND`. `sqlite.mjs` invoca este componente desde el mismo `atomic(BEGIN IMMEDIATE)` que persiste estado, eventos e idempotencia.

Se añadió `packages/sqlite-store/section-mutation-session-guard.test.mjs` al inventario: **8/8 PASS, 0 FAIL, 0 SKIP** con `DatabaseSync` sobre una base SQLite temporal real. Incluye: parámetros inválidos, invocación fuera de transacción, operación autorizada dentro de `BEGIN IMMEDIATE`, revocación y reasignación de bando por segunda conexión entre prevalidación y comienzo de escritura, exclusión mutua con una revocación concurrente, preservación de errores de autenticación y rechazo de un resultado de resolución vacío.

La ejecución **conjunta** de las cinco suites nativas disponibles —vinculación de clave, firma versionada, contrato WAL de dos conexiones, carreras entre dos procesos y guardia SQLite— produjo **34 PASS, 0 FAIL, 0 SKIP** en Node.js 22.16.0/Linux nativo, sin WSL ni GitHub Actions; código de salida 0. SHA-256 del informe TAP: `e3b4a289ba823b850e5781b889fa110ca61f330f76ef7c58ad5774109e70066f`.

**Hashes Git de los dos archivos nuevos, cotejados con lo ejecutado:**

- `section-mutation-session-guard.mjs`: `da1dfc312cd59761dc42e1300d60a1af08d6aafa`
- `section-mutation-session-guard.test.mjs`: `a410ea0e48b15b913c8cc29dd3e21196b4131694`

El manifiesto crece a **68 suites**. Continúa **pendiente** la ejecución de `sqlite-section-ccwb-bridge.test.mjs`, `ancients-section-history.test.mjs` y la regresión de las 68 suites desde el repositorio completo; las 34 pruebas anteriores **no** equivalen a esa integración. El laboratorio sigue sin autorización de reglas oficiales ni exponer nuevos endpoints HTTP.
