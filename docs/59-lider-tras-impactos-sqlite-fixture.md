# CCW-015 — Comprobación provisional del líder después de aplicar impactos en fixtures

**Fecha:** 11/11/2026. **Rama:** `feat/i4-ancients-leader-after-fixture-hits`, basada en la PR **#71**. **Estado:** exclusivamente laboratorio SQLite CCRL, con salvaguardas de opt-in; **no** es combate oficial ni tiene ruta HTTP.

## Contexto y orden reglamentario

La PR #71 introduce una **aplicación ficticia de impactos directos** sobre el tablero de laboratorio con doble autorización de prueba: el constructor `openAncientsDirectHitFixtureAdapter` exige `enableUnsafeFixtureMutation:true` y el estado guardado exige `labFixtureOnly:true`. A diferencia de las PR anteriores de solo previsualización, esta operación deja constancia de que se han retirado bloques **en un fixture**, pero **no acredita la legalidad de una batalla real**.

Este incremento vincula la comprobación provisional del líder **después** de la transición `LAB_DIRECT_HITS_APPLIED_FIXTURE`. Es importante porque las reglas del básico de *Command & Colors: Ancients* (3.ª edición, 2009) establecen la comprobación del líder después de retirar bloques: dos dados/dos cascos si la unidad asociada sobrevive, o un dado/un casco si es eliminada. Como máximo se efectúa una comprobación por secuencia de combate; si la unidad desaparece y el líder sobrevive, debe intentar evadirse.

