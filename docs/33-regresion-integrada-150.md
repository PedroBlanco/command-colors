# CCW — Regresión conjunta de órdenes, movimiento, mazo y SSE (7/11/2026)

**Estado:** 150 pruebas ejecutadas y superadas. Informe de verificación incremental; **no sustituye la batería general** ni la validación visual en Windows 11.

## Entorno y método

- Node.js **v22.16.0** en entorno aislado `linux/x64`, **sin WSL**, GitHub Actions ni VPS.
- Código de las ramas apiladas **#45 → #46 → #47 → #48**, recuperado de GitHub. Los archivos empleados se contrastaron contra SHA Git; para los módulos principales, la pasarela y los tests recuperados los hashes coincidieron.
- Todas las pruebas se ejecutaron en **una sola invocación** de `node --test`, sin servicios externos ni datos de usuarios reales.
- Resultado observado: **150 tests, 150 PASS, 0 FAIL, 0 CANCELLED, 0 SKIPPED**.

## Orden ejecutada

```powershell
node --test packages/hex-grid/hex.test.mjs packages/turn-phase/phase.test.mjs packages/command-deck/deck.test.mjs packages/command-deck/sqlite-game.test.mjs packages/dice-roller/dice.test.mjs packages/order-validator/*.test.mjs packages/movement/*.test.mjs packages/command-deck/movement-sqlite.test.mjs packages/local-api/movement-revision-sse.test.mjs packages/local-api/movement-controls.test.mjs packages/local-api/deck-controls.test.mjs packages/local-api/browser-deck-ui.test.mjs packages/local-api/command-deck-cookie.test.mjs packages/local-api/command-deck-sse.test.mjs
```

En este informe, los comodines `*.test.mjs` agrupan exclusivamente los archivos presentes en esos directorios: **16 suites originales del repositorio en total**, incluida la nueva prueba HTTP/SSE de movimiento en `command-deck-sse.test.mjs`. No se trata de las 33 suites completas del script de regresión.

## Cobertura relevante

| Área | Comprobaciones |
| --- | --- |
| Geometría | 117 hexágonos, vecinos, distancias y sectores |
| Máquina de fases | turnos, revisiones, deshacer y decisión defensiva pendiente |
| Mazo | instancias opacas, reparto, robo, descarte, manos privadas y conservación |
| Persistencia | transacciones SQLite, reapertura en otra conexión o proceso, rollback e idempotencia |
| Dados | modo digital criptográfico y declaración física **sin reglamento oficial** |
| Órdenes | unidades propias, límite de carta, sectores, bloqueo, rechazo de falsificación |
| Movimiento | trayectorias, adyacencia, colisiones, límites, unidad movida una sola vez y recuperación |
| Navegador simulado | botón de movimiento, comandos saneados, revisión, identidad y cambio de sesión |
| HTTP real | cookies, invitación, dos participantes, CSRF, denegaciones y privacidad de manos |
| SSE real | avisos de revisión y reconexión, revocación de sesiones, **movimiento real con dos sesiones y sin filtrar datos privados** |

Se añadió en la rama de PR #48 el test `SSE: authenticated movement reaches both players with counters only; rejected move is silent` a `packages/local-api/command-deck-sse.test.mjs`. Compara los tableros autorizados obtenidos por GET tras mover por POST, demuestra que ambos clientes reciben la revisión `3`, que una orden ilegal no causa aviso y que los frames SSE solo incluyen `lobbyRevision` y `gameRevision`. **La nueva prueba pasa junto a las otras dos del mismo archivo**. Su SHA Git: `bd1cc3298329ba926e014ad26b77a5560a523239`.

## Lo que no demuestra

1. **17 de las 33 suites generales** no se han ejecutado conjuntamente en este entorno; puede haber regresiones fuera de los módulos cubiertos. Ejecutar `.\scripts\test-local.ps1` en Windows 11 antes de fusionar.
2. No se han probado manualmente dos navegadores reales con teclado, ratón y pantalla táctil; tampoco el tablero SVG de PR #27.
3. No se garantiza seguridad de exposición a Internet: sigue siendo laboratorio privado `127.0.0.1`.
4. No se han fijado reglas oficiales de Ancients, por lo que ni CCW-013 ni CCW-014 ni R-04/R-05 están cerrados.

**Decisión de integración:** mantener PR #45–#48 pendientes hasta superar la regresión general y la validación necesaria. Se conserva `main` sin cambios por esta verificación.

## Ajuste de controles tras movimiento — 151 pruebas (7/11/2026)

La vista autorizada de una partida sintética comunica ahora la lista pública de identificadores `movedUnitIds` derivada **solo** de `matches.private_state`, sin revelar manos o mazo. Cuando ya se ha movido una unidad, la interfaz deja de ofrecer «Deshacer órdenes» y rechaza localmente el intento de mover esa misma unidad por segunda vez (`UNIDAD_YA_MOVIDA`). El servidor SQLite conserva de forma independiente la comprobación decisiva. La nueva prueba de controlador, las pruebas de botón en navegador simulado y las pruebas reales HTTP/cookies verifican el comportamiento, incluida la proyección del estado a ambos jugadores.

Regresión conjunta sobre **16 suites** (geometría, fases, mazo, dados, órdenes, movimiento, SQLite, DOM simulado, HTTP/cookies y SSE): **151 pruebas ejecutadas, 151 PASS, 0 FAIL**, Node.js v22.16.0 en entorno aislado linux/x64, sin WSL ni GitHub Actions. Los cinco archivos modificados se contrastaron con los SHAs de los mismos archivos probados. Siguen pendientes **17 suites de las 33 generales** y la validación visual PC/móvil; todavía no procede fusionar las PR apiladas.
