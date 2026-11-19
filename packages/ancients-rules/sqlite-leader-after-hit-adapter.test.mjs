import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openOfficialAncientsRangedPreviewLab} from './sqlite-guarded-reservation.mjs';
import {openAncientsDirectHitFixtureAdapter} from './sqlite-lab-direct-hit-adapter.mjs';

const MATCH='123e4567-e89b-42d3-a456-426614174000';
const turn=()=>({schemaVersion:1,ruleset:'ancients-base-3e-2009',status:'ACTIVE',
  turn:'A',phase:'COMBAT',revision:4,orderedUnitIds:['a1'],
  resolvedBattleUnitIds:[],movedStepsByUnit:{a1:0},pendingCombat:null,
  pendingDecision:null,labFixtureOnly:true});
const board=(blocks=3,leader=true)=>({units:[
  {id:'a1',side:'A',type:'LIGHT_BOW_INFANTRY',col:2,row:4},
  {id:'b1',side:'B',type:'HEAVY_INFANTRY',col:5,row:4,blocksRemaining:blocks}
],leaders:leader?[{id:'leader_b',side:'B',col:5,row:4}]:[],terrain:[]});
const reserve=()=>({matchId:MATCH,sessionUserId:'alice',attackerId:'a1',
  targetId:'b1',expectedRevision:4,idempotencyKey:'fixture_leader_reserve_01'});
const stage=(reservationId)=>({matchId:MATCH,sessionUserId:'alice',reservationId,
  expectedRevision:5,idempotencyKey:'fixture_leader_attack_01',mode:'PHYSICAL',
  declaredFaces:['HEAVY','FLAG']});
const hits=(reservationId)=>({matchId:MATCH,sessionUserId:'alice',reservationId,
  expectedRevision:6,idempotencyKey:'fixture_leader_hits_01'});
const leader=(reservationId,changes={})=>({matchId:MATCH,sessionUserId:'alice',reservationId,
  expectedRevision:7,idempotencyKey:'fixture_leader_check_01',mode:'PHYSICAL',
  declaredFaces:['LEADER','FLAG'],...changes});

function fixture(fn,{blocks=3,attached=true}={}) {
  const dir=mkdtempSync(join(tmpdir(),'ccw-fixture-leader-after-hit-'));
  const file=join(dir,'lab.sqlite'),opened=[];
  const openLab=()=>{const a=openOfficialAncientsRangedPreviewLab({file});opened.push(a);return a;};
  const openHits=()=>{const a=openAncientsDirectHitFixtureAdapter({file,enableUnsafeFixtureMutation:true});
    opened.push(a);return a;};
  try {
    const lab=openLab();lab.seedFixture({matchId:MATCH,ownerId:'alice',guestId:'bob',
      turnState:turn(),board:board(blocks,attached)});
    const reservation=lab.reserve(reserve());assert.equal(reservation.code,'SCREENING_RESERVED');
    const staged=lab.stageDice(stage(reservation.reservationId));
    assert.equal(staged.code,'DICE_STAGED_OFFICIAL_PREVIEW');
    const commit=openHits();
    const hit=commit.apply(hits(reservation.reservationId));
    assert.equal(hit.code,'LAB_DIRECT_HITS_APPLIED_FIXTURE');
    return fn({lab,commit,reservationId:reservation.reservationId,openHits});
  } finally {
    for(const a of opened.reverse())try{a.close();}catch{}
    rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});
  }
}
test('real guard → staged official dice → fixture block loss → leader preview in order',()=>fixture(({lab,commit,reservationId})=>{
  const result=commit.stageLeaderCasualtyPreview(leader(reservationId));
  assert.equal(result.code,'LAB_LEADER_PREVIEW_STAGED');
  assert.equal(result.revision,8);
  assert.equal(result.roll.diceCount,2);
  assert.equal(result.outcome.helmetCount,1);
  assert.equal(result.outcome.leaderRemoved,false);
  assert.equal(result.attackAuthorized,false);
  const db=lab.unsafeTestDatabase();
  const b=JSON.parse(db.prepare('SELECT board_json FROM lab_matches').get().board_json);
  assert.equal(b.units.find(unit=>unit.id==='b1').blocksRemaining,2);
  assert.ok(b.leaders.some(item=>item.id==='leader_b'));
}));

test('eliminated unit retains leader and schedules a one-die check',()=>fixture(({lab,commit,reservationId})=>{
  const result=commit.stageLeaderCasualtyPreview(leader(reservationId,
    {declaredFaces:['FLAG']}));
  assert.equal(result.roll.diceCount,1);
  assert.equal(result.outcome.leaderWouldBeEliminated,false);
  assert.equal(result.outcome.leaderMustEvadeIfApplied,true);
  const b=JSON.parse(lab.unsafeTestDatabase().prepare('SELECT board_json FROM lab_matches').get().board_json);
  assert.equal(b.units.some(item=>item.id==='b1'),false);
  assert.ok(b.leaders.some(item=>item.id==='leader_b'));
},{blocks:1}));

test('idempotent hit and leader commands remain replayable without duplicate rolls',()=>fixture(({commit,reservationId,openHits})=>{
  const first=commit.stageLeaderCasualtyPreview(leader(reservationId,{mode:'DIGITAL',declaredFaces:undefined}));
  const replay=openHits().stageLeaderCasualtyPreview(leader(reservationId,
    {mode:'DIGITAL',declaredFaces:undefined}));
  assert.equal(replay.code,'LEADER_PREVIEW_ALREADY_STAGED');
  assert.deepEqual(replay.roll,first.roll);
  assert.equal(commit.apply(hits(reservationId)).code,'ALREADY_APPLIED_FIXTURE');
}));

test('no attached leader means no leader check even after direct-hit fixture',()=>fixture(({commit,reservationId})=>{
  assert.equal(commit.stageLeaderCasualtyPreview(leader(reservationId)).code,
    'LEADER_PREVIEW_UNAVAILABLE');
},{attached:false}));

test('only the reserving participant can stage leader dice',()=>fixture(({commit,reservationId})=>{
  assert.equal(commit.stageLeaderCasualtyPreview(leader(reservationId,
    {sessionUserId:'mallory'})).code,'NOT_FOUND');
  assert.equal(commit.stageLeaderCasualtyPreview(leader(reservationId,
    {sessionUserId:'bob'})).code,'LEADER_PREVIEW_UNAVAILABLE');
  assert.equal(commit.stageLeaderCasualtyPreview(leader(reservationId,
    {diceCount:99})).code,'INVALID_LAB_LEADER_REQUEST');
}));

test('leader preview event is minimal and neither leader nor original cards are exposed',()=>fixture(({lab,commit,reservationId})=>{
  commit.stageLeaderCasualtyPreview(leader(reservationId,{declaredFaces:['LEADER','LEADER']}));
  const events=lab.inspectFixture({matchId:MATCH,sessionUserId:'bob'}).events;
  assert.deepEqual(events.at(-1),{sequence:8,type:'LAB_LEADER_CASUALTY_PREVIEW_STAGED',
    side:'A',source:'PHYSICAL',diceCount:2});
  assert.equal(JSON.stringify(events).includes(reservationId),false);
  assert.equal(JSON.stringify(events).includes('leaderWouldBeEliminated'),false);
}));
