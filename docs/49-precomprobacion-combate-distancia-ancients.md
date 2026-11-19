# CCW-014 · Criba de disparo de Ancients básico (R-06 parcial)

**Fecha:** 10/11/2026. **Estado:** borrador experimental. **Rama:** `feat/i4-ancients-ranged-profile-precheck`, basada en PR #61 (dependencias #59 → #57 → #55 y anteriores). **Edición de referencia:** *Commands & Colors: Ancients*, tercera edición (2009), juego básico. No hay conexión con partidas oficiales, SQLite ni API HTTP.

## Fuente y alcance

Consultar antes de aceptar las reglas finales:
- [10. Ranged Combat (Fire), apartado 2 y apartado 5](https://www.commandsandcolors.net/ancients/the-game/main/10-ranged-combat-fire.html).
- [08. Movement](https://www.commandsandcolors.net/ancients/the-game/main/08-movement.html).
- [09. Battle](https://www.commandsandcolors.net/ancients/the-game/main/09-battle.html).
- [16. Terrain](https://www.commandsandcolors.net/ancients/the-game/main/16-terrain.html).

Dos nuevas funciones puras, solo de **precomprobación**:

1. `assessAncientsRangedProfile({unitType,movedSteps,targetDistance})` — arma básica, alcance, movimiento previo y dados ordinarios.
2. `precheckAncientsRangedAttack({units,leaders,terrain,attackerId,targetId,movedSteps})` — selecciona las unidades a partir del tablero confiable y combina perfil, adyacencia enemiga, línea de visión (PR #61) y máximo de dados por terreno (PR #59).

### Alcance ordinario en el motor básico actual

| Tipo interno | Alcance máximo |
| --- | ---: |
| `LIGHT_INFANTRY`, `AUXILIA_INFANTRY`, `LIGHT_CAVALRY` | 2 |
| `LIGHT_BOW_INFANTRY`, `LIGHT_SLING_INFANTRY` | 3 |
| `HEAVY_WAR_MACHINE` | 6 |
| Otros 7 tipos definidos en `BASE_MOVEMENT_PROFILES` | No disponen de ataque a distancia ordinario |

**No se amplía silenciosamente el catálogo**: la caballería con arco y otros tipos, y las unidades con capacidades especiales otorgadas por escenario o carta, se resolverán cuando su edición/fuente y sus excepciones estén modeladas. El perfil normal bloquea, no inventa excepciones.

Una unidad capaz de disparar necesita objetivo enemigo no adyacente, dentro de su alcance, y sin enemigos adyacentes al atacante. Si no se movió, su base ordinaria es 2 dados; si se movió, 1. Auxilia que avanzó dos hexágonos y máquinas de guerra pesadas que se desplazaron no pueden disparar. El terreno `FOREST` del objetivo limita los dados a 1; los demás tipos cubiertos por las PR anteriores no añaden reducción ordinaria al disparo.

La cantidad `diceAfterTerrain` representa **dados base con el límite ordinario de terreno**, no los dados finales de un combate autorizado. No aplica cartas, órdenes especiales, escenarios, decisiones de reacción ni dados físicos/digitales.

### Contratos de confianza y seguridad

- `movedSteps`, `units`, `leaders` y `terrain` se obtendrán del **estado autoritativo del servidor** y de un escenario confiable. No serán parámetros aceptables desde peticiones de un jugador.
- Se validan identidades, tipos, lados, límites de tablero, ocupación, duplicados, coordenadas y terreno. Se permite una unidad y un líder amigo en el mismo hexágono, no líderes duplicados en él.
- Se rechaza el disparo a unidades amigas. Los líderes sin unidad propia no se consideran todavía objetivos reglamentariamente soportados.
- El chequeo de adyacencia incluye unidades y líderes enemigos, sin que un amigo adyacente bloquee automáticamente el disparo.
- La LOS usa unidades amigas y enemigas, líderes y terreno. Si falla, la respuesta interna podrá contener detalles geométricos; **nunca exponer esa respuesta completa a un cliente** sin una proyección autorizada.
- Toda respuesta tiene `attackAuthorized:false`, `needsFullLegalityCheck:true`, `ordersAndPhaseChecked:false`, `cardModifiersApplied:false` y `scenarioExceptionsChecked:false` en la criba integrada. Un resultado `CANDIDATE` **no autoriza ni ejecuta nada**.

## Pruebas nativas y reproducibilidad

Comando ejecutado en contenedor Linux nativo, Node.js **22.16.0**, sin WSL ni GitHub Actions:

```sh
node --test --test-reporter=tap \
  packages/ancients-rules/ranged-profile.test.mjs \
  packages/ancients-rules/ranged-precheck.test.mjs \
  packages/ancients-rules/line-of-sight.test.mjs
```

**41/41 PASS, 0 FAIL, 0 SKIP**: **27 nuevas** (10 de perfil y 17 de integración) y **14** de LOS existentes. Se recuperaron y cotejaron como bytes exactos los módulos base necesarios y las pruebas LOS. SHA Git exactos:

| Archivo | Blob Git |
| --- | --- |
| `ranged-profile.mjs` | `177014e6fe0d6a5f9437cc1383c0ee6285396c34` |
| `ranged-profile.test.mjs` | `841b63a462ad1c64090bb54d76e63c8307056a08` |
| `ranged-precheck.mjs` | `554d69528b96ce34ff5ac9cd022d3a844c523886` |
| `ranged-precheck.test.mjs` | `a71ccb0bc45aa02008b9c85a271525bf41f446f3` |
| `movement-profile.mjs` | `2bef541f7da040f7eb1b2b8735fab4939ce1f966` |
| `terrain-movement.mjs` | `4e67f3b390dc6ba1f76536a2b34570416591e462` |
| `terrain-dice-cap.mjs` | `90be168b01e37950691354be393923c9d5bbef05` |
| `line-of-sight.mjs` | `0f1b129365bba9b2dfcfafb83fa98ffc9ecf7b1f` |
| `line-of-sight.test.mjs` | `06a05614e8fcd27d7770312df6d5368aae83231b` |
| `hex.mjs` | `ae0e4526b8e91c4c0d5d94aebc52077b60f410da` |

SHA-256 del TAP combinado: `caa4bd143d72a4c50c2ce12f9817442022e02b3fb4dd71a269e0ea67d2cd4174`. No subir registro TAP con rutas locales: se conserva como evidencia local.

El manifiesto `scripts/check-browser-lab.mjs` pasa de **44 a 46 suites**. Ese inventario no prueba que las **46 suites hayan sido ejecutadas**; la regresión global, Windows/SQLite, HTTP/SSE y las dos sesiones siguen pendientes.

## Puerta de fusión y trabajos siguientes

1. Completar autorización oficial por fase, carta, unidad ordenada, contador de ataques y alcance en servidor. No tratar esta criba como punto de entrada HTTP.
2. Revisar especiales de unidades y escenarios, eliminación/reacción defensiva, secuencia de combate y efectos de dados.
3. Ejecutar las 46 suites integrales (incluida regresión Windows), comprobar seguridad, privacidad y persistencia; validar con dos usuarios y revisión visual/táctil.
4. Mantener la PR en borrador y **no fusionar ni desplegar** hasta la aceptación.

**R-06 continúa parcial. No se considera implementado el combate a distancia oficial.**
