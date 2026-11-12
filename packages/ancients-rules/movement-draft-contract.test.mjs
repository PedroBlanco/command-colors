import test from 'node:test';
import assert from 'node:assert/strict';
import {MOVEMENT_DRAFT_KIND, assertMovementDraft, proposeMovementDraft,
  projectMovementDraft} from './movement-draft-contract.mjs';

const MATCH='123e4567-e89b-42d3-a456-426614174000';
const actions=()=>[{kind:'LEADER',id:'captain',path:[{col:2,row:5}]},
  {kind:'UNIT',id:'front',path:[{col:3,row:4}]}];
const proposal=(overrides={})=>({
  matchId:MATCH,actor:'A',gameRevision:2,expectedDraftRevision:0,
  idempotencyKey:'draft_first_0001',actions:actions(),...overrides
});
const save=(overrides={})=>proposeMovementDraft(proposal(overrides));

test('private candidate is a draft, not a movement or a public event',()=>{
  const original=proposal(),before=structuredClone(original);
  const stored=proposeMovementDraft(original);
  assert.equal(stored.ok,true);
  assert.equal(stored.code,'DRAFT_STORED');
  assert.equal(stored.draft.kind,MOVEMENT_DRAFT_KIND);
  assert.equal(stored.draft.draftRevision,1);
  assert.equal(stored.draft.gameRevision,2);
  assertMovementDraft(stored.draft,MATCH);
  const view=projectMovementDraft({
    draft:stored.draft,matchId:MATCH,actor:'A',gameRevision:2
  });
  assert.deepEqual(view.actions,actions());
  assert.equal(view.movementAuthorized,false);
  assert.equal(view.attackAuthorized,false);
  assert.equal(view.stateChanged,false);
  assert.equal(view.needsFullLegalityCheck,true);
  assert.equal('signature' in view,false);
  assert.equal('idempotencyKey' in view,false);
  assert.deepEqual(original,before);
});

test('same request key retries without incrementing revision',()=>{
  const first=save();
  const retry=save({previous:first.draft});
  assert.equal(retry.code,'ALREADY_APPLIED');
  assert.deepEqual(retry.draft,first.draft);
  assert.equal(retry.draft.draftRevision,1);
});

test('different payload with same idempotency key is rejected',()=>{
  const first=save();
  const conflict=save({previous:first.draft,
    actions:[{kind:'LEADER',id:'captain',path:[{col:2,row:6}]}]});
  assert.deepEqual(conflict,{ok:false,code:'IDEMPOTENCY_KEY_REUSED'});
});

test('draft revision provides optimistic concurrency and monotonic edits',()=>{
  const first=save();
  assert.deepEqual(save({previous:first.draft,idempotencyKey:'draft_second_02'}),
    {ok:false,code:'STALE_DRAFT_REVISION'});
  const changed=save({previous:first.draft,expectedDraftRevision:1,
    idempotencyKey:'draft_second_02',actions:[actions()[0]]});
  assert.equal(changed.code,'DRAFT_STORED');
  assert.equal(changed.draft.draftRevision,2);
  assert.deepEqual(projectMovementDraft({draft:changed.draft,matchId:MATCH,
    actor:'A',gameRevision:2}).actions,[actions()[0]]);
});

test('opponent cannot see draft, even while sharing the same match',()=>{
  const draft=save().draft;
  assert.equal(projectMovementDraft({
    draft,matchId:MATCH,actor:'B',gameRevision:2}),null);
  assert.equal(projectMovementDraft({
    draft,matchId:MATCH,actor:'A',gameRevision:3}),null);
  assert.equal(projectMovementDraft({
    draft:null,matchId:MATCH,actor:'A',gameRevision:2}),null);
});

test('next game revision or actor starts a fresh private proposal namespace',()=>{
  const draft=save().draft;
  const next=save({previous:draft,actor:'B',gameRevision:3,
    idempotencyKey:'draft_opponent01'});
  assert.equal(next.code,'DRAFT_STORED');
  assert.equal(next.draft.draftRevision,1);
  assert.equal(next.draft.actor,'B');
  assert.equal(projectMovementDraft({draft:next.draft,matchId:MATCH,
    actor:'A',gameRevision:3}),null);
});

test('stored data validates its checksum and rejects tampering',()=>{
  const draft=save().draft;
  for(const altered of [
    {...draft,actor:'B'},
    {...draft,actions:[{...draft.actions[0],path:[{col:9,row:8}]}]},
    {...draft,signature:'0'.repeat(64)},
    {...draft,unexpected:'private'},
    {...draft,draftRevision:0}
  ]) {
    assert.throws(()=>assertMovementDraft(altered,MATCH),
      /SECTION_LAB_MOVEMENT_DRAFT_CORRUPT/);
  }
  assert.throws(()=>assertMovementDraft(draft,'00000000-0000-4000-8000-000000000000'),
    /SECTION_LAB_MOVEMENT_DRAFT_CORRUPT/);
});

test('invalid IDs, paths and keys cannot be stored as a draft',()=>{
  const wrong=[
    {actor:'opponent'},
    {matchId:'not-a-uuid'},
    {gameRevision:-1},
    {expectedDraftRevision:1.5},
    {idempotencyKey:'bad'},
    {actions:[]},
    {actions:[{kind:'LEADER',id:'__proto__',path:[{col:2,row:5}]}]},
    {actions:[{kind:'LEADER',id:'captain',path:[{col:15,row:5}]}]},
    {actions:[{kind:'LEADER',id:'captain',path:[{col:2,row:5,actor:'B'}]}]},
    {actions:[{kind:'LEADER',id:'captain',path:[{col:2,row:5}],actor:'B'}]}
  ];
  for(const patch of wrong)assert.throws(()=>save(patch),
    /INVALID_MOVEMENT_DRAFT_REQUEST/);
});

test('editing a draft never mutates the previous record or caller actions',()=>{
  const first=save();
  const before=structuredClone(first.draft),input=actions();
  const next=save({previous:first.draft,idempotencyKey:'draft_new_0003',
    expectedDraftRevision:1,actions:input});
  assert.equal(next.ok,true);
  input[0].path[0].col=8;
  assert.deepEqual(first.draft,before);
  assert.equal(next.draft.actions[0].path[0].col,2);
});
