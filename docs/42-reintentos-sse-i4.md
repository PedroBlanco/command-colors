# CCW-014 — Recuperación fiable de avisos SSE en el laboratorio privado

**Fecha:** 9 de noviembre de 2026. **Rama:** `feat/i4-resilient-sse-revision-refresh`, apilada sobre PR #51 (dependiente de #45–#50). **Estado:** borrador, no fusionar sin regresión integral.

## Incidencia

La interfaz marcaba un par de revisiones `lobbyRevision:gameRevision` como visto **antes** de que concluyese el `GET` de la partida. Ante un fallo temporal de red o una respuesta HTTP descartada por concurrencia, un segundo aviso con los mismos contadores se ignoraba; el tablero podía permanecer obsoleto hasta que se produjese otro movimiento.

La corrección **no modifica el servidor ni los datos privados**: los avisos SSE siguen transportando exclusivamente contadores. El estado real continúa obteniéndose mediante `GET /api/matches/:id` con cookie autenticada, controles de pertenencia y proyección privada por bando.

## Nuevo coordinador `revision-refresh.mjs`

- Guarda la última revisión pendiente, pero solo la **reconoce** al terminar correctamente una inspección; `false` o una excepción conservan la revisión para reintento.
- Descarta avisos duplicados, malformados o más antiguos. Utiliza orden `lobbyRevision`, `gameRevision` con `null` para partida aún no iniciada.
- Serializa las consultas derivadas de SSE y agrupa las revisiones que llegan durante una solicitud HTTP en curso. Si aparece una nueva, programa otra inspección para garantizar que se alcance el estado más reciente.
- Reintenta fallos transitorios con espera exponencial: 3, 6, 12, 24 y **48 segundos como máximo**. Una revisión más nueva evita esperar por el reintento anterior.
- Mientras la pestaña está oculta, difiere las inspecciones y conserva únicamente el último aviso; al volver, la interfaz **revalida la cookie antes de reanudar**.
- `reset()` cancela el temporizador y descarta las peticiones de una sesión o partida anterior. Los callbacks tardíos de un `EventSource` cerrado no pueden actualizar la nueva partida, incluso si el ID vuelve a ser el mismo.
- El estado es exclusivamente del navegador; no contiene ni transmite cartas, manos, actores ni identificadores de sesión.

La nueva ruta `/revision-refresh.mjs` se añade a la lista cerrada de módulos públicos de `gateway.mjs`, únicamente para el servidor local de laboratorio. `browser-gateway.test.mjs` comprueba su presencia. `browser-ui.test.mjs` añade cobertura de fuente SSE ya cerrada y varios avisos acumulados durante la ocultación.

## Verificación real reproducible

Ejecutada con **Node.js v22.16.0**, en entorno Linux aislado **sin WSL ni GitHub Actions**:

```text
node --test --test-reporter=tap packages/local-api/revision-refresh.test.mjs
tests 12 | pass 12 | fail 0 | skipped 0
```

Los archivos ejecutados en Node coinciden con los objetos Git recuperados de la rama:

| Archivo | SHA de objeto Git |
| --- | --- |
| `packages/local-api/revision-refresh.mjs` | `ce6083adc64696052a4634be216ccce2db3adb71` |
| `packages/local-api/revision-refresh.test.mjs` | `36486ce9984829e8019af88e8a286eeee671cc7d` |

El registro TAP de la ejecución está conservado como archivo de la conversación `ccw-revision-refresh-node22-20261109.tap`, **no se ha incorporado al repositorio**. SHA-256 del registro real: `304ed36060ad71898606e03409bd9eedb6dade5449e12af1c9a8015090829ecd`.

Se ejecutaron además **22/22 callbacks de las pruebas de interfaz** (`browser-deck-ui.test.mjs` y `browser-ui.test.mjs`) sobre los archivos originales de la rama en un V8 aislado con dobles DOM/fetch y temporizadores simulados. Ese resultado **no es una ejecución nativa de Node ni una prueba HTTP real**, y se declara por separado.

## Pendientes de integración

1. Ejecutar la **batería completa de 38 suites** de esta rama en Node.js, con registro TAP. Las siete suites sin evidencia anterior continúan pendientes.
2. Verificar los módulos HTTP permitidos y las conexiones SSE reales con dos sesiones independientes; simular red intermitente y cierre de sesión mientras una actualización está pendiente.
3. Validar más adelante PC/móvil y accesibilidad sin requerirlo ahora al usuario.
4. Mantener PR #27 y PR #45–#52 separadas y en sus estados actuales hasta disponer de evidencias integradas; no desplegar en Internet.
5. Mantener las reglas oficiales *Ancients* (incluido R-05) fuera de las afirmaciones de completitud: sigue siendo un **laboratorio sintético**.

Comando reproducible en Windows PowerShell, cuando se disponga de entorno de pruebas:

