# CCW-014 — Reserva y cancelación de cribas de combate a distancia (SQLite independiente)

**Fecha:** 10/11/2026. **Rama:** `feat/i4-ancients-sqlite-combat-reservations-lab`, basada en PR #63. **Estado:** laboratorio experimental aislado, sin conexión a la API HTTP ni a partidas del SQLite principal. No implementa combates oficiales.

## Por qué está separado

El almacenamiento actual de partidas usa **seis tablas exactas** y `application_id=0x43435742` (`CCWB`); el verificador `packages/sqlite-store/schema-version.mjs` rechaza tablas no previstas. La reserva experimental vive en **otro fichero** mediante `openAncientsReservationLab({file,checkDeclaration})` y usa `application_id=0x4343524c` (`CCRL`), `user_version=1`, tres tablas (`lab_matches`, `lab_events`, `lab_commands`), WAL, `synchronous=FULL`, claves foráneas, comprobación de integridad y comparación estricta del DDL.

El adaptador `openGuardedAncientsReservationLab({file})`, en `sqlite-guarded-reservation.mjs`, **conecta de verdad** el laboratorio a `precheckAncientsRangedDeclaration` de PR #63. Este último comprueba turno, fase, orden y registro de movimiento, unidad atacante, alcance, adyacencia, línea de visión y límites ordinarios por terreno. Sus resultados siguen siendo **parciales** y nunca conceden `attackAuthorized:true`.

## Contrato de reserva

`reserve({matchId,sessionUserId,attackerId,targetId,expectedRevision,idempotencyKey})` se invoca solo desde código confiable. **El `sessionUserId` ha de proceder de la sesión autenticada por el servidor, nunca del cuerpo HTTP**; la aplicación web todavía no llama a esta operación. El estado del turno y el tablero proceden únicamente de SQLite. La transacción `BEGIN IMMEDIATE`:

1. Resuelve pertenencia a la partida y bando del usuario; terceros reciben `NOT_FOUND`.
2. Identifica un reintento exacto mediante clave de idempotencia y firma semántica, o rechaza una reutilización distinta.
3. Comprueba revisión, ejecuta el validador de la declaración sobre copias del estado confiable y **solo** acepta `CANDIDATE` con `attackAuthorized:false` y `needsFullLegalityCheck:true`.
4. Inserta un `pendingCombat` tipo `RANGED_SCREENING_ONLY`, incrementa revisión, registra evento público mínimo y almacena clave y firma **atómicamente**. Ninguna tirada ni regla de daño se ejecuta.
5. Si falla una escritura o el validador, revierte toda la transacción. Declaraciones adicionales sobre el turno con combate pendiente quedan rechazadas por el guard real.

La reserva es un **bloqueo persistente de una comprobación previa**, no una autorización de combate, orden legal definitiva ni ataque resuelto.

## Cancelación limitada y segura

`cancel({matchId,sessionUserId,reservationId,expectedRevision,idempotencyKey})` opera **solo sobre una marca de criba todavía pendiente y sin resultados aleatorios**.

- Comprueba participante, bando que creó la reserva, UUID de la reserva, coincidencia exacta y revisión.
- Elimina únicamente `pendingCombat`, incrementa revisión y registra un evento mínimo `RANGED_SCREENING_CANCELLED`, guardando la clave de idempotencia en una sola transacción.
- Reintentar exactamente el mismo comando devuelve `ALREADY_CANCELLED`; reutilizar la clave con otros parámetros produce conflicto.
- No cambia `resolvedBattleUnitIds`, unidades, tablero, cartas o efectos de escenario, y no autoriza disparos.
- Tras cancelar puede reservarse una nueva criba con **la revisión y clave nuevas**. Se mantiene auditable el historial.
- Nunca debe aplicarse a combates reales con tiradas o acciones aleatorias: la futura política de deshacer seguirá necesitando control y acuerdo cuando proceda.

Los eventos públicos solo contienen `sequence`, `type` y `side`; ni IDs de unidades, reservas, manos ni geometría de LOS.

