import test from 'node:test';
import assert from 'node:assert/strict';
import {ANCIENTS_RULESET} from './movement-profile.mjs';
import {OPEN_FOOT_PATH_CORE_KIND,OPEN_FOOT_PATH_CORE_POLICY}
  from './core-open-foot-path-v2.mjs';
import {
  FOOT_PATH_JOURNAL_KIND,FOOT_PATH_JOURNAL_SIGNATURE_PREFIX,
  FOOT_PATH_EVENT_PROPOSAL,
  initializeFootPathJournal as initialize,
  proposeFootPathJournalAppend as append,
  replayFootPathJournal as replay,
  checkFootPathJournalAnchor as anchored
} from './foot-path-v2-journal.mjs';

const MATCH='11111111-2222-4333-8444-555555555555';
const OTHER='99999999-8888-4777-8666-555555555555';
const KEY='private_v2_path_0001',KEY2='private_v2_path_0002';
const cell=(col,row)=>({col,row});
const state=()=>({
  kind:OPEN_FOOT_PATH_CORE_KIND,schemaVersion:2,ruleset:ANCIENTS_RULESET,
  revision:2,turn:'A',phase:'MOVE',
  board:{units:[
    {id:'unitA',side:'A',col:2,row:4},
    {id:'reserve',side:'A',col:2,row:6},
    {id:'enemy',side:'B',col:10,row:4}
  ],leaders:[]},
  orderLedger:{issuedUnitIds:['unitA','reserve'],movedUnitIds:[]}
});
const policy=()=>({
  scope:OPEN_FOOT_PATH_CORE_POLICY,ruleset:ANCIENTS_RULESET,
  cardFamily:'ORDINARY_SECTION',terrain:[],scenarioExceptions:[],
  unitTypes:{unitA:'LIGHT_INFANTRY',reserve:'MEDIUM_INFANTRY',
    enemy:'HEAVY_INFANTRY'}
});
const command=(unitId='unitA',revision=2,path=[
  cell(3,4),cell(4,4)
])=>({actor:'A',expectedRevision:revision,unitId,path});
const ready=()=>initialize({
  matchId:MATCH,initialState:state(),policy:policy()
}).journal;
const proposed=()=>append({
  journal:ready(),command:command(),idempotencyKey:KEY
});
const checked=(source=proposed().journal)=>replay(source);
const anchor=(journal,overrides={})=>anchored({
  journal,trustedMatchId:MATCH,trustedInitialState:state(),
  trustedPolicy:policy(),rowRevision:journal?.state?.revision??3,
  ...overrides
});
const deny=(value,reason,step=null)=>{
  assert.equal(value.status,'BLOCKED');
  assert.equal(value.reason,reason);
  assert.equal(value.step,step);
  assert.equal(value.journal,null);
  assert.equal(value.publicEventProposal,null);
  assert.equal(value.replayedState,null);
  assert.equal(value.canCommit,false);
  assert.equal(value.dbChanged,false);
};
const guard=value=>{
  assert.equal(value.movementAuthorized,false);
  assert.equal(value.officialMovementAuthorized,false);
  assert.equal(value.attackAuthorized,false);
  assert.equal(value.canCommit,false);
  assert.equal(value.dbChanged,false);
  assert.equal(value.publicEventWritten,false);
  assert.equal(value.needsServerTransaction,true);
};

test('V2 journal: initial private draft is versioned, frozen and detached',()=>{
  const original=state(),rules=policy();
  const first=initialize({
    matchId:MATCH,initialState:original,policy:rules
  });
  assert.equal(first.status,'PRIVATE_FOOT_PATH_JOURNAL_INITIAL_CANDIDATE');
  assert.equal(first.journal.kind,FOOT_PATH_JOURNAL_KIND);
  assert.equal(first.journal.schemaVersion,2);
  assert.equal(first.journal.matchId,MATCH);
  assert.deepEqual(first.journal.entries,[]);
  assert.deepEqual(first.journal.state,original);
  guard(first);
  original.board.units[0].col=9;
  rules.unitTypes.unitA='ELEPHANT';
  assert.equal(first.journal.state.board.units[0].col,2);
  assert.equal(first.journal.policy.unitTypes.unitA,'LIGHT_INFANTRY');
  assert.equal(Object.isFrozen(first.journal.state.board.units[0]),true);
});

