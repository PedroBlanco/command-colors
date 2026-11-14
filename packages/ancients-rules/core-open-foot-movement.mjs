/**
 * Ancients 3e (2009) — restricted, pure foot movement transition.
 *
 * RULE-CHECKED STATE PROPOSAL ONLY. This is distinct from the LAB staged
 * CANDIDATE prechecks and never accepts one as authority. It is not an
 * authenticated game action: the server must construct ALL inputs from a
 * replay-verified match, perform full phase/card/scenario checks under
 * BEGIN IMMEDIATE, and atomically persist commands/events before any move
 * may be called confirmed.
 *
 * V1 intentionally excludes all leaders, terrain, card/scenario exceptions,
 * combat, retreats, and anything other than one adjacent foot-unit hex.
 */
import {inBounds} from '../hex-grid/hex.mjs';
import {ANCIENTS_RULESET,BASE_MOVEMENT_PROFILES} from './movement-profile.mjs';
import {assessAncientsMovementRegime,assessOpenHexStepGeometry}
  from './movement-regimes.mjs';

export const CORE_OPEN_FOOT_KIND='ANCIENTS_OPEN_FOOT_MOVEMENT_CORE_V1';
export const CORE_OPEN_FOOT_POLICY='BASE_FOOT_OPEN_ONE_HEX_V1';

const ID=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SIDES=new Set(['A','B']);
const guard=Object.freeze({
  movementAuthorized:false,officialMovementAuthorized:false,
  attackAuthorized:false,canCommit:false,dbChanged:false,
  needsServerTransaction:true
});
const fail=(reason,step=null)=>Object.freeze({
  status:'BLOCKED',reason,step,nextState:null,transition:null,...guard
});
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,fields)=>record(x)&&Reflect.ownKeys(x).length===fields.length&&
  fields.every(k=>Object.hasOwn(x,k));
const id=x=>typeof x==='string'&&ID.test(x)&&x!=='__proto__';
const validCell=x=>exact(x,['col','row'])&&Number.isSafeInteger(x.col)&&
  Number.isSafeInteger(x.row)&&inBounds(x);
const xy=x=>x.col+','+x.row;
const copy=x=>structuredClone(x);
const freeze=x=>{
  if(x!==null&&typeof x==='object'){
    for(const value of Object.values(x))freeze(value);
    Object.freeze(x);
  }
  return x;
};

/** Server-only state: a minimal movement phase projection, not the lab journal.
 * Issued orders remain issued: movedUnitIds marks the once-per-turn limit. */
function validState(s){
  if(!exact(s,['kind','schemaVersion','ruleset','revision','turn','phase',
      'board','orderLedger'])||
     s.kind!==CORE_OPEN_FOOT_KIND||s.schemaVersion!==1||
     s.ruleset!==ANCIENTS_RULESET||
     !Number.isSafeInteger(s.revision)||s.revision<0||
     !SIDES.has(s.turn)||s.phase!=='MOVE'||
     !exact(s.board,['units','leaders'])||!Array.isArray(s.board.units)||
     s.board.units.length<1||s.board.units.length>117||
     !Array.isArray(s.board.leaders)||s.board.leaders.length!==0||
     !exact(s.orderLedger,['issuedUnitIds','movedUnitIds'])||
     !Array.isArray(s.orderLedger.issuedUnitIds)||
     !Array.isArray(s.orderLedger.movedUnitIds))
    return false;

  const units=s.board.units,ids=new Set(),positions=new Set();
  for(const u of units){
    if(!exact(u,['id','side','col','row'])||!id(u.id)||!SIDES.has(u.side)||
       !validCell({col:u.col,row:u.row})||ids.has(u.id)||positions.has(xy(u)))
      return false;
    ids.add(u.id);positions.add(xy(u));
  }
  const issued=s.orderLedger.issuedUnitIds,moved=s.orderLedger.movedUnitIds;
  if(issued.length>117||moved.length>issued.length||
     issued.some(x=>!id(x)||!units.some(u=>u.id===x&&u.side===s.turn))||
     new Set(issued).size!==issued.length||
     moved.some(x=>!issued.includes(x))||new Set(moved).size!==moved.length)
    return false;
  return true;
}

/** A policy is supplied by trusted server code only. Excluding exceptions
 * prevents a standard step from accidentally bypassing a special scenario. */
function validPolicy(policy,state){
  if(!exact(policy,['scope','ruleset','cardFamily','terrain',
    'scenarioExceptions','unitTypes'])||
    policy.scope!==CORE_OPEN_FOOT_POLICY||
    policy.ruleset!==ANCIENTS_RULESET||
    policy.cardFamily!=='ORDINARY_SECTION'||
    !Array.isArray(policy.terrain)||policy.terrain.length!==0||
    !Array.isArray(policy.scenarioExceptions)||
    policy.scenarioExceptions.length!==0||!record(policy.unitTypes))
    return false;
  const units=state.board.units,types=policy.unitTypes;
  if(Reflect.ownKeys(types).length!==units.length)return false;
  return units.every(u=>Object.hasOwn(types,u.id)&&
    typeof types[u.id]==='string'&&
    Object.hasOwn(BASE_MOVEMENT_PROFILES,types[u.id]));
}

