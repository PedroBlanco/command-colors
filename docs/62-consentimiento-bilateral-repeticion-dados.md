# CCW-015 — Consentimiento de ambos jugadores ante una tirada física impugnada

**Fecha:** 11/11/2026. **Rama:** `feat/i4-ancients-leader-reroll-bilateral-consent`, dependiente de la PR #75. **Estado:** contrato y comandos transaccionales **solo para fixtures de laboratorio CCRL**; no se repite ningún dado ni se aplica ninguna baja.

## Problema y decisión de diseño

La PR #74 permite al segundo jugador **confirmar o impugnar** los dados físicos declarados en una comprobación provisional de baja del líder. La PR #75 ofrece una lectura segura del estado `PHYSICAL_DISPUTED`, que bloquea cualquier avance del combate.

Para preparar un procedimiento de resolución de discrepancias, este incremento exige que **ambos jugadores expresen por separado** si consienten que, en el futuro, se repita esa tirada. El hecho de que el defensor haya impugnado los dados **no se interpreta automáticamente como consentimiento para repetirlos**.

El voto admite exclusivamente dos valores:

- `CONSENT_REROLL`: consentimiento explícito para estudiar una repetición.
- `REFUSE_REROLL`: negativa a repetir la tirada.

Cada participante puede votar **una sola vez** por la misma impugnación. El voto queda ligado a la versión del resultado original mediante el identificador de reserva, la revisión de la impugnación y el SHA-256 de la tirada. No modifica las caras ni invalida retrospectivamente el resultado original.

## Estados del protocolo

| Estado | Condición | Permite generar nuevos dados |
| --- | --- | --- |
| `AWAITING_BOTH_CONSENTS` | Ninguno ha votado | **No** |
| `AWAITING_OTHER_CONSENT` | Uno ha consentido, falta el otro | **No** |
| `REROLL_REFUSED` | Alguno se ha negado expresamente | **No** |
| `BOTH_CONSENTED_NO_REROLL_YET` | Ambos consienten expresamente | **No** |

**Importante:** incluso con unanimidad, el módulo **no contiene ningún comando que lance dados** ni un mecanismo para sustituir los resultados. El indicador `unanimousConsent:true` significa solo que se cumplen los requisitos de consentimiento; el campo `rerollAllowed:false` y el bloqueo `disputeBlocksContinuation:true` continúan activos.

Para repetir los dados de forma efectiva harán falta una transición nueva y específica, una tirada con **nuevo identificador**, auditoría de la original y del acuerdo, control de revisión, registro de resultados y nueva confirmación física, sin reescribir la tirada impugnada. Todo ello permanecerá prohibido hasta implementar y verificar ese protocolo, independiente de la autorización reglamentaria de combate.

## Implementación

- `packages/ancients-rules/lab-reroll-consent-state.mjs` valida versiones, datos del acuerdo, hash del dado, votos de `A` y `B`, decisiones válidas y sucesión exacta de revisiones. Rechaza marcadores alterados, campos adicionales, revisiones repetidas y saltos de secuencia. El resultado es inmutable.
- `packages/ancients-rules/lab-leader-reroll-consent.mjs` define `makeLabLeaderRerollConsentCommand`: comando de voto con `BEGIN IMMEDIATE` (inyectado desde el adaptador), revisión optimista e idempotencia. Comprueba al miembro usando la identidad de sesión del servidor y exige el estado **auténtico `PHYSICAL_DISPUTED`** de #75.
- `sqlite-lab-direct-hit-commit.mjs` expone `voteLabLeaderReroll()` **solo dentro del adaptador de laboratorio** protegido con opt-in de fixture. No existe endpoint HTTP.
- `lab-leader-dice-gate.mjs` continúa devolviendo `PHYSICAL_DISPUTED` y `disputeBlocksContinuation:true`, pero incorpora `rerollConsentStatus`, `rerollConsentVotes` y `unanimousConsentForReroll` sin revelar dados. Su validación admite que el voto incremente la revisión posterior al desacuerdo, **solo si** se verifica la secuencia exacta de votos y sus hashes.

La solicitud interna admite exactamente:

```js
{
  matchId, sessionUserId, reservationId,
  expectedRevision, idempotencyKey,
  choice: 'CONSENT_REROLL' | 'REFUSE_REROLL'
}
```

`sessionUserId` se resolverá a partir de una sesión autenticada. El navegador **no** debe imponer identidades, cartas, caras, cantidad de dados, líder, tableros ni fuente de aleatoriedad.

### Persistencia y eventos