test('V2 journal: first two-hex path is one entry and one proposed revision',()=>{
  const one=proposed();
  assert.equal(one.status,'PRIVATE_FOOT_PATH_JOURNAL_APPEND_CANDIDATE');
  assert.equal(one.journal.entries.length,1);
  assert.equal(one.journal.state.revision,3);
  assert.equal(one.journal.state.board.units[0].col,4);
  assert.deepEqual(one.journal.state.orderLedger.movedUnitIds,['unitA']);
  assert.deepEqual(one.journal.entries[0].transition.path,[cell(3,4),cell(4,4)]);
  assert.equal(one.journal.entries[0].transition.steps,2);
  assert.equal(one.journal.entries[0].signature.startsWith(
    FOOT_PATH_JOURNAL_SIGNATURE_PREFIX),true);
  guard(one);
});

test('V2 journal: public proposal includes complete path and excludes private key',()=>{
  const result=proposed();
  assert.deepEqual(result.publicEventProposal,{
    type:FOOT_PATH_EVENT_PROPOSAL,visibility:'public',revision:3,
    side:'A',unitId:'unitA',from:cell(2,4),to:cell(4,4),
    path:[cell(3,4),cell(4,4)],steps:2,battleAfterMovement:'POSSIBLE'
  });
  const view=JSON.stringify(result.publicEventProposal);
  for(const word of [KEY,'idempotencyKey','signature','sessionToken',
    'hand','ANCIENTS_MOVEMENT_COMMITTED_V1'])
    assert.equal(view.includes(word),false);
  assert.equal(Object.isFrozen(result.publicEventProposal.path),true);
  assert.equal(Object.isFrozen(result.publicEventProposal.path[0]),true);
});

test('V2 journal: auxilia two hexes explicitly cannot battle afterwards',()=>{
  const rules=policy();rules.unitTypes.unitA='AUXILIA_INFANTRY';
  const initial=initialize({matchId:MATCH,initialState:state(),policy:rules});
  const result=append({journal:initial.journal,command:command(),
    idempotencyKey:KEY});
  assert.equal(result.status,'PRIVATE_FOOT_PATH_JOURNAL_APPEND_CANDIDATE');
  assert.equal(result.publicEventProposal.battleAfterMovement,'UNAVAILABLE');
  assert.equal(result.publicEventProposal.steps,2);
  guard(result);
});

test('V2 journal: a one-hex medium infantry path is recorded with battle possible',()=>{
  const result=append({
    journal:ready(),
    command:command('reserve',2,[cell(3,6)]),idempotencyKey:KEY
  });
  assert.equal(result.status,'PRIVATE_FOOT_PATH_JOURNAL_APPEND_CANDIDATE');
  assert.equal(result.publicEventProposal.steps,1);
  assert.equal(result.publicEventProposal.battleAfterMovement,'POSSIBLE');
  assert.deepEqual(result.journal.state.orderLedger.movedUnitIds,['reserve']);
});

test('V2 journal: replay survives JSON serialization and is deterministic',()=>{
  const first=proposed();
  const json=JSON.parse(JSON.stringify(first.journal));
  const result=checked(json),again=checked(json);
  assert.equal(result.status,'PRIVATE_FOOT_PATH_JOURNAL_REPLAY_CANDIDATE');
  assert.equal(result.entryCount,1);
  assert.deepEqual(result.replayedState,first.journal.state);
  assert.deepEqual(result,again);
  assert.equal(result.journal,null);
  guard(result);
});

test('V2 journal: same key and identical command is a read-only draft retry',()=>{
  const first=proposed();
  const again=append({
    journal:first.journal,command:command(),idempotencyKey:KEY
  });
  assert.equal(again.status,'PRIVATE_FOOT_PATH_JOURNAL_ALREADY_PROPOSED');
  assert.equal(again.priorRevision,3);
  assert.equal(again.journal,null);
  assert.equal(again.publicEventProposal,null);
  assert.equal(first.journal.entries.length,1);
  guard(again);
});

test('V2 journal: same key with different path conflicts, even same destination',()=>{
  const first=proposed();
  for(const other of [
    command('unitA',2,[cell(3,3),cell(4,4)]),
    command('unitA',2,[cell(3,4)]),
    command('unitA',2,[cell(3,4),cell(2,5)]),
    command('reserve',2,[cell(3,6)])
  ])deny(append({journal:first.journal,command:other,idempotencyKey:KEY}),
    'FOOT_PATH_IDEMPOTENCY_CONFLICT');
});

test('V2 journal: same key and changed revision conflicts before stale check',()=>{
  const r=append({journal:proposed().journal,
    command:command('unitA',3,[cell(3,4),cell(4,4)]),idempotencyKey:KEY});
  deny(r,'FOOT_PATH_IDEMPOTENCY_CONFLICT');
});

