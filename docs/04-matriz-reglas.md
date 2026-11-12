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

Contrato técnico de privacidad: cambio de cuenta/partida → `private-view-scope.reset/selectMatch` → invalidación de respuestas HTTP anteriores → bloqueo de presentación de eventos, movimientos y tokens desactualizados. Los módulos `private-view-scope` y `private-projection` tienen 20 casos ejecutados mediante Node.js 22.16.0 (20 correctos); la interfaz simulada dispone de 20 callbacks comprobados en V8 (20 correctos). Se rechazan vistas del bando incorrecto y se revalida la sesión antes de inspeccionar o enviar órdenes. No se ha ejecutado aún la batería HTTP real. No implementa reglas oficiales R-04/R-05 ni demuestra seguridad para Internet. Véase [documentación](41-aislamiento-respuestas-navegador-i4.md).

## Sincronización de revisiones SSE con reintentos (I4, PR #52)

Trazabilidad técnica: aviso SSE de contadores → `revision-refresh.notice()` → obtención de proyección autenticada → reconocimiento **solo tras GET exitoso**; fallo o resultado descartado → reintento acotado. Se cubren duplicados, desorden, pestañas ocultas, SSE cerrado, cambios de cuenta y partida. **14/14 pruebas Node nativas** de coordinador y **28/28 callbacks V8 simulados** de interfaz; aún sin batería HTTP global. No implementa movimiento reglamentario ni reemplaza la autorización del servidor. [Especificación](42-reintentos-sse-i4.md).

## Primer perfil real de distancias y combate tras movimiento (I4, PR #53)

**R-05: avance parcial, NO completada.** Se incorpora una tabla inmutable y un evaluador puro para 13 tipos de unidades del juego básico de *Ancients* (3.ª edición, 2009). La regla determina únicamente el límite **ordinario** de hexágonos recorridos y si el movimiento permite combate, lo excluye o exige comprobar una carga de guerreros. **No declara ninguna ruta legal**: `needsFullLegalityCheck: true` se aplica siempre y los casos de cartas especiales pueden superar límites ordinarios. Líderes, terreno, ocupación, órdenes, escenarios y sincronización con el servidor siguen pendientes.

Ver [documento de trazabilidad](43-perfiles-movimiento-ancients-base.md), módulo `packages/ancients-rules/movement-profile.mjs` y suite `movement-profile.test.mjs`. Verificación **17/17 pruebas nativas Node.js 22.16.0**, SHAs Git contrastados. Se mantienen las PR #45–#53 sin fusionar hasta regresión integral de **39 suites**, HTTP/SSE y validación visual.

## Precomprobación de trayectorias ordinarias (I4, PR #54)

**R-05 sigue incompleta.** La nueva función `precheckAncientsMovementPath` (documento [44](44-precomprobacion-ruta-ancients.md)) combina la geometría odd-q, una comprobación de ocupación ordinaria y los perfiles básicos de PR #53. Rechaza caminos no adyacentes, repetidos, ocupados, salidas de tablero, líderes enemigos en el destino y avances imposibles sin resolver el combate; señala cargas de guerreros, líderes propios en la ruta y excepciones de perfil. Los tres estados `BLOCKED`, `REQUIRES_RULE_EXCEPTION` y `CANDIDATE` **nunca equivalen a autorización de movimiento**: no se integran con SQLite ni API, y todos devuelven `needsFullLegalityCheck: true`.

**19/19 pruebas nativas Node.js 22.16.0 correctas, fuente y pruebas cotejadas por SHA Git.** La rama registra **40 suites**, todavía sin ejecución integral. Continúan pendientes órdenes, cartas, terreno, líderes, excepciones y validación HTTP/SSE y visual.

## Terreno ordinario del juego básico (I4, PR #57)

**R-05 sigue incompleta.** El módulo [`terrain-movement.mjs`](../packages/ancients-rules/terrain-movement.mjs) incorpora una precomprobación de **bosques, colinas y terreno accidentado** según las reglas de *Ancients* (3.ª edición, 2009). Detecta detención obligatoria al entrar en bosque, detención de montadas al entrar en accidentado, prohibición de entrar a máquina de guerra pesada en accidentado y restricciones para combatir después de entrar. El combinador `precheckAncientsMovementPath` devuelve ahora también `terrain` y `battleAfterMovement`; **no se conecta al motor sintético ni autoriza un movimiento**.

La evidencia comprobada consta de **25/25 pruebas nativas Node.js 22.16.0** (16 de terreno y 9 de integración), con SHA Git de código y tests coincidentes. Se suman dos archivos al manifiesto (42 suites previstas), pero el conjunto integral **no** se ha ejecutado en esta rama. Persisten pendientes terreno restante, LOS, dados, órdenes, cartas y escenarios. [Documentación y condiciones de integración](46-terreno-ancients-basico.md).

## Límites ordinarios de dados por terreno, separados del movimiento (I4)

Tras la PR #57 (que ya aplica las restricciones de entrada y de combate posterior al movimiento), el módulo `assessAncientsTerrainDiceCap` incorpora un cálculo **parcial y no autoritativo** de máximos ordinarios: cuerpo a cuerpo hacia/desde bosque o terreno accidentado, disparo contra bosque, cuesta arriba, cuesta abajo y combate entre colinas, distinguiendo infantería y montadas. `maxDice: null` significa que el terreno no introduce un límite, **no** que el ataque sea legal o ilimitado.

**R-06/R-07 siguen sin implementar.** No hay validación de línea de visión, disponibilidad/alcance de armas, dados propios de unidad, cartas, líderes ni combate. Siempre `needsFullLegalityCheck: true`; `lineOfSightChecked: false` y `cardModifiersApplied: false`. Sin conexión con partidas, SQLite ni HTTP.

