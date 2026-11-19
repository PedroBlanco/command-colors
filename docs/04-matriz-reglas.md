# Matriz de cobertura — Ancients básico

Estado: inventario preliminar. **Ninguna regla figura como implementada.** Fijar edición y erratas antes de aprobar interpretación normativa.

| ID | Familia | Iteración objetivo |
| --- | --- | --- |
| R-01 | Topología 13×9, distancia, adyacencia y sectores compartidos | 1 |
| R-02 | Escenarios, despliegue, iniciativa, tamaño de mano y victoria | 2 / 7 |
| R-03 | Mazo y cartas de mando: robar, descartar, efectos y agotamiento | 3 / 6 |
| R-04 | Órdenes y elegibilidad de unidades/líderes | 3 / 4 |
| R-05 | Movimiento por unidad, líderes, ocupación y terreno | 4 / 6 |
| R-06 | Combate a distancia, alcance, línea de visión y resultados | 5 / 6 |
| R-07 | Cuerpo a cuerpo, dados, golpes y efectos | 5 / 6 |
| R-08 | Retiradas, evasión, banderas y decisiones del defensor | 6 |
| R-09 | Líderes: vinculación, bonificaciones y bajas | 6 |
| R-10 | Elefantes, carros y casos particulares | 6 |
| R-11 | Terrenos, obstáculos y modificadores | 6 |
| R-12 | Avances, combates adicionales y excepciones | 6 |
| R-13 | Orden de resolución y subprocesos de combate | 5 / 6 |
| R-14 | Victoria y reglas especiales de escenario | 7 |
| R-15 | Todas las cartas del juego básico | 6 / 7 |
| R-16 | Erratas y clarificaciones adoptadas | 7 |

Inventario de escenarios de referencia: Akragas, Crimissos River, Bagradas, Ticinus River, Trebbia, Lake Trasimenus, Cannae, Dertosa (Ebro), 2nd Beneventum, Castulo, Baecula, Metaurus, Ilipa, Great Plains y Zama.

La lista identifica títulos, pero **no** contiene mapas, despliegues ni textos de escenarios. Su incorporación requiere revisar permisos y edición.

## Ficha obligatoria para cualquier regla

Identificador, fuente/edición/página, precondiciones, comando, acciones legales, resultado, excepciones, tests positivos y negativos. Para azar, casos reproducibles con generador inyectado; para dados físicos, validar caras y cantidad. Nunca aceptar acciones sin validación porque falta implementar un tipo de unidad o carta.

## Cobertura técnica I3 — contrato de cartas opacas (CCW-012)

El módulo `packages/command-deck/deck.mjs` implementa únicamente un **contrato técnico con cartas sintéticas**: barajar con RNG criptográfico del servidor, repartir manos con cantidades explícitas, validar ejemplares únicos, conservar todas las cartas y ocultar la mano rival y el orden del mazo. Integra las transiciones de la máquina **sintética** CCW-011, incluida la respuesta pendiente del defensor.

| ID | Componente comprobado | Prueba automatizada | Cobertura reglamentaria |
| --- | --- | --- | --- |
| R-02 | Tamaños de mano configurables y reparto | `deck.test.mjs` — tamaños inválidos y conservación | Pendiente de escenarios oficiales |
| R-03 | Jugar, descartar y robar del mazo oculto | `deck.test.mjs` — cartas, privacidad, no filtración y agotamiento sin remezclar | **No implementado**: efectos, cantidades y agotamiento reales |
| R-13 | Decisión pendiente del defensor sin cambiar el atacante | `deck.test.mjs` — decisión, serialización y retorno al turno | **No implementado**: combate y resoluciones normativas |

En la fecha del incremento se superaron **21 pruebas nuevas**, contra el módulo de fases de `main` (blob SHA contrastado). Los tests acreditan la integridad de un prototipo, **no** una regla de *Ancients* ni el cumplimiento íntegro de R-02/R-03/R-13. Continúan pendientes verificación de edición/erratas, integración transaccional, seguridad del servidor y pruebas visuales. Véase [contrato técnico del mazo](23-mazo-mando-opaco-i3.md).

**No se altera** el inventario inicial: ninguna regla del juego básico se da por implementada hasta fijar su fuente, comprobar excepciones y completar pruebas positivas y negativas.

## Persistencia del contrato técnico (CCW-012, I3)

La evolución posterior de CCW-012 añade la persistencia transaccional SQLite del **mazo sintético**, sin migrar la estructura de seis tablas (v1), y rutas API autorizadas por las sesiones existentes. No constituye cobertura normativa de R-03.

| Requisito | Contrato de laboratorio | Pruebas |
| --- | --- | --- |
| R-02 | Configuración fija de ejemplo: 18 cartas opacas, manos A=2/B=3, sin escenarios reales | `sqlite-game.test.mjs` — inicialización una vez, revisión y conservación |
| R-03 | Jugar, descartar y robar desde estado oculto persistente; descartar publicamente y robar en privado | `sqlite-game.test.mjs` — evento público, no filtración, dos conexiones, reinicio y rollback |
| R-13 | Estado de decisión defensiva persistente entre procesos; el turno del atacante no se adelanta | `sqlite-game.test.mjs` — restauración y rechazo del actor incorrecto |
| Acceso web | Actor determinado por sesión, no por atributo JSON del cliente | `command-deck-http.test.mjs` — cuatro pruebas HTTP preparadas, ejecución pendiente |

