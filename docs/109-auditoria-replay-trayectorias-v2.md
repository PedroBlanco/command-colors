# Ancients — auditoría de replay de trayectorias V2

**Fecha:** 14/11/2026 · **Issue:** #97 · **Base:** PR #121 (`feat/ancients-open-foot-path-core-v2`).

## Propósito

Verificar que una propuesta de estado y todas sus transiciones de trayectorias completas de infantería coinciden exactamente con el resultado de **recalcular las acciones desde un estado inicial y una política de reglas aportados independientemente**. No introduce un diario V2 persistido ni una autorización.

Nuevo módulo `packages/ancients-rules/foot-path-v2-replay-audit.mjs` con `auditCoreOpenFootPathReplay` y contrato `PRIVATE_FOOT_PATH_V2_REPLAY_AUDIT`.

Entrada estricta: `trustedInitialState`, `trustedPolicy`, `trustedRowRevision`, `actions`, `proposedState` y `proposedTransitions`. Todos los datos se copian sin ejecutar getters ni trampas `Proxy.get`, se rechazan propiedades extra, listas dispersas, símbolos, ciclos, prototipos no planos y entradas excesivas. No se admiten banderas de autorización.

La función llama a `replayCoreOpenFootPaths` (PR #121), comprueba la revisión de fila **independiente**, compara semánticamente el estado completo y cada transición con su camino íntegro, perfil de combate, revisión, bando y tipo de propuesta. Devuelve el primer índice de transición discrepante. Los fallos no revelan estados parciales. El resultado correcto está desconectado, congelado y marcado siempre `movementAuthorized:false`, `officialMovementAuthorized:false`, `canCommit:false`, `dbChanged:false`.

## Límite de confianza

**La auditoría demuestra coherencia con las entradas, no su procedencia.** No es una firma, un MAC, una prueba de identidad, ni acredita que el estado o la política procedan de una partida real. El llamador futuro deberá recuperar de forma independiente el estado inicial, el escenario, las órdenes, el historial y la revisión desde el servidor, bajo la transacción adecuada. Un cliente que envíe un estado inicial fabricado no obtiene autoridad por pasar esta auditoría.

No se cambian los diarios/eventos V1, ni SQLite, ni HTTP/SSE. Ningún movimiento puede confirmarse mediante este módulo.

## Verificación

Se añade la suite `foot-path-v2-replay-audit.test.mjs` al manifiesto como **88** con **16 pruebas**: uno y dos movimientos, replay vacío, desviación de revisión, estado, ledger, camino, combate, tipo de evento, política, acciones repetidas, contrato V1 incompatible, round-trip JSON, getters, proxies, ciclos, listas dispersas y aislamiento de resultados.

**16/16 pruebas superadas en V8 aislado** con los módulos y tests reales de GitHub; no equivale a ejecutar Node nativo ni SQLite. Las nuevas ramas continúan sin regresión completa nativa. Mantener la PR en borrador sobre #121 y fuera de `main`. Pendiente: diseño del diario V2 y verificación de procedencia transaccional con idempotencia, SEC-001 #94 y autorización de movimientos #97.
