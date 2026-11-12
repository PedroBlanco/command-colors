import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CANDIDATE_JOURNAL_KIND,buildAncientsCandidateJournal as build,
  verifyAncientsCandidateJournal as verify} from './movement-candidate-journal.mjs';

const matchId='123e4567-e89b-42d3-a456-426614174000';
const at=(col,row)=>({col,row});
const unit=(id,side,col,row,type='HEAVY_INFANTRY')=>({id,side,col,row,type});
const leader=(id,side,col,row)=>({id,side,col,row});
const action=(kind,id,...path)=>({kind,id,path:path.map(([col,row])=>at(col,row))});
const first=()=>action('LEADER','captain',[2,5]);
const second=()=>action('UNIT','front',[3,4]);
const fixture=()=>({
  matchId,actor:'A',baseRevision:2,
  units:[unit('front','A',2,4,'LIGHT_INFANTRY'),
    unit('reserve','A',2,6),unit('foe','B',10,4)],
  leaders:[leader('captain','A',2,4),leader('foeLeader','B',10,4)],
  orderedUnitIds:['front','reserve'],
  orderedLeaderIds:['captain'],terrain:[],
  actions:[first(),second()]
});

test('candidate journal contains sequential evidence, never movement permission',()=>{
  const input=fixture(),before=structuredClone(input);
  const r=build(input);
  assert.equal(r.status,'CANDIDATE_EVIDENCE');
  assert.equal(r.reason,null);
  assert.equal(r.journal.kind,CANDIDATE_JOURNAL_KIND);
  assert.equal(r.journal.matchId,matchId);
  assert.equal(r.journal.baseRevision,2);
  assert.equal(r.journal.entries.length,2);
  assert.deepEqual(r.journal.entries.map(e=>e.sequence),[1,2]);
  assert.deepEqual(r.journal.entries.map(e=>e.pieceKind),['LEADER','UNIT']);
  assert.deepEqual(r.journal.entries.map(e=>e.pieceId),['captain','front']);
  assert.equal(r.journal.entries[0].detachedFromUnit,'front');
  assert.equal(r.journal.entries[1].leaderCarried,null);
  assert.equal(r.journal.entries[0].previousDigest,r.journal.contextDigest);
  assert.equal(r.journal.entries[1].previousDigest,r.journal.entries[0].digest);
  assert.equal(r.journal.finalDigest,r.journal.entries[1].digest);
  assert.match(r.journal.finalDigest,/^[a-f0-9]{64}$/);
  assert.equal(r.journal.movementAuthorized,false);
  assert.equal(r.journal.attackAuthorized,false);
  assert.equal(r.journal.stateChanged,false);
  assert.equal(r.journal.needsFullLegalityCheck,true);
  assert.deepEqual(input,before);
});

test('journal replay matches only trusted matching scenario, orders and actions',()=>{
  const input=fixture(),r=build(input);
  assert.equal(verify({...input,journal:r.journal}),true);
  assert.equal(verify({...input,actor:'B',journal:r.journal}),false);
  assert.equal(verify({...input,baseRevision:3,journal:r.journal}),false);
  assert.equal(verify({...input,orderedUnitIds:['front'],journal:r.journal}),false);
  assert.equal(verify({...input,actions:[first()],journal:r.journal}),false);
});

test('editing even one path hex or step breaks verification',()=>{
  const input=fixture(),r=build(input),altered=structuredClone(r.journal);
  altered.entries[0].path[0].col=3;
  assert.equal(verify({...input,journal:altered}),false);
  const altered2=structuredClone(r.journal);
  altered2.entries[1].digest='a'.repeat(64);
  assert.equal(verify({...input,journal:altered2}),false);
  const altered3=structuredClone(r.journal);
  altered3.finalDigest='b'.repeat(64);
  assert.equal(verify({...input,journal:altered3}),false);
});

test('inserting private or unauthorized extra fields in the journal is rejected',()=>{
  const input=fixture(),r=build(input);
  assert.equal(verify({...input,journal:{...r.journal,privateHand:['secret']}}),false);
  assert.equal(verify({...input,journal:{...r.journal,
    entries:r.journal.entries.map(e=>({...e,cardInstanceId:'secret'}))}}),false);
  assert.equal(verify({...input,journal:null}),false);
  assert.equal(verify({...input,journal:[]}),false);
});

test('board and terrain changes alter the evidence even if the move remains a candidate',()=>{
  const input=fixture(),journal=build(input).journal;
  assert.equal(verify({...input,terrain:[{col:9,row:8,kind:'HILL'}],
    journal}),false);
  const withExtra={...input,units:[...input.units,unit('remote','B',9,8)]};
  assert.equal(build(withExtra).status,'CANDIDATE_EVIDENCE');
  assert.equal(verify({...withExtra,journal}),false);
});

test('equivalent ordering of unrelated board pieces and orders gives deterministic digest',()=>{
  const input=fixture(),firstBuild=build(input);
  const permuted={
    ...input,units:[...input.units].reverse(),
    leaders:[...input.leaders].reverse(),
    orderedUnitIds:[...input.orderedUnitIds].reverse(),
    actions:input.actions.map(a=>({path:a.path.map(c=>({row:c.row,col:c.col})),
      id:a.id,kind:a.kind}))
  };
  const secondBuild=build(permuted);
  assert.deepEqual(secondBuild.journal,firstBuild.journal);
  assert.equal(verify({...permuted,journal:firstBuild.journal}),true);
});

test('blocked move never creates partial trace or hash-chain entries',()=>{
  const input=fixture();
  const blocked=build({...input,actions:[second(),first()]});
  assert.equal(blocked.status,'BLOCKED');
  assert.equal(blocked.reason,'LEADER_ALREADY_MOVED');
  assert.equal(blocked.step,1);
  assert.equal(blocked.journal,null);
  assert.equal(blocked.movementAuthorized,false);
  assert.equal(blocked.stateChanged,false);
  assert.equal(verify({...input,actions:[second(),first()],
    journal:build(input).journal}),false);
});

test('invalid actor, revision, id, or untrusted input cannot produce evidence',()=>{
  const input=fixture();
  for(const patch of [
    {matchId:'bogus'}, {actor:'BADDY'}, {baseRevision:-1},
    {baseRevision:1.2}, {actions:[]},
    {orderedLeaderIds:['foeLeader']},
    {actions:[{...first(),path:[{col:2,row:5,actor:'B'}]}]}
  ]) assert.throws(()=>build({...input,...patch}),/INVALID_CANDIDATE_JOURNAL_SCOPE|INVALID_SEQUENCE_CONTEXT/);
});

test('journal, nested paths and entries are frozen against accidental edits',()=>{
  const input=fixture(),r=build(input),journal=r.journal;
  for(const target of [journal,journal.entries,journal.entries[0],
    journal.entries[0].path,journal.entries[0].path[0],journal.entries[1].from])
    assert.equal(Object.isFrozen(target),true);
  assert.throws(()=>{journal.entries[0].path[0].col=12;},TypeError);
  assert.deepEqual(input.actions[0].path,[at(2,5)]);
});

test('digest is native SHA-256 over the prior digest and canonical move tuple',()=>{
  const input=fixture(),r=build(input);
  const firstEntry=r.journal.entries[0];
  const expected=createHash('sha256').update(JSON.stringify([
    firstEntry.previousDigest,1,'LEADER','captain',[2,4],[[2,5]],[2,5],
    null,null,'front',null
  ])).digest('hex');
  assert.equal(firstEntry.digest,expected);
});
