import test from 'node:test';
import assert from 'node:assert/strict';
import {ANCIENTS_RULESET} from './movement-profile.mjs';
import {initializeSectionHistoryLab,applySectionHistoryLabCommand}
  from './section-history-journal.mjs';
import {planPrivateFootPathV2SqliteStage}
  from './private-foot-path-v2-sqlite-stage.mjs';
import {
  PRIVATE_FOOT_PATH_V2_LOCKED_PREFLIGHT_KIND,
  snapshotFootPathV2LockedPreflightRequest as capture,
  assessFootPathV2LockedPreflight as assess
} from './private-foot-path-v2-locked-preflight.mjs';

const MATCH='11111111-2222-4333-8444-555555555555';
const OTHER='99999999-8888-4777-8666-555555555555';
const KEY='private_v2_locked_0001';
const token='synthetic_session_that_is_not_a_real_credential_123';
const hex=(col,row)=>({col,row});
const policy=()=>({
  scope:'SYNTHETIC_OPEN_HEX_V1',ruleset:ANCIENTS_RULESET,
  unitTypes:{unitA:'LIGHT_INFANTRY',enemy:'HEAVY_INFANTRY'},
  terrain:[],scenarioExceptions:[]
});
function sectionState(){
  const init=initializeSectionHistoryLab({
    cardInstances:[
      {instanceId:'a_left',definitionId:'ORDER_2_LEFT'},
      {instanceId:'b_left',definitionId:'ORDER_2_LEFT'},
      {instanceId:'c_left',definitionId:'ORDER_2_LEFT'},
      {instanceId:'d_left',definitionId:'ORDER_2_LEFT'}
    ],handSizes:{A:2,B:1},startingSide:'A',randomIndex:()=>0,
    board:{units:[
      {id:'unitA',side:'A',col:2,row:4},
      {id:'enemy',side:'B',col:10,row:4}
    ],leaders:[]},sectorCells:{'2,4':['LEFT'],'10,4':['RIGHT']}
  });
  const played=applySectionHistoryLabCommand(init,{
    actor:'A',type:'PLAY_SECTION_CARD',expectedRevision:0,
    cardInstanceId:init.hands.A[0].instanceId
  });
  assert.equal(played.accepted,true);
  const ordered=applySectionHistoryLabCommand(played.nextState,{
    actor:'A',type:'ASSIGN_SECTION_ORDERS',expectedRevision:1,
    unitIds:['unitA'],leaderIds:[]
  });
  assert.equal(ordered.accepted,true);
  return ordered.nextState;
}
function fixture(path=[hex(3,4),hex(4,4)]){
  const verifiedState=sectionState(),trustedScenario=policy();
  const planned=planPrivateFootPathV2SqliteStage({
    matchId:MATCH,verifiedState,actor:'A',expectedRevision:2,
    actions:[{kind:'UNIT',id:'unitA',path}],idempotencyKey:KEY,
    trustedScenario
  });
  assert.equal(planned.status,'PRIVATE_FOOT_PATH_STAGE_APPEND_CANDIDATE',
    planned.reason);
  return {
    persisted:{schemaVersion:1,ancientsFootPathJournalV2Lab:planned.journal},
    matchId:MATCH,verifiedState,actor:'A',expectedRevision:2,
    idempotencyKey:KEY,trustedScenario,
    committedKeys:[
      {actor:'A',idem_key:'section_card_0001',committed_revision:1},
      {actor:'A',idem_key:'section_order_0001',committed_revision:2}
    ]
  };
}
const deny=(result,reason)=>{
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.reason,reason);
  assert.equal(result.proposedRevision,null);
  assert.equal(result.steps,null);
  assert.equal(result.canCommit,false);
  assert.equal(result.dbChanged,false);
};
const flags=result=>{
  assert.equal(result.movementAuthorized,false);
  assert.equal(result.officialMovementAuthorized,false);
  assert.equal(result.canCommit,false);
  assert.equal(result.dbChanged,false);
  assert.equal(result.boardChanged,false);
  assert.equal(result.gameRevisionChanged,false);
  assert.equal(result.publicEventWritten,false);
  assert.equal(result.needsOfficialScenario,true);
  assert.equal(result.needsOfficialReplay,true);
  assert.equal(result.needsCommittedIdempotency,true);
  assert.equal(Object.isFrozen(result),true);
};

