/**
 * PRIVATE CCWB LAB ONLY: audit a staged V2 full-path movement WITHOUT writing.
 *
 * The caller MUST provide a CCWB state independently reconstructed from
 * server-side SQLite card/order history, and a trusted synthetic scenario.
 * Never accept a state, scenario, journal or actor from a browser.
 *
 * This proves consistency of the private draft with those sources, not
 * official movement authorization or cryptographic provenance.
 */
import {replayFootPathJournal} from './foot-path-v2-journal.mjs';
import {planPrivateFootPathV2SqliteStage}
  from './private-foot-path-v2-sqlite-stage.mjs';

export const PRIVATE_FOOT_PATH_V2_READ_AUDIT_KIND=
  'PRIVATE_LAB_FOOT_PATH_V2_READ_AUDIT';
const guards=Object.freeze({
  movementAuthorized:false,officialMovementAuthorized:false,
  canCommit:false,dbChanged:false,boardChanged:false,
  gameRevisionChanged:false,publicEventWritten:false
});
const verdict=(status,reason=null,provisionalRevision=null,steps=null)=>
  Object.freeze({
    status,reason,kind:PRIVATE_FOOT_PATH_V2_READ_AUDIT_KIND,
    provisionalRevision,steps,...guards
  });
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  Object.getPrototypeOf(x)===Object.prototype;
const own=x=>x&&Object.getOwnPropertyDescriptor(x,'sessionToken');
/**
 * Only one credential field may cross the internal read-only entrypoint.
 * Own property descriptors avoid invoking getters or Proxy.get.
 */
export function snapshotFootPathV2ReadAuditRequest(request){
  try{
    if(!plain(request)||Reflect.ownKeys(request).length!==1)
      return null;
    const token=own(request);
    if(!token?.enumerable||!Object.hasOwn(token,'value')||
       typeof token.value!=='string'||token.value.length<20||
       token.value.length>256)return null;
    return Object.freeze({sessionToken:token.value});
  }catch{return null;}
}

/**
 * A separate server-only trusted scenario must be supplied on EVERY read:
 * the journal's own policy cannot authenticate itself.
 *
 * The returned projection intentionally contains no actor, unit ID, route,
 * private key/signature, hand, board, command or event payload. A participant
 * cannot inspect the other participant's private staged path.
 */
