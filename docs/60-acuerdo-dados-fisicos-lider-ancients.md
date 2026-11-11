# CCW-015 — Aceptación bilateral de dados físicos de líder (solo laboratorio CCRL)

**Fecha:** 11/11/2026. **Rama:** `feat/i4-ancients-physical-leader-dice-agreement`, dependiente de la PR #73, que depende a su vez de la PR #71. **Estado:** aceptación/impugnación transaccional de tiradas físicas **solo en fixtures**; no hay API HTTP ni combate oficial autorizado.

## Motivo

La PR #73 conserva la tirada adicional del líder después de retirar bloques en un **tablero ficticio**. La fuente `PHYSICAL` solo acredita que el jugador ha **declarado** las caras del dado; hasta este incremento, el contrincante no disponía de un procedimiento que registrase su conformidad o desacuerdo.

El nuevo método `reviewLabPhysicalLeaderDice()` introduce una decisión explícita del **otro jugador**: `CONFIRM` o `DISPUTE`. Confirmar **no demuestra criptográficamente** que la tirada física haya ocurrido; constituye un **acuse de conformidad del adversario** respecto a los resultados declarados. La impugnación conserva los dados originales y bloquea cualquier reinterpretación automática posterior: queda pendiente una política de conciliación entre jugadores.

**Este método no aplica una baja ni una retirada**, y no modifica las reglas del básico de *Ancients*. El flujo sigue siendo exclusivamente experimental, y cualquier partida oficial necesitará primero validación reglamentaria y pruebas completas.

## Secuencia y controles

`packages/ancients-rules/lab-physical-leader-agreement.mjs` define `makeLabPhysicalLeaderAgreementCommand`. La composición `openLabOnlyDirectHitCommit` de la PR #71 lo incorpora **únicamente al adaptador exclusivo de CCRL**, que exige el opt-in `allowTestFixtureMutation:true`, y el propio comando exige `labFixtureOnly:true` persistido.

La operación acepta **exactamente**:

```js
{
  matchId, sessionUserId, reservationId,
  expectedRevision, idempotencyKey,
  decision: 'CONFIRM' | 'DISPUTE'
}
```

El servidor debe obtener `sessionUserId` de una **sesión autenticada**, nunca de campos del navegador. No se permiten posiciones, líder, caras, cantidad de dados, aleatoriedad, identificación de atacante ni resúmenes de impacto desde la petición.

Comprobaciones y registro en `BEGIN IMMEDIATE`:

1. Identifica al miembro de la partida y exige que **no sea quien declaró la tirada**: solo el oponente puede revisarla. Los terceros reciben `NOT_FOUND` y el actor original no puede autocorroborarse.
2. Comprueba revisión, firma y clave de idempotencia; el estado debe estar en `LAB_DIRECT_HITS_APPLIED_FIXTURE`, con `labFixtureOnly:true`, fase `COMBAT`, y tablero idéntico al resumen SHA-256 guardado después de los impactos ficticios.
3. Comprueba que la comprobación de líder esté pendiente, que exista una tirada adicional `ANCIENTS_BASE_LEADER_CASUALTY_CAPTURED`, con `purpose:LEADER_CASUALTY_CHECK`, tipo de reglas correcto, actor y `rollId` de la reserva, modalidad exclusivamente **`PHYSICAL`** y procedencia `PLAYER_DECLARED`.
4. Comprueba desde el resumen ya aplicado si correspondían **uno o dos dados**; valida todas las caras oficiales. Recalcula número de cascos, posible baja del líder y evasión pendiente; rechaza resultados o interpretaciones almacenados inconsistentes.
5. Guarda en el estado privado de la tirada `physicalAgreement` con `kind:'LAB_PHYSICAL_LEADER_DICE_AGREEMENT_V1'`, decisión, bando revisor, revisión y resumen SHA-256 **del resultado declarado**.
6. Aumenta la revisión, añade comando con firma y evento público mínimo `LAB_PHYSICAL_LEADER_DICE_REVIEWED` con `side` y `decision`. El evento no revela caras, número de cascos, líder, unidad, reserva, carta, tirada o posiciones.

La transacción completa se revierte ante un fallo de escritura. No modifica `board_json`, no mata al líder, no efectúa evasión, no concede estandartes ni declara resuelto el combate: `attackAuthorized:false`, `boardMutated:false`, `combatResolved:false`.

