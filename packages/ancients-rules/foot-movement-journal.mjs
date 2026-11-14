/**
 * PRIVATE PERSISTENCE CONTRACT PROPOSAL — Ancients foot movement.
 *
 * The only rule reducer is reduceCoreOpenFootStep. This module provides a
 * deterministic replayable journal, semantic idempotent retries and minimal
 * event PROPOSALS. It does NOT write SQLite, authorize movement or publish
 * ANCIENTS_MOVEMENT_COMMITTED_V1. A future writer must authenticate the actor,
 * verify rule/scenario provenance, reserve the key under BEGIN IMMEDIATE and
 * commit state + commands + events atomically.
 *
 * Signatures below are semantic consistency strings, NOT MACs or evidence of
 * trusted rule/scenario provenance. Never accept the journal as browser input.
 */
import {reduceCoreOpenFootStep,replayCoreOpenFootSteps}
  from './core-open-foot-movement.mjs';

export const FOOT_JOURNAL_KIND='PRIVATE_CORE_FOOT_JOURNAL_V1';
export const FOOT_JOURNAL_SIGNATURE_PREFIX='CCW_FOOT_STEP_V1:';
export const FOOT_EVENT_PROPOSAL='FOOT_STEP_PUBLIC_EVENT_PROPOSAL_V1';

const KEY=/^[A-Za-z0-9_-]{8,80}$/;
const ID=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const LABELS=new Set(['A','B']);
const MAX_ENTRIES=117;
const guard=Object.freeze({
  movementAuthorized:false,officialMovementAuthorized:false,
  canCommit:false,dbChanged:false,needsServerTransaction:true
});
const reject=(reason,step=null)=>Object.freeze({
  status:'BLOCKED',reason,step,journal:null,publicEventProposal:null,
  replayedState:null,...guard
});
const exact=(o,keys)=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&
  Object.getPrototypeOf(o)===Object.prototype&&
  Reflect.ownKeys(o).length===keys.length&&
  keys.every(k=>Object.hasOwn(o,k));
const data=(x,depth=0,budget={left:10000},stack=new WeakSet())=>{
  if(depth>14||--budget.left<0)throw Error('FOOT_JOURNAL_INVALID_DATA');
  if(x===null||typeof x==='boolean'||typeof x==='string')return x;
  if(typeof x==='number'&&Number.isFinite(x))return x;
  if(typeof x!=='object'||stack.has(x))throw Error('FOOT_JOURNAL_INVALID_DATA');
  stack.add(x);
  let copy;
  if(Array.isArray(x)){
    if(Object.getPrototypeOf(x)!==Array.prototype||x.length>MAX_ENTRIES||
       Reflect.ownKeys(x).length!==x.length+1)
      throw Error('FOOT_JOURNAL_INVALID_DATA');
    copy=[];
    for(let i=0;i<x.length;i++){
      const d=Object.getOwnPropertyDescriptor(x,String(i));
      if(!d||!Object.hasOwn(d,'value')||!d.enumerable)
        throw Error('FOOT_JOURNAL_INVALID_DATA');
      copy.push(data(d.value,depth+1,budget,stack));
    }
  }else{
    if(Object.getPrototypeOf(x)!==Object.prototype)
      throw Error('FOOT_JOURNAL_INVALID_DATA');
    copy={};
    const keys=Reflect.ownKeys(x);
    if(keys.length>MAX_ENTRIES)throw Error('FOOT_JOURNAL_INVALID_DATA');
    for(const k of keys){
      if(typeof k!=='string'||k==='__proto__')throw Error('FOOT_JOURNAL_INVALID_DATA');
      const d=Object.getOwnPropertyDescriptor(x,k);
      if(!d||!Object.hasOwn(d,'value')||!d.enumerable)
        throw Error('FOOT_JOURNAL_INVALID_DATA');
      Object.defineProperty(copy,k,{
        value:data(d.value,depth+1,budget,stack),
        enumerable:true,writable:true,configurable:true
      });
    }
  }
  stack.delete(x);
  return copy;
};
const freeze=x=>{
  if(x&&typeof x==='object'&&!Object.isFrozen(x)){
    for(const value of Object.values(x))freeze(value);
    Object.freeze(x);
  }
  return x;
};
const canonical=x=>Array.isArray(x)?x.map(canonical):
  x&&typeof x==='object'?Object.fromEntries(
    Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));

function normalizedCommand(command){
  if(!exact(command,['actor','expectedRevision','unitId','to'])||
     !LABELS.has(command.actor)||
     !Number.isSafeInteger(command.expectedRevision)||command.expectedRevision<0||
     typeof command.unitId!=='string'||!ID.test(command.unitId)||
     command.unitId==='__proto__'||!exact(command.to,['col','row'])||
     !Number.isSafeInteger(command.to.col)||
     !Number.isSafeInteger(command.to.row)||
     command.to.col<0||command.to.col>=13||
     command.to.row<0||command.to.row>=9)
    return null;
  return {
    actor:command.actor,expectedRevision:command.expectedRevision,
    unitId:command.unitId,to:{col:command.to.col,row:command.to.row}
  };
}
const keyValid=key=>typeof key==='string'&&KEY.test(key);
const signature=(command,key)=>FOOT_JOURNAL_SIGNATURE_PREFIX+JSON.stringify({
  actor:command.actor,expectedRevision:command.expectedRevision,
  unitId:command.unitId,to:command.to,idempotencyKey:key
});
const publicEvent=transition=>({
  type:FOOT_EVENT_PROPOSAL,visibility:'public',
  revision:transition.revision,side:transition.side,
  unitId:transition.unitId,from:transition.from,to:transition.to
});

