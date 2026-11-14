import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeSectionHistoryLab,applySectionHistoryLabCommand}
  from './section-history-journal.mjs';
import {ANCIENTS_RULESET} from './movement-profile.mjs';
import {planPrivateFootSqliteStage as plan}
  from './private-foot-sqlite-stage.mjs';
import {inspectFootStageForSectionAdvance as lifecycle}
  from './private-foot-stage-lifecycle.mjs';

const MATCH='11111111-2222-4333-8444-555555555555';
const SECOND='99999999-8888-4777-8666-555555555555';
const KEY='foot_stage_private_001';
const move=(col=3,row=4)=>({kind:'UNIT',id:'unitA',path:[{col,row}]});
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
const input=(overrides={})=>({
  matchId:MATCH,verifiedState:ready(),actor:'A',
  expectedRevision:2,actions:[move()],
  idempotencyKey:KEY,trustedScenario:scenario(),
  ...overrides
});
const accepted=(result)=>assert.equal(result.status,
  'PRIVATE_FOOT_STAGE_APPEND_CANDIDATE',result.reason);

test('private foot stage: first CCWB-derived step yields replayable private journal',()=>{
  const request=input(),before=structuredClone(request.verifiedState);
  const r=plan(request);
  accepted(r);
  assert.equal(r.kind,'PRIVATE_LAB_FOOT_STAGE_V1');
  assert.equal(r.journal.matchId,MATCH);
  assert.equal(r.journal.initialState.revision,2);
  assert.equal(r.journal.state.revision,3);
  assert.deepEqual(r.journal.state.orderLedger,{
    issuedUnitIds:['unitA'],movedUnitIds:['unitA']
  });
  assert.equal(r.journal.entries.length,1);
  assert.equal(r.journal.entries[0].idempotencyKey,KEY);
  assert.equal(r.journal.entries[0].command.actor,'A');
  assert.equal(r.journal.entries[0].signature.includes(MATCH),true);
  assert.equal(r.journal.state.board.units[0].col,3);
  assert.equal(r.canCommit,false);
  assert.equal(r.movementAuthorized,false);
  assert.equal(r.gameRevisionChanged,false);
  assert.deepEqual(request.verifiedState,before);
});
test('private foot stage: identical key and move is replayable no-write retry',()=>{
  const initial=plan(input());accepted(initial);
  const repeated=plan(input({previousJournal:structuredClone(initial.journal)}));
  assert.equal(repeated.status,'PRIVATE_FOOT_STAGE_ALREADY_RECORDED');
  assert.equal(repeated.stagedRevision,3);
  assert.equal(repeated.journal,null);
  assert.equal(repeated.dbChanged,false);
  assert.equal(repeated.canCommit,false);
});
test('private foot stage: conflicting movement under same key is rejected',()=>{
  const initial=plan(input());accepted(initial);
  const result=plan(input({
    actions:[move(2,5)],previousJournal:initial.journal
  }));
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.reason,'FOOT_LAB_IDEMPOTENCY_CONFLICT');
  assert.equal(result.journal,null);
});
test('private foot stage: a second key cannot stage another movement',()=>{
  const initial=plan(input());accepted(initial);
  const result=plan(input({
    idempotencyKey:'foot_stage_private_002',previousJournal:initial.journal
  }));
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.reason,'FOOT_LAB_ONE_STEP_ONLY');
});
test('private foot stage: forged journal and cross-match transplant fail closed',()=>{
  const initial=plan(input());accepted(initial);
  for(const modify of [
    j=>j.state.board.units[0].col=9,
    j=>j.entries[0].signature='wrong',
    j=>j.matchId=SECOND,
    j=>j.policy.unitTypes.unitA='ELEPHANT',
    j=>j.entries.push(j.entries[0])
  ]){
    const persisted=structuredClone(initial.journal);modify(persisted);
    const result=plan(input({previousJournal:persisted}));
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.reason,'FOOT_LAB_PERSISTED_JOURNAL_DRIFT');
    assert.equal(result.journal,null);
  }
});
test('private foot stage: revised card/board cannot reuse an earlier journal',()=>{
  const initial=plan(input());accepted(initial);
  const changed=ready();changed.board.units[0].col=4;
  const result=plan(input({
    verifiedState:changed,previousJournal:initial.journal
  }));
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.journal,null);
});
test('private foot stage: rival, leader and multi-step input denied',()=>{
  for(const changes of [
    {actor:'B'},
    {actions:[{kind:'LEADER',id:'unitA',path:[{col:3,row:4}]}]},
    {actions:[move(),move()]},
    {actions:[{kind:'UNIT',id:'enemy',path:[{col:9,row:4}]}]},
    {expectedRevision:1}
  ]){
    const result=plan(input(changes));
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.journal,null);
    assert.equal(result.canCommit,false);
  }
});
test('private foot stage: terrain, leaders and unsupported context always denied',()=>{
  const leader=ready();leader.board.leaders.push({
    id:'captain',side:'A',col:2,row:4
  });
  const hill=scenario();hill.terrain=[{col:10,row:7,kind:'HILL'}];
  for(const result of [
    plan(input({verifiedState:leader})),
    plan(input({trustedScenario:hill})),
    plan(input({trustedScenario:{...scenario(),scope:'OFFICIAL_UNVERIFIED'}})),
    plan(input({matchId:'not-a-match'}))
  ]){
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.journal,null);
    assert.equal(result.movementAuthorized,false);
  }
});
test('private foot stage: private hand, keys or internal metadata never enter result',()=>{
  const verifiedState=ready();
  verifiedState.board.privateNotes='SECRET_BOARD';
  verifiedState.board.units[0].privateNotes='SECRET_UNIT';
  const result=plan(input({verifiedState}));accepted(result);
  const json=JSON.stringify(result);
  for(const text of ['SECRET_BOARD','SECRET_UNIT','handAtPlay',
    'cardInstanceId','drawPile','sessionToken','ANCIENTS_MOVEMENT_COMMITTED_V1'])
    assert.equal(json.includes(text),false);
  for(const v of [result,result.journal,result.journal.entries,
    result.journal.entries[0],result.journal.state,
    result.journal.state.board.units[0]])
    assert.equal(Object.isFrozen(v),true);
});

