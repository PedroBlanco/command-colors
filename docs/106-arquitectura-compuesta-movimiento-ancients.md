# ANC — Una geometría de movimiento, perfiles y regímenes reglamentarios

**Fecha:** 14/11/2026 · **Seguimiento:** [issue #97](https://github.com/PedroBlanco/command-colors/issues/97) · **Base:** PR #118, apilada sobre #117 → #116 → #115 → #114 → #113 → #112 → #111 → PR consolidada #108.

## Decisión de arquitectura

**No se creará un motor paralelo por cada tipo de unidad.** El desplazamiento debe componerse mediante:

1. **Infraestructura común:** geometría hexagonal, ocupación, secuencias, cambios de tablero, marcadores de movimiento, determinismo, replay, idempotencia, seguridad de sesión, transacción y publicación de eventos.
2. **Perfiles de reglas por juego:** las distancias y la posibilidad de combatir tras desplazarse están registradas en `BASE_MOVEMENT_PROFILES` de `movement-profile.mjs` para *Ancients*. Este módulo es la única fuente de esos límites básicos; no duplicarlos en `movement-regimes.mjs`.
3. **Regímenes reglamentarios:** grupos que requieren comprobaciones adicionales (carga obligatoria de guerreros, peculiaridades de caballería, elefantes, carros, máquinas de guerra...). Agrupan lógicas, no generan un reductor por ficha.
4. **Contexto verificado:** terreno, líderes, carta, escenario, reglas especiales y órdenes deben provenir del servidor y pasar por la autoridad reglamentaria de su juego.
5. **Autoridad transaccional:** una única frontera de confirmación por juego o familia de eventos, con `BEGIN IMMEDIATE`, sesión, membresía, revisión, idempotencia, comandos, eventos y replay. No depende del nombre del tipo de tropa.

Esta separación permitirá reutilizar mecanismos en *Napoleonics*, **sin compartir automáticamente las reglas ni presuponer igual tamaño de tablero, líderes, terreno o fases**.

## Nuevo módulo

`packages/ancients-rules/movement-regimes.mjs` proporciona dos funciones puras, inmutables y **no autorizantes**:

### `assessAncientsMovementRegime({unitType,steps})`

Consulta `BASE_MOVEMENT_PROFILES` y selecciona el grupo de reglas, sin ejecutar movimiento.

| Régimen | Tipos básicos de Ancients | Soporte en reductor restringido |
|---|---|---|
| `ORDINARY_FOOT` | Ligera, ligera con honda, ligera con arco, auxilia, media y pesada | **Sí**, un solo hexágono abierto, sin líderes ni excepciones |
| `WARRIOR_CHARGE` | Guerreros | Pendiente de reglas de carga y combate obligatorio |
| `WAR_MACHINE` | Máquina de guerra pesada | Pendiente de régimen específico |
| `CAVALRY` | Caballerías ligera, media y pesada | Pendiente de aplicación íntegra del perfil y efectos |
| `ELEPHANT` | Elefantes | Pendiente de peculiaridades específicas |
| `CHARIOT` | Carros pesados | Pendiente de peculiaridades específicas |

Hay **13 tipos conocidos**, pero **6 regímenes**: no se genera una implementación por unidad. Los tipos nuevos sin clasificación explícita se rechazan (comportamiento *fail-closed*). `SUBSET_ELIGIBLE` solo significa que el núcleo anterior puede comprobar **una unidad de infantería ordinaria, un paso, terreno totalmente abierto y sin líderes**; nunca significa que se pueda confirmar una jugada. `NEEDS_EXTENDED_RULES` no concede ninguna excepción implícita.

Por ejemplo, aunque la infantería ligera pueda desplazarse más de un hexágono según su perfil, la propuesta de **dos pasos** continúa fuera del reductor restringido hasta validar todas las casillas intermedias, restricciones de terreno, líderes y cartas. Los guerreros tampoco reciben permiso de carga solo porque `assessBaseMovement` indique `CONDITIONAL_CHARGE`.

### `assessOpenHexStepGeometry({from,to,occupiedCells})`

Evalúa únicamente **un salto entre dos hexágonos adyacentes del tablero actual**, comprobando límites y ocupación por cualquier unidad (amiga o enemiga). No recibe tipo de tropa ni usa la carta, la identidad del actor, los turnos o la política de escenario. Devuelve `CANDIDATE_GEOMETRY` o `BLOCKED`, siempre con `movementAuthorized:false` y `canCommit:false`.

La implementación de geometría utiliza actualmente el tablero hexagonal de 13×9 a través de `hex-grid/inBounds`. Si otro juego utiliza otra geometría o dimensiones, deberá inyectar o definir sus límites, no aceptar sin comprobación los de *Ancients*.

**Protección de entradas:** ambas funciones copian por descriptores los datos necesarios, rechazan objetos raíz con campos adicionales de autoridad, getters y arrays de ocupación dispersos; capturan errores de proxies y nunca invocan su trampa `get`. Las unidades del tablero pueden contener `id`, `side` y otros atributos, pero la geometría lee exclusivamente las coordenadas.

## Compatibilidad con las PR #112–#118

El reductor `reduceCoreOpenFootStep` de #112 **mantiene el mismo contrato público y todos sus límites previos**. La modificación sustituye exclusivamente:

- El conjunto local y repetido de seis tipos de infantería por la consulta `assessAncientsMovementRegime`.
- Las comprobaciones locales de distancia y ocupación por la función común `assessOpenHexStepGeometry`.

No cambian el significado de `RULE_TRANSITION_CANDIDATE`, `UNSUPPORTED_FOOT_UNIT`, `NOT_ONE_ADJACENT_HEX`, `OCCUPIED_DESTINATION`, los datos de una transición, el orden de las comprobaciones, el cálculo de revisión, los marcadores `movedUnitIds` ni las banderas de no autorización. Se mantiene la compatibilidad con el diario privado, el replay, la propuesta de evento y el contrato atómico no ejecutable.

**No se han añadido rutas HTTP/SSE, migraciones SQLite ni escrituras de movimientos oficiales.**

## Pruebas

- Nueva suite **85**: `packages/ancients-rules/movement-regimes.test.mjs` con **21 pruebas**. Cobertura de los 13 tipos y sus seis regímenes, perfiles compartidos, carga de guerreros no autorizada, geometría reutilizable, ocupación por ambos bandos, límites, entrada manipulada y preservación del contrato del reductor.
- Compatibilidad aislada: **21/21** pruebas nuevas, **35/35** pruebas acumuladas del núcleo (incluido el adaptador privado anterior), **32/32** del diario y **20/20** del sobre atómico; **108/108 casos** superados en V8 estricto sobre módulos y tests reales recuperados de GitHub, con un simulador de `node:test` y copia JSON en lugar de `structuredClone`.
- **No se han ejecutado Node nativo, SQLite real ni la regresión completa** de esta rama. El último resultado Windows aportado por el usuario sigue siendo **1045/1045, 80 suites sobre #108**; la cadena #111–#118 aporta 151 pruebas nuevas y esta rama añade 21. La regresión **prevista, no acreditada**, es **1217 pruebas en 85 suites**.

Mantener esta PR en **draft**, sin fusionar `main`, sin despliegue ni pedir pruebas locales al usuario por ahora. Antes de ampliar unidades o habilitar confirmaciones, siguen pendientes la procedencia reglamentaria oficial, la autoridad de turno/órdenes y el replay y la transacción completa de movimientos confirmados (#97), además de SEC-001 (#94).
