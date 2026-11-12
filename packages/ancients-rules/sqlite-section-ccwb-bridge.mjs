/**
 * Laboratory-only CCWB v1 six-table adapter for a section-card history.
 * Never expose initialize() or dispatch() as an HTTP endpoint. Actor must come
 * from an authenticated server-side match membership check.
 * No migration, no rules-authorised combat and NO production scenario data.
 */
import {initializeSectionHistoryLab, applySectionHistoryLabCommand,
  assertSectionHistoryLab, projectSectionHistoryLab} from './section-history-journal.mjs';
import {bindLabJournalIdempotency, readLabJournalIdempotency} from './lab-idempotency-binding.mjs';
import {signSectionJournalCommand, checkSectionJournalSignature,
  matchesSectionJournalRetry} from './lab-command-signature.mjs';
import {precheckStagedAncientsMovement,
  precheckStagedAncientsLeaderMovement,
  precheckStagedAncientsMovementSequence,
  precheckStagedAncientsMovementEvidence} from './staged-movement-preflight.mjs';

const KEY=/^[A-Za-z0-9_-]{8,80}$/;
const TYPES=Object.freeze({
  PLAY_SECTION_CARD:['cardInstanceId'],
  ASSIGN_SECTION_ORDERS:['unitIds','leaderIds'],
  END_EXPERIMENTAL_TURN:[]
});
const denied=(status,code)=>Object.freeze({status,code});
const exact=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const parse=row=>{
  if (!row||row.guest_id===null)throw new Error('MATCH_NOT_READY');
  const state=JSON.parse(row.private_state);
  if (!record(state)||state.schemaVersion!==1||state.matchId!==row.id)
    throw new Error('CORRUPT_MATCH');
  return state;
};

export function hasExperimentalSectionHistory(row){
  return !!row&&Object.hasOwn(parse(row),'ancientsSectionHistoryLab');
}

/**
 * getRow(matchId) and atomic(fn) originate from the CCWB composition.
 * game_events must only contain public projections. Full initial state and
 * commands remain inside matches.private_state, never game_events.
 */