Fuentes:
- [GMT Games — reglas de 2009](https://www.gmtgames.com/living_rules/CC_Rules_2009.pdf).
- [Reglas sobre líderes y comprobaciones de baja](https://www.commandsandcolors.net/ancients/the-game/main/14-leaders.html).
- [FAQ: un solo control de líder por secuencia](https://www.commandsandcolors.net/ancients/the-game/main/faqs/leader.html).

**El resultado almacenado sigue siendo una previsualización de laboratorio**. No elimina líderes, no ejecuta evasión, no resuelve banderas ni finaliza combates; no puede ser utilizado directamente para una partida oficial.

## Implementación

`packages/ancients-rules/sqlite-leader-after-hit-fixture.mjs` añade `makeLabLeaderAfterHitPreviewCommand`, un constructor de comando que acepta componentes internos de SQLite y del capturador oficial de dados. La PR #71 ya valida la identidad del fichero CCRL (tres tablas, app ID propio, integridad), el opt-in de fixture y la conexión transaccional.

`sqlite-lab-direct-hit-commit.mjs` conecta ese comando, exponiendo en el **adaptador exclusivo de laboratorio** `stageLeaderCasualtyPreview()`.

El único formato admitido para la solicitud es:

```js
{
  matchId, sessionUserId, reservationId,
  expectedRevision, idempotencyKey,
  mode: 'DIGITAL' | 'PHYSICAL',
  declaredFaces // solo si mode === 'PHYSICAL'
}
```

No se permite que una petición suministre el bando, el tablero, el tipo de líder, los bloques, la cantidad de dados, los símbolos permitidos o el generador aleatorio. `sessionUserId` tiene que venir de una autenticación fiable del servidor.

En una transacción `BEGIN IMMEDIATE`, la operación:

1. Comprueba participante, revisión, firma de idempotencia y reserva.
2. Exige `labFixtureOnly:true`, el estado `LAB_DIRECT_HITS_APPLIED_FIXTURE`, `unverifiedFullRules:true`, el resumen de impactos guardado, su revisión y el resumen SHA-256 del **tablero posterior a los impactos**.
3. Requiere que `appliedFixture.summary` confirme `leaderCheckRequired:true`, al menos un bloque retirado y el paso pendiente `LEADER_CASUALTY_CHECK`. Un disparo que solo haya causado banderas no habilita una comprobación prematura.
4. Deriva internamente **un dado** si la unidad quedó eliminada o **dos dados** si sobrevivió. Captura el resultado digital con `crypto.randomInt` o transcribe el resultado físico sin considerarlo verificado.
5. Valida tipo, propósito, actor, cantidad, caras oficiales y procedencia de la tirada. Calcula `leaderWouldBeEliminated` y, cuando la unidad ya no existe, `leaderMustEvadeIfApplied`; mantiene `leaderRemoved:false` y `leaderEvasionResolved:false`.
6. Guarda `fixtureLeaderCasualtyPreview` en `turn_json` (estado privado), aumenta revisión, incorpora una clave de comando y un evento público mínimo `LAB_LEADER_CASUALTY_PREVIEW_STAGED`. Un error provoca **rollback completo**.

El evento público solo comunica secuencia, tipo, bando, modalidad y cantidad. No incluye identificadores de líderes ni unidades, caras obtenidas, resultados, cartas, reserva o huellas del tablero.

### Idempotencia y límites

- Un reintento idéntico recupera las caras y la interpretación comprometidas **sin volver a lanzar**.
- Un cambio de modalidad o declaración con la misma clave provoca `IDEMPOTENCY_KEY_REUSED`. Una clave diferente no permite repetir la comprobación tras registrarla.
- Un tercero o el bando que no realizó la reserva no puede registrar resultados.
- La falta de opt-in, un tablero cambiado tras la aplicación, ausencia del paso de líder y estados anteriores a `LAB_DIRECT_HITS_APPLIED_FIXTURE` se rechazan.
- Una comprobación guardada con resultados internamente contradictorios **no se devuelve** mediante un reintento.
- El tablero de pruebas **no se vuelve a modificar** al registrar la comprobación del líder. El líder sigue presente tanto si la unidad sobrevive como si fue eliminada; el resultado solo indica qué debería hacerse después.
- Los resúmenes SHA-256 permiten detectar cambios imprevistos, pero **no son un sistema criptográfico contra personas con escritura directa sobre SQLite**.
- **No se modifica el esquema CCRL ni el SQLite principal CCWB.**

## Evidencia

Con **Node.js 22.16.0, Linux nativo, SQLite real, sin WSL ni GitHub Actions**:

```sh
node --test --test-reporter=tap \
  packages/ancients-rules/sqlite-leader-after-hit-fixture.test.mjs
```

**13/13 pruebas PASS, 0 FAIL, 0 SKIP**, repetidas **cinco veces consecutivas**. Se utilizan dobles de la aplicación de impactos y del capturador, para comprobar de forma reproducible la transacción con SQLite real, pero **no** son una verificación integrada de todas las reglas oficiales.

Incluyen: obligatoriedad de la aplicación previa, rechazo del fixture sin marca, un/dos dados, evasión condicional sin ejecutarla, resultado digital sin repetir azar, idempotencia, otro jugador/tercero, revisión caducada, firma de tablero, privacidad del evento, rollback y datos alterados.

Se contrastó la identidad exacta de los archivos publicados y ensayados:

- `sqlite-leader-after-hit-fixture.mjs`: Git blob `8d6b3fbc36f516df1bf144bfde1204a3944c556c`.
- `sqlite-leader-after-hit-fixture.test.mjs`: Git blob `0531edb584be7d6854e5c79276c366f68bfb21b6`.
- SHA-256 del quinto TAP: `d52b7ae485832184ea10a4c308e968ce6d8db0980cb9e3ddf8910291f87c4e22`.

Se han añadido **6 pruebas de integración completas pendientes de ejecución** en `sqlite-leader-after-hit-adapter.test.mjs`: reserva real, dados oficiales, aplicación de impactos en fixtures, comprobación de líder, una conexión reabierta y privacidad. El conjunto de GitHub registra **62 suites**, pero **NO se han ejecutado conjuntamente**; tampoco Windows nativo, HTTP/SSE ni carreras multiproceso.

## Relación con las PR #71 y #72

- **#71** aporta la aplicación de impactos en fixtures de CCRL.
- **Esta rama, basada en #71**, prepara la comprobación posterior de líder en el mismo laboratorio.
- **#72**, creada en paralelo sobre #70, anticipaba una previsualización del líder cuando los impactos todavía no estaban aplicados. **No debe integrarse como etapa posterior a #71**. La presente rama la sustituye para el flujo secuencial de fixtures; los cambios de #72 no deben fusionarse automáticamente ni duplicarse.

## Pendiente

1. Ejecutar las **62 suites completas** y especialmente las integraciones nuevas, Windows nativo y concurrencia multiproceso.
2. Implementar **autorización real de combates** por cartas, órdenes, escenarios y excepciones. El doble opt-in de fixtures no sustituye esa comprobación.
3. Convertir una comprobación confirmada en baja de líder autorizada; después, implementar evasiones, moral y retiradas de unidades, manteniendo una sola comprobación por secuencia.
4. Comprobar privacidad de manos/cartas y eventos entre dos sesiones HTTP reales y confirmar dados físicos entre jugadores.
5. Mantener las PR dependientes en borrador sin fusionar ni desplegar hasta validar.

**Resultado:** flujo del laboratorio `dados → bloques aplicados a fixture → comprobación provisional de líder` persistido, sin terminar el combate ni modificar partidas reales.