**Estado de aceptación:** reglas oficiales **no implementadas**. Los 18 nuevos tests directos SQLite superaron la regresión local, mientras que los cuatro tests HTTP están preparados para ejecutarse con el repositorio completo. Véase [informe de persistencia](24-mazo-persistente-api-i3.md).

## Contrato técnico de dados, sin cobertura reglamentaria (CCW-015/016)

`packages/dice-roller/` separa la generación criptográfica del servidor y la transcripción de dados físicos. Usa caras simbólicas suministradas por el servicio y admite posiciones repetidas para ponderar símbolos. Sus 12 pruebas cubren entradas ilegales y azar inyectado (T-011, T-012, T-013). **R-06 y R-07 no se consideran implementadas**: faltan edición aprobada, cantidad de dados por tipo de combate, símbolos reales, efectos, reglas especiales, autorización HTTP y persistencia. Véase `docs/27-contrato-dados-sinteticos.md`.

## Prevalidación sintética de órdenes (CCW-013)

`packages/order-validator/validator.mjs` comprueba exclusivamente con datos ficticios y fiables: bando, sector, límites de carta, disponibilidad, fase y revisión, con respuesta uniforme para unidades no elegibles. Sus 11 pruebas locales no constituyen implementación de R-04 ni demuestran ninguna carta oficial. El servicio HTTP/SQLite no consume todavía este contrato. Véase [documento técnico](28-ordenes-sinteticas.md).

## Conexión técnica CCW-013 a SQLite (no reglamentaria)

La asignación sintética de órdenes pasa por `validateSyntheticOrderAssignment` **dentro de la transacción de SQLite**, después de las comprobaciones de idempotencia y revisión. El contexto se deriva únicamente de `matches.private_state.board` y de la carta activa; se comprueban unidades reales de la maqueta y se rechazan unidades de otro bando. Los límites y sectores son **inventados**, permisivos para el laboratorio, y no acreditan R-04 de Ancients. La nueva prueba integrada de cookies/SQLite está pendiente de ejecución; véase [nota técnica](29-ordenes-sqlite-transaccion.md).

## I4 — movimiento hexagonal sintético (CCW-014)

El módulo `packages/movement/` comprueba recorrido por vecinos reales *odd-q*, ocupación, terreno bloqueado de ejemplo, límites de pasos por unidad, autorización del actor, órdenes concedidas, revisión y movimientos ya realizados, sin mutación de entradas. **17 pruebas nuevas superadas localmente**. Es una capacidad técnica preliminar, separada de SQLite/HTTP y de los efectos de cartas: **no se da R-05 por implementada**. Ver [nota I4](30-movimiento-sintetico-i4.md).

## Contrato SQLite/HTTP del movimiento sintético (CCW-014)

`move_synthetic_unit` verifica el recorrido sobre geometría *odd-q*, el actor autorizado, unidades ordenadas, límite de distancia, ocupación y revisión; transacciona el tablero y el evento público con la clave de idempotencia. La política local tiene rangos **inventados** y sin obstáculos. Se superaron 48 pruebas de dominio/SQLite ejecutadas juntas, pero la prueba HTTP nueva, la batería completa y el tablero SVG no están validados. **R-05 continúa pendiente** hasta implementar y verificar las restricciones reales por unidad, terreno, líderes y excepciones del básico. Véase [informe](31-movimiento-sqlite-http-i4.md).

## Comprobación SSE de movimientos — incremento I4

El archivo `packages/local-api/movement-revision-sse.test.mjs` añade **4 pruebas de la función SSE real** `startRevisionStream` con contadores de revisión leídos de una base SQLite real; simula la identidad y membresía de dos participantes, sin abrir HTTP ni usar cookies de navegador. Comprueba la notificación de movimiento a ambos, que un rechazo no genera nuevos avisos, que una reconexión recibe la revisión actual y que la revocación de sesión cierra el flujo. Los frames contienen solo `lobbyRevision` y `gameRevision`, sin rutas, cartas ni manos. El archivo SSE publicado coincide en SHA con el ejecutado localmente (`30e374b5478fb1038c0e294bdadddfea6fedef43`).

**Prueba real local:** 52/52 correctas combinando órdenes, movimiento, SQLite y SSE simulado con Node.js 22.16.0. **No equivale a una prueba HTTP/cookies/SSE completa.** Las pruebas HTTP de dos perfiles siguen pendientes; la regresión general enumera ahora **32 suites** y aún no se ha ejecutado conjuntamente en Windows. Ni esta verificación ni el incremento implementan reglas oficiales de *Ancients*.

## Controles de movimiento manual (CCW-014, laboratorio)

El cliente puede crear `move_synthetic_unit` con unidad propia seleccionada del tablero visible, ruta de coordenadas dentro del 13×9 y revisión idempotente. Cinco pruebas directas comprueban formato, permisos visibles y saneamiento de payload; la validación legal definitiva continúa exclusivamente en SQLite. **No implementa reglas oficiales R-05**. La prueba DOM simulada está escrita pero pendiente de ejecución y el tablero SVG de la PR #27 sigue aislado. Véase [nota técnica](32-movimiento-manual-interfaz.md).

