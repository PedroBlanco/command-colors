/**
 * LAB-ANC: deterministic one-hex unit reducer for a SYNTHETIC, EMPTY-TERRAIN
 * laboratory board without leaders. Not the official Ancients move engine.
 *
 * Inputs must originate from an authenticated, replay-verified section lab.
 * The result is a frozen local board projection; it is NEVER stored, emitted
 * as a game_event, used to spend a command order or exposed by HTTP.
 */
import {precheckStagedAncientsMovementSequence} from './staged-movement-preflight.mjs';

export const CLEAR_LAB_POLICY='SYNTHETIC_OPEN_HEX_V1';
const ALLOWED=new Set([
  'LIGHT_INFANTRY','LIGHT_SLING_INFANTRY','LIGHT_BOW_INFANTRY',
  'AUXILIA_INFANTRY','MEDIUM_INFANTRY','HEAVY_INFANTRY'
]);
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  Object.getPrototypeOf(x)===Object.prototype;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const cell=p=>({col:p.col,row:p.row});
const readonly=x=>{
  if(x&&typeof x==='object'){
    for(const v of Object.values(x))readonly(v);
    Object.freeze(x);
  }
  return x;
};
const refuse=reason=>Object.freeze({
  status:'BLOCKED',reason,simulatedBoard:null,moves:null,
  labSimulationOnly:true,canCommit:false,officialMovementAuthorized:false,
  movementAuthorized:false,attackAuthorized:false,stateChanged:false,
  needsFullLegalityCheck:true
});

/**
 * `policy` and `serverContext` MUST be selected by trusted server code.
 * A browser-supplied policy is never proof of an official clear-ground
 * scenario. Deliberately excludes all leaders, special orders and terrain.
 */
export function reduceOneHexClearLab({
  state,actor,expectedRevision,actions,serverContext,policy
}={}) {
  if(!record(policy)||Object.keys(policy).length!==1||
     policy.scope!==CLEAR_LAB_POLICY)
    return refuse('NOT_IN_CLEAR_LAB_SCOPE');
  if(!record(serverContext)||!record(serverContext.unitTypes)||
     !Array.isArray(serverContext.terrain)||
     serverContext.terrain.length!==0)
    return refuse('TERRAIN_NOT_IN_CLEAR_LAB_SCOPE');
  if(!record(state)||!record(state.board)||!Array.isArray(state.board.units)||
     !Array.isArray(state.board.leaders)||state.board.leaders.length!==0)
    return refuse('LEADERS_NOT_IN_CLEAR_LAB_SCOPE');
  if(!state.board.units.every(unit=>own(serverContext.unitTypes,unit.id)&&
     ALLOWED.has(serverContext.unitTypes[unit.id]))||
     Object.keys(serverContext.unitTypes).length!==state.board.units.length)
    return refuse('UNSUPPORTED_CLEAR_LAB_UNIT');
  if(!Array.isArray(actions)||actions.length<1||actions.length>117||
     !actions.every(a=>record(a)&&Object.keys(a).length===3&&
       own(a,'kind')&&own(a,'id')&&own(a,'path')&&a.kind==='UNIT'&&
       Array.isArray(a.path)&&a.path.length===1))
    return refuse('ONLY_ONE_HEX_UNIT_MOVES_SUPPORTED');
  const screened=precheckStagedAncientsMovementSequence({
    state,actor,expectedRevision,actions,serverContext
  });
  if(screened.status!=='CANDIDATE_SEQUENCE')
    return refuse(screened.reason??'REQUIRES_RULE_EXCEPTION');
  // Reconstruct the result from the original board only after EVERY route
  // has passed staged order, movement, occupancy and terrain checks.
  const board=structuredClone(state.board);
  const moves=[];
  for(const move of screened.steps){
    const unit=board.units.find(x=>x.id===move.id&&x.side===actor);
    if(!unit||unit.col!==move.from.col||unit.row!==move.from.row)
      return refuse('LAB_REDUCTION_POSITION_DRIFT');
    const origin=cell(unit),destination=cell(move.to);
    unit.col=destination.col;unit.row=destination.row;
    moves.push({unitId:unit.id,from:origin,to:destination});
  }
  return readonly({
    status:'LAB_REDUCTION_CANDIDATE',reason:null,
    simulatedBoard:board,moves,moveCount:moves.length,
    labSimulationOnly:true,canCommit:false,officialMovementAuthorized:false,
    movementAuthorized:false,attackAuthorized:false,stateChanged:false,
    needsFullLegalityCheck:true
  });
}
