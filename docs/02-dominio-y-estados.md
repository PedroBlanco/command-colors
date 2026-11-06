# Modelo de dominio y transiciones

## Entidades

- Account: identidad, credenciales y permisos.
- Invitation: emisor, destinatario, plazo, aceptación/rechazo.
- Match: reglamento y versión, escenario congelado, dos jugadores, modalidad de dados, estado, revisión.
- ScenarioDefinition: disposición, terreno, despliegue, manos iniciales, iniciativa, reglas especiales y victoria.
- BoardState: topología, hexágonos, unidades, líderes, terreno y bajas.
- TurnState: propietario de turno, fase, carta, órdenes, unidades ya activadas y combate actual.
- DeckState: orden del mazo, descarte y manos por jugador, exclusivamente en zona privada del servidor.
- DecisionRequest: actor requerido, opciones válidas, plazo opcional y continuación del proceso.
- Command: petición no confiable del cliente con actor, tipo, payload, revisión esperada e idempotencyKey.
- Event: hecho confirmado con secuencia y audiencia pública/privada.
- Correction: solicitud, votos, causa y evento compensatorio.

## Contrato propuesto del motor

processCommand(matchState, command, ruleset, randomness) => {accepted, nextState, events, pendingDecision, rejection}

El servidor autentica al usuario, comprueba pertenencia y actor facultado, aplica el motor y guarda el resultado dentro de una transacción. Las acciones se verifican siempre con el estado actual, no con el tablero que declara el cliente.

## Ancients: fases de un turno

AWAIT_CARD → ASSIGN_ORDERS → MOVEMENT → COMBAT → DRAW_CARD → AWAIT_CARD.

Los movimientos preceden a los combates. Cada combate se resuelve antes de iniciar el siguiente. Retiradas, evasiones y otras reacciones son subprocesos que permiten al defensor contestar manteniendo el turno del atacante. La máquina de estados debe poder persistir una continuación pendiente.

Estados de partida: INVITED → READY → ACTIVE → FINISHED; también CANCELLED o SUSPENDED por intervención administrativa. La desconexión no suspende una partida asíncrona.

## Invariantes

1. Dos plazas como máximo; las reglas de ocupación del tablero son propias de cada juego.
2. Una partida activa tiene un único jugador cuyo turno está en curso, pero el actor requerido puede ser el contrario.
3. Cada comando aceptado aumenta la revisión; una clave repetida no aplica efectos por segunda vez.
4. Todas las órdenes, movimientos, combates y decisiones defensivas están permitidas por el reglamento activo.
5. Un cliente nunca recibe mano ajena, mazo futuro ni datos ocultos en API, notificaciones, logs o errores.
6. Una partida cerrada no acepta acciones ordinarias.
7. Las versiones de reglas y escenario no cambian durante la partida salvo migración explícita.

## Persistencia y concurrencia

Flujo de un comando: autorización → idempotencia → comparación de expectedRevision → ejecución del motor → guardar estado y eventos conjuntamente → commit → notificar revisión. En conflicto, retornar nueva vista **filtrada**. Las notificaciones SSE pueden contener solo el número de revisión y obligar a refrescar la vista privada.

## Deshacer

El servidor solo permite cancelar una acción unilateralmente si no ha generado azar, revelado información ni recibido dependencias posteriores. En otros casos, generar petición de rectificación, recoger consentimiento de ambos y registrar compensación sin borrar eventos anteriores.
