/**
 * ANC / #97: non-executable transaction envelope for one restricted foot step.
 *
 * IMPORTANT: This is NOT the official movement authority. The caller must
 * independently retrieve the initial board, orders, scenario policy and
 * complete prior command/event replay under the same SQLite writer lock.
 * A coherent journal is not proof of scenario or rule provenance.
 *
 * This function does not touch SQLite, produce an official movement event,
 * reserve an idempotency key, authorize a move or change a real game revision.
 */
import {checkFootJournalAnchor,FOOT_EVENT_PROPOSAL}
  from './foot-movement-journal.mjs';

export const FOOT_ATOMIC_ENVELOPE_KIND='PRIVATE_FOOT_ATOMIC_ENVELOPE_V1';
const MATCH=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const KEY=/^[A-Za-z0-9_-]{8,80}$/;
const MAX_ROWS=4096;
const guard=Object.freeze({
  movementAuthorized:false,officialMovementAuthorized:false,
  canCommit:false,dbChanged:false,gameRevisionChanged:false,
  publicEventWritten:false,needsServerTransaction:true
});
const deny=reason=>Object.freeze({
  status:'BLOCKED',kind:FOOT_ATOMIC_ENVELOPE_KIND,reason,
  envelope:null,...guard
});
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,keys)=>plain(x)&&Reflect.ownKeys(x).length===keys.length&&
  keys.every(k=>Object.hasOwn(x,k));
const safeRevision=x=>Number.isSafeInteger(x)&&x>=0;

function copiedData(x,depth=0,budget={left:12000},parents=new WeakSet()){
  if(depth>15||--budget.left<0)throw Error('UNSAFE_ATOMIC_ENVELOPE_DATA');
  if(x===null||typeof x==='string'||typeof x==='boolean')return x;
  if(typeof x==='number'&&Number.isSafeInteger(x))return x;
  if(typeof x!=='object'||parents.has(x))throw Error('UNSAFE_ATOMIC_ENVELOPE_DATA');
  let out;
  parents.add(x);
  if(Array.isArray(x)){
    const n=Object.getOwnPropertyDescriptor(x,'length')?.value;
    if(Object.getPrototypeOf(x)!==Array.prototype||
       !Number.isSafeInteger(n)||n<0||n>MAX_ROWS||
       Reflect.ownKeys(x).length!==n+1)throw Error('UNSAFE_ATOMIC_ENVELOPE_DATA');
    out=[];
    for(let i=0;i<n;i++){
      const d=Object.getOwnPropertyDescriptor(x,String(i));
      if(!d||!Object.hasOwn(d,'value')||!d.enumerable)
        throw Error('UNSAFE_ATOMIC_ENVELOPE_DATA');
      out.push(copiedData(d.value,depth+1,budget,parents));
    }
  }else{
    if(Object.getPrototypeOf(x)!==Object.prototype)throw Error('UNSAFE_ATOMIC_ENVELOPE_DATA');
    const keys=Reflect.ownKeys(x);
    if(keys.length>MAX_ROWS)throw Error('UNSAFE_ATOMIC_ENVELOPE_DATA');
    out={};
    for(const k of keys){
      if(typeof k!=='string'||k==='__proto__')throw Error('UNSAFE_ATOMIC_ENVELOPE_DATA');
      const d=Object.getOwnPropertyDescriptor(x,k);
      if(!d||!Object.hasOwn(d,'value')||!d.enumerable)
        throw Error('UNSAFE_ATOMIC_ENVELOPE_DATA');
      Object.defineProperty(out,k,{value:copiedData(d.value,depth+1,budget,parents),
        enumerable:true,writable:true,configurable:true});
    }
  }
  parents.delete(x);
  return out;
}
function frozen(x){
  if(x&&typeof x==='object'&&!Object.isFrozen(x)){
    for(const v of Object.values(x))frozen(v);
    Object.freeze(x);
  }
  return x;
}

/**
 * These rows are minimal server-only SELECT projections, not client data:
 * commands: {match_id,actor,idem_key,committed_revision}
 * events:   {match_id,sequence,visibility}
 *
 * This verifies sequence occupancy, but NOT the historical signature/payload
 * or the meaning of prior commands. An independent authoritative history
 * replay is mandatory before a writer may rely on these facts.
 */
