import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openAncientsReservationLab} from './sqlite-reservation-lab.mjs';

const MATCH='123e4567-e89b-42d3-a456-426614174000';
const OTHER='123e4567-e89b-42d3-a456-426614174001';
const turn=(updates={})=>({schemaVersion:1,ruleset:'ancients-base-3e-2009',
  status:'ACTIVE',revision:4,turn:'A',phase:'COMBAT',
  orderedUnitIds:['a1'],resolvedBattleUnitIds:[],movedStepsByUnit:{a1:0},
  pendingCombat:null,pendingDecision:null,...updates});
const board=()=>({units:[{id:'a1',side:'A',col:2,row:4,type:'LIGHT_BOW_INFANTRY'},
  {id:'b1',side:'B',col:5,row:4,type:'HEAVY_INFANTRY'}],leaders:[],terrain:[],
  internalSecret:'NOT_FOR_EVENTS_OR_RESPONSES'});
// An injected stand-in strictly for testing transaction mechanics, not rules.
const checker=({turnState,sessionSide,attackerId,targetId,expectedRevision})=>({
  status: turnState.revision===expectedRevision && turnState.status==='ACTIVE' &&
    turnState.turn===sessionSide && turnState.phase==='COMBAT' &&
    turnState.orderedUnitIds.includes(attackerId) && targetId==='b1' &&
    !turnState.pendingCombat && !turnState.pendingDecision &&
    !turnState.resolvedBattleUnitIds.includes(attackerId) ? 'CANDIDATE':'BLOCKED',
  attackAuthorized:false,needsFullLegalityCheck:true
});
const cmd=(changes={})=>({matchId:MATCH,sessionUserId:'alice',expectedRevision:4,
  attackerId:'a1',targetId:'b1',idempotencyKey:'combat_key_0001',...changes});
function fixture(fn, config={}) {
  const dir=mkdtempSync(join(tmpdir(),'ccw-reservation-lab-'));
  const file=join(dir,'reservations.sqlite'),instances=[];
  const open=(changes={})=>{const v=openAncientsReservationLab({file,checkDeclaration:checker,...changes});
    instances.push(v);return v;};
  try {return fn({file,open,seed:(s=open(),id=MATCH,overrides={})=>{
    s.seedFixture({matchId:id,ownerId:'alice',guestId:'bob',turnState:turn(),board:board(),...overrides});return s;
  }});} finally {
    for(const s of instances.reverse())try{s.close();}catch{}
    rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});
  }
}

test('SQLite laboratory uses dedicated application id and only three tables',()=>fixture(({open})=>{
  const s=open(),db=s.unsafeTestDatabase();
  assert.equal(db.prepare('PRAGMA application_id').get().application_id,0x4343524c);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
    .all().map(x=>x.name),['lab_commands','lab_events','lab_matches']);
}));

test('successful reservation atomically writes pending marker, revision, event and key',()=>fixture(({seed})=>{
  const s=seed(),r=s.reserve(cmd());
  assert.equal(r.code,'SCREENING_RESERVED');assert.equal(r.status,200);
  assert.equal(r.attackAuthorized,false);assert.equal(r.fullValidationRequired,true);
  assert.equal(r.revision,5);assert.match(r.reservationId,/^[a-f0-9-]{36}$/i);
  const view=s.inspectFixture({matchId:MATCH,sessionUserId:'alice'});
  assert.equal(view.revision,5);assert.equal(view.turnState.revision,5);
  assert.equal(view.turnState.pendingCombat.reservationId,r.reservationId);
  assert.equal(view.turnState.pendingCombat.fullValidationRequired,true);
  assert.deepEqual(view.events,[{sequence:5,type:'RANGED_SCREENING_RESERVED',side:'A'}]);
  assert.equal(s.unsafeTestDatabase().prepare('SELECT COUNT(*) AS n FROM lab_commands').get().n,1);
}));

