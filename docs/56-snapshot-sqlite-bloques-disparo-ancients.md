# CCW-015 — Pérdidas de bloques con tirada y tablero de la misma revisión SQLite

**Fecha:** 10/11/2026. **Rama:** `feat/i4-ancients-sqlite-block-loss-snapshot` (basada en la PR #68). **Estado:** laboratorio SQLite de solo lectura, sin autorización de batalla, sin HTTP ni efectos aplicados.

## Objetivo

El módulo puro `block-loss-preview.mjs` de la PR #68 podía calcular bloques perdidos a partir de valores explícitos, pero todavía no derivaba los datos de una partida. Este incremento conecta ese cálculo a la **tirada oficial preliminar persistida** por la PR #67, el tipo de unidad objetivo, sus `blocksRemaining` y el líder asociado, leyendo siempre desde el **SQLite aislado CCRL**, no desde una petición del navegador.

No cambia el esquema del laboratorio de **tres tablas** ni el almacenamiento principal `CCWB` v1 de seis tablas. No introduce rutas HTTP, migraciones ni partidas oficiales. Los valores del tablero siguen siendo **datos de fixtures del laboratorio**, no escenarios importados del juego.

## Operación transaccional de solo lectura

`previewStagedBlockLoss({matchId,sessionUserId,reservationId,expectedRevision})`, en `packages/ancients-rules/sqlite-reservation-lab.mjs`, usa `BEGIN IMMEDIATE` y lee `lab_matches` en **una transacción**:

1. Resuelve al participante mediante `sessionUserId`, cuyo origen debe ser una **sesión autenticada por servidor**. El propietario de la reserva puede consultar la previsualización; el adversario no recibe resultados privados (`PREVIEW_NOT_AVAILABLE`) y los terceros reciben `NOT_FOUND`.
2. Exige que `expectedRevision` coincida con la revisión de la partida **y** del estado `turn_json`.
3. Requiere `RANGED_DICE_STAGED_OFFICIAL_PREVIEW`, reserva y actor correspondientes, y un **resumen SHA-256 del tablero** almacenado al registrar los dados; compara ese resumen con los bytes actuales de `board_json`.
4. Recupera la tirada completa, el objetivo y el plan oficial **desde SQLite**, y vuelve a ejecutar `interpretBaseAncientsRangedDice`. Compara la interpretación recalculada con la guardada para detectar discrepancias.
5. Determina el tipo y `blocksRemaining` del objetivo del tablero, valida que coincide con el plan de dados, que el atacante pertenece al bando esperado y que las unidades no comparten hexágonos. Comprueba líderes, bandos y colocación para derivar `leaderAttached` por **coincidencia de casilla**, sin aceptar un indicador externo.
6. Llama a `previewBaseAncientsRangedBlockLoss` con los datos anteriores. Solo devuelve `BLOCK_LOSS_PREVIEW` con revisión y un objeto de cálculo **inmutable**; **no escribe** estado, eventos ni claves de comando.

El resumen SHA-256 está diseñado para detectar **deriva accidental del tablero** entre el momento de la tirada y su lectura posterior. **No es una firma frente a quien pueda escribir directamente la base**: alguien con control de SQLite podría alterar tanto el tablero como el resumen. La protección real requiere mantener el acceso exclusivo a SQLite en el servidor y definir una política de escritura autorizada.

## Modos de fallo seguros y compatibilidad

- Un objetivo sin `blocksRemaining` explícito, con número cero, negativo, fraccionario o mayor que el máximo inicial reglamentario **no puede previsualizar pérdidas**. No se inventan bloques iniciales.
- Un líder ausente de la colección `leaders` **no se interpreta** como líder no asociado: se rechaza el tablero incompleto. Una colección vacía válida indica que el escenario no tiene líderes.
- Se rechazan dados sintéticos anteriores, tipo de objetivo modificado, líder en la casilla contraria, varias piezas en la misma casilla, mano de otro jugador, tirada modificada, contadores cacheados inconsistentes y unidad que figure ya como combatida.
- Los resultados oficiales preliminares de la PR #67 registrados **antes** de este incremento no tienen `boardSnapshotSha256`. **Siguen disponibles para las operaciones anteriores**, pero la nueva previsualización de pérdidas los rechaza: no puede acreditarse retrospectivamente que el tablero seguía idéntico.
- Las nuevas reservas oficiales añaden el resumen **al registrar sus dados**. No se modifican planes sintéticos históricos ni se exige una migración de tablas.
- No se aceptan propiedades `board`, `blocksRemaining`, `matchingColorHits`, `unitType` o `leaderAttached` en la solicitud. La fuente única es el estado de SQLite y la interpretación del resultado allí almacenado.

La futura API deberá obtener `sessionUserId` de una sesión real; el método **no está publicado en HTTP**. Las interfaces `seedFixture`, `inspectFixture` y `unsafeTestDatabase` siguen siendo exclusivamente de pruebas y no pueden ofrecerse a usuarios.

## Qué resultados produce y qué no

La respuesta puede indicar `blocksToRemove`, `excessHits`, `remainingBlocks`, eliminación provisional, `possibleVictoryBanner`, banderas pendientes y propuesta de comprobación de baja de un líder asociado. Las propuestas están sujetas a reglas completas y casos especiales.

Se conserva expresamente:

```text
attackAuthorized = false
combatResolved = false
boardMutated = false
hitsApplied = false
bannerAwarded = false
flagsResolved = false
leaderChecksResolved = false
```

No elimina bloques ni líderes, no modifica cartas, no otorga estandartes y no resuelve banderas o retiradas. No equivale a aplicar el combate a la partida. **No se permite deshacer tiradas aleatorias** mediante la cancelación de reservas.

## Pruebas nativas

Ejecutadas con **Node.js v22.16.0 en Linux nativo**, sin WSL ni GitHub Actions:

```sh
node --test --test-reporter=tap packages/ancients-rules/*.test.mjs
```

**143/143 pruebas PASS, 0 FAIL, 0 CANCELLED, 0 SKIP** en **8 archivos de pruebas** de los módulos Ancients disponibles en el entorno local. Incluye los **30 casos nuevos** de `sqlite-block-loss-preview.test.mjs`, las 24 pruebas puras de la PR #68 y las 89 pruebas previas de dado oficial y SQLite.

Las pruebas nuevas cubren: pérdida de bloques con tirada original, últimas bajas, exceso de impactos, banderas pendientes, líderes asociados/no asociados, selección de actor, reintento tras reapertura, revisión caducada, resultado antes de tirar, versiones sintéticas excluidas, datos externos rechazados, inexistencia de cambios y eventos, tablero diferente al del momento de captura, falta de bloques, roll y caché alterados, identificador y actor del dado, objetivos y líderes incompatibles, y generación digital sin volver a tirar.

Se ha comprobado la **coincidencia exacta entre los blobs Git de código/prueba y las copias ejecutadas**:

| Archivo | SHA Git blob |
| --- | --- |
| `ranged-block-snapshot.mjs` | `9de9be25bde1b1eedc1757411a28c29ace17b1df` |
| `sqlite-reservation-lab.mjs` | `c90992d22cf9345877e7582fc66b02fc6428237e` |
| `sqlite-block-loss-preview.test.mjs` | `604f6ad33aa67a25d226eab7045546328a0cb378` |

SHA-256 del registro TAP de la última ejecución: `0ae913aecc38ff28abacc2d8a798cc29dd885d83e57a9819320da5d417457dbe`.

El manifiesto `scripts/check-browser-lab.mjs` incorpora la suite **56**. **No se han ejecutado las 56 suites integrales** del proyecto, ni los componentes HTTP/SSE que faltan en el entorno local, ni la regresión Windows ni pruebas de dos jugadores reales.

## Puertas siguientes

1. Integrar un tablero oficial versionado que almacene **bloques restantes por unidad**, líder y escenario, con operaciones de escritura y eventos autorizados; no introducir datos por fixtures en partidas reales.
2. Implementar el flujo reglamentario completo: resolución de bajas, dado de comprobación de líder, banderas/moral, retiradas y excepciones de combate, con política de reacciones pendientes y **una comprobación de líder por secuencia**.
3. Mantener las operaciones aleatorias atómicas, idempotentes y con revisión. No confirmar victoria hasta que una eliminación se haya **aplicado legalmente**.
4. Probar sesiones HTTP autenticadas, privacidad de mano/mazo, CSRF, carreras multiproceso y conexión PC/móvil.
5. Ejecutar las **56 suites completas y Windows nativo** antes de fusionar la cadena de PR.

**Conclusión:** conexión consistente y reproducible entre los dados oficiales de laboratorio y los bloques del objetivo, en lectura transaccional, sin modificar partidas.
