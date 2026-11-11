# CCW-015 — Nueva declaración de dados físicos tras consentimiento bilateral

**Fecha:** 11/11/2026. **Rama:** `feat/i4-ancients-physical-leader-reroll-attempt`, dependiente de la PR #76. **Ámbito:** laboratorio SQLite aislado **CCRL** de fixtures, sin HTTP, sin cambios en el esquema principal CCWB y sin autorización de un combate oficial.

## Propósito

La PR #76 conserva una tirada física de baja de líder que el adversario impugnó y exige dos votos explícitos `CONSENT_REROLL` antes de considerar su posible repetición. Hasta ahora, **el consentimiento no producía un segundo registro**.

Este incremento permite que el **mismo jugador que declaró la tirada original**, y solo después de recibir el consentimiento de ambos, registre las caras obtenidas en **una nueva tirada física**. Se crea otro identificador; la tirada impugnada, la impugnación y ambos votos permanecen **inalterados y auditables**.

La repetición de una tirada por acuerdo de jugadores es una política de la aplicación y no debe presentarse como una nueva regla oficial de *Command & Colors: Ancients*.

## Transición implementada

Nuevos módulos:

- `lab-leader-reroll-attempt-contract.mjs`: valida estrictamente el registro `LAB_PHYSICAL_LEADER_REROLL_DECLARATION_V1`, la identidad única del nuevo `rollId`, la misma unidad de reglas, **uno o dos dados** decididos por el resultado original, las seis caras oficiales, el bando del declarante, procedencia `PLAYER_DECLARED`, revisión consecutiva y hash del resultado impugnado. No aplica ningún efecto.
- `lab-physical-leader-reroll-attempt.mjs`: constructor `makeLabPhysicalLeaderRerollAttemptCommand` con dependencias exclusivamente del servidor, que registra transaccionalmente una **nueva declaración física**.
- `sqlite-lab-direct-hit-commit.mjs`: integra el método `declareLabPhysicalLeaderReroll` **solo en el adaptador protegido de fixtures**; reutiliza el capturador canónico `captureBaseAncientsLeaderCasualtyDice` de las PR anteriores.

Solicitud interna admitida:

```js
{
  matchId,
  sessionUserId, // identidad autenticada de servidor, nunca cuerpo HTTP
  reservationId,
  expectedRevision,
  idempotencyKey,
  declaredFaces   // exactamente una o dos caras físicas oficiales
}
```

No se admite `mode`, `actor`, `diceCount`, `randomIndex`, `board`, `rollId`, `verification` ni ningún otro campo controlado por el cliente. La modalidad se fija en `PHYSICAL`. **No existe generación digital automática en esta transición.**

Dentro de `BEGIN IMMEDIATE`, el comando exige:

1. Sesión participante y actor correspondiente **al autor de la declaración original**; el defensor no puede introducir unilateralmente nuevas caras.
2. Fase `ACTIVE/COMBAT`, opt-in de laboratorio, tablero vinculado por SHA-256, comprobación previa de baja de líder y resultado inicial físico impugnado.
3. Dos consentimientos válidos, sin negativas ni saltos de revisión, cotejados mediante la puerta `PHYSICAL_DISPUTED` de #75–#76.
4. Coincidencia exacta entre identificador de reserva, digest de la tirada impugnada y número de dados fijado por servidor.
5. Ausencia de declaración nueva previa; solo puede registrarse **una** nueva tirada para esa impugnación.

La nueva tirada usa el identificador derivado `lab_reroll_leader_{reserva}_1`, distinto del `lab_leader_{reserva}` del resultado original. Se almacena bajo `pendingCombat.fixtureLeaderCasualtyPreview.rerollAttempt` con versión, revisión, huella del dado antiguo y evento completo privado. El evento público `LAB_LEADER_PHYSICAL_REROLL_DECLARED` únicamente anuncia secuencia, bando, procedencia y cantidad de dados: **no contiene caras, líder ni resultados**.

El registro incrementa revisión y guarda evento y clave de idempotencia en **una sola transacción**. Un error de escritura revierte todo. Un reintento exacto devuelve la misma declaración sin escribir nada más; reutilizar clave con otros valores o intentar otra tirada con una nueva clave se rechaza.

## Estados del protocolo

| Fase | Situación | ¿Puede aplicarse una baja? |
| --- | --- | --- |
| Impugnación inicial | `PHYSICAL_DISPUTED` | No |
| Un consentimiento | Falta el otro voto | No |
| Dos consentimientos | `BOTH_CONSENTED_NO_REROLL_YET` | No |
| Nueva declaración registrada | `PHYSICAL_REROLL_AWAITING_OPPONENT` | **No** |

