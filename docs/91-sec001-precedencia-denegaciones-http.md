# SEC-001 — precedencia de denegaciones y supresión de vistas privadas

**Fecha:** 13/11/2026  
**Rama:** `fix/sec001-public-error-precedence`, basada en `test/sec001-parity-revocation-branches@3bcbddcbd3f23394636d8fe1eab1ec9ae53a1cea` (PR #103).  
**Alcance:** gateway HTTP local. Sin cambios en el motor, SQLite, CSS, escenarios, comandos de juego o despliegue. `main` intacta.

## Riesgo identificado

El gateway `packages/local-api/gateway.mjs` dispone de un filtro para denegar lecturas de laboratorios privados, pero originalmente evaluaba el marcador `LAB_ONLY` **antes** del código de identidad `UNAUTHENTICATED` o pertenencia `NOT_FOUND`. Si un adaptador nuevo, obsoleto o defectuoso devolviera un objeto inconsistente como `{status:'LAB_ONLY',code:'UNAUTHENTICATED'}`, el gateway comunicaría `409 SECTION_LAB_INTERNAL_ONLY` en lugar de `401 UNAUTHENTICATED`. Esto revela el modo interno de una partida a quien ya no debe conocerlo.

La comprobación es de **defensa en profundidad**: no se afirma que el almacén SQLite actual produzca esa combinación de campos. El valor está en impedir que futuras implementaciones o errores de composición cambien la precedencia de autorización.

Una segunda frontera afecta a respuestas de **mutaciones**: inicialización del mazo y comandos serializaban `result.view` si el adaptador lo devolvía, siempre que coincidiese `matchId`, incluso si el resultado contenía una denegación de acceso. Una vista adherida accidentalmente a un error no debe llegar al navegador. **Las vistas devueltas legítimamente en `STALE_REVISION` o en rechazos de turno siguen siendo compatibles**.

## Comportamiento implementado

`publicReadError` se aplica a las lecturas de partida, eventos y SSE inicial y ahora prioriza:

1. `UNAUTHENTICATED` → HTTP 401 con solo `{code:'UNAUTHENTICATED'}`.
2. `NOT_FOUND` → HTTP 404 con solo `{code:'NOT_FOUND'}`.
3. `SECTION_LAB_INTERNAL_ONLY` o `status:'LAB_ONLY'` → HTTP 409 con solo el código genérico de laboratorio interno.
4. Otros estados → se mantienen los contratos existentes.

Después de `initializeCommandDeckForSession` y `dispatchForSession` (y sus adaptadores de laboratorio heredados), el gateway vuelve a aplicar esta barrera **antes de leer, comprobar o serializar una vista**. Si la operación ha sido denegada con uno de esos tres códigos, responde exclusivamente con el código estandarizado. Esto no sustituye la autorización transaccional bajo `BEGIN IMMEDIATE` ni crea permisos nuevos.

No se confía en mensajes, manos, actores o secretos del cuerpo de error. En un conflicto entre un marcador privado y un código de sesión, este último prevalece.

## Pruebas y evidencia

`packages/local-api/gateway.test.mjs` incorpora **cuatro pruebas HTTP** en dos grupos:

- Lectura de partida, eventos y comandos con el estado ficticio combinado `LAB_ONLY + UNAUTHENTICATED/NOT_FOUND`. Se comprueban los códigos 401/404, sin datos privados, sin despacho ni lectura de eventos.
- Eventos revalidados después de una vista inicialmente válida: un adaptador que devuelve un marcador mixto en su segunda lectura no revela el laboratorio.
- Inicialización del mazo en un adaptador que añade deliberadamente una mano secreta del **mismo match** a una respuesta denegada: 401/404/409 sin `state`.
- Comando con vista privada adjunta a un error con el mismo `matchId`: 401/404/409 sin `state`.

**Verificación realizada:** sintaxis JavaScript aislada del gateway y de la suite; **9/9 comprobaciones V8 aisladas** sobre el cuerpo auténtico de `publicReadError`, incluyendo errores mixtos, respuestas con `view`, laboratorio privado y `STALE_REVISION` no reclasificado. Se verificó también que los filtros de inicialización y de comando se encuentran antes de cualquier comprobación/serialización de `result.view`.

**Límite:** las cuatro pruebas HTTP nuevas están **escritas, no ejecutadas con el servidor HTTP/Node real**; la regresión de 80 suites del árbol nuevo tampoco se ha ejecutado. El usuario ha suspendido temporalmente las pruebas y no se requiere que las ejecute ahora. Estos cambios no validan por sí solos SEC-001 ni el permiso para desplegar.

## Integración y próximos pasos

- Mantener esta PR como borrador sobre PR #103; esta conserva las doce pruebas SEC-001 recuperadas y la auditoría completa del manifiesto.
- Al reanudar voluntariamente pruebas, ejecutar el conjunto prioritario de doce suites y después la regresión completa; registrar el SHA exacto y resultados TAP, sin WSL/Docker/Actions.
- No fusionar en `main` ni habilitar movimientos oficiales de *Ancients* mientras falten el reductor reglamentario confirmado, la validación del escenario/reglas y el cierre de SEC-001.