Evidencia: [documento 47](47-limites-dados-terreno-ancients.md), **10/10 pruebas nativas correctas con Node.js 22.16.0**, hash Git de módulo/pruebas/dependencias contrastado. Manifiesto ampliado a **43 suites** sin ejecución integral.


## Precomprobación de línea de visión de Ancients (R-06 parcial)

`packages/ancients-rules/line-of-sight.mjs` añade un **comprobador aislado** de visibilidad por centros de hexágonos `odd-q` en tablero 13×9. Reconoce unidades y líderes interpuestos, bosques, colinas, mesetas contiguas y aristas compartidas; terreno accidentado no bloquea la visión. Rechaza coordenadas, duplicados y clases de terreno no modeladas. Retorna `VISIBLE` o `BLOCKED` con `attackAuthorized:false` y `needsFullLegalityCheck:true`.

Su suite propia de **14 pruebas** pasó con Node 22.16.0/Linux, y se registró como la **suite 44** del manifiesto. **No se ha ejecutado la regresión integral de 44 suites ni una batalla oficial**. No comprueba distancia de tiro, armas, cartas, bloqueos por adyacencia enemiga, ni fases; escenarios y estado de servidor aún no conectados. R-06 permanece **no implementada** como regla completa. Véase [informe de LOS](48-linea-vision-ancients-basico.md).


## Precomprobación de disparo ordinario en Ancients (R-06 parcial)

La nueva capa `ranged-profile.mjs` define alcance, arma y movimiento de **seis** clases con disparo ordinario dentro de los 13 tipos de unidad actualmente registrados. `ranged-precheck.mjs` combina esos datos con la prohibición de disparar cuando un enemigo está adyacente, la LOS de PR #61 y el límite de dados por terreno de PR #59. Todo se deriva de un tablero suministrado por el servidor; **ningún resultado autoriza un ataque**, modifica el estado o añade capacidades excepcionales.

Se ejecutaron **27 pruebas nuevas** (10 de perfil y 17 de composición) junto a las **14 pruebas ya existentes de LOS**; resultado **41/41 correctas** con Node 22.16.0 en Linux nativo, sin WSL ni Actions. El manifiesto pasa a **46 suites**, no ejecutadas integralmente. La regla R-06 sigue **sin implementar** como combate completo: faltan órdenes, fase, cartas, alcance excepcional, resolución de dados, retirada y servidor. Véase [informe R-06](49-precomprobacion-combate-distancia-ancients.md).


## Contrato aislado de fase/orden en combate a distancia (R-04/R-06 parcial)

`combat-turn-guard.mjs` comprueba fase `COMBAT`, jugador en turno, revisión, unidad ordenada, combate no repetido, ausencia de decisiones/combates pendientes y registro de movimiento del servidor. `ranged-turn-precheck.mjs` compone esa criba con la validación de disparos de PR #62, siempre **sin autorización ni persistencia de combate**. Rechaza expresamente el estado `synthetic-phases-v1` como sustituto de las reglas oficiales y no interpreta efectos de cartas.

Dos suites nuevas, **31 casos ejecutados con éxito en V8 aislado sobre el código exacto de GitHub** (no `node:test` nativo). El manifiesto registra **48 suites**, pendientes de regresión integral. **R-04 y R-06 no están implementadas como reglas completas**. Véase [documentación y contrato](50-guardas-turno-ordenes-disparo-ancients.md).


## Reserva de criba de combate en SQLite independiente (R-04/R-06 parcial)

`packages/ancients-rules/sqlite-reservation-lab.mjs` implementa una **reserva transaccional únicamente experimental** con `BEGIN IMMEDIATE`, revisión, idempotencia, evento público mínimo y marcador `RANGED_SCREENING_ONLY`, sobre **un fichero SQLite distinto** del esquema CCW v1. El adaptador `sqlite-guarded-reservation.mjs` ya compone ese almacén con el **comprobador reglamentario real** de PR #63, pero solo en pruebas aisladas; también permite **cancelar una criba pendiente sin resultados de dados**, de manera atómica y sin marcar batalla resuelta.

Las dos suites nativas de laboratorio superan **33/33 pruebas** con Node 22.16.0/Linux (23 de transacción/cancelación + 10 de guardas reales SQLite). El manifiesto contiene **50 suites**, sin regresión integral. No se considera implementada R-04 ni R-06: falta máquina de estados de resolución y migración del servidor, API autenticada, resultados de combate, cartas y pruebas de aceptación. Véase [contrato de reserva experimental](51-reserva-sqlite-combates-ancients.md).


## Registro experimental de dados digitales/físicos tras la reserva (R-06/R-13 parcial)

La nueva función `stageDice()`, exclusivamente del SQLite de laboratorio `CCRL`, registra resultados de `dice-roller` después de una reserva válida y sin autorización de ataque. Deriva la cantidad de dados de la criba fiable, distingue `SERVER_GENERATED` (digital) de `PLAYER_DECLARED` (física), conserva revisión e idempotencia, y bloquea la cancelación de una reserva con resultados ya registrados. Los símbolos usados son **sintéticos** y no representan las caras ni efectos del dado oficial.

Las tres suites SQLite del laboratorio suman **47/47 pruebas nativas correctas** (33 previas + 14 nuevas), con Node.js 22.16.0/Linux. El manifiesto registra **51 suites** todavía pendientes de regresión integral. El juego oficial sigue sin disponer de impactos, retiradas, casos especiales, fases completas ni resolución de combate; R-06 y R-13 **no están implementadas**. Véase [registro de dados sintéticos](52-registro-dados-sinteticos-reserva-ancients.md).