test('V2 journal: new key with stale revision is rejected',()=>{
  deny(append({journal:proposed().journal,command:command(),
    idempotencyKey:KEY2}),'STALE_REVISION');
});

test('V2 journal: second ordered unit uses one more revision, not path length',()=>{
  const first=proposed();
  const second=append({journal:first.journal,
    command:command('reserve',3,[cell(3,6)]),idempotencyKey:KEY2});
  assert.equal(second.status,'PRIVATE_FOOT_PATH_JOURNAL_APPEND_CANDIDATE');
  assert.equal(second.journal.entries.length,2);
  assert.equal(second.journal.state.revision,4);
  assert.deepEqual(second.journal.state.orderLedger.movedUnitIds,
    ['unitA','reserve']);
  assert.equal(checked(second.journal).entryCount,2);
  guard(second);
});

test('V2 journal: moving same unit twice rejects without partial journal',()=>{
  const first=proposed();
  deny(append({journal:first.journal,
    command:command('unitA',3,[cell(5,4)]),idempotencyKey:KEY2}),
    'UNIT_ALREADY_MOVED');
  assert.equal(first.journal.entries.length,1);
});

test('V2 journal: unissued or opposing units cannot be appended',()=>{
  for(const unitId of ['enemy','ghost']){
    deny(append({journal:ready(),
      command:command(unitId,2,[cell(9,4)]),idempotencyKey:KEY}),
      'UNIT_NOT_ORDERED');
  }
});

test('V2 journal: invalid geometry and exceeded profile never create an entry',()=>{
  const invalid=append({journal:ready(),
    command:command('unitA',2,[cell(4,4)]),idempotencyKey:KEY});
  deny(invalid,'NOT_ONE_ADJACENT_HEX');
  const exceeded=append({journal:ready(),
    command:command('reserve',2,[cell(3,6),cell(4,6)]),
    idempotencyKey:KEY});
  deny(exceeded,'STANDARD_FOOT_MOVEMENT_EXCEEDED');
});

test('V2 journal: signature tampering is detected on JSON-rehydrated data',()=>{
  const altered=structuredClone(proposed().journal);
  altered.entries[0].signature='CCW_FOOT_PATH_V2:FAKE';
  deny(checked(altered),'INVALID_FOOT_PATH_ENTRY',0);
});

test('V2 journal: altered path, transition or battle proposal fails closed',()=>{
  for(const mutate of [
    j=>j.entries[0].command.path[0].col=2,
    j=>j.entries[0].transition.path[1].row=8,
    j=>j.entries[0].transition.steps=1,
    j=>j.entries[0].transition.battleAfterMovement='UNAVAILABLE',
    j=>j.entries[0].publicEventProposal.path[1].col=3,
    j=>j.entries[0].publicEventProposal.side='B',
    j=>j.entries[0].publicEventProposal.type='ANCIENTS_MOVEMENT_COMMITTED_V1'
  ]){
    const journal=structuredClone(proposed().journal);
    mutate(journal);
    assert.equal(checked(journal).status,'BLOCKED');
    assert.equal(checked(journal).replayedState,null);
  }
});

test('V2 journal: tampered state, moved ledger and revision never replay',()=>{
  for(const mutate of [
    j=>j.state.board.units[0].col=7,
    j=>j.state.orderLedger.movedUnitIds=[],
    j=>j.state.revision=99
  ]){
    const journal=structuredClone(proposed().journal);mutate(journal);
    deny(checked(journal),'FOOT_PATH_STATE_DRIFT');
  }
});

test('V2 journal: independent anchor accepts exact replay and JSON round trip',()=>{
  const journal=JSON.parse(JSON.stringify(proposed().journal));
  const result=anchor(journal);
  assert.equal(result.status,'PRIVATE_FOOT_PATH_JOURNAL_ANCHORED_CANDIDATE');
  assert.equal(result.entryCount,1);
  assert.equal(result.rowRevision,3);
  assert.deepEqual(result.replayedState,journal.state);
  guard(result);
});

test('V2 journal: different trusted state or policy is not provenance',()=>{
  const journal=proposed().journal;
  const wrongState=state();wrongState.board.units[0].col=6;
  deny(anchor(journal,{trustedInitialState:wrongState}),'FOOT_PATH_ANCHOR_DRIFT');
  const wrongPolicy=policy();wrongPolicy.unitTypes.unitA='MEDIUM_INFANTRY';
  deny(anchor(journal,{trustedPolicy:wrongPolicy}),'FOOT_PATH_ANCHOR_DRIFT');
  deny(anchor(journal,{trustedMatchId:OTHER}),'FOOT_PATH_ANCHOR_DRIFT');
});

