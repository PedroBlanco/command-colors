import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {makeLabPhysicalLeaderAgreementCommand,
  validateLabPhysicalLeaderPreview} from './lab-physical-leader-agreement.mjs';

const MATCH='123e4567-e89b-42d3-a456-426614174000';
const RES='123e4567-e89b-42d3-a456-426614174010';
const digest=s=>createHash('sha256').update(s).digest('hex');
function fixture(run,{rollMode='PHYSICAL',eliminated=false,fixtureOnly=true,leaderCheck=true}={}) {
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE lab_matches(id TEXT PRIMARY KEY,owner_id TEXT,guest_id TEXT,
    revision INTEGER,turn_json TEXT,board_json TEXT);
    CREATE TABLE lab_events(match_id TEXT,sequence INTEGER,payload TEXT,
    PRIMARY KEY(match_id,sequence));
    CREATE TABLE lab_commands(match_id TEXT,actor TEXT,idem_key TEXT,signature TEXT,
    reservation_id TEXT,committed_revision INTEGER,PRIMARY KEY(match_id,actor,idem_key));`);
  const boardJson=JSON.stringify({units:eliminated?[]:[{id:'b1',blocksRemaining:2}],leaders:[{id:'leader_b'}]});
  const count=eliminated?1:2;
  const roll={type:'ANCIENTS_BASE_LEADER_CASUALTY_CAPTURED',purpose:'LEADER_CASUALTY_CHECK',
    ruleset:'ancients-base-3e-2009',rollId:'lab_leader_'+RES.replaceAll('-',''),actor:'A',
    diceCount:count,source:rollMode,
    verification:rollMode==='PHYSICAL'?'PLAYER_DECLARED':'SERVER_GENERATED',
    results:count===1?['LEADER']:['LEADER','FLAG']};
  const outcome={kind:'LAB_LEADER_CASUALTY_OUTCOME_PREVIEW',diceCount:count,
    helmetCount:1,leaderWouldBeEliminated:count===1,
    leaderMustEvadeIfApplied:false,leaderRemoved:false,leaderEvasionResolved:false,
    combatResolved:false,boardMutated:false,attackAuthorized:false};
  const state={revision:8,status:'ACTIVE',turn:'A',phase:'COMBAT',labFixtureOnly:fixtureOnly,
    pendingCombat:{kind:'LAB_DIRECT_HITS_APPLIED_FIXTURE',fullValidationRequired:true,
      reservationId:RES,actor:'A',appliedFixture:{revision:7,unverifiedFullRules:true,
        boardAfterSha256:digest(boardJson),summary:{leaderCheckRequired:leaderCheck,
          nextRequiredStep:'LEADER_CASUALTY_CHECK',blocksRemoved:1,unitEliminated:eliminated}},
      fixtureLeaderCasualtyPreview:{kind:'LEADER_CASUALTY_PREVIEW_ONLY',requiresFullAuthorization:true,roll,outcome}}};
  db.prepare('INSERT INTO lab_matches VALUES (?,?,?,?,?,?)').run(MATCH,'alice','bob',8,JSON.stringify(state),boardJson);
  const inTransaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const val=fn();db.exec('COMMIT');return val;}catch(e){db.exec('ROLLBACK');throw e;}};
  const method=makeLabPhysicalLeaderAgreementCommand({inTransaction,
    row:db.prepare('SELECT * FROM lab_matches WHERE id=?'),
    previous:db.prepare('SELECT * FROM lab_commands WHERE match_id=? AND actor=? AND idem_key=?'),
    sideFor:(entry,user)=>entry.owner_id===user?'A':entry.guest_id===user?'B':null,
    updateTurn:db.prepare('UPDATE lab_matches SET revision=?,turn_json=? WHERE id=? AND revision=?'),
    eventInsert:db.prepare('INSERT INTO lab_events VALUES(?,?,?)'),
    commandInsert:db.prepare('INSERT INTO lab_commands VALUES(?,?,?,?,?,?)')});
  const request=(changes={})=>({matchId:MATCH,sessionUserId:'bob',reservationId:RES,
    expectedRevision:8,idempotencyKey:'review_leader_dice_0001',decision:'CONFIRM',...changes});
  const saved=()=>{const r=db.prepare('SELECT * FROM lab_matches').get();return {...r,turn:JSON.parse(r.turn_json)};};
  const counts=()=>({events:db.prepare('SELECT count(*) n FROM lab_events').get().n,
    commands:db.prepare('SELECT count(*) n FROM lab_commands').get().n});
  try{return run({db,method,request,saved,counts});}finally{db.close();}
}

test('defender confirms reported physical dice without touching board or resolving combat',()=>fixture(({method,request,saved,counts})=>{
 const before=saved(),result=method(request()),after=saved();
 assert.equal(result.status,200);assert.equal(result.code,'PHYSICAL_AGREEMENT_RECORDED');
 assert.equal(result.physicalRollAccepted,true);assert.equal(result.combatResolved,false);
 assert.equal(result.attackAuthorized,false);assert.equal(result.boardMutated,false);
 assert.equal(after.board_json,before.board_json);assert.equal(after.revision,9);
 assert.deepEqual(counts(),{events:1,commands:1});
 assert.equal(after.turn.pendingCombat.fixtureLeaderCasualtyPreview.outcome.leaderRemoved,false);
 assert.equal(after.turn.pendingCombat.fixtureLeaderCasualtyPreview.physicalAgreement.decision,'CONFIRM');
}));

test('defender can dispute, locking original faces without confirming them',()=>fixture(({method,request,saved})=>{
 const out=method(request({decision:'DISPUTE'}));
 assert.equal(out.physicalRollAccepted,false);assert.equal(out.combatResolved,false);
 assert.deepEqual(saved().turn.pendingCombat.fixtureLeaderCasualtyPreview.roll.results,['LEADER','FLAG']);
 assert.equal(saved().turn.pendingCombat.fixtureLeaderCasualtyPreview.physicalAgreement.decision,'DISPUTE');
}));

test('same-key replay is idempotent and does not append events',()=>fixture(({method,request,counts})=>{
 const first=method(request()),replayed=method(request());
 assert.equal(replayed.code,'PHYSICAL_AGREEMENT_ALREADY_RECORDED');
 assert.equal(replayed.revision,first.revision);assert.deepEqual(counts(),{events:1,commands:1});
}));

test('confirmation cannot be replaced by dispute with same key',()=>fixture(({method,request})=>{
 method(request());assert.equal(method(request({decision:'DISPUTE'})).code,'IDEMPOTENCY_KEY_REUSED');
}));

test('second key cannot revise a recorded confirmation',()=>fixture(({method,request,counts})=>{
 method(request());assert.equal(method(request({expectedRevision:9,idempotencyKey:'review_leader_dice_0002'})).code,'PHYSICAL_AGREEMENT_ALREADY_RECORDED');
 assert.deepEqual(counts(),{events:1,commands:1});
}));

test('actor who declared the roll cannot confirm it; strangers do not see match',()=>fixture(({method,request})=>{
 assert.equal(method(request({sessionUserId:'alice'})).code,'PHYSICAL_AGREEMENT_UNAVAILABLE');
 assert.equal(method(request({sessionUserId:'mallory'})).code,'NOT_FOUND');
}));

test('digital dice are not eligible for physical confirmation',()=>fixture(({method,request,counts})=>{
 assert.equal(method(request()).code,'PHYSICAL_AGREEMENT_UNAVAILABLE');
 assert.deepEqual(counts(),{events:0,commands:0});
},{rollMode:'DIGITAL'}));

test('fixture consent requires explicit laboratory marker and a prior leader-check phase',()=>{
 fixture(({method,request})=>assert.equal(method(request()).code,'PHYSICAL_AGREEMENT_UNAVAILABLE'),{fixtureOnly:false});
 fixture(({method,request})=>assert.equal(method(request()).code,'PHYSICAL_AGREEMENT_UNAVAILABLE'),{leaderCheck:false});
});

test('last-block casualty uses a single physical die and is confirmable',()=>fixture(({method,request,saved})=>{
 assert.equal(method(request()).status,200);
 assert.equal(saved().turn.pendingCombat.fixtureLeaderCasualtyPreview.roll.diceCount,1);
},{eliminated:true}));

test('the stored roll must be internally consistent before any confirmation',()=>fixture(({db,method,request})=>{
 const state=JSON.parse(db.prepare('SELECT turn_json FROM lab_matches').get().turn_json);
 state.pendingCombat.fixtureLeaderCasualtyPreview.outcome.helmetCount=99;
 db.prepare('UPDATE lab_matches SET turn_json=?').run(JSON.stringify(state));
 assert.equal(method(request()).code,'PHYSICAL_AGREEMENT_UNAVAILABLE');
}));

test('changed physical faces after review break idempotent replay',()=>fixture(({db,method,request})=>{
 method(request());const state=JSON.parse(db.prepare('SELECT turn_json FROM lab_matches').get().turn_json);
 state.pendingCombat.fixtureLeaderCasualtyPreview.roll.results=['FLAG','FLAG'];
 db.prepare('UPDATE lab_matches SET turn_json=?').run(JSON.stringify(state));
 assert.equal(method(request()).code,'PHYSICAL_AGREEMENT_UNAVAILABLE');
}));

test('board modified since direct-hit fixture cannot be confirmed',()=>fixture(({db,method,request})=>{
 db.prepare('UPDATE lab_matches SET board_json=?').run('{"different":true}');
 assert.equal(method(request()).code,'PHYSICAL_AGREEMENT_UNAVAILABLE');
}));

test('stale revision, unexpected body fields and malformed decisions are rejected',()=>fixture(({method,request})=>{
 assert.equal(method(request({expectedRevision:7})).code,'STALE_REVISION');
 for(const c of [{decision:'OTHER'},{idempotencyKey:'x'},{declaredFaces:['LEADER']},
  {diceCount:2},{reservationId:'bad'},{expectedRevision:1.2},{sessionUserId:null}])
  assert.equal(method(request(c)).status,400);
}));

test('public event has no face, leader or target identifiers',()=>fixture(({db,method,request})=>{
 method(request());const event=JSON.parse(db.prepare('SELECT payload FROM lab_events').get().payload);
 assert.deepEqual(event,{sequence:9,type:'LAB_PHYSICAL_LEADER_DICE_REVIEWED',side:'B',decision:'CONFIRM'});
 for(const forbidden of ['rollId','results','helmetCount','leader_b','reservationId',RES])
  assert.equal(JSON.stringify(event).includes(forbidden),false);
}));

test('failed event write rolls back agreement, revision and command key',()=>fixture(({db,method,request,saved,counts})=>{
 const before=saved();db.exec("CREATE TRIGGER fail_agreement BEFORE INSERT ON lab_events BEGIN SELECT RAISE(ABORT,'AGREEMENT_FAILED'); END");
 assert.throws(()=>method(request()),/AGREEMENT_FAILED/);
 assert.deepEqual(saved(),before);assert.deepEqual(counts(),{events:0,commands:0});
 db.exec('DROP TRIGGER fail_agreement');assert.equal(method(request()).status,200);
}));

test('stored marker validator rejects official data not represented by a physical declaration',()=>fixture(({saved})=>{
 const s=saved();assert.ok(validateLabPhysicalLeaderPreview(s.turn.pendingCombat,s.board_json));
 assert.equal(validateLabPhysicalLeaderPreview({...s.turn.pendingCombat,appliedFixture:null},s.board_json),null);
}));

test('replay refuses a damaged acknowledgement marker',()=>fixture(({db,method,request})=>{
 method(request());const turn=JSON.parse(db.prepare('SELECT turn_json FROM lab_matches').get().turn_json);
 turn.pendingCombat.fixtureLeaderCasualtyPreview.physicalAgreement.kind='FORGED';
 db.prepare('UPDATE lab_matches SET turn_json=?').run(JSON.stringify(turn));
 assert.equal(method(request()).code,'PHYSICAL_AGREEMENT_REPLAY_UNAVAILABLE');
}));
