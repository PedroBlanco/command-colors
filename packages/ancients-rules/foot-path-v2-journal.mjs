/**
 * LAB-ANC / #97 — private, versioned V2 journal for complete infantry paths.
 *
 * One command = one full path = one hypothetical revision, whether the path
 * crosses one or two hexes. This is NOT the V1 journal, an official movement
 * event, authenticated game state, a transaction or a permission to commit.
 * Only trusted server code may supply initial state, policy and match ID.
 *
 * The semantic signatures detect divergence and conflicting retries; they
 * are NOT MACs and do not establish provenance or client authorization.
 */
import {
  reduceCoreOpenFootPath,replayCoreOpenFootPaths,
  OPEN_FOOT_PATH_CORE_KIND,OPEN_FOOT_PATH_CORE_POLICY
} from './core-open-foot-path-v2.mjs';
import {auditCoreOpenFootPathReplay}
  from './foot-path-v2-replay-audit.mjs';

export const FOOT_PATH_JOURNAL_KIND='PRIVATE_CORE_FOOT_PATH_JOURNAL_V2';
export const FOOT_PATH_JOURNAL_SIGNATURE_PREFIX='CCW_FOOT_PATH_V2:';
export const FOOT_PATH_EVENT_PROPOSAL='FOOT_PATH_PUBLIC_EVENT_PROPOSAL_V2';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const KEY=/^[A-Za-z0-9_-]{8,80}$/;
const ID=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const MAX=117;
const guard=Object.freeze({
  movementAuthorized:false,officialMovementAuthorized:false,
  attackAuthorized:false,canCommit:false,dbChanged:false,
  publicEventWritten:false,needsServerTransaction:true
});
const reject=(reason,step=null)=>Object.freeze({
  status:'BLOCKED',reason,step,journal:null,
  publicEventProposal:null,replayedState:null,...guard
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
function snapshot(x,depth=0,budget={left:12000},seen=new WeakSet()){
  if(depth>16||--budget.left<0)throw Error('INVALID_PATH_JOURNAL_DATA');
  if(x===null||typeof x==='string'||typeof x==='boolean')return x;
  if(typeof x==='number'&&Number.isSafeInteger(x))return x;
  if(typeof x!=='object'||seen.has(x))throw Error('INVALID_PATH_JOURNAL_DATA');
  seen.add(x);
  let copy;
  if(Array.isArray(x)){
    const n=Object.getOwnPropertyDescriptor(x,'length')?.value;
    if(Object.getPrototypeOf(x)!==Array.prototype||
       !Number.isSafeInteger(n)||n<0||n>MAX||
       Reflect.ownKeys(x).length!==n+1)
      throw Error('INVALID_PATH_JOURNAL_DATA');
    copy=[];
    for(let i=0;i<n;i++){
      const d=Object.getOwnPropertyDescriptor(x,String(i));
      if(!d?.enumerable||!Object.hasOwn(d,'value'))
        throw Error('INVALID_PATH_JOURNAL_DATA');
      copy.push(snapshot(d.value,depth+1,budget,seen));
    }
  }else{
    if(!plain(x))throw Error('INVALID_PATH_JOURNAL_DATA');
    const keys=Reflect.ownKeys(x);
    if(keys.length>MAX)throw Error('INVALID_PATH_JOURNAL_DATA');
    copy={};
    for(const key of keys){
      if(typeof key!=='string'||key==='__proto__')
        throw Error('INVALID_PATH_JOURNAL_DATA');
      const d=Object.getOwnPropertyDescriptor(x,key);
      if(!d?.enumerable||!Object.hasOwn(d,'value'))
        throw Error('INVALID_PATH_JOURNAL_DATA');
      Object.defineProperty(copy,key,{
        value:snapshot(d.value,depth+1,budget,seen),
        enumerable:true,writable:true,configurable:true
      });
    }
  }
  seen.delete(x);
  return copy;
}
const canonical=x=>Array.isArray(x)?x.map(canonical):
  x&&typeof x==='object'?Object.fromEntries(
    Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const same=(a,b)=>JSON.stringify(canonical(a))===
  JSON.stringify(canonical(b));
const keyOK=x=>typeof x==='string'&&KEY.test(x);
const matchOK=x=>typeof x==='string'&&UUID.test(x);

function normalizeCommand(source){
  if(!exact(source,['actor','expectedRevision','unitId','path'])||
     !['A','B'].includes(source.actor)||
     !Number.isSafeInteger(source.expectedRevision)||
     source.expectedRevision<0||
     typeof source.unitId!=='string'||!ID.test(source.unitId)||
     source.unitId==='__proto__'||!Array.isArray(source.path)||
     source.path.length<1||source.path.length>2)return null;
  const path=[];
  for(const p of source.path){
    if(!exact(p,['col','row'])||
       !Number.isSafeInteger(p.col)||!Number.isSafeInteger(p.row)||
       p.col<0||p.col>=13||p.row<0||p.row>=9)return null;
    path.push({col:p.col,row:p.row});
  }
  return {actor:source.actor,expectedRevision:source.expectedRevision,
    unitId:source.unitId,path};
}
const signature=(matchId,key,command)=>
  FOOT_PATH_JOURNAL_SIGNATURE_PREFIX+JSON.stringify({
    matchId,actor:command.actor,expectedRevision:command.expectedRevision,
    unitId:command.unitId,path:command.path,idempotencyKey:key
  });
const eventProposal=transition=>({
  type:FOOT_PATH_EVENT_PROPOSAL,visibility:'public',
  revision:transition.revision,side:transition.side,
  unitId:transition.unitId,
  from:transition.from,to:transition.to,
  path:transition.path,steps:transition.steps,
  battleAfterMovement:transition.battleAfterMovement
});

function rebuild(journal){
  if(!exact(journal,['kind','schemaVersion','matchId',
    'initialState','policy','entries','state'])||
    journal.kind!==FOOT_PATH_JOURNAL_KIND||
    journal.schemaVersion!==2||!matchOK(journal.matchId)||
    !Array.isArray(journal.entries)||journal.entries.length>MAX)
    return {error:'INVALID_FOOT_PATH_JOURNAL'};
  if(journal.initialState?.kind!==OPEN_FOOT_PATH_CORE_KIND||
     journal.policy?.scope!==OPEN_FOOT_PATH_CORE_POLICY)
    return {error:'INVALID_FOOT_PATH_INITIAL'};
  const initial=replayCoreOpenFootPaths({
    initialState:journal.initialState,policy:journal.policy,actions:[]
  });
  if(initial.status!=='RULE_PATH_REPLAY_CANDIDATE'||
     initial.nextState.orderLedger.movedUnitIds.length!==0)
    return {error:'INVALID_FOOT_PATH_INITIAL'};
  let current=initial.nextState;
  const seen=new Set(),actions=[],transitions=[];
  for(let i=0;i<journal.entries.length;i++){
    const entry=journal.entries[i];
    if(!exact(entry,['idempotencyKey','command','signature',
      'transition','publicEventProposal'])||
      !keyOK(entry.idempotencyKey))
      return {error:'INVALID_FOOT_PATH_ENTRY',step:i};
    const command=normalizeCommand(entry.command);
    if(!command||!same(command,entry.command))
      return {error:'INVALID_FOOT_PATH_ENTRY',step:i};
    const key=command.actor+':'+entry.idempotencyKey;
    if(seen.has(key)||entry.signature!==
       signature(journal.matchId,entry.idempotencyKey,command))
      return {error:'INVALID_FOOT_PATH_ENTRY',step:i};
    seen.add(key);
    const next=reduceCoreOpenFootPath({
      state:current,policy:journal.policy,action:command
    });
    if(next.status!=='RULE_PATH_TRANSITION_CANDIDATE'||
       !same(next.transition,entry.transition)||
       !same(eventProposal(next.transition),entry.publicEventProposal))
      return {error:'INVALID_FOOT_PATH_REPLAY',step:i};
    actions.push(command);transitions.push(next.transition);
    current=next.nextState;
  }
  if(!same(current,journal.state))
    return {error:'FOOT_PATH_STATE_DRIFT'};
  // The audit independently checks complete action sequence and every
  // transition against the initial snapshot. It does not attest provenance.
  const audit=auditCoreOpenFootPathReplay({
    trustedInitialState:journal.initialState,
    trustedPolicy:journal.policy,
    trustedRowRevision:current.revision,
    actions,proposedState:current,proposedTransitions:transitions
  });
  if(audit.status!=='PRIVATE_PATH_REPLAY_AUDIT_CANDIDATE')
    return {error:'FOOT_PATH_AUDIT_FAILED'};
  return {state:current,entries:journal.entries.length};
}

/** Only a private proposal, never an authoritative command or DB write. */
export function initializeFootPathJournal(request={}){
  try{
    const input=snapshot(request);
    if(!exact(input,['matchId','initialState','policy'])||
       !matchOK(input.matchId))
      return reject('INVALID_FOOT_PATH_INITIAL');
    const journal={
      kind:FOOT_PATH_JOURNAL_KIND,schemaVersion:2,
      matchId:input.matchId,initialState:input.initialState,
      policy:input.policy,entries:[],state:snapshot(input.initialState)
    };
    const validated=rebuild(journal);
    if(validated.error)return reject(validated.error);
    return Object.freeze({
      status:'PRIVATE_FOOT_PATH_JOURNAL_INITIAL_CANDIDATE',
      reason:null,journal:freeze(journal),publicEventProposal:null,...guard
    });
  }catch{return reject('INVALID_FOOT_PATH_INITIAL');}
}

/** Recheck EVERY entry from the initial state, including path and battle. */
export function replayFootPathJournal(input){
  try{
    const journal=snapshot(input);
    const verified=rebuild(journal);
    if(verified.error)return reject(verified.error,verified.step??null);
    return Object.freeze({
      status:'PRIVATE_FOOT_PATH_JOURNAL_REPLAY_CANDIDATE',
      reason:null,entryCount:verified.entries,
      journal:null,publicEventProposal:null,
      replayedState:freeze(snapshot(verified.state)),...guard
    });
  }catch{return reject('INVALID_FOOT_PATH_JOURNAL');}
}

/**
 * Check against independent server-owned state, policy and row revision.
 * Never use the journal's own copied anchors as the source of trusted facts.
 */
export function checkFootPathJournalAnchor(request={}){
  try{
    const input=snapshot(request);
    if(!exact(input,['journal','trustedMatchId','trustedInitialState',
      'trustedPolicy','rowRevision'])||!matchOK(input.trustedMatchId)||
       !Number.isSafeInteger(input.rowRevision)||
       input.rowRevision<0)
      return reject('FOOT_PATH_ANCHOR_REQUIRED');
    const result=rebuild(input.journal);
    if(result.error)return reject(result.error,result.step??null);
    if(input.journal.matchId!==input.trustedMatchId||
       !same(input.journal.initialState,input.trustedInitialState)||
       !same(input.journal.policy,input.trustedPolicy))
      return reject('FOOT_PATH_ANCHOR_DRIFT');
    if(result.state.revision!==input.rowRevision)
      return reject('FOOT_PATH_ROW_REVISION_DRIFT');
    return Object.freeze({
      status:'PRIVATE_FOOT_PATH_JOURNAL_ANCHORED_CANDIDATE',
      reason:null,entryCount:result.entries,
      rowRevision:input.rowRevision,
      journal:null,publicEventProposal:null,
      replayedState:freeze(snapshot(result.state)),...guard
    });
  }catch{return reject('INVALID_FOOT_PATH_ANCHOR');}
}

/**
 * An exact same-key retry is a PRIVATE draft lookup only, never a committed
 * idempotent result. Different path or revision under the same key conflicts.
 */
export function proposeFootPathJournalAppend(request={}){
  try{
    const input=snapshot(request);
    if(!exact(input,['journal','command','idempotencyKey'])||
       !keyOK(input.idempotencyKey))
      return reject('INVALID_FOOT_PATH_COMMAND');
    const j=input.journal;
    const verified=rebuild(j);
    if(verified.error)return reject(verified.error,verified.step??null);
    const command=normalizeCommand(input.command);
    if(!command||!same(command,input.command))
      return reject('INVALID_FOOT_PATH_COMMAND');
    const previous=j.entries.find(e=>e.command.actor===command.actor&&
      e.idempotencyKey===input.idempotencyKey);
    if(previous){
      if(previous.signature!==signature(j.matchId,input.idempotencyKey,command))
        return reject('FOOT_PATH_IDEMPOTENCY_CONFLICT');
      return Object.freeze({
        status:'PRIVATE_FOOT_PATH_JOURNAL_ALREADY_PROPOSED',
        reason:null,priorRevision:previous.transition.revision,
        journal:null,publicEventProposal:null,...guard
      });
    }
    if(j.entries.length>=MAX)
      return reject('FOOT_PATH_JOURNAL_FULL');
    if(command.expectedRevision!==verified.state.revision)
      return reject('STALE_REVISION');
    const applied=reduceCoreOpenFootPath({
      state:verified.state,policy:j.policy,action:command
    });
    if(applied.status!=='RULE_PATH_TRANSITION_CANDIDATE')
      return reject(applied.reason,applied.step);
    const entry={
      idempotencyKey:input.idempotencyKey,command,
      signature:signature(j.matchId,input.idempotencyKey,command),
      transition:snapshot(applied.transition),
      publicEventProposal:eventProposal(applied.transition)
    };
    const candidate={
      kind:FOOT_PATH_JOURNAL_KIND,schemaVersion:2,
      matchId:j.matchId,initialState:j.initialState,
      policy:j.policy,entries:[...j.entries,entry],
      state:snapshot(applied.nextState)
    };
    const checked=rebuild(candidate);
    if(checked.error)return reject(checked.error,checked.step??null);
    return Object.freeze({
      status:'PRIVATE_FOOT_PATH_JOURNAL_APPEND_CANDIDATE',
      reason:null,journal:freeze(candidate),
      publicEventProposal:freeze(snapshot(entry.publicEventProposal)),...guard
    });
  }catch{return reject('INVALID_FOOT_PATH_JOURNAL');}
}