test('same key and semantic payload replay the original reservation',()=>fixture(({seed})=>{
  const s=seed(),a=s.reserve(cmd()),b=s.reserve(cmd());
  assert.equal(a.code,'SCREENING_RESERVED');assert.equal(b.code,'ALREADY_RESERVED');
  assert.equal(b.reservationId,a.reservationId);assert.equal(b.revision,5);
  assert.equal(s.inspectFixture({matchId:MATCH,sessionUserId:'bob'}).events.length,1);
}));

test('reuse of key for another target/revision is not accepted',()=>fixture(({seed})=>{
  const s=seed();s.reserve(cmd());
  assert.equal(s.reserve(cmd({targetId:'b2'})).code,'IDEMPOTENCY_KEY_REUSED');
  assert.equal(s.reserve(cmd({expectedRevision:5})).code,'IDEMPOTENCY_KEY_REUSED');
}));

test('new key with stale revision fails; new revision cannot ignore pending combat',()=>fixture(({seed})=>{
  const s=seed();s.reserve(cmd());
  assert.equal(s.reserve(cmd({idempotencyKey:'another_key_0001'})).code,'STALE_REVISION');
  assert.equal(s.reserve(cmd({expectedRevision:5,idempotencyKey:'another_key_0001'})).code,'DECLARATION_REJECTED');
  assert.equal(s.inspectFixture({matchId:MATCH,sessionUserId:'bob'}).events.length,1);
}));

test('non-participants cannot enumerate matches or replay a reservation',()=>fixture(({seed})=>{
  const s=seed(),valid=s.reserve(cmd());
  assert.equal(s.reserve(cmd({sessionUserId:'mallory'})).code,'NOT_FOUND');
  assert.equal(s.reserve(cmd({matchId:OTHER})).code,'NOT_FOUND');
  assert.equal(s.inspectFixture({matchId:MATCH,sessionUserId:'mallory'}),null);
  assert.equal(s.inspectFixture({matchId:MATCH,sessionUserId:'bob'}).events.length,1);
  assert.equal(s.reserve(cmd({sessionUserId:'bob',expectedRevision:5,idempotencyKey:'bob_key_000001'})).code,'DECLARATION_REJECTED');
  assert.equal(valid.attackAuthorized,false);
}));

test('validation failure leaves no reservation, key or event',()=>fixture(({seed})=>{
  const s=seed(),out=s.reserve(cmd({targetId:'bad_target'}));
  assert.equal(out.code,'DECLARATION_REJECTED');
  assert.equal(s.inspectFixture({matchId:MATCH,sessionUserId:'alice'}).revision,4);
  assert.equal(s.unsafeTestDatabase().prepare('SELECT COUNT(*) AS n FROM lab_commands').get().n,0);
}));

test('injected failure rolls back state, event and idempotency record',()=>fixture(({seed})=>{
  const s=seed(),db=s.unsafeTestDatabase();
  db.exec("CREATE TRIGGER fail_event BEFORE INSERT ON lab_events BEGIN SELECT RAISE(ABORT, 'SIMULATED_IO_ERROR'); END");
  assert.throws(()=>s.reserve(cmd()),/SIMULATED_IO_ERROR/);
  assert.equal(s.inspectFixture({matchId:MATCH,sessionUserId:'alice'}).revision,4);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lab_commands').get().n,0);
  db.exec('DROP TRIGGER fail_event');
  assert.equal(s.reserve(cmd()).code,'SCREENING_RESERVED');
}));

test('durable replay survives close and reopening SQLite',()=>fixture(({seed,open})=>{
  const s=seed(),original=s.reserve(cmd());s.close();
  const reopened=open(),result=reopened.reserve(cmd());
  assert.equal(result.code,'ALREADY_RESERVED');assert.equal(result.reservationId,original.reservationId);
  assert.equal(reopened.inspectFixture({matchId:MATCH,sessionUserId:'bob'}).revision,5);
}));

test('two SQLite connections serialize competitors; precisely one reservation commits',()=>fixture(({seed,open})=>{
  const first=seed(),second=open();
  const a=first.reserve(cmd({idempotencyKey:'race_key_0000001'}));
  const b=second.reserve(cmd({idempotencyKey:'race_key_0000002'}));
  assert.deepEqual([a.code,b.code],['SCREENING_RESERVED','STALE_REVISION']);
  assert.equal(second.inspectFixture({matchId:MATCH,sessionUserId:'bob'}).events.length,1);
}));

