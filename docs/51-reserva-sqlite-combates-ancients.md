# CCW-014 — Reserva transaccional de cribas de combate a distancia (laboratorio SQLite)

**Fecha:** 10/11/2026. **Rama:** `feat/i4-ancients-sqlite-combat-reservations-lab`. **Dependencia:** PR #63 y su cadena de PR abiertas. **Estado:** experimento aislado, **no** conectado a partidas, al servidor HTTP ni al SQLite v1 actual. No es un motor de combate.

## Motivación y aislamiento

El SQLite principal del laboratorio usa un esquema v1 con **seis tablas exactas** e identifica la aplicación con `0x43435742` (`CCWB`); `packages/sqlite-store/schema-version.mjs` **rechaza** tablas inesperadas. Por ello se crea un laboratorio **en otro fichero** mediante `openAncientsReservationLab({file,checkDeclaration})`, en `packages/ancients-rules/sqlite-reservation-lab.mjs`.

El fichero del laboratorio utiliza su propio identificador SQLite `0x4343524c` (`CCRL`), `user_version=1`, WAL, `synchronous=FULL`, claves foráneas y validación de esquema/estructura. Contiene solo tres tablas: `lab_matches` (estado y tablero **de prueba**), `lab_events` (auditoría mínima) y `lab_commands` (idempotencia por partida, bando y clave). Rechaza archivos ajenos, versiones incompatibles y DDL alterado; **no hay migración ni modificación de `main`**.

## Transacción de reserva

El método `reserve({matchId,sessionUserId,attackerId,targetId,expectedRevision,idempotencyKey})` se diseñó para ser llamado exclusivamente desde código confiable del servidor. **`sessionUserId` no es un campo de cliente**: el futuro adaptador deberá resolverlo con autenticación real antes de llamar al módulo. Tampoco acepta `board`, `turnState` ni `movedSteps` procedentes de una solicitud.

La operación se ejecuta con `BEGIN IMMEDIATE`:

1. Comprueba que la partida existe y que el usuario de sesión es uno de los dos participantes; al tercero responde `NOT_FOUND`.
2. Consulta el registro previo de idempotencia. Una repetición exacta recupera la misma reserva; reutilizar la clave con un comando distinto devuelve conflicto.
3. Compara la revisión solicitada con la almacenada, y comprueba que el JSON del turno tiene exactamente esa revisión.
4. Ejecuta `checkDeclaration` sobre copias del tablero y estado cargados **de SQLite**. Solo continúa si devuelve explícitamente `CANDIDATE`, `attackAuthorized:false` y `needsFullLegalityCheck:true`.
5. Inserta una marca `pendingCombat` de tipo `RANGED_SCREENING_ONLY`, incrementa revisión, inserta un evento mínimo sin identidades de unidades ni datos privados y guarda la firma del comando **en la misma transacción**.
6. Ante un error de SQLite o del comprobador, revierte todos los cambios (`ROLLBACK`). Una segunda declaración con otra clave y revisión actual sigue bloqueada por el `pendingCombat` si el comprobador de referencia lo respeta.

**Aclaración esencial:** el marcador es únicamente una **reserva de precomprobación**, no un ataque autorizado ni una tirada realizada. Nunca se devuelve `attackAuthorized:true`. No se implementan confirmación final, cancelación, retirada, dados, daño, combate adicional ni desbloqueo de la marca pendiente. Las pruebas usan un **comprobador de sustitución inyectado**, solo para verificar propiedades transaccionales. No demuestran una integración real con `precheckAncientsRangedDeclaration` de PR #63 ni con las reglas oficiales.

`seedFixture`, `inspectFixture` y `unsafeTestDatabase` son interfaces **exclusivas de laboratorio**. No deben publicarse en HTTP, ni copiarse a producción. El método permite dos conexiones SQLite al mismo fichero; los conflictos verificados se obtuvieron con peticiones sucesivas desde distintas conexiones y la misma revisión; falta una prueba de carreras con procesos simultáneos independientes.

## Pruebas ejecutadas

Comando real en **Linux nativo, Node.js v22.16.0**, sin WSL ni GitHub Actions:

```sh
node --test --test-reporter=tap packages/ancients-rules/sqlite-reservation-lab.test.mjs
```

**17 pruebas PASS, 0 FAIL, 0 SKIP (exitCode 0)**. Cobertura: aislamiento de esquema, transacción y registro atómicos, repetición de claves, conflicto de clave distinta, revisión caducada, participantes y terceros, fallo del comprobador, inyección de error SQL con rollback, reapertura durable de SQLite, dos conexiones que compiten por la revisión, rechazo de aprobación prematura, no filtración en eventos/resultados, DDL alterado, entradas inválidas y aislamiento entre partidas.

Se cotejaron los **blobs Git exactos** del código publicado con los probados:

- `sqlite-reservation-lab.mjs`: `5c04e4b555be1b0a577976c1b347a49df2dda35c`.
- `sqlite-reservation-lab.test.mjs`: `e54374e54ea69a10196103523432d7b40366ee77`.

SHA-256 del archivo TAP generado localmente: `808f6350530952a09103b20407721cef4989355b46facac35cb74d942b880540`. No se suben registros con rutas temporales locales al repositorio.

El manifiesto `scripts/check-browser-lab.mjs` crece a **49 suites**, pero **no se ha ejecutado la regresión integral de 49 suites**, ni las pruebas nativas de Windows ni el flujo web con dos jugadores.

## Puertas antes de integrar

1. Conectar el comprobador real `precheckAncientsRangedDeclaration` de PR #63 en un test E2E de laboratorio con tablero y turno confiables, no usar un `checkDeclaration` arbitrario fuera de pruebas.
2. Definir las migraciones del modelo oficial de partidas y una API de máquina de estados para **resolver o cancelar** una reserva antes de incorporarla al SQLite principal; no mezclar el esquema CCRL y CCWB.
3. Resolver actor desde sesión autenticada; impedir filtraciones de manos, objetivos ocultos y mazos; probar rechazos e idempotencia a través del servicio con dos jugadores.
4. Ejecutar las **49 suites** completas, pruebas Windows/SQLite, pruebas multiconexión/multiproceso, casos de fallo en cada escritura y auditoría de eventos.
5. Mantener la rama y la cadena de PR anteriores en borrador; **no fusionar ni desplegar** hasta completar las puertas anteriores.

**Resultado:** reserva durable de una criba experimental en SQLite aislado, sin activar reglas oficiales ni modificar partidas existentes.
