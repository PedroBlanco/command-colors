# LAB-ANC — Traza auditable de desplazamientos candidatos (sin confirmar)

**Fecha:** 12/11/2026. **Base de esta rama:** PR #95 (`feat/lab-anc-leader-movement-preflight`). **Estado:** modelo interno de auditoría, sin autorización reglamentaria, persistencia ni HTTP.

## Necesidad y contrato

El laboratorio existente permite guardar un borrador privado de rutas propuestas, pero **un borrador no es un evento de movimiento ejecutado**. Se incorpora `packages/ancients-rules/movement-candidate-journal.mjs` para reconstruir de modo determinista una **traza auditable de las rutas candidatas**, sin elevar su categoría:

`buildAncientsCandidateJournal({matchId,actor,baseRevision,units,leaders,orderedUnitIds,orderedLeaderIds,terrain,actions})`.

Se exige un identificador válido de partida, bando y revisión. La función usa `precheckAncientsMovementSequence` y **no crea ningún registro** si la secuencia no obtiene `CANDIDATE_SEQUENCE`. Para una candidata se generan registros inmutables ordenados por número, con identidad y tipo de pieza, coordenadas de salida, ruta, destino, líder transportado o incorporado y vínculos de separación/unión. Se calcula `contextDigest` sobre partida, bando, revisión, tablero, perfiles, órdenes y terreno del servidor; cada registro incorpora el resumen del anterior y su propio digest SHA-256, y el resultado proporciona `finalDigest`.

La representación es **canónica**: se ordenan las piezas, órdenes y celdas de terreno para evitar falsos cambios ante otra enumeración equivalente, y se normalizan las coordenadas incluso cuando las propiedades del objeto JSON llegan en distinto orden. No se introducen horas, números aleatorios ni datos de manos privadas. No se serializan fichas, cartas o escenarios licenciados.

`verifyAncientsCandidateJournal` **regenera todo** desde el tablero, órdenes, terreno y acciones que el servidor le suministre nuevamente. Devuelve `false` si cambian el contexto, las acciones o cualquier campo de la traza; devuelve igualmente `false` ante entradas no verificables. **No lee ni confía en el contenido de la traza como fuente de reglas**, no valida sesión y no autentica al servidor.

## Separación de seguridad y futura implementación

- Estado favorable: `status:'CANDIDATE_EVIDENCE'`. El resultado y la traza siguen marcados `movementAuthorized:false`, `attackAuthorized:false`, `stateChanged:false`, `needsFullLegalityCheck:true`.
- Estado rechazado: `status:'BLOCKED'`, `journal:null` y **ningún** registro parcial que pueda confundirse con movimiento ejecutado.
- El encadenamiento SHA-256 detecta modificaciones accidentales cuando se compara contra la entrada original; **no es una firma digital ni MAC**. Quien controle la base o el cálculo puede generar otra cadena válida. La autenticidad de los movimientos será tarea de la futura autorización del servidor, del historial de comandos y de los límites de sesión.
- **No** se modifica `ancientsSectionMovementDraft`, `matches`, `game_events`, `game_commands`, `game_revision`, el tablero, la sesión, el puente CCWB, las rutas HTTP/SSE ni la interfaz. No se crea reductor de juego ni migración.
- **No se usará `CANDIDATE_EVIDENCE` como permiso de juego**. Antes de registrar un evento auténtico en `game_events` hace falta una implementación separada de movimiento autorizado: reglas ordinarias completas y excepciones, fases, consumo de órdenes, participación del líder, escenario, idempotencia, concurrencia y replay transaccional.

### Verificación disponible

Nueva suite `movement-candidate-journal.test.mjs`: **10 casos** de enlace de registros, ausencia de permisos, rechazo de alteración y datos extra, regeneración contra tablero/terreno/órdenes, determinismo, bloqueo sin traza, inmutabilidad y formato SHA-256.

**Evidencia ejecutada:** **10/10 casos correctos** en V8 aislado con dependencias puras reconstruidas desde los blobs GitHub, sustituyendo `createHash` por un resumen determinista solo para comprobar las relaciones y transiciones. Se detectaron y corrigieron durante la evaluación una discrepancia de orden de propiedades de coordenadas y un error de verificación al comparar un contexto inválido. **No se ha ejecutado este módulo con `node:crypto` nativo ni `node:test`**; el test de SHA-256 se ejecutó contra el mismo simulador y **no prueba criptografía real**.

Los tests nativos del subcontrato del borrador en la PR #95 (19 casos documentados), su análisis de SQLite/WAL y las pruebas de composición siguen **separados** de la nueva traza. El manifiesto de esta rama tiene **76 suites** (75 de la base y una nueva), pendientes de regresión conjunta real.

## Criterios para completar esta etapa

1. Ejecutar las diez pruebas de esta suite con Node.js y SHA-256 reales, cotejando los blobs Git recuperados del repositorio.
2. Ejecutar la composición CCWB real, pruebas de las sesiones, invitaciones, aislamiento privado, WAL y regresión de las 76 suites del mismo SHA.
3. Diseñar un **tipo diferente** para movimientos confirmados, que solo el motor reglamentario pueda producir, con transiciones atómicas y replay. No transformar ni exportar esta traza hipotética directamente a un evento público.
4. Mantener la PR separada, sin fusionar en `main` ni desplegar hasta superar los criterios anteriores y SEC-001 (#93).


### Comprobación nativa limitada del encadenamiento (12/11/2026)

Para separar **SHA-256 real** de la simulación V8, el módulo
`movement-candidate-journal.mjs` se reconstruyó en un árbol de pruebas
nativo. El blob fue contrastado con `git hash-object` y coincide
**exactamente** con GitHub:
`0a75fc79327ce451d90be0360870620081ba8625`.

Se creó **fuera del repositorio** una dependencia sustituida
(`precheckAncientsMovementSequence`) que devuelve únicamente una
secuencia de dos pasos controlada. Esta sustitución **no verifica las
reglas de movimiento**; permite ejecutar el propio módulo exacto con
`node:crypto` real y comprobar el formato y el cálculo independiente
de sus digests.

Ejecución: `node --test --test-reporter=tap` con Node.js 22.16.0,
Linux nativo, sin WSL ni Actions. Resultados: **3 PASS / 0 FAIL /
0 SKIP**, salida **0**. Se comprobaron SHA-256 real de la primera
entrada frente a un cálculo independiente, continuidad del enlace,
rechazo de modificaciones de datos/contexto y bloqueo sin traza.
SHA-256 del informe TAP: `7e3594a8c780716a9f19167d784543e7c376b21598087693714307f6fa8af82f`.

**Alcance total y limitación:** existen 10 casos **V8 aislados** con
resumen simulado y **3 casos nativos de hash** con precheck simulado.
Las 10 pruebas oficiales del archivo `movement-candidate-journal.test.mjs`
siguen **sin ejecutarse con sus dependencias de reglas reales bajo
Node.js nativo**. Tampoco se ha ejecutado la composición SQLite,
HTTP/SSE o la regresión de 76 suites. Esta evidencia no autoriza la
fusión ni la ejecución de ningún movimiento.
