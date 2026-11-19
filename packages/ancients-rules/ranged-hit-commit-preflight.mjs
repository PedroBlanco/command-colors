/**
 * Non-executable write-set preflight for a future authorized Ancients combat executor.
 * This is intentionally NOT a permission token or a commit operation. Every proposed
 * effect must be revalidated inside the eventual SQLite write transaction.
 */
import {deriveStagedAncientsRangedBlockLoss} from './ranged-block-snapshot.mjs';
import {planBaseAncientsRangedResolution} from './ranged-resolution-sequence.mjs';
import {precheckAncientsRangedDeclaration} from './ranged-turn-precheck.mjs';
import {createRangedDicePlan} from './dice-plan.mjs';

const invalid=()=>{throw new TypeError('INVALID_RANGED_HIT_PREFLIGHT');};
const record=x=>x!==null && typeof x==='object' && !Array.isArray(x);
const frozen=x=>Object.freeze(x);

/**
 * All arguments must originate from the same authenticated SQLite snapshot.
 * A caller-supplied board is NOT an authority to execute the returned plan.
 */
export function preflightStagedAncientsRangedHits({turnState,board,sessionSide,
  reservationId,expectedRevision}={}) {
  let loss,checklist;
  try {
    loss=deriveStagedAncientsRangedBlockLoss({
      turnState,board,sessionSide,reservationId,expectedRevision
    });
    checklist=planBaseAncientsRangedResolution({blockLoss:loss});
  } catch {invalid();}
  const marker=turnState.pendingCombat;
  // The staged roll is bound to board bytes, but not by itself to *legal* LOS,
  // range, movement or the correct terrain-limited dice count. Re-run the
  // existing non-authorizing screening on a copy of this same saved snapshot.
  // Replacing pendingCombat with null is for the screening contract ONLY:
  // the original staged marker remains mandatory for dice/hit derivation.
  const screeningTurn={...turnState,pendingCombat:null};
  let screened,freshPlan;
  try {
    screened=precheckAncientsRangedDeclaration({
      turnState:screeningTurn,board,sessionSide,
      attackerId:marker.attackerId,targetId:marker.targetId,
      expectedRevision
    });
    if (screened?.status!=='CANDIDATE' ||
        screened.attackAuthorized!==false ||
        screened.needsFullLegalityCheck!==true ||
        screened.ranged?.status!=='CANDIDATE' ||
        screened.ranged.attackAuthorized!==false ||
        screened.ranged.lineOfSightChecked!==true ||
        screened.ranged.rangedProfileChecked!==true) invalid();
    freshPlan=createRangedDicePlan({
      mode:'OFFICIAL_PREVIEW',screening:screened,board,targetId:marker.targetId
    });
    if (!freshPlan || JSON.stringify(freshPlan)!==JSON.stringify(marker.dicePlan)) invalid();
  } catch {invalid();}

  if (!record(marker) || !Array.isArray(board.units) ||
      !Number.isSafeInteger(expectedRevision) || expectedRevision<0) invalid();
  const targets=board.units.filter(unit=>unit?.id===marker.targetId);
  if (targets.length!==1) invalid();
  const target=targets[0];
  if (target.blocksRemaining!==loss.originalBlocks ||
      target.type!==loss.unitType || target.side===sessionSide) invalid();

  const removes=loss.blocksToRemove;
  const nextRevision=expectedRevision+1;
  if (!Number.isSafeInteger(nextRevision)) invalid();
  const requiresLeaderCheck=loss.leaderCasualtyCheck!==null;
  const nextPhase=requiresLeaderCheck?'LEADER_CASUALTY_CHECK':
    loss.unitWouldBeEliminated?'AUTHORITATIVE_FINALIZATION':
    loss.effectiveFlagsPending>0?'DEFENDER_MORALE_CHOICE':'AUTHORITATIVE_FINALIZATION';

  // This is a proposal, not an event: target removal and banner allocation are
  // explicitly excluded until the full rules engine validates the sequence.
  return frozen({
    kind:'ANCIENTS_RANGED_HIT_COMMIT_PREFLIGHT',schemaVersion:1,
    matchRevision:expectedRevision,proposedNextRevision:nextRevision,
    reservationId,actor:sessionSide,attackerId:marker.attackerId,
    targetId:marker.targetId,unitType:target.type,
    previousBlocks:loss.originalBlocks,proposedBlocksAfterHits:loss.remainingBlocks,
    proposedBlocksRemoved:removes,excessHits:loss.excessHits,
    unitWouldBeEliminated:loss.unitWouldBeEliminated,
    proposedNextPhase:nextPhase,
    leaderCheckRequired:requiresLeaderCheck,
    leaderCheckDiceCount:loss.leaderCasualtyCheck?.diceCount??0,
    flagsStillPending:loss.effectiveFlagsPending,
    // A fresh screening is useful evidence, NEVER an attack authorization.
    screeningRechecked:true,
    recheckedDiceCount:freshPlan.diceCount,
    commandCardValidated:false,scenarioExceptionsChecked:false,
    fullRulesValidated:false,attackAuthorized:false,
    commitPermitted:false,boardMutated:false,unitRemoved:false,
    leaderRemoved:false,leaderCheckRolled:false,retreatResolved:false,
    victoryBannerAwarded:false,combatResolved:false,
    nextRequiredStep:checklist.nextRequiredStep,
    blockingReason:'FULL_RANGED_COMBAT_AUTHORIZATION_NOT_IMPLEMENTED'
  });
}
