# CCW-015/016 · Registro experimental de dados tras reserva de combate de Ancients

**Fecha:** 10/11/2026. **Estado:** incremento de laboratorio, sin API HTTP ni combate oficial. **Rama:** `feat/i4-ancients-staged-dice-synthetic`, dependiente de la PR #64. **Reglas R-06/R-13:** parciales, **no implementadas oficialmente**.

## Objetivo y separación

La PR #64 permite reservar y cancelar una comprobación preliminar de disparo con el guard real de Ancients en un SQLite de **tres tablas independiente** (`CCRL`). Este incremento añade `stageDice()` al mismo laboratorio y reutiliza las funciones genéricas `generateDigitalRoll` y `recordPhysicalRoll` de `packages/dice-roller/dice.mjs`. No toca el SQLite principal `CCWB` ni su esquema de seis tablas.

El flujo experimental es:

1. **Reserva:** `reserve()` verifica con el tablero, fase, órdenes, alcance, LOS y terreno del servidor y genera una marca `RANGED_SCREENING_ONLY`. Si la criba proporciona un `ranged.diceAfterTerrain` entre 1 y 32, almacena un plan privado de dados `dicePlan`.
2. **Tirada digital:** `stageDice({mode:'DIGITAL',...})` obtiene los símbolos mediante `crypto.randomInt` en el servidor y guarda la tirada como `SERVER_GENERATED`.
3. **Dados físicos:** `stageDice({mode:'PHYSICAL',declaredFaces:[...],...})` verifica longitud y valores frente al plan guardado y conserva el resultado con procedencia `PLAYER_DECLARED`, **no verificada automáticamente**.
4. **Registro atómico:** bajo `BEGIN IMMEDIATE`, guarda la tirada privada y cambia la marca a `RANGED_DICE_STAGED_SYNTHETIC`, aumenta la revisión, escribe una clave de idempotencia y un evento público mínimo. Un reintento exacto recupera el mismo resultado digital o declarado, **sin volver a tirar**.
5. **Bloqueo de deshacer:** una reserva con dados registrados **no** puede pasar por `cancel()` como si solo se hubiese precomprobado una acción. Tampoco permite otra tirada con una clave diferente.

Los símbolos `RED`, `BLUE`, `FLAG`, `RED` constituyen únicamente **un dado sintético de cuatro posiciones para laboratorio**. **No representan la distribución ni el efecto de las caras oficiales de Command & Colors: Ancients.** La duplicación de `RED` ilustra probabilidades por ranura, no la composición del dado oficial. Ningún resultado produce impactos, banderas, bajas, evasiones, retiros, cambios de unidades ni victoria. `attackAuthorized:false` y `combatResolved:false` se mantienen explícitos.

## Seguridad, revisión y privacidad

- `sessionUserId` debe derivarse **solo de autenticación del servidor**. La firma incluye reserva, revisión, modalidad y caras físicas declaradas; reutilizar la clave con un cambio devuelve conflicto.
- La cantidad de dados y sus caras **no pueden ser proporcionadas por el navegador**; nacen de la criba real y de la configuración interna del laboratorio. Si un comprobador inyectado no entrega cantidad fiable, `stageDice()` responde `DICE_PLAN_UNAVAILABLE`.
- Entradas inválidas, modos desconocidos, símbolos no previstos y longitudes diferentes quedan rechazados sin mutación.
- La marca de combate y el resultado completo permanecen en `lab_matches.turn_json`, que se utiliza exclusivamente de forma interna; **no exponer `inspectFixture`, `unsafeTestDatabase` ni las respuestas internas en una API**.
- El evento de auditoría público `RANGED_DICE_STAGED_SYNTHETIC` incluye solo número de secuencia, tipo, bando, modalidad y cantidad; **no caras, IDs de unidades, reserva, rollId, LOS, manos ni cartas**.
- Un tercero no puede acceder a la partida; un participante que no creó la reserva no puede registrar sus dados. La tirada física aún **no cuenta con verificación bilateral**, que deberá implementarse antes de partidas reales.
- Ante un error de SQLite se revierte la revisión, la tirada y el comando; no se conserva un resultado que no haya quedado comprometido en la transacción.

## Pruebas reales

Comando ejecutado en **Node.js 22.16.0, Linux nativo**, sin WSL ni GitHub Actions:

```sh
node --test --test-reporter=tap \
  packages/ancients-rules/sqlite-reservation-lab.test.mjs \
  packages/ancients-rules/sqlite-guarded-reservation.test.mjs \
  packages/ancients-rules/sqlite-dice-staging.test.mjs
```

**47/47 PASS, 0 FAIL, 0 SKIP**: las 33 pruebas anteriores de reservas, cancelación y guardas reales, más **14 casos** de dados. La batería se ejecutó repetidamente (8 ejecuciones consecutivas correctas con la implementación local antes de sustituir el módulo de dados por los bytes exactos del repositorio; posteriormente se repitió con el módulo original y volvió a superar las 47 pruebas).

Se verificaron los siguientes hashes **Git blob exactos** entre los archivos publicados y los ejecutados:

| Archivo | SHA Git blob |
| --- | --- |
| `sqlite-reservation-lab.mjs` | `6a92f561634ef6d62a82c64fbc68a402afc97821` |
| `sqlite-dice-staging.test.mjs` | `814d5a78e7f827d73c6e69fb294bf903808245c2` |
| `sqlite-guarded-reservation.test.mjs` | `299b640f0b60dab37b21f94ac0c7aa9299539fe2` |
| `dice-roller/dice.mjs` (sin cambios) | `361885e11ef2a38c0a9029d78609e6dfae34d3f4` |

La tercera suite añade pruebas de modalidad digital y física, protección frente a cambios de resultados y doble tirada, reintentos tras abrir otra conexión, rechazo de datos forjados, cancelación anterior y posterior a la tirada, tercero/contrincante, reversión tras fallo de evento y no filtración del resultado en eventos.

La matriz de ejecución general consta de **51 suites registradas**. **No se ha ejecutado la batería integral** de esas 51 suites, la regresión Windows ni el navegador con dos personas. El resultado anterior acredita solo los 47 casos indicados.

## Puertas pendientes

1. Definir **caras y distribución oficiales** conforme a edición y erratas, además de su interpretación por tipo de unidad, impacto, líder, terreno y combate; no trasladar los símbolos sintéticos al juego real.
2. Diseñar la máquina de estados real desde `RANGED_DICE_STAGED_SYNTHETIC` hasta una resolución reglamentaria, incluyendo reacciones del defensor, retiradas y efectos sobre el tablero. La reserva no confiere por sí sola permiso para lanzar dados.
3. Para dados físicos, decidir validación bilateral y política de desacuerdo; para dados digitales, preservar resultados ya registrados y el histórico auditable.
4. Integrar sesión HTTP real, CSRF, acceso privado por jugador y proyecciones sin pérdida de información oculta, manteniendo aislados los métodos de prueba.
5. Ejecutar las 51 suites, regresión SQLite/Windows y verificaciones multiproceso y de dos sesiones. No fusionar ni desplegar las PR apiladas hasta completar las condiciones.

**No hay todavía un motor de resolución oficial. El incremento es una prueba de registro y persistencia fiable de resultados sintéticos.**
