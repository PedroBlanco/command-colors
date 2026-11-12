# LAB-ANC — consulta privada de intención y tablero simulado, sin commit

**Fecha:** 12/11/2026. **Rama:** `feat/lab-anc-movement-candidate-audit-trail` (PR #96). **Estado:** contrato **exclusivamente interno** y de solo lectura. No se añade endpoint HTTP/SSE, ni persistencia, ni autorización de jugadas.

## Necesidad y alcance

Después de consolidar el filtro de solicitudes no fiables de [PR #99](81-contrato-entrada-movimiento-confirmado.md) y el reductor sintético originado en [PR #98](82-reductor-movimientos-lab-un-hexagono.md), se añade una **composición privada de ambos contratos**:

`previewPrivateOneHexAncientsIntent({request,authenticatedActor,verifiedSectionState,serverContext,policy})`.

Su único propósito es proporcionar un tablero **hipotético** tras un movimiento de unidad de infantería de un solo hexágono y terreno enteramente abierto. La respuesta favorable es `PRIVATE_LAB_SIMULATION`, **nunca** `APPLIED`, `AUTHORIZED` o movimiento confirmado.

### Fronteras

1. El `request` no es fiable. Primero se comprueba su forma con `screenAncientsMovementCommitIntent`: token, revisión, clave de idempotencia, tipo, pieza, ruta; no admite `actor`, `matchId`, tablero, cartas, terreno ni resultado calculado desde el navegador.
2. **Esta función no autentica el token.** El llamador debe obtener `authenticatedActor` de la sesión y pertenencia de partida vigentes, leer `verifiedSectionState` después de verificar **el replay del diario privado**, y proporcionar `serverContext` y `policy` desde el servidor. Estas garantías no existen en la función pura y deben comprobarse en un futuro punto de composición bajo la misma instantánea.
3. El contrato no acepta líderes ni más de un paso por petición; no pasa el token de sesión ni la clave de idempotencia al reductor.
4. El reductor `reduceOneHexClearLab` exige `SYNTHETIC_OPEN_HEX_V1`, terreno vacío, ausencia de líderes, perfiles autorizados para laboratorio, carta y órdenes staged, actor, turno y revisión coherentes, adyacencia y no solapamiento. Cualquier fallo devuelve `BLOCKED` sin tablero ni movimientos parciales.
5. Un resultado favorable contiene `simulatedBoard` y `moves` inmutables. **No** incluye manos, cartas ni el token, y siempre lleva `canCommit:false`, `movementAuthorized:false`, `officialMovementAuthorized:false`, `attackAuthorized:false`, `stateChanged:false`, `needsFullLegalityCheck:true` y `labSimulationOnly:true`.

**Advertencia:** Una credencial de aspecto válido, o el parámetro `authenticatedActor` por sí solo, **no prueban que exista una sesión real**. Por diseño no se puede invocar este helper directamente desde un controlador HTTP. Su futuro uso requiere pasar por la composición SQLite/CCWB y la guardia SEC-001 (#93), no por una ruta alternativa.

## Pruebas y estado

Se han agregado **11 casos preparados** en `private-one-hex-intent-preview.test.mjs`: tablero simulado e inmutable, rechazo de actor/política/tablero falsificados, validación antes de consultar estado privado, ausencia de autenticación en la propia función, ruta limitada a una unidad y un paso, revisión/órdenes/bando adversario, terreno/política, líderes, privacidad de manos/tokens, imposibilidad de mutar el resultado y determinismo.

La nueva suite es la **79** del manifiesto consolidado (76 heredadas, filtro de entrada, reductor sintético y esta composición). **11/11 casos de esta suite evaluados en V8 aislado con modo estricto**, cargando los 14 módulos reales de reglas desde GitHub y sustituyendo exclusivamente `structuredClone` por clonación JSON y los imports `node:crypto`/`node:util` no ejercitados. **No se ha ejecutado con Node.js nativo**, ni las siete nuevas pruebas de integración real CCWB/SQLite, ni la regresión de 79 suites. La evidencia anterior de **13/13** del filtro de entrada (Node nativo) y **11/11** del reductor puro (V8 aislado) corresponde a módulos y suites anteriores y **no valida automáticamente este nuevo helper**.

No existe un reductor reglamentario completo ni una operación que consuma una orden o actualice un tablero de partida. Sigue pendiente la [issue #97](https://github.com/PedroBlanco/command-colors/issues/97) y el diseño de [contrato de commit](80-contrato-futuro-movimiento-autorizado-ancients.md).

**Condición de integración:** ejecutar pruebas nativas en árbol exacto, validar sesión y replay en SQLite/WAL, resolver #93, verificar seguridad bilateral y regresar las 79 suites antes de fusionar en `main` o desplegar.


### Integración privada autenticada con CCWB

El nuevo método interno `precheckExperimentalSectionOneHexIntent` une validación de sesión y pertenencia, selección de partida y replay completo del diario dentro de una sola instantánea SQLite/WAL. El puente calcula únicamente `PRIVATE_LAB_SIMULATION`, nunca autoriza un movimiento. Se han escrito **7 casos nuevos de integración** aún no ejecutados; véase [documento 84](84-composicion-ccwb-simulacion-autenticada.md). El contrato no ha sido conectado a HTTP/SSE ni a ninguna mutación de partida.