Los votos se guardan bajo `pendingCombat.fixtureLeaderCasualtyPreview.rerollConsent`, versión `LAB_LEADER_REROLL_CONSENT_V1`, incluyendo revisión del acuerdo impugnado, digest de la tirada original y, para cada jugador que haya votado, elección y revisión de su voto.

Cada voto válido crea una sola revisión, un registro de idempotencia y un evento compartido mínimo:

```js
{
  sequence: 10,
  type: 'LAB_LEADER_REROLL_CONSENT_RECORDED',
  side: 'A',
  choice: 'CONSENT_REROLL'
}
```

**No** incluye resultados, número de cascos, identificación de líder, reserva, mano de cartas ni valores de tablero. La operación no modifica `board_json` ni genera nuevos resultados aleatorios.

Un reintento idéntico devuelve el voto ya persistido **sin crear otro evento**; intentar cambiar la decisión con la misma clave falla con `IDEMPOTENCY_KEY_REUSED`, y usar otra clave después de votar también se rechaza. Se conserva la capacidad de recuperar un voto anterior después de que el segundo jugador haya votado.

Un error al escribir el estado, la clave de idempotencia o el evento provoca **rollback de toda la transacción**. No se cambia el esquema CCRL (tres tablas) ni se modifica el almacenamiento principal CCWB.

## Pruebas locales ejecutadas y límites

Se ejecutaron en **Node.js v22.16.0, Linux nativo con `node:sqlite`, sin WSL ni GitHub Actions**:

```sh
node --test \
  packages/ancients-rules/lab-physical-leader-agreement.test.mjs \
  packages/ancients-rules/lab-leader-dice-gate.test.mjs \
  packages/ancients-rules/lab-leader-reroll-consent.test.mjs
```

**61/61 pruebas PASS, 0 FAIL, 0 SKIP**, incluidos **24 casos nuevos** y las 37 pruebas previas de #74–#75. La batería conjunta superó **cinco repeticiones consecutivas**. Las pruebas utilizan SQLite real y el comando de conformidad y puerta de estado de los incrementos anteriores, con una **estructura de partida ficticia** controlada para el laboratorio.

Verificadas por **hash Git exacto** las cuatro fuentes nuevas o modificadas publicadas:

| Archivo | SHA Git blob |
| --- | --- |
| `lab-reroll-consent-state.mjs` | `752475a63c10984d872ed372cee34bd3b57ccd0c` |
| `lab-leader-reroll-consent.mjs` | `7541de64b68edd2d4f29884532d00abb3d4e51df` |
| `lab-leader-reroll-consent.test.mjs` | `cae5e44027ed4fe8df0c6aff362442cb850e60d8` |
| `lab-leader-dice-gate.mjs` | `f4aa63cedf69fa6e9b89e5312eafc4c1f04a1f4d` |

SHA-256 del quinto registro TAP nativo: `502e9770ce793d540a5c412242576606b000c5a2a8ecb305ea4a7acb1e55ca68`.

Las pruebas comprueban: dos órdenes posibles de voto, voto unilateral insuficiente, unanimidad sin relanzamiento, veto por negativa, reintentos tras segundo voto, claves duplicadas, actor forjado, tercero, estado digital/no impugnado, datos adicionales del cliente, tablero y tirada originales inmutables, evento público mínimo, rollback, modificaciones de hash/revisión/resultado y protección de información oculta.

**La regresión integral de las 66 suites del proyecto NO está ejecutada**. El entorno actual no tiene un checkout completo accesible desde la terminal; se han verificado únicamente las suites locales anteriores. Permanecen pendientes las integraciones reales del flujo original de reservas, dados, impactos y líder, Windows nativo, navegadores, HTTP/SSE y carreras multiproceso.

## Próximas puertas

1. Disponer de un checkout íntegro y ejecutar las **66 suites** completas, corregir fallos de composición y probar sesiones de dos jugadores.
2. Diseñar y probar un **comando independiente de relanzamiento tras unanimidad** con nueva identificación y auditoría del resultado original, sin sustituir datos y sin dar por válida una tirada física sin una nueva revisión.
3. Desarrollar el procedimiento cuando **uno se niega** a repetir (intervención acordada o cancelación de la partida según una política futura), sin saltarse el bloqueo de impugnación.
4. Completar autorización de combate oficial, resolución de bajas de líder, evasión, moral, banderas y victoria. La doble conformidad sobre dados **no sustituye** la autorización del reglamento.
5. Incorporar la autenticación real HTTP/cookies/CSRF, las proyecciones privadas de manos y eventos y la reconexión.

**Resultado:** consentimiento bilateral transaccional y auditable ante una impugnación de dados físicos, con **ninguna tirada nueva ni aplicación de efectos**.
