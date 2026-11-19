# CCW-015 — Puerta de revisión de dados de líder (sin resolver el combate)

**Fecha:** 11/11/2026. **Rama:** `feat/i4-ancients-leader-dice-review-gate`, dependiente de la PR #74. **Alcance:** laboratorio SQLite `CCRL`, exclusivamente fixtures. No incorpora un endpoint HTTP ni un ejecutor de combate oficial.

## Situación anterior

La PR #73 permitía registrar una tirada **provisional** de comprobación de baja del líder, después de aplicar impactos a un tablero ficticio. La PR #74 añadió el registro transaccional de la decisión del adversario sobre esa tirada cuando se declaró con dados físicos: `CONFIRM` o `DISPUTE`.

Este incremento hace explícita la condición que deben consultar **las futuras operaciones** antes de trabajar con esos resultados. Una tirada impugnada **no** puede tratarse como una tirada consensuada. Una confirmación o una tirada digital del servidor **tampoco** constituyen autorización reglamentaria para eliminar un líder.

## Contrato y estados

`packages/ancients-rules/lab-leader-dice-gate.mjs` incorpora dos funciones:

- `evaluateLabLeaderDiceGate({turnState,boardJson,reservationId})`: validación pura del estado guardado en el servidor; solo devuelve un resumen no sensible o `null` cuando el estado es incompatible.
- `makeLabLeaderDiceGateReader({inTransaction,row,sideFor})`: constructor interno de una lectura SQLite con revisión, permisos y aislamiento transaccional.

`sqlite-lab-direct-hit-commit.mjs` expone `readLabLeaderDiceGate({matchId,sessionUserId,reservationId,expectedRevision})` **solo en el adaptador CCRL de fixtures**. El constructor de ese adaptador continúa exigiendo `allowTestFixtureMutation:true` y el estado de la partida `labFixtureOnly:true`. El identificador de sesión debe proceder de una autenticación fiable del servidor; **no** se habilita un campo HTTP de identidad.

| Estado | Significado | `recordUncontested` | Puede finalizar combate |
| --- | --- | --- | --- |
| `DIGITAL_SERVER_CAPTURED` | Los dados del líder fueron generados por el servidor | `true` | **No** |
| `PHYSICAL_AWAITING_OPPONENT` | El defensor aún no ha confirmado los dados declarados | `false` | **No** |
| `PHYSICAL_OPPONENT_CONFIRMED` | El adversario confirmó la transcripción física | `true` | **No** |
| `PHYSICAL_DISPUTED` | El adversario impugnó la transcripción; conflicto sin resolver | `false` | **No** |

La respuesta contiene `combatAuthorized:false`, `leaderCasualtyApplied:false`, `evasionResolved:false`, `combatResolved:false` y `requiresCompleteRulesAuthorization:true`. La propiedad `recordUncontested` significa **únicamente que no queda pendiente una discrepancia sobre el registro**; no autoriza aplicarlo.

## Comprobaciones antes de devolver un estado

La operación se niega a inferir un estado válido si hay datos ausentes o contradictorios. Comprueba:

1. Identidad del archivo y de los dos participantes a través del adaptador, y una petición sin campos adicionales de tablero, líder o resultados.
2. Revisión actual y turno `ACTIVE / COMBAT`, estado `labFixtureOnly:true`, y la marca `LAB_DIRECT_HITS_APPLIED_FIXTURE` de #71. El tablero debe coincidir con su SHA-256 posterior a impactos.
3. Reserva, atacante, plan de líder pendiente, bloques retirados y versión de reglas. El resultado del líder tiene propósito `LEADER_CASUALTY_CHECK`, identificador de tirada propio, seis caras oficiales y cantidad correcta (uno o dos dados).
4. Concordancia exacta entre las caras guardadas, número de cascos y resultado provisional de baja/evasión; ausencia de efectos aplicados. El contrato rechaza un resultado cacheado manipulado.
5. Procedencia: `SERVER_GENERATED` para `DIGITAL`; `PLAYER_DECLARED` para `PHYSICAL`. Una tirada digital no puede tener una revisión física añadida.
6. Cuando existe una decisión física, exige bando revisor **opuesto al autor**, revisión vigente, `CONFIRM` o `DISPUTE`, y hash del resultado original coherente. No convierte automáticamente una impugnación en una confirmación.
7. Un estado ilegible, caducado o incompleto falla de forma cerrada con `LEADER_GATE_UNAVAILABLE`; no inventa dados ni devuelve una supuesta aceptación.

