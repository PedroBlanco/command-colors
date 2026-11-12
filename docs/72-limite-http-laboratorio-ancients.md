# SEC-001 — Aislamiento del laboratorio privado frente a HTTP y SSE existentes

**12/11/2026.** Corrección de frontera de seguridad, apilada sobre la PR #87. No incorpora rutas nuevas ni reglas oficiales.

## Riesgo constatado

Las PR #85–#90 no crearon una ruta HTTP para el diario experimental, pero `getStore(matchId).view(actor)` devuelve su proyección privada (`status:'LAB_ONLY'`). El gateway genérico, ya existente, invoca ese método al responder `GET /api/matches/:id`, y antes de la presente corrección podía **devolver por HTTP la vista del laboratorio**. Del mismo modo, `GET /api/matches/:id/events` consultaba los eventos experimentales. La afirmación anterior «no expuesto por HTTP» se interpretaba de forma demasiado estrecha: **no abrir una ruta nueva no bastaba**.

Además había dos carreras entre conexiones SQLite/WAL:

1. La ruta HTTP podía comprobar que una partida aún era ordinaria, pero otro escritor activaba el laboratorio antes de leer los eventos; la comprobación inicial no protegía la lectura posterior.
2. El comando sintético `pass_demo_turn` comprobaba el modo **antes** de `BEGIN IMMEDIATE`. Una activación concurrente del laboratorio podía ocurrir entre ambos instantes, con riesgo de insertar un evento sintético en el diario experimental, dejando el historial inconsistente.

## Controles implementados

- **GET de partida:** si la vista interna tiene `status:'LAB_ONLY'`, responder `409 SECTION_LAB_INTERNAL_ONLY` y **no devolver estado, mano ni mazo**.
- **GET de eventos:** bloquear la vista experimental inicialmente en el gateway y **volver a comprobar su modo dentro de la misma instantánea WAL** que obtiene eventos, mediante `publicEvents(actor,{denyExperimentalLab:true})`. El método interno `publicEvents(actor)` mantiene su contrato anterior para las pruebas autorizadas del laboratorio; no debe invocarse para construir una respuesta HTTP.
- **POST de comandos genéricos:** la ruta rechaza inmediatamente `LAB_ONLY`. Además, el propio comando sintético revalida el modo **dentro de `atomic(BEGIN IMMEDIATE)`**, para descartar una activación intermedia por otro escritor. El rechazo no modifica `matches`, `game_events` ni `game_commands`.
- **GET SSE `updates`:** el gateway rechaza con 409 una suscripción nueva a un laboratorio activo; cada tick de una suscripción anterior verifica el modo y **cierra la conexión** si la partida pasa a laboratorio. SSE ordinario sigue comunicando únicamente revisiones.
- **POST de inicialización de mazo:** conserva `409 SECTION_LAB_MODE_ACTIVE`, sin vista privada. Las rutas nuevas de previsualización siguen **sin exponerse por HTTP**.
- Toda la comprobación es **específica del modo experimental**, sin modificar el esquema SQLite ni las reglas de *Ancients*. El navegador ordinario no está autorizado a consultar este laboratorio.

## Evidencias y pruebas

Se han añadido dos casos de integración en `packages/sqlite-store/ancients-section-history.test.mjs`:

- **Carrera lectura:** la primera vista genérica corresponde al modo ordinario; la segunda conexión activa el laboratorio y registra una carta; la llamada `publicEvents(actor,{denyExperimentalLab:true})` rechaza los eventos dentro de su transacción, aunque `publicEvents(actor)` todavía los permita a los consumidores internos.
- **Carrera escritura:** se inserta determinísticamente la activación del laboratorio por una segunda conexión entre el preflight de un comando demo y su `BEGIN IMMEDIATE`; el comando debe responder 409, sin crear eventos, idempotencia ni incrementos de revisión.

**Ejecución real:** el conjunto de tres suites `staged-movement-preflight.test.mjs`, `sqlite-section-ccwb-bridge.test.mjs`, `ancients-section-history.test.mjs` produjo **54 PASS, 0 FAIL, 0 SKIP**, Node.js 22.16.0 con SQLite/WAL real, sin WSL ni GitHub Actions. El código SQLite y sus tests se ejecutaron con hashes blob Git coincidentes exactamente con los publicados:

- `packages/sqlite-store/sqlite.mjs`: `3b9b23d67f4cec80218ce0e591330848fc126bf7`
- `packages/sqlite-store/ancients-section-history.test.mjs`: `ed68d2c04a67c2d5dd7bfd34255aaf52a114e645`

