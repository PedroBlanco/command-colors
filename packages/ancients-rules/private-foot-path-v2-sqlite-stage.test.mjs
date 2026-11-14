import test from 'node:test';
import assert from 'node:assert/strict';
import {ANCIENTS_RULESET} from './movement-profile.mjs';
import {initializeSectionHistoryLab,applySectionHistoryLabCommand}
  from './section-history-journal.mjs';
import {
  snapshotFootPathV2StageRequest as snapshot,
  planPrivateFootPathV2SqliteStage as plan
} from './private-foot-path-v2-sqlite-stage.mjs';
import {inspectFootPathV2StageForSectionAdvance as lifecycle}
  from './private-foot-path-v2-lifecycle.mjs';

const MATCH='11111111-2222-4333-8444-555555555555';
const OTHER='99999999-8888-4777-8666-555555555555';
const KEY='path_stage_private_001';
const cell=(col,row)=>({col,row});
const action=(path=[cell(3,4),cell(4,4)])=>({
  kind:'UNIT',id:'unitA',path
});
const scenario=()=>({
  scope:'SYNTHETIC_OPEN_HEX_V1',ruleset:ANCIENTS_RULESET,
  unitTypes:{unitA:'LIGHT_INFANTRY',enemy:'HEAVY_INFANTRY'},
  terrain:[],scenarioExceptions:[]
});
function ready(){
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
    ],leaders:[]},sectorCells:{'2,4':['LEFT'],'10,4':['RIGHT']}
  });
  const played=applySectionHistoryLabCommand(initial,{
    actor:'A',type:'PLAY_SECTION_CARD',expectedRevision:0,
    cardInstanceId:initial.hands.A[0].instanceId
  });
  assert.equal(played.accepted,true);
  const ordered=applySectionHistoryLabCommand(played.nextState,{
    actor:'A',type:'ASSIGN_SECTION_ORDERS',expectedRevision:1,
    unitIds:['unitA'],leaderIds:[]
  });
  assert.equal(ordered.accepted,true);
  return ordered.nextState;
}
const input=(changes={})=>({
  matchId:MATCH,verifiedState:ready(),actor:'A',
  expectedRevision:2,actions:[action()],
  idempotencyKey:KEY,trustedScenario:scenario(),
  ...changes
});
const stage=()=>plan(input());
const denied=(r,reason)=>{
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.reason,reason);
  assert.equal(r.journal,null);
  assert.equal(r.canCommit,false);
  assert.equal(r.dbChanged,false);
};
const capture=(changes={})=>({
  sessionToken:'a_long_private_synthetic_session_123',
  expectedRevision:2,idempotencyKey:KEY,
  actions:[action()],...changes
});

test('V2 sqlite snapshot: accepts a two-hex request without actor, scenario or board',()=>{
  const original=capture(),before=structuredClone(original);
  const result=snapshot(original);
  assert.deepEqual(result,before);
  assert.equal(Object.isFrozen(result),true);
  assert.equal(Object.isFrozen(result.actions),true);
  assert.equal(Object.isFrozen(result.actions[0].path[0]),true);
  original.actions[0].path[1].col=5;
  assert.equal(result.actions[0].path[1].col,4);
});

test('V2 sqlite snapshot: accepts single-hex path and rejects three hexes',()=>{
  assert.equal(snapshot(capture({actions:[action([cell(3,4)])]})).actions[0].path.length,1);
  assert.equal(snapshot(capture({actions:[action([
    cell(3,4),cell(4,4),cell(5,4)
  ])]})),null);
});

test('V2 sqlite snapshot: denies extra actor, signatures, controls and spoofed scenarios',()=>{
  for(const injected of [{actor:'A'},{canCommit:true},
    {trustedScenario:scenario()},{signature:'FAKE'},
    {board:{}}])
    assert.equal(snapshot(capture(injected)),null);
});

test('V2 sqlite snapshot: denies malformed, sparse or extra-field paths',()=>{
  const sparse=new Array(2);sparse[0]=cell(3,4);
  const extra=[cell(3,4)];extra.custom=true;
  for(const path of [[],sparse,extra,[cell(-1,4)],
    [cell(3,4),{col:4,row:4,actor:'A'}]])
    assert.equal(snapshot(capture({actions:[action(path)]})),null);
});

test('V2 sqlite snapshot: rejects hostile getter without executing it',()=>{
  const original=capture(),hits=[];
  Object.defineProperty(original.actions[0].path[0],'col',{
    enumerable:true,get(){hits.push('GET');throw Error('HOSTILE')}
  });
  assert.equal(snapshot(original),null);
  assert.deepEqual(hits,[]);
});

test('V2 sqlite snapshot: Proxy get traps are never executed',()=>{
  const hits=[],proxied=new Proxy(capture(),{
    get(){hits.push('GET');throw Error('PROXY_GET')}
  });
  assert.equal(snapshot(proxied).actions[0].path.length,2);
  assert.deepEqual(hits,[]);
});

test('V2 sqlite planner: verified CCWB, two-hex path yields one private revision',()=>{
  const request=input(),original=structuredClone(request.verifiedState);
  const r=plan(request);
  assert.equal(r.status,'PRIVATE_FOOT_PATH_STAGE_APPEND_CANDIDATE',r.reason);
  assert.equal(r.journal.schemaVersion,2);
  assert.equal(r.journal.matchId,MATCH);
  assert.equal(r.journal.state.revision,3);
  assert.equal(r.journal.entries.length,1);
  assert.equal(r.journal.entries[0].command.path.length,2);
  assert.equal(r.journal.state.board.units[0].col,4);
  assert.equal(r.journal.entries[0].idempotencyKey,KEY);
  assert.deepEqual(request.verifiedState,original);
  assert.equal(r.movementAuthorized,false);
  assert.equal(r.dbChanged,false);
});

