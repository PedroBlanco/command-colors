import test from 'node:test';
import assert from 'node:assert/strict';
import {ANCIENTS_RULESET} from './movement-profile.mjs';
import {initializeSectionHistoryLab,applySectionHistoryLabCommand}
  from './section-history-journal.mjs';
import {
  planPrivateFootPathV2SqliteStage as plan,
  snapshotFootPathV2StageRequest as snapshotWrite
} from './private-foot-path-v2-sqlite-stage.mjs';
import {
  PRIVATE_FOOT_PATH_V2_READ_AUDIT_KIND,
  snapshotFootPathV2ReadAuditRequest as snapshotRead,
  auditPrivateFootPathV2Stage as audit
} from './private-foot-path-v2-read-audit.mjs';

const MATCH='11111111-2222-4333-8444-555555555555';
const SECOND='99999999-8888-4777-8666-555555555555';
const KEY='private_v2_stage_0001';
const cell=(col,row)=>({col,row});
const scenario=()=>({
  scope:'SYNTHETIC_OPEN_HEX_V1',ruleset:ANCIENTS_RULESET,
  unitTypes:{unitA:'LIGHT_INFANTRY',enemy:'HEAVY_INFANTRY'},
  terrain:[],scenarioExceptions:[]
});
function verified(){
  const initial=initializeSectionHistoryLab({
    cardInstances:[
      {instanceId:'a_left',definitionId:'ORDER_2_LEFT'},
      {instanceId:'b_left',definitionId:'ORDER_2_LEFT'},
      {instanceId:'c_left',definitionId:'ORDER_2_LEFT'},
      {instanceId:'d_left',definitionId:'ORDER_2_LEFT'}
    ],handSizes:{A:2,B:1},startingSide:'A',randomIndex:()=>0,
    board:{units:[
      {id:'unitA',side:'A',col:2,row:4},
      {id:'enemy',side:'B',col:10,row:4}
    ],leaders:[]},
    sectorCells:{'2,4':['LEFT'],'10,4':['RIGHT']}
  });
  const played=applySectionHistoryLabCommand(initial,{
    actor:'A',type:'PLAY_SECTION_CARD',
    expectedRevision:0,cardInstanceId:initial.hands.A[0].instanceId
  });
  assert.equal(played.accepted,true);
  const ordered=applySectionHistoryLabCommand(played.nextState,{
    actor:'A',type:'ASSIGN_SECTION_ORDERS',expectedRevision:1,
    unitIds:['unitA'],leaderIds:[]
  });
  assert.equal(ordered.accepted,true);
  return ordered.nextState;
}
const makeDraft=(path=[cell(3,4),cell(4,4)])=>{
  const verifiedState=verified(),trustedScenario=scenario();
  const planned=plan({
    matchId:MATCH,verifiedState,actor:'A',expectedRevision:2,
    idempotencyKey:KEY,
    actions:[{kind:'UNIT',id:'unitA',path}],
    trustedScenario
  });
  assert.equal(planned.status,'PRIVATE_FOOT_PATH_STAGE_APPEND_CANDIDATE',
    planned.reason);
  return {
    persisted:{schemaVersion:1,ancientsFootPathJournalV2Lab:planned.journal},
    matchId:MATCH,verifiedState,actor:'A',trustedScenario
  };
};
const check=(args=makeDraft())=>audit(args);
const deny=(res,reason)=>{
  assert.equal(res.status,'BLOCKED');
  assert.equal(res.reason,reason);
  assert.equal(res.provisionalRevision,null);
  assert.equal(res.steps,null);
  assert.equal(res.canCommit,false);
  assert.equal(res.dbChanged,false);
};
const protectedResult=res=>{
  assert.equal(res.movementAuthorized,false);
  assert.equal(res.officialMovementAuthorized,false);
  assert.equal(res.canCommit,false);
  assert.equal(res.dbChanged,false);
  assert.equal(res.boardChanged,false);
  assert.equal(res.gameRevisionChanged,false);
  assert.equal(res.publicEventWritten,false);
  assert.equal(Object.isFrozen(res),true);
};

