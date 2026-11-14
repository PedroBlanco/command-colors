import test from 'node:test';
import assert from 'node:assert/strict';
import {ANCIENTS_RULESET} from './movement-profile.mjs';
import {CORE_OPEN_FOOT_KIND,CORE_OPEN_FOOT_POLICY}
  from './core-open-foot-movement.mjs';
import {
  FOOT_JOURNAL_KIND,FOOT_JOURNAL_SIGNATURE_PREFIX,
  FOOT_EVENT_PROPOSAL,initializeFootMovementJournal as initialize,
  replayFootMovementJournal as replay,
  checkFootJournalAnchor as anchored,
  proposeFootMovementJournalAppend as append
} from './foot-movement-journal.mjs';

const at=(col,row)=>({col,row});
const game=()=>({
  kind:CORE_OPEN_FOOT_KIND,schemaVersion:1,ruleset:ANCIENTS_RULESET,
  revision:2,turn:'A',phase:'MOVE',
  board:{units:[
    {id:'unitA',side:'A',col:2,row:4},
    {id:'reserve',side:'A',col:2,row:6},
    {id:'enemy',side:'B',col:10,row:4}
  ],leaders:[]},
  orderLedger:{issuedUnitIds:['unitA','reserve'],movedUnitIds:[]}
});
const rules=()=>({
  scope:CORE_OPEN_FOOT_POLICY,ruleset:ANCIENTS_RULESET,
  cardFamily:'ORDINARY_SECTION',terrain:[],scenarioExceptions:[],
  unitTypes:{unitA:'LIGHT_INFANTRY',reserve:'MEDIUM_INFANTRY',
    enemy:'HEAVY_INFANTRY'}
});
const command=(unitId='unitA',expectedRevision=2,to=at(3,4))=>({
  actor:'A',expectedRevision,unitId,to
});
const KEY_A='foot_commit_id_001',KEY_B='foot_commit_id_002';
const ready=()=>initialize({initialState:game(),policy:rules()}).journal;
const first=()=>append({journal:ready(),command:command(),idempotencyKey:KEY_A});
const rejected=(result,reason)=>{
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.reason,reason);
  assert.equal(result.journal,null);
  assert.equal(result.publicEventProposal,null);
  assert.equal(result.canCommit,false);
  assert.equal(result.dbChanged,false);
};

test('foot journal: trusted initial state is a deeply frozen detached proposal',()=>{
  const initialState=game(),policy=rules();
  const before=structuredClone(initialState);
  const result=initialize({initialState,policy});
  assert.equal(result.status,'PRIVATE_FOOT_JOURNAL_INITIAL_CANDIDATE');
  assert.equal(result.journal.kind,FOOT_JOURNAL_KIND);
  assert.deepEqual(result.journal.initialState,before);
  assert.deepEqual(result.journal.state,before);
  assert.deepEqual(result.journal.entries,[]);
  for(const value of [result.journal,result.journal.state,
    result.journal.state.board,result.journal.state.board.units,
    result.journal.state.board.units[0],result.journal.policy.unitTypes])
    assert.equal(Object.isFrozen(value),true);
  initialState.board.units[0].col=8;
  policy.unitTypes.unitA='ELEPHANT';
  assert.deepEqual(result.journal.state,before);
  assert.equal(result.canCommit,false);
  assert.equal(result.movementAuthorized,false);
  assert.equal(result.dbChanged,false);
});

test('foot journal: no initial moved units, invalid rules or unsupported scope',()=>{
  const moved=game();moved.orderLedger.movedUnitIds=['unitA'];
  rejected(initialize({initialState:moved,policy:rules()}),
    'INVALID_FOOT_JOURNAL_INITIAL');
  const unsupported=rules();unsupported.terrain=[{col:10,row:8,kind:'HILL'}];
  rejected(initialize({initialState:game(),policy:unsupported}),
    'INVALID_FOOT_JOURNAL_INITIAL');
  const bad=game();bad.phase='COMBAT';
  rejected(initialize({initialState:bad,policy:rules()}),
    'INVALID_FOOT_JOURNAL_INITIAL');
});

