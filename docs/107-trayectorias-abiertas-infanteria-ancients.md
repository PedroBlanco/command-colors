# Ancients — trayectorias abiertas de infantería con perfiles compartidos

**Fecha:** 14/11/2026 · **Issue:** #97 · **Base:** PR #119 (`refactor/ancients-shared-movement-regimes`), sobre la cadena experimental #118 → #111 y PR consolidada #108.

## Alcance

La PR #119 separó las comprobaciones geométricas de los perfiles de las unidades. Esta iteración extiende esa separación a **trayectorias de varios hexágonos**, sin introducir motores distintos por tipo de tropa ni alterar los diarios privados o el almacenamiento CCWB.

Se implementan dos funciones **puras y no autorizantes**:

- `assessOpenHexPathGeometry({from,path,occupiedCells})`, añadida a `movement-regimes.mjs`: evalúa en orden cada arista de una trayectoria, utilizando `assessOpenHexStepGeometry` y verificando que no se atraviese una casilla ocupada, no se salga del tablero, no haya saltos y no se visite dos veces una casilla. La lista `path` **excluye el origen**. En un fallo se devuelve un índice de paso `step` basado en cero, con `destination:null` y sin resultado parcial. El algoritmo no conoce tipo de unidad, bando ni carta.
- `previewBaseOpenFootPath(request)`, nuevo `open-foot-path-preview.mjs`: combina la geometría completa con los límites y la opción de combatir de `BASE_MOVEMENT_PROFILES`, sin copiarlos ni conceder excepciones. Solo acepta `OPEN_FOOT_PATH_PREVIEW_SCOPE='BASE_FOOT_OPEN_PATH_PREVIEW_V1'`, reglas `ancients-base-3e-2009`, carta ordinaria de sección, terreno totalmente abierto, ningún líder y ninguna excepción de escenario.

## Cobertura reglamentaria restringida

| Unidad de infantería | Máximo de hexágonos | Combate tras 1 hex. | Combate tras 2 hex. |
|---|---:|---|---|
| Ligera | 2 | Posible | Posible |
| Ligera con honda | 2 | Posible | Posible |
| Ligera con arco | 2 | Posible | Posible |
| Auxilia | 2 | Posible | No disponible |
| Media | 1 | Posible | No disponible (paso rechazado) |
| Pesada | 1 | Posible | No disponible (paso rechazado) |

Estos valores se leen de `movement-profile.mjs`, que ya los tenía definidos para el juego básico. *Posible* solo indica que el **perfil de movimiento** no impide combatir; el combate real exige validación separada de fase, objetivo, línea de visión, terreno, carta, escenario y demás reglas.

Guerreros (incluida su carga), caballería, elefantes, carros y máquinas de guerra **no quedan habilitados** por este evaluador. Seguirán sus regímenes definidos en PR #119, con geometría compartida pero con reglas especiales pendientes.

### Casos deliberadamente fuera del alcance

- Terreno de cualquier tipo no abierto en cualquier punto del escenario, aunque no sea parte de la ruta.
- Líderes presentes en cualquier lugar del tablero.
- Cartas distintas de la familia ordinaria de sección, órdenes especiales, escenarios con excepciones, expansiones y movimiento en fases ajenas a `MOVE`.
- Comprobar identidad/sesión, propiedad de la unidad, órdenes reales emitidas, uso previo de una unidad, tipo de escenario y procedencia de las unidades. **Estos datos no se reciben ni se autorizan aquí.**
- Mover efectivamente el tablero, persistir revisiones, crear comandos/eventos de juego, modificar diarios o aceptar reintentos idempotentes.

**`OPEN_FOOT_PATH_CANDIDATE` no es permiso de movimiento.** La respuesta siempre incluye `movementAuthorized:false`, `officialMovementAuthorized:false`, `canCommit:false`, `dbChanged:false` y `needsFullLegalityCheck:true`. La revisión y aplicación oficial en SQLite permanecen completamente deshabilitadas.

## Contratos y seguridad

La entrada raíz del evaluador de infantería exige exactamente:

```js
{
  scope:'BASE_FOOT_OPEN_PATH_PREVIEW_V1',
  ruleset:'ancients-base-3e-2009',
  unitType:'AUXILIA_INFANTRY',
  cardFamily:'ORDINARY_SECTION',
  from:{col:2,row:4},
  path:[{col:3,row:4},{col:4,row:4}],
  occupiedCells:[{col:2,row:4},{col:10,row:4}],
  terrain:[],
  leaders:[],
  scenarioExceptions:[]
}
```

Es **solo una proyección de análisis**. Los datos reales de escenario y tablero deberían proceder del servidor después de verificaciones independientes; no se admiten campos raíz extra como `actor`, `sessionToken`, `board`, `canCommit` o `cardPlayAuthorized`.

Tanto la raíz como los arrays se examinan mediante descriptores propios, sin ejecutar getters, incluso si llegan envueltos en `Proxy`. Se rechazan listas dispersas, no densas, sobredimensionadas o con atributos adicionales; se copian las coordenadas necesarias y se devuelven destinos desconectados e inmutables. No se devuelve una ruta parcial tras un fallo.

El **reductor existente** `reduceCoreOpenFootStep` sigue restringido a un único hexágono; tampoco se cambian `FOOT_JOURNAL_KIND`, `FOOT_EVENT_PROPOSAL`, las entradas de los diarios de #115 ni el borrador persistido de #116. Los movimientos de dos hexágonos **no se pueden anexar ni confirmar a través de esas estructuras**.

## Pruebas

Se añade `packages/ancients-rules/open-foot-path-preview.test.mjs` al manifiesto como la suite **86**, con **27 nuevos casos**:

- Geometría de un paso, dos pasos en línea y con giro; saltos, visitas repetidas, destinos o puntos intermedios ocupados, límites del tablero y formatos inválidos.
- Seguridad de getters y proxies en la raíz, recorrido y celdas; ausencia de atributos de autoridad y de resultados parciales.
- Perfiles de infantería ligera, ligera con arco/honda, auxilia, media y pesada; diferencias de combate después de un paso o dos.
- Rechazo de otras unidades, terreno, líderes, cartas distintas, escenario no admitido y entradas manipuladas.
- **Tres comparaciones con `precheckAncientsMovementPath`**, el comprobador anterior, para verificar coherencia en perfiles, límites y obstáculos.

Se ejecutó **27/27** de la suite nueva en V8 estricto con fuentes y pruebas reales de GitHub y simulación de `node:test`. También se ejecutó **108/108** de las suites aisladas previas del núcleo, regímenes, diario y contrato atómico (35+21+32+20), sin regresiones observadas. **Son 135 pruebas aisladas, no Node nativo ni SQLite real**: se utilizó clonación JSON como sustituto de `structuredClone`.

Última validación nativa aportada por el usuario: **1045/1045 pruebas en 80 suites** para la PR #108. La cadena posterior hasta #119 acumula 172 pruebas y la nueva PR añade 27: **1244 pruebas previstas en 86 suites**, pendientes de ejecutar de manera nativa. El usuario ha indicado que no puede hacer pruebas locales por ahora; no solicitarlas.

Mantener la PR en **borrador**, encadenada sobre #119, sin fusionar en `main`, sin desplegar ni abrir rutas HTTP/SSE. Quedan pendientes las reglas completas de cada régimen, procedencia de escenarios/órdenes, transacción real de movimientos e idempotencia de juego (#97), así como SEC-001 (#94).
