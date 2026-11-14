/**
 * Ancients base / #97 — versioned, NON-AUTHORIZING open-foot path reducer.
 *
 * V2 supports one or two ordinary infantry hexes as ONE movement action and
 * ONE hypothetical revision. Reuses the V1 reducer for turn, orders, board
 * and first-edge checks. Reuses the shared V2 path preview for all hexes and
 * the existing movement profiles for battle-after-moving restrictions.
 *
 * Never interpret these candidate states as confirmed gameplay. The official
 * server authority, historical replay, scenario provenance, SQLite commit,
 * idempotency and HTTP/SSE exposure are deliberately NOT implemented here.
 * V1 journals and commands remain unchanged and cannot implicitly accept V2.
 */
import {ANCIENTS_RULESET} from './movement-profile.mjs';
import {
  CORE_OPEN_FOOT_KIND,CORE_OPEN_FOOT_POLICY,
  reduceCoreOpenFootStep,replayCoreOpenFootSteps
} from './core-open-foot-movement.mjs';
import {
  OPEN_FOOT_PATH_PREVIEW_SCOPE,previewBaseOpenFootPath
} from './open-foot-path-preview.mjs';

export const OPEN_FOOT_PATH_CORE_KIND='ANCIENTS_OPEN_FOOT_PATH_CORE_V2';
export const OPEN_FOOT_PATH_CORE_POLICY='BASE_FOOT_OPEN_PATH_CORE_V2';
export const OPEN_FOOT_PATH_TRANSITION_KIND='BASE_FOOT_OPEN_PATH_PROPOSAL_V2';
const MAX=117;
const ROOT=Object.freeze(['state','action','policy']);
const STATE=Object.freeze(['kind','schemaVersion','ruleset','revision',
  'turn','phase','board','orderLedger']);
const POLICY=Object.freeze(['scope','ruleset','cardFamily','terrain',
  'scenarioExceptions','unitTypes']);
const ACTION=Object.freeze(['actor','expectedRevision','unitId','path']);
const KEY_ID=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const guard=Object.freeze({
  movementAuthorized:false,officialMovementAuthorized:false,
  attackAuthorized:false,canCommit:false,dbChanged:false,
  needsServerTransaction:true,needsFullLegalityCheck:true
});
const denied=(reason,step=null)=>Object.freeze({
  status:'BLOCKED',reason,step,nextState:null,transition:null,...guard
});
const deniedReplay=(reason,step=null,pathStep=null)=>Object.freeze({
  status:'BLOCKED',reason,step,pathStep,
  nextState:null,transitions:null,...guard
});
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,keys)=>plain(x)&&Reflect.ownKeys(x).length===keys.length&&
  keys.every(k=>{
    const d=Object.getOwnPropertyDescriptor(x,k);
    return d?.enumerable===true&&Object.hasOwn(d,'value');
  });
const freeze=x=>{
  if(x&&typeof x==='object'&&!Object.isFrozen(x)){
    for(const value of Object.values(x))freeze(value);
    Object.freeze(x);
  }
  return x;
};

/** Detached data-only clone: own descriptors, bounded arrays and depth,
 * no prototype tricks, symbols, accessors or client-controlled getters. */
function safeData(x,depth=0,budget={left:4000},ancestors=new WeakSet()){
  if(depth>15||--budget.left<0)throw Error('INVALID_PATH_CORE_DATA');
  if(x===null||typeof x==='boolean'||typeof x==='string')return x;
  if(typeof x==='number'&&Number.isSafeInteger(x))return x;
  if(typeof x!=='object'||ancestors.has(x))
    throw Error('INVALID_PATH_CORE_DATA');
  ancestors.add(x);
  let result;
  if(Array.isArray(x)){
    if(Object.getPrototypeOf(x)!==Array.prototype)
      throw Error('INVALID_PATH_CORE_DATA');
    const count=Object.getOwnPropertyDescriptor(x,'length')?.value;
    if(!Number.isSafeInteger(count)||count<0||count>MAX||
       Reflect.ownKeys(x).length!==count+1)
      throw Error('INVALID_PATH_CORE_DATA');
    result=[];
    for(let i=0;i<count;i++){
      const d=Object.getOwnPropertyDescriptor(x,String(i));
      if(!d?.enumerable||!Object.hasOwn(d,'value'))
        throw Error('INVALID_PATH_CORE_DATA');
      result.push(safeData(d.value,depth+1,budget,ancestors));
    }
  }else{
    if(!plain(x))throw Error('INVALID_PATH_CORE_DATA');
    const keys=Reflect.ownKeys(x);
    if(keys.length>MAX)throw Error('INVALID_PATH_CORE_DATA');
    result={};
    for(const key of keys){
      if(typeof key!=='string'||key==='__proto__')
        throw Error('INVALID_PATH_CORE_DATA');
      const d=Object.getOwnPropertyDescriptor(x,key);
      if(!d?.enumerable||!Object.hasOwn(d,'value'))
        throw Error('INVALID_PATH_CORE_DATA');
      Object.defineProperty(result,key,{
        value:safeData(d.value,depth+1,budget,ancestors),
        enumerable:true,writable:true,configurable:true
      });
    }
  }
  ancestors.delete(x);
  return result;
}
const id=x=>typeof x==='string'&&KEY_ID.test(x)&&x!=='__proto__';
const validPath=path=>Array.isArray(path)&&path.length>=1&&path.length<=32&&
  path.every(cell=>exact(cell,['col','row'])&&
    Number.isSafeInteger(cell.col)&&Number.isSafeInteger(cell.row));
