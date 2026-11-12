# CCW-015 — Aislamiento del laboratorio privado frente a HTTP y SSE existentes

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

También se han redactado **seis casos HTTP/SSE** en `packages/local-api/section-history-http-isolation.test.mjs`: lectura normal previa, bloqueo de vista privada para A y B, eventos y comandos sin escrituras, doble inicialización, nueva suscripción SSE rechazada y cierre de SSE preexistente tras activar el laboratorio. **Estos seis casos todavía NO se han ejecutado de extremo a extremo** y deben pasar antes de considerar resuelto el cierre HTTP.

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