## Verificación integrada HTTP/cookies y SSE (7 de noviembre de 2026)

Después de la publicación inicial se han ejecutado las suites **originales del repositorio** `command-deck-cookie.test.mjs` (4/4), `command-deck-sse.test.mjs` (ahora 3/3) y `browser-deck-ui.test.mjs` (7/7), con los módulos de pasarela HTTP, sesiones y SQLite publicados y cotejados por sus hashes Git. La tercera prueba SSE, incorporada a esta rama, realiza **un movimiento real por HTTP con dos conexiones SSE autenticadas**: ambas reciben la revisión 3, un comando rechazado no produce aviso, la reconexión parte de la revisión vigente y el cierre de sesión revoca el flujo. Los mensajes SSE solo contienen `lobbyRevision` y `gameRevision`, sin cartas o rutas.

**Evidencia ejecutada:** `node --test` sobre nueve suites de órdenes, movimiento, SQLite, interfaz simulada, cookies y SSE: **78/78 correctas, 0 fallos**, Node.js 22.16.0. Test SSE publicado con SHA `bd1cc3298329ba926e014ad26b77a5560a523239` idéntico al ejecutado. Queda pendiente la batería completa de **33 suites**, con pruebas de otras áreas del proyecto, y la validación visual real en Windows PC/móvil. No se emplearon WSL, VPS ni GitHub Actions. El laboratorio no debe publicarse en Internet.


## Contrato preparatorio de selección sobre SVG (CCW-014; aún sin R-05)

El módulo puro `packages/local-api/hex-selection.mjs` puede construir un borrador de ruta a partir de la **vista autorizada** del jugador. Comprueba sector de información (unidad propia no movida), fase y actor, revisión, adyacencia geométrica *odd-q*, ocupación pública, celdas repetidas, límite técnico de 32 pasos y deshacer local. No aplica aún los rangos oficiales por unidad ni las restricciones de terreno: el **servidor** conserva toda la autoridad sobre la orden.

**Trazabilidad técnica:** CCW-014 → geometría `hex-grid` + disponibilidad `deckActions` → `hex-selection.test.mjs` (11 pruebas locales correctas, SHA Git verificados) → futura entrada SVG y comando `move_synthetic_unit` de #48. **R-05 continúa sin implementar según reglamento oficial**. Ver [documento I4](39-ruta-seleccion-hexagono-i4.md). Esta rama registra **34 suites**; no se ha ejecutado su conjunto completo.

## I4 — tablero autenticado y trazabilidad de movimiento sintético (PR #50)

**CCW-014 (tecnología de interacción, no R-05 reglamentaria):** `hex-grid` → `hex-selection` → `movement-board-ui` → `deckCommand` → `gateway` → reductor transaccional del servidor. El tablero SVG de 117 hexágonos solo muestra unidades públicas; permite crear/corregir borradores, confirmar con clave idempotente y descartar ante revisión SSE. **19 pruebas de los dos nuevos módulos superadas**, además de prueba HTTP de recursos permitidos *añadida pero aún no ejecutada*. La batería general incorpora **35 suites**.

**Regla R-05 continúa pendiente**: movimientos por tipo de unidad, líderes, terreno, exclusiones y excepciones oficiales todavía no se han contrastado con la edición de referencia. Ver [nota técnica I4](40-tablero-svg-autenticado-i4.md).

## Ampliación de verificación sintética del dominio (9/11/2026)

El contrato técnico de geometría, fases, órdenes, movimientos, mazo y selección SVG se ha re-ejecutado sobre archivos publicados de GitHub mediante **116 callbacks** en V8 aislado, con adaptadores para las primitivas Node, todos correctos. Se distribuyen entre 11 archivos de pruebas (60 de geometría/fases/órdenes/movimiento y 56 de mazo/interfaz). La comprobación **no acredita** ejecución nativa Node.js, SQLite, HTTP/SSE, accesibilidad real ni reglas oficiales **R-04/R-05**. Las referencias previas a 19 pruebas de SVG con Node.js no tienen registro TAP contrastable. Ver [evidencia y límites](40-tablero-svg-autenticado-i4.md).

## Protección de ámbito de navegador (CCW-014; PR #51)

Contrato técnico de privacidad: cambio de cuenta/partida → `private-view-scope.reset/selectMatch` → invalidación de respuestas HTTP anteriores → bloqueo de presentación de eventos, movimientos y tokens desactualizados. Los módulos `private-view-scope` y `private-projection` tienen 20 casos ejecutados mediante Node.js 22.16.0 (20 correctos); la interfaz simulada dispone de 22 callbacks comprobados en V8 (22 correctos). Se rechazan vistas del bando incorrecto y se revalida la sesión antes de inspeccionar o enviar órdenes. No se ha ejecutado aún la batería HTTP real. No implementa reglas oficiales R-04/R-05 ni demuestra seguridad para Internet. Véase [documentación](41-aislamiento-respuestas-navegador-i4.md).

## Sincronización de revisiones SSE con reintentos (I4, PR #52)

