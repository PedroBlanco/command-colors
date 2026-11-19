import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomInt} from 'node:crypto';
import {makeLabLeaderAfterHitPreviewCommand} from './sqlite-leader-after-hit-fixture.mjs';
const matchId='123e4567-e89b-42d3-a456-426614174000';
const reservationId='123e4567-e89b-42d3-a456-426614174010';
const UUID=/^[a-f0-9-]{36}$/i, KEY=/^[A-Za-z0-9_-]{8,80}$/;
const FACES=['LIGHT','MEDIUM','HEAVY','LEADER','FLAG','SWORDS'];
function fixture(run,{eliminated=false,marked=true,leader=true,fixtureOnly=true}={}) {
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE lab_matches(id TEXT PRIMARY KEY,owner_id TEXT,guest_id TEXT,revision INTEGER,turn_json TEXT,board_json TEXT); CREATE TABLE lab_events(match_id TEXT,sequence INTEGER,payload TEXT,PRIMARY KEY(match_id,sequence)); CREATE TABLE lab_commands(match_id TEXT,actor TEXT,idem_key TEXT,signature TEXT,reservation_id TEXT,committed_revision INTEGER,PRIMARY KEY(match_id,actor,idem_key));');
 const boardJson=JSON.stringify({leaderPresent:leader,remaining:eliminated?0:2});
 const sha=createHash('sha256').update(boardJson).digest('hex');
 const turn={revision:7,schemaVersion:1,status:'ACTIVE',turn:'A',phase:'COMBAT',labFixtureOnly:fixtureOnly,
  pendingCombat:{kind:marked?'LAB_DIRECT_HITS_APPLIED_FIXTURE':'RANGED_DICE_STAGED_OFFICIAL_PREVIEW',
   actor:'A',reservationId,fullValidationRequired:true,appliedFixture:{revision:7,
    boardAfterSha256:sha,unverifiedFullRules:true,summary:{unitEliminated:eliminated,
    leaderCheckRequired:leader,blocksRemoved:1,nextRequiredStep:leader?'LEADER_CASUALTY_CHECK':'DEFENDER_MORALE_CHOICE'}}}};
 db.prepare('INSERT INTO lab_matches VALUES(?,?,?,?,?,?)').run(matchId,'alice','bob',7,JSON.stringify(turn),boardJson);
 let draws=0;
 const inTransaction=fn=>{db.exec('BEGIN IMMEDIATE');try{let r=fn();db.exec('COMMIT');return r;}
  catch(e){db.exec('ROLLBACK');throw e;}};
 const captureLeaderDice=({rollId,actor,diceCount,mode,declaredFaces})=>{
  draws+=1;
  let results=mode==='DIGITAL'?Array.from({length:diceCount},()=>FACES[randomInt(6)]):declaredFaces;
  if(!Array.isArray(results)||results.length!==diceCount||results.some(x=>!FACES.includes(x)))
   throw new TypeError('INVALID_FACES');
  return {type:'ANCIENTS_BASE_LEADER_CASUALTY_CAPTURED',purpose:'LEADER_CASUALTY_CHECK',
   ruleset:'ancients-base-3e-2009',rollId,actor,diceCount,source:mode,
   verification:mode==='DIGITAL'?'SERVER_GENERATED':'PLAYER_DECLARED',results:[...results]};
 };
 const cmd=makeLabLeaderAfterHitPreviewCommand({UUID,KEY,denied:(status,code)=>({status,code}),
  inTransaction,row:db.prepare('SELECT * FROM lab_matches WHERE id=?'),
  previous:db.prepare('SELECT * FROM lab_commands WHERE match_id=? AND actor=? AND idem_key=?'),
  sideFor:(entry,user)=>entry.owner_id===user?'A':entry.guest_id===user?'B':null,
  createHash,captureLeaderDice,allowedFaces:FACES,
  updateTurn:db.prepare('UPDATE lab_matches SET revision=?,turn_json=? WHERE id=? AND revision=?'),
  eventInsert:db.prepare('INSERT INTO lab_events VALUES(?,?,?)'),
  commandInsert:db.prepare('INSERT INTO lab_commands VALUES(?,?,?,?,?,?)')
 });
 const req=(options={})=>({matchId,sessionUserId:'alice',reservationId,expectedRevision:7,
  idempotencyKey:'leader_after_hit_0001',mode:'PHYSICAL',declaredFaces:eliminated?['LEADER']:['LEADER','FLAG'],...options});
 const state=()=>db.prepare('SELECT revision,turn_json,board_json FROM lab_matches').get();
 const counts=()=>({events:db.prepare('SELECT COUNT(*) n FROM lab_events').get().n,
  commands:db.prepare('SELECT COUNT(*) n FROM lab_commands').get().n});
 try{return run({db,cmd,req,state,counts,draws:()=>draws});}finally{db.close();}
}
test('after fixture hits: two dice are saved without changing blocks or eliminating leader',()=>fixture(({cmd,req,state,counts})=>{
 const before=state(),r=cmd(req());assert.equal(r.code,'LAB_LEADER_PREVIEW_STAGED');
 assert.equal(r.revision,8);assert.equal(r.roll.diceCount,2);
 assert.equal(r.outcome.helmetCount,1);assert.equal(r.outcome.leaderRemoved,false);
 assert.equal(r.combatResolved,false);assert.equal(r.labOnly,true);
 assert.equal(state().board_json,before.board_json);assert.deepEqual(counts(),{events:1,commands:1});
}));
test('last-block unit eliminated before leader preview: one helmet and potential evade',()=>fixture(({cmd,req})=>{
 let a=cmd(req({declaredFaces:['FLAG']}));assert.equal(a.roll.diceCount,1);
 assert.equal(a.outcome.leaderWouldBeEliminated,false);
 assert.equal(a.outcome.leaderMustEvadeIfApplied,true);
},{eliminated:true}));
test('a one-die helmet predicts but never applies leader casualty',()=>fixture(({cmd,req})=>{
 const a=cmd(req());assert.equal(a.outcome.leaderWouldBeEliminated,true);
 assert.equal(a.outcome.leaderRemoved,false);assert.equal(a.outcome.leaderEvasionResolved,false);
},{eliminated:true}));
test('cannot stage before direct hits were applied in a marked fixture',()=>fixture(({cmd,req,counts})=>{
 assert.equal(cmd(req()).code,'LEADER_PREVIEW_UNAVAILABLE');assert.deepEqual(counts(),{events:0,commands:0});
},{marked:false}));
test('fixture flag missing prevents replay/roll even with a valid applied marker',()=>fixture(({cmd,req})=>{
 assert.equal(cmd(req()).code,'LEADER_PREVIEW_UNAVAILABLE');
},{fixtureOnly:false}));
test('no leader check required means no new dice',()=>fixture(({cmd,req,draws})=>{
 assert.equal(cmd(req()).code,'LEADER_PREVIEW_UNAVAILABLE');assert.equal(draws(),0);
},{leader:false}));
test('digital retries return exactly the saved random roll without rerolling',()=>fixture(({cmd,req,counts,draws})=>{
 const r=req({mode:'DIGITAL',declaredFaces:undefined}),a=cmd(r),b=cmd(r);
 assert.equal(b.code,'LEADER_PREVIEW_ALREADY_STAGED');
 assert.deepEqual(a.roll,b.roll);assert.deepEqual(a.outcome,b.outcome);
 assert.equal(draws(),1);assert.deepEqual(counts(),{events:1,commands:1});
}));
test('changing an idempotency signature conflicts; second key cannot reroll',()=>fixture(({cmd,req,draws})=>{
 cmd(req());assert.equal(cmd(req({mode:'DIGITAL',declaredFaces:undefined})).code,'IDEMPOTENCY_KEY_REUSED');
 assert.equal(cmd(req({expectedRevision:8,idempotencyKey:'leader_after_hit_0002'})).status,409);
 assert.equal(draws(),1);
}));
test('opponent, stranger, stale revision and forged request fields are blocked',()=>fixture(({cmd,req})=>{
 assert.equal(cmd(req({sessionUserId:'bob'})).code,'LEADER_PREVIEW_UNAVAILABLE');
 assert.equal(cmd(req({sessionUserId:'mallory'})).code,'NOT_FOUND');
 assert.equal(cmd(req({expectedRevision:6})).code,'STALE_REVISION');
 assert.equal(cmd(req({diceCount:32})).code,'INVALID_LAB_LEADER_REQUEST');
}));
test('SHA-256 mismatch prevents staging if post-hit board was altered',()=>fixture(({cmd,req,db})=>{
 db.prepare('UPDATE lab_matches SET board_json=?').run('{"forged":true}');
 assert.equal(cmd(req()).code,'LEADER_PREVIEW_UNAVAILABLE');
}));
test('public audit event contains only source/actor/count; not faces or IDs',()=>fixture(({cmd,req,db})=>{
 const r=cmd(req());assert.equal(r.status,200);
 const ev=JSON.parse(db.prepare('SELECT payload FROM lab_events').get().payload);
 assert.deepEqual(ev,{sequence:8,type:'LAB_LEADER_CASUALTY_PREVIEW_STAGED',
  side:'A',source:'PHYSICAL',diceCount:2});
 for(const item of ['results','rollId','reservationId','leaderWouldBeEliminated'])
  assert.equal(JSON.stringify(ev).includes(item),false);
}));
test('trigger abort reverses result, command key, revision and event',()=>fixture(({cmd,req,db,state,counts})=>{
 const before=state();db.exec("CREATE TRIGGER abortLeader BEFORE INSERT ON lab_events BEGIN SELECT RAISE(ABORT,'ABORTED'); END");
 assert.throws(()=>cmd(req()),/ABORTED/);
 assert.deepEqual(state(),before);assert.deepEqual(counts(),{events:0,commands:0});
}));
test('corrupted cached outcome is never returned from an idempotent replay',()=>fixture(({cmd,req,db})=>{
 cmd(req());const state=JSON.parse(db.prepare('SELECT turn_json FROM lab_matches').get().turn_json);
 state.pendingCombat.fixtureLeaderCasualtyPreview.outcome.helmetCount=123;
 db.prepare('UPDATE lab_matches SET turn_json=?').run(JSON.stringify(state));
 assert.equal(cmd(req()).code,'LEADER_PREVIEW_REPLAY_UNAVAILABLE');
}));
