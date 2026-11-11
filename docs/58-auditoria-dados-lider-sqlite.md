# CCW-015 — Registro transaccional de una comprobación preliminar de líder

**Fecha:** 11/11/2026. **Base:** PR #70. **Estado:** incremento de laboratorio **CCRL**, no integra las partidas reales ni autoriza un combate. El objetivo es conservar una previsualización del resultado de la comprobación de líder, que se pueda recuperar sin nuevos dados.

## Contrato y fuente de reglas

Las reglas del juego básico de *Command & Colors: Ancients* (3.ª edición, 2009) distinguen la tirada de ataque de la tirada posterior de comprobación de baja del líder. La comprobación sigue a la pérdida efectiva de bloques: **dos cascos en dos dados** si la unidad asociada sobrevive, o **un casco en un dado** si desaparece. No se repite durante la misma secuencia de combate aunque después existan pérdidas por retirada.

- [Reglas oficiales GMT, 2009](https://www.gmtgames.com/living_rules/CC_Rules_2009.pdf).
- [Líderes — comprobaciones, evasión y orden](https://www.commandsandcolors.net/ancients/the-game/main/14-leaders.html).
- [Preguntas frecuentes sobre líderes](https://www.commandsandcolors.net/ancients/the-game/main/faqs/leader.html).

**Distinción esencial:** en este incremento los impactos **NO se han aplicado**. Por consiguiente, la tirada almacenada es una **previsualización hipotética de laboratorio** y **no equivale a haber efectuado la comprobación reglamentaria del líder en una partida**. La comprobación efectiva seguirá bloqueada hasta disponer de la transición autorizada que retire bloques y abra la fase del líder.

## Implementación

`packages/ancients-rules/sqlite-leader-preview-command.mjs` exporta `makeLeaderPreviewCommand`, un constructor para uso **exclusivamente interno del servidor/laboratorio**. La composición de `openAncientsReservationLab()`, en `sqlite-reservation-lab.mjs`, inyecta las comprobaciones reales de la rama y expone `stageLeaderCasualtyPreview()` **solo en la API interna del laboratorio**.

La operación recibe únicamente:

```js
{
  matchId, sessionUserId, reservationId,
  expectedRevision, idempotencyKey,
  mode: 'DIGITAL' | 'PHYSICAL',
  declaredFaces // exclusivamente en PHYSICAL
}
```

El `sessionUserId` solo puede proceder de la sesión autenticada **del servidor**. El cliente no puede elegir actor, tablero, bloques, tipo de unidad, cantidad de dados, caras permitidas ni fuente de aleatoriedad.

Dentro de `BEGIN IMMEDIATE`:

1. Comprueba miembro de la partida, actor de la reserva, idempotencia y revisión.
2. Exige que haya una tirada original `RANGED_DICE_STAGED_OFFICIAL_PREVIEW`, con plan oficial, resumen SHA-256 del tablero intacto e interpretación coherente. Las tiradas sintéticas y reservas sin dados se rechazan.
3. Recalcula desde los datos SQLite el pronóstico de pérdidas y la secuencia de la PR #70. Solo continúa si aparece una comprobación directa pendiente `LEADER_CASUALTY_CHECK` (no una comprobación condicional posterior a banderas sin pérdidas).
4. Deriva del pronóstico oficial **uno o dos dados**, sin aceptar un recuento del solicitante; genera una tirada `DIGITAL` con el generador criptográfico ya existente, o registra una transcripción `PHYSICAL` marcada `PLAYER_DECLARED`.
5. Obtiene `previewBaseAncientsLeaderCasualtyCheck` con el **tipo y propósito separados** del lanzamiento original. Guarda en el estado privado `leaderCasualtyPreview:{kind:'LEADER_CASUALTY_PREVIEW_ONLY',roll,outcome,requiresAuthorizedHitApplication:true}`.
6. Incrementa revisión, escribe `lab_commands` con firma de modalidad/valores y un evento público mínimo, y confirma **en una única transacción**. Un fallo en cualquier escritura revierte todo el registro.

El evento público `LEADER_CASUALTY_PREVIEW_STAGED` incluye solo secuencia, tipo, bando, fuente y cantidad. **No** contiene el resultado de los dados, casco, bajas, ID del líder, IDs de unidad, cartas, huellas de tablero ni IDs de tirada. Los datos privados no deben exponerse a una ruta HTTP.

El método devuelve `previewOnly:true`, `attackAuthorized:false` y `combatResolved:false`. **No modifica `board_json`, no descuenta bloques, no elimina líderes, no ejecuta evasiones y no concede estandartes.** Tampoco marca ningún paso del checklist como ejecutado.

## Reintentos, incompatibilidades y reversión

- Un **reintento exacto**, incluso tras abrir otra conexión SQLite, recupera la misma tirada y la misma interpretación; **no vuelve a lanzar** dados digitales ni crea eventos nuevos.
- Cambiar la modalidad, los dados físicos o la revisión reutilizando la clave produce `IDEMPOTENCY_KEY_REUSED`. Una clave distinta no permite registrar otra comprobación en la misma reserva.
- La operación requiere revisión vigente para el primer registro y verifica que el tablero no haya variado desde el disparo original. Cambios de tablero, falta de bloques, líder ausente o un pronóstico que no exige comprobación producen denegación sin resultados.
- Se rechazan datos añadidos como `board`, `diceCount`, `leaderAttached`, `actor`, `randomIndex` o `targetId`.
- La repetición comprueba también la coherencia del resultado privado guardado, para no devolver una interpretación inconsistente.
- `CCRL` conserva **tres tablas y su versión original**; el esquema principal de partidas `CCWB` (seis tablas) no se toca. El resumen SHA-256 identifica modificaciones accidentales, **no** protege contra un atacante que controle directamente la base.

## Pruebas y evidencia

Con **Node.js v22.16.0 Linux nativo**, sin WSL ni GitHub Actions, se ejecutó:

```sh
node --test --test-reporter=tap \
  packages/ancients-rules/sqlite-leader-preview-smoke.test.mjs
```

**5/5 pruebas PASS, 0 FAIL, 0 SKIP**, ejercitando el **mismo módulo de comando publicado** sobre SQLite real. Para aislar la transacción, estas pruebas utilizan **dobles** de las comprobaciones del reglamento y no validan el encadenamiento completo de reglas de *Ancients*. Verifican evento mínimo, persistencia, preservación del tablero, idempotencia, rechazo de actor/revisión/cantidad y reversión.

Una batería local más amplia, también con SQLite real y dobles de reglas, pasó **15/15 pruebas**, pero se mantiene fuera del inventario de pruebas del repositorio.

Hashes Git contrastados con los archivos locales ejecutados:

- `sqlite-leader-preview-command.mjs`: `24bf9700c0d50e90a5f0f1173b989fc4a25f7f6f`.
- `sqlite-leader-preview-smoke.test.mjs`: `bde801036785e90ce76862b15df007fcf80fcba3`.

Adicionalmente se han incorporado **22 pruebas de integración reales** en `sqlite-leader-preview.test.mjs`, que ejercitan el adaptador existente, los módulos de reglas verdaderos, versiones de dados, líderes, cancelaciones, dos conexiones y rollback. **Estas 22 pruebas todavía NO se han ejecutado nativamente**; tampoco las **6 pruebas de integración** pendientes de la PR #70.

El manifiesto general registra **59 suites**. No se ha ejecutado la regresión integral del repositorio ni la validación Windows nativa, HTTP/cookies/SSE, dos jugadores con navegadores o carreras multiproceso.

## Próximos pasos

1. Ejecutar **las 59 suites** con el repositorio completo, corregir cualquier incompatibilidad entre módulos y verificar las 28 pruebas de integración pendientes (6 anteriores + 22 nuevas).
2. Implementar la aplicación **autorizada y transaccional** de bloques reales. Solo después deberá abrirse la comprobación de líder **reglamentaria**, separada de esta previsualización.
3. Diseñar validación bilateral para dados físicos, evasión del líder superviviente, moral, aceptación de banderas, rutas y pérdidas por retirada.
4. Comprobar privacidad, permisos, eventos y reconexión en sesiones HTTP reales y Windows nativo.
5. Mantener la cadena de PR en borrador; no fusionar ni desplegar hasta completar validación.

**Conclusión:** ya existe un registro reproducible e idempotente de la **previsualización del dado adicional del líder**, pero no un ejecutor de bajas ni una batalla terminada.
