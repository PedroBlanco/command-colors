import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openOfficialAncientsRangedPreviewLab,
  openGuardedAncientsReservationLab} from './sqlite-guarded-reservation.mjs';

const MATCH='123e4567-e89b-42d3-a456-426614174000';
const OTHER_RESERVATION='123e4567-e89b-42d3-a456-426614174010';
const turn=()=>({schemaVersion:1,ruleset:'ancients-base-3e-2009',status:'ACTIVE',
  turn:'A',phase:'COMBAT',revision:4,orderedUnitIds:['a1'],
  resolvedBattleUnitIds:[],movedStepsByUnit:{a1:0},pendingCombat:null,pendingDecision:null});
const board=({blocksRemaining=3,leader=true}={})=>({
  units:[{id:'a1',side:'A',type:'LIGHT_BOW_INFANTRY',col:2,row:4},
    {id:'b1',side:'B',type:'HEAVY_INFANTRY',col:5,row:4,blocksRemaining}],
  leaders:leader?[{id:'leader_b',side:'B',col:5,row:4}]:[],terrain:[]
});
const reserve=()=>({matchId:MATCH,sessionUserId:'alice',attackerId:'a1',targetId:'b1',
  expectedRevision:4,idempotencyKey:'leader_reserve_0001'});
const attack=(reservationId,declaredFaces=['HEAVY','FLAG'])=>({matchId:MATCH,sessionUserId:'alice',
  reservationId,expectedRevision:5,idempotencyKey:'leader_attack_0001',
  mode:'PHYSICAL',declaredFaces});
const check=(reservationId,changes={})=>({matchId:MATCH,sessionUserId:'alice',
  reservationId,expectedRevision:6,idempotencyKey:'leader_check_0001',
  mode:'PHYSICAL',declaredFaces:['LEADER','FLAG'],...changes});
function fixture(fn,{blocksRemaining=3,leader=true,attackFaces=['HEAVY','FLAG'],
  synthetic=false,onlyReserve=false}={}) {
  const dir=mkdtempSync(join(tmpdir(),'ccw-leader-preview-'));
  const file=join(dir,'lab.sqlite'),openInstances=[];
  const open=(isSynthetic=synthetic)=>{
    const s=isSynthetic?openGuardedAncientsReservationLab({file})
      :openOfficialAncientsRangedPreviewLab({file});
    openInstances.push(s);return s;
  };
  try {
    const store=open();store.seedFixture({matchId:MATCH,ownerId:'alice',guestId:'bob',
      turnState:turn(),board:board({blocksRemaining,leader})});
    const r=store.reserve(reserve());assert.equal(r.code,'SCREENING_RESERVED');
    if(!onlyReserve) {
      const stage=store.stageDice(attack(r.reservationId,
        synthetic?['RED','FLAG']:attackFaces));
      assert.equal(stage.status,200);
    }
    return fn({store,open,reservationId:r.reservationId});
  } finally {
    for(const s of openInstances.reverse())try{s.close();}catch{}
    rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});
  }
}
const eventList=store=>store.unsafeTestDatabase()
  .prepare('SELECT payload FROM lab_events ORDER BY sequence').all().map(x=>JSON.parse(x.payload));
const commandCount=store=>store.unsafeTestDatabase().prepare('SELECT COUNT(*) AS n FROM lab_commands').get().n;

test('leader preview: two dice from stored surviving-unit hit; no casualty applied',()=>fixture(({store,reservationId})=>{
  const result=store.stageLeaderCasualtyPreview(check(reservationId));
  assert.equal(result.code,'LEADER_PREVIEW_STAGED');
  assert.equal(result.revision,7);
  assert.equal(result.roll.type,'ANCIENTS_BASE_LEADER_CASUALTY_CAPTURED');
  assert.equal(result.roll.purpose,'LEADER_CASUALTY_CHECK');
  assert.equal(result.roll.diceCount,2);
  assert.deepEqual(result.roll.results,['LEADER','FLAG']);
  assert.equal(result.outcome.leaderWouldBeEliminated,false);
  assert.equal(result.outcome.leaderRemoved,false);
  assert.equal(result.previewOnly,true);
  assert.equal(result.attackAuthorized,false);
  assert.equal(result.combatResolved,false);
  const match=store.unsafeTestDatabase().prepare('SELECT board_json FROM lab_matches').get();
  assert.equal(JSON.parse(match.board_json).units[1].blocksRemaining,3);
}));