```powershell
node --test packages/local-api/revision-refresh.test.mjs
.\scripts\test-local.ps1 -Log '.local-data\regression\completa-38-suites.tap'
```

## Corrección adicional: pestaña ocultada durante la revalidación (9/11/2026)

Había una carrera de `visibilitychange`: un primer evento de **mostrar** comenzaba `GET /api/session`; si otro evento **ocultaba** la pestaña antes de resolverse ese GET, el primer callback reanudaba el coordinador SSE aunque `document.hidden` ya fuese `true`. Esto podía activar inspecciones privadas con la pestaña oculta.

- `browser-ui.mjs` vuelve a comprobar `document.hidden` **después** de `await session()` y **antes** de llamar a `revisionRefresh.setPaused(false)`.
- `browser-ui.test.mjs` añade una regresión con la respuesta de sesión deliberadamente retenida: el aviso queda pendiente durante la ocultación, no se inicia ningún GET privado y se recupera **una sola vez** tras una nueva comprobación con la pestaña visible.
- Se reprodujo el fallo con el handler original ejecutado directamente en V8: `observedPaused=false` pese a `document.hidden=true`. El handler corregido mantuvo `paused=true` y retomó normalmente al mostrarse.
- Se ejecutaron los **cinco casos** de `browser-ui.test.mjs` (incluido el nuevo) sobre los módulos publicados de esta rama, con adaptador de imports y DOM/fetch simulados en V8: **5/5 correctos**. **No es `node --test`, una prueba HTTP real ni una prueba de navegador**.
- La batería sigue incluyendo **38 suites**; el nuevo caso amplía una suite ya existente, no constituye una suite adicional. La fusión continúa bloqueada por las comprobaciones pendientes.

## Corrección adicional: fallo en vuelo al ocultar la pestaña (9/11/2026)

Se reprodujo otra carrera con el módulo publicado `revision-refresh.mjs`: después de iniciar una inspección, el navegador podía pasar a segundo plano y la petición terminar con `false` o excepción. Antes de la corrección, `retry()` **programaba un temporizador mientras la cola estaba pausada**; al volver a mostrar la pestaña, `setPaused(false)` no relanzaba inmediatamente la inspección porque ese temporizador permanecía activo.

La corrección conserva la revisión pendiente y el contador de fallos, pero **no arma un temporizador mientras `paused` sea verdadero**. Tras confirmar sesión y reanudar, `pump()` vuelve a inspeccionar inmediatamente. No se ha modificado el servidor, la autorización ni los mensajes SSE.

- Incidencia original reproducida sobre el objeto Git previo `ce6083adc64696052a4634be216ccce2db3adb71`: había **1 temporizador activo** pese a estar oculta la pestaña y **no** se producía un reintento inmediato al reanudar.
- Añadidas dos regresiones a `revision-refresh.test.mjs`: inspección en vuelo que devuelve `false`, e inspección en vuelo rechazada con error HTTP.
- **14/14 casos del módulo (12 anteriores + 2 nuevos)** ejecutados correctamente en V8 aislado sobre el código corregido y la fuente de pruebas; **no equivalen a la ejecución nativa de `node --test` ni a HTTP/SSE real**.
- Continúan **38 suites** en el manifiesto; las dos pruebas nuevas se añaden a una suite existente. No se acredita regresión integral, revisión visual ni seguridad de producción.

## Ejecución nativa posterior, con los archivos publicados (9/11/2026)

Se ha ejecutado la versión corregida de la suite de reintentos de manera **nativa con Node.js v22.16.0**, en entorno Linux aislado, sin WSL ni GitHub Actions. Se recuperaron los dos archivos de la rama de GitHub y se comprobó su identidad byte a byte calculando su SHA de objeto Git con `git hash-object` antes de ejecutar las pruebas.

| Archivo | SHA Git publicado = SHA ejecutado |
| --- | --- |
| `packages/local-api/revision-refresh.mjs` | `0f4648b85e24dad891c253194e187ea79a4010fc` |
| `packages/local-api/revision-refresh.test.mjs` | `542289f61cbce8656a4b8ae06a76d8058ae80b34` |

Comando en la carpeta que contiene ambos archivos:

```sh
node --test --test-reporter=tap revision-refresh.test.mjs
```

**Resultado real:** 14 pruebas, **14 PASS**, 0 FAIL, 0 SKIP, código de salida 0. Registro TAP sin cabeceras añadidas, SHA-256 `cf7f01db6621736113d8321ba33b2bae5e9a64b2005f4e4c9dce7d5b055c13b3` (generado en esta conversación y entregable como archivo, no almacenado en GitHub). Esta evidencia **reemplaza** la limitación V8 indicada en la sección precedente para estos 14 casos concretos.

No implica haber ejecutado las **38 suites** de la batería, ni haber verificado sesiones HTTP/SSE de extremo a extremo, ni haber probado Chrome/Firefox/móvil; todos estos bloqueos de integración continúan vigentes.