También se han redactado **siete casos HTTP/SSE** en `packages/local-api/section-history-http-isolation.test.mjs`: lectura normal previa, bloqueo de vista privada para A y B, eventos y comandos sin escrituras, doble inicialización, nueva suscripción SSE rechazada y cierre de SSE preexistente tras activar el laboratorio. **Estos siete casos todavía NO se han ejecutado de extremo a extremo** y deben pasar antes de considerar resuelto el cierre HTTP.

El inventario local pasa de 69 a **70 suites** (el nuevo archivo HTTP es una suite; los dos casos SQLite amplían una existente). Las 70 suites **no han sido ejecutadas** en conjunto.

## Reproducción y criterios de cierre — Windows 11 sin WSL

```powershell
node --test --test-reporter=tap packages/sqlite-store/ancients-section-history.test.mjs packages/local-api/section-history-http-isolation.test.mjs
$LASTEXITCODE
node --test --test-reporter=tap packages/local-api/revision-stream.test.mjs packages/local-api/browser-sqlite-smoke.test.mjs
$LASTEXITCODE
.\scripts\test-local.ps1
$LASTEXITCODE
```

Después comprobar con dos navegadores que una partida ordinaria sigue funcionando y que una partida experimental nunca presenta cartas en la interfaz genérica, eventos ni avisos SSE. Auditar especialmente la frontera en el modo de cookies, el reinicio del servidor y la revocación de la sesión.

**No fusionar esta corrección en `main` ni habilitar el laboratorio en HTTP mientras no se complete esa validación.** Si se permite fusionar la PR en su rama experimental antecesora, mantenerla en borrador dentro de la cadena hasta disponer de la evidencia de regresión.


## Revisión adicional del contrato HTTP (12/11/2026)

Se añadió una **protección de tipo de respuesta**: `GET /events` solo publica un array de eventos (o el array vacío de compatibilidad). Si una implementación de almacenamiento devuelve inesperadamente un objeto de resultado interno —por ejemplo, `{privateJournal: {...}}`—, la puerta HTTP responde `503 SERVICE_UNAVAILABLE` y **nunca serializa** ese objeto. El código `SECTION_LAB_INTERNAL_ONLY` sigue produciendo el `409` anterior, sin introducir un cambio de contrato para partidas ordinarias.

La suite `section-history-http-isolation.test.mjs` dispone ahora de **7 casos**, incluido un test que induce un almacén accidentalmente incorrecto con claves privadas y comprueba que la respuesta HTTP no contiene dichas claves.

Se ejecutaron **seis comprobaciones aisladas** del código exacto de `gateway.mjs`, cargado desde el blob Git `e15befeea957506747e4db9fca6d506629ec94ef`, con un servidor y servicios simulados en el proceso de evaluación JS (no socket TCP ni SQLite). **6/6 comportamiento esperado**: GET laboratorio 409, eventos laboratorio 409, comandos laboratorio 409, resultado de eventos interno inesperado 503 sin campo privado, bloqueo 409 al detectar modalidad de laboratorio en la lectura final y array normal de eventos 200. No se llamó al ejecutor de comandos. También se ejercitó aisladamente el `startRevisionStream` auténtico (blob `bc24e384a2610028d0e0e3d5c5c0ea166b52953a`) con planificador y respuesta falsos: al pasar a `LAB_ONLY`, cierra la conexión y no transmite manos.

Estas comprobaciones son **revisiones funcionales aisladas**, no un resultado del ejecutor Node `node --test` ni prueba de extremo a extremo. La suite HTTP/SSE con Node real y la regresión global de 70 suites **siguen pendientes**.


## Pruebas nativas complementarias de transporte (12/11/2026)

Además de las 54 pruebas SQLite y de las comprobaciones aisladas de V8 ya descritas, se reconstruyeron **tres módulos originales del servidor** directamente a partir de GitHub, cotejando los hashes Git de sus bytes locales:

- `packages/local-api/gateway.mjs`: `e15befeea957506747e4db9fca6d506629ec94ef`.
- `packages/local-api/browser-session.mjs`: `0d23fc813d515bc3a618752426f4f0f0064852b9`.
- `packages/local-api/revision-stream.mjs`: `bc24e384a2610028d0e0e3d5c5c0ea166b52953a`.

