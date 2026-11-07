# Incremento I1 — Tablero SVG y conexión local (CCW-006)

Estado: experimento; no completa I1 ni cierra CCW-005/006.

## Alcance

Se reutiliza la topología odd-q de `packages/hex-grid/hex.mjs` para mostrar 117 celdas, las dos unidades sintéticas públicas recibidas de `GET /api/state`, el turno ficticio, la mano propia y el número de cartas ajenas. Los iconos son geométricos, sin arte ni escenarios oficiales. Controles: selección por clic, toque o teclado, zoom por botones y desplazamiento por arrastre. La presentación del tablero no habilita comandos de movimiento.

El servidor de demostración sirve exclusivamente HTML y módulos JS en una lista blanca, siempre ligado a `127.0.0.1`. La información oculta permanece en el servidor de memoria y no se incluye en los eventos SSE. La identidad A/B es una cabecera simulada **sin autenticación**.

## Verificación

`node --test packages/hex-grid/hex.test.mjs spikes/004/*.test.mjs`

Los tests cubren geometría, modelos de unidades, renderizado SVG sobre DOM simulado, teclado, rutas estáticas, rechazo de archivos no autorizados y separación HTTP de manos. Mantener las pruebas previas HTTP/SSE y revisión de turnos.

Prueba manual pendiente: escritorio y pantalla móvil emulada (360 px); acceso desde móvil físico y seguridad requieren un servidor real con autenticación.

## Bloqueos y decisiones pendientes

- CCW-002: edición exacta y fronteras oficiales de sectores.
- CCW-004: aprobar ADR y pila tecnológica. Este incremento usa módulos JavaScript nativos deliberadamente y no decide framework.
- CCW-005: pruebas de límites de sectores con referencias verificadas.
- CCW-006: validación visual en navegador real y móvil.
- CCW-007/008: autenticación, invitaciones, persistencia y concurrencia transaccional antes de red externa.

No es aún una app multijugador operativa para terceros ni una partida jugable.
