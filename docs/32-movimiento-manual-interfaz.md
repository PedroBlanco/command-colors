# CCW-014 — Control manual de movimiento por navegador

**Fecha:** 7 de noviembre de 2026. **Ámbito:** interfaz de laboratorio, tablero de datos sintéticos. No hay reglas oficiales de *Ancients* ni integración con tablero SVG de PR #27.

## Interfaz

La sección de mazo sintético incluye un formulario de movimiento que solo se habilita para el jugador activo en fase `MOVEMENT`. Se introduce una unidad propia, como `synthetic-a`, y una ruta de hexágonos, por ejemplo:

```text
Unidad: synthetic-a
Ruta:   4,4; 4,5
```

Cada pareja es una coordenada `columna,fila` del tablero *odd-q*, con columnas 0–12 y filas 0–8; los pasos se separan con punto y coma y **no incluyen el origen**. Se admiten entre 1 y 32 posiciones. El cliente verifica estructura, límites del tablero, pertenencia pública del identificador al bando propio, fase y revisión. No comprueba si la ruta es realmente adyacente, ni si tiene obstáculos, si la unidad recibió órdenes, si se movió antes o si dispone de puntos suficientes: **esas restricciones se comprueban exclusivamente en el servidor SQLite**.

`deckCommand()` genera únicamente `type`, `expectedRevision`, `idempotencyKey`, `unitId` y una copia saneada de `path`. No incluye `actor`, política de movimiento, tablero ni cartas de otros jugadores. El servidor obtiene el actor de la sesión autenticada. El cliente puede repetir el movimiento de la misma unidad en la interfaz, pero el servidor debe rechazarlo una vez consumida su opción.

## Pruebas

```powershell
node --test packages/local-api/deck-controls.test.mjs packages/local-api/movement-controls.test.mjs
.\scripts\test-local.ps1
```

- **5/5 nuevas pruebas de controlador** superadas en Node.js 22.16.0: análisis de rutas, rechazo de formato, turno/actor, payload saneado y rechazo de unidad enemiga o inexistente.
- **12/12 pruebas de controladores** (siete anteriores más cinco nuevas) superadas juntas.
- **64/64 pruebas de órdenes, movimiento, SQLite, SSE simulado y controles** superadas en el entorno local de este incremento.
- Los módulos publicados coinciden por SHA Git con el código y pruebas ejecutados: controlador `56411136ade26b347f0804adc498a7a9ff0afc85`, nueva suite `9f480696c521cd692d9652f5ce4948b8d02c773f` y suite anterior adaptada `b2d4d7b5fbbd3d2b4ca08b1c3ccf3ee053f38bcc`.
- El test `browser-deck-ui.test.mjs` se ha actualizado para simular pulsaciones y envío HTTP, pero **todavía no está ejecutado** contra la rama completa; tampoco se ha validado la interfaz en navegador ni en móvil.
- La batería local enumera **33 suites**; pendiente de ejecución conjunta en Windows 11. Sin WSL, VPS, Docker ni GitHub Actions.

## Criterios pendientes

1. Ejecutar la suite DOM, HTTP/cookies y las 33 suites completas en Windows; corregir incompatibilidades.
2. Probar la interfaz en dos perfiles de navegador, incluyendo SSE, restricciones de turno, errores de ruta y reintentos.
3. Integrar el tablero SVG solo cuando se valide PR #27; entonces sustituir la entrada manual por selección/clic accesible sin alterar el contrato de dominio.
4. Fijar y probar la edición física y las reglas oficiales de movimiento por unidad, terreno y excepciones antes de declarar R-05 terminado.
5. Fusionar en orden PR #45, #46, #47 y esta PR cuando sus respectivas pruebas de aceptación sean suficientes. No exponer el laboratorio a Internet.

**La implementación de esta PR es un mecanismo de comprobación del protocolo, no un juego terminado.**

## Verificación integrada HTTP/cookies y SSE (7 de noviembre de 2026)

Después de la publicación inicial se han ejecutado las suites **originales del repositorio** `command-deck-cookie.test.mjs` (4/4), `command-deck-sse.test.mjs` (ahora 3/3) y `browser-deck-ui.test.mjs` (7/7), con los módulos de pasarela HTTP, sesiones y SQLite publicados y cotejados por sus hashes Git. La tercera prueba SSE, incorporada a esta rama, realiza **un movimiento real por HTTP con dos conexiones SSE autenticadas**: ambas reciben la revisión 3, un comando rechazado no produce aviso, la reconexión parte de la revisión vigente y el cierre de sesión revoca el flujo. Los mensajes SSE solo contienen `lobbyRevision` y `gameRevision`, sin cartas o rutas.

**Evidencia ejecutada:** `node --test` sobre nueve suites de órdenes, movimiento, SQLite, interfaz simulada, cookies y SSE: **78/78 correctas, 0 fallos**, Node.js 22.16.0. Test SSE publicado con SHA `bd1cc3298329ba926e014ad26b77a5560a523239` idéntico al ejecutado. Queda pendiente la batería completa de **33 suites**, con pruebas de otras áreas del proyecto, y la validación visual real en Windows PC/móvil. No se emplearon WSL, VPS ni GitHub Actions. El laboratorio no debe publicarse en Internet.

## Ajuste de controles tras movimiento — 151 pruebas (7/11/2026)

La vista autorizada de una partida sintética comunica ahora la lista pública de identificadores `movedUnitIds` derivada **solo** de `matches.private_state`, sin revelar manos o mazo. Cuando ya se ha movido una unidad, la interfaz deja de ofrecer «Deshacer órdenes» y rechaza localmente el intento de mover esa misma unidad por segunda vez (`UNIDAD_YA_MOVIDA`). El servidor SQLite conserva de forma independiente la comprobación decisiva. La nueva prueba de controlador, las pruebas de botón en navegador simulado y las pruebas reales HTTP/cookies verifican el comportamiento, incluida la proyección del estado a ambos jugadores.

Regresión conjunta sobre **16 suites** (geometría, fases, mazo, dados, órdenes, movimiento, SQLite, DOM simulado, HTTP/cookies y SSE): **151 pruebas ejecutadas, 151 PASS, 0 FAIL**, Node.js v22.16.0 en entorno aislado linux/x64, sin WSL ni GitHub Actions. Los cinco archivos modificados se contrastaron con los SHAs de los mismos archivos probados. Siguen pendientes **17 suites de las 33 generales** y la validación visual PC/móvil; todavía no procede fusionar las PR apiladas.
