import test from 'node:test';
import assert from 'node:assert/strict';
import {ANCIENTS_RULESET} from './movement-profile.mjs';
import {CORE_OPEN_FOOT_KIND,CORE_OPEN_FOOT_POLICY}
  from './core-open-foot-movement.mjs';
import {initializeFootMovementJournal,proposeFootMovementJournalAppend}
  from './foot-movement-journal.mjs';
import {FOOT_ATOMIC_ENVELOPE_KIND,prepareFootAtomicCommitEnvelope as prepare}
  from './foot-atomic-commit-envelope.mjs';

const MATCH='11111111-2222-4333-8444-555555555555';
const OTHER='99999999-8888-4777-8666-555555555555';
const KEY='foot_atomic_new_0001';
const board=()=>({
  kind:CORE_OPEN_FOOT_KIND,schemaVersion:1,ruleset:ANCIENTS_RULESET,
  revision:2,turn:'A',phase:'MOVE',
  board:{units:[
    {id:'unitA',side:'A',col:2,row:4},
    {id:'enemy',side:'B',col:10,row:4}
  ],leaders:[]},
  orderLedger:{issuedUnitIds:['unitA'],movedUnitIds:[]}
});
const policy=()=>({
  scope:CORE_OPEN_FOOT_POLICY,ruleset:ANCIENTS_RULESET,
  cardFamily:'ORDINARY_SECTION',terrain:[],scenarioExceptions:[],
  unitTypes:{unitA:'LIGHT_INFANTRY',enemy:'HEAVY_INFANTRY'}
});
const historyCommands=()=>[
  {match_id:MATCH,actor:'A',idem_key:'section_card_001',committed_revision:1},
  {match_id:MATCH,actor:'A',idem_key:'section_order_002',committed_revision:2}
];
const historyEvents=()=>[
  {match_id:MATCH,sequence:1,visibility:'public'},
  {match_id:MATCH,sequence:2,visibility:'public'}
];
const journal=()=>{
  const initial=initializeFootMovementJournal({
    matchId:MATCH,initialState:board(),policy:policy()
  });
  assert.equal(initial.status,'PRIVATE_FOOT_JOURNAL_INITIAL_CANDIDATE');
  const result=proposeFootMovementJournalAppend({
    journal:initial.journal,idempotencyKey:KEY,
    command:{actor:'A',expectedRevision:2,unitId:'unitA',to:{col:3,row:4}}
  });
  assert.equal(result.status,'PRIVATE_FOOT_JOURNAL_APPEND_CANDIDATE');
  return result.journal;
};
const args=()=>({
  journal:journal(),trustedMatchId:MATCH,
  trustedInitialState:board(),trustedPolicy:policy(),
  currentGameRevision:2,
  recordedCommands:historyCommands(),recordedEvents:historyEvents()
});
const blocked=(value,reason)=>{
  assert.equal(value.status,'BLOCKED');
  assert.equal(value.reason,reason);
  assert.equal(value.envelope,null);
  assert.equal(value.canCommit,false);
  assert.equal(value.movementAuthorized,false);
  assert.equal(value.publicEventWritten,false);
};

test('foot atomic envelope: one verified foot proposal creates immutable nonexecuting records',()=>{
  const input=args(),before=structuredClone(input);
  const result=prepare(input);
  assert.equal(result.status,'PRIVATE_FOOT_ATOMIC_ENVELOPE_CANDIDATE',result.reason);
  assert.equal(result.kind,FOOT_ATOMIC_ENVELOPE_KIND);
  assert.deepEqual([result.envelope.expectedGameRevision,
    result.envelope.proposedGameRevision],[2,3]);
  assert.equal(result.envelope.matchId,MATCH);
  assert.deepEqual(result.envelope.commandRowProposal,{
    match_id:MATCH,actor:'A',idem_key:KEY,
    signature:input.journal.entries[0].signature,committed_revision:3
  });
  assert.deepEqual(result.envelope.publicEventRowProposal,{
    match_id:MATCH,sequence:3,visibility:'public',
    payload:input.journal.entries[0].publicEventProposal
  });
  assert.equal(result.envelope.privateBoardStateProposal.revision,3);
  assert.equal(result.envelope.privateBoardStateProposal.board.units[0].col,3);
  assert.equal(result.canCommit,false);
  assert.equal(result.officialMovementAuthorized,false);
  assert.equal(result.gameRevisionChanged,false);
  assert.equal(result.dbChanged,false);
  assert.deepEqual(input,before);
});

