# Laboratorio de navegador: recuperación de sala, paneles compactos y tablero apaisado

**Fecha:** 13/11/2026  
**Base comprobada por usuario:** PR #101, `9eae2899861db1eef5824a4e675671d915f27238`. El usuario confirmó **pruebas locales y regresión correctas** y realizó comprobación manual; no facilitó esta vez un número de casos ni archivos TAP.  
**Rama correctiva:** `fix/ui-landscape-lobby-refresh-layout`, apilada sobre la PR #101. La rama anterior queda intacta.

## Incidencias de aceptación

1. **Actualización ocasional de la sala de `bob` al invitar a `alice`.** El anfitrión puede quedarse mostrando el estado anterior mientras el invitado acepta; «Consultar partida» fuerza una lectura actualizada. El SSE sigue siendo la vía primaria, pero no debe ser la **única** garantía de recuperación en una sala pendiente. El fallo es intermitente: **no se ha aislado una causa raíz concluyente del transporte SSE**, y la mejora es una recuperación preventiva, no una afirmación de que todos los mensajes llegan.
2. **Paneles plegados dentro de un grid.** La altura común de una fila del grid deja espacio en blanco bajo las tarjetas plegadas si una tarjeta vecina continúa abierta.
3. **Tablero girado verticalmente.** La primera solución de PR #101 rotó el tablero a `430 × 510` para que ambos bandos apareciesen arriba/abajo, pero los ejércitos permanecieron desplegados originalmente en columnas opuestas del estado inicial y el tablero quedó en vertical. El usuario exige tablero **horizontal** y despliegue en sus lados **largos** (norte/sur).

## Corrección

**Sala pendiente:** se incorpora una comprobación autorizada cada 2500 ms **solo** mientras la partida seleccionada está en estado `INVITING`. Cada comprobación usa el flujo `inspect()`, que vuelve a autenticar la cookie y valida el identificador de partida y la proyección de jugador, sin reutilizar una vista privada ajena. No hay peticiones desde pestaña oculta, se evita solapamiento y se cancela la vigilancia cuando se alcanza `READY`, se cambia de partida o se cierra sesión. Al regresar a una pestaña visible se consulta la sala pendiente, aunque no haya llegado un mensaje SSE. El temporizador queda explícitamente asociado al `matchId`; si cambia se invalida el anterior. No se añaden endpoints ni se envían cartas por SSE.

**Secciones:** el grid tiene dos columnas, cada una con **una pila vertical flex independiente** (`account-stack` y `game-stack`). Los paneles `<details>` siguen plegándose por fase o manualmente, pero ninguna fila compartida impone la altura de otra tarjeta. En pantalla estrecha ambas pilas pasan a una columna. El tablero dispone de mayor ancho sin ampliar las tarjetas de cuenta.

**Tablero y despliegue:** el SVG recupera `viewBox="0 0 510 430"` y proporción apaisada `510/430`; el jugador A usa proyección sin rotación y el jugador B ve una rotación de **180°**, sin deformar los hexágonos. Sus comandos siguen enviando coordenadas originales `col,row`. **Únicamente para partidas nuevas**, `initialState` coloca la unidad sintética de A en `(3,6)` y la de B en `(9,2)`: ambos bandos quedan junto a los lados horizontales largos. **Las partidas ya guardadas conservan su disposición anterior**; no se realiza migración o mutación de su estado. Quien quiera verificar el despliegue corregido debe **crear una partida nueva**; no borrar la base existente para hacerlo.

## Pruebas

Se ampliaron **tres suites existentes** sin cambiar el manifiesto de 80 archivos:

- `browser-ui.test.mjs`: anfitrión `bob` y transición perdida de SSE (recuperada con la consulta periódica), suspensión en pestaña oculta, cancelación al llegar `READY`, revocación al cerrar sesión y nuevo temporizador al cambiar de partida.
- `movement-board-ui.test.mjs`: proporción horizontal, orientación A/B y navegación de flechas según perspectiva, sin alterar las coordenadas de los movimientos. Se mantienen las comprobaciones previas de rutas, selección y accesibilidad.
- `sqlite.test.mjs`: creación de partidas por `alice` o `bob`; comprueba que el propietario obtiene bando A y que las unidades iniciales están en los bordes largos opuestos.

**Verificaciones aisladas realizadas:** comprobación sintáctica de los archivos modificados y estructura HTML equilibrada. **13/13** casos del tablero ejecutados con V8 sobre los módulos auténticos de geometría/selección/renderizado. **11/11** casos de `browser-ui.test.mjs` ejecutados con V8 sobre el código real de interfaz, controles, proyección privada y refresco, pero DOM/HTTP/reloj/runner de tests **simulados**. En el último ensayo se mantuvo el acceso dinámico a `globalThis.fetch` para reproducir correctamente el caso de cambio de sesión durante una petición; la simulación anterior que inyectaba `fetch` como parámetro estático no representaba ese caso y daba un fallo espurio. Blobs Git inspeccionados: `browser-ui.mjs` `0a6bb49397622e1f0df6aa1bc8e8bfadd21aed77` y `browser-ui.test.mjs` `075203666c298c8ffe9de703e7d7a89194fa2c6c`. **No son pruebas nativas Node ni navegador real.** No se ha ejecutado el conjunto completo SQLite/Node de esta nueva rama.

## Validación pendiente en Windows 11

Desde el directorio del repositorio habitual:

```powershell
git fetch origin
git worktree add --detach ..\command-colors-ui-fix origin/fix/ui-landscape-lobby-refresh-layout
cd ..\command-colors-ui-fix
git rev-parse HEAD
.\scripts\test-local.ps1 -Only "packages/local-api/browser-ui.test.mjs,packages/local-api/movement-board-ui.test.mjs,packages/sqlite-store/sqlite.test.mjs"
.\scripts\validate-ccwb-http.ps1 -FullRegression
node scripts/browser-lab.mjs
```

Abrir dos perfiles en `http://127.0.0.1:8788/`. Probar **ambos órdenes**: `alice` crea e invita a `bob` y `bob` crea e invita a `alice`. Comprobar que el anfitrión pasa a `READY` sin «Consultar partida» (el respaldo puede necesitar hasta unos segundos), que los paneles plegados no dejan huecos equivalentes a la altura de otra tarjeta y que **en partidas nuevas** el tablero es horizontal con cada bando abajo desde su propia perspectiva. Confirmar reconexión, persistencia y manos separadas. Se usa el **puerto de loopback** y cuentas ficticias; no usar Docker, WSL o Actions.

No fusionar esta PR ni las anteriores a `main` hasta superar el SHA exacto en Windows, cerrar las verificaciones SEC-001 y validar la interfaz visual.
