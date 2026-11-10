# CCW-014 — Terrenos básicos: bosque, colina y terreno accidentado

**Fecha:** 2026-11-10. **Estado:** PR #55 experimental, dependiente de PR #54 y #53; no integrada en partidas. **Cobertura parcial:** R-05 (movimiento y terreno) y preparación R-06/R-07 (límites ordinarios de dados), sin cerrar ninguna regla oficial.

## Fuentes y delimitación

Referencia: *Command & Colors: Ancients*, reglas del juego básico, 3.ª edición (GMT Games, 2009). Contrastes legibles:

- [16. TERRAIN, Ancients (reglas del juego básico)](https://www.commandsandcolors.net/ancients/the-game/main/16-terrain.html).
- [08. MOVEMENT: unidades a pie, montadas y líderes](https://www.commandsandcolors.net/ancients/the-game/main/08-movement.html).
- [Contents (Base Game): clasificación de unidades montadas](https://www.commandsandcolors.net/ancients/the-game/main/02-contents-base-game.html).

No se reutiliza arte, mapas, cartas ni textos editoriales. Se han codificado únicamente parámetros y restricciones mecánicas.

Se admiten sólo `CLEAR`, `FOREST`, `HILL` y `BROKEN_GROUND`. **Marismas, ríos, puentes, murallas, campamentos y otros terrenos quedan deliberadamente sin implementar:** en vez de interpretarlos como llanura, las entradas desconocidas se rechazan.

## Contratos

`packages/ancients-rules/terrain-precheck.mjs` exporta dos funciones puras:

```js
precheckAncientsTerrainMovement({
  units: [{id, side, type, col, row}],
  leaders: [{id, side, col, row}],
  unitId,
  path: [{col, row}], // origen excluido
  terrain: [{col, row, kind}] // lista explícita; ausencia de ficha = CLEAR
});

assessAncientsTerrainDiceCap({
  attackerType,
  attackerTerrain: 'CLEAR' | 'FOREST' | 'HILL' | 'BROKEN_GROUND',
  targetTerrain: 'CLEAR' | 'FOREST' | 'HILL' | 'BROKEN_GROUND',
  attackKind: 'CLOSE' | 'RANGED'
});
```

La primera función **compone la precomprobación de trayectoria de PR #54** con los siguientes efectos por **entrada normal** en una casilla:

| Terreno | Movimiento ordinario | Combate tras entrar |
| --- | --- | --- |
| Bosque | Todas las unidades se detienen al entrar | Sólo infantería ligera, honderos, arqueros, auxilia y guerreros conservan la posibilidad ordinaria de combatir, sujeta a las restricciones de perfil |
| Colina | Sin restricción adicional de movimiento | No impide combatir tras entrar |
| Terreno accidentado | Infantería a pie: sin parada obligatoria. Máquinas de guerra pesadas: entrada prohibida. Montadas, incluidos elefantes y carros pesados: detenerse al entrar | Unidades montadas que entran: no pueden combatir ese turno; infantería sigue perfil normal |

Una unidad auxiliar que llega al bosque tras recorrer dos hexágonos **sigue sin poder combatir**, porque la excepción del bosque no anula la prohibición previa por distancia. Una carga de guerreros de dos pasos sólo se trata como candidato si ya pasó el examen de objetivo adyacente de PR #54; no desencadena ni resuelve combate.

La segunda función calcula **límites ordinarios de dados, no dados que deban lanzarse**, y devuelve `maxDice: null` cuando el terreno no introduce límite:

- Cuerpo a cuerpo hacia o desde bosque o terreno accidentado: máximo ordinario **2**.
- Disparo a objetivo en bosque: máximo ordinario **1**. Disparar *desde* bosque no impone por sí solo dicho límite.
- Cuerpo a cuerpo cuesta arriba hacia colina: máximo ordinario **2**.
- Cuerpo a cuerpo cuesta abajo, o colina contra colina: infantería a pie máximo ordinario **3**; montadas máximo ordinario **2**.
- Si concurren restricciones de distintos terrenos, se aplica sólo el máximo ordinario más restrictivo, sin cartas adicionales.

**Garantías/limitaciones:** todos los resultados devuelven `needsFullLegalityCheck: true`. Los estados `CANDIDATE`, `BLOCKED` y `REQUIRES_RULE_EXCEPTION` son únicamente una evaluación de reglas normales. El modo de ataque, la pertenencia de órdenes, las fases, la autorización de sesión, la distancia de disparo, el combate disponible según unidad, línea de visión, bloqueo entre colinas, cartas especiales, líder, excepciones de escenario y retirada permanecen **sin comprobar**. El resultado de dados señala `lineOfSightChecked: false`, `cardModifiersApplied: false`.

**No se modifica** el motor sintético, el almacenamiento SQLite, la API, las pantallas ni ninguna partida.

## Evidencia técnica

- Ejecución nativa: `node --test --test-reporter=tap packages/ancients-rules/terrain-precheck.test.mjs`.
- Node.js **v22.16.0** en contenedor Linux, sin WSL ni GitHub Actions.
- **24/24 PASS, 0 FAIL, 0 SKIP**. Casos de parada en bosque/terreno accidentado, excepción de combate para cinco tipos ligeros a pie, máquinas, elefantes y carros, cambios de cota y combinación de límites, errores estructurales y no-concesión de excepciones.
- SHA Git **idénticos** entre lo ensayado y lo publicado:
  - `terrain-precheck.mjs`: `4b9ddaaa1e5cf55696c96a87d3043b7dd15bc904`.
  - `terrain-precheck.test.mjs`: `a2d2f0b47aea6db690e499d87247f2b1a267eeb0`.
  - Dependencias ensayadas: `hex.mjs` = `ae0e4526b8e91c4c0d5d94aebc52077b60f410da`; `movement-profile.mjs` = `2bef541f7da040f7eb1b2b8735fab4939ce1f966`; `movement-path-precheck.mjs` = `968e5466baf63e0a2f45f0ecc0517cc8c0189975`.
- SHA-256 de TAP de esta ejecución: `9bdb3fb5b65ed93fed82b4b200d0003b1671ce4a2e7d8f6d8bcc570628410235`; archivo distribuido en la conversación.
- Manifiesto actualizado a **41 suites**. Esta ejecución **no** acredita el resultado de las otras 40 ni de toda la aplicación.

## Siguientes dependencias de R-05 / R-06

1. Marismas, ríos y otros terrenos, junto con órdenes y efectos excepcionales de cartas; acordar reglas para ignorar límites ordinarios de movimiento, sin autorizar automáticamente.
2. Visibilidad: trazar línea de visión entre hexágonos y tratar bosques y colinas, incluida la situación de meseta y los hexágonos de colina intermedios.
3. Implementar un validador autoritativo único conectado a estados de partida y procedimientos de combate, con pruebas de ambos jugadores, turnos y permisos.
4. Ejecutar **41 suites completas** con TAP, pruebas HTTP/SSE y validación PC/móvil antes de fusionar la cadena apilada.

**PR #55 en borrador; no fusionar ni desplegar.**
