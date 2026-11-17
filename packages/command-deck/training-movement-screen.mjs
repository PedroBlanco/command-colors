/**
 * Optional, SERVER-SIDE conservative screen for the VERSIONED synthetic
 * training fixture. It narrows accepted synthetic moves; it never grants an
 * Ancients authorization, combat or any card/leader/retreat exception.
 *
 * Run ONLY after the normal authenticated phase/order/occupancy/path reducer
 * accepts the candidate and BEFORE committing its SQLite transaction.
 * Earlier matches with no versioned scenario keep the legacy lab contract.
 */
import {assessBaseMovement,BASE_MOVEMENT_PROFILES} from '../ancients-rules/movement-profile.mjs';
import {createServerSyntheticMovementPolicy} from '../movement/server-policy.mjs';
import {assessAncientsTerrainMovement} from '../ancients-rules/terrain-movement.mjs';
import {projectTrainingReference} from './training-reference.mjs';

const fail=reason=>Object.freeze({accepted:false,reason,
  needsFullLegalityCheck:true,attackAuthorized:false});
const pass=status=>Object.freeze({accepted:true,status,
  needsFullLegalityCheck:true,attackAuthorized:false,
  movementAuthorizedByAncients:false});

/**
 * Trusted state only: the command has ALREADY passed
 * transitionSyntheticMovement(). No input field comes from a client-side
 * unit type, terrain tile or movement allowance.
 */
export function screenVersionedTrainingMove(state,command){
  if(!state||typeof state!=='object'||Array.isArray(state)||
     !Array.isArray(state.board)||!command||typeof command!=='object')
    throw new TypeError('INVALID_TRAINING_MOVE_SCREEN');
  if(!Object.hasOwn(state,'trainingReference'))
    return pass('SKIPPED_LEGACY');
  const publicReference=projectTrainingReference(state);
  if(!publicReference?.scenario) // pre-v137 training annotation: no behavior change
    return pass('SKIPPED_LEGACY');
  const unit=state.board.find(u=>u.id===command.unitId);
  if(!unit||!['A','B'].includes(unit.side)||
     !Array.isArray(command.path)||command.path.length<1||
     !Array.isArray(publicReference.terrain))
    throw new TypeError('INVALID_TRAINING_MOVE_SCREEN');
  const unitType=publicReference.unitTypes[unit.id];
  if(!unitType)throw new TypeError('INVALID_TRAINING_MOVE_SCREEN');
  const profile=assessBaseMovement({unitType,steps:command.path.length});
  if(profile.status==='EXCEEDS_STANDARD_PROFILE')
    return fail('TRAINING_TROOP_RANGE_EXCEEDED');
  // A Warrior's second step depends on compulsory close combat. The
  // synthetic reducer cannot guarantee that follow-up, so deny rather than
  // silently treating it as an ordinary legal Ancients move.
  if(profile.status==='CONDITIONAL_CHARGE')
    return fail('TRAINING_CONDITIONAL_CHARGE_UNSUPPORTED');
  const terrain=assessAncientsTerrainMovement({
    unitType,origin:{col:unit.col,row:unit.row},
    path:command.path,terrain:publicReference.terrain
  });
  if(terrain.status==='BLOCKED')
    return fail('TRAINING_TERRAIN_RESTRICTED');
  // battleOnEntry is deliberately NOT authorization to fight. That phase
  // is still synthetic and does not implement the complete Ancients rules.
  return pass('TRAINING_BASE_MOVEMENT_SCREEN_PASSED');
}

/**
 * Build the *only* policy passed to the authoritative synthetic reducer.
 *
 * For VERSIONED exercises, let the normal reducer inspect complete cavalry
 * paths of 3/4 hexes. The follow-on Ancients training screen still rejects
 * anything exceeding a unit's base profile, or conflicting with terrain.
 * Preserve the previous two-step ceiling for legacy matches and as a
 * preliminary (non-authorizing) ceiling for every versioned unit. This
 * preserves existing error-code sequencing for slower troops: the training
 * screen returns TRAINING_TROOP_RANGE_EXCEEDED instead of the legacy
 * MOVEMENT_LIMIT_EXCEEDED, after the phase/occupancy reducer has run.
 *
 * Never derive movement policy from incoming command fields or client hints.
 */
export function createServerTrainingMovementPolicy(state){
  if(!state||typeof state!=='object'||Array.isArray(state)||
      !Array.isArray(state.board))
    throw new TypeError('INVALID_TRAINING_MOVE_POLICY');
  const base=createServerSyntheticMovementPolicy(state.board);
  if(!Object.hasOwn(state,'trainingReference'))return base;
  const reference=projectTrainingReference(state);
  if(!reference?.scenario)return base;
  for(const unit of state.board){
    const type=reference.unitTypes[unit.id];
    const profile=Object.hasOwn(BASE_MOVEMENT_PROFILES,type)?
      BASE_MOVEMENT_PROFILES[type]:null;
    if(!profile)throw new TypeError('INVALID_TRAINING_MOVE_POLICY');
    base.maxStepsByUnit[unit.id]=Math.max(base.maxStepsByUnit[unit.id],
      profile.maxSteps);
  }
  return base;
}