## Caras oficiales e interpretación parcial de dados a distancia (R-06/R-13)

`packages/ancients-rules/battle-dice.mjs` ya define las **seis caras oficiales** del dado del básico (verde, azul, rojo, casco, bandera, espadas) y la clasificación de las 13 unidades admitidas por el núcleo de movimiento; contempla el borde blanco de auxilia (verde) y guerreros (azul). La captura digital usa azar criptográfico del servidor; la física conserva la procedencia `PLAYER_DECLARED` sin presentarla como verificada. El intérprete solo cuenta **coincidencias de color**, **banderas pendientes** y **dados sin efecto ordinario**. Ni modifica bloques ni resuelve moral, retiradas, líderes o escenarios. Excluye los líderes que están solos en una casilla y el cuerpo a cuerpo.

**16 pruebas nuevas**; **63/63 casos nativos correctos** combinados con las tres suites SQLite previas en Node.js 22.16.0/Linux. Inventario del laboratorio: **52 suites registradas**, pendientes de regresión integral y de Windows nativo. La persistencia de PR #65 conserva por ahora su dado **sintético** de cuatro posiciones, por lo que no se ha conectado esta interpretación oficial a una batalla persistida. **R-06/R-13 siguen incompletas.** Véase [contrato oficial parcial](53-dados-oficiales-disparo-ancients.md).


## Persistencia versionada de dados oficiales como previsualización (R-06/R-13 parcial)

`packages/ancients-rules/dice-plan.mjs` distingue tres planes persistidos: sintético heredado sin versión, sintético `SYNTHETIC_RANGED_V1` y oficial preliminar `ANCIENTS_BASE_RANGED_PREVIEW_V1` (seis caras). La variante oficial se construye **solo desde datos de tablero y criba del servidor** y el adaptador `openOfficialAncientsRangedPreviewLab` registra en SQLite la tirada y una interpretación privada de coincidencias de color/banderas. Un plan antiguo no se convierte a oficial tras reabrir la base; las versiones desconocidas o malformadas se rechazan.

**26 pruebas nuevas** (9 de plan y 17 de integración SQLite); **89/89 casos nativos correctos** combinando 7 archivos de pruebas en Node.js 22.16.0/Linux. El manifiesto llega a **54 suites**, sin ejecutar la regresión integral ni las pruebas Windows/HTTP/SSE. Sigue siendo **previsualización sin ataque autorizado, sin bajas ni retiradas**, por lo que R-06 y R-13 continúan incompletas. Véase [informe y límites](54-plan-versionado-dados-oficiales-sqlite.md).


## Pérdida de bloques y decisiones pendientes de líder (R-06/R-09/R-13 parcial)

`packages/ancients-rules/block-loss-preview.mjs` introduce la **proyección sin mutaciones** de pérdidas de bloques en disparos: topes iniciales según los 13 tipos del básico, impactos limitados a bloques restantes, excedentes ineficaces, banderas pendientes y propuesta de comprobación de baja de líder (dos dados si sobrevive la unidad, uno si es eliminada). Los bloques restantes, impactos/banderas y unión de líder deben proceder en el futuro de **datos autenticados del servidor**, no se infieren ni se aceptan como mandato del cliente.

La suite `block-loss-preview.test.mjs` supera **24/24 pruebas nativas** aisladas con Node.js 22.16.0/Linux; el inventario llega a **55 suites registradas**, sin regresión integral. **No** se han aplicado pérdidas a SQLite ni otorgado estandartes, retiradas o decisiones. R-06/R-09/R-13 continúan incompletas. Véase [contrato de pérdidas provisionales](55-perdida-bloques-disparos-ancients.md).


## Proyección SQLite coherente de pérdidas de bloques (R-06/R-09/R-13 parcial)

`ranged-block-snapshot.mjs` y `previewStagedBlockLoss()` vinculan la interpretación de **dados oficiales ya persistidos** con los **bloques restantes y líderes del tablero SQLite** leídos en una sola transacción y revisión. Exigen `blocksRemaining` explícito y comprueban actor, plan, objetivo, tipo, estado de turno, dado original, interpretación y un resumen SHA-256 del tablero grabado al registrar la tirada. No aceptan valores de pérdida de bloques ni de líderes aportados por el cliente. Las capturas anteriores sin resumen de tablero siguen accesibles con las API previas, pero no pueden considerarse automáticamente instantáneas validadas por este contrato.

**30 pruebas nuevas**; **143/143 casos nativos PASS** combinando las ocho suites de Ancients disponibles localmente en Node.js 22.16.0/Linux. El manifiesto tiene **56 suites** y la regresión integral/Windows está pendiente. El cálculo sigue **sin mutar bloques, resolver banderas/líderes ni otorgar estandartes**, y está aislado del HTTP y la partida real. R-06/R-09/R-13 continúan incompletas. Véase [informe SQLite de bloques](56-snapshot-sqlite-bloques-disparo-ancients.md).


## Secuencia de resolución postdisparo y comprobación de líder (R-06/R-08/R-09/R-13 parciales)

`ranged-resolution-sequence.mjs` produce un **checklist inmutable de pasos todavía no ejecutados** desde las pérdidas provisionales de bloques: impactos directos, comprobación de baja de líder si procede, evasión del líder superviviente tras destrucción de su unidad, decisión de moral y retirada del defensor, posible comprobación de líder por pérdidas durante la retirada y validación final. Exige `leaderAttached` derivado del tablero real incluso cuando el primer ataque no cause impactos. **No convierte automáticamente banderas en retiradas ni computa moral sin los apoyos, líderes y terrenos completos.**

