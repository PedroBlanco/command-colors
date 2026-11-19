# CCW-015 — Plan de resolución posterior a los dados de disparo (*Ancients* básico)

**Fecha:** 11/11/2026. **Rama:** `feat/i4-ancients-ranged-resolution-sequence-plan`, dependiente de la PR #69. **Estado:** planificador y comprobaciones **exclusivamente preliminares**; no es una máquina de estados ejecutora ni está conectado a partidas reales.

## Base reglamentaria y límites

En *Command & Colors: Ancients*, tercera edición (2009), primero se contabilizan los impactos y después se tratan las banderas. Si una unidad con líder pierde bloques, debe comprobarse su posible baja después de retirar los bloques; solo cabe **una comprobación de ese líder por secuencia de combate**, aunque se pierdan más bloques durante la retirada.

- [Disparos, resultados y banderas](https://www.commandsandcolors.net/ancients/the-game/main/10-ranged-combat-fire.html).
- [Líderes: comprobación de bajas y evasión](https://www.commandsandcolors.net/ancients/the-game/main/faqs/leader.html).
- [Retiradas, apoyo y moral](https://www.commandsandcolors.net/ancients/the-game/main/12-retreat.html).

Casos importantes: si una unidad sobrevive tras sufrir uno o varios impactos con líder asociado, la comprobación exige **dos símbolos de casco en dos dados**. Si pierde el último bloque, se exige **un casco en un dado**, y el líder superviviente deberá intentar evadirse. Si el disparo solo provoca banderas y luego la unidad sufre pérdidas por no poder retirarse, podría corresponder esa comprobación después; nunca debe duplicarse por la misma secuencia.

El defensor **elige** si acepta banderas que podría ignorar gracias a líder, unidades de apoyo, terreno u otras reglas. No se presupone una cantidad automática de banderas ignorables: la comprobación de apoyos y rutas de retirada, los casos especiales (p. ej., elefantes), líderes, cartas, estandartes y victoria requieren un motor posterior.

## Checklist puro de resolución

`packages/ancients-rules/ranged-resolution-sequence.mjs` implementa `planBaseAncientsRangedResolution({blockLoss})`.

La función recibe el resultado de la **previsualización confiable de bloques** de la PR #69. Recalcula el resultado de `previewBaseAncientsRangedBlockLoss` y rechaza estados contradictorios. Para que pueda conservar la distinción entre líder asociado y no asociado **incluso sin impactos**, `block-loss-preview.mjs` expone ahora el booleano `leaderAttached` ya validado por el servidor.

El resultado es un objeto inmutable y **no ejecutado** con una secuencia ordenada de pasos:

1. `APPLY_DIRECT_HITS`, si hay impactos: solo propuesta de pérdida de bloques.
2. `LEADER_CASUALTY_CHECK`, si el líder asociado ha sufrido impactos directos; después de **aplicar legalmente** esos impactos.
3. `LEADER_EVADE_IF_SURVIVES`, si la unidad desaparecería por los impactos y el líder sobreviviese.
4. `DEFENDER_MORALE_CHOICE`, si quedan banderas pendientes: **sin calcular aún** cuántas se pueden ignorar y sin elegir por el defensor.
5. `RESOLVE_RETREAT_OR_BLOCK_LOSS`, tras la decisión del defensor y una futura comprobación de ruta; si un líder no había sufrido comprobación y la retirada provoca pérdida de bloques, se marca una comprobación condicional `LEADER_CHECK_IF_RETREAT_CAUSES_BLOCK_LOSS`.
6. `AUTHORITATIVE_FINALIZATION`, **siempre** como puerta bloqueada hasta completar legalidad y efectos.

Los pasos son **propuestas ordenadas**, no un historial de eventos. Incluyen `executed:false`, y el plan mantiene `attackAuthorized:false`, `combatResolved:false`, `boardMutated:false` y `bannerAwarded:false`. No se ejecutan tiradas ni se actualiza un estado de partida.

## Dados separados para comprobación del líder

`captureBaseAncientsLeaderCasualtyDice({rollId,actor,diceCount,mode,declaredFaces,randomIndex})` reutiliza las **seis caras oficiales** de `battle-dice.mjs` y el capturador genérico `dice-roller/dice.mjs`, pero asigna un **tipo distinto**:

`ANCIENTS_BASE_LEADER_CASUALTY_CAPTURED`, `purpose:'LEADER_CASUALTY_CHECK'`.

Solo admite **uno o dos dados**, y distingue `SERVER_GENERATED` para digitales de `PLAYER_DECLARED` para físicos. `randomIndex` está reservado a pruebas y no puede exponerse al navegador. `rollId`, actor, número de dados y procedencia deben obtenerse del futuro servicio autenticado: este módulo no los autoriza.

`previewBaseAncientsLeaderCasualtyCheck({checklist,roll})` valida un plan íntegro y su tirada, exige el tipo/purpose específico, cuenta cascos y devuelve un **resultado hipotético**: líder alcanzado o superviviente, posible evasión pendiente y siguiente paso propuesto. No retira un líder ni da por terminado el combate. Un dado del ataque original **no es válido** como tirada de comprobación del líder.

## Lectura SQLite integrada

El laboratorio aislado `packages/ancients-rules/sqlite-reservation-lab.mjs` incorpora `previewResolutionChecklist({matchId,sessionUserId,reservationId,expectedRevision})`.

Delegando en la lectura anterior `previewStagedBlockLoss`, exige:

- Sesión de participante confiable, autor de la reserva y revisión vigente.
- Tirada oficial preliminar persistida, con interpretación cotejada y **huella de tablero** válida.
- Objetivo real, `blocksRemaining` explícitos y líder derivado del tablero SQLite.

Solo devuelve `RANGED_RESOLUTION_CHECKLIST` y su plan. **No modifica `turn_json`, `board_json`, eventos ni claves de idempotencia.** Es una API interna de laboratorio, **no una ruta HTTP**. Los datos de `sessionUserId` deberán proceder de autenticación real antes de cualquier integración.

El fichero SQLite `CCRL` conserva **sus mismas tres tablas**, sin migración; el SQLite `CCWB` de partidas no se ha alterado.

## Verificación real y alcance pendiente

Comando nativo ejecutado (Node.js **22.16.0** sobre Linux, sin WSL ni Actions):

```sh
node --test --test-reporter=tap packages/ancients-rules/ranged-resolution-sequence.test.mjs
```

**32/32 pruebas PASS, 0 FAIL, 0 SKIP.** Cubren orden de pasos, líder asociado, eliminación y evasión, banderas sin impactos, una sola comprobación por secuencia, cascos 2/2 y 1/1, modalidades física/digital, doble uso del dado original rechazado, condiciones inválidas, planes alterados e inmutabilidad.

Hashes de los archivos nuevos/modificados que se contrastaron con los publicados en GitHub:

- `block-loss-preview.mjs`: `6811ed9915074494c73b2264e9f4a105a84bf8c1`
- `ranged-resolution-sequence.mjs`: `de5bf5b4ed575b3b1f35911745a48afaf08b8ca0`
- `ranged-resolution-sequence.test.mjs`: `34d55e7503b2deb1a4d2b040a088b0af883e048e`

La batería se ejecutó sobre las nuevas copias exactas del planificador y la previsualización de bloques y **copias locales equivalentes de sus dependencias** (reglas de unidades, capturador de dados e intérprete). No se ha reproducido todavía la prueba con todos los archivos de dependencia exactos de GitHub.

**Seis pruebas de integración** añadidas a `sqlite-block-loss-preview.test.mjs` están **preparadas, pero pendientes de ejecución nativa** con el repositorio completo. Comprueban fases, líderes, eliminación, banderas, control de actor/revisión y ausencia de mutaciones. El manifiesto general registra **57 suites**; las 57 **no** han sido ejecutadas conjuntamente, tampoco Windows, HTTP/SSE ni dos navegadores.

## Puertas antes de completar el combate

1. Desarrollar **aplicación autorizada** de impactos sobre unidades con estado de bloques persistido y eventos auditables, con rollback e idempotencia.
2. Registrar la comprobación real de líder **después** de aplicar impactos y reutilizar exactamente ese resultado, también si posteriormente se pierde algún bloque durante la retirada.
3. Implementar moral, apoyos, terreno y decisiones del defensor, calcular rutas de retirada y sus pérdidas, así como la evasión del líder; verificar reglas especiales.
4. No otorgar estandartes ni finalizar partidas hasta confirmar legalmente todas las pérdidas y decisiones.
5. Regresión de **57 suites**, prueba nativa de Windows, privacidad de ambos jugadores y pruebas de concurrencia multiproceso.

**Resultado:** orden reglamentario explícito y dados de comprobación de líder separados, enlazados a una lectura SQLite de solo consulta, sin aplicar todavía los efectos de una batalla.