**Pruebas HTTP nativas realmente ejecutadas:** `node --test` contra el servidor **HTTP original** escuchando en `127.0.0.1`, con peticiones `fetch` reales, incluyendo cookies y SSE. Se usaron *dobles de identidad y almacenamiento* para no necesitar una base SQLite ni cuentas productivas. Resultado: **10/10 PASS, 0 FAIL, 0 SKIP**, Node.js 22.16.0/Linux nativo. Cobertura: partida ordinaria, vista privada denegada a ambos participantes, eventos y comandos genéricos bloqueados, denegación en una simulación de carrera, rechazo 503 del objeto de eventos privado inesperado, eventos públicos normales, usuario externo, sesión revocada, nueva conexión SSE bloqueada y cierre de una conexión SSE preexistente al activarse el laboratorio. Informe TAP SHA-256: `852c95eacbca120d82d0f2f664355be2e3e418286f45ce969670dd7da89d4ea1`.

**Pruebas nativas directas SSE realmente ejecutadas:** se añadió `packages/local-api/revision-stream-lab-isolation.test.mjs` al repositorio. Usa el módulo SSE original y simula exclusivamente la respuesta y los servicios de identidad, pero **temporizadores y Node.js reales**: **6/6 PASS**, sin errores ni omisiones. Casos: revisión pública, modo laboratorio activo antes de conectar, activación durante la conexión, logout, pérdida de pertenencia y revisión inválida. El test publicado coincide byte a byte con el test ejecutado (blob `648bf92b59c2ef9e5c75946e10cbebbf9f2b4b5d`); informe TAP SHA-256: `572adb7d0e03f40b7dd77d1f9e9d52d84302bc48c7c0d45c615567bb869f113c`.

**Límite importante:** ninguna de estas dos pruebas del transporte incluye el almacenamiento SQLite real del CCWB en el mismo proceso HTTP. La suite `section-history-http-isolation.test.mjs` con **siete pruebas integradas HTTP + SQLite** continúa **sin ejecutar**. Tampoco se ha realizado la regresión total en Windows 11 ni en dos navegadores. El inventario crece a **71 suites**. Mantener esta PR en borrador hasta completar la validación integrada.


**Ejecución conjunta adicional de ambos ensayos nativos del transporte** (servidor HTTP con servicios simulados, más aislamiento directo SSE): **16/16 PASS, 0 FAIL, 0 SKIP**, Node 22.16.0, exit 0. TAP SHA-256 `4f2a5fd7608873158214c4f53cd537f072aeff547391b709772a21c65a6cfd8c`. Esta es una ejecución única de esas 16 pruebas; no incluye los 7 tests integrados HTTP + SQLite todavía pendientes, ni equivale a la regresión completa.


## Ejecutar la validación pendiente en Windows 11 sin afectar a `main`

Se incorpora `scripts/validate-ccwb-http.ps1`, orquestador PowerShell **sin WSL ni GitHub Actions**, que reutiliza `scripts/run-test-suite.mjs`. Solo consume datos sintéticos de pruebas y no inicia un servicio persistente ni despliega nada. Requiere Node.js 22.16.0 o superior.

Para evitar modificar el checkout habitual del usuario, se recomienda probar desde un **worktree independiente** de la rama de esta PR:

```powershell
git fetch origin
git worktree add ..\command-colors-ccwb-91 origin/fix/i4-ccwb-lab-http-read-boundary
Set-Location ..\command-colors-ccwb-91
.\scripts\validate-ccwb-http.ps1
```

El script ejecuta de una vez **cinco suites prioritarias**: la HTTP + SQLite de siete casos, SSE de seis casos, composición real SQLite, puente y prevalidación de movimiento. Consulta el manifiesto existente antes de lanzar cada archivo, conserva el código de salida y crea un informe TAP inmutable en `.local-test-reports/ccwb-http-AAAAmmdd-HHMMSS-fff.tap`. El ejecutor nativo imprime también el **SHA-256** del informe. Si alguna prueba falla, se detiene con código distinto de cero y no continúa silenciosamente.

Para ampliar a **todas las suites inventariadas** solo si las cinco prioritarias pasan:

```powershell
.\scripts\validate-ccwb-http.ps1 -FullRegression
```

Este modo genera dos informes independientes —prioritario y global— y nunca sobrescribe uno anterior; `.local-test-reports/` está excluido de Git. El resultado **solo debe considerarse validado** cuando lo ejecute un entorno real Windows/Node con los módulos descargados y se revisen los códigos de salida. La creación del script no demuestra que hayan pasado estas pruebas en Windows.