test('foot journal: one append proposes a minimal private entry and public event',()=>{
  const original=ready(),before=structuredClone(original);
  const result=append({journal:original,command:command(),idempotencyKey:KEY_A});
  assert.equal(result.status,'PRIVATE_FOOT_JOURNAL_APPEND_CANDIDATE');
  assert.equal(result.journal.state.revision,3);
  assert.deepEqual(result.journal.state.orderLedger.movedUnitIds,['unitA']);
  assert.equal(result.journal.state.board.units[0].col,3);
  assert.equal(result.journal.entries.length,1);
  assert.equal(result.journal.entries[0].idempotencyKey,KEY_A);
  assert.equal(result.journal.entries[0].signature.startsWith(
    FOOT_JOURNAL_SIGNATURE_PREFIX),true);
  assert.deepEqual(result.publicEventProposal,{
    type:FOOT_EVENT_PROPOSAL,visibility:'public',
    revision:3,side:'A',unitId:'unitA',from:at(2,4),to:at(3,4)
  });
  assert.equal(JSON.stringify(result.publicEventProposal).includes(KEY_A),false);
  assert.equal(JSON.stringify(result.publicEventProposal).includes('signature'),false);
  assert.equal(JSON.stringify(result).includes('ANCIENTS_MOVEMENT_COMMITTED_V1'),false);
  assert.equal(result.officialMovementAuthorized,false);
  assert.equal(result.canCommit,false);
  assert.deepEqual(original,before);
});

test('foot journal: replay regenerates persisted state and survives JSON round-trip',()=>{
  const proposed=first();
  const persisted=JSON.parse(JSON.stringify(proposed.journal));
  const checked=replay(persisted);
  assert.equal(checked.status,'PRIVATE_FOOT_JOURNAL_REPLAY_CANDIDATE');
  assert.equal(checked.entryCount,1);
  assert.deepEqual(checked.replayedState,proposed.journal.state);
  assert.equal(checked.journal,null);
  assert.equal(checked.canCommit,false);
  assert.equal(checked.dbChanged,false);
});

test('foot journal: exact retry recognizes same proposal without proposing another append',()=>{
  const one=first();
  const second=append({journal:one.journal,command:command(),idempotencyKey:KEY_A});
  assert.equal(second.status,'FOOT_JOURNAL_ALREADY_PROPOSED');
  assert.equal(second.priorRevision,3);
  assert.equal(second.journal,null);
  assert.equal(second.publicEventProposal,null);
  assert.equal(second.canCommit,false);
  assert.equal(one.journal.entries.length,1);
});

test('foot journal: same idempotency key with different payload or revision conflicts',()=>{
  const one=first();
  for(const other of [
    command('reserve',2,at(3,6)),
    command('unitA',3,at(3,4)),
    command('unitA',2,at(2,5))
  ]){
    rejected(append({journal:one.journal,command:other,idempotencyKey:KEY_A}),
      'FOOT_IDEMPOTENCY_CONFLICT');
  }
});

test('foot journal: stale revision is not a retry when using a fresh key',()=>{
  rejected(append({journal:first().journal,command:command(),idempotencyKey:KEY_B}),
    'STALE_REVISION');
});

test('foot journal: second independent ordered unit moves at revision 3',()=>{
  const one=first();
  const two=append({
    journal:one.journal,
    command:command('reserve',3,at(3,6)),
    idempotencyKey:KEY_B
  });
  assert.equal(two.status,'PRIVATE_FOOT_JOURNAL_APPEND_CANDIDATE');
  assert.equal(two.journal.state.revision,4);
  assert.deepEqual(two.journal.state.orderLedger.movedUnitIds,['unitA','reserve']);
  assert.deepEqual(two.journal.entries.map(e=>e.transition.revision),[3,4]);
  assert.equal(replay(two.journal).status,'PRIVATE_FOOT_JOURNAL_REPLAY_CANDIDATE');
  const json=JSON.parse(JSON.stringify(two.journal));
  assert.deepEqual(replay(json).replayedState,two.journal.state);
});

test('foot journal: repeated unit at new revision fails without partial journal',()=>{
  const one=first(),before=structuredClone(one.journal);
  rejected(append({
    journal:one.journal,
    command:command('unitA',3,at(4,4)),
    idempotencyKey:KEY_B
  }),'UNIT_ALREADY_MOVED');
  assert.deepEqual(one.journal,before);
});

test('foot journal: unissued, rival, collision and long movement fail closed',()=>{
  for(const move of [
    command('enemy',2,at(9,4)),
    command('missing',2,at(3,4)),
    command('unitA',2,at(4,4)),
    command('unitA',2,at(2,6))
  ]) {
    const result=append({journal:ready(),command:move,idempotencyKey:KEY_A});
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.journal,null);
  }
});

test('foot journal: payload must exclude actor spoofing, token and extra authority',()=>{
  for(const mutation of [
    cmd=>cmd.actor='B',
    cmd=>cmd.sessionToken='private',
    cmd=>cmd.board={},
    cmd=>cmd.movementAuthorized=true,
    cmd=>cmd.candidateEvidence={status:'CANDIDATE'},
    cmd=>cmd.to.cardId='private',
    cmd=>cmd.expectedRevision='2'
  ]){
    const cmd=command();mutation(cmd);
    const result=append({journal:ready(),command:cmd,idempotencyKey:KEY_A});
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.journal,null);
  }
});

