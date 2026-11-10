/**
 * Compose the Ancients combat turn/order guard with the ranged-attack screen.
 * Both contracts are read-only: CANDIDATE never authorizes or records a battle.
 * Must be called inside a future authenticated, revision-checked transaction.
 */
import {screenAncientsCombatTurn} from './combat-turn-guard.mjs';
import {precheckAncientsRangedAttack} from './ranged-precheck.mjs';

const freeze = (status, reason, extra = {}) => Object.freeze({
  status, reason, ...extra,
  needsFullLegalityCheck:true, attackAuthorized:false,
  commandCardValidated:false, combatRecorded:false,
  scenarioExceptionsChecked:false
});

/**
 * turnState + board must both come from the same server-owned revision.
 * sessionSide must come from server-side authentication, not a request body.
 */
export function precheckAncientsRangedDeclaration({turnState, board, sessionSide,
  attackerId, targetId, expectedRevision} = {}) {
  const turnGate = screenAncientsCombatTurn({
    turnState, sessionSide, attackerId, targetId, expectedRevision
  });
  if (turnGate.status !== 'CANDIDATE')
    return freeze('BLOCKED', turnGate.reason, {turnGate});

  if (!board || typeof board !== 'object' || Array.isArray(board)
      || !Array.isArray(board.units) || !Array.isArray(board.leaders)
      || !Array.isArray(board.terrain))
    throw new TypeError('INVALID_SERVER_RANGED_BOARD');
  // Do not disclose to a different player whether an ID is an opposing unit
  // or missing. Detailed board/LOS results must not be exposed over HTTP.
  const attacker = board.units.find(unit => unit?.id === attackerId);
  if (!attacker || attacker.side !== sessionSide)
    return freeze('BLOCKED', 'UNIT_NOT_ELIGIBLE', {turnGate});

  const ranged = precheckAncientsRangedAttack({
    units:board.units, leaders:board.leaders, terrain:board.terrain,
    attackerId, targetId, movedSteps:turnGate.movedSteps
  });
  return freeze(ranged.status, ranged.reason, {turnGate, ranged});
}
