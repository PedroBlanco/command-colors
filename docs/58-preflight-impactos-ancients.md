# CCW-015 — Preflight transaccional de impactos directos (sin aplicación)

**Fecha:** 11/11/2026. **Base:** PR #70. Este incremento añade una propuesta de cambios **no ejecutable** para preparar un futuro comando autorizado que retire bloques en partidas reales.

## Qué se ha incorporado

`packages/ancients-rules/ranged-hit-commit-preflight.mjs` expone `preflightStagedAncientsRangedHits`. A partir del turno, tablero y tirada ya guardados, recalcula la pérdida con `deriveStagedAncientsRangedBlockLoss` y la secuencia con `planBaseAncientsRangedResolution`. Devuelve el objetivo, atacante, revisión actual, revisión siguiente propuesta, bloques previos, bloques a retirar, bloques restantes, exceso de impactos, líder que requeriría comprobación y siguiente fase sugerida.

La operación `preflightDirectHits({matchId,sessionUserId,reservationId,expectedRevision})` en el laboratorio SQLite `CCRL` valida identidad y revisión, coteja la huella SHA-256 del tablero capturada al guardar la tirada y calcula todo **dentro de una única transacción `BEGIN IMMEDIATE`**. No existe una lectura intermedia fuera de transacción entre comprobar la huella y calcular el resultado. Se rechazan propiedades ajenas a la solicitud y datos incoherentes.

**No hay escritura:** no se actualizan `board_json`, `turn_json`, `lab_events`, `lab_commands` ni se confirma una nueva revisión. El resultado incluye explícitamente:

```text
fullRulesValidated: false
attackAuthorized: false
commitPermitted: false
boardMutated: false
unitRemoved: false
leaderRemoved: false
leaderCheckRolled: false
victoryBannerAwarded: false
combatResolved: false
blockingReason: FULL_RANGED_COMBAT_AUTHORIZATION_NOT_IMPLEMENTED
```

La propuesta **no es un permiso ni una operación que pueda enviarse de vuelta para confirmar un combate**. Un futuro ejecutor deberá recalcular los efectos desde SQLite dentro de su propia transacción, con autorización reglamentaria completa, concurrencia, idempotencia y auditoría. Ningún endpoint HTTP ha sido añadido. El esquema `CCRL` de tres tablas y el esquema principal `CCWB` permanecen inalterados.

## Pruebas añadidas y limitaciones

Se han añadido **seis casos** al archivo `sqlite-block-loss-preview.test.mjs`: delta de bloques y ausencia de mutación, último bloque con líder, bandera y moral, disparo sin impactos, identidad/revisión/entrada inválida y cambio del tablero posterior a la tirada.

**Estas seis pruebas están escritas pero aún no se han ejecutado.** Tampoco se ha ejecutado una regresión integral de las **57 suites** existentes; no se deben contabilizar como superadas. Antes de fusionar es imprescindible ejecutar Node.js nativo y verificar las pruebas del laboratorio, la regresión completa y el comportamiento Windows, HTTP y dos jugadores.

## Próximos requisitos

1. Diseñar la validación completa de ataque (la reserva actual es solo un *screening*, no autoriza combates).
2. Introducir en el estado de partida principal bloques por unidad y líder asociado, con reglas de escenarios oficiales.
3. Implementar una transacción de **aplicación real** que recalcule el resultado, compruebe autorización, actualice bloques y fase, registre eventos y gestione claves de idempotencia sin dobles bajas.
4. Resolver comprobaciones de líder, banderas, apoyos, rutas y evasión antes de conceder estandartes o finalizar.

**Mantener en borrador. No fusionar ni desplegar.**
