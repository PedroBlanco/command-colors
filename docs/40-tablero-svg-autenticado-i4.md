# CCW-014 — Tablero SVG autenticado y movimiento confirmado

**Fecha:** 9 de noviembre de 2026. **Rama:** `feat/i4-authenticated-svg-board`, apilada sobre PR #49 (a su vez depende de #48, #47, #46 y #45).

## Objetivo

Conectar un tablero SVG del **laboratorio local con sesiones reales** al protocolo de `move_synthetic_unit` sin trasladar identidades falsas A/B ni información privada del prototipo de PR #27. Este incremento permite probar táctilmente el flujo de selección, previsualización, corrección y confirmación de movimientos, todavía con **reglas ficticias**. No es una partida de *Ancients*.

## Cambios

- `packages/local-api/movement-board-ui.mjs`: representación de 117 hexágonos del tablero *odd-q*, unidades públicas A/B y ruta provisional. Los hexágonos son controles SVG accionables por clic, toque y teclado (Tabulador, Entrar o Espacio), con nombres accesibles y marcas del origen y de cada paso.
- `packages/local-api/hex-selection.mjs`, incorporado por PR #49, comprueba la geometría y la elegibilidad pública local; no sustituye al servidor.
- `packages/local-api/browser-ui.mjs`: monta el controlador en la página de sesiones con cookies e invitaciones. Solo muestra la proyección autorizada del servidor; conserva el formulario manual como alternativa de diagnóstico. La confirmación envía el mismo comando `move_synthetic_unit` que el formulario, con revisión esperada y clave idempotente.
- `packages/local-api/browser-ui.html`: tablero, texto de estado accesible y botones **Deshacer último paso**, **Cancelar ruta** y **Confirmar movimiento**. En pantallas estrechas el tablero tiene desplazamiento **dentro del panel**, sin obligar a reducir los hexágonos a objetivos táctiles diminutos.
- `packages/local-api/gateway.mjs`: lista cerrada de ficheros públicos para servir `movement-board-ui.mjs`, `hex-selection.mjs` y `hex-grid/hex.mjs` solo en modo local con navegador. No se exponen directorios, ficheros de tests ni datos SQLite.
- `packages/local-api/browser-gateway.test.mjs`: verificaciones escritas de rutas permitidas, CSP, consultas no permitidas y rechazo de ficheros internos.
- Manifiesto único de regresión actualizado a **35 suites**; diagnóstico preflight sincronizado.

## Semántica y seguridad

1. Se inicia un borrador solo al seleccionar una unidad **propia** y todavía no movida, durante la fase `MOVEMENT` del jugador activo.
2. Clics o toques en hexágonos vecinos libres añaden pasos; el usuario puede retirar un paso o descartar toda la ruta sin ningún `POST`.
3. **Solo** Confirmar envía `unitId` y `path` junto a la revisión e idempotencia que produce `deckCommand()`. El actor procede **exclusivamente de la cookie y la sesión del servidor**, no del navegador.
4. Si la red falla, el controlador conserva la misma clave idempotente para repetir **la misma ruta**; si se cambia la ruta, obtiene una clave nueva. Si llega una revisión nueva por SSE, un cambio de partida, usuario o fase, descarta la ruta provisional.
5. El servidor SQLite valida además órdenes concedidas, tablero persistido, distancia inventada, ocupación, actor, fase e idempotencia en la transacción. La prevalidación cliente nunca se considera autorización.
6. El servidor local sigue atado a `127.0.0.1`; no hay garantía de seguridad para Internet.

## Revisión de accesibilidad del tablero (9/11/2026)

Se detectó que la primera versión construía **117 puntos de tabulación** y podía perder el foco tras `svg.replaceChildren()`. Ahora solo el hexágono activo tiene `tabindex="0"`; las flechas desplazan el foco entre celdas, y Enter/Espacio seleccionan unidad o paso. El foco se restablece al sustituir los nodos y nunca se roba a botones externos. Los borradores también se descartan si una proyección posterior con la **misma** revisión cambia la ocupación o el origen.

## Verificación reproducida en esta revisión

Se ejecutaron los **22 callbacks originales** de `hex-selection.test.mjs` (11) y `movement-board-ui.test.mjs` (11) sobre el código real descargado de GitHub, dentro de un intérprete **V8 aislado**. Para ello se sustituyeron los imports de `node:test` y `node:assert/strict` por un adaptador de aserciones y `structuredClone` por una clonación JSON adecuada para estos datos planos.

**Resultado de esa comprobación limitada: 22/22 callbacks correctos, sin fallos.** No es una ejecución de `node --test`, ni una prueba HTTP, ni una validación con navegador real. Las anteriores referencias a «19 pruebas ejecutadas con Node.js» no están acreditadas mediante salida TAP y **no se utilizan como evidencia de integración**.

Hashes de los módulos y pruebas cotejados en esta revisión:

- `movement-board-ui.mjs`: `4999b42be49ee2c685a60d383746d1b3da8ca1e0`.
- `movement-board-ui.test.mjs`: `9a5f1b9809b088bae48460843cd229a5d64dab1c`.
- `hex-selection.mjs`: `5d75efc729562ae7f4dac9fc886dd496a682b553`.
- `hex-selection.test.mjs`: `8158cdb1937cdcb2ed12f2cde57a3fa75072ea37`.

Para acreditar las pruebas reales de Node.js en PowerShell:

```powershell
node --test packages/local-api/hex-selection.test.mjs packages/local-api/movement-board-ui.test.mjs
.\scripts\test-local.ps1 -Log '.local-data\regression\completa-20261109.tap'
```

**Pendiente:** la ejecución completa de las 35 suites, incluidas las siete que seguían sin evidencia, la suite HTTP extendida y las pruebas visuales/táctiles de escritorio y móvil con sesiones separadas. **No fusionar** esta PR ni las dependientes basándose solamente en la verificación V8.

## Dependencias y próximos pasos

1. Ejecución completa de las 35 suites en Windows PowerShell, con registro TAP y SHA-256 mediante `scripts/test-local.ps1`.
2. Prueba visual del tablero en PC, móvil y dos perfiles distintos: sesión, privacidad de manos, movimientos y SSE; comprobar tamaño de objetivo táctil, desplazamiento dentro del panel y foco por teclado.
3. Decidir la consolidación de la PR #27, que aún usa un servidor ficticio A/B y otro renderizador SVG, para evitar mantener dos implementaciones. **No se ha fusionado ni reemplazado automáticamente**; la interfaz autenticada de esta rama sigue provisional.
4. Tras las pruebas, fusionar las PR dependientes en orden, sin declarar implementadas las reglas oficiales R-04/R-05.
5. Vincular reglas reales por edición y terreno, y verificar autoría/permisos de escenarios y recursos oficiales.

La entrada manual existente continúa disponible como alternativa si el tablero requiere ajustes.
