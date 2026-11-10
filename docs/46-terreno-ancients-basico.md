# CCW-014 · Primeras restricciones de terreno de Ancients (R-05 parcial)

**Fecha:** 10 de noviembre de 2026. **Rama:** `feat/i4-ancients-base-terrain-screening`, basada en la PR #55; **estado:** borrador experimental sin integración en partidas. Edición de referencia: *Command & Colors: Ancients*, tercera edición (2009), juego básico.

## Origen y reglas comprobadas

Fuente principal para revisión: sección 16 de terreno de las reglas del juego básico en [Commands & Colors — 16. Terrain](https://www.commandsandcolors.net/ancients/the-game/main/16-terrain.html), contrastada con [GMT Games, reglamento de 2009](https://www.gmtgames.com/living_rules/CC_Rules_2009.pdf) y [clasificación de unidades a pie/montadas](https://www.commandsandcolors.net/ancients/the-game/main/02-contents-base-game.html).

El alcance **deliberadamente limitado** solo incluye tres tipos de terreno ordinarios:

| Terreno | Movimiento normal | Batalla ordinaria al entrar |
| --- | --- | --- |
| `HILL` · Colina | Sin limitación del desplazamiento por el terreno | No la impide por sí mismo |
| `FOREST` · Bosque | Todas las unidades se detienen al entrar | Solo la pueden realizar las cinco clases especificadas de infantería ligera, honderos, arqueros, auxilia y guerreros, si sus otras reglas lo permiten |
| `BROKEN_GROUND` · Accidentado | Infantería normal sin restricción; las máquinas de guerra pesadas no pueden entrar; las unidades montadas deben detenerse al entrar | La impide a las unidades montadas que entraron; no a la infantería por ese solo motivo |

`ELEPHANT` y `HEAVY_CHARIOT` son **unidades montadas**, junto a las tres categorías de caballería básica. La restricción de bosque se evalúa **al entrar**: salir de un bosque donde ya empieza la unidad no significa volver a entrar.

**No se implementan todavía** marismas, vados, ríos, puentes, costas, muros, campamentos, edificios ni excepciones de escenario. No se calculan los límites de dados de combate, la línea de visión o el avance tras combate; estos requieren otras verificaciones y pueden depender de cartas y líderes.

## Contratos y límites de confianza

Nuevo módulo `packages/ancients-rules/terrain-movement.mjs`:

```js
assessAncientsTerrainMovement({
  unitType: 'LIGHT_INFANTRY',
  origin: {col: 4, row: 4},
  path: [{col: 5, row: 4}],
  terrain: [{col: 5, row: 4, kind: 'FOREST'}]
})
```

- El mapa de terreno lo debe facilitar **exclusivamente el escenario confiable del servidor**. No se admite que el navegador aporte terrenos o modificadores de reglas.
- La función rechaza mapas corruptos (duplicados, coordenadas incorrectas o tipos que aún no se soportan) y unidades ajenas al juego básico; comprueba adyacencia y repetición de hexágonos.
- Las respuestas `CANDIDATE` y `BLOCKED` incluyen `needsFullLegalityCheck: true`. `CANDIDATE` **no** concede movimiento ni batalla.
- `battleOnEntry` indica solo si **el terreno** impide combatir después de entrar. `NOT_BARRED_BY_TERRAIN` no significa que la unidad pueda combatir: por ejemplo, los auxilia que se mueven dos hexágonos tampoco pueden combatir.
- El módulo de PR #54 `precheckAncientsMovementPath({units,leaders,unitId,path,terrain=[]})` incorpora la comprobación de terreno; añade `terrain` y `battleAfterMovement` al resultado de un candidato, donde `UNAVAILABLE` procede de la restricción de terreno **o** del perfil de unidad. `MANDATORY_CLOSE_COMBAT` solo señala una condición, sin resolver el combate.

**No se modifica** el motor sintético `transitionSyntheticMovement`, SQLite, el servidor HTTP, la interfaz SVG, sesiones, cartas ni partidas persistidas. El tablero visual de laboratorio seguirá con hexágonos ficticios hasta completar escenarios y autorización reglamentaria.

## Pruebas y evidencia real

Ejecutadas en Node.js **22.16.0** sobre Linux **sin WSL** dos suites nuevas, simultáneamente:

```sh
node --test --test-reporter=tap packages/ancients-rules/terrain-movement.test.mjs packages/ancients-rules/terrain-integration.test.mjs
```

**25/25 casos PASS, 0 fallos, 0 omitidos, exitCode 0**: 16 pruebas de terreno y 9 de integración con ocupación y perfiles. Se ha cotejado byte a byte el SHA de objeto Git de cada módulo y suite publicados con los ejecutados localmente:

| Archivo | SHA Git |
| --- | --- |
| `packages/hex-grid/hex.mjs` | `ae0e4526b8e91c4c0d5d94aebc52077b60f410da` |
| `packages/ancients-rules/movement-profile.mjs` | `2bef541f7da040f7eb1b2b8735fab4939ce1f966` |
| `packages/ancients-rules/terrain-movement.mjs` | `4e67f3b390dc6ba1f76536a2b34570416591e462` |
| `packages/ancients-rules/movement-path-precheck.mjs` | `c8f6cd35bf0d5f1c2f7a517f1507713b7196df56` |
| `packages/ancients-rules/terrain-movement.test.mjs` | `f0d3ff8f113c3c4e79eb8241e48a81e7b574e53a` |
| `packages/ancients-rules/terrain-integration.test.mjs` | `f5858aaf373bec13c7a7e63c66a74151e858572b` |

SHA-256 del registro TAP aislado `61efaad2e36f262d246561f7870c0da6a5b2d98f1407cab3f599bf153f308bad`. Se entrega como archivo de evidencia en la conversación. La rama amplía el manifiesto a **42 suites**, comprobadas estáticamente contra el árbol Git.

**Límite:** estas 25 pruebas nativas no sustituyen la ejecución completa de las 42 suites ni una partida reglamentaria. El usuario confirmó que la última repetición Windows de las pruebas de PR #55 terminó sin errores, pero en ese mensaje no adjuntó TAP con contadores, por lo que se mantiene pendiente la certificación formal de esa regresión. No solicitar más pruebas al usuario mientras esté en pausa.


### Reejecución adicional de regresiones anteriores

También se recuperó desde GitHub **la suite original de 19 casos** de `movement-path-precheck.test.mjs`, se comprobó su SHA Git `a5c253a3290ca29c2202d3b09c23e96ef3a61eb7` y se ejecutó **con las dos nuevas** y sus módulos exactos:

```sh
node --test --test-reporter=tap packages/ancients-rules/movement-path-precheck.test.mjs packages/ancients-rules/terrain-movement.test.mjs packages/ancients-rules/terrain-integration.test.mjs
```

Resultado total: **44/44 casos nativos correctos, 0 fallos, 0 omisiones, código 0** (19 antiguos + 16 de terreno + 9 combinados). SHA-256 del TAP de las tres suites: `07f59aaadb6a955568733c8daaa98b9b63281397216f51918653486d861458a4`. Esto demuestra ausencia de regresión en las **19 pruebas previas de rutas**; **no** valida las otras 39 suites del manifiesto de 42.

## Próximos pasos / condiciones de salida

1. Definir la estructura de terreno como parte del escenario oficial autorizado y persistido: sin recibir mapas desde el cliente.
2. Implementar reglas de movimiento de marismas, ríos y vados, así como combates/LOS de bosques, colinas y terreno accidentado, con pruebas reglamentarias.
3. Definir reglas de cartas especiales y órdenes, líderes, combate y avances para evitar interpretar `CANDIDATE` como autorización.
4. Ejecutar integralmente las **42 suites** en Node nativo/Windows, con pruebas HTTP/SSE de dos sesiones y revisión visual, antes de fusionar.
5. Mantener la cadena de PR #45 y siguientes en borrador: **no fusionar** ni desplegar.

**R-05 sigue incompleta.**
