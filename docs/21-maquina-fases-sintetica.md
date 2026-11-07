# CCW-011 — Contrato de fases del turno y actor requerido

**Estado:** prototipo independiente de red, base de datos y reglamento, con **acciones enteramente sintéticas**. No es una implementación válida para jugar a *Command & Colors: Ancients*.

## Objetivo

Separar del servidor una máquina de estados determinista, serializable y sin efectos secundarios, de modo que una partida futura pueda continuar correctamente después de una desconexión, incluso si la acción requerida corresponde al defensor y el turno sigue perteneciendo al atacante.

Contrato: `transitionSyntheticTurn(state, command)` devuelve `{accepted:true,nextState,events}` o `{accepted:false,rejection}`. Cada cambio aceptado incrementa una revisión. El motor no lee archivos ni HTTP, no consume azar y no interpreta acciones de un reglamento real. La autenticación de cuenta, idempotencia persistida y transacciones corresponden al backend.

## Fases demostradas

```text
AWAIT_CARD → ASSIGN_ORDERS → MOVEMENT → COMBAT → DRAW_CARD → AWAIT_CARD (otro bando)
```

Los comandos de ejemplo son `play_synthetic_card`, `assign_synthetic_orders`, `undo_synthetic_orders`, `finish_synthetic_movement`, `ask_synthetic_defense`, `answer_synthetic_defense`, `finish_synthetic_combat` y `acknowledge_synthetic_draw`.

Un defensor puede recibir `pendingDecision={kind:'DEFENSE_CHOICE', actor:'B', ...}` durante el turno de A, con decisiones artificiales `STAND` o `EVADE`. Solo B puede responder, y la fase permanece en `COMBAT` con el turno de A hasta que se cierre el subproceso. El estado se conserva y recupera correctamente mediante JSON, pero **todavía no se integra con la base SQLite ni con el reglamento**.

La opción de `undo_synthetic_orders` únicamente revierte la asignación de órdenes desde la fase inmediatamente posterior. No intenta deshacer cartas reveladas, movimientos ya ejecutados, azar ni dependencias de otras personas. Es una prueba arquitectónica, no la regla final de deshacer.

## Límites deliberados

- La referencia de carta `cardRef` es un identificador ficticio, no una carta existente ni una instrucción para jugarla.
- Los identificadores de unidades se validan formalmente y se evita duplicarlos, pero **no se verifican sectores, composición de ejército, terreno, movimiento o límites de órdenes oficiales**.
- Las transiciones de movimiento, combate y robo **no efectúan esas acciones**; son marcadores para comprobar el orden y la persistencia de las fases.
- No existen dados, resultados aleatorios, evasiones reales, impactos, retirada, victoria o fin de escenario.
- No se importan ilustraciones, textos de cartas, tableros ni escenarios oficiales.
- Antes de crear una partida jugable, hay que documentar las reglas de la edición física y acoplar el motor con un ruleset de *Ancients* versionado. Los ejemplos sintéticos no deben mostrarse como reglamento válido.

## Verificación

Con Node.js 22 o posterior, desde la raíz de la rama:

```powershell
node --test packages/turn-phase/phase.test.mjs
```

**15 pruebas superadas, 0 fallos** en Node.js 22.16.0. Se cubren transición de todas las fases, cambio de turno, actor activo y defensor, continuación pendiente serializada, rechazo de opciones ilegales, revisión obsoleta, deshacer limitado, duplicados, tamaño y validación de estado.

## Integración posterior

La futura incorporación al servidor deberá mantener estado y eventos dentro de una sola transacción, usar identidad/turno autorizados, controlar idempotencia y proyectar únicamente datos públicos o privados permitidos. Se evaluará en la issue #11 después de validar fuentes/reglamento; este incremento no cierra esa issue.

Esta rama es **independiente** de las PR #27 y #31–#36; no requiere fusionarlas ni modifica `main`.
