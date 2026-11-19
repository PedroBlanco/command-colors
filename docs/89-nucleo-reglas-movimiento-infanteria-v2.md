# Ancients — motor puro de infantería ordinaria con trayectorias V2

Consolidación de módulos de PR históricas #112 y #119–#121 sobre la base SEC-001 de `main@9ef2c381f85aa7b38237077299008703ebd23e9e`, sin fusionar sus ramas apiladas.

## Funcionalidad

- **Reductor V1**: una casilla por acción, valida turno, fase, orden, bando, revisión, ocupación y límite de una maniobra por unidad.
- **Regímenes y geometría común**: 13 tipos del básico clasificados; geometría hexagonal compartida, sin reductores duplicados. Solo infantería ordinaria soportada aquí; otros regímenes permanecen bloqueados.
- **Vista previa multicasilla y reductor V2**: trayectorias completas de uno o dos hexágonos, adyacencia y ocupación en cada paso, sin repetir hexágonos. Hasta dos para infantería ligera (incluidos arco y honda) y auxilia; uno para media y pesada. Las auxilia que avanzan dos no pueden combatir después.
- **Replay puro**: varias maniobras ordenadas como transiciones reproducibles; fallo atómico de toda la simulación si una acción es ilegal. Estados y resultados se devuelven inmutables.

## Límites de autoridad

Todo queda estrictamente acotado a terreno abierto, cartas ordinarias, sin líderes, excepciones, otras tropas o combate. Los datos de escenario y perfiles deben proceder del servidor. Los estados `RULE_TRANSITION_CANDIDATE` y `RULE_PATH_TRANSITION_CANDIDATE` **no autorizan ni ejecutan** una jugada; se mantienen `movementAuthorized:false`, `canCommit:false`, `dbChanged:false`. Sin HTTP, SSE ni cambios de SQLite. La aprobación y escritura de una jugada confirmada bajo `BEGIN IMMEDIATE` siguen pendientes en #97.

Reglamento contrastado: GMT Games, *Commands & Colors: Ancients*, 3.ª ed. (2009), movimiento de unidades (pp. 5–6), https://www.gmtgames.com/living_rules/CC_Rules_2009.pdf .

Se añaden cuatro suites al inventario de 86 → 90; se recupera la suite pura de #112 para V1 sin adaptadores históricos. Pruebas nativas de este SHA y regresión conjunta pendientes. No cerrar SEC-001 (#94).
