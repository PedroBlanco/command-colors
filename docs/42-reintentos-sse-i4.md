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

## Revalidación de acciones del laboratorio heredadas (9/11/2026)

El control de identidad que ya protegía `sendDeck()` y la inspección SSE no se aplicaba a todas las acciones antiguas de la interfaz. Si otra pestaña cambiaba la cookie sin disparar un evento de visibilidad, los botones de **crear partida, invitar, aceptar/rechazar invitaciones, consultar eventos, pasar turno sintético e inicializar mazo** podían enviar una petición con una proyección local asociada a la cuenta anterior. El **servidor sigue siendo la autoridad**, pero la interfaz no debe iniciar operaciones desde un contexto privado obsoleto.

- Nuevo `confirmCurrentSession(ticket,matchId)` en `browser-ui.mjs`: valida la generación local de sesión/partida, consulta `GET /api/session` y, después de la respuesta, vuelve a comprobar generación e identificador antes de enviar la operación. El salto a otro usuario borra la mano, el tablero, los tokens de invitación y la partida antigua.
- Las siete rutas de interfaz citadas comparten esta verificación; el flujo del mazo ya protegido mediante `sendDeck()` no se modifica. La orden antigua `pass_demo_turn` captura la revisión **antes** de la espera HTTP para no modificar el significado del clic por un refresco SSE concurrente.
- Se han añadido tres tests a `browser-deck-ui.test.mjs`: cookie cambiada antes de inicializar el mazo, antes de invitar/pasar turno y antes de consultar eventos/crear otra partida. Cuando se detecta el cambio de identidad, la reentrada exige **nuevo inicio de sesión explícito**, tal como ya hace la interfaz.
- **Ejecución simulada:** 26/26 casos superados en V8 aislado, usando el código publicado de los módulos, con adaptadores de imports y DOM/fetch falsos (`browser-deck-ui.test.mjs` 21 casos y `browser-ui.test.mjs` 5). SHA Git: módulo `fb52922800dca2bf44282eb8a162133f8473a51b`, pruebas de mazo/interfaz `a14860467269135b2eb31cdecfa9a58647a3cbff`, pruebas de interfaz básica `c2875abbb5d024faf2aa7b4ac766663a7faa42ab`. **No es Node.js nativo ni HTTP/SSE real**.
- Límites: hay una ventana inevitable entre comprobar la cookie y enviar la petición, por lo que **no debe eliminarse la autorización del lado del servidor**. Las 38 suites y las pruebas de dos sesiones reales continúan pendientes, igual que la aceptación visual en PC/móvil. Ninguna regla oficial de *Ancients* ha sido añadida.

## Corrección: respuestas tardías de invitaciones y eventos (9/11/2026)

Se reprodujo una carrera adicional que afectaba a respuestas ya iniciadas cuando **otra pestaña cambia la cookie**. Antes del ajuste, si la sesión era válida al empezar una petición, el cliente podía mostrar después el token de invitación o la lista de eventos, aunque el usuario actual ya fuese otro; el cambio de ámbito local no había ocurrido porque no se había disparado una inspección/visibilidad.

- `browser-ui.mjs` comprueba de nuevo `GET /api/session` **después** del POST que crea una invitación o del GET de eventos y **antes** de mostrar su contenido. Si la cuenta cambió, se cierra SSE y se borra el contexto privado, sin revelar respuestas tardías.
- En `browser-deck-ui.test.mjs`, dos pruebas retienen respuestas HTTP simuladas y cambian la cuenta mientras siguen pendientes. **Antes** de corregir: fallaban ambas, mostrando `test-secret-invitation` o `SYNTHETIC_PRIVATE_TEST_DATA`. **Después**: no se muestra ningún dato tardío.
- Regresión conjunta simulada: **28/28 callbacks de pruebas correctos** (23 de `browser-deck-ui.test.mjs`, 5 de `browser-ui.test.mjs`). Ejecutada en V8 aislado con módulos exactos del repositorio, adaptadores de imports y dobles de DOM/fetch; **no es ejecución nativa de `node --test`, HTTP/SSE real ni navegador físico**.
- SHA Git contrastados: `browser-ui.mjs` `8ee281e9e5aabea974389f613969b38c87374366`, `browser-deck-ui.test.mjs` `54581dd47d9e217181759b8bc132a1cbad2f49d8`, `browser-ui.test.mjs` `c2875abbb5d024faf2aa7b4ac766663a7faa42ab`.
- La autorización e identidad de jugador en cada ruta siguen controladas por el servidor; esta validación del cliente no puede garantizar que la cookie no cambie **de nuevo** después del segundo GET.

## Auditoría estática del manifiesto de pruebas

Se cotejó el árbol completo de GitHub de la rama con la lista fija `LOCAL_TEST_FILES` de `scripts/check-browser-lab.mjs`: **38 archivos `*.test.mjs` presentes, 38 registrados, cero ausentes, cero duplicados y cero sin registrar**. También se comprobó en `gateway.mjs` que los módulos del tablero y control de identidad/revisiones continúan dentro de la lista cerrada de rutas públicas del laboratorio. Estas comprobaciones son **estáticas** y no sustituyen ni la ejecución de la batería integral ni pruebas HTTP reales.

La PR #52 permanece en borrador; no fusionar la cadena #45–#52 ni exponer el laboratorio en Internet antes de completar regresión integral y validación de permisos.
