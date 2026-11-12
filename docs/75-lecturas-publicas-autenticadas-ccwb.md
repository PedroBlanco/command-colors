# SEC-001 — Lecturas públicas con autorización de sesión en el mismo snapshot SQLite

**12/11/2026.** Seguimiento: [SEC-001 / issue #94](https://github.com/PedroBlanco/command-colors/issues/94). Trabajo experimental, apilado sobre la PR #93. **CCW-015 es el identificador de los dados digitales; no corresponde a este cambio.**

## Problema

El gateway HTTP de laboratorio comprobaba la sesión del usuario y obtenía su bando mediante `identity.resolveSession` e `invitations.getMatch` **antes** de acceder a `getStore(matchId).view(actor)` y `publicEvents(actor)`. Esas llamadas protegían el modo privado y, desde la PR #93, la consistencia de la lectura, pero **no repetían la comprobación de sesión y pertenencia dentro de la instantánea WAL que devuelve el estado o los eventos**.

Una revocación de sesión o pertenencia, iniciada desde otra conexión SQLite después del preflight HTTP y antes de la lectura, no podía revocar retroactivamente la autorización de la vista ya solicitada. El objetivo es cerrar esa ventana para todas las **lecturas HTTP de partidas READY** y los eventos públicos, sin confiar en `actor` suministrado por el navegador.

## Contrato

En `packages/sqlite-store/sqlite.mjs`:

- `store.viewForSession({sessionToken})` acepta **exactamente** un token; cualquier campo `actor`, `sessionUserId` o una clave adicional causa `400 INVALID_PUBLIC_VIEW_REQUEST`. Ejecuta `BEGIN` WAL, verifica token y pertenencia actual a la partida READY, comprueba el modo y devuelve solo la proyección del bando autenticado. Respuestas: `200 PUBLIC_MATCH_VIEW`, `401 UNAUTHENTICATED`, `404 NOT_FOUND` o `409 SECTION_LAB_INTERNAL_ONLY`. No construye ninguna mano de laboratorio al rechazar `LAB_ONLY`.
- `store.publicEventsForSession({sessionToken})` sigue la misma estructura, admite únicamente el token y selecciona **solo** `game_events.visibility='public'` dentro de la misma instantánea. Respuestas: `200 PUBLIC_MATCH_EVENTS` con array, 401, 404, 409 o 400 por petición malformada. Nunca devuelve el diario privado ni `game_commands`.
- Ambas funciones son internas, síncronas, solo lectura y no alteran tablas, revisión, eventos ni idempotencia. Preservan `store.view(actor)` y `publicEvents(actor)` para los consumidores internos existentes y los dobles antiguos de pruebas.

En `packages/local-api/gateway.mjs`:

- **GET partida**, **POST de comandos (solo su preflight)** y el **handshake SSE** prefieren `viewForSession` si el almacén lo implementa; cualquier error autorizado se refleja como un rechazo HTTP limitado a 400/401/403/404/409, con 503 para resultados inesperados.
- **GET eventos** usa directamente `publicEventsForSession` del SQLite real, evitando la combinación previa de dos lecturas independientes. Valida que `events` sea un array antes de serializarlo.
- Los almacenes de pruebas anteriores, que no implementan estas funciones, mantienen la ruta previa `view(actor,{denyExperimentalLab:true})` y `publicEvents(actor,{denyExperimentalLab:true})`, sin perder la defensa sobre el modo `LAB_ONLY`.
- **SSE** revalida el token dentro del snapshot de lectura de cada tick y cierra la conexión cuando recibe sesión caducada, membresía revocada o modo experimental. Solo comunica revisiones públicas en el modo permitido.

**Límite de alcance:** el `POST /commands` sintético **no revalida todavía su sesión dentro de `BEGIN IMMEDIATE`** después de este preflight; eso exige un contrato de autorización en la transacción de mutación y queda abierto en SEC-001. La ruta experimental privada `dispatchExperimentalSectionHistory` ya dispone de una guarda independiente dentro de su bloqueo SQLite. Este parche no autoriza combates, movimiento real ni publicación en Internet.

## Pruebas añadidas

**Diez nuevos casos, en tres suites existentes**:

- **5 SQLite** en `packages/sqlite-store/ancients-section-history.test.mjs`: proyección por sesión A/B sin filtraciones, rechazo de datos privados `LAB_ONLY`, revocación en segunda conexión, retirada de pertenencia desde segunda conexión y eventos públicos con revisión persistida.
- **4 HTTP+SQLite** en `packages/local-api/section-history-http-isolation.test.mjs`: las rutas no deben invocar `view(actor)` cuando existe la API autenticada; rechazo de sesión revocada después del preflight para estado, eventos y handshake SSE.
- **1 SSE** en `packages/local-api/revision-stream-lab-isolation.test.mjs`: al detectar revocación desde `viewForSession`, cerrar sin emitir revisiones.

El manifiesto conserva **71 suites**: son diez *casos nuevos*, no diez suites. Los tests usan cuentas y partidas sintéticas en archivos SQLite temporales. No se ejecuta ningún servidor público.

## Evidencia de esta iteración

Se han ejecutado comprobaciones **aisladas** sobre el código exacto recuperado de GitHub:

- **10/10 comprobaciones** sobre las implementaciones de `viewForSession` y `publicEventsForSession` extraídas directamente del blob `261f50c9d2a7b5988054deab29362ec0857a113e`, con la transacción y las consultas **simuladas**. Incluyen orden de autorización antes de la proyección/SELECT, rechazo de campos extra, revocación, actor ajeno y modo privado.
- **9/9 comprobaciones** sobre `gateway.mjs` del blob `38d2f2079bf45572a8c539b1c1ad9c0ab0da97c8` con servidor y servicios simulados. Incluyen lectura correcta por sesión, denegación 401 posterior al preflight, GET eventos, comandos y handshake SSE, ausencia de llamadas a la API antigua.
- **5/5 comprobaciones** sobre `revision-stream.mjs` del blob `f1fba7ada1da3dc822e09ab3b14eddf31dc399b6` con temporizadores y respuesta simulados. Se comprueba que, tras una revocación, la conexión se cierra y no emite nuevas revisiones.
- Los **seis archivos de implementación y pruebas modificados** pasaron revisión estática de sintaxis en V8, pero eso no sustituye el ejecutor de Node.js.

**Pendiente:** ejecutar las diez pruebas reales con `node --test` y SQLite/HTTP nativos, además de la regresión completa del árbol. No atribuir el resultado Windows previo de la PR #92, ni los siete tests SSE nativos de la PR #93, a este cambio nuevo. No se requieren pruebas manuales del usuario mientras no lo solicite.

## Fusión y despliegue

Mantener esta PR en borrador y apilada sobre la PR #93 hasta conseguir evidencia nativa integrada. `main` y la aplicación de laboratorio habitual permanecen sin modificar. No incluye despliegue, migración de esquema ni habilitación de partidas oficiales.
