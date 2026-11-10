# CCW-015 — Proyección de pérdidas de bloques tras disparos de Ancients

**Fecha:** 10/11/2026. **Rama:** `feat/i4-ancients-ranged-block-loss-preview`, dependiente de PR #67. **Estado:** cálculo puro, sin persistencia ni autorización de combate. Reglas R-06/R-09/R-13 **parcialmente cribadas**, no implementadas en el juego.

## Fundamento y alcance

Fuentes del básico de *Command & Colors: Ancients*, 3.ª edición (2009):

- [GMT Games — reglas de 2009](https://www.gmtgames.com/living_rules/CC_Rules_2009.pdf): composición de unidades, impactos por combate a distancia, bajas de líderes y retiradas.
- [Composición del juego básico](https://www.commandsandcolors.net/ancients/the-game/main/02-contents-base-game.html).
- [Disparos — resultados y retirada](https://www.commandsandcolors.net/ancients/the-game/main/10-ranged-combat-fire.html).
- [Comprobaciones de bajas de líderes](https://www.commandsandcolors.net/ancients/the-game/main/14-leaders.html) y [FAQ de líderes](https://www.commandsandcolors.net/ancients/the-game/main/faqs/leader.html).

El módulo `packages/ancients-rules/block-loss-preview.mjs` define los bloques iniciales **de las 13 clases ya soportadas por el básico en el motor**:

| Unidad básica | Máximo inicial |
| --- | ---: |
| Infantería ligera, honda, arco, auxilia, guerreros, media, pesada | 4 |
| Máquina de guerra pesada | 2 |
| Caballería ligera, media y pesada | 3 |
| Elefante | 2 |
| Carro pesado | 2 |

No admite automáticamente tipos de expansión, líderes solos ni unidades inventadas. El máximo **sirve exclusivamente para validar**, no para deducir los bloques que quedan en un turno. **Los bloques restantes son un dato obligatorio del estado fiable del servidor**.

## Contrato puro

`previewBaseAncientsRangedBlockLoss({unitType,blocksRemaining,diceCount,matchingColorHits,flagsPending,leaderAttached})`

Todos los parámetros tienen que proceder de datos validados y persistidos en el futuro servidor, **nunca del contenido de una solicitud HTTP**. En particular, `matchingColorHits` y `flagsPending` deben obtenerse de la interpretación de seis caras que ofrece `battle-dice.mjs` en PR #66; `leaderAttached` deberá derivarse de la posición real del líder en el tablero. **Este incremento todavía no conecta automáticamente esas fuentes al cálculo.**

El módulo:

1. Valida que el tipo está soportado y que `blocksRemaining` es un entero entre 1 y el máximo inicial. Rechaza valores faltantes: no presupone una unidad completa.
2. Comprueba que la cantidad de dados y los contadores de impactos y banderas son enteros, no negativos y coherentes entre sí.
3. Calcula `blocksToRemove = min(blocksRemaining,matchingColorHits)` y `excessHits`; los impactos sobrantes se descartan sin crear bajas adicionales.
4. Calcula `remainingBlocks`. Cuando es cero, marca `unitWouldBeEliminated` y **solo propone** `possibleVictoryBanner:1`, sin otorgar aún el estandarte.
5. Conserva `effectiveFlagsPending` si la unidad sobrevive; cuando desaparece por los impactos directos, las banderas que la afectaban ya no pueden producir una retirada de esa unidad.
6. Si un líder estaba unido a una unidad que perdió bloques, propone una comprobación pendiente de líder: **dos dados con dos cascos** para unidad superviviente; **un dado con un casco** para unidad eliminada, con posible evasión posterior. No hace esa tirada y evita introducir una segunda comprobación por las banderas todavía pendientes.

Todos los resultados son objetos congelados; `hitsApplied:false`, `leaderChecksResolved:false`, `flagsResolved:false`, `bannerAwarded:false`, `boardMutated:false`, `combatResolved:false` y `attackAuthorized:false` son explícitos.

**No** se tratan bonificaciones de cartas, inmunidades o excepciones, efectos de moral y apoyo, verificación del dado físico, retirada bloqueada, evasión, comprobación de líder con dados, estandartes de victoria contabilizados ni efectos en el tablero. Los efectos derivados de las banderas podrán causar pérdidas posteriores, que requieren su propia fase y la regla de una sola comprobación de líder por secuencia.

## Pruebas verificadas

Con **Node.js 22.16.0 en Linux nativo**, sin WSL ni Actions, se ejecutó la suite:

```sh
node --test --test-reporter=tap packages/ancients-rules/block-loss-preview.test.mjs
```

**24/24 PASS, 0 FAIL, 0 SKIP.** Incluye cobertura de los 13 tipos, conteo de bloques, daños parciales, exceso de impactos, eliminación, bandera posible sin asignación, banderas pendientes, líderes vivos/eliminados, entradas incompletas, validación de recuentos, inmutabilidad y la prohibición de modificar el estado.

Se cotejó el hash Git de los **bytes exactos** de los archivos ensayados y publicados:

- `block-loss-preview.mjs`: `862c3018eaff800c9a2253cdac31f74f35e9f97e`.
- `block-loss-preview.test.mjs`: `c68260cc4d313f0d36b9f6bcb44229381ad26cff`.

El manifiesto general registra **55 suites**. **No se ha ejecutado la regresión integral de 55 suites ni este nuevo módulo junto a la cadena completa de pruebas anterior**, que sumaba 89 casos ejecutados en su propia iteración. Tampoco se ha verificado Windows, HTTP/SSE, sesiones de dos jugadores o concurrencia multiproceso.

## Próxima integración

1. Definir de forma explícita y versionada `blocksRemaining` en el tablero oficial persistido, sin inventarlo al abrir partidas sintéticas o incompletas.
2. Unir `battle-dice.mjs`, `dice-plan.mjs` y este cálculo en una operación interna que lea **la misma revisión SQLite**, incluido tipo, bloques, líder y tirada persistida. Rechazar cambios concurrentes.
3. Incorporar pasos separados para comprobación y posible evasión de líder, banderas, apoyos y retiradas antes de confirmar pérdidas o estandartes en la transacción.
4. Auditar eventos públicos y proyecciones privadas; **no** incorporar el módulo directamente como comando de cliente.
5. Regresión local general y Windows nativo antes de fusionar ninguna PR dependiente.

**Resultado:** regla de pérdidas de bloques como **previsualización validada y comprobable**, no como combate aplicado o resuelto.
