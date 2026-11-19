# CCW-014 — Precomprobación de rutas ordinarias en *Ancients* (R-05 parcial)

**Fecha:** 10 de noviembre de 2026. **Rama:** `feat/i4-ancients-standard-path-precheck`, dependiente de PR #53 y de su cadena de PR #45–#52. **Estado:** experimental, no fusionar ni desplegar.

## Fuentes y decisiones

Se utiliza el movimiento ordinario del juego básico de *Command & Colors: Ancients* de la tercera edición (2009), respetando los límites por unidad introducidos en PR #53. El apartado de movimiento dispone que:

- Los hexágonos se recorren de manera consecutiva, sin salir del tablero de 13 × 9; no se salta un obstáculo con un desplazamiento de dos o más hexágonos de una sola vez.
- En circunstancias ordinarias, una unidad no entra en un hexágono con otra unidad, ni lo atraviesa. **Existen excepciones por cartas específicas de tropas ligeras**, que no se aplican en este módulo.
- Una unidad puede acabar su avance en un hexágono con un **líder propio solo**, pero debe detenerse allí y su posible unión requiere resolver las reglas de líderes; no puede entrar donde haya un líder enemigo solo.
- Un guerrero que avanza dos hexágonos debe acabar junto a un enemigo y tiene obligación de combatir cuerpo a cuerpo; esto no sustituye la comprobación de elegibilidad ni la resolución del combate.

Fuentes: [GMT, reglas oficiales de *Ancients* (tercera edición, 2009)](https://www.gmtgames.com/living_rules/CC_Rules_2009.pdf) y [transcripción de las reglas de movimiento](https://www.commandsandcolors.net/ancients/the-game/main/08-movement.html).

## Contrato

`packages/ancients-rules/movement-path-precheck.mjs` exporta:

```js
precheckAncientsMovementPath({
  units: [{id, side, type, col, row}],
  leaders: [{id, side, col, row}],
  unitId,
  path: [{col, row}] // sin incluir el origen
})
```

La entrada **debe proceder del estado confiable del servidor**. La función no gestiona sesiones ni autoriza un usuario a controlar una unidad. Rechaza como error la geometría o el estado estructural inválido (identificadores repetidos, dos unidades en el mismo hexágono, líderes en conflicto con unidades enemigas, coordenadas fuera de rango, tipos de expansión y caminos ausentes o mal formados).

Resultados posibles:

| Estado | Significado |
| --- | --- |
| `BLOCKED` | Incompatible con la precomprobación ordinaria: paso no adyacente, hexágono repetido u ocupado, líder enemigo, continuación tras alcanzar líder propio, dos líderes coincidentes o carga de guerrero sin objetivo adyacente |
| `REQUIRES_RULE_EXCEPTION` | Excede el perfil ordinario: una carta o regla especial podría cambiar el máximo, pero **este módulo nunca concede esa excepción** |
| `CANDIDATE` | El recorrido supera **solo** los controles de geometría, ocupación y distancia estándar; **no significa que sea legal** |

Los resultados señalan `needsFullLegalityCheck: true` en **todos los casos**. Para candidatos, `requiresLeaderResolution` advierte que hay un líder propio en origen o destino y `requiresMandatoryCloseCombat` advierte de la carga de un guerrero con dos pasos. El campo `profile` recoge la precomprobación de PR #53.

**No se modifica** `transitionSyntheticMovement`, `hex-selection`, el motor de fases, SQLite, la API ni la interfaz. El motor autoritativo aún debe comprobar fase, órdenes, unidad ya movida, terreno, cartas especiales, líder asociado, retirada, escenario y combate.

No se incluyen contenidos gráficos, despliegues, textos de cartas ni material de escenarios.

## Pruebas

```sh
node --test --test-reporter=tap packages/ancients-rules/movement-path-precheck.test.mjs
```

- Node.js **22.16.0** ejecutado en contenedor Linux **no WSL**, sin Actions.
- **19/19 PASS, 0 FAIL, 0 SKIP** (geometría, límites, bloqueos por aliados y enemigos, líderes solos y asociados, carga de guerreros, auxilia, máquinas de guerra, rechazo de datos corruptos y excepciones sin conceder).
- **Verificados SHA de objeto Git** idénticos en el repositorio y en el directorio de pruebas:
  - `movement-path-precheck.mjs`: `968e5466baf63e0a2f45f0ecc0517cc8c0189975`.
  - `movement-path-precheck.test.mjs`: `a5c253a3290ca29c2202d3b09c23e96ef3a61eb7`.
  - Dependencias ya publicadas y contrastadas: `hex.mjs` = `ae0e4526b8e91c4c0d5d94aebc52077b60f410da`; `movement-profile.mjs` = `2bef541f7da040f7eb1b2b8735fab4939ce1f966`.
- El registro TAP es un artefacto de la conversación, no está incorporado al repositorio. SHA-256: `82bc86349cf30bdc989fd42acd18cd7453895ecd9afb6404e8f0c8644c633e5c`.
- Manifiesto de esta rama actualizado a **40 suites**; la ejecución de la suite nueva **no certifica** la regresión conjunta de las 40.

## Bloqueos antes de integrar en partidas

1. Regresión completa de 40 suites, incluidos SQLite, sesiones reales HTTP/SSE y pruebas de permisos de ambos jugadores.
2. Modelar terreno y restricciones de entrada/salida, así como las excepciones de cartas y reglas de escenario con referencias y pruebas.
3. Resolver explícitamente líderes que se incorporan, acompañan o se separan, además de la obligación de combate de los guerreros.
4. Implementar una única función autoritativa que combine todos los validadores sin inferir legalidad de `CANDIDATE`.
5. Aceptación visual del tablero en PC/móvil y consolidación de PR #27/#50.

**R-05 permanece abierta y no debe declararse implementada.**