La captura `ANCIENTS_BASE_LEADER_CASUALTY_CAPTURED` distingue los dados adicionales del líder de los dados originales del ataque. Permite modalidades digital/física sin presentar las segundas como verificadas y comprueba 2 cascos/2 dados o 1 casco/1 dado según la situación, **sin dar por muerto ni evadido al líder**. `previewResolutionChecklist()` devuelve la planificación desde la misma instantánea SQLite validada de PR #69, en **solo lectura**.

**32 pruebas nativas nuevas correctas** para el planificador en Node.js 22.16.0/Linux. Se añaden además **6 pruebas de integración SQLite pendientes de ejecución**. El manifiesto registra **57 suites**, aún sin regresión integral/Windows/HTTP/SSE. Ninguna baja, bandera, comprobación de líder, evasión ni victoria se aplica a una partida: R-06/R-08/R-09/R-13 permanecen incompletas. Véase [secuencia y límites](57-secuencia-posdisparo-ancients.md).


## Revalidación de disparos desde la instantánea de SQLite (R-06/R-09 parcial)

El preflight de impactos repite ahora **perfil de ataque, número de pasos, ausencia de enemigos adyacentes, alcance, línea de visión y límite de dados por terreno** sobre el tablero y turno guardados; compara el plan de dados recalculado con el plan oficial que se persistió al reservar. Esto **no** valida carta, órdenes, excepciones de escenario ni efectos de combate; el permiso de aplicar impactos permanece expresamente bloqueado. Se añaden seis casos de integración SQLite sobre cambios privilegiados de tablero/turno, incluido recálculo fraudulento de su huella (**pendientes de ejecución nativa**), y una suite pura nueva de ocho casos (**8/8 superados en V8 aislado**, sin sustituir la ejecución nativa de Node.js). El manifiesto registra **58 suites**. Véase [revalidación de snapshot](59-revalidacion-posdisparo-snapshot.md).


## Evidencia histórica de cartas de sección y órdenes (R-03/R-04 parciales)

`section-card-order-screen.mjs` registra las nueve variantes **ordinarias** de cartas de sección (2/3/4 órdenes en izquierda/centro/derecha) y comprueba **solo instantáneas del servidor**: presencia de instancia de carta en la mano al jugarla, mismo bando y secuencia de revisiones, límites de órdenes, identidad de unidades y líderes y pertenencia a sector en **la posición al asignar la orden** (no tras desplazarse). La sección de hexágonos fronterizos debe aportar el mapa de escenario y orientación verificado en una fase posterior; tampoco están certificados los eventos reales del mazo/mano. El resultado permanece `CANDIDATE`, con `cardHandEventVerified:false`, `sectionGeometryVerified:false`, `ordersAuthorized:false` y `attackAuthorized:false`.

El laboratorio aislado añade `previewSectionOrderProof`, lectura de solo consulta de `turnState.sectionOrderProof` con actor/revisión comprobados, sin filtración de la mano ni autorizaciones. **19/19 casos puros ejecutados nativamente con Node.js 22.16 en Linux**, cinco casos de integración SQLite **escritos y pendientes de ejecución**. El manifiesto registra **59 suites**; regresión integral pendiente. Ver [contrato de cartas de sección](60-cartas-seccion-ordenes-ancients.md). El alcance no incluye cartas especiales ni persistencia auténtica del historial de manos y órdenes.


## Diario privado de cartas y órdenes de sección (R-03/R-04, laboratorio persistente)

El laboratorio separado `CCHL` incorpora ya un **diario SQLite reconstruible**: reparto con RNG criptográfico desde un mazo de prueba, conservación de todas las instancias, manos por bando, carta jugada, órdenes y sectores derivados de una posición de tablero inicial controlada por servidor, descarte, robo y avance de turno **solo experimental**. Los eventos privados y comandos permiten reconstruir la fotografía de la partida y cotejarla con su versión guardada; se verifican revisiones e idempotencia y solo se muestran proyecciones privadas por jugador y eventos públicos sanitizados.

**No está integrado en CCWB ni autoriza cartas, órdenes o combates reales.** Se han superado **33/33 pruebas nativas** sobre los dos módulos nuevos (Node.js 22.16.0/Linux); el manifiesto registra **61 suites**, pendiente ejecutar la regresión integral y verificar Windows/HTTP/SSE. No existe todavía prueba autenticada del mazo/escenario oficial, y el salto de fin de turno se limita al laboratorio. Véase [diario de cartas de sección](61-diario-cartas-seccion-ancients.md).


## Puente a la base principal CCWB para historial privado (R-03/R-04, experimental)

La nueva integración `sqlite-section-ccwb-bridge.mjs` permite almacenar el **diario privado y reconstruible de cartas de sección** dentro de `matches.private_state` del SQLite principal **CCWB v1**, correlacionado transaccionalmente con `game_events` (solo público) y `game_commands` (revisión/idempotencia). La composición `sqlite.mjs` cambia a este modo **solo tras inicialización interna explícita**, impide mezclarlo con el mazo sintético y reserva sus operaciones a `dispatchExperimentalSectionHistory`: **la ruta genérica `dispatch` responde `SECTION_LAB_INTERNAL_ONLY`**. Sigue sin autorización de cartas oficiales, escenarios, órdenes definitivas ni combates.

**Regresión nativa 66/66 PASS** en cuatro suites de reglas e historial (Node.js 22.16.0/Linux), incluida la nueva batería CCWB con rollback e integridad; **3 pruebas adicionales de composición completa pendientes de ejecución**, como lo están las **63 suites** del manifiesto y Windows/HTTP/SSE. No se migró el esquema principal y no se añadieron rutas HTTP. Documentación: [puente CCWB](62-puente-ccwb-diario-cartas-ancients.md).


