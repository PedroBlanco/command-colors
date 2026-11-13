# Validación manual del laboratorio y revisión de la interfaz

**Fecha:** 13/11/2026  
**Rama base:** `feat/lab-anc-movement-candidate-audit-trail`, commit exacto `4189944bee46354c0db5bef5effcf2d03b558aa8` (PR #96).  
**Rama de revisión UI:** `feat/ui-lab-collapsible-player-facing-board` (apilada sobre PR #96, sin modificar `main`).

## Validación de referencia comunicada por el usuario

En Windows 11, con PowerShell y Node.js nativo, se ejecutó `scripts/validate-ccwb-http.ps1 -FullRegression` sobre el **SHA exacto** anterior:

```text
1..985
# tests 985
# suites 0
# pass 985
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 39402.855
CCW: 80 suites; salida=0
CCWB: validación local correcta.
```

El usuario confirmó además **los seis pasos manuales correctos**: dos cuentas en perfiles distintos, invitación y aceptación, privacidad de manos y conteos, tablero/turnos, persistencia tras reinicio y denegación tras cerrar sesión. La ejecución manual y el SHA quedaron comunicados explícitamente; no se ha aportado el archivo TAP ni su SHA-256, que no deben inventarse.

## Observaciones del usuario y solución experimental

| Observación | Intervención |
|---|---|
| Partes de la interfaz fuera de fase permanecen visibles | Paneles nativos `<details>` para acceso, sala, invitaciones, estado, mazo y tablero. Se abren y pliegan por etapa de sesión/partida sin forzar la expansión tras cada SSE. La sesión vigente y cerrar sesión se mantienen visibles. |
| Oponentes a izquierda y derecha en vez de arriba y abajo | Proyección visual del tablero `430 × 510`, con el **bando propio abajo y el adversario arriba** para cualquiera de los dos jugadores. Los datos `col,row`, órdenes, selección de hexágonos y persistencia del servidor no se transforman. Los cursores siguen los ejes visuales rotados. |
| Selección de unidades mediante texto libre | Selector desplegable para órdenes con botones **Añadir unidad** y **Vaciar selección**, que acumulan varias unidades propias; desplegable de unidad a mover (propias) y de objetivo (rivales). Opciones tomadas exclusivamente de `view.board` autenticada; se invalidan al cambiar de revisión, partida, sesión o fase. Ninguna decisión cliente autoriza un movimiento en servidor. |
| Acciones ilegales sin mensaje próximo al control | **Pospuesto** con autorización del usuario. Registrado en [issue #100](https://github.com/PedroBlanco/command-colors/issues/100), sin bloquear esta rama. |

La interfaz continua utilizando solamente identificadores sintéticos y no incluye reglas, cartas o escenarios oficiales de *Ancients*. La orientación visual es deliberadamente independiente de la geometría odd-q del motor.

## Casos de regresión añadidos

En suites existentes del manifiesto canónico, **sin añadir archivos de suite**:

- `packages/local-api/movement-board-ui.test.mjs`: dos casos nuevos. Orientación A/B en vertical con coordenadas no modificadas; navegación con flechas para el jugador B. Se actualiza la prueba de navegación de A según la transformación visual.
- `packages/local-api/browser-ui.test.mjs`: tres casos nuevos. Plegado por fase y preservación del pliegue elegido manualmente; órdenes a múltiples unidades mediante el selector; y comprobación del HTML real para seis elementos `details` y tres `select`.

**80 suites en el manifiesto**. El total esperado asciende de 985 a 990 casos si todas las pruebas anteriores siguen presentes; este número es **previsión**, no resultado observado.

## Comprobaciones efectuadas antes de solicitar pruebas en Windows

- Se verificó la sintaxis de los cuatro JavaScript modificados; las etiquetas HTML de `details` se encuentran equilibradas.
- Renderizador real junto con los módulos reales de geometría y selección: **13/13 casos** de `movement-board-ui.test.mjs` comprobados en V8 con un ejecutor de pruebas aislado (no es el runner nativo `node:test`).
- Código real de `browser-ui.mjs` y `deck-controls.mjs`: **7/7 verificaciones aisladas V8** con DOM y red simulados para login, salas, plegado, listas propias/enemigas, dos órdenes y logout.
- Se han comprobado los SHA Git de las fuentes recuperadas antes de las comprobaciones, pero **no se ha ejecutado la regresión nativa de esta nueva rama**, ni una sesión visual con navegador real de esta revisión.

## Plan de aceptación en Windows 11

Desde PowerShell, crear un worktree nuevo basado en la rama de UI, separado del previamente validado:

```powershell
git fetch origin
git worktree add --detach ..\command-colors-ui origin/feat/ui-lab-collapsible-player-facing-board
cd ..\command-colors-ui
git rev-parse HEAD
.\scripts\test-local.ps1 -Only "packages/local-api/browser-ui.test.mjs,packages/local-api/movement-board-ui.test.mjs"
.\scripts\validate-ccwb-http.ps1 -FullRegression
```

Si todo pasa, iniciar `node scripts/browser-lab.mjs` y abrir dos perfiles diferentes en `http://127.0.0.1:8788/`; comprobar que se pliega el acceso tras iniciar sesión; que se pliegan sala/invitaciones cuando comienza la partida; que ambos bandos ven sus propias unidades abajo; que los desplegables y la lista acumulada muestran las unidades correspondientes; y que reinicios, SSE, privacidad y comandos conservan el resultado de la validación previa. `Ctrl+C` cierra el servidor. No introducir credenciales reales ni exponer la dirección a la red.

**Criterio de aceptación:** pruebas nativas del SHA exacto, sin fallos, aceptación visual A/B y sin regresión en privacidad de manos y estado. La PR permanece en borrador hasta tener esta evidencia; no se fusiona en `main` ni se declara el motor oficial disponible.
