/**
 * Ancients #97: deliberately NON-EXECUTABLE V2 private-path preflight.
 *
 * The caller MUST already hold BEGIN IMMEDIATE, authenticate a live match
 * member and reconstruct the full CCWB command+event history from SQL.
 * This function itself cannot attest to those conditions and MUST NOT be
 * used as official rule authority, a transaction or a commit primitive.
 */
import {auditPrivateFootPathV2Stage}
  from './private-foot-path-v2-read-audit.mjs';

export const PRIVATE_FOOT_PATH_V2_LOCKED_PREFLIGHT_KIND=
  'PRIVATE_FOOT_PATH_V2_LOCKED_PREFLIGHT_V1';
const KEY=/^[A-Za-z0-9_-]{8,80}$/;
const guard=Object.freeze({
  movementAuthorized:false,officialMovementAuthorized:false,
  canCommit:false,dbChanged:false,boardChanged:false,
  gameRevisionChanged:false,publicEventWritten:false,
  needsOfficialScenario:true,needsOfficialReplay:true,
  needsCommittedIdempotency:true
});
const reject=reason=>Object.freeze({
  status:'BLOCKED',reason,
  kind:PRIVATE_FOOT_PATH_V2_LOCKED_PREFLIGHT_KIND,
  proposedRevision:null,steps:null,...guard
});
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  Object.getPrototypeOf(x)===Object.prototype;
const field=(x,k)=>Object.getOwnPropertyDescriptor(x,k);
const exact=(x,keys)=>plain(x)&&Reflect.ownKeys(x).length===keys.length&&
  keys.every(k=>{const d=field(x,k);return d?.enumerable===true&&
    Object.hasOwn(d,'value');});
const safe=(x,k)=>field(x,k)?.value;
/**
 * Capture untrusted data BEFORE the writer lock. The only client-supplied
 * fields are session token, expected row revision and draft key.
 * No actor, match ID, board, path, rule proof or event may be included.
 */
export function snapshotFootPathV2LockedPreflightRequest(input){
  try{
    if(!exact(input,['sessionToken','expectedRevision','idempotencyKey']))
      return null;
    const token=safe(input,'sessionToken'),
      revision=safe(input,'expectedRevision'),
      key=safe(input,'idempotencyKey');
    if(typeof token!=='string'||token.length<20||token.length>256||
       !Number.isSafeInteger(revision)||revision<0||
       revision>=Number.MAX_SAFE_INTEGER||
       typeof key!=='string'||!KEY.test(key))return null;
    return Object.freeze({
      sessionToken:token,expectedRevision:revision,idempotencyKey:key
    });
  }catch{return null;}
}
/**
 * committedKeys are independently read SQL rows {actor,idem_key,...}, NOT
 * client-provided. Every command/event row must already have passed the
 * section CCWB bridge's full replay and signature comparison before calling.
 */
export function assessFootPathV2LockedPreflight({
  persisted,matchId,verifiedState,actor,expectedRevision,
  idempotencyKey,trustedScenario,committedKeys
}={}){
  try{
    if(!plain(persisted)||typeof matchId!=='string'||
       !plain(verifiedState)||!['A','B'].includes(actor)||
       !Number.isSafeInteger(expectedRevision)||expectedRevision<0||
       expectedRevision>=Number.MAX_SAFE_INTEGER||
       typeof idempotencyKey!=='string'||!KEY.test(idempotencyKey)||
       !Array.isArray(committedKeys)||
       Object.getPrototypeOf(committedKeys)!==Array.prototype)
      return reject('INVALID_V2_LOCKED_PREFLIGHT_CONTEXT');

    const v=field(verifiedState,'revision');
    if(!v?.enumerable||!Object.hasOwn(v,'value')||
       v.value!==expectedRevision)
      return reject('V2_LOCKED_PREFLIGHT_STALE_REVISION');

    // Use descriptors for the whole SQL key table. The live transaction
    // already verifies every key against CCWB replay, but we still reject a
    // duplicate (actor,key) in the space our proposed move would occupy.
    const count=field(committedKeys,'length')?.value;
    if(!Number.isSafeInteger(count)||count<0||count>4096||
       Reflect.ownKeys(committedKeys).length!==count+1)
      return reject('INVALID_V2_LOCKED_PREFLIGHT_KEYS');
    for(let i=0;i<count;i++){
      const row=field(committedKeys,String(i));
      if(!row?.enumerable||!Object.hasOwn(row,'value')||
         !exact(row.value,['actor','idem_key','committed_revision']))
        return reject('INVALID_V2_LOCKED_PREFLIGHT_KEYS');
      const owner=safe(row.value,'actor'),key=safe(row.value,'idem_key'),
        revision=safe(row.value,'committed_revision');
      if(!['A','B'].includes(owner)||typeof key!=='string'||
         !KEY.test(key)||!Number.isSafeInteger(revision)||
         revision<1||revision>expectedRevision)
        return reject('INVALID_V2_LOCKED_PREFLIGHT_KEYS');
      if(owner===actor&&key===idempotencyKey)
        return reject('V2_LOCKED_PREFLIGHT_KEY_COMMITTED');
    }

    // The auditor validates the complete private draft against independently
    // verified CCWB board/orders and the server-only synthetic ruleset.
    const audit=auditPrivateFootPathV2Stage({
      persisted,matchId,verifiedState,actor,trustedScenario
    });
    if(audit.status!=='PRIVATE_FOOT_PATH_V2_STAGE_VERIFIED')
      return reject('V2_LOCKED_PREFLIGHT_STAGE_UNVERIFIED');

    // Check that the user-provided key is exactly the private draft's own
    // key, never accept a new key as an implicit new movement or reservation.
    const stored=field(persisted,'ancientsFootPathJournalV2Lab')?.value;
    const entries=stored&&field(stored,'entries')?.value;
    const entry=Array.isArray(entries)&&field(entries,'0')?.value;
    const storedKey=entry&&field(entry,'idempotencyKey')?.value;
    const command=entry&&field(entry,'command')?.value;
    if(storedKey!==idempotencyKey||!plain(command)||
       safe(command,'actor')!==actor||
       safe(command,'expectedRevision')!==expectedRevision)
      return reject('V2_LOCKED_PREFLIGHT_DRAFT_KEY_MISMATCH');

    if(audit.provisionalRevision!==expectedRevision+1||
       ![1,2].includes(audit.steps))
      return reject('V2_LOCKED_PREFLIGHT_REVISION_DRIFT');

    // Only a *redacted*, non-executable result. The actual rules, scenario,
    // authorization and idempotent game_commands insert DO NOT exist here.
    return Object.freeze({
      status:'PRIVATE_V2_LOCKED_PREFLIGHT_CANDIDATE',reason:null,
      kind:PRIVATE_FOOT_PATH_V2_LOCKED_PREFLIGHT_KIND,
      proposedRevision:audit.provisionalRevision,steps:audit.steps,...guard
    });
  }catch{return reject('INVALID_V2_LOCKED_PREFLIGHT_CONTEXT');}
}