## Autoridad de sesión del puente CCWB (R-03/R-04, sin cobertura reglamentaria)

La composición del diario experimental `CCWB` deja de aceptar el bando seleccionado como argumento de inicialización y de despacho: verifica en cada llamada una sesión válida y el vínculo del usuario con `matches.owner_id/guest_id`. Las proyecciones privadas experimentales también se pueden obtener desde la sesión, y el historial de eventos públicos se coteja antes de servirlo cuando el modo está activo. Se rechazan usuarios ajenos, sesiones cerradas, bandos declarados por el llamante e intentos del invitado de iniciar la partida experimental. No se añade ruta HTTP ni se concede autoridad reglamentaria a cartas u órdenes.

**Pruebas escritas, pero pendientes de ejecución:** 4 casos nuevos en `ancients-section-history.test.mjs`, más los 3 de composición anteriores; las 63 suites del manifiesto siguen sin regresión completa. Las ejecuciones anteriores de 66/66 pertenecen a la base #85 y no validan esta modificación. Ver [autoridad de sesión del laboratorio](67-autoridad-sesion-historial-seccion-ancients.md).


## Asociación auditable de idempotencia en el diario CCWB (R-03/R-04, experimental)

Las nuevas entradas privadas del diario de cartas de sección conservan su clave de idempotencia y verifican esa relación frente a `game_commands.idem_key` durante el replay SQLite. La firma semántica del comando y los eventos públicos permanecen sin claves, por lo que no se alteran las proyecciones de los jugadores. Los registros anteriores a esta mejora, sin vínculo guardado, se aceptan para compatibilidad, **sin atribuirles retrospectivamente esa garantía**.

**8/8 pruebas nativas PASS** del módulo puro `lab-idempotency-binding.test.mjs` en Linux/Node 22.16.0; **3 nuevas pruebas de integración SQLite pendientes de ejecución**, junto con las siete de composición ya preparadas en PR #86 y la regresión integral. Manifiesto: **64 suites** registradas, no ejecutadas juntas. R-03/R-04 continúan **sin implementación reglamentaria**. Ver [auditoría de idempotencia](68-vinculacion-idempotencia-diario-ancients.md).


## Firma versionada del diario experimental (R-03/R-04, aún no reglamentarias)

La PR #87 se endurece frente a una degradación detectada en su primera revisión: borrar únicamente la clave privada de un comando nuevo podía hacer que se tratara como registro `legacy`. Las nuevas firmas de `game_commands.signature` usan el prefijo `CCW_SECTION_COMMAND_V2:` y vinculan comando más clave. La reconstrucción exige esa vinculación para entradas v2 y permite el formato anterior exclusivamente como contrato histórico con una garantía menor. No se añaden datos privados a eventos públicos ni se modifica CCWB v1.

**11 pruebas nativas PASS** del nuevo módulo puro en Node.js 22.16/Linux, comparadas por SHA Git con los archivos publicados. **4 casos nuevos SQLite preparados pero sin ejecutar**, y un caso legacy previo adaptado. **65 suites registradas** y aún no superadas como regresión integral. Ver [documentación de firma versionada](68-vinculacion-idempotencia-diario-ancients.md). R-03 y R-04 continúan sin validación oficial ni autorización reglamentaria completa.


## Revalidación de sesión en la misma transacción (R-03/R-04, solo laboratorio)

El control experimental de carta y órdenes ahora vuelve a consultar la sesión y la membresía del actor **después de iniciar `BEGIN IMMEDIATE` y antes de modificar el diario**. Esto elimina la ventana en la que otro proceso podía revocar la sesión después de la prevalidación pero antes de adquirir el bloqueo de escritura. Un resultado negativo deniega la operación sin escribir estado, eventos ni claves de idempotencia. La vista privada por sesión pasa a una instantánea de lectura `BEGIN` que comprende identidad, membresía, estado y proyección. La lectura interna de eventos públicos utiliza el mismo tipo de instantánea WAL en lugar de reservar un bloqueo `BEGIN IMMEDIATE`. Las rutas HTTP no cambian; no se autoriza combate.

**Integración SQLite ejecutada el 12/11/2026:** 24/24 PASS en `sqlite-section-ccwb-bridge.test.mjs` y 11/11 PASS en `ancients-section-history.test.mjs` (total **35/35 PASS conjunto**, 0 fallos, 0 omitidas; informe SHA-256 `2a3b4afb5a95de359eb41da58dc66ad7ce95ab20d856176f779a9ff04010d82b`). Se reconstruyeron y verificaron por hash Git los **18 archivos exactos** del árbol de la PR #88, y se ejecutaron con `node:sqlite`, cuentas e invitaciones reales del laboratorio. Las 7 pruebas de integración añadidas por #88 están incluidas y pasan. La guardia transaccional `section-mutation-session-guard.mjs` sigue integrada en `sqlite.mjs`. **34/34 PASS adicionales** en cinco suites independientes puras/SQLite de una ejecución anterior; no se suman a una única sesión de 69 pruebas. Inventario: **68 suites** registradas; regresión completa, Windows 11, HTTP/SSE y dos navegadores reales pendientes. Ver [revalidación de sesión y transacción](69-revalidacion-sesion-transaction-ccwb.md).


## R-04 → R-05: movimiento candidato limitado a órdenes registradas (12/11/2026)

La función pura `precheckStagedAncientsMovement` utiliza el `orderSnapshot` privado del diario de cartas de sección, exige unidad ordenada, actor y revisión correctos y **perfiles/terreno de procedencia exclusiva del servidor**, y reutiliza `precheckAncientsMovementPath` para geometría, ocupación, líderes, terreno y distancias básicas. No añade transición ni modifica SQLite. Una propuesta `CANDIDATE` significa únicamente que el filtro preliminar no ha detectado impedimentos: **`movementAuthorized:false`, `attackAuthorized:false`, `needsFullLegalityCheck:true`**. No implica habilitar movimiento oficial, cartas especiales, combates ni HTTP.

