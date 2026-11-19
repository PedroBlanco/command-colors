/**
 * LAB-ONLY immutable board effect for an already validated direct-hit preview.
 * NOT a combat authorization. Calling service must bind the preview to the
 * persisted roll, actor and board in one SQLite transaction.
 */
import {previewBaseAncientsRangedBlockLoss} from './block-loss-preview.mjs';

const fail = () => { throw new TypeError('INVALID_LAB_DIRECT_HIT_EFFECT'); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 32;
const key = v => `${v.col},${v.row}`;

export function prepareLabDirectHitEffect({board, targetId, preview} = {}) {
  if (!object(board) || !Array.isArray(board.units) || board.units.length < 2 ||
      board.units.length > 117 || !Array.isArray(board.leaders) ||
      board.leaders.length > 117 || typeof targetId !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(targetId) || !object(preview) ||
      preview.kind !== 'BASE_RANGED_BLOCK_LOSS_PREVIEW' ||
      preview.attackAuthorized !== false || preview.hitsApplied !== false ||
      preview.boardMutated !== false || preview.combatResolved !== false ||
      preview.bannerAwarded !== false || preview.flagsResolved !== false ||
      preview.leaderChecksResolved !== false || !count(preview.originalBlocks) ||
      preview.originalBlocks < 1 || !count(preview.matchingColorHits) ||
      !count(preview.blocksToRemove) || !count(preview.excessHits) ||
      !count(preview.remainingBlocks) || !count(preview.flagsRolled) ||
      !count(preview.effectiveFlagsPending) ||
      typeof preview.leaderAttached !== 'boolean' ||
      typeof preview.unitWouldBeEliminated !== 'boolean' ||
      preview.blocksToRemove !== Math.min(preview.originalBlocks,preview.matchingColorHits) ||
      preview.excessHits !== preview.matchingColorHits-preview.blocksToRemove ||
      preview.remainingBlocks !== preview.originalBlocks-preview.blocksToRemove ||
      preview.unitWouldBeEliminated !== (preview.remainingBlocks===0) ||
      preview.effectiveFlagsPending !== (preview.unitWouldBeEliminated ? 0 : preview.flagsRolled)) fail();

  // Prevent a fabricated summary from omitting official constraints or changing
  // unvalidated flags such as leader checks and possible victory banners.
  let canonical;
  try {canonical=previewBaseAncientsRangedBlockLoss({
    unitType:preview.unitType,blocksRemaining:preview.originalBlocks,
    diceCount:preview.diceCount,matchingColorHits:preview.matchingColorHits,
    flagsPending:preview.flagsRolled,leaderAttached:preview.leaderAttached
  });} catch {fail();}
  if(JSON.stringify(canonical)!==JSON.stringify(preview))fail();

  const ids = new Set(), positions = new Set();
  for (const unit of board.units) {
    if (!object(unit) || typeof unit.id !== 'string' || ids.has(unit.id) ||
        !['A','B'].includes(unit.side) || !Number.isSafeInteger(unit.col) ||
        !Number.isSafeInteger(unit.row) || positions.has(key(unit))) fail();
    ids.add(unit.id); positions.add(key(unit));
  }
  const matched = board.units.filter(u => u.id===targetId);
  if (matched.length!==1) fail();
  const target = matched[0];
  if (target.type!==preview.unitType || target.blocksRemaining!==preview.originalBlocks) fail();
  let attached = false;
  const leaderIds = new Set(), leaderHexes = new Set();
  for(const leader of board.leaders) {
    if (!object(leader) || typeof leader.id !== 'string' || ids.has(leader.id) ||
        leaderIds.has(leader.id) || !['A','B'].includes(leader.side) ||
        !Number.isSafeInteger(leader.col) || !Number.isSafeInteger(leader.row) ||
        leaderHexes.has(key(leader))) fail();
    leaderIds.add(leader.id); leaderHexes.add(key(leader));
    if (key(leader)===key(target)) {
      if (leader.side !== target.side) fail();
      attached=true;
    }
  }
  if (attached!==preview.leaderAttached) fail();
  if (preview.leaderCasualtyCheck !== null) {
    if (!attached || preview.blocksToRemove===0 ||
        !object(preview.leaderCasualtyCheck) ||
        preview.leaderCasualtyCheck.completed!==false ||
        preview.leaderCasualtyCheck.diceCount!==(preview.unitWouldBeEliminated?1:2)) fail();
  } else if(attached && preview.blocksToRemove>0) fail();

  const newBoard=structuredClone(board);
  const edited=newBoard.units.find(unit=>unit.id===targetId);
  if (preview.unitWouldBeEliminated) {
    newBoard.units=newBoard.units.filter(unit=>unit.id!==targetId);
  } else {
    edited.blocksRemaining=preview.remainingBlocks;
  }
  const nextRequiredStep = preview.leaderCasualtyCheck ? 'LEADER_CASUALTY_CHECK' :
    preview.effectiveFlagsPending>0 ? 'DEFENDER_MORALE_CHOICE' :
    'AUTHORITATIVE_FINALIZATION';
  return Object.freeze({
    kind:'LAB_DIRECT_HIT_EFFECT_PREPARED',board:newBoard,
    summary:Object.freeze({blocksRemoved:preview.blocksToRemove,
      unitEliminated:preview.unitWouldBeEliminated,
      flagsPending:preview.effectiveFlagsPending,
      leaderCheckRequired:preview.leaderCasualtyCheck!==null,
      nextRequiredStep}),
    // A test fixture can commit this delta; it has no official authorization.
    labOnly:true,attackAuthorized:false,combatResolved:false,
    bannerAwarded:false,flagsResolved:false,leaderChecksResolved:false
  });
}