test('foot atomic envelope: private idempotency never appears in public event payload',()=>{
  const result=prepare(args());
  assert.equal(result.status,'PRIVATE_FOOT_ATOMIC_ENVELOPE_CANDIDATE');
  const payload=JSON.stringify(result.envelope.publicEventRowProposal);
  for(const forbidden of [KEY,'section_order_002','signature','sessionToken',
    'handAtPlay','drawPile','ANCIENTS_MOVEMENT_COMMITTED_V1'])
    assert.equal(payload.includes(forbidden),false);
  assert.equal(result.envelope.publicEventRowProposal.payload.type,
    'FOOT_STEP_PUBLIC_EVENT_PROPOSAL_V1');
});

test('foot atomic envelope: source and output are deeply immutable, not aliased',()=>{
  const source=args(),result=prepare(source);
  assert.equal(result.status,'PRIVATE_FOOT_ATOMIC_ENVELOPE_CANDIDATE');
  for(const part of [result,result.envelope,result.envelope.commandRowProposal,
    result.envelope.publicEventRowProposal,
    result.envelope.publicEventRowProposal.payload,
    result.envelope.privateBoardStateProposal,
    result.envelope.privateBoardStateProposal.board.units[0]])
    assert.equal(Object.isFrozen(part),true);
  assert.notEqual(result.envelope.privateBoardStateProposal,source.journal.state);
  source.journal.state.board.units[0].col=9;
  source.recordedCommands[0].idem_key='tamper_000001';
  assert.equal(result.envelope.privateBoardStateProposal.board.units[0].col,3);
  assert.equal(result.envelope.commandRowProposal.idem_key,KEY);
  assert.throws(()=>{result.envelope.commandRowProposal.actor='B'},TypeError);
});

test('foot atomic envelope: JSON persisted source replays identically',()=>{
  const input=args(),value=prepare(JSON.parse(JSON.stringify(input)));
  assert.equal(value.status,'PRIVATE_FOOT_ATOMIC_ENVELOPE_CANDIDATE');
  assert.deepEqual(prepare(input),value);
});

test('foot atomic envelope: order of existing SQL rows is irrelevant but all revisions are required',()=>{
  const input=args();
  input.recordedCommands.reverse();input.recordedEvents.reverse();
  assert.equal(prepare(input).status,'PRIVATE_FOOT_ATOMIC_ENVELOPE_CANDIDATE');
  input.recordedEvents.pop();
  blocked(prepare(input),'FOOT_ATOMIC_PRIOR_REVISIONS_UNVERIFIED');
});

test('foot atomic envelope: duplicate, missing and out-of-range command revisions block',()=>{
  for(const change of [
    rows=>rows[1].committed_revision=1,
    rows=>rows[0].committed_revision=0,
    rows=>rows[1].committed_revision=3,
    rows=>rows[0].committed_revision='1',
    rows=>rows[0].extra='untrusted'
  ]){
    const input=args();change(input.recordedCommands);
    blocked(prepare(input),'FOOT_ATOMIC_PRIOR_REVISIONS_UNVERIFIED');
  }
});

test('foot atomic envelope: duplicate or hidden events never form an official record',()=>{
  for(const change of [
    rows=>rows[1].sequence=1,
    rows=>rows[1].sequence=3,
    rows=>rows[1].visibility='private',
    rows=>rows[0].match_id=OTHER,
    rows=>rows[0].payload={}
  ]){
    const input=args();change(input.recordedEvents);
    blocked(prepare(input),'FOOT_ATOMIC_PRIOR_REVISIONS_UNVERIFIED');
  }
});

test('foot atomic envelope: prior SQL command keys may not duplicate within one actor',()=>{
  const input=args();
  input.recordedCommands[1].idem_key='section_card_001';
  blocked(prepare(input),'FOOT_ATOMIC_PRIOR_REVISIONS_UNVERIFIED');
});

test('foot atomic envelope: next command key cannot collide with an existing row',()=>{
  const input=args();
  input.recordedCommands[1].idem_key=KEY;
  blocked(prepare(input),'FOOT_ATOMIC_IDEMPOTENCY_KEY_OCCUPIED');
});

test('foot atomic envelope: same key used by other actor does not collide',()=>{
  const input=args();
  input.recordedCommands[1].actor='B';
  input.recordedCommands[1].idem_key=KEY;
  assert.equal(prepare(input).status,'PRIVATE_FOOT_ATOMIC_ENVELOPE_CANDIDATE');
});

