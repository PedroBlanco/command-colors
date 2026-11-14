/**
 * Server-only, NON-AUTHORIZING V2 movement replay audit.
 *
 * Verify a proposed state and each complete-path transition against a
 * fresh deterministic replay from an INDEPENDENT trusted initial state
 * and rule policy. A caller must not source these anchors from the proposal.
 * No journal signature, database authority, authentication or commit.
 *
 * V1 journal/event contracts remain separate and unchanged.
 */
import {replayCoreOpenFootPaths} from './core-open-foot-path-v2.mjs';

export const FOOT_PATH_AUDIT_KIND='PRIVATE_FOOT_PATH_V2_REPLAY_AUDIT';
const MAX=117;
const guard=Object.freeze({
  movementAuthorized:false,officialMovementAuthorized:false,
  canCommit:false,dbChanged:false,needsServerTransaction:true
});
const deny=(reason,step=null)=>Object.freeze({
  status:'BLOCKED',reason,step,kind:FOOT_PATH_AUDIT_KIND,
  replayedState:null,transitionCount:null,...guard
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
    for(const v of Object.values(x))freeze(v);
    Object.freeze(x);
  }
  return x;
};
/** No getters, proxies' get traps, sparse arrays, symbols or cycles. */
function snapshot(x,depth=0,budget={left:12000},seen=new WeakSet()){
  if(depth>16||--budget.left<0)throw Error('INVALID_AUDIT_DATA');
  if(x===null||typeof x==='string'||typeof x==='boolean')return x;
  if(typeof x==='number'&&Number.isSafeInteger(x))return x;
  if(typeof x!=='object'||seen.has(x))throw Error('INVALID_AUDIT_DATA');
  seen.add(x);
  let out;
  if(Array.isArray(x)){
    const length=Object.getOwnPropertyDescriptor(x,'length')?.value;
    if(Object.getPrototypeOf(x)!==Array.prototype||
       !Number.isSafeInteger(length)||length<0||length>MAX||
       Reflect.ownKeys(x).length!==length+1)
      throw Error('INVALID_AUDIT_DATA');
    out=[];
    for(let i=0;i<length;i++){
      const d=Object.getOwnPropertyDescriptor(x,String(i));
      if(!d?.enumerable||!Object.hasOwn(d,'value'))
        throw Error('INVALID_AUDIT_DATA');
      out.push(snapshot(d.value,depth+1,budget,seen));
    }
  }else{
    if(!plain(x))throw Error('INVALID_AUDIT_DATA');
    const keys=Reflect.ownKeys(x);
    if(keys.length>MAX)throw Error('INVALID_AUDIT_DATA');
    out={};
    for(const key of keys){
      if(typeof key!=='string'||key==='__proto__')
        throw Error('INVALID_AUDIT_DATA');
      const d=Object.getOwnPropertyDescriptor(x,key);
      if(!d?.enumerable||!Object.hasOwn(d,'value'))
        throw Error('INVALID_AUDIT_DATA');
      Object.defineProperty(out,key,{
        value:snapshot(d.value,depth+1,budget,seen),
        enumerable:true,writable:true,configurable:true
      });
    }
  }
  seen.delete(x);
  return out;
}
const canonical=x=>Array.isArray(x)?x.map(canonical):
  x&&typeof x==='object'?Object.fromEntries(
    Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const same=(a,b)=>JSON.stringify(canonical(a))===
  JSON.stringify(canonical(b));

/**
 * All five fields are mandatory. In particular, expectedRevision must be
 * independently read from the trusted game row, not from the candidate.
 *
 * No event can be marked committed based on this consistency check.
 */
export function auditCoreOpenFootPathReplay(input={}){
  try{
    const request=snapshot(input);
    if(!exact(request,['trustedInitialState','trustedPolicy',
      'trustedRowRevision','actions','proposedState','proposedTransitions']))
      return deny('INVALID_PATH_AUDIT_SCOPE');
    const {trustedInitialState,trustedPolicy,trustedRowRevision,
      actions,proposedState,proposedTransitions}=request;
    if(!Number.isSafeInteger(trustedRowRevision)||
       trustedRowRevision<0||
       !Array.isArray(actions)||actions.length>MAX||
       !Array.isArray(proposedTransitions)||
       proposedTransitions.length!==actions.length)
      return deny('INVALID_PATH_AUDIT_SCOPE');
    const replay=replayCoreOpenFootPaths({
      initialState:trustedInitialState,policy:trustedPolicy,actions
    });
    if(replay.status!=='RULE_PATH_REPLAY_CANDIDATE')
      return deny(replay.reason,replay.step);
    if(replay.nextState.revision!==trustedRowRevision)
      return deny('PATH_AUDIT_ROW_REVISION_DRIFT');
    if(!same(replay.nextState,proposedState))
      return deny('PATH_AUDIT_STATE_DRIFT');
    for(let i=0;i<replay.transitions.length;i++){
      if(!same(replay.transitions[i],proposedTransitions[i]))
        return deny('PATH_AUDIT_TRANSITION_DRIFT',i);
    }
    return freeze({
      status:'PRIVATE_PATH_REPLAY_AUDIT_CANDIDATE',
      reason:null,step:null,kind:FOOT_PATH_AUDIT_KIND,
      replayedState:snapshot(replay.nextState),
      transitionCount:replay.transitions.length,...guard
    });
  }catch{return deny('INVALID_PATH_AUDIT_INPUT');}
}