Trazabilidad técnica: aviso SSE de contadores → `revision-refresh.notice()` → obtención de proyección autenticada → reconocimiento **solo tras GET exitoso**; fallo o resultado descartado → reintento acotado. Se cubren duplicados, desorden, pestañas ocultas, SSE cerrado, cambios de cuenta y partida. **12/12 pruebas Node nativas** de coordinador y **22/22 callbacks V8 simulados** de interfaz; aún sin batería HTTP global. No implementa movimiento reglamentario ni reemplaza la autorización del servidor. [Especificación](42-reintentos-sse-i4.md).

## Precomprobaciones aisladas de Ancients básico — integración #53, #54, #57 y #59

**R-05/R-06/R-07: parciales, no completadas.** Este bloque añade contratos puros,
sin conexión con la mutación transaccional del laboratorio: perfiles ordinarios
de 13 tipos de tropa, examen de ruta hexagonal y ocupación, terreno bosque/colina/
accidentado y límites ordinarios de dados por terreno. Todos los resultados
conservan `needsFullLegalityCheck: true`; `CANDIDATE` no autoriza una acción y
`maxDice: null` no representa combate ilimitado.

Módulos y trazabilidad en [perfiles](43-perfiles-movimiento-ancients-base.md),
[trayectorias](44-precomprobacion-ruta-ancients.md),
[terreno](46-terreno-ancients-basico.md) y
[dados/terreno](47-limites-dados-terreno-ancients.md).
Se importan los blobs de código y pruebas publicados en las PR de origen,
conservando sus SHA; `hex-grid/hex.mjs` coincide exactamente con `main`.
Las correcciones Windows/SQLite de #55 **no** se reimportan porque la base ya
dispone de correcciones equivalentes y debe conservarlas.

El inventario actual incorpora **44 suites** (39 previas más 5), incluido
`check-test-inventory.test.mjs` y los controles de privacidad/SSE.
Los ensayos nativos registrados en las PR fuente son evidencia histórica de
los módulos sin modificaciones; **no acreditan una regresión completa de esta
integración**. Antes de activar reglas oficiales deben validarse contra edición,
erratas, escenarios y excepciones, con autorización exclusivamente del servidor.

## Línea de visión y precomprobación de disparo — integración #61 y #62

**R-06 sigue incompleta; ninguna salida autoriza un ataque**. El cálculo geométrico
`assessAncientsLineOfSight` trabaja con centros hexagonales `odd-q` y terreno
público del servidor para bosque, colina y accidentado, con obstáculos sobre
aristas opuestas. `assessAncientsRangedProfile` aplica el alcance base y los
dados ordinarios según tropa/movimiento; `precheckAncientsRangedAttack`
combina arma, distancia, ocupación, adyacencia, LOS y terreno. El catálogo
excluye expansiones y las excepciones de cartas, líderes y escenarios.

Documentación: [LOS](48-linea-vision-ancients-basico.md),
[disparos](49-precomprobacion-combate-distancia-ancients.md).
Los tres módulos y sus tests se importan por sus SHA originales de #61/#62;
las dependencias de #145 y `hex-grid/hex.mjs` coinciden con la rama fuente.
Se preserva el inventario previo y se suman **3 suites**: 47 en total.
Las **41 pruebas focalizadas** documentadas en #62 no acreditan una regresión
integral de esta integración. El servidor deberá verificar fase, cartas, órdenes,
historial de movimiento y estado antes de habilitar combates.

## Guarda no ejecutable de turno y órdenes para el disparo — integración de #63

Contrato parcial de *Ancients* 3.ª edición (2009), separado explícitamente del
sistema de turnos `synthetic-phases-v1`. El módulo
`combat-turn-guard.mjs` comprueba turno, fase, revisión, pertenencia,
unidad ordenada, batalla resuelta, decisión pendiente y registro de movimiento
servidor. `ranged-turn-precheck.mjs` lo compone con las verificaciones
de LOS y alcance de #146, sin permitir ataques, tirar dados ni mutar partidas.

**`CANDIDATE` no autoriza combate:** toda salida conserva
`attackAuthorized:false` y `needsFullLegalityCheck:true`; tampoco valida
cartas, líderes, escenarios o excepciones. Solo puede recibir estado de turno
y tablero del servidor, nunca de la petición HTTP.

Fuente: [documentación de guardas](50-guardas-turno-ordenes-disparo-ancients.md).
Se importan exactamente cuatro blobs originales (dos módulos y dos suites),
con dependencias coincidentes byte a byte con `main`.
El manifiesto pasa a **49 suites**. La fuente de #63 documentó 31 casos
V8 correctos, que no sustituyen ejecución nativa Node ni regresión integral.

## Reserva y cancelación atómica de cribas de disparo — laboratorio CCRL (integración #64)

Laboratorio experimental **separado** del almacén de partidas `CCWB`,
sin ruta HTTP y sin migraciones de la aplicación principal. Emplea un fichero
SQLite independiente con `application_id=CCRL`, transacciones `BEGIN IMMEDIATE`,
revisiones e idempotencia, y permite reservar o cancelar una **criba**
de ataque a distancia antes de obtener dados. Las guardas se evalúan contra
tablero y turno del propio almacenamiento; el jugador autenticado
`sessionUserId` solo puede proceder de código servidor fiable.

Ni la reserva ni su cancelación ejecutan combates, consumen cartas,
modifican bloques, manos o unidades, ni publican identificadores privados.
Sus eventos públicos se mantienen mínimos. Las funciones de siembra,
inspección y acceso directo a la base son **exclusivas del laboratorio** y
no pueden conectarse a rutas de red.