## Idempotencia, conflicto y privacidad

- Un reintento idéntico con la misma clave devuelve `PHYSICAL_AGREEMENT_ALREADY_RECORDED`; no escribe nuevos eventos ni cambia revisión.
- Usar la misma clave para otra decisión devuelve `IDEMPOTENCY_KEY_REUSED`.
- Una clave distinta, incluso con la revisión actual, **no puede cambiar una decisión ya registrada**: `PHYSICAL_AGREEMENT_ALREADY_RECORDED`.
- No permite confirmar dados `DIGITAL`: su procedencia ya es `SERVER_GENERATED` y no requiere este procedimiento físico.
- Si el tablero cambió desde los impactos, falta la marca experimental o la tirada/resultado guardado se contradicen, la operación se rechaza sin revelar los datos privados.
- El resumen SHA-256 detecta modificaciones accidentales y contradicciones de los valores almacenados; **no constituye una firma a prueba de un administrador con acceso de escritura directo a SQLite**.
- La decisión `DISPUTE` **no permite editar las caras ni repetir automáticamente**. Un futuro protocolo de resolución de desacuerdos tendrá que decidir si se acuerda repetir la tirada y cómo auditarlo sin manipular un resultado ya registrado.
- Un resultado físico `CONFIRM` está **reconocido por el otro jugador**, no por ello verificado objetivamente, ni autorizado para aplicar bajas del reglamento.

## Evidencia de prueba

Con **Node.js v22.16.0, Linux nativo, SQLite real, sin WSL ni GitHub Actions**:

```sh
node --test --test-reporter=tap \
  packages/ancients-rules/lab-physical-leader-agreement.test.mjs
```

**17/17 pruebas PASS, 0 FAIL, 0 SKIP**, repetidas **cinco veces consecutivas** con el mismo código. Incluyen confirmación e impugnación, rechazo de autocorroboración y terceros, ausencia de doble decisión, revisión/clave, trazabilidad privada, huella del tablero, tirada digital excluida, último bloque del objetivo, resultados almacenados alterados, privacidad del evento y rollback total ante un fallo de SQLite.

Son pruebas con **SQLite real** del módulo autónomo, usando registros de fixture que reproducen la estructura posterior a la PR #73. **No ejecutan los módulos previos completos de movimiento, línea de visión, reglas y reserva real.**

Hashes Git exactos de los archivos ensayados y publicados:

- `lab-physical-leader-agreement.mjs`: `a66a6c27910bb166a42e7ae9fae352989201afcb`.
- `lab-physical-leader-agreement.test.mjs`: `89edc382a25c79872a20c9dc6d742e9f0cea2625`.
- SHA-256 del último archivo TAP local: `d42e24f86ecf8bbb5b6052dac6f1f7de7d9698b0dd3b457957a7986977331ac1`.

Se han añadido **7 pruebas de integración con el adaptador de reglas reales** a `sqlite-physical-leader-agreement-adapter.test.mjs`, aún **sin ejecutar nativamente** por no disponer del checkout completo del repositorio en el entorno actual. No se deben contabilizar como aprobadas.

El manifiesto incorpora **64 suites**; no se ha ejecutado la regresión integral de las 64 suites, las comprobaciones de Windows, la comunicación HTTP/SSE, sesiones reales ni la concurrencia de procesos.

## Siguientes pasos y bloqueos

1. Ejecutar la batería **integral de 64 suites**, en particular las 7 de integración nuevas y las de la PR #73, y corregir fallos en la composición real si aparecen.
2. Diseñar la política de **resolución de discrepancias** de dados físicos y los eventos mínimos para el acuerdo bilateral. No basta con `CONFIRM` para autorizar un combate.
3. Implementar un motor de estado oficial que autorice cartas, órdenes, unidades, escenario y reglas especiales **antes** de aplicar impactos a partidas reales.
4. Registrar bajas confirmadas de líder, evasiones, moral y rutas de retirada; preservar el máximo de una comprobación de líder por secuencia.
5. Integrar autenticación HTTP/CSRF, vistas privadas, reconexión y dos jugadores, sin exponer `seedFixture`, `unsafeTestDatabase` ni los métodos experimentales.

**Resultado:** existe un procedimiento idempotente de aceptación o impugnación de dados físicos del líder **en una partida ficticia**; no resuelve aún el combate ni confirma bajas en partidas reales.