`seedFixture`, `inspectFixture` y `unsafeTestDatabase` se exponen **solo para pruebas locales**, y no se deben publicar en un servicio ni utilizar con jugadores reales. En particular, `sessionUserId` es un parámetro interno de la prueba; falta un gateway que lo derive de una sesión HTTP real.

## Evidencias reproducibles

Pruebas nativas realizadas con **Node.js 22.16.0 en Linux**, sin WSL ni GitHub Actions:

```sh
node --test --test-reporter=tap \
  packages/ancients-rules/sqlite-reservation-lab.test.mjs \
  packages/ancients-rules/sqlite-guarded-reservation.test.mjs
```

**33/33 pruebas PASS; 0 FAIL; 0 SKIP; exitCode 0**.

- **23** pruebas del almacén: transacciones, rollback ante fallos de escritura, reapertura, idempotencia, dos conexiones, aislamiento entre partidas, schema estricto, pertenencia, seguridad y seis casos de cancelación.
- **10** pruebas del adaptador **reglamentario real**: criba positiva, ataque pendiente, actor, fase, órdenes, bosque que bloquea LOS, enemigo adyacente, rechazo de reglas sintéticas, cancelación y nueva reserva en otra conexión, tablero inválido y ausencia de filtraciones.
- El test de dos conexiones comprueba conflictos secuenciales entre conexiones independientes, **no** una carrera simultánea multiproceso. No se ha ejecutado aún la batería completa del proyecto.

Los archivos probados localmente tienen estos mismos blobs Git publicados:

| Archivo | Git blob SHA |
| --- | --- |
| `sqlite-reservation-lab.mjs` | `8559ba7cc80614abad0c4cbe620986833020d3ee` |
| `sqlite-reservation-lab.test.mjs` | `61c9202003b96012504b9fb3dde3813de2847611` |
| `sqlite-guarded-reservation.mjs` | `2704ca7df645380727dc35eaa4e37badf05aff3f` |
| `sqlite-guarded-reservation.test.mjs` | `210d1d0ddd8379b52bd21f442994cbcadb158405` |

Se cotejaron asimismo los hashes de **todas las dependencias reales** (geometría, perfiles, terreno, LOS, guardas y disparos) con los blobs de las PR #59–#63.

SHA-256 del registro TAP local combinado: `c621df46888d433c46ec7f19ffbac6d8de260d73fbc4ddc5cacf7eef18b44ef6`. No se incluyen archivos locales ni registros de pruebas con rutas temporales en el repositorio.

El manifiesto `scripts/check-browser-lab.mjs` incorpora la nueva suite: **50 suites registradas**. Su registro no equivale a haber ejecutado las 50; quedan pendientes la regresión integral, SQLite del proyecto, las pruebas nativas Windows y los flujos HTTP/SSE de dos jugadores.

## Limitaciones y próximas puertas de integración

1. Conectar la operación a la **sesión HTTP autenticada**, con protección CSRF, comprobación de acceso y proyecciones privadas; no permitir que el cliente dicte lado, estado, cartas ni mapa. Las pruebas del adaptador SQLite **no sustituyen** pruebas de API.
2. Diseñar la evolución/migración del modelo de partida oficial sin añadir tablas informalmente al esquema principal CCWB v1 ni tratar el prototipo de cartas sintéticas como reglamento de Ancients.
3. Implementar **resolución real** de combates, dados automáticos/manuales, reacciones, retiradas, efectos de cartas y excepciones. Hasta entonces solo existe reserva/cancelación de una criba.
4. Añadir carreras multiproceso, inyección de fallos en cada punto de escritura, privacidad y seguridad E2E.
5. Ejecutar **50 suites completas**, Windows/SQLite y flujos reales de dos sesiones, además de validación de tablero PC/móvil.
6. Mantener PR y dependencias en **borrador; no fusionar ni desplegar** hasta superar las verificaciones.

**Resultado:** criba real de Ancients conectada a reserva y cancelación transaccionales en SQLite **aislado**, sin implementar todavía el combate oficial ni modificar las partidas actuales.
