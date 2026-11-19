# CCW-015 · Dados del juego básico de Ancients: captura e interpretación de disparos

**Fecha:** 10/11/2026. **Rama:** `feat/i4-ancients-official-ranged-dice-interpreter` (basada en PR #65). **Reglamento:** *Command & Colors: Ancients*, juego básico, tercera edición (2009). **Estado:** reglas parciales y puras, todavía no integradas con la persistencia de dados de PR #65, el servidor HTTP ni combates reales.

## Fuentes normativas

- [GMT Games, Rules 2009 (PDF)](https://www.gmtgames.com/living_rules/CC_Rules_2009.pdf), secciones 2 (caras y clasificación de unidades), 9 y 10 (batallas y disparos).
- [Commands and Colors System — 02. Contents (Base Game)](https://www.commandsandcolors.net/ancients/the-game/main/02-contents-base-game.html), composición del dado y símbolos de las unidades.
- [Commands and Colors System — 10. Ranged Combat (Fire)](https://www.commandsandcolors.net/ancients/the-game/main/10-ranged-combat-fire.html), efectos de los dados de disparo.
- [Commands and Colors System — 14. Leaders](https://www.commandsandcolors.net/ancients/the-game/main/14-leaders.html), caso especial de un líder sin unidad.

Las fuentes anteriores sirven para fundamentar este incremento; **los casos especiales, cartas y erratas adoptadas deberán revisarse antes de dar por completas las reglas**. Este desarrollo no reproduce textos extensos, mapas ni ilustraciones del juego.

## Caras oficiales y símbolos de las unidades

`packages/ancients-rules/battle-dice.mjs` define el dado de seis caras, con igual probabilidad para cada posición:

| Símbolo interno | Cara física | Efecto ordinario al disparar contra una unidad |
| --- | --- | --- |
| `LIGHT` | Círculo verde | Impacto si el símbolo de la unidad objetivo es verde |
| `MEDIUM` | Triángulo azul | Impacto si el símbolo de la unidad objetivo es azul |
| `HEAVY` | Cuadrado rojo | Impacto si el símbolo de la unidad objetivo es rojo |
| `LEADER` | Casco | No causa impacto contra una unidad en combate a distancia |
| `FLAG` | Bandera | Marca una bandera pendiente de comprobar moral y retirada |
| `SWORDS` | Espadas cruzadas | No causa impacto en combate a distancia |

La aplicación clasifica los **13 tipos de unidad del básico admitidos en `BASE_MOVEMENT_PROFILES`**. El borde blanco del distintivo no altera el color de impacto: `AUXILIA_INFANTRY` es verde y `WARRIOR_INFANTRY` es azul. `ELEPHANT`, `HEAVY_CHARIOT` y `HEAVY_WAR_MACHINE` son rojos. No se inventan las unidades de expansiones.

## Contratos puros

**`captureBaseAncientsRangedDice({rollId,actor,diceCount,mode,declaredFaces,randomIndex})`:**

- El dado **siempre** tiene exactamente las seis caras oficiales, sin permitir caras configurables desde la solicitud. Los parámetros `actor`, `rollId` y `diceCount` deben proceder del servidor después de validar una declaración y determinar dados.
- `DIGITAL`: utiliza el generador criptográfico de `packages/dice-roller/dice.mjs`; una función `randomIndex` solo puede inyectarse desde pruebas. No se aceptan caras declaradas por el navegador para esta modalidad.
- `PHYSICAL`: valida exactamente el número de caras declaradas, las registra y marca `PLAYER_DECLARED` (no comprobadas independientemente).
- Devuelve `ANCIENTS_BASE_RANGED_DICE_CAPTURED` con resultados y procedencia inmutables. Conserva `attackAuthorized:false` y `combatResolved:false`; **no genera ningún evento persistente por sí sola**.

**`interpretBaseAncientsRangedDice({roll,targetUnitType,expectedDiceCount})`:**

- Rechaza clases no soportadas, dados con cantidades distintas de la cantidad esperada por el servidor, símbolos no reconocidos, metadatos inconsistentes y tiradas sintéticas de la PR #65.
- Identifica por dado `MATCHING_COLOR_HIT`, `FLAG_PENDING` o `NO_RANGED_EFFECT`, y devuelve `matchingColorHits`, `flagsPending` y `misses` de forma separada.
- **No resta bloques, no calcula banderas ignoradas, no ejecuta retiradas ni revisiones de bajas de líder**, no mueve el tablero y no finaliza ni autoriza un combate.
- Los símbolos `LEADER` y `SWORDS` se consideran sin efecto **solo en disparo ordinario contra unidades**. El ataque contra un líder que está solo en una casilla es un caso especial y **queda expresamente fuera** del contrato; el cuerpo a cuerpo también tiene reglas diferentes.
- Interpretar una tirada exige **confiar en que fue capturada/autorizada por el servidor**. Los objetos JSON suministrados por el cliente no demuestran por sí solos un lanzamiento real, y esta API pura no sustituye la idempotencia/SQLite.

## Ejemplo no persistente

```js
import {captureBaseAncientsRangedDice, interpretBaseAncientsRangedDice}
  from './packages/ancients-rules/battle-dice.mjs';

// Solo válido si actor y diceCount provienen de una operación autorizada:
const roll = captureBaseAncientsRangedDice({
  rollId:'roll_example_1', actor:'A', diceCount:2,
  mode:'PHYSICAL', declaredFaces:['MEDIUM','FLAG']
});
const interpretation = interpretBaseAncientsRangedDice({
  roll, targetUnitType:'WARRIOR_INFANTRY', expectedDiceCount:2
});
// matchingColorHits=1, flagsPending=1
// NO se han aplicado bajas ni retiradas.
```

## Verificaciones

Pruebas nativas realizadas con **Node.js 22.16.0, Linux sin WSL**, reutilizando los módulos oficiales existentes de movimiento y dados:

```sh
node --test --test-reporter=tap \
  packages/ancients-rules/battle-dice.test.mjs \
  packages/ancients-rules/sqlite-reservation-lab.test.mjs \
  packages/ancients-rules/sqlite-guarded-reservation.test.mjs \
  packages/ancients-rules/sqlite-dice-staging.test.mjs
```

**63/63 PASS; 0 FAIL; 0 SKIP** (**16 pruebas nuevas**, más las **47** de reservas/registro previas). Tres repeticiones adicionales de esa batería sin fallos. Los archivos nuevos ejecutados coinciden exactamente con los blobs Git publicados:

- `battle-dice.mjs`: `a2b3e83c6f262d442fdf824d3d49d14e031da772`.
- `battle-dice.test.mjs`: `445582887b9178dbb3344709a419dcb39966bc20`.

SHA-256 del TAP conjunto local: `eed4a42e9a49ffd2c101253bff14249fb1c294adcf0607539f3e3f6f67f96096`.

Las nuevas pruebas cubren: composición del dado; correspondencia con 13 tipos de unidades; colores con y sin borde blanco; banderas pendientes; cascos y espadas sin impacto a distancia; acumulación de coincidencias sin mutación; dados digitales reproducibles con RNG inyectado y criptográficos reales; declaración física etiquetada; entradas ilegales; tipos/rolls sintéticos prohibidos e inmutabilidad de resultados.

El manifiesto de `scripts/check-browser-lab.mjs` añade la **suite 52**. El conjunto completo de 52 suites **no** se ha ejecutado todavía; las pruebas Windows, HTTP/SSE y el navegador de dos personas continúan pendientes.

## Siguientes pasos

1. Separar de forma versionada el plan de dados oficiales del plan `RED/BLUE/FLAG/RED` **sintético** de la PR #65. Este incremento **no cambia** todavía el laboratorio de reservas ni migra sus resultados históricos.
2. Conectar la interpretación a un resultado persistido con revisión/idempotencia y a la secuencia de combate, sin aceptar órdenes o tiradas no autorizadas del cliente.
3. Implementar bajas con límite de bloques, comprobación de líderes, banderas ignoradas por apoyo/líderes y retirada antes de declarar resuelta la batalla.
4. Añadir reglas especiales y escenarios, cuerpo a cuerpo, líder aislado, tiradas físicas acordadas entre jugadores y política de deshacer.
5. Ejecutar las 52 suites, verificar Windows nativo y completar pruebas de privacidad con dos sesiones antes de fusionar o desplegar.

**Resultado:** intérprete oficial **parcial** de disparos, aislado del laboratorio de dados inventados y sin aplicación de efectos al tablero. R-06/R-13 no se consideran terminadas.
