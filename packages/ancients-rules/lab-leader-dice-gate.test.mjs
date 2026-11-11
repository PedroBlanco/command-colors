import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {makeLabLeaderDiceGateReader,evaluateLabLeaderDiceGate}
  from './lab-leader-dice-gate.mjs';
import {makeLabPhysicalLeaderAgreementCommand}
  from './lab-physical-leader-agreement.mjs';

const MATCH='123e4567-e89b-42d3-a456-426614174000';
const RES='123e4567-e89b-42d3-a456-426614174010';
const hash=x=>createHash('sha256').update(x).digest('hex');
const make=({physical=true,eliminated=false,withLeader=true,flagged=true}={})=>{
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE lab_matches (id TEXT PRIMARY KEY,owner_id TEXT,guest_id TEXT,revision INTEGER,turn_json TEXT,board_json TEXT);
    CREATE TABLE lab_events (match_id TEXT,sequence INTEGER,payload TEXT,PRIMARY KEY(match_id,sequence));
    CREATE TABLE lab_commands (match_id TEXT,actor TEXT,idem_key TEXT,signature TEXT,reservation_id TEXT,committed_revision INTEGER,PRIMARY KEY(match_id,actor,idem_key));`);
  const boardJson=JSON.stringify({units:eliminated?[]:[{id:'b1',blocksRemaining:2}],leaders:[{id:'l1'}]});
  const count=eliminated?1:2;
  const faces=count===1?['LEADER']:['LEADER','FLAG'];
  const roll={type:'ANCIENTS_BASE_LEADER_CASUALTY_CAPTURED',purpose:'LEADER_CASUALTY_CHECK',
    ruleset:'ancients-base-3e-2009',rollId:'lab_leader_'+RES.replaceAll('-',''),
    actor:'A',source:physical?'PHYSICAL':'DIGITAL',
    verification:physical?'PLAYER_DECLARED':'SERVER_GENERATED',
    diceCount:count,results:faces};
  const saved={kind:'LEADER_CASUALTY_PREVIEW_ONLY',requiresFullAuthorization:true,roll,
    outcome:{kind:'LAB_LEADER_CASUALTY_OUTCOME_PREVIEW',diceCount:count,
      helmetCount:1,leaderWouldBeEliminated:count===1,
      leaderMustEvadeIfApplied:false,leaderRemoved:false,leaderEvasionResolved:false,
      combatResolved:false,boardMutated:false,attackAuthorized:false}};
  const turn={schemaVersion:1,revision:8,status:'ACTIVE',turn:'A',phase:'COMBAT',labFixtureOnly:flagged,
    pendingCombat:{kind:'LAB_DIRECT_HITS_APPLIED_FIXTURE',fullValidationRequired:true,
      reservationId:RES,actor:'A',appliedFixture:{revision:7,unverifiedFullRules:true,
        boardAfterSha256:hash(boardJson),summary:{leaderCheckRequired:withLeader,
          nextRequiredStep:'LEADER_CASUALTY_CHECK',blocksRemoved:1,unitEliminated:eliminated}},
      fixtureLeaderCasualtyPreview:saved}};
  db.prepare('INSERT INTO lab_matches VALUES(?,?,?,?,?,?)').run(MATCH,'alice','bob',8,
    JSON.stringify(turn),boardJson);
  const row=db.prepare('SELECT * FROM lab_matches WHERE id=?');
  const sideFor=(entry,user)=>entry.owner_id===user?'A':entry.guest_id===user?'B':null;
  const inTransaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const out=fn();db.exec('COMMIT');return out;}
    catch(err){db.exec('ROLLBACK');throw err;}};
  const reader=makeLabLeaderDiceGateReader({inTransaction,row,sideFor});
  const agreement=makeLabPhysicalLeaderAgreementCommand({inTransaction,row,sideFor,
    previous:db.prepare('SELECT * FROM lab_commands WHERE match_id=? AND actor=? AND idem_key=?'),
    updateTurn:db.prepare('UPDATE lab_matches SET revision=?,turn_json=? WHERE id=? AND revision=?'),
    eventInsert:db.prepare('INSERT INTO lab_events VALUES(?,?,?)'),
    commandInsert:db.prepare('INSERT INTO lab_commands VALUES(?,?,?,?,?,?)')});
  const request=(changes={})=>({matchId:MATCH,sessionUserId:'alice',reservationId:RES,
    expectedRevision:8,...changes});
  const review=(decision='CONFIRM')=>agreement({matchId:MATCH,sessionUserId:'bob',reservationId:RES,
    expectedRevision:8,idempotencyKey:'gate_physical_review_01',decision});
  const savedState=()=>db.prepare('SELECT turn_json,board_json,revision FROM lab_matches').get();
  const corrupt=(change)=>{const state=savedState(),turn=JSON.parse(state.turn_json);
    change(turn);db.prepare('UPDATE lab_matches SET turn_json=?').run(JSON.stringify(turn));};
  return {db,reader,agreement,review,request,savedState,corrupt};
};
const fixture=(fn,options)=>{const env=make(options);try{return fn(env);}finally{env.db.close();}};

test('physical dice remain pending before a second-player acknowledgement',()=>fixture(({reader,request})=>{
 const r=reader(request());assert.equal(r.status,200);
 assert.equal(r.gate.status,'PHYSICAL_AWAITING_OPPONENT');
 assert.equal(r.gate.recordUncontested,false);
 assert.equal(r.gate.needsOpponentReview,true);
 assert.equal(r.gate.disputeBlocksContinuation,false);
 assert.equal(r.gate.combatAuthorized,false);
}));
test('a separate opponent confirmation clears only the administrative review gate',()=>fixture(({reader,request,review})=>{
 assert.equal(review().status,200);
 const r=reader(request({expectedRevision:9}));
 assert.equal(r.gate.status,'PHYSICAL_OPPONENT_CONFIRMED');
 assert.equal(r.gate.recordUncontested,true);
 assert.equal(r.gate.requiresCompleteRulesAuthorization,true);
 assert.equal(r.gate.leaderCasualtyApplied,false);
 assert.equal(r.gate.combatResolved,false);
}));
test('a dispute blocks advancement rather than repeating or altering the physical dice',()=>fixture(({reader,request,review})=>{
 assert.equal(review('DISPUTE').status,200);
 const r=reader(request({expectedRevision:9}));
 assert.equal(r.gate.status,'PHYSICAL_DISPUTED');
 assert.equal(r.gate.recordUncontested,false);
 assert.equal(r.gate.disputeBlocksContinuation,true);
 assert.equal(r.gate.leaderCasualtyApplied,false);
}));
test('server-generated digital dice need no physical agreement but cannot finalize combat',()=>fixture(({reader,request})=>{
 const r=reader(request());assert.equal(r.gate.status,'DIGITAL_SERVER_CAPTURED');
 assert.equal(r.gate.recordUncontested,true);
 assert.equal(r.gate.combatAuthorized,false);
 assert.equal(r.gate.combatResolved,false);
},{physical:false}));
test('both participants may see status only; outsiders may not inspect it',()=>fixture(({reader,request})=>{
 const a=reader(request());const b=reader(request({sessionUserId:'bob'}));
 assert.deepEqual(a.gate,b.gate);
 assert.equal(reader(request({sessionUserId:'mallory'})).code,'NOT_FOUND');
 const output=JSON.stringify(b);
 for(const forbidden of ['leader_b','results','rollId','helmetCount',RES,'\"LEADER\",\"FLAG\"'])
   assert.equal(output.includes(forbidden),false,forbidden);
}));
test('status query is read-only before and after defender confirmation',()=>fixture(({db,reader,request,review,savedState})=>{
 const before=savedState();reader(request());reader(request({sessionUserId:'bob'}));
 assert.deepEqual(savedState(),before);
 review();const after=savedState();reader(request({expectedRevision:9}));
 assert.deepEqual(savedState(),after);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM lab_events').get().n,1);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM lab_commands').get().n,1);
}));
test('the status gate uses the original one-die leader check after unit elimination',()=>fixture(({reader,request})=>{
 const r=reader(request());assert.equal(r.gate.status,'PHYSICAL_AWAITING_OPPONENT');
 assert.equal(r.gate.leaderCasualtyApplied,false);
},{eliminated:true}));
test('a forged opponent identity in stored acknowledgement is rejected',()=>fixture(({reader,review,request,corrupt})=>{
 review();corrupt(t=>t.pendingCombat.fixtureLeaderCasualtyPreview.physicalAgreement.reviewerSide='A');
 assert.equal(reader(request({expectedRevision:9})).code,'LEADER_GATE_UNAVAILABLE');
}));
test('a forged acknowledgement revision is rejected',()=>fixture(({reader,review,request,corrupt})=>{
 review();corrupt(t=>t.pendingCombat.fixtureLeaderCasualtyPreview.physicalAgreement.revision=8);
 assert.equal(reader(request({expectedRevision:9})).code,'LEADER_GATE_UNAVAILABLE');
}));
test('an acknowledgement digest inconsistent with the saved roll is rejected',()=>fixture(({reader,review,request,corrupt})=>{
 review();corrupt(t=>t.pendingCombat.fixtureLeaderCasualtyPreview.physicalAgreement.rollDigestSha256='0'.repeat(64));
 assert.equal(reader(request({expectedRevision:9})).code,'LEADER_GATE_UNAVAILABLE');
}));
test('a digital roll with a fabricated physical agreement is invalid',()=>fixture(({reader,request,corrupt})=>{
 corrupt(t=>t.pendingCombat.fixtureLeaderCasualtyPreview.physicalAgreement={decision:'CONFIRM'});
 assert.equal(reader(request()).code,'LEADER_GATE_UNAVAILABLE');
},{physical:false}));
test('a manipulated outcome is never assumed to be confirmed',()=>fixture(({reader,request,corrupt})=>{
 corrupt(t=>t.pendingCombat.fixtureLeaderCasualtyPreview.outcome.helmetCount=2);
 assert.equal(reader(request()).code,'LEADER_GATE_UNAVAILABLE');
}));
test('a leader die changed to synthetic or another purpose is rejected',()=>fixture(({reader,request,corrupt})=>{
 corrupt(t=>t.pendingCombat.fixtureLeaderCasualtyPreview.roll.type='DICE_ROLLED_SYNTHETIC');
 assert.equal(reader(request()).code,'LEADER_GATE_UNAVAILABLE');
}));
test('leader check with wrong number of dice is rejected',()=>fixture(({reader,request,corrupt})=>{
 corrupt(t=>t.pendingCombat.fixtureLeaderCasualtyPreview.roll.diceCount=1);
 assert.equal(reader(request()).code,'LEADER_GATE_UNAVAILABLE');
}));
test('no explicit fixture permission or an absent leader pending phase rejects',()=>{
 fixture(({reader,request})=>assert.equal(reader(request()).code,'LEADER_GATE_UNAVAILABLE'),{flagged:false});
 fixture(({reader,request})=>assert.equal(reader(request()).code,'LEADER_GATE_UNAVAILABLE'),{withLeader:false});
});
test('changed post-hit board fails the fingerprint check',()=>fixture(({db,reader,request})=>{
 db.prepare('UPDATE lab_matches SET board_json=?').run('{"tampered":true}');
 assert.equal(reader(request()).code,'LEADER_GATE_UNAVAILABLE');
}));
test('a stale or malformed query cannot reveal private roll data',()=>fixture(({reader,request})=>{
 assert.equal(reader(request({expectedRevision:7})).code,'STALE_REVISION');
 for(const x of [{diceCount:1},{rollId:'injected'},{leaderAttached:false},{board:{}},
   {sessionUserId:null},{reservationId:'not-uuid'},{expectedRevision:'8'}]) {
   assert.equal(reader(request(x)).status,400);
 }
}));
test('future check status cannot be inferred from a mismatched reservation',()=>fixture(({reader,request})=>{
 assert.equal(reader(request({reservationId:'123e4567-e89b-42d3-a456-426614174020'})).code,'LEADER_GATE_UNAVAILABLE');
}));
test('corrupted turn revision refuses to issue either pending or confirmed status',()=>fixture(({reader,request,corrupt})=>{
 corrupt(t=>t.revision=9);
 assert.equal(reader(request()).code,'LEADER_GATE_UNAVAILABLE');
}));
test('pure evaluator is immutable and reports no outcome or die faces',()=>fixture(({savedState})=>{
 const s=savedState(),turn=JSON.parse(s.turn_json),before=structuredClone(turn);
 const gate=evaluateLabLeaderDiceGate({turnState:turn,boardJson:s.board_json,reservationId:RES});
 assert.equal(Object.isFrozen(gate),true);
 assert.deepEqual(turn,before);
 assert.equal('roll' in gate,false);assert.equal('leaderWouldBeEliminated' in gate,false);
 assert.equal(gate.attackAuthorized,undefined);
}));
