/** Full CCRL integration with real Ancients precheck; requires entire repo locally.
 * The standalone SQLite agreement suite is the executed native contract. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openOfficialAncientsRangedPreviewLab} from './sqlite-guarded-reservation.mjs';
import {openAncientsDirectHitFixtureAdapter} from './sqlite-lab-direct-hit-adapter.mjs';

const MATCH='123e4567-e89b-42d3-a456-426614174000';
const state=()=>({schemaVersion:1,ruleset:'ancients-base-3e-2009',status:'ACTIVE',
  turn:'A',phase:'COMBAT',revision:4,orderedUnitIds:['a1'],
  resolvedBattleUnitIds:[],movedStepsByUnit:{a1:0},pendingCombat:null,
  pendingDecision:null,labFixtureOnly:true});
const board=(blocks=3)=>({units:[
  {id:'a1',side:'A',type:'LIGHT_BOW_INFANTRY',col:2,row:4},
  {id:'b1',side:'B',type:'HEAVY_INFANTRY',col:5,row:4,blocksRemaining:blocks}
],leaders:[{id:'leader_b',side:'B',col:5,row:4}],terrain:[]});
const declaration=()=>({matchId:MATCH,sessionUserId:'alice',
  attackerId:'a1',targetId:'b1',expectedRevision:4,idempotencyKey:'physical_approve_reserve_01'});
const shot=id=>({matchId:MATCH,sessionUserId:'alice',reservationId:id,
  expectedRevision:5,idempotencyKey:'physical_approve_attack_01',
  mode:'PHYSICAL',declaredFaces:['HEAVY','FLAG']});
const hits=id=>({matchId:MATCH,sessionUserId:'alice',reservationId:id,
  expectedRevision:6,idempotencyKey:'physical_approve_hits_01'});
const casualty=(id,blocks,more={})=>({matchId:MATCH,sessionUserId:'alice',
  reservationId:id,expectedRevision:7,idempotencyKey:'physical_approve_leader_01',
  mode:'PHYSICAL',declaredFaces:blocks===1?['LEADER']:['LEADER','FLAG'],...more});
const review=(id,decision='CONFIRM',more={})=>({matchId:MATCH,sessionUserId:'bob',
  reservationId:id,expectedRevision:8,idempotencyKey:'physical_approve_review_01',
  decision,...more});
function fixture(fn,{blocks=3,leaderMode='PHYSICAL'}={}) {
  const dir=mkdtempSync(join(tmpdir(),'ccw-physical-approval-'));
  const file=join(dir,'lab.sqlite'),opened=[];
  const openLab=()=>{const s=openOfficialAncientsRangedPreviewLab({file});opened.push(s);return s;};
  const openHits=()=>{const s=openAncientsDirectHitFixtureAdapter({file,enableUnsafeFixtureMutation:true});
    opened.push(s);return s;};
  try {
    const lab=openLab();lab.seedFixture({matchId:MATCH,ownerId:'alice',guestId:'bob',
      turnState:state(),board:board(blocks)});
    const reserved=lab.reserve(declaration());assert.equal(reserved.code,'SCREENING_RESERVED');
    const id=reserved.reservationId,attack=lab.stageDice(shot(id));
    assert.equal(attack.code,'DICE_STAGED_OFFICIAL_PREVIEW');
    const adapter=openHits(),applied=adapter.apply(hits(id));
    assert.equal(applied.code,'LAB_DIRECT_HITS_APPLIED_FIXTURE');
    const recorded=adapter.stageLeaderCasualtyPreview(casualty(id,blocks,{
      ...(leaderMode==='DIGITAL'?{mode:'DIGITAL',declaredFaces:undefined}:{})
    }));
    assert.equal(recorded.code,'LAB_LEADER_PREVIEW_STAGED');
    return fn({lab,adapter,id,recorded,openHits});
  } finally {
    for(const s of opened.reverse())try{s.close();}catch{}
    rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});
  }
}
test('real pipeline allows opponent confirmation only after staged physical leader dice',()=>fixture(({lab,adapter,id})=>{
  const response=adapter.reviewLabPhysicalLeaderDice(review(id));
  assert.equal(response.code,'PHYSICAL_AGREEMENT_RECORDED');
  assert.equal(response.revision,9);assert.equal(response.physicalRollAccepted,true);
  assert.equal(response.combatResolved,false);
  const saved=lab.unsafeTestDatabase().prepare('SELECT board_json,turn_json FROM lab_matches').get();
  assert.equal(JSON.parse(saved.board_json).units.find(u=>u.id==='b1').blocksRemaining,2);
  assert.equal(JSON.parse(saved.turn_json).pendingCombat.fixtureLeaderCasualtyPreview.physicalAgreement.reviewerSide,'B');
}));

test('opponent can dispute declared helmet results without changing the roll',()=>fixture(({lab,adapter,id})=>{
  const r=adapter.reviewLabPhysicalLeaderDice(review(id,'DISPUTE'));
  assert.equal(r.physicalRollAccepted,false);
  const marker=JSON.parse(lab.unsafeTestDatabase().prepare('SELECT turn_json FROM lab_matches').get().turn_json).pendingCombat;
  assert.deepEqual(marker.fixtureLeaderCasualtyPreview.roll.results,['LEADER','FLAG']);
  assert.equal(marker.fixtureLeaderCasualtyPreview.physicalAgreement.decision,'DISPUTE');
}));

test('idempotent decision survives reopening SQLite and does not produce another event',()=>fixture(({lab,adapter,id,openHits})=>{
  const cmd=review(id);
  assert.equal(adapter.reviewLabPhysicalLeaderDice(cmd).code,'PHYSICAL_AGREEMENT_RECORDED');
  const second=openHits().reviewLabPhysicalLeaderDice(cmd);
  assert.equal(second.code,'PHYSICAL_AGREEMENT_ALREADY_RECORDED');
  assert.equal(lab.inspectFixture({matchId:MATCH,sessionUserId:'bob'}).events.length,5);
}));

test('leader-dispute and leader-confirmation cannot be changed by the other actor',()=>fixture(({adapter,id})=>{
  assert.equal(adapter.reviewLabPhysicalLeaderDice(review(id,'DISPUTE')).status,200);
  assert.equal(adapter.reviewLabPhysicalLeaderDice(review(id,'CONFIRM')).code,'IDEMPOTENCY_KEY_REUSED');
  assert.equal(adapter.reviewLabPhysicalLeaderDice(review(id,'DISPUTE',
    {expectedRevision:9,idempotencyKey:'physical_approve_review_02'})).code,
    'PHYSICAL_AGREEMENT_ALREADY_RECORDED');
  assert.equal(adapter.reviewLabPhysicalLeaderDice(review(id,'DISPUTE',
    {sessionUserId:'alice'})).code,'PHYSICAL_AGREEMENT_UNAVAILABLE');
}));

test('digital leader rolls cannot be put through physical approval',()=>fixture(({adapter,id})=>{
  assert.equal(adapter.reviewLabPhysicalLeaderDice(review(id)).code,'PHYSICAL_AGREEMENT_UNAVAILABLE');
},{leaderMode:'DIGITAL'}));

test('eliminated unit uses a single physical helmet and keeps leader fate pending',()=>fixture(({lab,adapter,id})=>{
  const r=adapter.reviewLabPhysicalLeaderDice(review(id));
  assert.equal(r.status,200);
  const data=lab.unsafeTestDatabase().prepare('SELECT board_json,turn_json FROM lab_matches').get();
  assert.equal(JSON.parse(data.board_json).units.some(u=>u.id==='b1'),false);
  assert.equal(JSON.parse(data.board_json).leaders.length,1);
  assert.equal(JSON.parse(data.turn_json).pendingCombat.fixtureLeaderCasualtyPreview.outcome.leaderRemoved,false);
},{blocks:1}));

test('public review event contains no dice faces, unit IDs or leader result',()=>fixture(({lab,adapter,id})=>{
  adapter.reviewLabPhysicalLeaderDice(review(id));
  const event=lab.inspectFixture({matchId:MATCH,sessionUserId:'bob'}).events.at(-1);
  assert.deepEqual(event,{sequence:9,type:'LAB_PHYSICAL_LEADER_DICE_REVIEWED',
    side:'B',decision:'CONFIRM'});
  for(const word of ['results','helmetCount','leader_b','reservationId',id])
    assert.equal(JSON.stringify(event).includes(word),false);
}));