test('V2 writer preflight: valid full path checks independent state and SQL key namespace',()=>{
  const args=fixture(),before=structuredClone(args);
  const result=assess(args);
  assert.equal(result.status,'PRIVATE_V2_LOCKED_PREFLIGHT_CANDIDATE');
  assert.equal(result.kind,PRIVATE_FOOT_PATH_V2_LOCKED_PREFLIGHT_KIND);
  assert.equal(result.proposedRevision,3);
  assert.equal(result.steps,2);
  assert.deepEqual(args,before);
  flags(result);
});

test('V2 writer preflight: one-hex path consumes one hypothetical revision',()=>{
  const result=assess(fixture([hex(3,4)]));
  assert.equal(result.status,'PRIVATE_V2_LOCKED_PREFLIGHT_CANDIDATE');
  assert.equal(result.steps,1);
  assert.equal(result.proposedRevision,3);
  flags(result);
});

test('V2 writer preflight: same actor and same key in game_commands blocks',()=>{
  const args=fixture();
  args.committedKeys[1].idem_key=KEY;
  deny(assess(args),'V2_LOCKED_PREFLIGHT_KEY_COMMITTED');
});

test('V2 writer preflight: same key used by other actor does not occupy local actor namespace',()=>{
  const args=fixture();
  args.committedKeys[1].actor='B';
  args.committedKeys[1].idem_key=KEY;
  assert.equal(assess(args).status,'PRIVATE_V2_LOCKED_PREFLIGHT_CANDIDATE');
});

test('V2 writer preflight: changed client key cannot silently create a new draft',()=>{
  const args=fixture();
  args.idempotencyKey='different_private_key_002';
  deny(assess(args),'V2_LOCKED_PREFLIGHT_DRAFT_KEY_MISMATCH');
});

test('V2 writer preflight: row revision mismatch blocks before reading journal',()=>{
  const args=fixture();
  args.expectedRevision=1;
  deny(assess(args),'V2_LOCKED_PREFLIGHT_STALE_REVISION');
});

test('V2 writer preflight: missing draft is not a positive admission',()=>{
  const args=fixture();
  delete args.persisted.ancientsFootPathJournalV2Lab;
  deny(assess(args),'V2_LOCKED_PREFLIGHT_STAGE_UNVERIFIED');
});

test('V2 writer preflight: conflicting private V1 stage is rejected',()=>{
  const args=fixture();
  args.persisted.ancientsFootMovementJournalLab={kind:'V1'};
  deny(assess(args),'V2_LOCKED_PREFLIGHT_STAGE_UNVERIFIED');
});

test('V2 writer preflight: wrong match ID cannot re-anchor a private proposal',()=>{
  const args=fixture();args.matchId=OTHER;
  deny(assess(args),'V2_LOCKED_PREFLIGHT_STAGE_UNVERIFIED');
});

test('V2 writer preflight: different trusted scenario cannot authorize a private draft',()=>{
  for(const mutate of [
    x=>x.trustedScenario.unitTypes.unitA='MEDIUM_INFANTRY',
    x=>x.trustedScenario.terrain=[{kind:'FOREST',col:11,row:8}]
  ]){
    const args=fixture();mutate(args);
    deny(assess(args),'V2_LOCKED_PREFLIGHT_STAGE_UNVERIFIED');
  }
});

test('V2 writer preflight: forged stored command or event proposal blocks',()=>{
  for(const mutate of [
    x=>x.persisted.ancientsFootPathJournalV2Lab.entries[0].signature='FORGED',
    x=>x.persisted.ancientsFootPathJournalV2Lab.entries[0].command.path[1].col=7,
    x=>x.persisted.ancientsFootPathJournalV2Lab.entries[0].publicEventProposal.type='COMMITTED'
  ]){
    const args=structuredClone(fixture());mutate(args);
    deny(assess(args),'V2_LOCKED_PREFLIGHT_STAGE_UNVERIFIED');
  }
});