const footLifecycle=(foot,changes={})=>lifecycle({
  persisted:{schemaVersion:1,...(foot===undefined?{}:
    {ancientsFootMovementJournalLab:foot})},
  matchId:MATCH,gameRevision:2,actor:'A',
  idempotencyKey:'section_turn_end_001',...changes
});
test('private foot lifecycle: no staged journal does not block a fresh section command',()=>{
  const state=footLifecycle(undefined);
  assert.equal(state.status,'ABSENT');
  assert.equal(Object.isFrozen(state),true);
});
test('private foot lifecycle: valid stage is replaceable by a different section key',()=>{
  const saved=plan(input());accepted(saved);
  const check=footLifecycle(saved.journal);
  assert.equal(check.status,'REPLACEABLE');
  assert.equal(check.kind,'PRIVATE_FOOT_STAGE_LIFECYCLE_V1');
  assert.equal(Object.isFrozen(check),true);
});
test('private foot lifecycle: staged foot key cannot masquerade as a section command',()=>{
  const saved=plan(input());accepted(saved);
  assert.equal(footLifecycle(saved.journal,{idempotencyKey:KEY}).status,
    'KEY_CONFLICT');
  assert.equal(footLifecycle(saved.journal,{actor:'B',idempotencyKey:KEY}).status,
    'REPLACEABLE');
});
test('private foot lifecycle: corrupted, stale and cross-match journals fail closed',()=>{
  const saved=plan(input());accepted(saved);
  for(const corrupt of [
    null,'unknown',[],{},
    (()=>{const j=structuredClone(saved.journal);j.matchId=SECOND;return j})(),
    (()=>{const j=structuredClone(saved.journal);j.state.board.units[0].col=9;return j})(),
    (()=>{const j=structuredClone(saved.journal);j.entries[0].signature='fake';return j})(),
    (()=>{const j=structuredClone(saved.journal);j.entries.push(j.entries[0]);return j})()
  ])assert.equal(footLifecycle(corrupt).status,'CORRUPT');
  assert.equal(footLifecycle(saved.journal,{gameRevision:3}).status,'CORRUPT');
  assert.equal(footLifecycle(saved.journal,{matchId:SECOND}).status,'CORRUPT');
});
test('private foot lifecycle: malformed operation context cannot authorize cleanup',()=>{
  const saved=plan(input());accepted(saved);
  for(const override of [
    {gameRevision:-1},{actor:'G'},{matchId:null},
    {idempotencyKey:null},{persisted:null}
  ])assert.equal(footLifecycle(saved.journal,override).status,'CORRUPT');
});
