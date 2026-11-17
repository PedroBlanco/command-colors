/**
 * Authenticated SQLite training ledger: exact movement-step counts, held only
 * for VERSIONED synthetic scenarios. Never trust browser step counts.
 *
 * Legacy matches and old in-progress versioned matches have no ledger;
 * absence is NOT evidence that a unit remained stationary.
 */
import {projectTrainingReference} from './training-reference.mjs';
import {BASE_MOVEMENT_PROFILES} from '../ancients-rules/movement-profile.mjs';
import {precheckAncientsRangedAttack} from '../ancients-rules/ranged-precheck.mjs';

const invalid=()=>{throw new TypeError('INVALID_TRAINING_MOVEMENT_LEDGER');};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const goodSide=x=>x==='A'||x==='B';
const goodId=x=>typeof x==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(x);
const ledgerObject=x=>plain(x)&&
  Object.keys(x).length===4&&
  ['schemaVersion','scenarioId','turn','stepsByUnit'].every(k=>Object.hasOwn(x,k));

export function createTrainingMovementLedger(state){
  const ref=projectTrainingReference(state);
  if(!ref?.scenario)return null;
  if(!goodSide(state?.commandSession?.phaseState?.turn)||
      !Array.isArray(state.movedUnitIds)||state.movedUnitIds.length!==0)
    invalid();
  return {
    schemaVersion:1,scenarioId:ref.scenario.id,
    turn:state.commandSession.phaseState.turn,
    stepsByUnit:Object.fromEntries(state.board.map(u=>[u.id,0]))
  };
}

/**
 * Returns a validated, detached snapshot, or null if no record exists.
 * Do not infer a default 0 on a missing or corrupt ledger.
 */
export function readTrainingMovementLedger(state){
  if(!state||typeof state!=='object'||Array.isArray(state))invalid();
  if(!Object.hasOwn(state,'trainingMovementLedger'))return null;
  const r=state.trainingMovementLedger,ref=projectTrainingReference(state);
  const turn=state.commandSession?.phaseState?.turn;
  if(!ledgerObject(r)||r.schemaVersion!==1||
      !ref?.scenario||r.scenarioId!==ref.scenario.id||
      !goodSide(r.turn)||r.turn!==turn||!plain(r.stepsByUnit)||
      !Array.isArray(state.movedUnitIds)||state.movedUnitIds.length>117)
    invalid();
  const ownSteps=Object.keys(r.stepsByUnit);
  const board=state.board;
  if(!Array.isArray(board)||ownSteps.length!==board.length||
      new Set(state.movedUnitIds).size!==state.movedUnitIds.length)
    invalid();
  const moved=new Set(state.movedUnitIds),ids=new Set();
  for(const unit of board){
    if(!goodId(unit?.id)||!goodSide(unit.side)||ids.has(unit.id)||
       !Object.hasOwn(r.stepsByUnit,unit.id))invalid();
    ids.add(unit.id);
    const profile=BASE_MOVEMENT_PROFILES[ref.unitTypes[unit.id]];
    const steps=r.stepsByUnit[unit.id];
    if(!profile||!Number.isSafeInteger(steps)||steps<0||
        steps>profile.maxSteps||
        (steps>0)!==moved.has(unit.id)||
        (steps>0&&unit.side!==r.turn))invalid();
  }
  if(ownSteps.some(id=>!ids.has(id))||
     [...moved].some(id=>!ids.has(id)))invalid();
  return {schemaVersion:1,scenarioId:r.scenarioId,turn:r.turn,
    stepsByUnit:{...r.stepsByUnit}};
}

/** Called BEFORE applying an otherwise accepted server movement transition. */
export function recordTrainingMovementLedger(state,unitId,steps){
  const r=readTrainingMovementLedger(state);
  if(!r)return null;
  const unit=state.board.find(u=>u.id===unitId);
  if(!unit||unit.side!==r.turn||!Number.isSafeInteger(steps)||
     steps<1||steps>32||r.stepsByUnit[unitId]!==0||
     state.movedUnitIds.includes(unitId))invalid();
  return {...r,stepsByUnit:{...r.stepsByUnit,[unitId]:steps}};
}

/** Called BEFORE replacing the command session with the next-turn snapshot. */
export function resetTrainingMovementLedger(state,nextTurn){
  const r=readTrainingMovementLedger(state);
  if(!r)return null;
  if(!goodSide(nextTurn)||nextTurn===r.turn)invalid();
  return {...r,turn:nextTurn,
    stepsByUnit:Object.fromEntries(state.board.map(u=>[u.id,0]))};
}

/**
 * Authenticated, read-only RANGED opportunities only. It does not produce a
 * command, an attack authorization, a die roll, damage or a combat event.
 * No shots are projected for a legacy game without trusted movement history.
 */
export function projectTrainingRangedHints(state,viewer){
  const r=readTrainingMovementLedger(state);
  if(!r)return null;
  if(!goodSide(viewer))return null;
  const phase=state.commandSession?.phaseState;
  if(!phase||phase.phase!=='COMBAT'||phase.turn!==viewer||
      phase.pendingDecision!==null)return {
    status:'NOT_CURRENT_COMBAT_PHASE',candidates:[],
    attackAuthorized:false,canCommit:false
  };
  const ref=projectTrainingReference(state);
  if(!Array.isArray(phase.orderedUnits)||phase.orderedUnits.length>117||
     new Set(phase.orderedUnits).size!==phase.orderedUnits.length)invalid();
  const actors=phase.orderedUnits.filter(id=>
    state.board.some(u=>u.id===id&&u.side===viewer));
  const units=state.board.map(u=>({...u,type:ref.unitTypes[u.id]}));
  const opponents=units.filter(u=>u.side!==viewer);
  const candidates=[];
  for(const attackerId of actors)for(const target of opponents){
    const result=precheckAncientsRangedAttack({
      units,leaders:[],terrain:ref.terrain,
      attackerId,targetId:target.id,movedSteps:r.stepsByUnit[attackerId]
    });
    if(result.status!=='CANDIDATE')continue;
    candidates.push({attackerId,targetId:target.id,
      distance:result.distance,diceAfterTerrain:result.diceAfterTerrain,
      attackerSteps:r.stepsByUnit[attackerId]});
  }
  return {status:'REFERENCE_ONLY',candidates,
    attackAuthorized:false,canCommit:false,
    leadersChecked:false,commandCardChecked:false};
}
