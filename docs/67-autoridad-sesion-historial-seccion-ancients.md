# CCW-015 — Autoridad de sesión para diario experimental de cartas (CCWB)

**Fecha:** 11/11/2026. **Base de desarrollo:** PR #85, apilada sobre #84. **Estado:** laboratorio interno, sin HTTP nuevo y sin permisos reglamentarios de combate. No desplegar.

## Problema y decisión

El adaptador `sqlite-section-ccwb-bridge.mjs` recibía un `actor` interno (`A`/`B`) ya resuelto. Sin embargo, la composición `openSqliteComposition().getStore()` exponía en su API experimental métodos que también recibían directamente ese bando, sin verificar una sesión dentro de la composición. Un llamante del servidor podría atribuir por error la orden al jugador equivocado.

Ahora `sqlite.mjs` **exige `sessionToken`** en los métodos experimentales y determina el bando exclusivamente mediante `sessions.resolveSession` y `matches.owner_id/guest_id`. La comprobación se realiza en cada solicitud, también después de un reinicio o cierre de sesión, y rechaza usuarios externos a la partida.

## Contrato interno de laboratorio

```js
const store = composition.getStore(matchId);
// Solo el propietario autenticado; trustedSetup es un fixture confiable
// construido en el servidor, NUNCA una carga útil HTTP.
store.initializeExperimentalSectionHistory({
  sessionToken: ownerSessionToken,
  trustedSetup
});

// Proyecciones por sesión, nunca por bando declarado.
const result = store.viewExperimentalSectionHistory({sessionToken: guestSessionToken});

// El actor no es un parámetro del comando.
const recorded = store.dispatchExperimentalSectionHistory({
  sessionToken: ownerSessionToken,
  type: 'PLAY_SECTION_CARD',
  expectedRevision: 0,
  idempotencyKey: 'local_section_0001',
  cardInstanceId: privateCardIdObtainedFromOwnView
});
```

La API anterior `initializeExperimentalSectionHistory('A', setup)` ya no es válida. La versión anterior de `dispatchExperimentalSectionHistory({actor: 'A', ...})` se rechaza: **los campos `actor` y `sessionUserId` están prohibidos**. En ambas operaciones solo se acepta la identidad de la sesión, no un papel aportado por el llamante.

| Situación | Respuesta de la API de laboratorio |
| --- | --- |
| Sesión ausente, inválida o cerrada | `401 UNAUTHENTICATED` |
| Sesión válida, pero usuario ajeno a la partida | `404 NOT_FOUND` |
| Invitado intenta inicializar el diario | `403 FORBIDDEN` |
| Actor/identidad aportados en un comando interno | `400 INVALID_SECTION_LAB_COMMAND` |
| Actor aportado al iniciar/consultar | `400 INVALID_SECTION_LAB_REQUEST` |
| Diario aún no inicializado al consultar o ejecutar | `409 SECTION_LAB_NOT_INITIALIZED` |
| Operación legal | La misma respuesta del adaptador #85, sin token en estado/eventos |

El método genérico `getStore().dispatch(request)` **sigue rechazando** todas las operaciones experimentales con `SECTION_LAB_INTERNAL_ONLY`. `getStore().view(actor)` y `publicEvents(actor)` conservan su interfaz genérica para compatibilidad; los consumidores externos de esas APIs deben continuar obteniendo el actor mediante autenticación propia. Para el modo experimental, se recomienda `viewExperimentalSectionHistory({sessionToken})` en el código interno.

## Integridad de eventos y límites

Cuando la partida está en modo experimental, `publicEvents(actor)` ejecuta una transacción SQLite, reconstruye y coteja el diario mediante `sectionHistory.view(actor)` y **solo entonces** recupera los eventos públicos. Un evento alterado o borrado no se entrega silenciosamente. Para partidas sintéticas anteriores se mantiene el comportamiento existente.