test('V2 read audit: private staged two-hex path is consistent with CCWB-derived state',()=>{
  const args=makeDraft(),before=structuredClone(args);
  const res=check(args);
  assert.equal(res.status,'PRIVATE_FOOT_PATH_V2_STAGE_VERIFIED');
  assert.equal(res.kind,PRIVATE_FOOT_PATH_V2_READ_AUDIT_KIND);
  assert.equal(res.provisionalRevision,3);
  assert.equal(res.steps,2);
  assert.deepEqual(args,before);
  protectedResult(res);
});

test('V2 read audit: one-hex path remains valid under V2',()=>{
  const result=check(makeDraft([cell(3,4)]));
  assert.equal(result.status,'PRIVATE_FOOT_PATH_V2_STAGE_VERIFIED');
  assert.equal(result.steps,1);
  protectedResult(result);
});

test('V2 read audit: absent V2 stage returns only ABSENT',()=>{
  const args=makeDraft();
  delete args.persisted.ancientsFootPathJournalV2Lab;
  assert.equal(check(args).status,'ABSENT');
  protectedResult(check(args));
});

test('V2 read audit: existing V1 alone is not interpreted as V2',()=>{
  const args=makeDraft();
  delete args.persisted.ancientsFootPathJournalV2Lab;
  args.persisted.ancientsFootMovementJournalLab={kind:'PRIVATE_CORE_FOOT_JOURNAL_V1'};
  const res=check(args);
  assert.equal(res.status,'ABSENT');
  assert.equal(res.provisionalRevision,null);
});

test('V2 read audit: dual V1/V2 stages reject without cleaning either',()=>{
  const args=makeDraft();
  args.persisted.ancientsFootMovementJournalLab={kind:'PRIVATE_CORE_FOOT_JOURNAL_V1'};
  const before=structuredClone(args.persisted);
  deny(check(args),'FOOT_STAGE_VERSION_CONFLICT');
  assert.deepEqual(args.persisted,before);
});

test('V2 read audit: other participant cannot see stored draft or metadata',()=>{
  const args=makeDraft();
  args.actor='B';
  const res=check(args);
  assert.equal(res.status,'NOT_VISIBLE');
  assert.equal(res.provisionalRevision,null);
  assert.equal(res.steps,null);
  protectedResult(res);
});

test('V2 read audit: wrong match ID cannot re-anchor valid stage',()=>{
  const args=makeDraft();args.matchId=SECOND;
  deny(check(args),'FOOT_PATH_V2_STAGE_ANCHOR_DRIFT');
});

test('V2 read audit: altered CCWB board, order revision or turn cannot anchor',()=>{
  for(const mutate of [
    x=>x.verifiedState.board.units[0].col=5,
    x=>x.verifiedState.revision=3,
    x=>x.verifiedState.turn='B',
    x=>x.verifiedState.orderSnapshot.pieces=[]
  ]){
    const args=structuredClone(makeDraft());mutate(args);
    const res=check(args);
    assert.equal(res.status,'BLOCKED');
    assert.equal(res.provisionalRevision,null);
    protectedResult(res);
  }
});

test('V2 read audit: changed trusted synthetic scenario blocks',()=>{
  for(const mutate of [
    x=>x.trustedScenario.unitTypes.unitA='MEDIUM_INFANTRY',
    x=>x.trustedScenario.terrain=[{kind:'HILL',col:12,row:8}],
    x=>x.trustedScenario.scope='UNVERIFIED_SCENARIO'
  ]){
    const args=structuredClone(makeDraft());mutate(args);
    const res=check(args);
    assert.equal(res.status,'BLOCKED');
    protectedResult(res);
  }
});

test('V2 read audit: tampered signature, route or proposed battle fail closed',()=>{
  for(const mutate of [
    j=>j.entries[0].signature='WRONG',
    j=>j.entries[0].command.path[1].col=5,
    j=>j.entries[0].transition.battleAfterMovement='UNAVAILABLE',
    j=>j.entries[0].publicEventProposal.visibility='private'
  ]){
    const args=structuredClone(makeDraft());
    mutate(args.persisted.ancientsFootPathJournalV2Lab);
    deny(check(args),'FOOT_PATH_V2_STAGE_INTEGRITY_FAILED');
  }
});

