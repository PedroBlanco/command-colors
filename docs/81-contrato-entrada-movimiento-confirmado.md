# LAB-ANC — contrato de entrada para futuro movimiento confirmado

**Fecha:** 12/11/2026. **Issue:** #97. **Base:** PR #96, apilada sobre #95. **Estado: únicamente filtro de forma, sin autorización ni escritura**.

## Frontera entre cliente y autoridad

`screenAncientsMovementCommitIntent(request)` está implementada en
`packages/ancients-rules/movement-commit-intent-screen.mjs`. Es una función
pura que comprueba el formato de una posible petición futura. **No se llama
desde HTTP ni desde el almacén CCWB**, no autentica una sesión, no consulta
órdenes, no calcula reglas, no ejecuta desplazamientos y no crea eventos.
Una petición bien formada produce `INTENT_SHAPE_VALID`, **no** `APPLIED`
ni un permiso de mover una unidad.

Se admiten **exactamente** seis campos:

| Campo | Contrato del filtro |
|---|---|
| `sessionToken` | Cadena entre 16 y 256 caracteres; este filtro **no autentica** ni devuelve el token |
| `expectedRevision` | Entero seguro no negativo; la revisión real queda para el servidor |
| `idempotencyKey` | 8–80 caracteres alfanuméricos, guion o guion bajo, coherente con los diarios privados |
| `kind` | `UNIT` o `LEADER` |
| `pieceId` | ID de ficha válido; ni existencia ni propiedad se comprueban aquí |
| `path` | 1–32 coordenadas `{col,row}` dentro del tablero 13×9; no implica adyacencia ni legalidad |

No se aceptan propiedades extra ni estructuras con prototipos ajenos a
objetos JSON ordinarios, accesores, símbolos, arrays con huecos o propiedades
adicionales. Un `actor`, `matchId`, `board`, `terrain`, `hand`,
`cardInstanceId`, `journal`, `contextDigest` o
`movementAuthorized` aportado por el solicitante causa rechazo. La
respuesta de rechazo es uniforme: `BLOCKED / INVALID_MOVEMENT_INTENT`.

Una respuesta `INTENT_SHAPE_VALID` contiene una copia inmutable del
intent mínimo, **nunca** el token de sesión, el bando o el tablero; conserva
siempre `movementAuthorized:false`, `attackAuthorized:false`,
`stateChanged:false` y `needsFullLegalityCheck:true`. La función
admite formas que una regla posterior denegará (por ejemplo, rutas no
adyacentes): **solo verifica la forma, no la legalidad**.

## Integración futura: prohibiciones

- **No convertir `INTENT_SHAPE_VALID` en movimiento confirmado**. El
  reductor reglamentario deberá validar de nuevo autenticación, pertenencia,
  revisión, turno, cartas, órdenes, trayecto, terreno y líder/unidad en la
  misma transacción `BEGIN IMMEDIATE` de CCWB/SQLite, tal como establece el
  [contrato de movimientos autorizados](80-contrato-futuro-movimiento-autorizado-ancients.md).
- **No usar el resultado de esta función como credencial**. Solo el
  servidor conserva `sessionToken` para resolver identidad, y no debe
  publicar ese valor en eventos, registros ni vistas.
- **No incluir `CANDIDATE_EVIDENCE` ni `contextDigest` en la petición
  de confirmación**: la traza candidata no aporta autorización.
- No publicar endpoint, SSE, API ni intérprete de jugadas reales mientras
  SEC-001 (#93) y la revisión de reglas estén bloqueadas.

## Pruebas nativas exactas

Suite nueva: `packages/ancients-rules/movement-commit-intent-screen.test.mjs`,
**13 casos** (peticiones válidas e inmutabilidad, rechazo de propiedades
extra, identidad, tokens, revisiones, claves, coordenadas, rutas no legales
sin autorizar, huecos de arrays, prototipos, símbolos, accesores, proxy
hostil y determinismo de parseo). Añadida a `LOCAL_TEST_FILES`:
**77 suites** en esta rama.

Ejecución en **Node.js 22.16.0 nativo**, reconstruyendo tres archivos de
blobs GitHub y contrastando con `git hash-object`:

- Filtro: `802664fed3c6d09ec2185bfeee24ddfa9a4337e2`.
- Suite: `c6d165b88ccd7d581a787e14d17838fa39f4e18c`.
- Dependencia geométrica íntegra `hex-grid/hex.mjs`:
  `ae0e4526b8e91c4c0d5d94aebc52077b60f410da`.

Resultado **13 PASS / 0 FAIL / 0 SKIP, salida 0**, TAP SHA-256
`b1648601e7a854ffdecb0ab507ff9af43af58ac7b32692bf0ba29283dac26078`.

**Límites de esta evidencia:** se ejecuta exactamente la nueva suite
con sus dos dependencias reales; **no** se ejecuta el repositorio completo,
la composición CCWB/SQLite, el gateway HTTP/SSE ni la regresión de 77 suites.
No permite fusionar esta rama ni desplegar. No se usaron WSL, Docker
ni GitHub Actions; `main` no se modifica.
