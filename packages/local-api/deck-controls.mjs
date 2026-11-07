/** Pure browser-facing controls for the SYNTHETIC deck only (CCW-012).
 * This is a convenience layer, never an authority: the server validates all actions.
 */
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SIDES = ['A', 'B'];
const VALID_PHASES = ['AWAIT_CARD', 'ASSIGN_ORDERS', 'MOVEMENT', 'COMBAT', 'DRAW_CARD'];

export function deckActions(view) {
  if (!view || !SIDES.includes(view.you) || !SIDES.includes(view.turn) ||
      !VALID_PHASES.includes(view.phase) || !Number.isSafeInteger(view.revision) || view.revision < 0 ||
      !Array.isArray(view.yourHand) || typeof view.actingSide !== 'string') {
    return Object.freeze([]);
  }
  if (view.actingSide !== view.you) return Object.freeze([]);
  const pending = view.pendingDecision;
  if (pending != null) {
    if (view.phase !== 'COMBAT' || pending.actor !== view.you || pending.kind !== 'DEFENSE_CHOICE') return Object.freeze([]);
    return Object.freeze(['answer_synthetic_defense']);
  }
  if (view.turn !== view.you) return Object.freeze([]);
  const actions = {
    AWAIT_CARD: view.yourHand.length ? ['play_synthetic_card'] : [],
    ASSIGN_ORDERS: ['assign_synthetic_orders'],
    MOVEMENT: ['undo_synthetic_orders', 'finish_synthetic_movement'],
    COMBAT: ['ask_synthetic_defense', 'finish_synthetic_combat'],
    DRAW_CARD: ['acknowledge_synthetic_draw']
  };
  return Object.freeze(actions[view.phase] || []);
}

/** Refuse malformed local input before any HTTP request; server still authorizes. */
export function deckCommand(view, type, data = {}, key) {
  if (!deckActions(view).includes(type)) throw new Error('ACCION_NO_DISPONIBLE');
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw new Error('CLAVE_INVALIDA');
  const request = {type, expectedRevision: view.revision, idempotencyKey: key};
  switch (type) {
    case 'play_synthetic_card':
      if (typeof data.cardRef !== 'string' || !view.yourHand.includes(data.cardRef)) throw new Error('CARTA_NO_PROPIA');
      request.cardRef = data.cardRef;
      break;
    case 'assign_synthetic_orders':
      if (!Array.isArray(data.unitIds) || data.unitIds.length > 117 ||
          !data.unitIds.every(x => typeof x === 'string' && IDENTIFIER.test(x)) ||
          new Set(data.unitIds).size !== data.unitIds.length) throw new Error('ORDENES_INVALIDAS');
      request.unitIds = [...data.unitIds];
      break;
    case 'ask_synthetic_defense':
      if (typeof data.targetUnit !== 'string' || !IDENTIFIER.test(data.targetUnit)) throw new Error('OBJETIVO_INVALIDO');
      request.targetUnit = data.targetUnit;
      break;
    case 'answer_synthetic_defense':
      if (!['STAND', 'EVADE'].includes(data.choice) || !view.pendingDecision?.options?.includes(data.choice))
        throw new Error('RESPUESTA_INVALIDA');
      request.choice = data.choice;
      break;
  }
  return request;
}

/** Only public/own information is presented; never accept a full server snapshot. */
export function deckSummary(view) {
  if (!view || !SIDES.includes(view.you) || !Array.isArray(view.yourHand) ||
      !Number.isSafeInteger(view.opponentCardCount) || !Number.isSafeInteger(view.drawPileCount) ||
      !Array.isArray(view.discardPile)) return null;
  return {
    tuBando: view.you, turno: view.turn, debeActuar: view.actingSide,
    fase: view.phase, revision: view.revision,
    tuMano: [...view.yourHand], cartasDelRival: view.opponentCardCount,
    cartasEnMazo: view.drawPileCount, descarte: [...view.discardPile],
    cartaPublica: view.cardInPlay,
    decisionPendiente: view.pendingDecision ?? null,
    unidadesPublicas: Array.isArray(view.board) ? structuredClone(view.board) : []
  };
}
