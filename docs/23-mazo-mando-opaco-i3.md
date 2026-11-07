# CCW-012 — Mazo opaco y manos privadas (incremento técnico I3)

**Estado:** contrato probado con cartas sintéticas, **no** implementación de cartas ni reglas de *Command & Colors: Ancients*. Esta entrega no convierte el sistema en una partida jugable ni almacena todavía estos datos en SQLite.

## Objetivo y contrato

`packages/command-deck/deck.mjs` añade un estado del servidor que representa ejemplares **únicos** de cartas mediante identificadores opacos (p. ej., `card_0001`). Cada ejemplar conserva su identidad aunque existan varias copias de un mismo tipo en un futuro catálogo reglamentario. El módulo nunca incluye nombres, ilustraciones, textos, recuentos oficiales ni distribuciones del mazo protegido.

Exporta cuatro operaciones principales:

- `createCommandSession({cardIds,handSizes,startingSide,randomIndex?})`: baraja y reparte cantidades explícitas para cada bando. Por defecto emplea `node:crypto.randomInt`, no `Math.random`. La inyección de `randomIndex` está destinada a pruebas locales reproducibles, nunca a aceptar una semilla enviada por un navegador.
- `assertCommandSnapshot(state)`: valida versión, conservación de todos los ejemplares, ausencia de duplicados, estructura de fases y consistencia entre carta jugada y fase. Rechaza estados alterados antes de operar sobre ellos.
- `transitionCommandSession(state,command)`: transiciones puras sobre el **reducer real de fases sintéticas** de CCW-011. Rechaza actor incorrecto, revisión obsoleta, carta fuera de la mano propia, orden de fases incorrecto y turno condicionado por una decisión defensiva. Los cambios de mano/descarte/robo solo se producen con la transición reglada correspondiente del prototipo.
- `projectCommandSession(state,actor)`: devuelve **solo** la mano propia, número de cartas del rival, tamaño del mazo, descarte público, carta en mesa, fase y decisión pendiente. Nunca devuelve el orden del mazo, otra mano ni la información que permite reconstruirlos.

El estado completo debe vivir exclusivamente del lado del servidor. La identidad A/B provendrá de la sesión autenticada, **nunca** de un campo `actor` confiado al navegador. La sincronización SSE existente continuará publicando únicamente contadores de revisión; este módulo no altera SSE ni API.

## Secuencia técnica comprobada

1. El servidor mezcla ejemplares únicos con Fisher–Yates y reparte a A y B, con cantidades indicadas por un escenario de prueba.
2. Durante `AWAIT_CARD`, el jugador del turno selecciona una carta que **debe estar en su propia mano**. Esta pasa a ser visible públicamente como carta en juego.
3. Avanza por `ASSIGN_ORDERS`, `MOVEMENT` y `COMBAT` empleando acciones **sintéticas**. Se puede deshacer una asignación de órdenes antes de iniciar movimiento; eso **no** devuelve la carta jugada.
4. Si se abre una decisión defensiva, responde el defensor sin cambiar el turno. La decisión y las manos sobreviven a una serialización JSON del estado.
5. En `DRAW_CARD`, el atacante descarta públicamente la carta jugada y roba en secreto un ejemplar del mazo restante. Solo el servidor conoce qué carta ha robado. Después cambia el turno.
6. Si no quedan cartas, el módulo **no remezcla automáticamente** el descarte. Este es un comportamiento explícito de la **maqueta**, no una decisión sobre las reglas de agotamiento del mazo de Ancients.

## Verificación y trazabilidad

Con Node.js 22 o posterior, sin paquetes externos, sin WSL y sin GitHub Actions:

```powershell
node --test packages/turn-phase/phase.test.mjs packages/command-deck/deck.test.mjs
```

**21 pruebas nuevas** del mazo pasan sobre el reducer de fases real (cuyo fichero local se comparó mediante SHA Git con `main`). Abarcan: mezcla y límites de RNG, identificación única, conservación, configuración, proyecciones privadas, rechazo de actor ajeno o revisión obsoleta, carta fuera de mano, tránsito y descarte/robo, no filtración en eventos, deshacer limitado, decisión defensiva, vuelta completa de dos turnos, recuperación JSON y agotamiento sin remezclar.

| Requisito | Cobertura nueva | Estado reglamentario |
| --- | --- | --- |
| R-02 — tamaño de manos por escenario | Parámetro explícito; prueba de cantidades inválidas | Sin vinculación a escenarios oficiales |
| R-03 — mazo, jugar, descartar, robar | Contrato opaco y pruebas de conservación/ocultación | Parcial técnico; sin cartas reales ni agotamiento normativo |
| R-13 — subprocesos y respuesta de defensor | Integración con fases sintéticas CCW-011 | Parcial técnico; sin combate normativo |
| Privacidad por jugador | Vistas A/B, no filtración de mazo ni mano rival | Contrato puro probado; pendiente de integrar en API y SQLite |

## Dependencias y pendientes

1. Seleccionar edición, composición y recuentos del mazo según el **reglamento físico revisado**. No inferir cantidades oficiales del prototipo.
2. Definir el catálogo de cartas y su configuración, verificando derechos de imágenes y textos. Los identificadores opacos no implican permiso de redistribución.
3. Integrar el estado completo de cartas y fases en una transacción SQLite/PostgreSQL, con idempotencia y control de revisión, preservando las manos tras reinicio real.
4. Derivar el bando de la sesión autorizada y proyectar respuesta HTTP/SSE sin filtrar cartas; probar dos navegadores.
5. Aplicar los efectos **reales** de una carta, legalidad de órdenes, límites de selección, movimientos y combate. El prototipo sigue usando `*_synthetic_*`.
6. Fijar explícitamente reglas de agotamiento, final de partida y política de correcciones con información oculta. No se permiten deshacer automáticos de extracción o azar.

**No cerrar CCW-012 todavía.** Las nuevas pruebas solo completan el contrato de dominio y no los criterios de aceptación de un juego funcional.