test('V2 read audit: malformed or missing journal and root do not reveal state',()=>{
  for(const value of [null,[],{},'unknown',false]){
    const args=makeDraft();
    args.persisted.ancientsFootPathJournalV2Lab=value;
    deny(check(args),'FOOT_PATH_V2_STAGE_INTEGRITY_FAILED');
  }
  deny(check({...makeDraft(),persisted:null}),
    'INVALID_V2_STAGE_AUDIT_CONTEXT');
});

test('V2 read audit: replayed object and primitive coordinates cannot be tampered',()=>{
  const args=structuredClone(makeDraft());
  args.persisted.ancientsFootPathJournalV2Lab.state.board.units[0].col=7;
  deny(check(args),'FOOT_PATH_V2_STAGE_INTEGRITY_FAILED');
});

test('V2 read audit: credentials, keys, hands and command contents never leak',()=>{
  const res=check(makeDraft());
  const encoded=JSON.stringify(res);
  for(const secret of [
    KEY,'unitA','LIGHT_INFANTRY','handAtPlay','cardInstanceId',
    'path','journal','token','signature','ANCIENTS_MOVEMENT_COMMITTED_V1'
  ])assert.equal(encoded.includes(secret),false,secret);
  protectedResult(res);
});

test('V2 read request: only one own session token is accepted',()=>{
  const request={sessionToken:'synthetic_live_test_session_123456789'};
  assert.deepEqual(snapshotRead(request),request);
  assert.equal(Object.isFrozen(snapshotRead(request)),true);
  for(const extra of [{actor:'A'},{scenario:scenario()},
    {canCommit:true},{matchId:MATCH},{expectedRevision:2}]){
    assert.equal(snapshotRead({...request,...extra}),null);
  }
  for(const invalid of [null,{},[],{sessionToken:null},
    {sessionToken:'too-short'}])assert.equal(snapshotRead(invalid),null);
});

test('V2 read request: root getter and Proxy.get cannot be invoked',()=>{
  const hits=[],root={};
  Object.defineProperty(root,'sessionToken',{enumerable:true,get(){
    hits.push('ROOT_GET');throw Error('GETTER');
  }});
  assert.equal(snapshotRead(root),null);
  const p=new Proxy({sessionToken:'synthetic_live_test_session_123456789'},{
    get(){hits.push('PROXY_GET');throw Error('GET')}
  });
  assert.equal(snapshotRead(p).sessionToken,
    'synthetic_live_test_session_123456789');
  assert.deepEqual(hits,[]);
});

test('V2 stage write snapshot: proxied actions and paths do not invoke get trap',()=>{
  const hits=[];
  const path=new Proxy([cell(3,4),cell(4,4)],{
    get(){hits.push('PATH_GET');throw Error('PROXY_GET')}
  });
  const actions=new Proxy([{kind:'UNIT',id:'unitA',path}],{
    get(){hits.push('ACTIONS_GET');throw Error('PROXY_GET')}
  });
  const res=snapshotWrite({
    sessionToken:'synthetic_live_test_session_123456789',
    expectedRevision:2,idempotencyKey:KEY,actions
  });
  assert.equal(res.actions[0].path.length,2);
  assert.deepEqual(res.actions[0].path[1],cell(4,4));
  assert.deepEqual(hits,[]);
});

test('V2 read audit: nested Proxy.get cannot be invoked on validated route',()=>{
  const hits=[],args=makeDraft();
  const copied=structuredClone(args.persisted.ancientsFootPathJournalV2Lab);
  const path=new Proxy(copied.entries[0].command.path,{
    get(){hits.push('PATH_GET');throw Error('PROXY_GET')}
  });
  copied.entries[0].command.path=path;
  args.persisted.ancientsFootPathJournalV2Lab=copied;
  const res=check(args);
  assert.equal(res.status,'PRIVATE_FOOT_PATH_V2_STAGE_VERIFIED');
  assert.deepEqual(hits,[]);
});

test('V2 read audit: malformed hostile getter blocks without executing it',()=>{
  const hits=[],args=structuredClone(makeDraft());
  Object.defineProperty(args.persisted.ancientsFootPathJournalV2Lab.entries[0],
    'idempotencyKey',{enumerable:true,get(){
      hits.push('GET');throw Error('GETTER');
    }});
  deny(check(args),'FOOT_PATH_V2_STAGE_INTEGRITY_FAILED');
  assert.deepEqual(hits,[]);
});