function rebuild(journal){
  if(!exact(journal,['kind','schemaVersion','initialState','policy','entries','state'])||
     journal.kind!==FOOT_JOURNAL_KIND||journal.schemaVersion!==1||
     !Array.isArray(journal.entries)||journal.entries.length>MAX_ENTRIES)
    return {error:'INVALID_FOOT_JOURNAL'};
  const initial=replayCoreOpenFootSteps({
    initialState:journal.initialState,policy:journal.policy,actions:[]
  });
  if(initial.status!=='RULE_REPLAY_CANDIDATE'||
     initial.nextState.orderLedger.movedUnitIds.length!==0)
    return {error:'INVALID_FOOT_JOURNAL_INITIAL'};
  let current=initial.nextState;
  const seen=new Set();
  for(let i=0;i<journal.entries.length;i++){
    const item=journal.entries[i];
    if(!exact(item,['idempotencyKey','command','signature','transition','publicEventProposal'])||
       !keyValid(item.idempotencyKey))
      return {error:'INVALID_FOOT_JOURNAL_ENTRY',step:i};
    const command=normalizedCommand(item.command);
    const scopedKey=command?.actor+':'+item.idempotencyKey;
    if(!command||seen.has(scopedKey)||
       item.signature!==signature(command,item.idempotencyKey))
      return {error:'INVALID_FOOT_JOURNAL_ENTRY',step:i};
    seen.add(scopedKey);
    const next=reduceCoreOpenFootStep({state:current,action:command,policy:journal.policy});
    if(next.status!=='RULE_TRANSITION_CANDIDATE'||
       !same(next.transition,item.transition)||
       !same(publicEvent(next.transition),item.publicEventProposal))
      return {error:'INVALID_FOOT_JOURNAL_REPLAY',step:i};
    current=next.nextState;
  }
  if(!same(current,journal.state))
    return {error:'FOOT_JOURNAL_STATE_DRIFT'};
  return {state:current};
}

/** Create an independent proposed persistence envelope from a trusted server
 * state + policy. No official rules authorization or database side effect. */
export function initializeFootMovementJournal({initialState,policy}={}){
  try{
    const cleanInitial=data(initialState),cleanPolicy=data(policy);
    const proposed={
      kind:FOOT_JOURNAL_KIND,schemaVersion:1,initialState:cleanInitial,
      policy:cleanPolicy,entries:[],state:data(cleanInitial)
    };
    const rebuilt=rebuild(proposed);
    if(rebuilt.error)return reject(rebuilt.error,rebuilt.step??null);
    return Object.freeze({
      status:'PRIVATE_FOOT_JOURNAL_INITIAL_CANDIDATE',
      journal:freeze(proposed),publicEventProposal:null,reason:null,...guard
    });
  }catch{return reject('INVALID_FOOT_JOURNAL_INITIAL');}
}

/** Recalculate every proposed step from the trusted initial state, recheck
 * signatures, minimal event proposals, idempotency uniqueness and snapshot.
 * This is a consistency audit only; never attest cryptographic provenance. */
export function replayFootMovementJournal(input){
  try{
    const journal=data(input);
    const result=rebuild(journal);
    if(result.error)return reject(result.error,result.step??null);
    return Object.freeze({
      status:'PRIVATE_FOOT_JOURNAL_REPLAY_CANDIDATE',reason:null,
      journal:null,replayedState:freeze(data(result.state)),
      entryCount:journal.entries.length,publicEventProposal:null,...guard
    });
  }catch{return reject('INVALID_FOOT_JOURNAL');}
}

/** Propose one append, including semantic idempotent retry behavior.
 * The resulting journal and event proposal must NEVER be persisted without
 * future trusted atomic authorization; a retry here is only a model result. */
export function proposeFootMovementJournalAppend({journal:source,command:untrusted,
  idempotencyKey}={}){
  try{
    const journal=data(source),commandInput=data(untrusted);
    const result=rebuild(journal);
    if(result.error)return reject(result.error,result.step??null);
    const command=normalizedCommand(commandInput);
    if(!command||!keyValid(idempotencyKey))
      return reject('INVALID_FOOT_JOURNAL_COMMAND');
    const prior=journal.entries.find(x=>
      x.command.actor===command.actor&&x.idempotencyKey===idempotencyKey);
    if(prior){
      if(prior.signature!==signature(command,idempotencyKey))
        return reject('FOOT_IDEMPOTENCY_CONFLICT');
      return Object.freeze({
        status:'FOOT_JOURNAL_ALREADY_PROPOSED',reason:null,
        journal:null,publicEventProposal:null,
        priorRevision:prior.transition.revision,...guard
      });
    }
    if(journal.entries.length>=MAX_ENTRIES)return reject('FOOT_JOURNAL_FULL');
    if(command.expectedRevision!==result.state.revision)
      return reject('STALE_REVISION');
    const applied=reduceCoreOpenFootStep({
      state:result.state,action:command,policy:journal.policy
    });
    if(applied.status!=='RULE_TRANSITION_CANDIDATE')
      return reject(applied.reason);
    const entry={
      idempotencyKey,command,
      signature:signature(command,idempotencyKey),
      transition:data(applied.transition),
      publicEventProposal:publicEvent(applied.transition)
    };
    const next={
      kind:FOOT_JOURNAL_KIND,schemaVersion:1,
      initialState:journal.initialState,policy:journal.policy,
      entries:[...journal.entries,entry],state:data(applied.nextState)
    };
    const check=rebuild(next);
    if(check.error)return reject(check.error,check.step??null);
    return Object.freeze({
      status:'PRIVATE_FOOT_JOURNAL_APPEND_CANDIDATE',reason:null,
      journal:freeze(next),publicEventProposal:freeze(data(entry.publicEventProposal)),
      ...guard
    });
  }catch{return reject('INVALID_FOOT_JOURNAL');}
}
