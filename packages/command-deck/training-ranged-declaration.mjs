/**
 * Read-only server-side evaluation of an EXPLICIT ranged declaration.
 * Uses the authenticated player's side, persisted step ledger, ordered units,
 * public board and server scenario. It never resolves or authorizes combat.
 * This is the lab's synthetic COMBAT phase, NOT an official Ancients turn.
 */
import {projectTrainingReference} from './training-reference.mjs';
import {readTrainingMovementLedger} from './training-ranged-ledger.mjs';
import {precheckAncientsRangedAttack} from '../ancients-rules/ranged-precheck.mjs';

const ID=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const goodId=id=>typeof id==='string'&&ID.test(id);
const unavailable=(reason,revision)=>Object.freeze({
  status:'BLOCKED',reason,revision,
  attackAuthorized:false,canCommit:false,combatRecorded:false
});

/** The state and authenticated actor MUST come from one SQLite transaction. */
export function checkTrainingRangedDeclaration(state,{actor,attackerId,targetId,expectedRevision}={}){
  const phase=state?.commandSession?.phaseState;
  if(!phase||!Number.isSafeInteger(phase.revision)||
      !Number.isSafeInteger(expectedRevision)||expectedRevision<0||
      !goodId(attackerId)||!goodId(targetId)||attackerId===targetId)
    return unavailable('INVALID_TRAINING_DECLARATION',phase?.revision??null);
  const revision=phase.revision;
  // Never disclose a target, terrain or movement record to the non-actor or
  // a stale request. The gateway/SQLite adapter authenticates the actor.
  if(actor!==phase.turn||phase.pendingDecision!==null)
    return unavailable('NOT_ACTING_PLAYER',revision);
  if(expectedRevision!==revision)
    return unavailable('STALE_REVISION',revision);
  if(phase.phase!=='COMBAT')
    return unavailable('WRONG_PHASE',revision);
  if(!Array.isArray(phase.orderedUnits)||phase.orderedUnits.length>117||
      !phase.orderedUnits.every(goodId)||
      new Set(phase.orderedUnits).size!==phase.orderedUnits.length)
    throw new TypeError('INVALID_TRAINING_DECLARATION_STATE');
  // Missing history is unknown, never zero moved steps. No pre-140 snapshot
  // gains extra permissions and there is no server fall-back to browser input.
  const ledger=readTrainingMovementLedger(state);
  if(!ledger)return unavailable('NO_TRUSTED_MOVEMENT_LEDGER',revision);
  const reference=projectTrainingReference(state);
  if(!reference?.scenario)return unavailable('NO_VERSIONED_SCENARIO',revision);
  const board=state.board;
  const attacker=board.find(u=>u.id===attackerId);
  if(!phase.orderedUnits.includes(attackerId)||
      !attacker||attacker.side!==actor)
    return unavailable('UNIT_NOT_ELIGIBLE',revision);
  const target=board.find(u=>u.id===targetId);
  if(!target||target.side===actor)
    return unavailable('TARGET_NOT_ELIGIBLE',revision);
  const result=precheckAncientsRangedAttack({
    units:board.map(u=>({...u,type:reference.unitTypes[u.id]})),
    leaders:[],terrain:reference.terrain,
    attackerId,targetId,movedSteps:ledger.stepsByUnit[attackerId]
  });
  const base={attackerId,targetId,revision,
    attackerSteps:ledger.stepsByUnit[attackerId],
    attackAuthorized:false,canCommit:false,combatRecorded:false,
    leadersChecked:false,commandCardChecked:false};
  if(result.status!=='CANDIDATE')
    return Object.freeze({...base,status:'BLOCKED',reason:result.reason});
  return Object.freeze({...base,status:'CANDIDATE',reason:null,
    distance:result.distance,range:result.range,
    baseDice:result.baseDice,diceAfterTerrain:result.diceAfterTerrain});
}
