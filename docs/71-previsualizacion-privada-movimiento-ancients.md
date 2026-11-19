# CCW-015 / R-04–R-05 — Previsualización privada y autenticada de movimiento

**Fecha:** 12/11/2026. **Dependencia:** PR #89 (filtro puro), que depende de la PR #88 (sesión y transacciones SQLite). **Alcance:** laboratorio interno, sin ruta HTTP, sin escritura ni movimiento real.

## Resultado

`openSqliteComposition().getStore(matchId).precheckExperimentalSectionMovement(request, trustedContext)` permite solicitar una **consulta de movimiento** vinculada a la sesión activa de un jugador y al diario de cartas y órdenes CCWB. Su único resultado favorable es una **ruta candidata** a revisión reglamentaria posterior; **nunca autoriza movimiento o combate**.

La petición ordinaria contiene **exactamente**:

```js
{
  sessionToken: 'TOKEN-DE-SESION',
  expectedRevision: 2,
  unitId: 'unitA',
  path: [{col:3,row:4}]
}
```

El código de servidor, y **nunca el cliente**, proporciona por separado el contexto de escenario:

```js
{
  unitTypes: {unitA:'LIGHT_INFANTRY',unitB:'HEAVY_INFANTRY'},
  terrain: []
}
```

Esta API es exclusivamente una **interfaz interna de laboratorio**: no conectar a HTTP, WebSocket ni SSE hasta disponer de escenarios confiables, reglas oficiales verificadas y un contrato de respuestas público revisado. El contexto anterior es sintético y no representa ningún escenario oficial.

## Fronteras de seguridad y coherencia

1. **Validación de entrada:** esquema cerrado de cuatro campos; no acepta `actor`, `sessionUserId`, `serverContext` ni claves extra. La revisión es entera no negativa, la unidad tiene identificador válido y la ruta comprende 1–32 celdas enteras dentro del tablero 13×9.
2. **Sesión y pertenencia:** se resuelve la sesión vigente y se deriva el bando A/B de la membresía de la partida; nunca se utiliza un bando proporcionado por el navegador. El ajeno a la partida recibe `NOT_FOUND`; el token revocado, `UNAUTHENTICATED`.
3. **Una instantánea WAL:** identidad, pertenencia, modalidad experimental y estado privado verificado se leen bajo `readSnapshot(BEGIN)`. Si otra conexión tiene un escritor `BEGIN IMMEDIATE`, la lectura ve el último estado **confirmado** sin esperar un bloqueo de escritura.
4. **Revalidación del diario:** el puente llama a `verify` sobre el estado real de SQLite: reconstruye los comandos privados, valida idempotencia, firmas versionadas, eventos públicos y revisión antes de suministrar el snapshot al filtro `precheckStagedAncientsMovement`. Las adulteraciones fallan con error, nunca producen un candidato.
5. **Contexto confiable:** los perfiles de movimiento de todas las unidades y el terreno se reciben como segundo parámetro interno, procedente del escenario del servidor. No basta con que el cliente declare que un perfil es confiable. Un contexto faltante, parcial o inventado falla cerrado.
6. **Privacidad y efectos:** la respuesta solo contiene `{status,code,preview}`; nunca entrega manos, mazo, comandos privados ni idempotencia. No actualiza `matches`, `game_events` ni `game_commands`. Todas las respuestas de la prevalidación conservan `movementAuthorized:false`, `attackAuthorized:false` y `stateChanged:false`.

### Contrato de respuesta

- `400 INVALID_SECTION_LAB_MOVEMENT_REQUEST`: formato inválido o campos extra.
- `401 UNAUTHENTICATED` o `404 NOT_FOUND`: sesión o pertenencia insuficiente.
- `409 SECTION_LAB_NOT_INITIALIZED`: no existe historial experimental para esta partida.
- `200 SECTION_LAB_MOVEMENT_PREVIEW`: incluye `preview.status` = `BLOCKED`, `REQUIRES_RULE_EXCEPTION` o `CANDIDATE`, todos **sin autorización de ejecutar**.
- Un diario adulterado o un contexto de escenario inválido hace fallar la consulta: no debe ocultarse ni convertirse en una aceptación.

La transacción devuelve un estado estable de una instantánea SQLite. **No garantiza la revocación retroactiva de una consulta iniciada antes del commit** de un logout, ni concede derecho a ejecutar el movimiento después de la consulta. Una futura transición de escritura **deberá volver a validar sesión, revisión, órdenes y reglas bajo `BEGIN IMMEDIATE`**, sin basarse en un candidato antiguo.

## Ejecución reproducible y evidencia

Implementación en `packages/sqlite-store/sqlite.mjs` y `packages/ancients-rules/sqlite-section-ccwb-bridge.mjs`. Se añadieron **seis casos de integración** a `packages/sqlite-store/ancients-section-history.test.mjs`, con cuentas e invitaciones reales del laboratorio, archivo SQLite/WAL y segunda conexión:

- Lectura de órdenes persistidas, persistencia tras reapertura, ausencia de modificaciones en las tres tablas y de exposición de cartas ajenas.
- Bloqueo de suplantación, personas externas, sesiones caducadas, campos inesperados, rutas inválidas y revisión obsoleta.
- Instantánea de lectura mientras otro escritor elimina una sesión sin confirmar, seguida del rechazo tras el commit.
- Ausencia de transacciones abiertas después de un error por contexto de escenario inválido.
- Detección de manipulación del evento público y denegación antes/después de las fases de orden.

**Pruebas ejecutadas con Node.js 22.16.0/Linux nativo, sin WSL ni GitHub Actions**: ejecución conjunta de 3 suites —`staged-movement-preflight.test.mjs`, `sqlite-section-ccwb-bridge.test.mjs` y `ancients-section-history.test.mjs`—: **52/52 PASS, 0 FAIL, 0 SKIP, exit 0**. Informe TAP SHA-256: `0244d48c9bbd5d44f38310234ebe15cc295417f15c9a9951252e85b2927659c2`.

**Identidad exacta código publicado/ejecutado (hash blob Git)**:

- `packages/sqlite-store/sqlite.mjs`: `54122eb148d0cd265cfdca542ab1def1a8798766`.
- `packages/ancients-rules/sqlite-section-ccwb-bridge.mjs`: `5683d651bcba5538886205f5bd33f00a71efcc3c`.
- `packages/sqlite-store/ancients-section-history.test.mjs`: `496f6e0c1bd7f96c9adb8e6791ffa05da3c79c8e`.

No se incorpora una nueva suite al manifiesto: siguen **69 suites inventariadas**; las 52 pruebas son el subconjunto ejecutado, **no una regresión total**.

### Reproducción en Windows 11 (sin WSL)

```powershell
node --test --test-reporter=tap packages/ancients-rules/staged-movement-preflight.test.mjs packages/ancients-rules/sqlite-section-ccwb-bridge.test.mjs packages/sqlite-store/ancients-section-history.test.mjs
$LASTEXITCODE
.\scripts\test-local.ps1
$LASTEXITCODE
```

## Bloqueos para la integración real

Siguen pendientes la regresión de 69 suites, Windows 11 sin WSL, validación HTTP/SSE y dos navegadores, escenarios oficiales, reglas completas de movimiento/líderes y transición de escritura con autorización transaccional. **No fusionar ni desplegar todavía.**