test('foot atomic envelope: wrong match in SQL history or independent anchor blocks',()=>{
  for(const mutate of [
    a=>a.trustedMatchId=OTHER,
    a=>a.recordedCommands[0].match_id=OTHER,
    a=>a.recordedEvents[0].match_id=OTHER
  ]){
    const input=args();mutate(input);
    assert.equal(prepare(input).status,'BLOCKED');
  }
});

test('foot atomic envelope: independent initial board or policy drift blocks',()=>{
  const a=args();a.trustedInitialState.board.units[0].col=4;
  blocked(prepare(a),'FOOT_ATOMIC_ANCHOR_UNVERIFIED');
  const b=args();b.trustedPolicy.unitTypes.unitA='HEAVY_INFANTRY';
  blocked(prepare(b),'FOOT_ATOMIC_ANCHOR_UNVERIFIED');
});

test('foot atomic envelope: stale or fabricated current revision blocks',()=>{
  for(const revision of [0,1,3,Number.MAX_SAFE_INTEGER]){
    const input=args();input.currentGameRevision=revision;
    assert.equal(prepare(input).status,'BLOCKED');
  }
  for(const revision of [-1,'2',1.2,null]){
    const input=args();input.currentGameRevision=revision;
    blocked(prepare(input),'INVALID_FOOT_ATOMIC_SCOPE');
  }
});

test('foot atomic envelope: journal cannot smuggle two proposed steps into one transaction',()=>{
  const input=args();
  const next=proposeFootMovementJournalAppend({
    journal:input.journal,idempotencyKey:'foot_atomic_new_0002',
    command:{actor:'A',expectedRevision:3,unitId:'unitA',to:{col:4,row:4}}
  });
  assert.equal(next.status,'BLOCKED');
  const altered=structuredClone(input.journal);
  altered.entries.push(altered.entries[0]);
  blocked(prepare({...input,journal:altered}),'FOOT_ATOMIC_ANCHOR_UNVERIFIED');
});

test('foot atomic envelope: corrupted transitions, signatures and events never become proposals',()=>{
  for(const change of [
    j=>j.entries[0].signature='forged',
    j=>j.entries[0].transition.from.col=8,
    j=>j.entries[0].publicEventProposal.to.col=7,
    j=>j.state.revision=4,
    j=>j.entries[0].command.actor='B'
  ]){
    const input=args();change(input.journal);
    blocked(prepare(input),'FOOT_ATOMIC_ANCHOR_UNVERIFIED');
  }
});

test('foot atomic envelope: getter, sparse array and symbol fields rejected before reads',()=>{
  const getter=args(),hits=[];
  Object.defineProperty(getter.journal.entries[0].command,'unitId',{
    enumerable:true,get(){hits.push('GET');throw Error('UNTRUSTED_GETTER')}
  });
  blocked(prepare(getter),'INVALID_FOOT_ATOMIC_INPUT');
  assert.deepEqual(hits,[]);
  const sparse=args();
  sparse.recordedEvents=new Array(2);
  blocked(prepare(sparse),'INVALID_FOOT_ATOMIC_INPUT');
  const symbol=args();
  symbol.recordedCommands[0][Symbol('secret')]=true;
  blocked(prepare(symbol),'INVALID_FOOT_ATOMIC_INPUT');
});

test('foot atomic envelope: no Proxy property GET trap is executed on trusted-row snapshots',()=>{
  const input=args(),access=[];
  input.recordedCommands=new Proxy(input.recordedCommands,{
    get(){access.push('GET');throw Error('UNTRUSTED_GET')}
  });
  assert.equal(prepare(input).status,'PRIVATE_FOOT_ATOMIC_ENVELOPE_CANDIDATE');
  assert.deepEqual(access,[]);
});

test('foot atomic envelope: no input can override authority or sneak an executable SQL plan',()=>{
  for(const key of ['actor','clientProof','canCommit','writeSql','sessionToken']){
    const input=args();input[key]=true;
    // Unrecognized top-level options are not part of the returned envelope,
    // but callers MUST NEVER use them as authority.
    const result=prepare(input);
    assert.equal(result.status,'PRIVATE_FOOT_ATOMIC_ENVELOPE_CANDIDATE');
    assert.equal(result.canCommit,false);
    assert.equal(result.dbChanged,false);
    assert.equal(Object.hasOwn(result.envelope,key),false);
  }
});
