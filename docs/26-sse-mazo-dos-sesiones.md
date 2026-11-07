# CCW-010 / CCW-012 — Sincronización de mazo con dos sesiones HTTP (laboratorio)

**Fecha:** 7 de noviembre de 2026. **Ámbito:** solo `127.0.0.1`, Node.js 22.16.0, cuentas/mazos sintéticos. **No es una prueba visual ni una certificación de seguridad.**

## Alcance del incremento

`packages/local-api/command-deck-sse.test.mjs` añade dos casos automatizados con **SQLite real, gateway HTTP real y dos cookies HttpOnly**:

1. **Dos participantes y actualizaciones privadas:** se crea una sala por invitación, se abren canales SSE independientes de A y B, se comprueba que un tercero es rechazado, que la inicialización del mazo notifica un incremento de revisión de sala, y que jugar una carta incrementa la revisión del juego para ambos. Los frames SSE solo transportan `lobbyRevision` y `gameRevision`, nunca manos, cartas, identificadores del mazo oculto ni eventos internos. B se desconecta, abre otra conexión y recibe la revisión vigente.
2. **Revocación:** B cierra sesión desde HTTP; el canal existente termina y su antigua cookie no puede reconectar.

La prueba se ejecuta únicamente contra el backend real del laboratorio y se limpia sin publicar datos privados. Es independiente de los mocks de interfaz usados en otras suites.

## Evidencia

En Node.js 22.16.0, sin WSL, VPS, Docker o GitHub Actions, se ejecutaron **ocho suites juntas**:

```powershell
node --test packages/command-deck/sqlite-game.test.mjs packages/local-api/command-deck-http.test.mjs packages/local-api/command-deck-cookie.test.mjs packages/local-api/browser-gateway.test.mjs packages/local-api/deck-controls.test.mjs packages/local-api/browser-deck-ui.test.mjs packages/local-api/browser-ui.test.mjs packages/local-api/command-deck-sse.test.mjs
```

**49 pruebas superadas, 0 fallos**, incluyendo las 2 nuevas de SSE. Las fuentes de código y los tests reconstruidos para ejecución se cotejaron mediante hashes de objeto Git con los archivos de las PR #40 y #41, ahora fusionadas en `main`.

La batería general de `scripts/test-local.ps1` y el diagnóstico pasan a **25 suites**. **No se ha ejecutado aún el conjunto completo de 25 suites ni el script PowerShell en Windows 11**, ni se ha validado la interfaz mediante dos navegadores gráficos reales.

## Riesgos y restricciones

- Los eventos SSE se consultan mediante sondeo y solo están preparados para un servidor de laboratorio local; el modo de producción necesitará HTTPS, gestión de sesiones y antiaabuso, reintentos y métricas operativas.
- Los datos de juego son inventados: no se han implementado efectos ni reglas oficiales de *Command & Colors: Ancients*.
- Los test de cookies no reemplazan un análisis de amenazas, ni validan protección ante saturación, seguridad del sistema operativo o cifrado de bases.
- PR #27 del tablero SVG permanece separada hasta validación visual.
