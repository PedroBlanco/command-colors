# CCW — Regresión conjunta ampliada: 22 suites, 178 pruebas

**Fecha:** 8 de noviembre de 2026. **Rama:** `feat/i4-manual-browser-movement` (PR #48 apilada sobre #47, #46 y #45). **Objetivo:** ampliar el alcance documentado de las pruebas antes de decidir fusiones.

## Resultado ejecutado

Se ha ejecutado realmente, **en una única invocación de Node.js v22.16.0**, una selección de **22 archivos `*.test.mjs` del repositorio**, con estas métricas:

```text
tests      178
pass       178
fail       0
cancelled  0
skipped    0
todo       0
exit       0
```

Sin WSL, VPS, contenedores de aplicación ni GitHub Actions. Entorno de ejecución: Linux x64 aislado. Las suites se ejecutaron contra una reconstrucción de los archivos de GitHub necesarios, con comparación de SHA Git de las fuentes introducidas en esta ronda y de los módulos críticos, incluido `sqlite-game.mjs` (`85e958ad837610aa078655bd38d8eaa7e9ee9314`), `gateway.mjs` (`8c00ca9f69c56516b154d0ff3abdd17b565bf70f`) y `revision-stream.mjs` (`1f18134d3919faacae8ff9797d90c092604168da`).

## Suites ejecutadas

```text
packages/hex-grid/hex.test.mjs
packages/turn-phase/phase.test.mjs
packages/command-deck/deck.test.mjs
packages/command-deck/sqlite-game.test.mjs
packages/dice-roller/dice.test.mjs
packages/order-validator/validator.test.mjs
packages/order-validator/server-context.test.mjs
packages/movement/movement.test.mjs
packages/movement/server-policy.test.mjs
packages/command-deck/movement-sqlite.test.mjs
packages/local-api/movement-revision-sse.test.mjs
packages/local-api/movement-controls.test.mjs
packages/local-api/deck-controls.test.mjs
packages/local-api/browser-deck-ui.test.mjs
packages/local-api/command-deck-cookie.test.mjs
packages/local-api/command-deck-sse.test.mjs
packages/local-api/browser-session.test.mjs
packages/match-store/store.test.mjs
spikes/004/server.test.mjs
scripts/check-browser-lab.test.mjs
packages/local-api/browser-ui.test.mjs
packages/local-api/revision-stream.test.mjs
```

De las 17 suites pendientes después del informe [33](33-regresion-integrada-150.md), esta ronda ha ejecutado **seis suites adicionales**, con 27 pruebas nuevas respecto a las 151 previamente verificadas; las 22 suites se han probado además **juntas** (total 178). Se verificaron por SHA Git los archivos de los nuevos tests y de sus dependencias:
- `browser-session.test.mjs`: `a31542cddd8f2dc5a6d188664e9f4b9806609970`.
- `store.test.mjs`: `954cb2a0489322820f72d61aec859820af508ff4`.
- `spikes/004/server.test.mjs`: `639fb73cd1583b17e5708851a3714314a6081587`.
- `scripts/check-browser-lab.test.mjs`: `baa142e22d0d50fe504124d9ddc1235dc4a3ea5d`.
- `browser-ui.test.mjs`: `b4018cda82f82b32c3f50cefac3057fcd626a79a`.
- `revision-stream.test.mjs`: `bbe89a23c5dfc449548715b8b070e5307df6c670`.

La cobertura incluye sesiones y CSRF, almacenamiento en fichero, servidor inicial, diagnóstico local, autorefresco de navegador simulado, SSE real con renovación y expiración, límite de conexiones, cartas, movimiento SQLite y dos jugadores.

## Las once suites restantes

Las siguientes suites del script de regresión **no se han ejecutado aún en esta ronda integrada**:

```text
packages/access-control/access.test.mjs
packages/local-api/gateway.test.mjs
packages/local-api/compose.test.mjs
packages/sqlite-store/sqlite.test.mjs
packages/local-api/sqlite-compose.test.mjs
packages/sqlite-store/lifecycle.test.mjs
packages/sqlite-store/schema-integrity.test.mjs
packages/local-api/browser-gateway.test.mjs
packages/local-api/browser-sqlite-smoke.test.mjs
scripts/browser-lab.launcher.test.mjs
packages/local-api/command-deck-http.test.mjs
```

## Criterios para cerrar la fase

- Ejecutar esas 11 suites y repetir la **batería íntegra de 33** en un único comando, con resultado y código de salida registrados.
- Ejecutar `.\scripts\test-local.ps1` en Windows 11 con Node.js >= 22.16.0, sin WSL.
- Validar manualmente dos navegadores en ordenador y móvil y revisar visualmente el SVG de la PR #27.
- No confundir estas pruebas técnicas sintéticas con implementación o validación de reglas oficiales de *Ancients*. Mantener PR #45–#48 en borrador hasta cumplir las condiciones.

**Ningún cambio en `main` queda autorizado por este informe de regresión parcial.**