test('V2 journal: stale row revision is never accepted as anchored',()=>{
  deny(anchor(proposed().journal,{rowRevision:2}),
    'FOOT_PATH_ROW_REVISION_DRIFT');
});

test('V2 journal: V1 initial state and journal are not accepted as V2',()=>{
  const initial=state();initial.kind='ANCIENTS_OPEN_FOOT_MOVEMENT_CORE_V1';
  initial.schemaVersion=1;
  deny(initialize({matchId:MATCH,initialState:initial,policy:policy()}),
    'INVALID_FOOT_PATH_INITIAL');
  const changed=structuredClone(proposed().journal);
  changed.kind='PRIVATE_CORE_FOOT_JOURNAL_V1';
  changed.schemaVersion=1;
  deny(checked(changed),'INVALID_FOOT_PATH_JOURNAL');
});

test('V2 journal: non-empty initial moved ledger and special terrain are excluded',()=>{
  const moved=state();moved.orderLedger.movedUnitIds=['unitA'];
  deny(initialize({matchId:MATCH,initialState:moved,policy:policy()}),
    'INVALID_FOOT_PATH_INITIAL');
  const terrain=policy();terrain.terrain=[{col:5,row:5,kind:'FOREST'}];
  deny(initialize({matchId:MATCH,initialState:state(),policy:terrain}),
    'INVALID_FOOT_PATH_INITIAL');
});

test('V2 journal: invalid keys, extra actor and injected authority rejected',()=>{
  for(const idempotencyKey of ['short','contains space',null,'']){
    deny(append({journal:ready(),command:command(),idempotencyKey}),
      'INVALID_FOOT_PATH_COMMAND');
  }
  for(const extra of [{sessionToken:'secret'},{board:{}},
    {canCommit:true},{signature:'faked'}]){
    deny(append({journal:ready(),
      command:{...command(),...extra},idempotencyKey:KEY}),
      'INVALID_FOOT_PATH_COMMAND');
  }
});

test('V2 journal: no getter is executed on nested command or root input',()=>{
  const seen=[],root={journal:ready(),command:command(),
    idempotencyKey:KEY};
  Object.defineProperty(root,'command',{enumerable:true,get(){
    seen.push('root');throw Error('INVALID_GETTER');
  }});
  deny(append(root),'INVALID_FOOT_PATH_JOURNAL');
  const nested={journal:ready(),command:command(),
    idempotencyKey:KEY};
  Object.defineProperty(nested.command.path[0],'col',{
    enumerable:true,get(){seen.push('path');throw Error('INVALID_GETTER')}
  });
  deny(append(nested),'INVALID_FOOT_PATH_JOURNAL');
  assert.deepEqual(seen,[]);
});

test('V2 journal: root and nested Proxy.get trap never runs',()=>{
  const seen=[];
  const commandProxy=new Proxy(command(),{
    get(){seen.push('nested');throw Error('GET')}
  });
  const root=new Proxy({journal:ready(),command:commandProxy,
    idempotencyKey:KEY},{
      get(){seen.push('root');throw Error('GET')}
    });
  const result=append(root);
  assert.equal(result.status,'PRIVATE_FOOT_PATH_JOURNAL_APPEND_CANDIDATE');
  assert.deepEqual(seen,[]);
});

test('V2 journal: circular inputs, sparse paths and extra fields fail closed',()=>{
  const loop=structuredClone(proposed().journal);
  loop.loop=loop;
  deny(checked(loop),'INVALID_FOOT_PATH_JOURNAL');
  const sparse=command();sparse.path=new Array(2);
  deny(append({journal:ready(),command:sparse,idempotencyKey:KEY}),
    'INVALID_FOOT_PATH_JOURNAL');
  const root={journal:ready(),command:command(),idempotencyKey:KEY,
    actor:'A'};
  deny(append(root),'INVALID_FOOT_PATH_COMMAND');
});

test('V2 journal: no secret, committed event or authorization appears in results',()=>{
  const first=proposed(),view=JSON.stringify(first.publicEventProposal);
  assert.equal(view.includes(KEY),false);
  assert.equal(view.includes('signature'),false);
  assert.equal(view.includes('ANCIENTS_MOVEMENT_COMMITTED_V1'),false);
  guard(first);
  guard(checked(first.journal));
  guard(anchor(first.journal));
});
