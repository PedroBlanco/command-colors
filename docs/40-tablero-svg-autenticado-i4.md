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

## Verificación ejecutada

Con Node.js **22.16.0** en entorno Linux aislado, **sin WSL ni Actions**:

```powershell
node --check packages/local-api/movement-board-ui.mjs
node --check packages/local-api/movement-board-ui.test.mjs
node --test packages/local-api/hex-selection.test.mjs packages/local-api/movement-board-ui.test.mjs
```

**19 PASS, 0 FAIL, 0 SKIP**: 11 pruebas previas de selección y 8 nuevas de tablero/controlador (117 hexágonos; teclado; previsualización sin HTTP; saltos y ocupación; cancelar y deshacer local; expiración; reintentos de red; revisión SSE durante envío; rechazo de tableros corruptos).

El contenido de los dos nuevos archivos de implementación y pruebas que se ejecutó tiene **idéntico SHA Git** al publicado:

- `movement-board-ui.mjs` — `721d24061136eb930717e91b696c206da44922ca`.
- `movement-board-ui.test.mjs` — `d6b1b8d0444c0209073a72c7ae64c8450ebfb9ed`.

**No se han ejecutado las restantes 33 suites en esta sesión**, ni la suite HTTP real ampliada, ni el recorrido visual en Windows, escritorio y móvil. Los siete archivos de prueba pendientes de la fase anterior siguen sin evidencia de ejecución; la prueba de la página y del servidor contra navegador real continúa pendiente. **No fusionar** todavía esta PR ni las PR #45–#49.

## Dependencias y próximos pasos

1. Ejecución completa de las 35 suites en Windows PowerShell, con registro TAP y SHA-256 mediante `scripts/test-local.ps1`.
2. Prueba visual del tablero en PC, móvil y dos perfiles distintos: sesión, privacidad de manos, movimientos y SSE; comprobar tamaño de objetivo táctil, desplazamiento dentro del panel y foco por teclado.
3. Decidir la consolidación de la PR #27, que aún usa un servidor ficticio A/B y otro renderizador SVG, para evitar mantener dos implementaciones. **No se ha fusionado ni reemplazado automáticamente**; la interfaz autenticada de esta rama sigue provisional.
4. Tras las pruebas, fusionar las PR dependientes en orden, sin declarar implementadas las reglas oficiales R-04/R-05.
5. Vincular reglas reales por edición y terreno, y verificar autoría/permisos de escenarios y recursos oficiales.

La entrada manual existente continúa disponible como alternativa si el tablero requiere ajustes.