/** Apply one restricted step into a DETACHED state projection. This function
 * never reads session tokens, a candidate journal or a purported proof from
 * the browser. It does not emit ANCIENTS_MOVEMENT_COMMITTED_V1.
 */
export function reduceCoreOpenFootStep({state,action,policy}={}){
  try {
    if(!validState(state))return fail('INVALID_CORE_MOVEMENT_STATE');
    if(!validPolicy(policy,state))return fail('UNSUPPORTED_CORE_MOVEMENT_SCOPE');
    if(!exact(action,['actor','expectedRevision','unitId','to'])||
      !SIDES.has(action.actor)||!Number.isSafeInteger(action.expectedRevision)||
      action.expectedRevision<0||!id(action.unitId)||!validCell(action.to))
      return fail('INVALID_CORE_MOVEMENT_ACTION');
    if(action.expectedRevision!==state.revision)return fail('STALE_REVISION');
    if(action.actor!==state.turn)return fail('NOT_ACTING_PLAYER');
    const piece=state.board.units.find(u=>u.id===action.unitId);
    if(!piece||piece.side!==state.turn||
       !state.orderLedger.issuedUnitIds.includes(action.unitId))
      return fail('UNIT_NOT_ORDERED');
    if(state.orderLedger.movedUnitIds.includes(piece.id))
      return fail('UNIT_ALREADY_MOVED');
    // The ruleset profile chooses a regime; one shared geometry primitive
    // handles ordinary adjacency/occupancy for every type. This restricted
    // core preserves the original six-type policy while broader regimes
    // remain explicitly unsupported until their rules are implemented.
    const regime=assessAncientsMovementRegime({
      unitType:policy.unitTypes[piece.id],steps:1
    });
    if(regime.status!=='SUBSET_ELIGIBLE')
      return fail('UNSUPPORTED_FOOT_UNIT');
    const geometry=assessOpenHexStepGeometry({
      from:piece,to:action.to,occupiedCells:state.board.units
    });
    if(geometry.status!=='CANDIDATE_GEOMETRY')
      return fail(geometry.reason);
    if(state.revision===Number.MAX_SAFE_INTEGER)
      return fail('REVISION_EXHAUSTED');

    const next=copy(state);
    const unit=next.board.units.find(u=>u.id===action.unitId);
    const from={col:unit.col,row:unit.row};
    unit.col=action.to.col;unit.row=action.to.row;
    next.orderLedger.movedUnitIds.push(unit.id);
    next.revision++;
    if(!validState(next))return fail('INVALID_CORE_MOVEMENT_RESULT');

    return freeze({
      status:'RULE_TRANSITION_CANDIDATE',reason:null,step:null,
      nextState:next,
      transition:{
        kind:'BASE_FOOT_OPEN_STEP_PROPOSAL_V1',
        side:action.actor,revision:next.revision,
        unitId:unit.id,from,to:copy(action.to)
      },
      ...guard
    });
  } catch {
    // All failures are detached, and expose no partial nextState.
    return fail('INVALID_CORE_MOVEMENT_INPUT');
  }
}

/** Rebuild a proposed phase from a trusted starting state and a sequence of
 * minimal actions. Rejected actions make the WHOLE replay fail atomically. */
export function replayCoreOpenFootSteps({initialState,actions,policy}={}){
  const denied=(reason,step)=>Object.freeze({
    status:'BLOCKED',reason,step,nextState:null,transitions:null,...guard
  });
  try {
    if(!validState(initialState))return denied('INVALID_CORE_MOVEMENT_STATE',null);
    if(!validPolicy(policy,initialState))return denied('UNSUPPORTED_CORE_MOVEMENT_SCOPE',null);
    if(!Array.isArray(actions)||actions.length>117)return denied('INVALID_CORE_REPLAY',null);
    let current=initialState;
    const transitions=[];
    for(let index=0;index<actions.length;index++){
      const result=reduceCoreOpenFootStep({state:current,action:actions[index],policy});
      if(result.status!=='RULE_TRANSITION_CANDIDATE')
        return denied(result.reason,index);
      current=result.nextState;
      transitions.push(result.transition);
    }
    return freeze({
      status:'RULE_REPLAY_CANDIDATE',reason:null,step:null,
      nextState:copy(current),transitions,...guard
    });
  } catch {
    return denied('INVALID_CORE_REPLAY',null);
  }
}