export function auditPrivateFootPathV2Stage({
  persisted,matchId,verifiedState,actor,trustedScenario
}={}){
  try{
    if(!plain(persisted)||typeof matchId!=='string'||
       !plain(verifiedState)||!Number.isSafeInteger(verifiedState.revision)||
       verifiedState.revision<0||!['A','B'].includes(actor))
      return verdict('BLOCKED','INVALID_V2_STAGE_AUDIT_CONTEXT');

    const hasV1=Object.hasOwn(persisted,'ancientsFootMovementJournalLab'),
      hasV2=Object.hasOwn(persisted,'ancientsFootPathJournalV2Lab');
    if(hasV1&&hasV2)
      return verdict('BLOCKED','FOOT_STAGE_VERSION_CONFLICT');
    if(!hasV2)return verdict('ABSENT');

    const staged=Object.getOwnPropertyDescriptor(
      persisted,'ancientsFootPathJournalV2Lab');
    if(!staged?.enumerable||!Object.hasOwn(staged,'value')||
       !plain(staged.value))
      return verdict('BLOCKED','FOOT_PATH_V2_STAGE_INTEGRITY_FAILED');
    const journal=staged.value;

    // The draft owner's identity is stored in the replay-verified journal.
    // Before probing scenario/board mismatch, hide even the draft's existence
    // from the other participant in this otherwise internal API.
    const entries=Object.getOwnPropertyDescriptor(journal,'entries');
    if(!entries?.enumerable||!Object.hasOwn(entries,'value')||
       !Array.isArray(entries.value)||
       Object.getOwnPropertyDescriptor(entries.value,'length')?.value!==1)
      return verdict('BLOCKED','FOOT_PATH_V2_STAGE_INTEGRITY_FAILED');
    const entry=Object.getOwnPropertyDescriptor(entries.value,'0');
    if(!entry?.enumerable||!Object.hasOwn(entry,'value')||
       !plain(entry.value))
      return verdict('BLOCKED','FOOT_PATH_V2_STAGE_INTEGRITY_FAILED');
    const command=Object.getOwnPropertyDescriptor(entry.value,'command');
    if(!command?.enumerable||!Object.hasOwn(command,'value')||
       !plain(command.value))
      return verdict('BLOCKED','FOOT_PATH_V2_STAGE_INTEGRITY_FAILED');
    const recordedActor=Object.getOwnPropertyDescriptor(command.value,'actor');
    if(!recordedActor?.enumerable||
       !Object.hasOwn(recordedActor,'value')||
       !['A','B'].includes(recordedActor.value))
      return verdict('BLOCKED','FOOT_PATH_V2_STAGE_INTEGRITY_FAILED');
    if(recordedActor.value!==actor)return verdict('NOT_VISIBLE');

    const replayed=replayFootPathJournal(journal);
    if(replayed.status!=='PRIVATE_FOOT_PATH_JOURNAL_REPLAY_CANDIDATE'||
       replayed.entryCount!==1)
      return verdict('BLOCKED','FOOT_PATH_V2_STAGE_INTEGRITY_FAILED');

    const key=Object.getOwnPropertyDescriptor(entry.value,'idempotencyKey');
    const unit=Object.getOwnPropertyDescriptor(command.value,'unitId');
    const path=Object.getOwnPropertyDescriptor(command.value,'path');
    if(!key?.enumerable||!Object.hasOwn(key,'value')||
       !unit?.enumerable||!Object.hasOwn(unit,'value')||
       !path?.enumerable||!Object.hasOwn(path,'value'))
      return verdict('BLOCKED','FOOT_PATH_V2_STAGE_INTEGRITY_FAILED');

    // Although the journal replayed successfully, do NOT forward a
    // potentially proxied nested path to the planner: its array methods
    // would otherwise invoke Proxy.get on raw persisted objects.
    const sourcePath=path.value;
    if(!Array.isArray(sourcePath)||
       Object.getPrototypeOf(sourcePath)!==Array.prototype)
      return verdict('BLOCKED','FOOT_PATH_V2_STAGE_INTEGRITY_FAILED');
    const count=Object.getOwnPropertyDescriptor(sourcePath,'length')?.value;
    if(!Number.isSafeInteger(count)||count<1||count>2||
       Reflect.ownKeys(sourcePath).length!==count+1)
      return verdict('BLOCKED','FOOT_PATH_V2_STAGE_INTEGRITY_FAILED');
    const cleanPath=[];
    for(let i=0;i<count;i++){
      const d=Object.getOwnPropertyDescriptor(sourcePath,String(i));
      if(!d?.enumerable||!Object.hasOwn(d,'value')||!plain(d.value))
        return verdict('BLOCKED','FOOT_PATH_V2_STAGE_INTEGRITY_FAILED');
      const col=Object.getOwnPropertyDescriptor(d.value,'col'),
        row=Object.getOwnPropertyDescriptor(d.value,'row');
      if(!col?.enumerable||!Object.hasOwn(col,'value')||
         !row?.enumerable||!Object.hasOwn(row,'value')||
         !Number.isSafeInteger(col.value)||!Number.isSafeInteger(row.value))
        return verdict('BLOCKED','FOOT_PATH_V2_STAGE_INTEGRITY_FAILED');
      cleanPath.push({col:col.value,row:row.value});
    }
    const result=planPrivateFootPathV2SqliteStage({
      matchId,verifiedState,actor,
      expectedRevision:verifiedState.revision,
      actions:[{kind:'UNIT',id:unit.value,path:cleanPath}],
      idempotencyKey:key.value,trustedScenario,previousJournal:journal
    });
    if(result.status!=='PRIVATE_FOOT_PATH_STAGE_ALREADY_RECORDED')
      return verdict('BLOCKED','FOOT_PATH_V2_STAGE_ANCHOR_DRIFT');
    return verdict('PRIVATE_FOOT_PATH_V2_STAGE_VERIFIED',
      null,result.provisionalRevision,
      Object.getOwnPropertyDescriptor(path.value,'length')?.value??null);
  }catch{return verdict('BLOCKED','INVALID_V2_STAGE_AUDIT_CONTEXT');}
}