Referencia: [laboratorio transaccional CCRL](51-reserva-sqlite-combates-ancients.md).
Los cuatro archivos de módulo/prueba se importan exactamente desde #64
con SHAs Git invariantes, y las dependencias de #147/#146 coinciden.
El manifiesto se amplía a **51 suites**. La rama fuente documenta **33/33
pruebas Node nativas correctas** para el laboratorio, pero esta integración
requiere regresión conjunta antes de dar por validada su convivencia.
**R-04/R-06 y la autorización de combate oficial siguen pendientes.**

## Captura sintética de dados posteriores a la reserva — integración de #65

El laboratorio SQLite `CCRL` amplía la reserva de criba de #148 con
`stageDice()`: registro atómico de tiradas **digitales** generadas por
el servidor o transcripciones **físicas** declaradas por el jugador,
con revisión, idempotencia y conservación del resultado en reintentos.
Tras registrar los dados se impide cancelar la reserva original; no se
aplican bajas, banderas, retiradas, efectos de cartas ni cambios de tablero.
La modalidad física **no** supone aceptación bilateral.

**Advertencia reglamentaria:** las caras `RED/BLUE/FLAG/RED` de esta
fase son inventadas para el laboratorio y no tienen correspondencia con
los seis símbolos oficiales de *Ancients*. La interfaz de juego y
`CCWB` no usan este contrato, ni se añade una ruta HTTP.
`attackAuthorized:false` y `combatResolved:false` siguen vigentes.

[Documento de dados sintéticos y reserva](52-registro-dados-sinteticos-reserva-ancients.md).
Se importan los mismos blobs de #65 (módulo SQLite, nueva suite y ajuste
de test de privacidad), conservando las dependencias idénticas de #148 y
`dice-roller/dice.mjs`. Inventario: **52 suites**. La rama fuente
documentó **47/47** casos nativos focalizados correctos; queda pendiente
regresión completa del nuevo commit y examen de concurrencia multiproceso.

## Captura e interpretación aisladas de los dados oficiales de disparo (#66)

Se introduce `battle-dice.mjs` como **módulo puro e independiente**
del dado de laboratorio de #149. El catálogo del básico de *Ancients*
3.ª edición (2009) contiene seis caras equiprobables: `LIGHT`,
`MEDIUM`, `HEAVY`, `LEADER`, `FLAG` y `SWORDS`. Contra unidades
en disparo ordinario, una cara de símbolo del objetivo es un impacto
**potencial**; `FLAG` queda pendiente de resolver por reglas de retirada;
`LEADER` y `SWORDS` no producen impacto a distancia contra unidades.
Las unidades con borde blanco siguen el color de su figura.

Referencia de reglas: *GMT Games, Ancients Living Rules, 3.ª edición (2009)*
y [documentación del intérprete](53-dados-oficiales-disparo-ancients.md).
No se autorizan ataques, pérdidas, banderas, ni combate contra líderes solos;
`attackAuthorized:false`, `combatResolved:false`,
`hitsApplied:false`, `flagsResolved:false`. Este módulo **no sustituye**
al generador sintético ya almacenado en CCRL y no añade ninguna ruta HTTP.
Se incorpora una suite adicional (inventario **53**). La rama origen
documenta **16 casos nuevos nativos correctos**, con SHA Git idénticos;
no equivale a regresión integral de esta integración.

## Planes versionados de previsualización de dados oficiales en CCRL — #67

Se integra una ampliación **exclusiva del laboratorio SQLite CCRL**.
`dice-plan.mjs` distingue el plan heredado `SYNTHETIC_RANGED_V1`
y el plan `ANCIENTS_BASE_RANGED_PREVIEW_V1`, con esquema versionado y
lectura que falla ante tipos, caras, cantidades o campos incompatibles.
Los registros sintéticos antiguos **no se convierten** a resultados
oficiales. La elección del plan es del código servidor: el cliente
no puede establecer distribución, tipo de objetivo ni cantidad de dados.

El adaptador `openOfficialAncientsRangedPreviewLab()` conserva el
plan y una interpretación preliminar de impactos por color y banderas
en la misma transacción `BEGIN IMMEDIATE`, con revisión e idempotencia.
El resultado es una **previsualización**, no una autorización de disparo,
aplicación de bloques o retirada. El almacenamiento `CCWB`, HTTP,
cuentas reales y manos privadas no cambian.

[Contrato y límites](54-plan-versionado-dados-oficiales-sqlite.md).
Se importan exactamente los cinco blobs de código/pruebas de #67,
con dependencias inalteradas; la rama original documenta **89/89**
pruebas focalizadas nativas correctas, repetidas cinco veces.
El inventario pasa a **55 suites**, pero no se ha ejecutado su
regresión global conjunta en esta integración.

## Previsualización pura de pérdidas de bloques y líderes pendientes — #68

El módulo `block-loss-preview.mjs` recibe el número de bloques restante
**desde estado servidor fiable**, el tipo de unidad, la interpretación
previa de dados oficiales y la posición real de líderes asociados.
Calcula pérdidas **potenciales**, impactos sobrantes, bloques restantes,
posible eliminación, banderas aún aplicables y necesidad de comprobar
la supervivencia del líder. No presupone que una unidad tenga su número
original de bloques ni convierte una eliminación hipotética en estandarte.