La nueva capa reduce errores de atribución de bando, pero **no es una ruta HTTP**, no convierte en confiable una configuración de escenario aportada por un cliente, no firma criptográficamente la base de datos, ni cambia `CCWB v1`. Una sesión sigue siendo una credencial secreta y jamás debe serializarse en eventos, registros ni respuestas compartidas. La autorización se verifica al entrar en los métodos de composición; la comprobación no pretende resolver revocaciones concurrentes de sesión durante una transacción de otra conexión.

## Pruebas preparadas; ejecución aún pendiente

Se han ampliado las **3 pruebas de composición existentes** con **4 casos adicionales** en `packages/sqlite-store/ancients-section-history.test.mjs`:

- Inicialización solo por propietario con sesión vigente, consultas privadas A/B y rechazo de terceros.
- Rechazo de bando o ID de usuario falsificados, de sesiones inválidas/cerradas, de instrucciones del contrario y comprobación de idempotencia.
- Secuencia A → B de cartas y órdenes, sin autorizar combate.
- Fallo cerrado de consulta de eventos públicos ante una alteración en SQLite.

**Estas 7 pruebas de composición aún no se han ejecutado nativamente en el checkout completo.** Los **66/66 PASS** de las cuatro suites de la PR #85 son evidencia anterior, y **no** validan esta rama. Los tests del manifiesto siguen siendo 63; no se crea una suite nueva. Ninguna prueba integral de Windows/HTTP/SSE/dos navegadores ha sido completada para este cambio.

### Verificación local, sin WSL

En Windows 11 con Node.js compatible, desde la rama con todas las dependencias:

```powershell
node --test --test-reporter=tap packages/sqlite-store/ancients-section-history.test.mjs
$LASTEXITCODE
.\scripts\test-local.ps1
$LASTEXITCODE
```

No fusionar las PR experimentales ni habilitar HTTP/combate hasta validar la regresión y revisar la identidad de los dos usuarios en todas las rutas de acceso. Se mantiene pendiente el conjunto de reglas oficiales de *Ancients*, líderes, retiradas, escenarios y victoria.


## Actualización: control dentro de la transacción (PR posterior)

La afirmación inicial de que la sesión se comprobaba al entrar en los métodos de composición no cubría una posible revocación concurrente **antes** de que SQLite adquiriera el bloqueo de escritura. La rama posterior `fix/i4-ancients-session-guard-in-transaction` añade una segunda resolución de sesión y membresía dentro de `BEGIN IMMEDIATE` para inicialización y comandos. La comprobación exige `DatabaseSync.isTransaction`, y cualquier denegación evita escribir el diario.

Se han preparado **cinco pruebas de integración adicionales** (tres del puente y dos de composición). **No se han ejecutado todavía desde el checkout completo.** Esta modificación no sustituye las pruebas reales de concurrencia multiproceso, HTTP/SSE y dos usuarios. Documento: [revalidación transaccional de sesión](69-revalidacion-sesion-transaction-ccwb.md).


### Límite de coherencia de lectura — actualización de PR #88

Además del guard de escritura, `viewExperimentalSectionHistory({sessionToken})` revalida sesión y membresía dentro de una **transacción de lectura SQLite/WAL `BEGIN`**; la vista privada procede de la misma instantánea. `publicEvents(actor)` usa también una instantánea `BEGIN` para seleccionar modo, verificar el replay y recuperar eventos sin adquirir el bloqueo de escritor. Esta última interfaz sigue siendo **interna**, con autorización del actor a cargo de su llamante.

Se añadieron 2 nuevos casos de integración de lectura (todavía pendientes) y una suite independiente reproducible del contrato SQLite/WAL con **5/5 PASS nativos** en Node.js 22.16.0, Linux sin WSL. La suite está en `packages/sqlite-store/wal-transaction-contract.test.mjs` y se han inventariado **66 suites**. La batería completa sigue pendiente. Véase [PR #88 y la documentación transaccional](69-revalidacion-sesion-transaction-ccwb.md).