test('simulated validated checker is required to leave authorization false',()=>fixture(({open})=>{
  const permissive=open({checkDeclaration:()=>({status:'CANDIDATE',attackAuthorized:true,
    needsFullLegalityCheck:true})});
  permissive.seedFixture({matchId:MATCH,ownerId:'alice',guestId:'bob',turnState:turn(),board:board()});
  assert.equal(permissive.reserve(cmd()).code,'DECLARATION_REJECTED');
}));

test('checker exceptions roll back without leaving any transaction open',()=>fixture(({open})=>{
  const s=open({checkDeclaration:()=>{throw new Error('CHECK_FAILED')}});
  s.seedFixture({matchId:MATCH,ownerId:'alice',guestId:'bob',turnState:turn(),board:board()});
  assert.throws(()=>s.reserve(cmd()),/CHECK_FAILED/);
  assert.doesNotThrow(()=>{s.unsafeTestDatabase().exec('BEGIN IMMEDIATE');
    s.unsafeTestDatabase().exec('ROLLBACK');});
  assert.equal(s.inspectFixture({matchId:MATCH,sessionUserId:'alice'}).revision,4);
}));

test('responses and public audit events never reveal private board data',()=>fixture(({seed})=>{
  const s=seed(),r=s.reserve(cmd());
  const result=JSON.stringify(r),events=JSON.stringify(s.inspectFixture({matchId:MATCH,sessionUserId:'bob'}).events);
  for(const text of ['NOT_FOR_EVENTS_OR_RESPONSES','LIGHT_BOW_INFANTRY','\"attackerId\"','\"targetId\"']) {
    assert.equal(result.includes(text),false);assert.equal(events.includes(text),false);
  }
}));

test('wrong, missing and nonempty unmarked database refused before schema changes',()=>fixture(({file,open})=>{
  const rogue=new DatabaseSync(file);
  rogue.exec('PRAGMA application_id=1128486722; CREATE TABLE secrets(x TEXT)');rogue.close();
  assert.throws(()=>open(),/NOT_ANCIENTS_RESERVATION_LAB/);
  const raw=new DatabaseSync(file);
  assert.deepEqual(raw.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(x=>x.name),['secrets']);
  raw.close();
}));

test('invalid declaration is rejected before creating any command row',()=>fixture(({seed})=>{
  const s=seed();for(const change of [{idempotencyKey:'a'}, {attackerId:'__proto__'},
    {expectedRevision:-1},{targetId:null},{sessionUserId:''}]) {
    assert.equal(s.reserve(cmd(change)).code,'INVALID_DECLARATION');
  }
  assert.equal(s.unsafeTestDatabase().prepare('SELECT COUNT(*) AS n FROM lab_commands').get().n,0);
}));

test('existing laboratory database with altered table structure fails closed',()=>fixture(({open,file})=>{
  const lab=open();lab.close();
  const raw=new DatabaseSync(file);raw.exec('ALTER TABLE lab_matches ADD COLUMN unsupported TEXT');raw.close();
  assert.throws(()=>open(),/LAB_SCHEMA_MISMATCH/);
}));

test('two distinct matches have separate revisions, events and idempotency',()=>fixture(({seed})=>{
  const s=seed();s.seedFixture({matchId:OTHER,ownerId:'alice',guestId:'bob',turnState:turn(),board:board()});
  const a=s.reserve(cmd()),b=s.reserve(cmd({matchId:OTHER}));
  assert.equal(a.code,'SCREENING_RESERVED');assert.equal(b.code,'SCREENING_RESERVED');
  assert.notEqual(a.reservationId,b.reservationId);
  assert.equal(s.inspectFixture({matchId:MATCH,sessionUserId:'bob'}).events.length,1);
  assert.equal(s.inspectFixture({matchId:OTHER,sessionUserId:'bob'}).events.length,1);
}));