**Sin efectos ejecutables:** `hitsApplied:false`,
`bannerAwarded:false`, `flagsResolved:false`,
`boardMutated:false`, `combatResolved:false`.
No cambia SQLite, HTTP ni fichas de partida; el resultado debe vincularse
en el futuro al mismo snapshot y a una secuencia autorizada.

[Explicación y límites](55-perdida-bloques-disparos-ancients.md).
Importados los mismos dos blobs de #68 y sus dependencias coincidentes,
con **24 pruebas nativas correctas documentadas en la fuente**.
Manifiesto de integración: **56 suites**; falta regresión integral conjunta.

## Instantánea transaccional de bloques y dados por revisión — integración de #69

El laboratorio SQLite separado `CCRL` incorpora la consulta
`previewStagedBlockLoss()`, que recupera turno, tablero y tirada oficial
guardada desde la misma revisión bajo `BEGIN IMMEDIATE`.
No acepta del cliente valores de bloques, aciertos, líderes o resultados
de dados; exige identidad de servidor y la titularidad de la reserva.

Las tiradas oficiales recién registradas guardan una huella SHA-256
de `board_json` para detectar modificaciones del tablero entre tirada y
consulta. Las capturas antiguas sin huella y los dados sintéticos **no
se reinterpretan como datos oficiales**. Se vuelve a calcular la
interpretación de los dados y se valida su coherencia con el resultado
persistido antes de estimar pérdidas. La huella no sustituye una
protección criptográfica frente a alguien con acceso directo de
escritura a la base.

No hay daños, eliminaciones, líderes retirados, estandartes, HTTP ni
modificación de CCWB. `hitsApplied:false`, `combatResolved:false`,
`bannerAwarded:false`. Solo previsualización.
[Contrato y evidencia](56-snapshot-sqlite-bloques-disparo-ancients.md).

Se importan los tres blobs de módulo/prueba exactos de #69; las
dependencias ya en `main` coinciden por SHA Git. El inventario incluye
ahora **57 suites** (56 existentes más una). La rama fuente registra
**143/143** casos focalizados correctos en ocho suites Ancients; no se
ha ejecutado la regresión integral del nuevo commit.

## Planificador provisional de resolución posterior al disparo — integración de #70