export function createSqliteAncientsSectionBridge({db,matchId,getRow,atomic}={}){
  if(!db||typeof matchId!=='string'||typeof getRow!=='function'||typeof atomic!=='function')
    throw new TypeError('INVALID_SECTION_BRIDGE_DEPENDENCIES');
  const events=db.prepare('SELECT sequence,visibility,payload FROM game_events WHERE match_id=? ORDER BY sequence');
  const keys=db.prepare('SELECT actor,idem_key,signature,committed_revision FROM game_commands WHERE match_id=? ORDER BY committed_revision');
  const getKey=db.prepare('SELECT signature,committed_revision FROM game_commands WHERE match_id=? AND actor=? AND idem_key=?');
  const update=db.prepare('UPDATE matches SET private_state=?,game_revision=? WHERE id=? AND game_revision=?');
  const eventInsert=db.prepare('INSERT INTO game_events(match_id,sequence,visibility,payload) VALUES(?,?,?,?)');
  const keyInsert=db.prepare('INSERT INTO game_commands(match_id,actor,idem_key,signature,committed_revision) VALUES(?,?,?,?,?)');
  const resultRow=()=>getRow(matchId);

  function verify(row){
    const persisted=parse(row);
    const journal=persisted.ancientsSectionHistoryLab;
    if(!record(journal)||Object.hasOwn(persisted,'commandSession')||
       !record(journal.initial)||!Array.isArray(journal.commands)||!record(journal.state)||
       !Number.isSafeInteger(row.game_revision)||row.game_revision<0||row.game_revision>256)
      throw new Error('SECTION_CCWB_HISTORY_INVALID');
    assertSectionHistoryLab(journal.initial);
    if(journal.initial.revision!==0||journal.commands.length!==row.game_revision)
      throw new Error('SECTION_CCWB_COMMAND_COUNT');
    let snapshot=structuredClone(journal.initial);
    const storedEvents=events.all(row.id),storedKeys=keys.all(row.id);
    if(storedEvents.length!==row.game_revision||storedKeys.length!==row.game_revision)
      throw new Error('SECTION_CCWB_EVENT_COUNT');
    for(let i=0;i<journal.commands.length;i++){
      const {command,idempotencyKey}=
        readLabJournalIdempotency(journal.commands[i]);
      const step=applySectionHistoryLabCommand(snapshot,command),revision=i+1;
      if(!step.accepted||step.nextState.revision!==revision)
        throw new Error('SECTION_CCWB_HISTORY_REPLAY_FAILED');
      const evt=storedEvents[i],saved=JSON.parse(evt.payload),key=storedKeys[i];
      if(evt.sequence!==revision||evt.visibility!=='public'||
         !exact(saved,{...step.publicEvent,visibility:'public'})||
         key.actor!==command.actor||key.committed_revision!==revision)
        throw new Error('SECTION_CCWB_HISTORY_TAMPERED');
      checkSectionJournalSignature({
        signature:key.signature,command,journalKey:idempotencyKey,sqlKey:key.idem_key
      });
      snapshot=step.nextState;
    }
    if(snapshot.revision!==row.game_revision||!exact(snapshot,journal.state))
      throw new Error('SECTION_CCWB_SNAPSHOT_DRIFT');
    return {persisted,journal,snapshot};
  }
  function safeView(row,actor){
    const {snapshot}=verify(row);
    return Object.freeze({matchId,rowRevision:row.game_revision,
      status:'LAB_ONLY',...projectSectionHistoryLab(snapshot,actor)});
  }
  /** Explicit TEST-ONLY server setup. Never accept browser-supplied setup. */
  function initialize(actor,setup,authorizeInTransaction=()=>true){
    if(actor!=='A')return denied(403,'FORBIDDEN');
    if(typeof authorizeInTransaction!=='function')
      throw new TypeError('INVALID_SECTION_LAB_AUTH_GUARD');
    return atomic(()=>{
      // Recheck live session and membership after BEGIN IMMEDIATE, not only
      // before entering this bridge. Another connection may have revoked it.
      const authorization=authorizeInTransaction();
      if(authorization!==true)return authorization;
      const row=resultRow(),persisted=parse(row);
      if(row.game_revision!==0||Object.hasOwn(persisted,'commandSession')||
         Object.hasOwn(persisted,'ancientsSectionHistoryLab')||
         events.all(row.id).length>0||keys.all(row.id).length>0)
        return denied(409,'SECTION_LAB_NOT_AVAILABLE');
      const initial=initializeSectionHistoryLab(setup);
      const clone={...persisted,ancientsSectionHistoryLab:{initial,commands:[],state:structuredClone(initial)}};
      // Distinguish this from the ordinary synthetic deck even if revision=0.
      const changed=db.prepare('UPDATE matches SET private_state=?,lobby_revision=lobby_revision+1 WHERE id=? AND game_revision=0')
        .run(JSON.stringify(clone),matchId);
      if(changed.changes!==1)throw new Error('SECTION_CCWB_CONCURRENT_INITIALIZATION');
      const updated={...row,private_state:JSON.stringify(clone)};
      return Object.freeze({status:201,code:'SECTION_LAB_INITIALIZED',
        view:safeView(updated,actor),cardPlayAuthorized:false,attackAuthorized:false});
    });
  }
  function view(actor){
    if(!['A','B'].includes(actor))return null;
    return safeView(resultRow(),actor);
  }
  function dispatch(request={},authorizeInTransaction=()=>true){
    if(!record(request)||!['A','B'].includes(request.actor))return denied(403,'FORBIDDEN');
    if(typeof authorizeInTransaction!=='function')
      throw new TypeError('INVALID_SECTION_LAB_AUTH_GUARD');
    const fields=Object.hasOwn(TYPES,request.type) ? TYPES[request.type] : null;
    if(!fields)return denied(400,'INVALID_SECTION_LAB_COMMAND');
    const expected=['actor','type','expectedRevision','idempotencyKey',...fields];
    if(Object.keys(request).length!==expected.length||
       !expected.every(key=>Object.hasOwn(request,key))||
       !Number.isSafeInteger(request.expectedRevision)||request.expectedRevision<0||
       typeof request.idempotencyKey!=='string'||!KEY.test(request.idempotencyKey))
      return denied(400,'INVALID_SECTION_LAB_COMMAND');
    return atomic(()=>{
      // Mutating command: revalidate the original session under the same SQLite
      // write transaction that records revision, events and command.
      const authorization=authorizeInTransaction();
      if(authorization!==true)return authorization;
      const row=resultRow(),{persisted,journal,snapshot}=verify(row);
      const command={type:request.type,actor:request.actor,expectedRevision:request.expectedRevision};
      for(const field of fields)command[field]=structuredClone(request[field]);
      const signature=signSectionJournalCommand(command,request.idempotencyKey);
      const previous=getKey.get(row.id,request.actor,request.idempotencyKey);
      if(previous)return matchesSectionJournalRetry(previous.signature,command,request.idempotencyKey)
        ? Object.freeze({status:200,code:'ALREADY_APPLIED',revision:previous.committed_revision,view:safeView(row,request.actor)})
        : denied(409,'IDEMPOTENCY_KEY_REUSED');
      if(row.game_revision!==request.expectedRevision)return denied(409,'STALE_REVISION');
      const result=applySectionHistoryLabCommand(snapshot,command);
      if(!result.accepted)return denied(result.code==='NOT_YOUR_TURN'?403:409,result.code);
      const next=result.nextState;
      const updated={...persisted,ancientsSectionHistoryLab:{
        initial:journal.initial,
        commands:[...journal.commands,bindLabJournalIdempotency(command,request.idempotencyKey)],
        state:next}};
      // A private proposal is bound to the PREVIOUS game revision. Its
      // actions must not survive a successfully committed journal step as
      // stale private data, even though the public log never exposes them.
      // Failed/retried commands return above without deleting anything.
      delete updated.ancientsSectionMovementDraft;
      if(update.run(JSON.stringify(updated),next.revision,row.id,row.game_revision).changes!==1)
        throw new Error('SECTION_CCWB_CONCURRENT_UPDATE');
      eventInsert.run(row.id,next.revision,'public',JSON.stringify({...result.publicEvent,visibility:'public'}));
      keyInsert.run(row.id,request.actor,request.idempotencyKey,signature,next.revision);
      return Object.freeze({status:200,code:'SECTION_LAB_APPLIED',revision:next.revision,
        view:safeView({...row,private_state:JSON.stringify(updated),game_revision:next.revision},request.actor),
        cardPlayAuthorized:false,ordersAuthorized:false,attackAuthorized:false,combatResolved:false});
    });
  }
  /** Verified, private CCWB snapshot. Caller MUST authenticate actor and hold
   *  the session/membership read transaction; no raw journal leaves the bridge. */
  function previewMovement(actor,request,trustedContext){
    if(!['A','B'].includes(actor))return denied(403,'FORBIDDEN');
    const {snapshot}=verify(resultRow());
    const preview=precheckStagedAncientsMovement({
      state:snapshot,actor,expectedRevision:request.expectedRevision,
      unitId:request.unitId,path:request.path,serverContext:trustedContext
    });
    return Object.freeze({status:200,code:'SECTION_LAB_MOVEMENT_PREVIEW',preview});
  }
  /** INTERNAL LAB ONLY: a leader was explicitly ordered by the private
   *  card journal. Never return or persist a move; no HTTP exposure. */
  function previewLeaderMovement(actor,request,trustedContext){
    if(!['A','B'].includes(actor))return denied(403,'FORBIDDEN');
    const {snapshot}=verify(resultRow());
    const preview=precheckStagedAncientsLeaderMovement({
      state:snapshot,actor,expectedRevision:request.expectedRevision,
      leaderId:request.leaderId,path:request.path,serverContext:trustedContext
    });
    return Object.freeze({status:200,code:'SECTION_LAB_LEADER_MOVEMENT_PREVIEW',preview});
  }
  /** Read-only laboratory simulation, from a verified and authenticated
   *  private journal. The result NEVER commits candidate board positions. */
  function previewMovementSequence(actor,request,trustedContext){
    if(!['A','B'].includes(actor))return denied(403,'FORBIDDEN');
    const {snapshot}=verify(resultRow());
    const preview=precheckStagedAncientsMovementSequence({
      state:snapshot,actor,expectedRevision:request.expectedRevision,
      actions:request.actions,serverContext:trustedContext
    });
    return Object.freeze({status:200,code:'SECTION_LAB_SEQUENCE_PREVIEW',preview});
  }
  /** INTERNAL LAB ONLY. Replay verifies the private journal under the
   *  caller's WAL snapshot before building immutable audit evidence.
   *  Never persist or broadcast this trace as an executed movement. */
  function previewMovementEvidence(actor,request,trustedContext) {
    if(!['A','B'].includes(actor))return denied(403,'FORBIDDEN');
    const {snapshot}=verify(resultRow());
    const evidence=precheckStagedAncientsMovementEvidence({
      matchId,actor,state:snapshot,expectedRevision:request.expectedRevision,
      actions:request.actions,serverContext:trustedContext
    });
    return Object.freeze({
      status:200,code:'SECTION_LAB_CANDIDATE_EVIDENCE',
      evidence,movementAuthorized:false,attackAuthorized:false,
      boardChanged:false
    });
  }
  return Object.freeze({initialize,view,dispatch,previewMovement,
    previewLeaderMovement,previewMovementSequence,previewMovementEvidence});
}
