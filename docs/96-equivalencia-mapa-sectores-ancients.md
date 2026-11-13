# LAB-ANC — Igualdad semántica del mapa de sectores

**Fecha:** 13/11/2026. **Seguimiento:** #97. **Rama:** `fix/ancients-semantic-sector-ledger-equality`, sobre la PR consolidada #108.

## Problema detectado

La función de comprobación integral del registro de órdenes comparaba `orderSnapshot.sectorCells` y `state.sectorCells` mediante `JSON.stringify`. Dos objetos iguales por valores, pero construidos con distinto orden de claves, podían dar cadenas diferentes y provocar un falso rechazo `ORDER_LEDGER_MISMATCH`. Lo mismo sucedía con una casilla fronteriza adscrita a `LEFT` y `CENTER` cuando se invirtiera el orden de ambas etiquetas. Esta igualdad no depende de la serialización de las claves: un mapa asigna coordenadas a conjuntos de sectores.

## Corrección

`equalSectorCells` compara ambas representaciones por **conjunto de claves propias** y por **pertenencia semántica de sectores**. Acepta reordenaciones de claves y de una lista de dos sectores sin mutar el estado ni la instantánea de órdenes. Rechaza claves ausentes o sobrantes, etiquetas desconocidas, repetidas, listas vacías, listas de más de dos sectores, tipos no válidos y las diferencias reales de adscripción.

Todos los preflights (`UNIT`, `LEADER`, secuencia) siguen aplicando el mismo control y conservan `movementAuthorized:false`. Esto no concede autoridad sobre el estado ni cambia el replay criptográfico de los comandos; la verificación CCWB previa continúa siendo obligatoria.

## Validación

Se añaden **3 casos** a `packages/ancients-rules/staged-movement-preflight.test.mjs`, suite ya registrada entre las 80. Verificación adicional disponible: **10/10 escenarios** sobre `equalSectorCells` real y **24/24 escenarios** en V8 aislado con las tres funciones staged reales y dependencias de prevalidación simuladas. **No es regresión Node nativa ni SQLite real.**

La regresión Windows de **1036/1036 pruebas, 80 suites** corresponde al SHA anterior `513e26d2adbfae9bc8144b63e2c5fcbe0e8f176f` (PR #108), no a esta rama. Para integrar esta corrección, ejecutar de nuevo la suite focal y la regresión completa sobre el **nuevo SHA** cuando esté listo. No modificar `main` ni habilitar movimientos confirmados.
