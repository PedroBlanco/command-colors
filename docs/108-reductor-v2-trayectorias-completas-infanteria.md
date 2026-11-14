# Ancients — Reductor V2 versionado de trayectorias completas de infantería

**Fecha:** 14/11/2026 · **Seguimiento:** [issue #97](https://github.com/PedroBlanco/command-colors/issues/97) · **Base:** PR #120, sobre #119 → #118 → ... → #111 y PR consolidada #108.

## Decisión e implementación

La PR #120 introdujo geometría común de varios hexágonos y un perfil que diferencia movimiento y combate. Esa evaluación todavía no cambiaba el tablero, el contador de unidades movidas ni la revisión.

El módulo nuevo `packages/ancients-rules/core-open-foot-path-v2.mjs` incorpora dos funciones puras:

- `reduceCoreOpenFootPath({state,action,policy})`: compone **el reductor V1 preexistente** (validación de estado, turno, actor, órdenes, unidad ya movida, primera arista, revisión y ámbito de carta) con `previewBaseOpenFootPath` (geometría de **toda** la trayectoria y perfil de movimiento/combate). Si ambas aceptan el candidato, genera una **única transición hipotética** por trayectoria, con el tablero final de la unidad, exactamente **una nueva revisión y un solo identificador añadido a `movedUnitIds`**.
- `replayCoreOpenFootPaths({initialState,actions,policy})`: reproduce una secuencia de transiciones V2 sobre un estado desacoplado, sin idempotencia ni efectos externos. Si un movimiento falla, no entrega **ninguna** transición ni tablero parcial, e identifica el índice de la acción (`step`) y, cuando corresponde, el paso de su trayectoria (`pathStep`). El orden de las acciones modifica el estado reconstruido de forma determinista.

**No se desarrolla un motor por tipo de tropa.** Se reutilizan V1 y las funciones comunes de #119–#120. La diferencia por clase se obtiene de `BASE_MOVEMENT_PROFILES`.

## Frontera entre las versiones

Para impedir que la nueva capacidad cambie silenciosamente contratos persistidos, V2 tiene identificadores específicos y **no modifica** las estructuras V1:

| Concepto | V1, conservado | V2, añadido |
|---|---|---|
| Estado `kind` | `ANCIENTS_OPEN_FOOT_MOVEMENT_CORE_V1` | `ANCIENTS_OPEN_FOOT_PATH_CORE_V2` |
| Estado `schemaVersion` | `1` | `2` |
| Política `scope` | `BASE_FOOT_OPEN_ONE_HEX_V1` | `BASE_FOOT_OPEN_PATH_CORE_V2` |
| Acción | `actor, expectedRevision, unitId, to` | `actor, expectedRevision, unitId, path` |
| Transición | `BASE_FOOT_OPEN_STEP_PROPOSAL_V1` | `BASE_FOOT_OPEN_PATH_PROPOSAL_V2` |
| Alcance | Un hexágono | Uno o dos hexágonos (según perfil) |

La transición V2 conserva `side`, `revision`, `unitId`, `from`, `to` y añade **`path`**, **`steps`** y **`battleAfterMovement`**. `path` excluye el origen, incluye el destino y mantiene el recorrido en orden. `battleAfterMovement` es una **posibilidad del perfil**, no una orden de combate ni prueba de objetivo válido.

Ejemplo: una `AUXILIA_INFANTRY` ordenada pasa de `(2,4)` por `(3,4)` a `(4,4)`. El reductor propone una sola revisión (2 → 3), un solo consumo de movimiento (no consume la orden para un eventual combate), y `battleAfterMovement:'UNAVAILABLE'` según el perfil. Infantería ligera, con honda y con arco conservan `POSSIBLE` después de dos pasos; media y pesada quedan limitadas a uno.

## Restricciones y seguridad

El núcleo **sigue siendo una propuesta exclusivamente experimental**, no una autoridad oficial. Exige fase `MOVE`, unidades ordenadas propias, identidad de bando coincidente con turno, revisión exacta, ficha sin movimiento previo, política de carta ordinaria, **terreno enteramente abierto, sin líderes ni excepciones**, y perfil de infantería ordinaria.

La implementación usa una copia estricta y acotada **por descriptores propios**, rechazando getters, símbolos, propiedades extra, listas dispersas, estructuras circulares y actores/credenciales/autoridades añadidos. La primera etapa calcula el resultado congelado V1; el estado se **copia antes de enriquecerlo** con la trayectoria V2, sin alterar ni reutilizar objetos congelados. Los resultados aceptados se congelan en profundidad y nunca devuelven alias al tablero original.

Todas las respuestas, incluidas las candidatas, mantienen:

```js
movementAuthorized: false
officialMovementAuthorized: false
attackAuthorized: false
canCommit: false
dbChanged: false
needsServerTransaction: true
needsFullLegalityCheck: true
```

Quedan **expresamente fuera del alcance** caballería, elefantes, carros, guerreros, máquinas de guerra, terrenos especiales, movimientos con líderes, cartas excepcionales, escenario oficial no verificado, combate, retiradas y expansiones.

### No hay migración ni confirmación implícita

Los diarios de las PR #115–#117 siguen vinculados al reductor **V1** y a su `FOOT_JOURNAL_KIND`. Los V2 **no se anexan** a ese diario, no generan `FOOT_EVENT_PROPOSAL` ni `ANCIENTS_MOVEMENT_COMMITTED_V1`, y no cambian `matches`, `game_commands`, `game_events` ni la revisión pública. La propuesta atómica de #118 también permanece V1; no se reinterpreta automáticamente para V2.

Antes de aceptar movimientos V2 como jugadas es necesario construir **un diario V2 versionado con su propia firma semántica, eventos mínimos, idempotencia, replay anclado a la procedencia real de escenarios y órdenes** y una confirmación oficial atómica `BEGIN IMMEDIATE` bajo sesión y pertenencia verificadas. Sigue pendiente SEC-001 (#94). **Ninguna de estas condiciones se presume implementada por esta PR.**

## Cobertura y evidencia

Se añade `packages/ancients-rules/core-open-foot-path-v2.test.mjs` como **suite 87** del manifiesto de regresión. Tiene **31 pruebas nuevas** para distancias, auxiliares/ligeras frente a media/pesada, recorrido con giro, casillas ocupadas, revisitas, fallo en segundo hexágono, unidad sin orden, turnos y revisiones, una sola revisión y una sola marca por trayectoria, replay de varias unidades, rechazo íntegro sin estado parcial, compatibilidad con V1, separación de versiones, entradas maliciosas, inmutabilidad y desbordamiento de revisión.

**Ejecución aislada completada:** **166/166** pruebas del conjunto de seis suites reales (31 nuevas + 135 anteriores), en V8 estricto y con emulación de `node:test` y sustitución de `structuredClone` por copia JSON:

| Suite | Casos correctos |
|---|---:|
| `core-open-foot-path-v2.test.mjs` | 31/31 |
| `open-foot-path-preview.test.mjs` | 27/27 |
| `movement-regimes.test.mjs` | 21/21 |
| `core-open-foot-movement.test.mjs` | 35/35 |
| `foot-movement-journal.test.mjs` | 32/32 |
| `foot-atomic-commit-envelope.test.mjs` | 20/20 |

**No se ha ejecutado la regresión nativa de Node ni SQLite** en esta rama. La última ejecución acreditada por el usuario fue **1045/1045 en 80 suites** sobre #108. Las PR #111–#120 añadían 199 casos, y esta PR añade 31: **1275 pruebas previstas en 87 suites, sin validación nativa**. El usuario ha indicado que no puede realizar pruebas locales: no solicitarlas ahora.

PR en borrador sobre #120, fuera de `main`, sin despliegue, HTTP/SSE ni cambios de esquema. Mantener abierta #97.