Se incorpora `ranged-resolution-sequence.mjs`: genera un **itinerario
orientativo, no ejecutable** desde pérdidas de bloques persistidas y
previsualizadas por CCRL (#153). Propone en orden impactos futuros,
comprobación de líder una sola vez, posible evasión, decisión del
defensor ante banderas y moral, retirada y puerta de finalización;
no presupone cuántas banderas se ignoran ni autoriza la batalla.

El cálculo previo `block-loss-preview.mjs` conserva la información
verificada del líder incluso sin impactos directos. La captura de
dados de baja de líder es **distinta** de la tirada inicial de combate,
con resultados digitales o transcripciones físicas expresamente
provisionales. El laboratorio incluye una consulta de checklist de
solo lectura sobre el snapshot y revisión de #153.
**No se cambian las cartas, el tablero, las vidas, los estandartes,
las fases oficiales, HTTP ni el almacenamiento principal CCWB.**

[Documento de secuencia y límites](57-secuencia-posdisparo-ancients.md).
Se importan seis blobs originales de código/pruebas de #70;
el manifiesto pasa a **58 suites únicas**.
La PR fuente documenta **32/32 pruebas nativas correctas** del módulo
puro, pero seis casos de integración de checklist aún no se han
ejecutado con el árbol completo. La regresión integral Windows
anterior solo acredita el commit #152 (56 suites); #153 y esta
integración necesitan nueva comprobación conjunta.

## Aplicación experimental de impactos directos — exclusivamente fixtures CCRL (#71)

Se introduce la **primera escritura de bloques**, acotada a datos
ficticios del laboratorio CCRL, y no a partidas del servidor CCWB.
El módulo `lab-direct-hit-effect.mjs` vuelve a calcular de forma
canónica una propuesta de impactos sobre la copia del tablero:
descuenta bloques, puede retirar únicamente una unidad de prueba
eliminada y conserva al líder para una comprobación futura.
No resuelve moral, banderas, retiradas, líderes ni estandartes.

La función `openLabOnlyDirectHitCommit()` exige una **doble barrera**:
`allowTestFixtureMutation:true` habilitado por el código servidor
y `labFixtureOnly:true` almacenado en el turno ficticio. El adaptador
`openAncientsDirectHitFixtureAdapter()` exige por separado
`enableUnsafeFixtureMutation:true`; no debe importarse en rutas HTTP.
Comprueba el `application_id`, versión y esquema CCRL, revisión,
huella del tablero, autor de la reserva e idempotencia. Aplica la
modificación de prueba, revisión, evento mínimo y comando mediante
`BEGIN IMMEDIATE`, con rollback total si falla una escritura.

**Nunca supone combate reglamentario autorizado:**
`labOnly:true`, `unverifiedFullRules:true`,
`attackAuthorized:false`, `combatResolved:false`. No cambia
el almacenamiento principal, sesiones, privacidad ni interfaz web.

[Restricciones y ejemplos del fixture](58-impactos-directos-sqlite-fixture.md).
Los siete blobs funcionales/test corresponden exactamente a #71.
El inventario pasa a **61 suites**. La fuente acredita **39/39
pruebas nativas** de módulos aislados (repetidas cinco veces),
pero **seis pruebas del adaptador con módulos reales siguen pendientes**
de ejecución nativa y no se ha ejecutado la regresión global.

## Comprobación de líder ficticia tras impactos aplicados — integración de #73

Se completa el flujo aislado de laboratorio `CCRL`:
**dados oficiales de previsualización → aplicación de bloques
ficticios (#155) → registro provisional de baja de líder**.

El nuevo comando interno `stageLeaderCasualtyPreview()` está
disponible únicamente desde el constructor explícitamente habilitado
`openLabOnlyDirectHitCommit`. Exige estado de fixture
`labFixtureOnly:true` y marcador
`LAB_DIRECT_HITS_APPLIED_FIXTURE`, que los impactos ya se hayan
confirmado, revisión coincidente, misma reserva y resumen del tablero
posterior a los impactos verificado por SHA-256.
La cantidad de dados se deriva del estado persistido: **1** al
desaparecer la unidad, **2** cuando sobrevive. La tirada adicional
queda separada de la inicial, es idempotente y transaccional;
su evento no revela caras ni unidades.

**No se mata ni mueve al líder:** la operación almacena exclusivamente
un pronóstico `LEADER_CASUALTY_PREVIEW_ONLY` y nunca confirma
`combatResolved` ni `leaderRemoved`. No toca partidas CCWB,
API HTTP, manos ni estandartes. Las tiradas físicas son
`PLAYER_DECLARED` y todavía no se verifican bilateralmente.

[Documento sobre comprobación de líder en fixture](59-lider-tras-impactos-sqlite-fixture.md).
Se importa el módulo y tres blobs adicionales de #73 con
SHA Git idénticos. La PR #72, que anticipaba el dado de líder
**antes de aplicar impactos**, permanece cerrada y no se integra.
Manifiesto consolidado: **63 suites**. La fuente #73 registra
**13/13** pruebas aisladas nativas con dobles, pero seis pruebas
de integración añadidas aún no han sido ejecutadas con los módulos
reales. La regresión integral combinada sigue pendiente.

## Acuerdo y puerta de revisión de dados físicos de líder — consolidación de #74 y #75

La operación interna `reviewLabPhysicalLeaderDice()` de los
**fixtures CCRL** permite que el otro participante marque una
transcripción física de la comprobación de líder como `CONFIRM`
o `DISPUTE`. El actor original no puede validar sus propios dados
y un tercero no puede consultar o cambiar los registros. La revisión
queda guardada con `BEGIN IMMEDIATE`, revisión e idempotencia,
vinculada por SHA-256 a la tirada y al tablero posterior a impactos.
Ni la confirmación ni la impugnación modifican las caras o aplican
bajas. `CONFIRM` es un **acuerdo humano**, no una prueba objetiva
del resultado físico.

`readLabLeaderDiceGate()` constituye una **consulta sin escritura**:
distingue `DIGITAL_SERVER_CAPTURED`,
`PHYSICAL_AWAITING_OPPONENT`, `PHYSICAL_OPPONENT_CONFIRMED`
y `PHYSICAL_DISPUTED`. Devuelve estados no sensibles, sin
caras, líderes, resultados privados ni valores de impacto.
Una impugnación bloquea la continuación. Incluso un resultado
confirmado mantiene `combatAuthorized:false`,
`leaderCasualtyApplied:false` y `combatResolved:false`.

Se mantiene la triple separación: partidas oficiales **sin conectar**,
almacén principal `CCWB` sin cambios y funciones **solo en el
adaptador CCRL con doble opt-in**. No se crean endpoints HTTP,
autorizaciones de combate ni despliegues.

Referencias: [acuerdo físico](60-acuerdo-dados-fisicos-lider-ancients.md)
y [puerta de revisión](61-puerta-revision-dados-lider.md).
Se importan exactamente los blobs Git de #74 y #75; se preserva
la prueba del inventario de `main` (que no figuraba en las ramas
históricas), por lo que el inventario queda en **66 suites**.
En las fuentes constan **17/17** pruebas nativas de acuerdo y
**37/37** pruebas conjuntas de acuerdo y puerta, pero las pruebas
del adaptador completo y la regresión de las 66 suites todavía
no se han ejecutado en este commit.

## Dos consentimientos y declaración física alternativa — consolidación #76 y #77

Tras una **impugnación de dados físicos de líder** en el laboratorio
independiente `CCRL`, la operación `voteLabLeaderReroll()` guarda
un voto por cada participante (`CONSENT_REROLL` o `REFUSE_REROLL`),
con identidad del servidor, revisión, clave idempotente, historial
del resultado original y transacción `BEGIN IMMEDIATE`.
La negativa de cualquiera impide considerar una nueva tirada.
El acuerdo de ambos **no** vuelve a lanzar dados por sí solo.

Con dos consentimientos se permite una **única** nueva transcripción
física en `declareLabPhysicalLeaderReroll()`: recibe solo las caras
declaradas, deriva del estado servidor el jugador, número de dados,
modalidad e identificador nuevo, y la conserva por separado.
La tirada previa, su impugnación y los dos votos **permanecen
inalterados**. La segunda transcripción continúa **pendiente de
confirmación por el adversario**. Nunca se convierte automáticamente
en resultado vigente ni elimina líderes.

La puerta de revisión sigue comunicando
`PHYSICAL_DISPUTED`, `disputeBlocksContinuation:true`,
`rerollAllowed:false`, `combatAuthorized:false` y
`combatResolved:false`, incluso si ambos votan o ya existe una
declaración nueva. Los eventos compartidos son mínimos, sin
caras, líder o ID de reserva; las operaciones están confinadas al
adaptador con doble opt-in de `CCRL`. No se modifica `CCWB`,
ni se añaden rutas HTTP.

Documentación: [votos bilaterales](62-consentimiento-bilateral-repeticion-dados.md)
y [segunda declaración](63-redeclaracion-fisica-consentida-lider.md).
Se importan blobs de #76 y #77, con firmas Git idénticas. Las
ramas fuente acreditan 61/61 y 84/84 pruebas nativas focalizadas;
**no equivalen a regresión conjunta de esta integración**.
El inventario conserva la suite especial de verificación de
`main`, ausente de las ramas antiguas, y pasa a **68 suites**.

## Revisión de una segunda declaración física de líder — consolidación #78

La operación interna `reviewLabPhysicalLeaderReroll()` permite que
el **defensor** confirme o impugne de forma independiente las caras de
la segunda declaración física, una vez registrada la impugnación
inicial y el consentimiento expreso de ambos participantes.
**Consentir repetir no equivale a aceptar el nuevo resultado.**

El estado persistido vincula mediante SHA-256 la declaración original,
la segunda declaración y el veredicto del otro jugador; mantiene
revisiones consecutivas, firma de idempotencia y una transacción
`BEGIN IMMEDIATE`. Ni la consulta ni los eventos públicos revelan
caras, datos del líder, identificadores privados o posibles bajas.
Los reintentos exactos recuperan el mismo resultado sin tirar dados.

La puerta distingue `PHYSICAL_REROLL_AWAITING_OPPONENT`,
`PHYSICAL_REROLL_CONFIRMED` y `PHYSICAL_REROLL_DISPUTED`.
**La impugnación original continúa registrada**, y aunque el
adversario confirme la nueva declaración siguen vigentes
`combatAuthorized:false`, `leaderCasualtyApplied:false`,
`combatResolved:false` y el bloqueo de continuación; no se
aplican efectos reglamentarios ni una tercera tirada automática.

La capacidad sigue siendo exclusiva de los fixtures CCRL con
doble opt-in, sin endpoints HTTP ni modificación del almacén CCWB.
[Revisión de segunda tirada física](64-revision-segunda-tirada-fisica.md).

El módulo, contrato, suite y adaptadores se importan con los mismos
blobs Git de #78. Se conserva la suite de auditoría que ya existe en
`main`, ausente de la rama histórica, y el inventario sube a
**69 suites**. La fuente documenta **110/110 pruebas nativas**
en batería local ampliada; la suite exacta de 14 casos del nuevo
archivo y la regresión global del árbol consolidado quedan pendientes.

## Preflight de impactos con revalidación de alcance, LOS y terreno — #81/#82

Nuevo módulo puro `ranged-hit-commit-preflight.mjs`: recibe una
instantánea fiable de turno, tablero y dados de previsualización
de Ancients, recalcula pérdidas y secuencia pendiente, y **repite**
los controles actuales de alcance, movimiento registrado, adyacencia
enemiga, línea de visión, terreno y cantidad oficial de dados.
El plan recién calculado debe coincidir exactamente con el plan
persistido y el tablero debe conservar su huella original.
Una preselección reglamentaria positiva **no** autoriza atacar.

El laboratorio CCRL añade el método **solo de lectura**
`preflightDirectHits()`. Lee la misma revisión SQLite bajo
`BEGIN IMMEDIATE`, comprueba sesión, propiedad de la reserva y
SHA-256 del `board_json`; no escribe bloques, turnos, eventos,
cartas, manos ni claves de idempotencia. Oculta las causas detalladas
del rechazo al llamador. El resultado devuelve siempre
`commitPermitted:false`, `attackAuthorized:false`,
`fullRulesValidated:false` y `boardMutated:false`.
No se incorpora esta consulta al servidor HTTP ni al almacén CCWB.

**Integración selectiva importante:** se conservó el
`sqlite-reservation-lab.mjs` de `main` y **solo** se añadió
el import, la nueva función y su exportación. No se sobrescribe
la corrección más reciente de reintentos de dados tras impactos
ficticios; la rama antigua #82 carecía de ella.
Los 12 casos SQLite adicionales se añaden al final de la suite
preexistente sin suprimir pruebas de fases posteriores.
Se importan el módulo y sus ocho pruebas originales con SHA Git
idénticos a #82. Inventario: **70 suites únicas**.

Documentación histórica:
[preflight de impactos](58-preflight-impactos-ancients.md) y
[revalidación postdisparo](59-revalidacion-posdisparo-snapshot.md).
Las ocho pruebas puras originales solo acreditaron ejecución en
un arnés V8 aislado; las pruebas SQLite nuevas y la regresión
consolidada todavía necesitan ejecución nativa completa.