test('leader preview: two helmets predict but do not execute leader casualty',()=>fixture(({store,reservationId})=>{
  const result=store.stageLeaderCasualtyPreview(check(reservationId,
    {declaredFaces:['LEADER','LEADER']}));
  assert.equal(result.code,'LEADER_PREVIEW_STAGED');
  assert.equal(result.outcome.leaderWouldBeEliminated,true);
  assert.equal(result.outcome.leaderRemoved,false);
  assert.equal(result.outcome.boardMutated,false);
}));

test('leader preview: last-block unit uses a one-die leader check',()=>fixture(({store,reservationId})=>{
  const result=store.stageLeaderCasualtyPreview(check(reservationId,
    {declaredFaces:['LEADER']}));
  assert.equal(result.roll.diceCount,1);
  assert.equal(result.outcome.leaderWouldBeEliminated,true);
  assert.equal(result.outcome.combatResolved,false);
},{blocksRemaining:1}));

test('leader preview: surviving leader of eliminated unit requires future evade',()=>fixture(({store,reservationId})=>{
  const result=store.stageLeaderCasualtyPreview(check(reservationId,
    {declaredFaces:['FLAG']}));
  assert.equal(result.roll.diceCount,1);
  assert.equal(result.outcome.leaderWouldBeEliminated,false);
  assert.equal(result.outcome.leaderMustEvadeIfApplied,true);
  assert.equal(result.outcome.retreatResolved,false);
},{blocksRemaining:1}));

test('leader preview: digital retry from second SQLite handle preserves original random faces',()=>fixture(({store,open,reservationId})=>{
  const req=check(reservationId,{mode:'DIGITAL',declaredFaces:undefined});
  const a=store.stageLeaderCasualtyPreview(req);
  assert.equal(a.code,'LEADER_PREVIEW_STAGED');
  const b=open().stageLeaderCasualtyPreview(req);
  assert.equal(b.code,'LEADER_PREVIEW_ALREADY_STAGED');
  assert.deepEqual(b.roll,a.roll);
  assert.deepEqual(b.outcome,a.outcome);
  assert.equal(b.revision,7);
  assert.equal(eventList(store).length,3);
  assert.equal(commandCount(store),3);
}));

test('leader preview: reopen file still recognizes an earlier capture exactly',()=>fixture(({store,open,reservationId})=>{
  const req=check(reservationId,{declaredFaces:['LEADER','LEADER']});
  const initial=store.stageLeaderCasualtyPreview(req);
  store.close();
  const reopened=open();
  const replay=reopened.stageLeaderCasualtyPreview(req);
  assert.equal(replay.code,'LEADER_PREVIEW_ALREADY_STAGED');
  assert.deepEqual(replay.roll,initial.roll);
  assert.deepEqual(replay.outcome,initial.outcome);
}));

test('leader preview: original attack roll remains idempotent after leader preview',()=>fixture(({store,reservationId})=>{
  const a=store.stageLeaderCasualtyPreview(check(reservationId));
  assert.equal(a.code,'LEADER_PREVIEW_STAGED');
  const original=store.stageDice(attack(reservationId));
  assert.equal(original.code,'ALREADY_STAGED');
  assert.deepEqual(original.roll.results,['HEAVY','FLAG']);
  assert.equal(original.interpretation.matchingColorHits,1);
}));

test('leader preview: a new idempotency key cannot roll the leader a second time',()=>fixture(({store,reservationId})=>{
  assert.equal(store.stageLeaderCasualtyPreview(check(reservationId)).status,200);
  const second=store.stageLeaderCasualtyPreview(check(reservationId,
    {expectedRevision:7,idempotencyKey:'leader_check_0002'}));
  assert.equal(second.code,'LEADER_PREVIEW_ALREADY_PRESENT');
  assert.equal(eventList(store).length,3);
}));