test('V2 writer preflight: malformed and sparse SQL key rows reject',()=>{
  const fixtures=[
    [{actor:'A',idem_key:'valid_key_001',committed_revision:0}],
    [{actor:'A',idem_key:'valid_key_001',committed_revision:3}],
    [{actor:'A',idem_key:'bad key',committed_revision:1}],
    [{actor:'C',idem_key:'valid_key_001',committed_revision:1}],
    [{actor:'A',idem_key:'valid_key_001',committed_revision:1,signature:'EXTRA'}],
    new Array(1)
  ];
  for(const committedKeys of fixtures){
    const args=fixture();args.committedKeys=committedKeys;
    deny(assess(args),'INVALID_V2_LOCKED_PREFLIGHT_KEYS');
  }
});

test('V2 writer preflight: malformed root and missing authoritative inputs fail closed',()=>{
  for(const mutate of [
    x=>x.committedKeys=null,
    x=>x.actor='X',
    x=>x.idempotencyKey='abc',
    x=>x.verifiedState=null,
    x=>x.expectedRevision='2',
    x=>x.persisted=null
  ]){
    const args=fixture();mutate(args);
    const res=assess(args);
    assert.equal(res.status,'BLOCKED');
    flags(res);
  }
});

test('V2 writer preflight: server-only SQL key array getter must not be evaluated',()=>{
  const args=fixture(),hit=[];
  Object.defineProperty(args.committedKeys[1],'idem_key',{
    enumerable:true,get(){hit.push('GET');throw Error('GET')}
  });
  deny(assess(args),'INVALID_V2_LOCKED_PREFLIGHT_KEYS');
  assert.deepEqual(hit,[]);
});

test('V2 writer preflight: no private data or permission leaks in successful response',()=>{
  const result=assess(fixture()),encoded=JSON.stringify(result);
  for(const secret of [KEY,'unitA','LIGHT_INFANTRY','path',
    'sessionToken','handAtPlay','signature','section_card_0001',
    'PRIVATE_CORE_FOOT_PATH_JOURNAL_V2'])
    assert.equal(encoded.includes(secret),false,secret);
  flags(result);
});

test('V2 writer preflight request: exactly three own data fields are captured',()=>{
  const request={
    sessionToken:token,expectedRevision:2,idempotencyKey:KEY
  };
  const result=capture(request);
  assert.deepEqual(result,request);
  assert.equal(Object.isFrozen(result),true);
  for(const extra of [{actor:'A'},{unitId:'unitA'},{board:{}},
    {scenario:policy()},{canCommit:true},{path:[hex(3,4)]}]){
    assert.equal(capture({...request,...extra}),null);
  }
});

test('V2 writer preflight request: invalid tokens, revision and key are rejected',()=>{
  for(const candidate of [
    {},null,[],{sessionToken:'short',expectedRevision:2,idempotencyKey:KEY},
    {sessionToken:token,expectedRevision:-1,idempotencyKey:KEY},
    {sessionToken:token,expectedRevision:2,idempotencyKey:'bad key'},
    {sessionToken:token,expectedRevision:2,idempotencyKey:null}
  ])assert.equal(capture(candidate),null);
});

test('V2 writer preflight request: Proxy.get and accessor never run',()=>{
  const calls=[],input={
    sessionToken:token,expectedRevision:2,idempotencyKey:KEY
  };
  const proxy=new Proxy(input,{
    get(){calls.push('PROXY_GET');throw Error('UNSAFE')}
  });
  assert.deepEqual(capture(proxy),input);
  const malicious={...input};
  Object.defineProperty(malicious,'expectedRevision',{
    enumerable:true,get(){calls.push('GETTER');throw Error('UNSAFE')}
  });
  assert.equal(capture(malicious),null);
  assert.deepEqual(calls,[]);
});