Ambos participantes pueden consultar **únicamente el estado administrativo**, nunca las caras de los dados, el número de cascos, la identidad del líder, datos de cartas o resultados del pronóstico. Los terceros reciben `NOT_FOUND`. La lectura utiliza `BEGIN IMMEDIATE` y **no escribe** en `lab_matches`, `lab_events` ni `lab_commands`; un fallo o repetición no crea eventos.

**Importante:** las comprobaciones SHA-256 detectan incoherencias del almacenamiento, pero no constituyen una garantía contra un administrador con acceso de escritura directo a SQLite. La aplicación no debe confiar en un objeto de estado enviado por el cliente.

## Verificación local

Ejecutado con **Node.js v22.16.0 y SQLite real en Linux nativo**, sin WSL ni GitHub Actions:

```sh
node --test --test-reporter=tap \
  packages/ancients-rules/lab-physical-leader-agreement.test.mjs \
  packages/ancients-rules/lab-leader-dice-gate.test.mjs
```

**37/37 pruebas PASS, 0 FAIL, 0 SKIP**: 20 pruebas nuevas y 17 de la PR #74. Tres repeticiones consecutivas correctas y una ejecución final adicional correcta. Las pruebas nuevas cubren los cuatro estados, los dos jugadores y terceros, lectura sin mutaciones, confirmación/impugnación mediante el **comando real de acuerdo** de la PR #74 con SQLite real, dados digitales, último bloque, manipulación de procedencia/dados/interpretación, bando revisor, revisión, SHA del tablero y ocultación de resultados.

Los **dos módulos efectivos ensayados y publicados** coinciden por Git blob:

- `lab-leader-dice-gate.mjs`: `1b52273e72ae86d2ced49173b8ef81b8ebd6a06d`.
- `lab-leader-dice-gate.test.mjs`: `b7e4a0a1b18b2a754177da1032a70ecf03b917b9`.
- SHA-256 del TAP de la ejecución final combinada: `3a45a88a4de0bab07dfee427594753acf29722bbe697bd025df6ec295dede035`.

Los tests de este incremento emplean **registros CCRL simulados pero almacenados en SQLite real**, y ejecutan el comando real de confirmación física y la lectura de estado. **No han ejecutado el flujo completo real de reserva, comprobación de línea de visión, disparo, aplicación de impactos y captura de líder en una misma prueba**. Tampoco las 65 suites completas del proyecto, Windows nativo, HTTP/SSE ni navegadores de dos usuarios.

El manifiesto del proyecto incluye ahora **65 suites**. Esta cifra corresponde al inventario; no es una afirmación de que todas hayan sido ejecutadas.

## Bloqueos y siguientes pasos

1. Ejecutar **las 65 suites integrales** con el repositorio completo y corregir incompatibilidades en la composición de los adaptadores, empezando por las pruebas de integración posimpactos y confirmación bilateral.
2. Implantar una política auditable para **resolver impugnaciones**: el estado `PHYSICAL_DISPUTED` no puede avanzar automáticamente, descartar ni reescribir dados. Cualquier repetición de una tirada aleatoria deberá requerir el acuerdo de ambos jugadores.
3. Completar la **autorización de combates del básico** (carta, orden, legalidad, excepciones de unidad y escenario). El estado `recordUncontested:true` no evita este requisito.
4. Añadir aplicación real de baja o supervivencia del líder, evasión, moral y retirada, con máximo una comprobación por combate, estandartes y victoria cuando corresponda.
5. Incorporar autenticación HTTP/CSRF, visibilidad diferenciada de manos, eventos, reconexión y pruebas con dos sesiones reales.

**Resultado:** existe una puerta de revisión **de solo lectura y con fallo seguro**, que impide considerar aceptada una tirada física impugnada, sin aplicar bajas ni dar por terminado un combate.