test('V2 sqlite planner: a single hex is also a valid independent V2 draft',()=>{
  const r=plan(input({actions:[action([cell(3,4)])]}));
  assert.equal(r.status,'PRIVATE_FOOT_PATH_STAGE_APPEND_CANDIDATE',r.reason);
  assert.equal(r.journal.entries[0].transition.steps,1);
  assert.equal(r.journal.state.board.units[0].col,3);
});

test('V2 sqlite planner: same idempotency key and identical route are a no-write retry',()=>{
  const saved=stage();
  assert.equal(saved.status,'PRIVATE_FOOT_PATH_STAGE_APPEND_CANDIDATE');
  const r=plan(input({previousJournal:structuredClone(saved.journal)}));
  assert.equal(r.status,'PRIVATE_FOOT_PATH_STAGE_ALREADY_RECORDED');
  assert.equal(r.provisionalRevision,3);
  assert.equal(r.journal,null);
  assert.equal(r.dbChanged,false);
});

test('V2 sqlite planner: same key alternate path conflicts despite same destination',()=>{
  const saved=stage();
  const r=plan(input({
    actions:[action([cell(3,3),cell(4,4)])],
    previousJournal:saved.journal
  }));
  denied(r,'FOOT_PATH_LAB_IDEMPOTENCY_CONFLICT');
});

test('V2 sqlite planner: second key rejected rather than adding another movement',()=>{
  const saved=stage();
  const r=plan(input({
    previousJournal:saved.journal,idempotencyKey:'path_stage_private_002'
  }));
  denied(r,'FOOT_PATH_LAB_ONLY_ONE_ACTION');
});

test('V2 sqlite planner: stale, opposing and unissued CCWB contexts reject',()=>{
  for(const changes of [
    {expectedRevision:1},{actor:'B'},
    {actions:[{kind:'UNIT',id:'enemy',path:[cell(9,4)]}]}
  ]){
    const r=plan(input(changes));
    assert.equal(r.status,'BLOCKED');
    assert.equal(r.journal,null);
  }
});

test('V2 sqlite planner: forbidden leaders and synthetic terrain changes reject',()=>{
  const leader=ready();
  leader.board.leaders.push({id:'captain',side:'A',col:2,row:4});
  const terrain=scenario();
  terrain.terrain=[{col:11,row:8,kind:'HILL'}];
  for(const changes of [
    {verifiedState:leader},{trustedScenario:terrain},
    {trustedScenario:{...scenario(),scope:'OFFICIAL_SCENARIO'}},
    {matchId:'unknown'}
  ])assert.equal(plan(input(changes)).status,'BLOCKED');
});

test('V2 sqlite planner: tampered, stale or transplanted persisted journal is not overwritten',()=>{
  const saved=stage();
  for(const mutate of [
    j=>j.entries[0].signature='WRONG',
    j=>j.entries[0].publicEventProposal.steps=3,
    j=>j.state.board.units[0].col=7,
    j=>j.entries.push(j.entries[0]),
    j=>j.matchId=OTHER
  ]){
    const previous=structuredClone(saved.journal);mutate(previous);
    denied(plan(input({previousJournal:previous})),
      'FOOT_PATH_LAB_PERSISTED_JOURNAL_DRIFT');
  }
});

test('V2 sqlite planner: private CCWB hand is excluded from journal',()=>{
  const r=stage();
  const serialized=JSON.stringify(r.journal);
  for(const word of ['handAtPlay','drawPile','cardInstanceId',
    'sessionToken','ANCIENTS_MOVEMENT_COMMITTED_V1'])
    assert.equal(serialized.includes(word),false);
});

const lifecycleInput=(journal,changes={})=>({
  persisted:{schemaVersion:1,...(journal===undefined?{}:
    {ancientsFootPathJournalV2Lab:journal})},
  matchId:MATCH,gameRevision:2,actor:'A',
  idempotencyKey:'section_end_turn_001',...changes
});
test('V2 stage expiry: absent stage is not an error',()=>{
  assert.equal(lifecycle(lifecycleInput(undefined)).status,'ABSENT');
});

test('V2 stage expiry: valid route can expire after an accepted section command',()=>{
  assert.equal(lifecycle(lifecycleInput(stage().journal)).status,'REPLACEABLE');
});

test('V2 stage expiry: staged private key cannot be reused as a real section key',()=>{
  const journal=stage().journal;
  assert.equal(lifecycle(lifecycleInput(journal,{idempotencyKey:KEY})).status,
    'KEY_CONFLICT');
  assert.equal(lifecycle(lifecycleInput(journal,{actor:'B',idempotencyKey:KEY})).status,
    'REPLACEABLE');
});

test('V2 stage expiry: stale, forged and cross-match stage blocks command',()=>{
  const original=stage().journal;
  for(const value of [
    null,'damaged',[],
    (()=>{const x=structuredClone(original);x.entries[0].signature='bad';return x})(),
    (()=>{const x=structuredClone(original);x.entries[0].command.path[0].col=9;return x})(),
    (()=>{const x=structuredClone(original);x.matchId=OTHER;return x})()
  ])assert.equal(lifecycle(lifecycleInput(value)).status,'CORRUPT');
  assert.equal(lifecycle(lifecycleInput(original,{gameRevision:3})).status,'CORRUPT');
});

test('V2 stage expiry: malformed actor, revision or persisted container deny',()=>{
  const journal=stage().journal;
  for(const changes of [
    {actor:'X'},{gameRevision:-1},{persisted:null},
    {idempotencyKey:null}
  ])assert.equal(lifecycle(lifecycleInput(journal,changes)).status,'CORRUPT');
});
