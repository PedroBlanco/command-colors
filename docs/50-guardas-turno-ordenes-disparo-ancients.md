# CCW-014 · Guardas de turno/órdenes para ataque a distancia de Ancients (R-04/R-06 parciales)

**Fecha:** 10/11/2026. **Rama:** `feat/i4-ancients-ranged-turn-guard`, basada en PR #62. **Edición de referencia:** *Command & Colors: Ancients* (juego básico, 3.ª edición, 2009). **Estado:** propuesta experimental; sin integración con SQLite, API ni partidas oficiales.

## Fundamento y límites

Fuentes para revisión posterior con el ejemplar y erratas de referencia:

- [GMT Games: reglas de 2009](https://www.gmtgames.com/living_rules/CC_Rules_2009.pdf), sección 9: una unidad ordenada combate, en condiciones ordinarias, una sola vez por turno y resuelve su batalla completamente antes de empezar otra.
- [Commands and Colors: 09. Battle](https://www.commandsandcolors.net/ancients/the-game/main/09-battle.html): excepción para bonus Close Combat tras Momentum Advance.
- [Commands and Colors: 10. Ranged Combat](https://www.commandsandcolors.net/ancients/the-game/main/10-ranged-combat-fire.html): anunciar y resolver un ataque a distancia por unidad.

Estas comprobaciones **no interpretan los efectos de las cartas** ni autorizan movimiento, batalla o excepciones de escenario. Por seguridad se bloquean las situaciones no modeladas. La excepción de combate adicional tras avance no se implementa aquí: el guard se usa solo para la declaración inicial de disparo ordinario.

## Contratos nuevos

**1. `screenAncientsCombatTurn({turnState,sessionSide,attackerId,targetId,expectedRevision})`**

Comprueba en modo solo lectura:

1. Contexto de turno específico `ruleset='ancients-base-3e-2009'` y esquema v1, distinto del motor `synthetic-phases-v1`.
2. Coincidencia de revisión, partida activa, jugador autenticado y fase `COMBAT`.
3. Ningún combate ni decisión defensiva en curso.
4. Unidad atacante incluida entre las unidades ordenadas, y no incluida entre unidades que ya resolvieron una batalla (a distancia o cuerpo a cuerpo) en el turno.
5. Registro explícito de pasos recorridos por la unidad, procedente del servidor. **No se presupone cero pasos** si falta ese registro.

Las listas de identidades son únicas y válidas, las bajas de unidades no se infieren, y los datos contradictorios se rechazan. No se acepta un `turnState` sintético como sustituto del estado reglamentario.

**2. `precheckAncientsRangedDeclaration({turnState,board,sessionSide,attackerId,targetId,expectedRevision})`**

Combina el guard anterior con la PR #62: confirma que el atacante pertenece al jugador autenticado, y solo entonces evalúa alcance, movimiento, adyacencias, LOS y los límites ordinarios de dados por terreno. Los parámetros `board`, `turnState` y `sessionSide` proceden **exclusivamente** de un estado y sesión controlados por el servidor. La declaración del cliente solo podría aportar IDs de atacante/objetivo y revisión esperada.

Ejemplo exclusivamente de prueba:

```js
const turnState = {
  schemaVersion:1, ruleset:'ancients-base-3e-2009',
  status:'ACTIVE', turn:'A', phase:'COMBAT', revision:12,
  orderedUnitIds:['a1'], resolvedBattleUnitIds:[],
  movedStepsByUnit:{a1:0},
  pendingCombat:null, pendingDecision:null
};
```

Este objeto es un **contrato de implementación futura**, no una proyección extraída ya del SQLite existente. Un integrador deberá generar el contexto completo dentro de una única transacción y vincularlo al tablero y a la sesión autenticada.

### Estado de salida

- `BLOCKED`: alguna condición ordinaria impide continuar.
- `CANDIDATE`: la criba ha pasado, pero no se autoriza ni persiste el ataque.
- En todas las salidas: `attackAuthorized:false`, `needsFullLegalityCheck:true` y `commandCardValidated:false`; en la composición también `combatRecorded:false`.
- Sin devolución de `nextState`, eventos, resultados de dados, cambios de tablero, cartas ni efectos de escenario.
- **No exponer las estructuras internas devueltas a clientes**. Las respuestas externas requerirán proyecciones que no filtren identidades ni obstáculos ocultos.

## Verificación realizada y reproducibilidad

Los dos archivos nuevos de pruebas contienen **31 casos** (15 para guardas de turno, 16 para integración de disparo). Se ejecutaron **31/31 sin fallos** cargando el **contenido exacto publicado en GitHub**, junto con las dependencias, en un arnés JavaScript aislado sobre V8. Ese arnés usa un adaptador simple de aserciones para comprobar las funciones exportadas: **no es una ejecución nativa de Node `node:test` y no hay TAP firmado que acredite una ejecución nativa completa**.

Hashes Git (blob) cotejados:

| Archivo | SHA Git |
| --- | --- |
| `combat-turn-guard.mjs` | `82f332fd9ab7469eaad60265c72a06590970cc86` |
| `ranged-turn-precheck.mjs` | `1bb844bc6b92e463aa59ff8ee2a6479e021a47bd` |
| `combat-turn-guard.test.mjs` | `949607dee525b80fe86f422a163405b96661806b` |
| `ranged-turn-precheck.test.mjs` | `ce5adc0b74cd52bc15c4353d0d1259738a5e2471` |

Manifiesto `scripts/check-browser-lab.mjs`: **48 suites registradas**, pendiente de cotejar el conjunto contra el árbol completo de Git. Las **48 suites no han sido ejecutadas como batería integral**.

Cuando se pueda ejecutar el árbol completo con Node.js 22.16+ en Windows nativo, sin WSL ni GitHub Actions, ejecutar:

```powershell
.\scripts\test-local.ps1 -Only "packages/ancients-rules/combat-turn-guard.test.mjs,packages/ancients-rules/ranged-turn-precheck.test.mjs"
.\scripts\test-local.ps1 -Log ".local-data/regression/i4-ranged-turn-guard.tap"
```

No reutilizar un archivo TAP existente: el lanzador lo rechaza para no sobrescribir evidencia.

## Riesgos y condiciones para integrar

1. El motor actual de fases y órdenes es **sintético**, no la máquina oficial de Ancients. Debe implementarse una representación fiable de `turnState` sin fingir que existe ya en SQLite.
2. La criba **no reserva** el ataque. Dos llamadas sobre un mismo snapshot pueden devolver `CANDIDATE`. La futura transacción debe comprobar revisión, registrar combate pendiente, proteger idempotencia y pasar a estado resuelto de forma atómica.
3. No se verifican efectos de carta, líderes en solitario, bonus de combate, batalla de vuelta, retiradas, secuencia de dado ni condiciones de victoria. No habilitar ataques reales hasta contar con esas reglas.
4. Repetir las 31 pruebas con **Node nativo**, ejecutar las **48 suites** del manifiesto, confirmar SQLite, HTTP/SSE y privacidad entre dos cuentas; validar el tablero PC/móvil y los casos de reglas físicamente.
5. Mantener esta PR en borrador y la cadena #45 y siguientes sin fusionar ni desplegar hasta aceptación.

**Resultado:** R-04 y R-06 avanzan en guardas puras, pero siguen **sin implementarse como reglas completas del juego**.