test('leader preview: reuse of an existing key with changed mode or results is forbidden',()=>fixture(({store,reservationId})=>{
  store.stageLeaderCasualtyPreview(check(reservationId));
  assert.equal(store.stageLeaderCasualtyPreview(check(reservationId,
    {declaredFaces:['FLAG','FLAG']})).code,'IDEMPOTENCY_KEY_REUSED');
  assert.equal(store.stageLeaderCasualtyPreview(check(reservationId,
    {mode:'DIGITAL',declaredFaces:undefined})).code,'IDEMPOTENCY_KEY_REUSED');
  assert.equal(store.stageLeaderCasualtyPreview(check(reservationId,
    {expectedRevision:7})).code,'IDEMPOTENCY_KEY_REUSED');
}));

test('leader preview: third parties and defender cannot insert the attacker-side check',()=>fixture(({store,reservationId})=>{
  assert.equal(store.stageLeaderCasualtyPreview(check(reservationId,
    {sessionUserId:'mallory'})).code,'NOT_FOUND');
  assert.equal(store.stageLeaderCasualtyPreview(check(reservationId,
    {sessionUserId:'bob'})).code,'LEADER_PREVIEW_UNAVAILABLE');
  assert.equal(eventList(store).length,2);
}));

test('leader preview: no attached leader has no eligible casualty check',()=>fixture(({store,reservationId})=>{
  assert.equal(store.stageLeaderCasualtyPreview(check(reservationId)).code,'LEADER_CHECK_NOT_PENDING');
  assert.equal(eventList(store).length,2);
},{leader:false}));

test('leader preview: flag-only hit cannot trigger an early leader casualty roll',()=>fixture(({store,reservationId})=>{
  assert.equal(store.stageLeaderCasualtyPreview(check(reservationId)).code,'LEADER_CHECK_NOT_PENDING');
  assert.equal(eventList(store).length,2);
},{attackFaces:['FLAG','SWORDS']}));

test('leader preview: dice cannot be checked before the original ranged roll',()=>fixture(({store,reservationId})=>{
  assert.equal(store.stageLeaderCasualtyPreview(check(reservationId,{expectedRevision:5}))
    .code,'LEADER_PREVIEW_UNAVAILABLE');
},{onlyReserve:true}));

test('leader preview: synthetic four-face roll cannot be reinterpreted as official',()=>fixture(({store,reservationId})=>{
  assert.equal(store.stageLeaderCasualtyPreview(check(reservationId)).code,'LEADER_PREVIEW_UNAVAILABLE');
},{synthetic:true}));

test('leader preview: wrong reservation or stale revision cannot bypass checks',()=>fixture(({store,reservationId})=>{
  assert.equal(store.stageLeaderCasualtyPreview(check(reservationId,
    {reservationId:OTHER_RESERVATION})).code,'LEADER_PREVIEW_UNAVAILABLE');
  assert.equal(store.stageLeaderCasualtyPreview(check(reservationId,
    {expectedRevision:5})).code,'STALE_REVISION');
}));

test('leader preview: user cannot inject dice count, leader placement, RNG or board',()=>fixture(({store,reservationId})=>{
  for(const changes of [{diceCount:1},{actor:'B'},{leaderAttached:false},
    {board:board({leader:false})},{targetId:'other'},{randomIndex:()=>3}]) {
    assert.equal(store.stageLeaderCasualtyPreview(check(reservationId,changes))
      .code,'INVALID_LEADER_PREVIEW_REQUEST');
  }
  assert.equal(eventList(store).length,2);
}));

test('leader preview: reject malformed mode, key, faces and digital user-supplied results',()=>fixture(({store,reservationId})=>{
  for(const changes of [{mode:'UNKNOWN'}, {idempotencyKey:'x'},
    {declaredFaces:['LEADER']}, {declaredFaces:['LEADER','LEADER','LEADER']},
    {declaredFaces:'LEADER,FLAG'},{declaredFaces:['RED','FLAG']},
    {mode:'DIGITAL',declaredFaces:['LEADER','FLAG']},
    {expectedRevision:1.5},{reservationId:'invalid'}, {sessionUserId:null}]) {
    const result=store.stageLeaderCasualtyPreview(check(reservationId,changes));
    assert.equal(result.status,400);
  }
  assert.equal(eventList(store).length,2);
}));

