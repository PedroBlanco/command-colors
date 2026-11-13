# LAB-ANC / R-04–R-05 — Coherencia integral del registro de órdenes en prevalidación

**Fecha:** 13/11/2026. **Incidencia:** [#97](https://github.com/PedroBlanco/command-colors/issues/97).  
**Rama:** `fix/ancients-consistent-staged-order-ledger`, apilada sobre [PR #105](https://github.com/PedroBlanco/command-colors/pull/105). No modifica `main`.

## Problema

Las tres consultas privadas de `staged-movement-preflight.mjs` leían un mismo `orderSnapshot`, pero con distinta profundidad:

- `precheckStagedAncientsMovementSequence` revisaba **todas** las piezas del registro, identificadores duplicados, bando y posición.
- `precheckStagedAncientsMovement` verificaba únicamente la orden de la unidad solicitada.
- `precheckStagedAncientsLeaderMovement` verificaba únicamente la orden del líder solicitado.

Por ello, si una entrada hermana del registro estuviese alterada, una consulta individual podía seguir devolviendo `CANDIDATE`. La composición CCWB ya exige replay autenticado, por lo que esto es **defensa en profundidad y homogeneización de los preflights**, no una demostración de explotación de la base SQLite.

## Cambio

Se introduce `consistentStagedOrderLedger(state,actor)`, utilizada por las tres consultas **después** de comprobar revisión, fase y pieza solicitada. Rechaza:

- Posición, tipo o bando de cualquier pieza que no cuadre con el tablero servidor.
- Identificadores duplicados, desconocidos o `__proto__`, registros con campos adicionales y entradas mal formadas.
- Diferencias entre los sectores del registro de órdenes y el mapa de sectores del estado servidor.
- Registros con más de 117 piezas.

Un registro completo y coherente sigue pudiendo producir exclusivamente `CANDIDATE` o `CANDIDATE_SEQUENCE`, **nunca una autorización**. Los identificadores rivales o ausentes solicitados mantienen su denegación uniforme (`UNIT_NOT_ORDERED` / `LEADER_NOT_ORDERED`) antes de comprobar entradas hermanas. Una incoherencia en una entrada distinta devuelve `ORDER_LEDGER_MISMATCH`.

Este cambio no añade órdenes, no modifica el tablero, no registra eventos ni incorpora endpoints HTTP. Tampoco sustituye la comprobación del diario CCWB, la legalidad de cartas o la transacción `BEGIN IMMEDIATE`.

## Pruebas

Se añaden tres pruebas a la suite **ya registrada** `packages/ancients-rules/staged-movement-preflight.test.mjs`:

1. Una orden de líder alterada bloquea la prevalidación individual de una unidad distinta.
2. Una orden de unidad alterada bloquea la prevalidación individual de un líder distinto.
3. Duplicados, campos extra, sectores alterados y piezas inventadas bloquean las tres consultas, sin modificar el estado.

**Verificación de alcance limitado:** siete escenarios V8 aislados sobre el cuerpo real publicado de `staged-movement-preflight.mjs`, con dependencias de dominio simuladas: **7/7 conformes**. No son pruebas nativas `node:test`, ni ejecutan el replay CCWB, SQLite, HTTP/SSE o la regresión integral. El usuario ha suspendido sus pruebas locales; no solicitarlas ahora.

## Bloqueos inalterados

La issue #97 sigue pendiente del reductor reglamentario de *Ancients* básico, de la autorización bajo bloqueo de escritura, del consumo de órdenes, persistencia atómica, idempotencia, replay y del cierre de SEC-001 (#94). Mantener la PR en borrador, sin fusión a `main` ni despliegue.