test('foot journal: tampered stored state is detected by replay',()=>{
  const changed=structuredClone(first().journal);
  changed.state.board.units[0].col=8;
  rejected(replay(changed),'FOOT_JOURNAL_STATE_DRIFT');
  rejected(append({journal:changed,command:command('reserve',3,at(3,6)),
    idempotencyKey:KEY_B}),'FOOT_JOURNAL_STATE_DRIFT');
});

test('foot journal: forged signature or command is not replayable',()=>{
  const changed=structuredClone(first().journal);
  changed.entries[0].signature='CCW_FOOT_STEP_V1:injected';
  rejected(replay(changed),'INVALID_FOOT_JOURNAL_ENTRY');
  const wrong=structuredClone(first().journal);
  wrong.entries[0].command.unitId='reserve';
  rejected(replay(wrong),'INVALID_FOOT_JOURNAL_ENTRY');
});

test('foot journal: tampered public event or transition cannot pass replay',()=>{
  const altered=structuredClone(first().journal);
  altered.entries[0].publicEventProposal.to.col=7;
  rejected(replay(altered),'INVALID_FOOT_JOURNAL_REPLAY');
  const metadata=structuredClone(first().journal);
  metadata.entries[0].publicEventProposal.privateHand=['SECRET'];
  rejected(replay(metadata),'INVALID_FOOT_JOURNAL_REPLAY');
  const from=structuredClone(first().journal);
  from.entries[0].transition.from.col=9;
  rejected(replay(from),'INVALID_FOOT_JOURNAL_REPLAY');
});

test('foot journal: duplicate idempotency keys in private history are invalid',()=>{
  const one=first(),two=append({
    journal:one.journal,command:command('reserve',3,at(3,6)),idempotencyKey:KEY_B
  });
  const altered=structuredClone(two.journal);
  altered.entries[1].idempotencyKey=KEY_A;
  rejected(replay(altered),'INVALID_FOOT_JOURNAL_ENTRY');
});

test('foot journal: order of object keys has no effect on stored state equality',()=>{
  const j=structuredClone(first().journal);
  j.state.board.units[0]=Object.fromEntries(
    Object.entries(j.state.board.units[0]).reverse());
  j.entries[0].transition=Object.fromEntries(
    Object.entries(j.entries[0].transition).reverse());
  j.entries[0].publicEventProposal=Object.fromEntries(
    Object.entries(j.entries[0].publicEventProposal).reverse());
  assert.equal(replay(j).status,'PRIVATE_FOOT_JOURNAL_REPLAY_CANDIDATE');
});

test('foot journal: unknown version, entry fields or initial state drift fail closed',()=>{
  const invalid=[
    j=>j.schemaVersion=2,
    j=>j.kind='IMPOSTOR',
    j=>j.entries[0].newSecret='x',
    j=>j.initialState.board.units[0].col=5,
    j=>j.policy.unitTypes.unitA='ELEPHANT',
    j=>j.extraPermission=true
  ];
  for(const change of invalid){
    const j=structuredClone(first().journal);change(j);
    assert.equal(replay(j).status,'BLOCKED');
  }
});

test('foot journal: no partial read for accessor, sparse array or malicious symbols',()=>{
  const base=structuredClone(first().journal),hit=[];
  Object.defineProperty(base.entries[0].command,'unitId',{
    enumerable:true,get(){hit.push('GET');throw Error('GETTER');}
  });
  rejected(replay(base),'INVALID_FOOT_JOURNAL');
  assert.deepEqual(hit,[]);
  const sparse=structuredClone(first().journal);
  sparse.entries=new Array(1);
  rejected(replay(sparse),'INVALID_FOOT_JOURNAL');
  const symbol=structuredClone(first().journal);
  symbol.entries[0][Symbol('stealth')]=true;
  rejected(replay(symbol),'INVALID_FOOT_JOURNAL');
});

test('foot journal: deep copy and event proposal remain frozen even if inputs mutate',()=>{
  const original=ready(),cmd=command();
  const result=append({journal:original,command:cmd,idempotencyKey:KEY_A});
  const before=structuredClone(result.journal);
  cmd.to.col=12;
  assert.deepEqual(result.journal,before);
  for(const part of [result.journal,result.journal.entries,result.journal.entries[0],
    result.journal.entries[0].command,result.journal.entries[0].command.to,
    result.publicEventProposal,result.publicEventProposal.to])
    assert.equal(Object.isFrozen(part),true);
  assert.throws(()=>{result.journal.entries.push({})},TypeError);
});

test('foot journal: full journal cannot be published as an official event',()=>{
  const result=first();
  assert.notEqual(result.publicEventProposal.type,'ANCIENTS_MOVEMENT_COMMITTED_V1');
  assert.equal(result.publicEventProposal.visibility,'public');
  assert.equal(JSON.stringify(result.publicEventProposal).includes(
    result.journal.entries[0].signature),false);
  assert.equal(result.canCommit,false);
  assert.equal(result.officialMovementAuthorized,false);
});