function verifyOccupiedRevisions(matchId,revision,commands,events){
  if(!Array.isArray(commands)||!Array.isArray(events)||
     commands.length!==revision||events.length!==revision||
     revision>MAX_ROWS)return false;
  const revisions=new Set(),keys=new Set(),eventRevisions=new Set();
  for(const c of commands){
    if(!exact(c,['match_id','actor','idem_key','committed_revision'])||
       c.match_id!==matchId||!['A','B'].includes(c.actor)||
       typeof c.idem_key!=='string'||!KEY.test(c.idem_key)||
       !Number.isSafeInteger(c.committed_revision)||
       c.committed_revision<1||c.committed_revision>revision||
       revisions.has(c.committed_revision)||
       keys.has(c.actor+':'+c.idem_key))return false;
    revisions.add(c.committed_revision);
    keys.add(c.actor+':'+c.idem_key);
  }
  for(const e of events){
    if(!exact(e,['match_id','sequence','visibility'])||
       e.match_id!==matchId||e.visibility!=='public'||
       !Number.isSafeInteger(e.sequence)||e.sequence<1||
       e.sequence>revision||eventRevisions.has(e.sequence))
      return false;
    eventRevisions.add(e.sequence);
  }
  return true;
}

/**
 * Prepare a single private, NOT EXECUTABLE persistence candidate, bound to a
 * fresh independent server state/policy/row revision and checked SQL history.
 *
 * No ALREADY_APPLIED result is possible: checking a key is not reserving it.
 * A future implementation must repeat all checks inside BEGIN IMMEDIATE,
 * verify full historical event/command signatures, and only then write.
 */
export function prepareFootAtomicCommitEnvelope({
  journal,trustedMatchId,trustedInitialState,trustedPolicy,
  currentGameRevision,recordedCommands,recordedEvents
}={}){
  try{
    if(typeof trustedMatchId!=='string'||!MATCH.test(trustedMatchId)||
       !safeRevision(currentGameRevision)||
       currentGameRevision>=Number.MAX_SAFE_INTEGER)
      return deny('INVALID_FOOT_ATOMIC_SCOPE');
    const source=copiedData(journal);
    const initial=copiedData(trustedInitialState);
    const policy=copiedData(trustedPolicy);
    const commands=copiedData(recordedCommands);
    const events=copiedData(recordedEvents);
    if(!verifyOccupiedRevisions(trustedMatchId,currentGameRevision,commands,events))
      return deny('FOOT_ATOMIC_PRIOR_REVISIONS_UNVERIFIED');
    const checked=checkFootJournalAnchor({
      journal:source,trustedMatchId,trustedInitialState:initial,
      trustedPolicy:policy,rowRevision:currentGameRevision+1
    });
    if(checked.status!=='PRIVATE_FOOT_JOURNAL_ANCHORED_CANDIDATE'||
       checked.entryCount!==1||source.entries.length!==1||
       source.initialState.revision!==currentGameRevision)
      return deny('FOOT_ATOMIC_ANCHOR_UNVERIFIED');
    const entry=source.entries[0];
    const command=entry.command;
    if(command.expectedRevision!==currentGameRevision||
       command.actor!==initial.turn||
       entry.transition.revision!==currentGameRevision+1||
       entry.publicEventProposal.type!==FOOT_EVENT_PROPOSAL||
       entry.publicEventProposal.revision!==currentGameRevision+1)
      return deny('FOOT_ATOMIC_REVISION_DIVERGENCE');
    if(commands.some(c=>c.actor===command.actor&&
       c.idem_key===entry.idempotencyKey))
      return deny('FOOT_ATOMIC_IDEMPOTENCY_KEY_OCCUPIED');
    // An event proposal is not a committed event. All data below is explicitly
    // designated private until independent server authority exists.
    const envelope={
      kind:FOOT_ATOMIC_ENVELOPE_KIND,
      matchId:trustedMatchId,
      expectedGameRevision:currentGameRevision,
      proposedGameRevision:currentGameRevision+1,
      privateBoardStateProposal:checked.replayedState,
      commandRowProposal:{
        match_id:trustedMatchId,actor:command.actor,
        idem_key:entry.idempotencyKey,signature:entry.signature,
        committed_revision:currentGameRevision+1
      },
      publicEventRowProposal:{
        match_id:trustedMatchId,sequence:currentGameRevision+1,
        visibility:'public',payload:entry.publicEventProposal
      }
    };
    return Object.freeze({
      status:'PRIVATE_FOOT_ATOMIC_ENVELOPE_CANDIDATE',
      kind:FOOT_ATOMIC_ENVELOPE_KIND,reason:null,
      envelope:frozen(envelope),...guard
    });
  }catch{
    return deny('INVALID_FOOT_ATOMIC_INPUT');
  }
}