function legacyProjection(state,policy){
  return {
    state:{...state,kind:CORE_OPEN_FOOT_KIND,schemaVersion:1},
    policy:{...policy,scope:CORE_OPEN_FOOT_POLICY}
  };
}
function validScope(state,policy){
  return exact(state,STATE)&&state.kind===OPEN_FOOT_PATH_CORE_KIND&&
    state.schemaVersion===2&&state.ruleset===ANCIENTS_RULESET&&
    exact(policy,POLICY)&&
    policy.scope===OPEN_FOOT_PATH_CORE_POLICY&&
    policy.ruleset===ANCIENTS_RULESET;
}

/** One complete path is one hypothetical movement and increments revision
 * exactly once. Ordered units stay ordered; movedUnitIds records use. */
export function reduceCoreOpenFootPath(request={}){
  try{
    if(!exact(request,ROOT))
      return denied('INVALID_PATH_CORE_REQUEST');
    const data=safeData(request),{state,action,policy}=data;
    if(!validScope(state,policy))
      return denied('INVALID_PATH_CORE_SCOPE');
    const legacy=legacyProjection(state,policy);
    const checked=replayCoreOpenFootSteps({
      initialState:legacy.state,policy:legacy.policy,actions:[]
    });
    if(checked.status!=='RULE_REPLAY_CANDIDATE')
      return denied(checked.reason);
    if(!exact(action,ACTION)||!id(action.unitId)||
       !['A','B'].includes(action.actor)||
       !Number.isSafeInteger(action.expectedRevision)||
       action.expectedRevision<0||!validPath(action.path))
      return denied('INVALID_PATH_CORE_ACTION');
    // V1 is the authoritative *pure* gate for this experimental subset's
    // board/order/turn/revision/once-per-turn and first edge. Its output
    // is only a proposal, never proof of game authority.
    const first=reduceCoreOpenFootStep({
      state:legacy.state,policy:legacy.policy,
      action:{
        actor:action.actor,expectedRevision:action.expectedRevision,
        unitId:action.unitId,to:action.path[0]
      }
    });
    if(first.status!=='RULE_TRANSITION_CANDIDATE')
      return denied(first.reason,first.step);
    const source=state.board.units.find(u=>u.id===action.unitId);
    const result=previewBaseOpenFootPath({
      scope:OPEN_FOOT_PATH_PREVIEW_SCOPE,
      ruleset:ANCIENTS_RULESET,
      unitType:policy.unitTypes[action.unitId],
      cardFamily:policy.cardFamily,
      from:{col:source.col,row:source.row},
      path:action.path,
      occupiedCells:state.board.units,
      terrain:policy.terrain,
      leaders:state.board.leaders,
      scenarioExceptions:policy.scenarioExceptions
    });
    if(result.status!=='OPEN_FOOT_PATH_CANDIDATE')
      return denied(result.reason,result.step);
    // V1 deliberately freezes candidates; detach before V2 enrichment.
    const next=safeData(first.nextState);
    next.kind=OPEN_FOOT_PATH_CORE_KIND;
    next.schemaVersion=2;
    const moved=next.board.units.find(u=>u.id===action.unitId);
    moved.col=result.destination.col;
    moved.row=result.destination.row;
    // One command, one moved-unit marker, one revision, regardless of steps.
    const transition={
      kind:OPEN_FOOT_PATH_TRANSITION_KIND,
      side:action.actor,revision:next.revision,
      unitId:action.unitId,
      from:{col:source.col,row:source.row},
      to:{col:moved.col,row:moved.row},
      path:action.path.map(p=>({col:p.col,row:p.row})),
      steps:result.steps,
      battleAfterMovement:result.battleAfterMovement
    };
    return freeze({
      status:'RULE_PATH_TRANSITION_CANDIDATE',
      reason:null,step:null,nextState:next,transition,...guard
    });
  }catch{return denied('INVALID_PATH_CORE_INPUT');}
}

/**
 * Deterministic ordered replay. On ANY invalid command, return NO partial
 * state or prior transitions. Failed-step index identifies the action, and
 * pathStep identifies an invalid edge inside that action if applicable.
 */
export function replayCoreOpenFootPaths(input={}){
  try{
    if(!exact(input,['initialState','policy','actions']))
      return deniedReplay('INVALID_PATH_CORE_REPLAY');
    const args=safeData(input);
    const {initialState,policy,actions}=args;
    if(!validScope(initialState,policy))
      return deniedReplay('INVALID_PATH_CORE_SCOPE');
    const legacy=legacyProjection(initialState,policy);
    const checked=replayCoreOpenFootSteps({
      initialState:legacy.state,policy:legacy.policy,actions:[]
    });
    if(checked.status!=='RULE_REPLAY_CANDIDATE')
      return deniedReplay(checked.reason);
    if(!Array.isArray(actions)||actions.length>MAX)
      return deniedReplay('INVALID_PATH_CORE_REPLAY');
    let current=initialState;
    const transitions=[];
    for(let index=0;index<actions.length;index++){
      const result=reduceCoreOpenFootPath({
        state:current,policy,action:actions[index]
      });
      if(result.status!=='RULE_PATH_TRANSITION_CANDIDATE')
        return deniedReplay(result.reason,index,result.step);
      current=result.nextState;
      transitions.push(result.transition);
    }
    return freeze({
      status:'RULE_PATH_REPLAY_CANDIDATE',reason:null,step:null,
      pathStep:null,nextState:safeData(current),transitions,...guard
    });
  }catch{return deniedReplay('INVALID_PATH_CORE_REPLAY');}
}
