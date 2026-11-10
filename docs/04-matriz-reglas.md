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