`lab-leader-dice-gate.mjs` se amplía para validar la nueva revisión y declaración **solo** si antes existieron ambos votos. Sigue devolviendo el estado principal `PHYSICAL_DISPUTED`, con `disputeBlocksContinuation:true`, `rerollAllowed:false`, `combatAuthorized:false`, `leaderCasualtyApplied:false`, `combatResolved:false`. La información de revisión se expresa mediante `rerollAttemptStatus`, `rerollDeclared` y `rerollPendingOpponentReview`, sin revelar los dados.

**Todavía NO se ha implementado la confirmación del segundo resultado físico.** Esa confirmación requerirá una transición diferente del adversario, ligada al identificador y digest de la nueva tirada. Hasta entonces está expresamente prohibido utilizar el resultado para determinar bajas, evasiones, retiradas o victoria.

La operación de voto de #76 conserva la idempotencia de **ambos votos originales después de registrar la nueva declaración**, sin agregar otro evento.

## Pruebas nativas ejecutadas

**Node.js v22.16.0, Linux nativo, SQLite real, sin WSL ni GitHub Actions:**

```sh
node --test --test-reporter=tap \
  packages/ancients-rules/lab-physical-leader-agreement.test.mjs \
  packages/ancients-rules/lab-leader-dice-gate.test.mjs \
  packages/ancients-rules/lab-leader-reroll-consent.test.mjs \
  packages/ancients-rules/lab-physical-leader-reroll-attempt.test.mjs
```

**84/84 PASS, 0 FAIL, 0 SKIP**, tres repeticiones adicionales correctas. **23 casos nuevos** de contrato transaccional: consentimiento ausente, unilateral, veto, distinción de un/dos dados, retención de tirada y votos originales, identidad del nuevo resultado, privacidad, idempotencia de declaración y votos, otro jugador y terceros, datos falsificados, revisión y hash alterados, rollback y puerta de estado pendiente. Las nuevas pruebas emplean **SQLite real** y la lógica verdadera de consentimiento y puerta, pero **inyectan un capturador físico equivalente** para aislar el comando; **no son una ejecución de la integración completa** de movimiento/LOS/reglas.

Hashes Git verificados entre archivos publicados y ejecutados:

| Archivo | Git blob SHA |
| --- | --- |
| `lab-leader-reroll-attempt-contract.mjs` | `ac8708218ea25032c6d4065aa4cf1e0b7efd98e0` |
| `lab-physical-leader-reroll-attempt.mjs` | `0c9e15bc5d191c67b816a89e082b9c49fa867e10` |
| `lab-physical-leader-reroll-attempt.test.mjs` | `6cadf2c9ded32311ef0b7c0a43c7a9c7cd2aa225` |
| `lab-leader-dice-gate.mjs` | `6f01b763490739ee8cab95f9227ef949e03184b4` |
| `lab-leader-reroll-consent.mjs` | `4d5dace8fe0c1da32faf78361861503c6774fb85` |

SHA-256 del tercer registro TAP de la batería completa: `867aebc3c288330a96ff08e3eda43f30d5f015dbc09ea14da6e43654e1ee15d8`.

**Inventario del proyecto: 67 suites** registradas, pero **la regresión integral de 67 suites sigue pendiente**. La terminal del entorno actual carece de un checkout completo accesible de GitHub. Las pruebas de integración con reglas originales, Windows nativo, HTTP/SSE, concurrencia entre procesos y dos jugadores con navegador todavía no se han completado.

## Pendientes antes de fusionar o desplegar

1. Ejecutar la **regresión integral de 67 suites** con el código completo en una máquina con acceso al repositorio y corregir cualquier incompatibilidad.
2. Implementar y verificar la **revisión por el defensor de la nueva declaración física**, sin reutilizar el consentimiento al relanzamiento como confirmación de sus nuevas caras.
3. Mantener la tirada original, la impugnación, ambos votos, la nueva declaración y sus revisiones como historial íntegro e inmutable.
4. Completar la autorización oficial de combate y la aplicación de bajas y evasiones; la unanimidad es una política de acuerdo, no sustituye las reglas.
5. Verificar autenticación, privacidad entre jugadores y seguridad HTTP/CSRF, reconexión, Windows y despliegue de pruebas.

**Resultado:** una segunda declaración física identificada, recuperable y auditada **solo después de la unanimidad**, manteniendo el combate bloqueado hasta nueva revisión.
