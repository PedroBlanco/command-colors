/**
 * Derive a READ-ONLY block-loss preview from one authoritative turn/board snapshot.
 * This laboratory helper never authorizes a battle, applies casualties or awards a banner.
 * Caller MUST read both objects from the same SQLite transaction/revision.
 */
import {inBounds} from '../hex-grid/hex.mjs';
import {ANCIENTS_RULESET} from './movement-profile.mjs';
import {classifyRangedDicePlan} from './dice-plan.mjs';
import {interpretBaseAncientsRangedDice} from './battle-dice.mjs';
import {previewBaseAncientsRangedBlockLoss} from './block-loss-preview.mjs';

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail = () => {throw new TypeError('INVALID_STAGED_BLOCK_SNAPSHOT');};
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const validId = x => typeof x === 'string' && ID.test(x);
const validPiece = p => obj(p) && validId(p.id) && ['A','B'].includes(p.side) && inBounds(p);
const hex = p => `${p.col},${p.row}`;

/**
 * The caller must provide sessionSide from the authenticated participant. The
 * roll, its original target and the target's blocks/leader all come from SQLite.
 * Extra request parameters cannot influence this function.
 */
export function deriveStagedAncientsRangedBlockLoss({turnState, board, sessionSide,
  reservationId, expectedRevision} = {}) {
  if (!obj(turnState) || !obj(board) || !['A','B'].includes(sessionSide) ||
      typeof reservationId !== 'string' || !UUID.test(reservationId) ||
      !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
      turnState.ruleset !== ANCIENTS_RULESET || turnState.schemaVersion !== 1 ||
      turnState.revision !== expectedRevision || turnState.status !== 'ACTIVE' ||
      turnState.turn !== sessionSide || turnState.phase !== 'COMBAT' ||
      turnState.pendingDecision !== null || !Array.isArray(turnState.orderedUnitIds) ||
      !Array.isArray(turnState.resolvedBattleUnitIds)) fail();
  const marker = turnState.pendingCombat;
  if (!obj(marker) || marker.kind !== 'RANGED_DICE_STAGED_OFFICIAL_PREVIEW' ||
      marker.actor !== sessionSide || marker.reservationId !== reservationId ||
      marker.fullValidationRequired !== true || !validId(marker.attackerId) ||
      !validId(marker.targetId) || marker.attackerId === marker.targetId ||
      !turnState.orderedUnitIds.includes(marker.attackerId) ||
      turnState.resolvedBattleUnitIds.includes(marker.attackerId) ||
      classifyRangedDicePlan(marker.dicePlan) !== 'OFFICIAL_PREVIEW') fail();

  if (!Array.isArray(board.units) || board.units.length < 2 || board.units.length > 117 ||
      !Array.isArray(board.leaders) || board.leaders.length > 117) fail();
  const unitsById = new Map(), cells = new Set();
  for (const unit of board.units) {
    if (!validPiece(unit) || unitsById.has(unit.id) || cells.has(hex(unit))) fail();
    unitsById.set(unit.id, unit);
    cells.add(hex(unit));
  }
  const attacker = unitsById.get(marker.attackerId);
  const target = unitsById.get(marker.targetId);
  if (!attacker || !target || attacker.side !== sessionSide ||
      target.side === sessionSide || target.type !== marker.dicePlan.targetUnitType) fail();

  const leaderIds = new Set(), leaderCells = new Set();
  let leaderAttached = false;
  for (const leader of board.leaders) {
    if (!validPiece(leader) || unitsById.has(leader.id) || leaderIds.has(leader.id) ||
        leaderCells.has(hex(leader))) fail();
    leaderIds.add(leader.id);
    leaderCells.add(hex(leader));
    // A leader in the target's hex is attached to that unit, not its attacker.
    if (hex(leader) === hex(target)) {
      if (leader.side !== target.side) fail();
      leaderAttached = true;
    } else if (cells.has(hex(leader)) &&
        board.units.find(u => hex(u) === hex(leader)).side !== leader.side) fail();
  }

  const roll = marker.stagedDice;
  if (!obj(roll) || roll.actor !== sessionSide ||
      roll.rollId !== `roll_${reservationId.replaceAll('-','')}`) fail();
  let interpretation, preview;
  try {
    interpretation = interpretBaseAncientsRangedDice({
      roll, targetUnitType:target.type, expectedDiceCount:marker.dicePlan.diceCount
    });
    // Protect against cached results drifting away from the stored dice.
    if (JSON.stringify(interpretation) !== JSON.stringify(marker.previewInterpretation)) fail();
    preview = previewBaseAncientsRangedBlockLoss({
      unitType:target.type, blocksRemaining:target.blocksRemaining,
      diceCount:interpretation.diceCount,
      matchingColorHits:interpretation.matchingColorHits,
      flagsPending:interpretation.flagsPending, leaderAttached
    });
  } catch {fail();}
  return preview;
}