test('foot journal: anchored replay agrees with independent server initial state and policy',()=>{
  const journal=first().journal;
  const result=anchored({
    journal, trustedInitialState:game(),trustedPolicy:rules(),rowRevision:3
  });
  assert.equal(result.status,'PRIVATE_FOOT_JOURNAL_ANCHORED_CANDIDATE');
  assert.equal(result.rowRevision,3);
  assert.equal(result.entryCount,1);
  assert.equal(result.journal,null);
  assert.deepEqual(result.replayedState,journal.state);
  assert.equal(result.canCommit,false);
  assert.equal(result.movementAuthorized,false);
});

test('foot journal: policy or initial board provenance drift prevents an anchored replay',()=>{
  const journal=first().journal;
  const policy=rules();policy.unitTypes.unitA='HEAVY_INFANTRY';
  rejected(anchored({journal,trustedInitialState:game(),
    trustedPolicy:policy,rowRevision:3}),'FOOT_JOURNAL_PROVENANCE_DRIFT');
  const initial=game();initial.board.units[0].col=4;
  rejected(anchored({journal,trustedInitialState:initial,
    trustedPolicy:rules(),rowRevision:3}),'FOOT_JOURNAL_PROVENANCE_DRIFT');
});

test('foot journal: database revision must match the replayed revision',()=>{
  const journal=first().journal;
  rejected(anchored({journal,trustedInitialState:game(),
    trustedPolicy:rules(),rowRevision:2}),'FOOT_JOURNAL_ROW_REVISION_DRIFT');
  rejected(anchored({journal,trustedInitialState:game(),
    trustedPolicy:rules(),rowRevision:4}),'FOOT_JOURNAL_ROW_REVISION_DRIFT');
});

test('foot journal: no anchor or invalid revision cannot be used as provenance',()=>{
  const journal=first().journal;
  for(const params of [
    {journal},
    {journal,trustedInitialState:game(),rowRevision:3},
    {journal,trustedPolicy:rules(),rowRevision:3},
    {journal,trustedInitialState:game(),trustedPolicy:rules(),rowRevision:'3'},
    {journal,trustedInitialState:game(),trustedPolicy:rules(),rowRevision:-1}
  ])rejected(anchored(params),'FOOT_JOURNAL_ANCHOR_REQUIRED');
});

test('foot journal: anchored consistency is semantic, not dependent on JSON key order',()=>{
  const journal=JSON.parse(JSON.stringify(first().journal));
  const initial=Object.fromEntries(Object.entries(game()).reverse());
  const policy=Object.fromEntries(Object.entries(rules()).reverse());
  assert.equal(anchored({journal,trustedInitialState:initial,trustedPolicy:policy,
    rowRevision:3}).status,'PRIVATE_FOOT_JOURNAL_ANCHORED_CANDIDATE');
});

test('foot journal: even a trusted anchor never accepts a corrupted persisted step',()=>{
  const journal=structuredClone(first().journal);
  journal.entries[0].transition.to.col=9;
  rejected(anchored({journal,trustedInitialState:game(),
    trustedPolicy:rules(),rowRevision:3}),'INVALID_FOOT_JOURNAL_REPLAY');
});

test('foot journal: explicitly occupied adjacent destination is refused',()=>{
  const initial=game();
  initial.board.units[1].col=3;initial.board.units[1].row=4;
  const firstRecord=initialize({initialState:initial,policy:rules()});
  assert.equal(firstRecord.status,'PRIVATE_FOOT_JOURNAL_INITIAL_CANDIDATE');
  const result=append({
    journal:firstRecord.journal,command:command(),idempotencyKey:KEY_A
  });
  rejected(result,'OCCUPIED_DESTINATION');
});

test('foot journal: Proxy get traps on arrays or nested command fields never run',()=>{
  const journal=structuredClone(first().journal),access=[];
  journal.entries=new Proxy(journal.entries,{
    get(){access.push('entries.GET');throw Error('MALICIOUS_ARRAY_GET')}
  });
  journal.entries[0].command.to=new Proxy(journal.entries[0].command.to,{
    get(){access.push('coordinate.GET');throw Error('MALICIOUS_CELL_GET')}
  });
  const result=replay(journal);
  assert.equal(result.status,'PRIVATE_FOOT_JOURNAL_REPLAY_CANDIDATE');
  assert.deepEqual(access,[]);
});

test('foot journal: oversized or sparse persisted histories never replay',()=>{
  const long=structuredClone(first().journal);
  long.entries=new Array(118).fill(long.entries[0]);
  rejected(replay(long),'INVALID_FOOT_JOURNAL');
  const sparse=structuredClone(first().journal);
  sparse.entries[2]=sparse.entries[0];
  rejected(replay(sparse),'INVALID_FOOT_JOURNAL');
});