**Evidencia nativa conjunta:** **46/46 PASS, 0 FAIL, 0 SKIP** con Node.js 22.16.0/Linux sin WSL: 10 pruebas de nueva prevalidación, 25 del puente SQLite (incluida ausencia de efectos al consultar órdenes persistidas) y 11 de composición real con cuentas e invitaciones. SHA-256 TAP: `72cd68388c5f2f4f188c306543d73cbe1f95d652ac827fb7cdfa5eba880fcc21`. **69 suites inventariadas**, no significa regresión completa ejecutada. Pendientes Windows, HTTP/SSE, reglas oficiales y pruebas de dos navegadores. Ver [documentación del filtro de movimiento desde órdenes](70-preflight-movimiento-ordenes-ancients.md).


## R-04 → R-05: previsualización vinculada a sesión y diario SQLite (12/11/2026)

La consulta interna `precheckExperimentalSectionMovement({sessionToken,expectedRevision,unitId,path},trustedContext)` deriva actor y pertenencia de la sesión, fija una instantánea WAL coherente para identidad y partida, verifica el replay del diario CCWB y ejecuta únicamente el filtro de ruta desde unidades ordenadas de la PR #89. Los perfiles y terrenos se pasan **por separado desde datos de servidor**. El cliente no puede inyectar actor, usuario ni contexto del escenario en la petición. No hay HTTP, escritura de movimiento ni autorización de combate. **`CANDIDATE` nunca significa movimiento reglamentariamente legal**.

**Evidencia integrada real:** seis nuevos casos de sesiones, suplantación, privacidad, concurrencia WAL, adulteración de eventos, validación estricta y ausencia de escrituras; ejecución conjunta del filtro, puente y composición de identidad **52/52 PASS (0 FAIL, 0 SKIP)** con Node.js 22.16.0/Linux sin WSL. TAP SHA-256 `0244d48c9bbd5d44f38310234ebe15cc295417f15c9a9951252e85b2927659c2`. Se mantienen **69 suites** en el manifiesto, sin ejecutar todavía la regresión total. Pendientes Windows, HTTP/SSE, dos navegadores, escenarios oficiales y transacciones que apliquen movimientos. Véase [previsualización privada autenticada](71-previsualizacion-privada-movimiento-ancients.md).


## Cierre de exposición indirecta en HTTP y SSE — CCW-015 (12/11/2026)

La vista experimental de CCWB se obtenía también desde `getStore(matchId).view(actor)`, que era utilizado por la ruta **preexistente** `GET /api/matches/:id`. Por tanto, la afirmación histórica «sin una nueva ruta HTTP» no garantizaba el aislamiento del laboratorio. La rama `fix/i4-ccwb-lab-http-read-boundary` devuelve ahora `409 SECTION_LAB_INTERNAL_ONLY` para estado y eventos HTTP cuando se detecta `LAB_ONLY`, bloquea comandos genéricos y suscripciones SSE al laboratorio, y cierra los SSE antiguos al activarlo. Las lecturas de eventos HTTP se protegen dentro de su propia instantánea WAL, no solo en una comprobación previa.

Además, el comando sintético `pass_demo_turn` vuelve a comprobar la modalidad bajo `BEGIN IMMEDIATE`, impidiendo que una activación concurrente inserte eventos demo en el diario experimental. **Dos nuevas pruebas SQLite superadas**: lectura tras activación en otra conexión y escritura demo tras activación entre precheck y bloqueo; **54/54 PASS conjuntos** en tres suites nativas, sin WSL. **Seis pruebas HTTP/SSE preparadas y NO ejecutadas**; quedan pendientes antes de fusionar la corrección fuera de la cadena experimental. Inventario **70 suites**, sin regresión total ejecutada. Véase [aislamiento HTTP del laboratorio](72-limite-http-laboratorio-ancients.md). No autoriza movimiento ni combate oficiales.


## Exclusión entre laboratorio Ancients y mazo sintético (12/11/2026)

La inicialización ordinaria del mazo debía rechazar `ancientsSectionHistoryLab` **dentro de su propia transacción SQLite**, no solo en el preflight de la composición: otra conexión podía activar el diario entre ambos. Se añade ese guard bajo `BEGIN IMMEDIATE` y bloqueos equivalentes para `dispatch` y `view` del mazo ante estados mixtos. **Cuatro nuevos casos de integración SQLite** repartidos en `packages/command-deck/sqlite-game.test.mjs` y `packages/sqlite-store/ancients-section-history.test.mjs`; pendientes de ejecución nativa en esta rama. Se han superado **5/5 comprobaciones aisladas con transacción simulada** sobre el código Git exacto, que no sustituyen los tests SQLite. Total inventariado: **71 suites**. Documento: [exclusión atómica de modos](73-exclusion-atomica-mazo-laboratorio.md). Las reglas y combates oficiales no se habilitan.


## R-04/R-05 — prevalidación individual de líder ordenado (LAB-ANC, 12/11/2026)

Se incorpora un filtro **de solo lectura** para líderes a partir de las
reglas básicas de *Ancients* (tercera edición, 2009), sin mezclarlo con
los límites de desplazamiento de unidades. Se comprueban 1–3 pasos
adyacentes, ocupación, paso por unidades y líderes amigos, prohibición
de terminar sobre otro líder y restricciones normales de bosque/terreno
accidentado. Exige orden explícita del líder extraída de un diario
CCWB verificado, sesión y bando obtenidos del servidor y una única
instantánea WAL. No hay comandos de movimiento, endpoints, escrituras,
excepciones de escenario, evasión ni resolución de combate.