## Resultado de validación comunicado desde Windows y corrección de un test obsoleto (12/11/2026)

El usuario ha ejecutado el validador en el *worktree* Windows `T:\\Github\\command-colors-ccwb-91`, creado desde la rama `origin/fix/i4-ccwb-lab-http-read-boundary` de esta PR. **Resultado comunicado**: las pruebas prioritarias finalizaron con **67 tests correctos**. En la regresión global, el único fallo comunicado fue el **subtest 819**, `diagnóstico es de solo lectura, no crea base ni directorios` de `scripts/check-browser-lab.test.mjs`: `71 !== 43`. No se detectó una regresión de cartas, SQLite o HTTP en ese mensaje.

**Causa comprobada en GitHub:** el diagnóstico `checkLocalLab` devuelve correctamente `LOCAL_TEST_FILES.length` (71 en esta rama), pero la prueba de diagnóstico contenía todavía `assert.equal(result.tests,43)`, valor fijo de un inventario anterior.

**Corrección incorporada:** importar `LOCAL_TEST_FILES` en `check-browser-lab.test.mjs` y sustituir la expectativa obsoleta por `assert.equal(result.tests,LOCAL_TEST_FILES.length)`; se mantiene la comprobación de que la lista no está vacía. Los tests no se omiten ni se reduce su número. La solución es válida para futuras ampliaciones del inventario.

**Verificación estática tras el commit:** la versión remota deja de incluir la comparación con 43 y usa el manifiesto actualizado; el archivo del test tiene blob Git `31a0f80504c89cdaaaff6b4c5994348decdcd80a`. Se revisaron las suites de scripts para detectar otras comparaciones de `result.tests` con recuentos fijos y no se encontraron otras. Esta corrección **todavía debe ejecutarse con Node en el worktree Windows** antes de afirmar que la regresión total pasa.

En ese worktree, cuya referencia original puede estar en *HEAD desacoplado* porque se creó desde una referencia remota:

```powershell
Set-Location 'T:\Github\command-colors-ccwb-91'
git fetch origin
git switch --detach origin/fix/i4-ccwb-lab-http-read-boundary
node --test --test-reporter=tap scripts/check-browser-lab.test.mjs
```

Si la suite corregida pasa, la repetición de regresión global puede ejecutarse con `.\scripts\validate-ccwb-http.ps1 -FullRegression` o con el ejecutor `node scripts/run-test-suite.mjs --log=.local-test-reports/ccwb-global-tras-fix.tap` (usar un nombre de informe nuevo). **No se solicita iniciar el servidor manualmente, probar navegadores ni usar WSL** para validar este cambio de aserción.


## Validación en Windows 11 confirmada por el usuario (12/11/2026)

El usuario ha repetido las pruebas en el *worktree* aislado de la PR #91 tras actualizar el cambio que sustituye el recuento fijo `43` por `LOCAL_TEST_FILES.length`. **Resultado comunicado: la prueba `scripts/check-browser-lab.test.mjs` ha pasado y la regresión completa ha pasado.** Anteriormente ya había comunicado 67 pruebas correctas en el bloque prioritario HTTP/SQLite.

Con ello, **las dos condiciones locales pendientes para integrar esta corrección en su rama base experimental se consideran satisfechas**, basándonos en la ejecución y los resultados aportados por el usuario en Windows 11, sin WSL. No se ha recibido el archivo TAP ni su SHA-256 en esta conversación: no se inventan porcentajes, duración ni contadores de pruebas individuales de la regresión global. El manifiesto de la rama de PR #91 contiene **71 suites declaradas**, lo cual no equivale a «71 casos»; cada suite puede contener varios subtests.

**Decisión de integración:** puede fusionarse la PR #91 sobre su rama base `feat/i4-ancients-section-idempotency-journal-binding` (PR #87). Esta decisión no autoriza una fusión del conjunto experimental con `main`, ni su publicación por HTTP/Internet, ni declara completas las reglas oficiales de movimiento o combate. Las pruebas de dos navegadores reales y el examen de seguridad para producción siguen pendientes. El laboratorio permanece exclusivamente interno.


> **Clasificación de seguimiento (12/11/2026):** se corrige el identificador inicial de esta documentación, que vinculaba incorrectamente esta fase a `CCW-015` (reservado para dados digitales). El trabajo histórico y sus PR conservan sus números originales; este documento se clasifica ahora como `SEC-001` (issue #94, frontera de seguridad y aislamiento).
