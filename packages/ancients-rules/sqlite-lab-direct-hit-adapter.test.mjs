/** End-to-end tests against the real (unmodified) Ancients screening modules.
 * These require all repository packages; unlike the isolated CCRL tests they
 * are intended for a checkout containing the complete GitHub branch. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openOfficialAncientsRangedPreviewLab} from './sqlite-guarded-reservation.mjs';
import {openAncientsDirectHitFixtureAdapter} from './sqlite-lab-direct-hit-adapter.mjs';

const MATCH='123e4567-e89b-42d3-a456-426614174000';
function setup(run,{blocks=3,leader=false,fixtureOnly=true,faces=['HEAVY','FLAG']}={}){
 const dir=mkdtempSync(join(tmpdir(),'ccw-hit-integrated-'));
 const file=join(dir,'ccrl.sqlite'),stores=[];
 const openLab=()=>{const x=openOfficialAncientsRangedPreviewLab({file});stores.push(x);return x;};
 const openCommit=()=>{const x=openAncientsDirectHitFixtureAdapter({file,enableUnsafeFixtureMutation:true});stores.push(x);return x;};
 try{
  const lab=openLab();
  lab.seedFixture({matchId:MATCH,ownerId:'alice',guestId:'bob',
   turnState:{schemaVersion:1,ruleset:'ancients-base-3e-2009',status:'ACTIVE',
    labFixtureOnly:fixtureOnly,turn:'A',phase:'COMBAT',revision:4,
    orderedUnitIds:['a1'],resolvedBattleUnitIds:[],movedStepsByUnit:{a1:0},
    pendingCombat:null,pendingDecision:null},
   board:{units:[{id:'a1',side:'A',type:'LIGHT_BOW_INFANTRY',col:2,row:4},
     {id:'b1',side:'B',type:'HEAVY_INFANTRY',col:5,row:4,blocksRemaining:blocks}],
     leaders:leader?[{id:'leader_b',side:'B',col:5,row:4}]:[],terrain:[]}});
  const r=lab.reserve({matchId:MATCH,sessionUserId:'alice',attackerId:'a1',
   targetId:'b1',expectedRevision:4,idempotencyKey:'fixture_reserve_01'});
  assert.equal(r.code,'SCREENING_RESERVED');
  const dice={matchId:MATCH,sessionUserId:'alice',reservationId:r.reservationId,
   expectedRevision:5,idempotencyKey:'fixture_dice_0001',mode:'PHYSICAL',declaredFaces:faces};
  assert.equal(lab.stageDice(dice).code,'DICE_STAGED_OFFICIAL_PREVIEW');
  return run({lab,openCommit,openLab,reservationId:r.reservationId,dice});
 }finally{for(const s of stores.reverse())try{s.close()}catch{}
  rmSync(dir,{force:true,recursive:true,maxRetries:20,retryDelay:100});}
}
const command=id=>({matchId:MATCH,sessionUserId:'alice',reservationId:id,
 expectedRevision:6,idempotencyKey:'fixture_hit_0001'});

test('real stored official dice change only the target blocks in fixture SQLite',()=>setup(({lab,openCommit,reservationId})=>{
 const out=openCommit().apply(command(reservationId));
 assert.equal(out.code,'LAB_DIRECT_HITS_APPLIED_FIXTURE');
 assert.equal(out.revision,7);assert.equal(out.summary.blocksRemoved,1);
 assert.equal(out.summary.flagsPending,1);assert.equal(out.attackAuthorized,false);
 const b=JSON.parse(lab.unsafeTestDatabase().prepare('SELECT board_json FROM lab_matches').get().board_json);
 assert.equal(b.units.find(x=>x.id==='b1').blocksRemaining,2);
 assert.equal(lab.inspectFixture({matchId:MATCH,sessionUserId:'alice'}).revision,7);
}));
test('the same original dice can be replayed after committing hits, never rerolled',()=>setup(({lab,openCommit,reservationId,dice})=>{
 assert.equal(openCommit().apply(command(reservationId)).status,200);
 const replay=lab.stageDice(dice);
 assert.equal(replay.code,'ALREADY_STAGED');assert.deepEqual(replay.roll.results,['HEAVY','FLAG']);
 assert.equal(replay.revision,6);
}));
test('the defender and a stranger cannot commit the fixture results',()=>setup(({openCommit,reservationId})=>{
 const store=openCommit();
 assert.equal(store.apply({...command(reservationId),sessionUserId:'bob'}).code,'LAB_HITS_NOT_APPLICABLE');
 assert.equal(store.apply({...command(reservationId),sessionUserId:'unknown'}).code,'NOT_FOUND');
}));
test('without explicit fixture flag the real adapter rejects the same staged roll',()=>setup(({openCommit,reservationId})=>{
 assert.equal(openCommit().apply(command(reservationId)).code,'LAB_HITS_NOT_APPLICABLE');
},{fixtureOnly:false}));
test('eliminated unit with leader leaves leader for pending casualty check',()=>setup(({lab,openCommit,reservationId})=>{
 const out=openCommit().apply(command(reservationId));
 assert.equal(out.summary.unitEliminated,true);
 assert.equal(out.summary.nextRequiredStep,'LEADER_CASUALTY_CHECK');
 const b=JSON.parse(lab.unsafeTestDatabase().prepare('SELECT board_json FROM lab_matches').get().board_json);
 assert.equal(b.units.some(x=>x.id==='b1'),false);assert.equal(b.leaders.length,1);
},{blocks:1,leader:true}));
test('event failure rolls back official fixture board, revision and command',()=>setup(({lab,openCommit,reservationId})=>{
 const store=openCommit(),db=lab.unsafeTestDatabase(),before=db.prepare('SELECT * FROM lab_matches').get();
 db.exec("CREATE TRIGGER fail_fixture_hit BEFORE INSERT ON lab_events BEGIN SELECT RAISE(ABORT,'HIT_EVENT_FAIL'); END");
 assert.throws(()=>store.apply(command(reservationId)),/HIT_EVENT_FAIL/);
 assert.deepEqual(db.prepare('SELECT * FROM lab_matches').get(),before);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lab_commands').get().n,2);
 db.exec('DROP TRIGGER fail_fixture_hit');
 assert.equal(store.apply(command(reservationId)).status,200);
}));
