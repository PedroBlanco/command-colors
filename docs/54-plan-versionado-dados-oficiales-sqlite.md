# CCW-015 — Plan versionado de dados oficiales en SQLite (previsualización)

**Fecha:** 10/11/2026. **Rama:** `feat/i4-ancients-versioned-official-dice-preview`. **PR base:** #66. **Estado:** exclusivamente laboratorio local, sin HTTP, sin migrar la base de partidas, sin autorización ni resolución de combates oficiales.

## Contrato de versiones

`packages/ancients-rules/dice-plan.mjs` distingue tres formatos persistidos de plan de dados:

| Identificador interno | Fuente | Caras | Compatibilidad |
| --- | --- | --- | --- |
| `SYNTHETIC_LEGACY` (sin `schemaVersion`) | Reservas de PR #65 | `RED, BLUE, FLAG, RED` (inventadas) | Se pueden leer **sin reinterpretar** |
| `SYNTHETIC_RANGED_V1` (schema 1) | Laboratorio sintético actualizado | `RED, BLUE, FLAG, RED` (inventadas) | Sigue usando el capturador sintético |
| `ANCIENTS_BASE_RANGED_PREVIEW_V1` (schema 1) | Nuevo adaptador explícito | `LIGHT, MEDIUM, HEAVY, LEADER, FLAG, SWORDS` | Solo **previsualizaciones** del básico |

Los planes llevan internamente el recuento de dados calculado por el comprobador real de disparos y el juego de caras. La variante oficial añade `ruleset:'ancients-base-3e-2009'` y el tipo de unidad del objetivo **tomado del tablero SQLite del servidor**, nunca del cliente. La interpretación reconoce los colores de las unidades conforme a `battle-dice.mjs` de #66.

`classifyRangedDicePlan` hace comprobaciones estrictas de versión, campos, tipos, recuento, distribución y tipo de unidad; un plan desconocido, manipulado o incompatible produce `DICE_PLAN_UNAVAILABLE`, sin registrar tiradas. No se convierte automáticamente ningún plan anterior a oficial.

La base sigue siendo el laboratorio aislado `CCRL` de tres tablas de #64, **sin cambios de DDL ni migraciones destructivas**. El esquema principal `CCWB` de seis tablas no se toca.

## Nuevo flujo de previsualización

`openOfficialAncientsRangedPreviewLab({file})`, en `packages/ancients-rules/sqlite-guarded-reservation.mjs`, configura el comprobador real `precheckAncientsRangedDeclaration` y la **política de plan `OFFICIAL_PREVIEW`**. Es una opción del código de servidor, no un parámetro HTTP; la composición original `openGuardedAncientsReservationLab` conserva el comportamiento sintético.

1. `reserve()` confirma precondiciones **parciales** (bando, turno, fase, unidad ordenada, movimiento registrado, alcance, línea de visión, terreno). Guarda `dicePlan` con una versión inmutable dentro del registro transaccional pendiente.
2. `stageDice()` determina el formato de ese plan **persistido**, incluso si el fichero se abre después desde otra instancia con una configuración de laboratorio diferente.
3. En plan oficial, `captureBaseAncientsRangedDice` acepta una declaración física de exactamente las seis caras posibles, o genera una tirada digital con `crypto.randomInt` del servidor.
4. `interpretBaseAncientsRangedDice` clasifica las coincidencias de color y banderas pendientes para la unidad objetivo persistida. Guarda en `pendingCombat` tanto `stagedDice` como `previewInterpretation`; la marca pasa a `RANGED_DICE_STAGED_OFFICIAL_PREVIEW`. La revisión, el evento mínimo y la firma de idempotencia se confirman juntos con `BEGIN IMMEDIATE`.
5. Las repeticiones exactas recuperan la **misma tirada y la misma interpretación**, sin nuevo azar. Cambiar modalidad, revisión o clave después de una tirada se rechaza; un error de escritura revierte el registro.
6. El evento compartido informa solamente de `sequence`, tipo, bando, modalidad y número de dados. No revela las caras, unidad, carta, semilla, posición ni interpretación. Las inspecciones internas del laboratorio **no pueden ofrecerse por HTTP**.