**Contratos:** `leader-movement-preflight.mjs` (geometría/ocupación),
`staged-movement-preflight.mjs` (turno, órdenes y revisión),
`sqlite-section-ccwb-bridge.mjs` (replay) y
`sqlite.mjs` (sesión y snapshot WAL), con
`precheckExperimentalSectionLeaderMovement` **solo interno**.

**Pruebas preparadas:** 8 casos nuevos del módulo puro, 5 en el
filtro staged y 3 integraciones con SQLite y sesiones. Ejecutadas en
**V8 aislado** las 8 pruebas puras nuevas y las 15 de la suite staged
(10 previas + 5 nuevas) sobre los blobs exactos de GitHub, todas
correctas. **Los 3 casos SQLite y las 72 suites nativas siguen
pendientes**. Conservar la rama y PR en borrador sin prometer legalidad
ni cambiar `main`. Véase
[prevalidación de líderes](75-preflight-lideres-ancients.md).


## R-04/R-05 — orden temporal simulado de unidades y líderes (LAB-ANC, 12/11/2026)

Las reglas verificadas de tercera edición (2009) permiten separar un líder
de una unidad **antes** de que esta se mueva; si se mueve con ella ya no puede
separarse en ese turno. Una unidad a la que llega un líder no puede moverse
más, aunque puede seguir combatiendo si se cumplen los requisitos restantes.
Se implementa **simulación de secuencias hipotéticas sin persistencia**,
con bloqueo de doble movimiento por pieza, validación de orden de los
movimientos y aplicación sobre copias exclusivamente.

**Código:** `leader-unit-sequence-preflight.mjs` (reglas temporales
sobre estado provisional); `staged-movement-preflight.mjs` (sesión,
revisión y órdenes); `sqlite-section-ccwb-bridge.mjs` (replay
privado íntegro); `sqlite-store/sqlite.mjs` (instantánea WAL
autenticada para método estrictamente interno). **No** hay endpoint,
acción ejecutable, cambio de base de datos ni autorización.

**Pruebas:** +10 nuevos casos puros en una suite nueva, +5 en la suite
staged y +3 casos de composición SQLite todavía **sin ejecutar**.
Comprobación aislada del código de GitHub: **38/38** resultados correctos
(8 de movimiento individual, 10 de secuencia, 20 staged, estos últimos
incluyen pruebas previas); sintaxis de SQLite/bridge comprobada, sin
ejecución nativa de la regresión. El inventario actual de la PR #95
contiene **73 suites**; el incremento de #95 es de **34 casos nuevos**
(16 anteriores + 18 de secuencia). La norma R-04/R-05 y CCW-014
permanecen **incompletas** hasta tener un reductor de movimiento
reglamentario, diario persistente de movimientos, pruebas nativas y
validación contra escenarios. Véase
[secuencia líder–unidad](76-secuencia-temporal-lider-unidades-ancients.md).


## LAB-ANC — borrador privado de movimientos, revisión independiente (12/11/2026)

El nuevo contrato `movement-draft-contract.mjs` admite guardar una **propuesta hipotética**, no ejecutar movimiento. La composición SQLite comprueba dentro de `BEGIN IMMEDIATE` la sesión y pertenencia, el replay privado de cartas y órdenes y `CANDIDATE_SEQUENCE`; solo entonces guarda `ancientsSectionMovementDraft` en `matches.private_state`. No altera tablero, revisión de juego, eventos públicos ni claves de comandos del juego. La consulta usa un snapshot WAL y solo proyecta la propuesta a su bando en la revisión de origen; la propuesta caduca tras avanzar el diario.

La versión del borrador y su clave de idempotencia controlan ediciones/reintentos sin crear órdenes nuevas. Se verificó **9/9** de lógica de contrato con **Node.js 22.16.0 nativo y SHA-256 real** sobre los tres blobs Git exactos (contrato, suite, geometría); evidencia TAP SHA-256 `507d4c960f934b25934fc782adb8b2c5c49f8bc12ace3f570ba8822b600`. La evaluación V8 con digest simulado fue preliminar. Se prepararon **6 pruebas de integración SQLite** para persistencia, privacidad, revocación, inmutabilidad, idempotencia, cierre de turno y bloqueos, pendientes de ejecución real. La PR #95 acumula **49 casos nuevos**, con **74 suites registradas y presentes**; su regresión completa sigue pendiente. La propuesta nunca concede movimiento legal. Documento: [contrato de borrador privado](77-borrador-privado-movimientos-ancients.md).


## LAB-ANC — prueba nativa aislada de SQLite/WAL del borrador (12/11/2026)

Se ha añadido la suite `packages/ancients-rules/movement-draft-sqlite-contract.test.mjs`,
que usa `node:sqlite` real, un archivo temporal, `PRAGMA journal_mode=WAL`,
conexiones independientes, snapshot de lectura y `BEGIN IMMEDIATE` de
escritura. **8/8** pruebas de la nueva suite correctas: persistencia
entre conexiones, idempotencia y revisión, snapshots consistentes,
conflicto de escritores, caducidad, corrupción y rollback por datos
inválidos. Combinadas con las **9/9** de contrato puro:
**17/17 PASS, 0 FAIL**, Node.js 22.16.0 sin WSL. Informe TAP SHA-256:
`278c4034328c38a5244a15e51740f1424a0284f77d6f66c1d2adf83333ef07b9`.
La suite nativa SQLite coincide con el blob Git
`a686c5822c1045a45901d442c752f51266c816c0`;
módulo y dependencias puras también contrastados por hash.

