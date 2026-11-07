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