**Importante:** la criba que inicia la reserva es preliminar y no constituye autorización reglamentaria completa. La tirada se denomina `OFFICIAL_PREVIEW` precisamente porque **no es una tirada válida ejecutada en una partida**. El servicio no aplica impactos, banderas, retiradas, excepciones de escenario, bajas, victoria ni modificación de unidades. Las banderas siguen `flagsPending`, y `hitsApplied:false`, `attackAuthorized:false`, `combatResolved:false`. Una reserva en la que ya se generaron resultados no se puede cancelar automáticamente; la futura política de deshacer acciones aleatorias necesitará autorización y acuerdo.

Los símbolos de las versiones sintéticas son un contrato de demostración anterior y **no** deben usarse para jugar el reglamento oficial.

## Evidencia de prueba

Probado en **Node.js v22.16.0, Linux nativo, sin WSL ni GitHub Actions**:

```sh
node --test \
  packages/ancients-rules/dice-plan.test.mjs \
  packages/ancients-rules/sqlite-official-dice-preview.test.mjs \
  packages/ancients-rules/battle-dice.test.mjs \
  packages/ancients-rules/sqlite-reservation-lab.test.mjs \
  packages/ancients-rules/sqlite-guarded-reservation.test.mjs \
  packages/ancients-rules/sqlite-dice-staging.test.mjs \
  packages/dice-roller/dice.test.mjs
```

**89/89 pruebas PASS, 0 FAIL, 0 SKIP** (7 archivos de pruebas). Se repitió la batería cinco veces más con 89 éxitos y cero fallos. Las **26 pruebas nuevas** son 9 de creación/lectura de planes y 17 de reservas SQLite oficiales. Comprueban planes antiguos versionados y sin versión, apertura en modos distintos, seis símbolos frente a los sintéticos, resultados físicos y digitales, conservación del mismo resultado tras reapertura, idempotencia, cortafuegos entre jugadores, falsas especificaciones del cliente, limitaciones del terreno, conflictos de revisión, cancelación antes/después de generar dados, rollback ante errores y privacidad del evento público.

Hashes Git de los archivos **nuevos o editados**, contrastados con las copias locales ejecutadas:

| Archivo | Git blob SHA |
| --- | --- |
| `dice-plan.mjs` | `835509624b5fdb70c04e9ea6e3a84952552c6909` |
| `dice-plan.test.mjs` | `af7384f8094ac8397e207b4e21aacd37c54c49a9` |
| `sqlite-reservation-lab.mjs` | `bfd5532dc69140e296642c5d68e45b2aab50846e` |
| `sqlite-guarded-reservation.mjs` | `6b560fcc141c2534858d22ae303b77b9713cfc26` |
| `sqlite-official-dice-preview.test.mjs` | `b1c7bee422de4cfd61c6eb1ea4b48e4cea4cc0ba` |

SHA-256 del registro TAP local: `d416beddd6696d79a64f5b19eeb24f7b19e03d4209c79fba9f1041aadb9488b7`.

Se registran **54 suites** del proyecto; el número de suites registradas **no representa una regresión integral ejecutada**. No se ejecutaron el resto de suites HTTP/SSE, Windows nativo, pruebas reales de navegador con dos usuarios o concurrencia multiproceso.

## Pendiente antes de fusionar

1. Validación de autorización reglamentaria completa antes de ejecutar **un combate real**, con cartas oficiales, órdenes, excepciones, secuencia y decisiones defensivas. El motor de previsualizaciones no puede usarse como un endpoint para jugadores.
2. Resolución de impactos/bloques, banderas, apoyo, líder, retiradas y victoria; interpretación específica de otros tipos de combate.
3. Confirmación bilateral de resultados físicos y acuerdo de deshacer acciones aleatorias; seguridad y autenticación de las sesiones HTTP.
4. Regresión integral de **54 suites**, Windows, privacidad de ambos jugadores, carreras multiproceso, verificación de escenarios y aceptación en móvil/PC.
5. Revisión de la cadena de PR en borrador. **No fusionar ni desplegar** hasta que los puntos anteriores se hayan validado.

**Resultado:** almacenamiento versionado y recuperable de dados oficiales interpretados **solo a modo de previsualización**, compatible con los planes sintéticos anteriores y sin habilitar reglas oficiales completas.
