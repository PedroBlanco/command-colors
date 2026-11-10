# CCW-014 · Precomprobación de línea de visión en Ancients (R-06 parcial)

**Fecha:** 10/11/2026. **Rama:** `feat/i4-ancients-los-terrain-precheck` (apilada sobre PR #59, dependiente de #57 y #55). **Estado:** borrador sin integración en partidas. Edición usada como referencia: *Command & Colors: Ancients*, juego básico, tercera edición, 2009.

## Fuentes y decisiones de alcance

Referencias públicas para revisar las reglas sin incorporar textos ni activos protegidos:
- [10. Ranged Combat (Fire) — Commands and Colors](https://www.commandsandcolors.net/ancients/the-game/main/10-ranged-combat-fire.html), en particular geometría LOS y regla de ambos lados de una arista.
- [16. Terrain — Commands and Colors](https://www.commandsandcolors.net/ancients/the-game/main/16-terrain.html): bosque, colina y terreno accidentado.
- [Hill — Commands and Colors](https://www.commandsandcolors.net/ancients/the-game/main/terrains/hill.html): bloqueo y visibilidad dentro de una misma meseta.

El módulo `packages/ancients-rules/line-of-sight.mjs` analiza segmentos de centro a centro, intersectando hexágonos convexos en el tablero `odd-q` 13×9. No se limita a redondear un único recorrido de hexágonos (lo que perdería los casos sobre aristas).

| Elemento entre origen y destino | Criba implementada |
| --- | --- |
| Unidad o líder, de cualquier bando | Bloquea la LOS si el segmento atraviesa su hexágono |
| `FOREST` | Bloquea la LOS |
| `BROKEN_GROUND` | No bloquea por sí mismo |
| `HILL` | Bloquea, excepto en una traza continua de colinas conectadas entre origen y destino, considerados misma meseta |
| Línea exactamente sobre arista | Una sola obstrucción lateral no bloquea; dos obstrucciones enfrentadas en el mismo tramo bloquean |
| Terreno en hexágono de salida o destino | No cuenta como obstáculo intermedio |
| Tipos de terreno aún no implementados | Se rechazan explícitamente; no se asumen transparentes |

La excepción de meseta comprueba continuidad sobre el segmento y vecindad entre colinas: un hueco sin colina en medio anula la excepción. Los casos límite de mesetas, esquinas y elevaciones se someterán a una validación visual y de reglamento antes de autorizar un ataque real. El motor no usa ningún recurso gráfico o escenario oficial.

## Contrato y seguridad

```js
assessAncientsLineOfSight({
  from: {col: 2, row: 4},
  to: {col: 6, row: 4},
  units: [{col: 4, row: 4}],
  leaders: [],
  terrain: [{col: 3, row: 4, kind: 'FOREST'}]
});
// {status:'BLOCKED', reason:'INTERVENING_OBSTRUCTION',
//  obstructions:[{col:4,row:4}] o el primer obstáculo geométrico encontrado,
//  needsFullLegalityCheck:true, attackAuthorized:false, ...}
```

- Las posiciones, unidades, líderes y terrenos **deben derivarse de un tablero confiable del servidor**, no de peticiones HTTP aportadas por el cliente. Este módulo no está conectado a API, SQLite ni vista de usuario.
- Rechaza extremos iguales, coordenadas inválidas, duplicados dentro de una clase, objetos de terreno desconocidos y más de 117 entradas por clase. Se permite que un líder y una unidad ocupen la misma casilla.
- No modifica datos de entrada; su respuesta y la lista de obstrucciones son inmutables.
- `VISIBLE` **no significa** que la unidad tenga arma de proyectiles, alcance, orden, fase válida ni que pueda declarar un combate. El campo `attackAuthorized` es **siempre falso**.
- Faltan terreno adicional, alcance por unidad, adyacencia enemiga, cartas, modificadores de dados, líderes en combate, decisiones del defensor y autorización/persistencia de combates.

## Validación efectivamente realizada

Se ejecutó una **suite aislada**, sin GitHub Actions y sin WSL, con Node.js **v22.16.0** en Linux:

```sh
node --test --test-reporter=tap packages/ancients-rules/line-of-sight.test.mjs
```

Resultado: **14/14 pruebas correctas, 0 fallos, 0 omitidas, exitCode 0**. Incluye línea libre, unidades/líderes, bosque, terreno accidentado, visibilidad de colinas, continuidad y huecos de meseta, simetría, aristas compartidas, mezcla de obstáculos y entradas inválidas. Se pasó además una comprobación local de **1100 pares pseudoaleatorios** con mapa aleatorio para verificar simetría de resultados, sin fallos; es una comprobación auxiliar, no suite registrada.

Identidad Git de los archivos publicados y probados:
- `line-of-sight.mjs`: `0f1b129365bba9b2dfcfafb83fa98ffc9ecf7b1f`.
- `line-of-sight.test.mjs`: `06a05614e8fcd27d7770312df6d5368aae83231b`.

SHA-256 del TAP aislado: `727226ce995e539e842f59ac0fbd19346bb426f6ae18976f2b2d950f68c13f02`.

`scripts/check-browser-lab.mjs` registra ahora **44 suites**; este aumento se verificará en la regresión global. **No se han ejecutado las 44 suites completas** ni las pruebas HTTP/SSE, SQLite y navegador con dos usuarios en esta rama.

## Puerta de integración

1. Revisar el algoritmo contra ejemplos del reglamento y casos visuales (especialmente mesetas y aristas).
2. Ejecutar regresión nativa completa de 44 suites y revalidar SQLite/HTTP/SSE y privacidad de dos jugadores.
3. Conectar escenarios reales con procedencia de datos verificada, para que el servidor decida terreno y obstáculos. Completar armas, alcance, fase y excepciones antes de usar `VISIBLE` para habilitar disparos.
4. No integrar las PR #45 y posteriores ni desplegar hasta completar el control de seguridad y las pruebas de aceptación.

**R-06 y R-07 siguen pendientes; se trata únicamente de una criba independiente y experimental.**