**Alcance limitado**: se prueba el contrato en un esquema SQLite mínimo
con adaptador de prueba, **no la composición real de la aplicación**.
Quedan **12 casos de integración del juego con SQLite sin ejecutar**;
tampoco se ejecutó la regresión completa. El manifiesto contiene
**75 suites reales**, 75 declaradas, y el recuento de casos nuevos de
la PR #95 es **57** (49 anteriores y 8 nuevos). Requisito CCW-014 y
el bloqueo de fusión siguen abiertos. Referencia:
[borrador privado y evidencia nativa](77-borrador-privado-movimientos-ancients.md).


## LAB-ANC — versión protegida del borrador y purga al avanzar el diario (12/11/2026)

El checksum de `movement-draft-contract.mjs` incorpora ahora
`draftRevision`, evitando que un cambio arbitrario del contador de
concurrencia quede fuera de la verificación. La secuencia de acciones
se codifica con campos ordenados para idempotencia estable ante JSON
equivalente. En la composición experimental,
`sqlite-section-ccwb-bridge.mjs` purga el borrador privado **de forma
atómica** cuando avanza el diario; los intentos rechazados no lo borran.
Nunca se confirma movimiento ni se añade un nuevo evento.

**19/19 PASS con Node.js 22.16.0 y SQLite/WAL nativo** para las suites
`movement-draft-contract.test.mjs` y
`movement-draft-sqlite-contract.test.mjs`, con archivos idénticos a los
blobs Git de la rama. SHA-256 del TAP:
`b87335b82b9d88195c2f95c01f969f087165d3f8f1fca485b234b5a840d123c6`.
El puente e integración ampliada pasan análisis sintáctico, pero
**13 casos nuevos de integración CCWB+SQLite siguen sin ejecutar**.
PR #95: **60 nuevos casos preparados, 75 suites**. No completar CCW-014,
no publicar métodos internos ni fusionar en `main`.


## R-04/R-05 — traza verificable de movimiento candidato (LAB-ANC, 12/11/2026)

La preparación del futuro registro de movimientos confirmados incorpora
`movement-candidate-journal.mjs`, que deriva una traza de propuesta
**únicamente** tras `CANDIDATE_SEQUENCE`, con resumen de contexto
de tablero, órdenes y terreno, entradas correlativas SHA-256 y replay
determinista. **No convierte la propuesta en jugada ni la escribe en
SQLite, eventos o interfaz.** Toda respuesta conserva
`movementAuthorized:false` y `stateChanged:false`.

**Pruebas:** +10 casos en
`movement-candidate-journal.test.mjs`; V8 aislado **10/10** con
resumen criptográfico simulado (NO prueba nativa de SHA-256). El
manifiesto de la rama apilada alcanza **76 suites**; ni esta nueva
suite ni la regresión conjunta han sido ejecutadas nativamente.
La composición CCWB y SEC-001 (#93) siguen pendientes. Véase
[traza de movimientos candidatos](78-traza-auditoria-movimientos-candidatos.md).


## R-04/R-05 — evidencia con sesión y órdenes comprobadas (LAB-ANC, 12/11/2026)

La traza `movement-candidate-journal.mjs` se conecta al diario privado
por `precheckStagedAncientsMovementEvidence`,
`createSqliteAncientsSectionBridge.previewMovementEvidence` y
`getStore(matchId).precheckExperimentalSectionMovementEvidence`.
La identidad y pertenencia a la partida se verifican con la revisión,
órdenes, estado y reglas **dentro del snapshot WAL**. Los datos del
escenario los aporta exclusivamente el servidor. Se rechaza el exceso
de acciones respecto a órdenes y se usa ordenación ordinal fija para
que los resúmenes no dependan del locale del servidor.

**Pruebas nuevas:** +4 casos staged, +4 casos SQLite preparados,
+1 caso de determinismo SHA-256. Resultado V8 aislado 24/24 staged y
11/11 auditoría, digest simulado; resultado Node nativo **4/4** con
SHA-256 real del módulo exacto, pero precheck sustituido y **sin**
composición SQLite. No se han ejecutado las cuatro pruebas nuevas
SQLite ni la regresión de las 76 suites. No se autorizan ni aplican
movimientos. Véase
[consulta CCWB autenticada](79-evidencia-movimientos-ccwb-autenticada.md).


## R-05 — reductor sintético privado de un hexágono (consolidación de PR #98 en #99)

`clear-lab-movement-reducer.mjs` crea una copia profundamente inmutable del
**tablero simulado** para una o varias unidades de infantería ordenadas,
con movimientos de un solo hexágono en terreno totalmente abierto y sin líderes.
Usa el preflight staged para revisión, bando, órdenes, colisiones y geometría.
No consume órdenes ni se conecta al almacén: la política explícita
`SYNTHETIC_OPEN_HEX_V1` **no es permiso reglamentario**. Siempre
`canCommit:false`, `movementAuthorized:false` y `stateChanged:false`.

Se copian sin alteración el módulo y los **11 tests** de la PR #98 a la rama
unificada con el filtro de intención de PR #99 (**13 tests nativos comprobados**).
El manifiesto combinado tiene **78 suites**. El reductor cuenta por ahora con
**11/11 evaluaciones V8 aisladas** de su rama original, pero **no** ha pasado
las 11 pruebas con Node nativo dentro del nuevo árbol. Las 78 suites,
composición CCWB/SQLite y seguridad de PR #93 siguen pendientes.
Véase [reductor sintético](82-reductor-movimientos-lab-un-hexagono.md) y
[contrato de intención](81-contrato-entrada-movimiento-confirmado.md).
