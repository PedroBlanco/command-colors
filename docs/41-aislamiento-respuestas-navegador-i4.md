# CCW-014 — Aislamiento de respuestas asíncronas por sesión y partida

**Fecha:** 9 de noviembre de 2026. **PR propuesta:** #51; rama `feat/i4-private-async-response-guard` sobre `feat/i4-authenticated-svg-board` (PR #50).

## Problema detectado

El navegador puede cambiar de cuenta o de partida mientras un comando, una invitación o una consulta HTTP permanece pendiente. Antes de este cambio, una respuesta tardía podía ejecutar `inspect()`, escribir el token de invitación de la partida anterior o mostrar un mensaje de éxito/error fuera de contexto. La autorización del **servidor** sigue siendo independiente, pero el navegador también debe impedir filtraciones y actualizaciones visuales obsoletas.

## Implementación

`packages/local-api/private-view-scope.mjs` incorpora un contexto **solo para el cliente**, con número de generación y partida activa:

- `reset()` invalida las operaciones anteriores ante login, logout o edición del identificador de partida.
- `selectMatch(matchId)` cambia de ámbito únicamente si cambia de partida; inspeccionar de nuevo la misma partida no cancela operaciones válidas.
- `capture()` obtiene una instantánea inmutable y `isCurrent(ticket,matchId)` comprueba que aún pertenece al mismo ámbito, evitando incluso el caso A→B→A.
- No contiene credenciales ni concede acceso: la **API sigue derivando la identidad de la cookie** y comprobando permisos para cada petición.

`browser-ui.mjs` usa estas comprobaciones antes de aplicar respuestas de partidas, movimientos, inicialización, invitaciones, eventos y sesión. También verifica la identidad al volver a una pestaña visible, elimina la vista privada si hay una revocación HTTP 401/403/404 o si la cookie corresponde a otra cuenta y descarta errores tardíos de ámbitos ya abandonados. El indicador de éxito/error no se sobrescribe por acciones de un ámbito anterior. Un POST de movimiento que llega tras cambiar de cuenta o partida no recarga una vista privada incorrecta.

Tanto al editar el identificador como al crear una nueva partida o aceptar una invitación mediante botones se borran **los tokens de invitación emitidos o recibidos, el lobby anterior, los datos del jugador y los controles de cartas**. Una respuesta de invitación tardía no vuelve a mostrarse.

La pasarela `gateway.mjs` solo sirve el nuevo módulo a través de la lista fija de rutas HTTP del laboratorio; se añade la comprobación correspondiente a `browser-gateway.test.mjs`.

## Verificación disponible sin intervención del usuario

**Prueba real de Node.js 22.16.0** en un directorio aislado del entorno de trabajo, sin WSL ni GitHub Actions:

```powershell
node --check packages/local-api/private-view-scope.mjs
node --test packages/local-api/private-view-scope.test.mjs
```

**10/10 casos correctos; 0 fallos y 0 omitidos.** Los dos archivos subidos a GitHub coinciden exactamente por hash de objeto Git con los ejecutados:

- `private-view-scope.mjs` → `100f44e73bfc2ef0352527ea457beac5e8601dd6`
- `private-view-scope.test.mjs` → `731a63d8fad2ee7e378bdf4c335237e95d2c007c`

Se ejecutaron también **los quince callbacks** de `browser-deck-ui.test.mjs` sobre los módulos publicados, con un intérprete V8 aislado y dobles de DOM/fetch. **15/15 correctos**, incluidos movimientos tardíos tras cambiar de partida o cerrar sesión, invitaciones tardías, borrado de tokens al cambiar de partida, revocación de sesión, cambio de usuario en otra pestaña, pérdida de acceso a una partida y navegación programática por creación o aceptación de invitaciones. Este segundo resultado **no es una ejecución nativa de Node.js ni una prueba de navegador**, por lo que no acredita todavía la integración HTTP.

## Regresión y bloqueos

El manifiesto local pasa de **35 a 36 suites**. Siguen pendientes la ejecución integral con Node.js/PowerShell, las siete suites históricas sin evidencia, el nuevo test HTTP de rutas, las dos sesiones simultáneas y la aceptación visual/táctil. No fusionar ni desplegar basándose solamente en las pruebas del módulo puro.

```powershell
node --test packages/local-api/private-view-scope.test.mjs
node --test packages/local-api/browser-deck-ui.test.mjs
.\scripts\test-local.ps1 -Log '.local-data\regression\completa-20261109.tap'
```

El servidor continúa siendo **solo local** y usando cartas y reglas sintéticas. Este ajuste no modifica el reglamento, escenarios, datos oficiales ni la seguridad de un eventual despliegue por Internet.
