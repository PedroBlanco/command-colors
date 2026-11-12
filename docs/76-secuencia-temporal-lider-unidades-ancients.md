# LAB-ANC / R-04–R-05 — Secuencia provisional de movimientos de líderes y unidades

**Fecha:** 12/11/2026. **Rama:** `feat/lab-anc-leader-movement-preflight`, PR #95 (borrador). **Tipo:** laboratorio interno y privado, **simulación de solo lectura**, no motor reglamentario de movimientos.

## Por qué hace falta un orden temporal

Las reglas básicas de *Ancients* permiten que un líder se separe de la unidad a la que está asociado si recibe una orden individual apropiada. La separación **debe ocurrir antes de que la unidad se mueva**. Si la unidad se desplaza con su líder, este viaja con ella y no puede separarse después en el mismo turno. Cuando un líder que se mueve por separado se incorpora a otra unidad, esa unidad **ya no puede desplazarse después** en el turno, incluso aunque estuviese ordenada; puede seguir combatiendo según las restantes reglas. Un líder tampoco puede moverse dos veces en un turno.

Fuentes de contraste (reglas públicas del juego básico, sin reproducción de textos de cartas):
- [Movement: Leader Movement y nota sobre el orden temporal](https://www.commandsandcolors.net/ancients/the-game/main/08-movement.html)
- [Order Units and Leaders](https://www.commandsandcolors.net/ancients/the-game/main/07-order-units-and-leaders.html)

## Implementación

`packages/ancients-rules/leader-unit-sequence-preflight.mjs` incorpora
`precheckAncientsMovementSequence({units,leaders,actor,orderedUnitIds,orderedLeaderIds,actions,terrain})`.

Los argumentos proceden de un **tablero y un conjunto de órdenes verificados del servidor**; `actions` es una sucesión de rutas hipotéticas, no comandos aplicables a la partida. Se trabaja exclusivamente con copias de unidades/líderes: cada unidad y líder puede ser procesado una sola vez; los movimientos de unidad pueden llevar a su líder ya asociado; los líderes pueden separarse y moverse por sí mismos solo si fueron ordenados; la llegada de un líder a una unidad impide su movimiento posterior; y la unidad puede recibir un líder después de haberse desplazado. Se reutilizan los filtros existentes de geometría, terreno, ocupación, perfiles de unidad y desplazamiento de líder para cada paso provisional. Un resultado que necesite una excepción reglamentaria **se bloquea**, nunca se concede por omisión.

`staged-movement-preflight.mjs` incorpora
`precheckStagedAncientsMovementSequence`, que exige coincidencia de turno, revisión, fase `LAB_RESOLUTION_PENDING`, órdenes registradas para cada pieza y posiciones originales verificables.

`sqlite-section-ccwb-bridge.mjs` verifica primero la reconstrucción del historial privado de cartas, órdenes, eventos e idempotencia. `sqlite-store/sqlite.mjs` incorpora exclusivamente para **código interno**
`precheckExperimentalSectionMovementSequence({sessionToken,expectedRevision,actions}, trustedContext)`: comprobación de sesión y pertenencia dentro de la misma instantánea de lectura WAL que el historial. `trustedContext={unitTypes,terrain}` se suministra únicamente desde el servidor, no desde los campos de la solicitud.

### Frontera y límites

- La respuesta favorable es **`CANDIDATE_SEQUENCE`**, con `movementAuthorized:false`, `attackAuthorized:false`, `stateChanged:false` y `needsFullLegalityCheck:true`. No se modifica `matches`, `game_events`, `game_commands`, el tablero original ni las órdenes. El resultado no publica cartas, mano, mazo ni comandos privados.
- No se agregan tablas, migraciones, endpoints HTTP ni acciones públicas. La selección de acciones sigue siendo hipotética; **no existe aún un diario de movimientos confirmados**.
- Solo se cubren movimientos ordinarios de las piezas incluidas, no se ejecutan excepciones de cartas, evasiones, huidas, retiradas, combates, captura de estandartes ni cierres reglamentarios de fase. Una secuencia provisional no puede convertirse directamente en autorización o persistencia.
- Se revalidarán las reglas contra la edición física antes del cierre reglamentario.

## Pruebas nuevas y evidencia

Esta ampliación añade **18 casos** a la PR #95:
- **10** en el nuevo archivo `leader-unit-sequence-preflight.test.mjs`: líder primero/unidad después, orden inverso, bloqueo al incorporarse a una unidad, incorporación tras mover la unidad, adhesión de un líder inicialmente solo, doble movimiento, piezas no ordenadas, caminos y restricciones parciales, entradas inválidas e inmutabilidad.
- **5** a `staged-movement-preflight.test.mjs`: órdenes, turno, revisión, rechazo de instantáneas de órdenes incoherentes y procedencia de perfiles/terreno.
- **3** a `sqlite-store/ancients-section-history.test.mjs`: consistencia de SQLite, revocación desde otra conexión, protección frente a campos y trayectorias falsificados. **No ejecutadas con SQLite nativo**.

Los **8 casos del preflight individual**, los **10 del simulador temporal** y los **20 casos acumulados de la suite staged** se comprobaron conjuntamente sobre los blobs de GitHub mediante un **entorno V8 aislado** con sustitución de imports y aserciones: **38/38**, 0 fallos. Se verificó también sintaxis V8 de los tres archivos de composición/SQLite modificados. **Esta evidencia no equivale a `node:test` real, pruebas HTTP, SQLite ni regresión completa.** La rama tiene 73 suites inventariadas y ninguna regresión total de este SHA ejecutada.

La PR #95 contiene ahora **34 casos nuevos** (16 del preflight individual anterior + 18 de esta ampliación); **6 pruebas de SQLite de la PR #95** permanecen pendientes de ejecución nativa.

## Ejecución posterior, sin solicitar pruebas locales por ahora

```powershell
# Native PowerShell on Windows 11; no WSL
node --test packages/ancients-rules/leader-movement-preflight.test.mjs packages/ancients-rules/leader-unit-sequence-preflight.test.mjs packages/ancients-rules/staged-movement-preflight.test.mjs packages/sqlite-store/ancients-section-history.test.mjs
.\scripts\test-local.ps1
```

PR #93 (SEC-001) conserva por separado sus propias pruebas y bloqueo de integración. No desplegar, no fusionar en `main` y no declarar terminada CCW-014.
