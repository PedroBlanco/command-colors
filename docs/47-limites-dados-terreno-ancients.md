# CCW-014 — Límites ordinarios de dados por terreno (*Ancients*, juego básico)

**Fecha:** 10 de noviembre de 2026. **Estado:** experimento apilado sobre la rama de terreno de la PR #57 (y su dependencia #55). R-06/R-07 **no están implementadas**. Esta pieza no se integra con partidas.

## Alcance y fuentes

Se reutiliza `BASE_TERRAIN_TYPES` de `terrain-movement.mjs` (PR #57); no se duplica la evaluación de movimiento, bosque o terreno accidentado. Se aplican los efectos básicos de **bosque, colina y terreno accidentado** sobre *límites máximos ordinarios* de dados.

Fuentes para contrastar: [Ancients, 16. TERRAIN](https://www.commandsandcolors.net/ancients/the-game/main/16-terrain.html), [08. MOVEMENT](https://www.commandsandcolors.net/ancients/the-game/main/08-movement.html), basadas en el juego básico de tercera edición de GMT Games (2009).

Nuevo módulo `packages/ancients-rules/terrain-dice-cap.mjs`:

```js
assessAncientsTerrainDiceCap({
  attackerType: 'HEAVY_INFANTRY',
  attackerTerrain: 'HILL',
  targetTerrain: 'CLEAR',
  attackKind: 'CLOSE'
});
// {maxDice: 3, needsFullLegalityCheck: true,
//  lineOfSightChecked: false, cardModifiersApplied: false}
```

Los tipos de terreno válidos son `CLEAR`, `FOREST`, `HILL`, `BROKEN_GROUND`. Se rechaza cualquier valor de terreno no admitido, unidad de expansión desconocida o tipo de ataque distinto de `CLOSE`/`RANGED`.

| Situación | Límite ordinario por terreno |
| --- | ---: |
| Cuerpo a cuerpo hacia o desde bosque o terreno accidentado | 2 |
| Ataque a distancia contra un objetivo en bosque | 1 |
| Cuerpo a cuerpo cuesta arriba, contra unidad sobre colina desde nivel bajo | 2 |
| Cuerpo a cuerpo cuesta abajo, o desde colina hacia otra colina: unidad a pie | 3 |
| Igual al anterior: unidad montada (caballería, elefante, carro pesado) | 2 |
| Sin límite añadido por estos terrenos | `null` |

Si se cruzan restricciones (por ejemplo, bosque frente a colina), se muestra el máximo ordinario **más estricto**. `null` **no significa** dados ilimitados ni autorización de ataque: sólo que el terreno contemplado no impone un máximo.

**Invariantes:** todos los resultados son inmutables e incluyen `needsFullLegalityCheck: true`, `lineOfSightChecked: false` y `cardModifiersApplied: false`. No se calcula la cantidad final de dados, elegibilidad de ataque, resultados, alcance, visibilidad, cartas, líderes, terreno de escenario adicional, secuencias de combate ni efectos de cartas que pueden alterar el máximo. **El servidor sigue siendo responsable de decidir cada combate.**

**No se altera** `terrain-movement.mjs`, `movement-path-precheck.mjs`, SQLite, las sesiones, las reglas sintéticas ni la interfaz. El objetivo es completar una pieza nueva sin duplicar la precomprobación de la PR #57.

## Pruebas nativas

```sh
node --test --test-reporter=tap packages/ancients-rules/terrain-dice-cap.test.mjs
```

- Node.js **v22.16.0**, contenedor Linux no WSL, sin GitHub Actions: **10/10 PASS; 0 FAIL, 0 SKIP**.
- Código y pruebas ejecutados con SHA de contenido Git idénticos a los publicados:
  - `terrain-dice-cap.mjs`: `90be168b01e37950691354be393923c9d5bbef05`.
  - `terrain-dice-cap.test.mjs`: `c2805b00f5e985bd1312fc75dc4b4dcd8be67ff1`.
  - Dependencias: `movement-profile.mjs` = `2bef541f7da040f7eb1b2b8735fab4939ce1f966`; `terrain-movement.mjs` = `4e67f3b390dc6ba1f76536a2b34570416591e462`; `hex.mjs` = `ae0e4526b8e91c4c0d5d94aebc52077b60f410da`.
- SHA-256 del TAP: `902016e7ddde226914ca5b943c74f838fca338596bf668212e2721a0dda6edd8`. Artefacto entregado en la conversación.
- Manifiesto de rama: **43 suites**; las 10 pruebas no acreditan la batería integral.

## Puerta de integración

1. Validar la batería completa de 43 suites y confirmar SQLite/HTTP/SSE/privacidad de los dos jugadores.
2. Implementar y probar línea de visión para bosques, colinas, mesetas y disparos.
3. Incorporar orden y tipo de combate, cartas, líderes, retiradas, excepciones de escenario, y resolver límites de dados en el servidor.
4. No fusionar la cadena pendiente ni desplegar hasta superar las pruebas de seguridad y reglas.

**Esta pieza solamente propone un máximo ordinario por terreno; no autoriza ni ejecuta ningún combate.**
