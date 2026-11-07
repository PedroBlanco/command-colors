# CCW-012 — Controles de cartas sintéticas en navegador (I3)

**Estado:** propuesta experimental en PR #41, dependiente de PR #40 **ya fusionada en `main`**. **No es un juego de Ancients**. No contiene cartas, imágenes, escenarios ni reglas oficiales. El laboratorio web continúa limitado a `127.0.0.1`.

## Objetivo

Facilitar la **primera prueba con dos perfiles de navegador** del mazo sintético persistente, sin manipular directamente llamadas HTTP. El navegador trabaja exclusivamente con la proyección privada autorizada por el backend; la validación reglamentaria y de autorización permanece **en el servidor**.

## Cambios

- `packages/local-api/deck-controls.mjs`: modelo puro de disponibilidad de acciones según `phase`, `turn`, `actingSide`, mano propia y `pendingDecision`. Construye solicitudes con `type`, `expectedRevision`, `idempotencyKey` y los argumentos de la acción, **sin el campo actor**.
- `browser-ui.html`: módulo accesible de laboratorio con selección de cartas de la mano, lista de unidades ficticias, asignación y deshacer de órdenes, cierre de movimiento/combate, petición de defensa, respuesta STAND/EVADE y robo al terminar el turno.
- `browser-ui.mjs`: activa únicamente controles correspondientes a la fase recibida. Elige carta **solo de `yourHand`**, muestra únicamente proyecciones autorizadas y actualiza mediante el SSE existente. Las acciones se envían con clave aleatoria independiente y revisión esperada.
- En cada **cambio de identidad, partida o cierre de sesión**, borra mano, sala, token temporal de invitación y datos privados visibles; invalida las consultas HTTP anteriores para que no reaparezcan vistas antiguas.
- `gateway.mjs`: sirve explícitamente `/deck-controls.mjs` en modo navegador con las mismas cabeceras de seguridad del cliente. **No** expone archivos SQLite ni otros módulos internos.
- Se amplían las pruebas del DOM simulado y de la pasarela HTTP para conservar el comportamiento heredado.

## Procedimiento previsto en Windows 11

Desde una copia del repositorio, tras superar las pruebas HTTP+SQLite de la PR #40:

```powershell
git fetch origin
git switch feat/i3-browser-command-controls
node scripts/check-browser-lab.mjs
.\scripts\test-local.ps1
node scripts/browser-lab.mjs
```

Abrir `http://127.0.0.1:8788/` en dos perfiles de navegador distintos; las cuentas ficticias `alice` y `bob` se crean al primer arranque, con contraseñas aleatorias mostradas **una sola vez**. No compartir cookies, contraseñas, invitaciones ni archivos SQLite.

Secuencia de aceptación de laboratorio:

1. Entrar como A y B, crear una partida privada, invitar a B y aceptar con su token.
2. A utiliza «Inicializar mazo de prueba». B no debe poder inicializarlo; una segunda inicialización debe fallar.
3. A comprueba que solo ve su mano. B comprueba que ve **otra** mano y el recuento de cartas de A; ninguno debe ver el orden del mazo.
4. A elige y juega una carta de **su propia mano**, asigna unidades ficticias (por ejemplo `unit_a`), deshace la asignación si corresponde y vuelve a asignar.
5. A finaliza movimiento, puede solicitar defensa sobre `unit_b`. La interfaz de A queda bloqueada durante la decisión; **B** puede responder STAND o EVADE.
6. A finaliza combate y roba una carta para cerrar el turno. B comprueba que pasa a ser el jugador activo.
7. Comprobar que SSE actualiza ambos perfiles, que reiniciar el servidor recupera el estado y que cambiar de usuario o partida elimina los datos privados anteriores.

## Verificación efectivamente realizada

Con Node.js 22.16.0, en un entorno local **sin WSL, VPS, Actions ni navegador físico**:

```powershell
node --test packages/local-api/deck-controls.test.mjs packages/local-api/browser-deck-ui.test.mjs
```

**13/13 pruebas nuevas superadas**: siete de disponibilidad y validación local de comandos y seis de interfaz DOM/fetch simulados, incluidos filtrado de cartas, fases, SSE y limpieza al cambiar usuario/partida. También se reprodujeron localmente los **dos casos previos de SSE** sobre el nuevo módulo: **15/15 pruebas superadas** en esa ejecución. Los archivos JavaScript publicados se compararon con SHA Git de los probados.

Los IDs utilizados por el nuevo JavaScript se cotejaron con los elementos del HTML publicado: **ninguno faltante**.

**Revisión 7-11-2026:** se ejecutaron conjuntamente **siete suites con 47/47 pruebas superadas**, 0 fallos: 18 de SQLite, 4 HTTP Bearer, 2 HTTP cookies, 8 de seguridad del gateway y rutas estáticas, 7 del modelo de controles, 6 DOM nuevos y 2 SSE regresión. Las fuentes ejecutadas se cotejaron por hash Git con los blobs de la rama. La PR #40 ya está fusionada; PR #41 fue actualizada incorporando las pruebas de cookies, conservando la cobertura acumulada. Sigue **pendiente** la ejecución de las 24 suites completas y del script PowerShell en Windows, el navegador gráfico y la validación humana del tablero SVG de PR #27.

## Limitaciones

- La habilitación de botones solo ayuda a la interfaz. El servidor sigue rechazando cartas ajenas, fases incorrectas, revisiones caducadas y acciones de otro bando.
- No se ha diseñado todavía la interfaz con la geometría del tablero: **PR #27 independiente** y pendiente de aceptación.
- Un mazo local puede contener secretos en SQLite sin cifrar. Solo datos ficticios y nunca exposición a redes externas.
- Los nombres STAND/EVADE, las unidades y las cartas son sintéticos; no representan resolución de combate real ni reglamento oficial.
