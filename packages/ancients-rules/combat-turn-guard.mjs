/**
 * Ancients base 3e (R-04/R-06): fail-closed, read-only combat turn/order gate.
 * This does not authorize combat, validate an actual command card or mutate
 * turn state. The turn snapshot MUST be server-owned and transactional.
 */
import {ANCIENTS_RULESET} from './movement-profile.mjs';

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const PHASES = new Set(['AWAIT_CARD', 'ASSIGN_ORDERS', 'MOVEMENT', 'COMBAT', 'DRAW_CARD']);
const SIDES = new Set(['A', 'B']);
const goodId = value => typeof value === 'string' && ID.test(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === null || Object.getPrototypeOf(value) === Object.prototype);
const list = values => Array.isArray(values) && values.length <= 117
  && values.every(goodId) && new Set(values).size === values.length;
const freeze = (status, reason, extra = {}) => Object.freeze({
  status, reason, ...extra,
  needsFullLegalityCheck: true,
  attackAuthorized: false,
  turnPhaseScreened: true,
  commandCardValidated: false,
  scenarioExceptionsChecked: false
});

/**
 * Snapshot contract deliberately differs from 'synthetic-phases-v1' to prevent
 * synthetic card/order data from being mistaken for official Ancients orders.
 */
function validateTurnState(state) {
  if (!record(state) || state.schemaVersion !== 1 || state.ruleset !== ANCIENTS_RULESET
    || !['ACTIVE', 'FINISHED'].includes(state.status) || !SIDES.has(state.turn)
    || !PHASES.has(state.phase) || !Number.isSafeInteger(state.revision) || state.revision < 0
    || !list(state.orderedUnitIds) || !list(state.resolvedBattleUnitIds)
    || !state.resolvedBattleUnitIds.every(id => state.orderedUnitIds.includes(id))
    || !record(state.movedStepsByUnit)
    || !(state.pendingCombat === null || record(state.pendingCombat))
    || !(state.pendingDecision === null || record(state.pendingDecision))) {
    throw new TypeError('INVALID_ANCIENTS_TURN_STATE');
  }
  const entries = Object.entries(state.movedStepsByUnit);
  if (entries.length > 117 || entries.some(([id, steps]) =>
      !goodId(id) || !state.orderedUnitIds.includes(id)
      || !Number.isSafeInteger(steps) || steps < 0)) {
    throw new TypeError('INVALID_ANCIENTS_TURN_STATE');
  }
}

/**
 * sessionSide must be derived from the authenticated player on the server.
 * attackerId/targetId/expectedRevision are declarations, not sources of truth.
 */
export function screenAncientsCombatTurn({turnState, sessionSide,
  attackerId, targetId, expectedRevision} = {}) {
  validateTurnState(turnState);
  if (!goodId(attackerId) || !goodId(targetId) || attackerId === targetId
      || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    throw new TypeError('INVALID_COMBAT_DECLARATION');

  if (!SIDES.has(sessionSide)) return freeze('BLOCKED', 'SESSION_SIDE_REQUIRED');
  if (expectedRevision !== turnState.revision) return freeze('BLOCKED', 'STALE_REVISION');
  if (turnState.status !== 'ACTIVE') return freeze('BLOCKED', 'MATCH_NOT_ACTIVE');
  if (sessionSide !== turnState.turn) return freeze('BLOCKED', 'NOT_ACTING_PLAYER');
  if (turnState.phase !== 'COMBAT') return freeze('BLOCKED', 'WRONG_PHASE');
  if (turnState.pendingCombat !== null || turnState.pendingDecision !== null)
    return freeze('BLOCKED', 'COMBAT_OR_DECISION_PENDING');
  if (!turnState.orderedUnitIds.includes(attackerId))
    return freeze('BLOCKED', 'UNIT_NOT_ELIGIBLE');
  if (turnState.resolvedBattleUnitIds.includes(attackerId))
    return freeze('BLOCKED', 'UNIT_ALREADY_BATTLED');
  if (!Object.hasOwn(turnState.movedStepsByUnit, attackerId))
    return freeze('BLOCKED', 'MISSING_SERVER_MOVEMENT_RECORD');
  return freeze('CANDIDATE', null, {
    movedSteps: turnState.movedStepsByUnit[attackerId],
    revision: turnState.revision
  });
}
