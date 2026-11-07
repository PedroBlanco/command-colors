# CCW-013 — Validación transaccional de órdenes con tablero sintético

**Fecha:** 7 de noviembre de 2026. **Alcance:** servidor local Node.js 22.16.0 / SQLite, solo pruebas; no reglamento oficial.

## Comportamiento

En la composición HTTP/SQLite existente, `packages/command-deck/sqlite-game.mjs` valida la selección de unidades **dentro del mismo `BEGIN IMMEDIATE`** que confirma las revisiones, el evento y la idempotencia. Antes de aceptar `assign_synthetic_orders` en `ASSIGN_ORDERS`:

1. Obtiene `board` de `matches.private_state` y `activeCard` del mazo secreto del servidor. Nunca confía en `units`, `cardProfiles` o `sectorMembership` enviados por el navegador.
2. `packages/order-validator/server-context.mjs` verifica los identificadores, el tablero 13×9, duplicados y ocupación. Produce una política sintética: cada carta ficticia admite un máximo de **dos** unidades y los tres sectores; a modo de ejemplo, las columnas 4 y 8 participan en dos sectores. **La política no reproduce Ancients**.
3. `validateSyntheticOrderAssignment` comprueba actor (determinado por la sesión), fase, revisión, límite, existencia, bando y disponibilidad; devuelve un comando mínimo saneado. Unidades inexistentes, enemigas o bloqueadas comparten el rechazo `UNIT_NOT_ELIGIBLE`.
4. Si el comando es inválido, no se incrementa `game_revision` ni se añade evento de juego. Si es válido, se aplica la transición original, se guarda el estado y se conserva idempotencia. Las claves reutilizadas con parámetros distintos se rechazan.

El tablero inicial de laboratorio contiene `synthetic-a` (A) y `synthetic-b` (B). La entrada ilustrativa de la página de prueba ahora indica `synthetic-a`. No se integran todavía los desplazamientos, combates, efectos de cartas, terrenos ni escenarios oficiales.

## Pruebas y situación real

```powershell
node --test packages/order-validator/validator.test.mjs packages/order-validator/server-context.test.mjs
node --test packages/command-deck/sqlite-game.test.mjs packages/local-api/command-deck-cookie.test.mjs
.\scripts\test-local.ps1
```

- 6 pruebas nuevas de contexto servidor y 11 del validador anterior: **17/17 pasaron** juntas en Node.js 22.16.0, sin WSL ni Actions.
- La prueba nueva de extremo a extremo HTTP con cookies y SQLite comprueba órdenes inválidas y su ausencia de efectos, rechazo a terceros, suplantación de datos, orden válida, idempotencia y visibilidad de revisión. **Está escrita, pero su ejecución real todavía no está confirmada**.
- La batería general cuenta **28 suites** y no se ha ejecutado completa en Windows. No afirmar que toda la integración esté validada hasta pasarla.

## Límites explícitos

No hay servidor de producción, seguridad de Internet, movimiento legal, cartas oficiales, sectores oficiales ni validación visual del tablero PR #27. Una futura versión de reglas debe reemplazar el contexto inventado por datos versionados y contrastados de una edición autorizada, manteniendo el aislamiento entre jugadores. Las issues CCW-013 y CCW-014 siguen abiertas.
