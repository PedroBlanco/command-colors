# CCW-015 — Revisión del segundo dado físico de líder, después de una impugnación

**Fecha:** 11/11/2026. **Rama:** `feat/i4-ancients-physical-leader-reroll-review`, apilada sobre la PR #77. **Estado:** exclusivamente laboratorio SQLite CCRL con doble protección de fixture. No habilita combate oficial, HTTP ni persistencia en CCWB.

## Problema

La PR #77 permite registrar una segunda declaración de dados físicos de comprobación de líder **solo** si los dos participantes aceptaron repetir la tirada impugnada. Es una **nueva declaración** con identificador propio, pero el consentimiento para repetirla **no supone que el defensor haya aceptado las nuevas caras**.

Este incremento exige una decisión independiente del adversario sobre la nueva declaración: `CONFIRM` o `DISPUTE`. La decisión nunca modifica los resultados originales ni los repetidos. **Confirmar no convierte automáticamente los dados en un combate reglamentariamente autorizado**.

## Contratos y operaciones

- `lab-leader-reroll-review-state.mjs`: inspecciona, sin mutaciones, la segunda declaración y su revisión opcional. Vuelve a comprobar el contrato de la PR #77 contra su **revisión original de captura**, no contra una revisión posterior, y verifica el actor, el adversario, los dos hashes (tirada original impugnada y tirada nueva), las caras oficiales, la cantidad derivada del servidor, el tipo de tirada y el orden de revisiones.
- `lab-physical-leader-reroll-review.mjs`: comando `reviewLabPhysicalLeaderReroll`, con identidad de sesión resuelta en el servidor, control de revisión e idempotencia en una transacción `BEGIN IMMEDIATE` proporcionada por el adaptador.
- `lab-leader-dice-gate.mjs`: mantiene el estado original `PHYSICAL_DISPUTED` y `disputeBlocksContinuation:true` también después de la nueva revisión. Añade únicamente `rerollAttemptStatus`, `rerollReviewDecision`, `rerollPendingOpponentReview` y `newRollAccepted`; **no publica ni las caras ni el número de cascos ni el resultado de baja**.
- `lab-physical-leader-reroll-attempt.mjs`: permite recuperar por idempotencia la **misma** segunda declaración incluso después de que el adversario la haya revisado; nunca registra dados adicionales en ese reintento.
- `sqlite-lab-direct-hit-commit.mjs`: conecta el nuevo comando solo en el adaptador CCRL de fixtures. Sin ruta HTTP, migración de tablas ni alteración de partidas reales.

La solicitud interna admite exclusivamente:

```js
{
  matchId, sessionUserId, reservationId,
  expectedRevision, idempotencyKey,
  decision: 'CONFIRM' | 'DISPUTE'
}
```

`sessionUserId` debe proceder de una sesión autenticada por el servidor. El cliente **no** puede proporcionar la identidad del revisor, resultados, caras, tablero, cartas, líder, `randomIndex`, conteos de dados ni autorización reglamentaria.

La operación exige:

1. Partida `ACTIVE / COMBAT`, opt-in de fixture, reserva y actor original correcto, revisión vigente, tablero idéntico al vinculado por SHA-256 y una tirada física inicial impugnada.
2. Ambos votos `CONSENT_REROLL` previamente registrados, sin veto y con revisiones consecutivas.
3. Segunda declaración `LAB_PHYSICAL_LEADER_REROLL_DECLARATION_V1` coherente, `PLAYER_DECLARED` y con un nuevo `rollId`, ligada a la tirada anterior.
4. **Revisor distinto del declarante original**: solo el otro participante puede aceptar o rechazar las nuevas caras.
5. Ausencia de revisión nueva previa, salvo que sea un **reintento exacto** con la misma clave, revisión original y decisión.

Al confirmar, almacena dentro de `rerollAttempt.review` un objeto versionado con decisión, bando revisor, revisión y hashes de las tiradas. Aumenta revisión, registra comando idempotente y emite `LAB_PHYSICAL_LEADER_REROLL_REVIEWED` con secuencia, bando y decisión. **No** incluye caras, resultados, nombres de líderes, identificadores de tirada, unidades ni valores del tablero. Toda la operación es atómica: un fallo de escritura revierte registro, revisión, evento y clave.

## Estados y bloqueo

