# LAB-ANC — Primer reductor determinista de desplazamientos de un hexágono

**Fecha:** 12/11/2026. **Origen:** PR #98 (código reunido en PR #99, sobre PR #96 y PR #95). **Estado:** laboratorio **sin persistencia**, sin endpoint y sin autorización de movimientos de partida.

## Objetivo técnico

Hasta ahora el proyecto podía verificar rutas, crear secuencias candidatas y guardar borradores privados, pero no calculaba una nueva disposición de piezas con un contrato estricto que se pudiera utilizar posteriormente para un motor de movimientos. Se añade `packages/ancients-rules/clear-lab-movement-reducer.mjs`, un **reductor puro** que recibe un estado de órdenes de cartas `LAB_RESOLUTION_PENDING` y genera un **tablero simulado** para un subconjunto muy restringido de desplazamientos ordinarios.

La función es:

`reduceOneHexClearLab({state,actor,expectedRevision,actions,serverContext,policy})`

Se apoya en `precheckStagedAncientsMovementSequence`, que comprueba identidades, órdenes y posiciones actuales contra el diario de cartas/órdenes antes de devolver `CANDIDATE_SEQUENCE`.

### Restricciones deliberadas

El reductor solo puede generar una disposición simulada cuando **todas** las siguientes condiciones se cumplen:

1. El servidor proporciona de forma confiable `policy={scope:'SYNTHETIC_OPEN_HEX_V1'}`. La política no se acepta desde un navegador ni constituye por sí misma un permiso de partida.
2. El contexto de escenario incluye expresamente `terrain:[]`: **el tablero completo es terreno abierto**. No se aplica a escenarios oficiales con colinas, bosques, terreno accidentado, ríos, marismas, obstáculos ni efectos especiales.
3. No hay **ningún líder** sobre el tablero. Se excluyen uniones, separaciones, transporte de líderes, huida y retirada.
4. Solo participan tipos de infantería ordinaria ya admitidos en los perfiles básicos: ligera, ligera con honda, ligera con arco, auxiliares, media o pesada. Se excluyen guerreros con carga, máquinas de guerra, caballería, elefantes y carros hasta que tengan su comprobación integral.
5. Cada acción corresponde a una unidad expresamente ordenada, consiste en un **único hexágono adyacente**, no atraviesa ni termina sobre unidades, y no puede repetir una pieza dentro de la secuencia.
6. El mismo bando debe tener el turno, la revisión debe coincidir y la fase debe permitir resolver las órdenes. En la integración futura, el llamador deberá aportar un estado previamente **reconstruido y verificado** desde el diario privado; esta función pura no autentica sesiones.
7. Ninguna ruta puede necesitar una excepción reglamentaria. Si una sola acción falla, **no hay tablero reducido parcial** ni lista de movimientos parciales.

Un resultado favorable indica `status:'LAB_REDUCTION_CANDIDATE'`, `moveCount`, un `simulatedBoard` congelado y una lista también inmutable `moves=[{unitId,from,to}]`. El estado de entrada y las órdenes permanecen intactos. En denegaciones, `simulatedBoard:null` y `moves:null`.

**Todos los resultados**, favorables o denegados, llevan `labSimulationOnly:true`, `canCommit:false`, `officialMovementAuthorized:false`, `movementAuthorized:false`, `attackAuthorized:false`, `stateChanged:false` y `needsFullLegalityCheck:true`. El `simulatedBoard` **no es** el tablero de la partida; `stateChanged:false` expresa que no hay mutación del estado persistente o recibido.

## Fronteras de seguridad y exclusiones

- **No** se modifica `section-history-journal.mjs`, el formato de replay, las claves de idempotencia, las revisiones ni el tablero existente de `matches.private_state`.
- No se introduce `MOVE_UNIT` en `game_events`, no se consume un pedido del diario, no se genera acción HTTP, no se valida una carta oficial fuera del diario de laboratorio.
- No se puede usar el resultado para confirmar una jugada en el sistema existente. Antes de la persistencia real será necesaria una transición independiente que valide reglamento, escenario, fase, órdenes restantes, liderazgo, efectos de cartas, combate e integridad transaccional del diario.
- No se interpreta `SYNTHETIC_OPEN_HEX_V1` como autorización de despliegue. Sigue siendo necesaria la resolución de SEC-001 (#93) y la ejecución nativa de las pruebas de composición de PR #95 y #96.

## Pruebas

Se añade `packages/ancients-rules/clear-lab-movement-reducer.test.mjs` con **11 casos**:

- Movimiento válido de una infantería, inmutabilidad de entrada y salida y banderas de no autorización.
- Movimiento secuencial de dos unidades expresamente ordenadas.
- Política ausente o manipulada; terreno ausente o no vacío.
- Presencia de líderes; perfil desconocido, excluido o sin cubrir todo el censo de unidades.
- Acciones de líder, rutas de más de un hexágono, ruta vacía y campos falsificados.
- Unidad rival, inexistente, ya movida, hexágono no adyacente.
- Turno contrario, revisión obsoleta, fin del turno.
- Atomicidad de la **proyección**: si falla la segunda ruta no queda un primer movimiento parcial.
- Resultado determinista en evaluaciones independientes.

**Evidencia actual:** **11/11** evaluaciones correctas al reconstruir dependencias puras y la suite desde los archivos reales recuperados de GitHub dentro de V8 aislado. Blobs Git SHA-1: módulo `e5eda99473411fc74beacac25a93cef4b130a906`, suite `71743ea6c38563a89bba9c0b97ff473ee0138e4e`. El digest SHA-256 se sustituyó en una dependencia de auditoría no utilizada por el reductor. **Esta comprobación no equivale a Node.js nativo, SQLite ni a la regresión total.** Se ha registrado como suite **78** en la rama consolidada, junto a las 13 pruebas del contrato de entrada de PR #99.

## Próximo hito

Conservar este reductor como contrato reducido para pruebas de movimiento; después, sobre un árbol completo validado con Node.js y SQLite, diseñar e implementar una **transición reglamentaria distinta** que registre una orden consumida, la posición final, los eventos y un replay comprobable dentro de una transacción. Evitar que un resumen SHA-256, un borrador o este `simulatedBoard` se empleen como autorización.

**La consolidación en una rama experimental no equivale a fusionar en `main`.** Mantener PR #96 y #95 aisladas de `main` hasta completar los criterios de integración, seguridad y revisión.


## Consolidación experimental de PR #98 y #99

El código del reductor y sus 11 pruebas se conservó sin modificar los blobs originales de PR #98, junto al filtro independiente de intención y sus 13 pruebas de PR #99. La documentación se renumeró a `82` porque ambos desarrollos paralelos utilizaban `docs/81-*` y se necesitan nombres distintos para los dos contratos. El manifiesto combinado declara **78 suites**. La evidencia nativa de 13 casos del filtro no debe atribuirse a las 11 pruebas del reductor, que continúan pendientes de ejecución nativa. No se crea ruta HTTP ni movimiento real.