test('leader preview: board changes after original dice make leader preview unavailable',()=>fixture(({store,reservationId})=>{
  const db=store.unsafeTestDatabase(),record=db.prepare('SELECT board_json FROM lab_matches').get();
  const b=JSON.parse(record.board_json);b.units[1].blocksRemaining=1;
  db.prepare('UPDATE lab_matches SET board_json=?').run(JSON.stringify(b));
  assert.equal(store.stageLeaderCasualtyPreview(check(reservationId))
    .code,'LEADER_PREVIEW_UNAVAILABLE');
  assert.equal(eventList(store).length,2);
}));

test('leader preview: failed event insert rolls back entire leader stage',()=>fixture(({store,reservationId})=>{
  const db=store.unsafeTestDatabase();
  const before=db.prepare('SELECT turn_json,revision,board_json FROM lab_matches').get();
  const commandsBefore=commandCount(store);
  db.exec("CREATE TRIGGER fail_leader BEFORE INSERT ON lab_events BEGIN SELECT RAISE(ABORT,'LEADER_EVENT_FAILED'); END");
  assert.throws(()=>store.stageLeaderCasualtyPreview(check(reservationId)),/LEADER_EVENT_FAILED/);
  assert.deepEqual(db.prepare('SELECT turn_json,revision,board_json FROM lab_matches').get(),before);
  assert.equal(commandCount(store),commandsBefore);
  assert.equal(eventList(store).length,2);
  db.exec('DROP TRIGGER fail_leader');
  assert.equal(store.stageLeaderCasualtyPreview(check(reservationId)).code,'LEADER_PREVIEW_STAGED');
}));

test('leader preview: public event contains no faces, roll ID, target or casualty outcome',()=>fixture(({store,reservationId})=>{
  const r=store.stageLeaderCasualtyPreview(check(reservationId,{declaredFaces:['LEADER','LEADER']}));
  assert.equal(r.status,200);
  const events=eventList(store),last=events.at(-1);
  assert.deepEqual(last,{sequence:7,type:'LEADER_CASUALTY_PREVIEW_STAGED',
    side:'A',source:'PHYSICAL',diceCount:2});
  const raw=JSON.stringify(last);
  for(const forbidden of [reservationId,'leader_b','b1','rollId','results','leaderSymbols'])
    assert.equal(raw.includes(forbidden),false);
}));

test('leader preview: checklist remains an unexecuted plan and blocks stay unchanged',()=>fixture(({store,reservationId})=>{
  const before=store.previewResolutionChecklist({matchId:MATCH,sessionUserId:'alice',
    reservationId,expectedRevision:6});
  assert.equal(before.status,200);
  const result=store.stageLeaderCasualtyPreview(check(reservationId));
  assert.equal(result.code,'LEADER_PREVIEW_STAGED');
  const afterwards=store.previewResolutionChecklist({matchId:MATCH,sessionUserId:'alice',
    reservationId,expectedRevision:7});
  assert.equal(afterwards.status,200);
  assert.deepEqual(afterwards.checklist.steps,before.checklist.steps);
  assert.ok(afterwards.checklist.steps.every(step=>step.executed===false));
  const original=JSON.parse(store.unsafeTestDatabase().prepare('SELECT board_json FROM lab_matches').get().board_json);
  assert.equal(original.units[1].blocksRemaining,3);
}));

test('leader preview: damaged cached leader outcome refuses idempotent replay',()=>fixture(({store,reservationId})=>{
  const req=check(reservationId);
  assert.equal(store.stageLeaderCasualtyPreview(req).status,200);
  const db=store.unsafeTestDatabase();
  const turnState=JSON.parse(db.prepare('SELECT turn_json FROM lab_matches').get().turn_json);
  turnState.pendingCombat.leaderCasualtyPreview.outcome.leaderSymbols=999;
  db.prepare('UPDATE lab_matches SET turn_json=?').run(JSON.stringify(turnState));
  assert.equal(store.stageLeaderCasualtyPreview(req).code,'LEADER_PREVIEW_REPLAY_UNAVAILABLE');
}));