| Situación | Estado de la segunda tirada | ¿Combate autorizado? |
| --- | --- | --- |
| Nueva declaración sin respuesta | `PHYSICAL_REROLL_AWAITING_OPPONENT` | No |
| El adversario acepta las nuevas caras | `PHYSICAL_REROLL_CONFIRMED` | **No** |
| El adversario vuelve a impugnar | `PHYSICAL_REROLL_DISPUTED` | **No** |

El estado general sigue siendo `PHYSICAL_DISPUTED` porque el protocolo no ha efectuado una transición oficial de resolución del combate. `newRollAccepted:true` significa **únicamente conformidad del adversario con la transcripción nueva**; no implica `leaderCasualtyApplied`, `combatAuthorized`, `combatResolved` ni `evasionResolved`.

Una segunda impugnación **no** autoriza otro relanzamiento automático ni permite editar resultados. Es necesaria una política expresa de conciliación, separada de esta transición. Las comprobaciones SHA-256 detectan incoherencias, no sustituyen la protección de acceso de escritura a la base.

## Pruebas

En **Node.js v22.16.0 y SQLite real sobre Linux nativo, sin WSL ni GitHub Actions**, se ejecutaron localmente:

```sh
node --test --test-reporter=tap \
  packages/ancients-rules/lab-physical-leader-agreement.test.mjs \
  packages/ancients-rules/lab-leader-dice-gate.test.mjs \
  packages/ancients-rules/lab-leader-reroll-consent.test.mjs \
  packages/ancients-rules/lab-physical-leader-reroll-attempt.test.mjs \
  packages/ancients-rules/lab-physical-leader-reroll-review.test.mjs
```

**110/110 pruebas PASS, 0 FAIL, 0 SKIP**, repetidas tres veces consecutivas, sobre los módulos de ejecución del laboratorio. **26 pruebas nuevas** en la batería local ampliada, cubriendo conformidad, segunda impugnación, una o dos caras, privacidad, revisión, reintentos de votos y declaraciones, adversarios y terceros, resultados/hash manipulados y rollback completo.

Las fuentes de ejecución publicadas en GitHub coinciden exactamente en sus blobs:

| Fuente | Git blob |
| --- | --- |
| `lab-leader-reroll-review-state.mjs` | `a0d4fb861939ce6be19228402d9dfe2fc448af58` |
| `lab-physical-leader-reroll-review.mjs` | `ca22a8045875e24797e9b69c32c2b5f803fcb743` |
| `lab-leader-dice-gate.mjs` | `c73b974912d17eb5c20ca866d4364adbf361258f` |
| `lab-physical-leader-reroll-attempt.mjs` | `03b34502413204a909848d3efad9feac91995d37` |

SHA-256 del último TAP local: `dd7d50cb7cb0440abf1158a6125ca461ec92f79f223b050fda270bbfe31486e6`.

**Distinción de evidencias:** el nuevo fichero de pruebas publicado en la rama contiene **14 casos de contrato seleccionados de la batería ampliada de 26**, y **esa versión de 14 casos no se ha ejecutado por separado desde un checkout completo de GitHub**. No se deben atribuir automáticamente los 110 casos locales al manifiesto publicado.

El manifiesto tiene **68 suites de pruebas**. **No se han ejecutado conjuntamente las 68 suites** del proyecto ni se han verificado Windows nativo, servidor HTTP/SSE, dos navegadores, escenarios oficiales, carrera multiproceso y autorización completa de combates.

## Próximos pasos, fusión y despliegue

1. Ejecutar **la regresión de 68 suites desde un checkout completo** y corregir fallos de compatibilidad de los adaptadores, empezando por el pipeline reserva → disparo → impactos en fixture → líder → impugnación → dos votos → nueva declaración → revisión.
2. Diseñar la **resolución de la segunda impugnación** sin permitir nuevos dados o modificaciones unilaterales. No confundir políticas de acuerdo entre jugadores con reglas de combate oficiales.
3. Implementar autorización efectiva de las reglas de `Ancients` antes de modificar unidades reales: carta/orden, escenario, combate, moral, excepciones, líder, evasión, banderas, retiradas y estandartes.
4. Preparar interfaz y endpoints autenticados (sesión, cookies, CSRF, eventos seguros y privacidad de manos) y realizar pruebas con dos jugadores en PC/móvil.
5. **No fusionar todavía la cadena de PR ni desplegarla en producción**. Un despliegue aislado de demostración solo será recomendable cuando la regresión y el aislamiento de fixtures se hayan verificado.

**Resultado:** el adversario puede aceptar o impugnar **también la segunda declaración física**, manteniendo un historial íntegro y sin conceder efectos de combate.
