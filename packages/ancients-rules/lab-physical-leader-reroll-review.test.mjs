import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {makeLabLeaderRerollConsentCommand} from './lab-leader-reroll-consent.mjs';
import {makeLabLeaderDiceGateReader} from './lab-leader-dice-gate.mjs';
import {inspectLabLeaderRerollAttempt} from './lab-leader-reroll-attempt-contract.mjs';
import {makeLabPhysicalLeaderRerollAttemptCommand} from './lab-physical-leader-reroll-attempt.mjs';
import {makeLabPhysicalLeaderRerollReviewCommand} from './lab-physical-leader-reroll-review.mjs';
import {inspectLabLeaderRerollReviewState} from './lab-leader-reroll-review-state.mjs';

const MATCH='123e4567-e89b-42d3-a456-426614174000';
const RES='123e4567-e89b-42d3-a456-426614174010';
const sha=x=>createHash('sha256').update(x).digest('hex');
function fixture(fn,{agreementChoice='DISPUTE',digital=false,fixtureOnly=true,eliminated=false}={}) {
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE lab_matches (id TEXT PRIMARY KEY,owner_id TEXT,guest_id TEXT,revision INTEGER,turn_json TEXT,board_json TEXT);
    CREATE TABLE lab_events (match_id TEXT,sequence INTEGER,payload TEXT,PRIMARY KEY(match_id,sequence));
    CREATE TABLE lab_commands (match_id TEXT,actor TEXT,idem_key TEXT,signature TEXT,reservation_id TEXT,committed_revision INTEGER,PRIMARY KEY(match_id,actor,idem_key));`);
  const boardJson=JSON.stringify({units:eliminated?[]:[{id:'b1',blocksRemaining:2}],leaders:[{id:'l1'}]});
  const count=eliminated?1:2;
  const faces=count===1?['LEADER']:['LEADER','FLAG'];
  const roll={type:'ANCIENTS_BASE_LEADER_CASUALTY_CAPTURED',purpose:'LEADER_CASUALTY_CHECK',
    ruleset:'ancients-base-3e-2009',rollId:'lab_leader_'+RES.replaceAll('-',''),
    actor:'A',source:digital?'DIGITAL':'PHYSICAL',
    verification:digital?'SERVER_GENERATED':'PLAYER_DECLARED',diceCount:count,results:faces};
  const outcome={kind:'LAB_LEADER_CASUALTY_OUTCOME_PREVIEW',diceCount:count,
    helmetCount:1,leaderWouldBeEliminated:count===1,leaderMustEvadeIfApplied:false,
    leaderRemoved:false,leaderEvasionResolved:false,combatResolved:false,
    boardMutated:false,attackAuthorized:false};
  const preview={kind:'LEADER_CASUALTY_PREVIEW_ONLY',requiresFullAuthorization:true,roll,outcome};
  if(!digital)preview.physicalAgreement={kind:'LAB_PHYSICAL_LEADER_DICE_AGREEMENT_V1',
    revision:9,reviewerSide:'B',decision:agreementChoice,rollDigestSha256:sha(JSON.stringify(roll))};
  const turn={schemaVersion:1,revision:9,status:'ACTIVE',turn:'A',phase:'COMBAT',labFixtureOnly:fixtureOnly,
    pendingCombat:{kind:'LAB_DIRECT_HITS_APPLIED_FIXTURE',fullValidationRequired:true,
      reservationId:RES,actor:'A',appliedFixture:{revision:7,unverifiedFullRules:true,
        boardAfterSha256:sha(boardJson),summary:{leaderCheckRequired:true,
          nextRequiredStep:'LEADER_CASUALTY_CHECK',blocksRemoved:1,unitEliminated:eliminated}},
      fixtureLeaderCasualtyPreview:preview}};
  db.prepare('INSERT INTO lab_matches VALUES(?,?,?,?,?,?)').run(MATCH,'alice','bob',9,JSON.stringify(turn),boardJson);
  const inTransaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}
    catch(error){db.exec('ROLLBACK');throw error;}};
  const row=db.prepare('SELECT * FROM lab_matches WHERE id=?');
  const sideFor=(entry,user)=>entry.owner_id===user?'A':entry.guest_id===user?'B':null;
  const command=makeLabLeaderRerollConsentCommand({inTransaction,row,sideFor,
    previous:db.prepare('SELECT * FROM lab_commands WHERE match_id=? AND actor=? AND idem_key=?'),
    updateTurn:db.prepare('UPDATE lab_matches SET revision=?,turn_json=? WHERE id=? AND revision=?'),
    eventInsert:db.prepare('INSERT INTO lab_events VALUES(?,?,?)'),
    commandInsert:db.prepare('INSERT INTO lab_commands VALUES(?,?,?,?,?,?)')});
  const gate=makeLabLeaderDiceGateReader({inTransaction,row,sideFor});
  const declaration=makeLabPhysicalLeaderRerollAttemptCommand({inTransaction,row,sideFor,
    previous:db.prepare('SELECT * FROM lab_commands WHERE match_id=? AND actor=? AND idem_key=?'),
    updateTurn:db.prepare('UPDATE lab_matches SET revision=?,turn_json=? WHERE id=? AND revision=?'),
    eventInsert:db.prepare('INSERT INTO lab_events VALUES(?,?,?)'),
    commandInsert:db.prepare('INSERT INTO lab_commands VALUES(?,?,?,?,?,?)'),
    captureLeaderDice:({rollId,actor,diceCount,mode,declaredFaces})=>{
      if(mode!=='PHYSICAL' || !Array.isArray(declaredFaces) ||
        diceCount!==declaredFaces.length)throw new TypeError('INVALID_DECLARATION');
      return {type:'ANCIENTS_BASE_LEADER_CASUALTY_CAPTURED',purpose:'LEADER_CASUALTY_CHECK',
        ruleset:'ancients-base-3e-2009',rollId,actor,source:'PHYSICAL',
        verification:'PLAYER_DECLARED',diceCount,results:[...declaredFaces],
        attackAuthorized:false,combatResolved:false,needsFullLegalityCheck:true};
    }
  });
  const req=(side='A',overrides={})=>({matchId:MATCH,sessionUserId:side==='A'?'alice':'bob',
    reservationId:RES,expectedRevision:side==='A'?9:10,
    idempotencyKey:side==='A'?'attacker_reroll_yes_01':'defender_reroll_yes_01',
    choice:'CONSENT_REROLL',...overrides});
  const status=revision=>gate({matchId:MATCH,sessionUserId:'alice',reservationId:RES,expectedRevision:revision});
  const saved=()=>{const r=db.prepare('SELECT revision,turn_json,board_json FROM lab_matches').get();return {...r,turn:JSON.parse(r.turn_json)};};
  const counts=()=>({commands:db.prepare('SELECT count(*) n FROM lab_commands').get().n,
    events:db.prepare('SELECT count(*) n FROM lab_events').get().n});
  const newRoll=(changes={})=>({matchId:MATCH,sessionUserId:'alice',reservationId:RES,
    expectedRevision:11,idempotencyKey:'attacker_new_roll_01',
    declaredFaces:eliminated?['FLAG']:['FLAG','LIGHT'],...changes});
  const both=()=>{assert.equal(command(req()).status,200);
    assert.equal(command(req('B')).status,200);};
  const review=makeLabPhysicalLeaderRerollReviewCommand({inTransaction,row,sideFor,
    previous:db.prepare('SELECT * FROM lab_commands WHERE match_id=? AND actor=? AND idem_key=?'),
    updateTurn:db.prepare('UPDATE lab_matches SET revision=?,turn_json=? WHERE id=? AND revision=?'),
    eventInsert:db.prepare('INSERT INTO lab_events VALUES(?,?,?)'),
    commandInsert:db.prepare('INSERT INTO lab_commands VALUES(?,?,?,?,?,?)')});
  const reviewReq=(overrides={})=>({matchId:MATCH,sessionUserId:'bob',reservationId:RES,
    expectedRevision:12,idempotencyKey:'defender_reroll_review_01',decision:'CONFIRM',...overrides});
  const prepare=()=>{both();assert.equal(declaration(newRoll()).code,'LAB_REROLL_DECLARED');};
  try {return fn({db,command,declaration,newRoll,both,gate,req,status,saved,counts,
    review,reviewReq,prepare});}
  finally{db.close();}
}


test('review only after unanimous new physical declaration',()=>fixture(({review,reviewReq})=>{
  assert.equal(review(reviewReq({expectedRevision:9})).code,'REROLL_REVIEW_UNAVAILABLE');
}));
test('a defender confirmation does not authorize leader loss or clear original dispute',()=>fixture(({prepare,review,reviewReq,status,saved,counts})=>{
  prepare();const before=saved(),old=structuredClone(before.turn.pendingCombat.fixtureLeaderCasualtyPreview);
  const result=review(reviewReq());assert.equal(result.code,'REROLL_REVIEW_RECORDED');
  assert.equal(result.revision,13);assert.equal(result.newRollAccepted,true);
  assert.equal(result.combatAuthorized,false);assert.equal(result.leaderCasualtyApplied,false);
  const after=saved(),p=after.turn.pendingCombat.fixtureLeaderCasualtyPreview;
  for(const key of ['roll','outcome','physicalAgreement','rerollConsent'])assert.deepEqual(p[key],old[key]);
  assert.deepEqual(p.rerollAttempt.roll,old.rerollAttempt.roll);
  assert.equal(after.board_json,before.board_json);
  const gate=status(13).gate;assert.equal(gate.status,'PHYSICAL_DISPUTED');
  assert.equal(gate.rerollAttemptStatus,'PHYSICAL_REROLL_CONFIRMED');
  assert.equal(gate.newRollAccepted,true);assert.equal(gate.disputeBlocksContinuation,true);
  assert.equal(gate.combatAuthorized,false);assert.equal(gate.combatResolved,false);
  assert.deepEqual(counts(),{commands:4,events:4});
}));
test('defender can dispute the replacement without changing either roll',()=>fixture(({prepare,review,reviewReq,status,saved})=>{
  prepare();const previous=saved();
  const result=review(reviewReq({decision:'DISPUTE'}));
  assert.equal(result.code,'REROLL_REVIEW_RECORDED');assert.equal(result.newRollAccepted,false);
  const gate=status(13).gate;assert.equal(gate.rerollAttemptStatus,'PHYSICAL_REROLL_DISPUTED');
  assert.equal(gate.disputeBlocksContinuation,true);
  assert.deepEqual(saved().turn.pendingCombat.fixtureLeaderCasualtyPreview.rerollAttempt.roll,
    previous.turn.pendingCombat.fixtureLeaderCasualtyPreview.rerollAttempt.roll);
}));
test('one die following unit elimination is reviewed without removing leader',()=>fixture(({prepare,review,reviewReq,status,saved})=>{
  prepare();assert.equal(review(reviewReq()).status,200);
  assert.equal(saved().turn.pendingCombat.fixtureLeaderCasualtyPreview.rerollAttempt.roll.diceCount,1);
  assert.equal(status(13).gate.leaderCasualtyApplied,false);
},{eliminated:true}));
test('original attacker cannot self-approve and third parties see nothing',()=>fixture(({prepare,review,reviewReq})=>{
  prepare();assert.equal(review(reviewReq({sessionUserId:'alice'})).code,'REROLL_REVIEW_UNAVAILABLE');
  assert.equal(review(reviewReq({sessionUserId:'mallory'})).code,'NOT_FOUND');
}));
test('exact replay returns a stored decision with no new events',()=>fixture(({prepare,review,reviewReq,counts})=>{
  prepare();const first=review(reviewReq()),again=review(reviewReq());
  assert.equal(again.code,'REROLL_REVIEW_ALREADY_RECORDED');assert.equal(again.revision,first.revision);
  assert.deepEqual(counts(),{commands:4,events:4});
}));
test('a new key or reused key cannot reverse the review',()=>fixture(({prepare,review,reviewReq})=>{
  prepare();review(reviewReq());
  assert.equal(review(reviewReq({decision:'DISPUTE'})).code,'IDEMPOTENCY_KEY_REUSED');
  assert.equal(review(reviewReq({expectedRevision:13,idempotencyKey:'other_review_key_01'})).code,
    'REROLL_REVIEW_ALREADY_RECORDED');
}));
test('old reroll declaration and consent remain idempotently replayable after review',()=>fixture(({prepare,review,reviewReq,declaration,newRoll,command,req,counts})=>{
  prepare();review(reviewReq());
  assert.equal(declaration(newRoll()).code,'LAB_REROLL_ALREADY_DECLARED');
  assert.equal(command(req()).code,'REROLL_CONSENT_ALREADY_RECORDED');
  assert.equal(command(req('B')).code,'REROLL_CONSENT_ALREADY_RECORDED');
  assert.deepEqual(counts(),{commands:4,events:4});
}));
test('stale or client-forged review is rejected without disclosing faces',()=>fixture(({prepare,review,reviewReq})=>{
  prepare();assert.equal(review(reviewReq({expectedRevision:11})).code,'STALE_REVISION');
  for(const extra of [{declaredFaces:['LEADER']},{actor:'A'},{randomIndex:()=>1},
    {board:{}},{diceCount:1},{decision:'AUTO'},{idempotencyKey:'x'},
    {reservationId:'invalid'},{expectedRevision:1.5},{sessionUserId:null}])
    assert.equal(review(reviewReq(extra)).status,400);
}));
test('modified second roll or board fails closed before review',()=>fixture(({prepare,review,reviewReq,db})=>{
  prepare();const state=JSON.parse(db.prepare('SELECT turn_json FROM lab_matches').get().turn_json);
  state.pendingCombat.fixtureLeaderCasualtyPreview.rerollAttempt.roll.results=['RED','FLAG'];
  db.prepare('UPDATE lab_matches SET turn_json=?').run(JSON.stringify(state));
  assert.equal(review(reviewReq()).code,'REROLL_REVIEW_UNAVAILABLE');
}));
test('changed review digest or reviewer identity invalidates the persisted gate',()=>fixture(({prepare,review,reviewReq,status,db})=>{
  prepare();review(reviewReq());
  const state=JSON.parse(db.prepare('SELECT turn_json FROM lab_matches').get().turn_json);
  state.pendingCombat.fixtureLeaderCasualtyPreview.rerollAttempt.review.newRollDigestSha256='0'.repeat(64);
  db.prepare('UPDATE lab_matches SET turn_json=?').run(JSON.stringify(state));
  assert.equal(status(13).code,'LEADER_GATE_UNAVAILABLE');
  assert.equal(review(reviewReq()).code,'REROLL_REVIEW_UNAVAILABLE');
}));
test('the public review event omits roll ID, faces and casualty information',()=>fixture(({prepare,review,reviewReq,db})=>{
  prepare();review(reviewReq());
  const last=JSON.parse(db.prepare('SELECT payload FROM lab_events ORDER BY sequence DESC LIMIT 1').get().payload);
  assert.deepEqual(last,{sequence:13,type:'LAB_PHYSICAL_LEADER_REROLL_REVIEWED',side:'B',decision:'CONFIRM'});
  const raw=JSON.stringify(last);
  for(const sensitive of ['results','helmetCount','rollId',RES,'FLAG','LIGHT'])
    assert.equal(raw.includes(sensitive),false);
}));
test('failed event insert rolls back revision, review and idempotency key',()=>fixture(({prepare,review,reviewReq,saved,counts,db})=>{
  prepare();const before=saved();
  db.exec("CREATE TRIGGER abort_review BEFORE INSERT ON lab_events BEGIN SELECT RAISE(ABORT,'REVIEW_FAILED'); END");
  assert.throws(()=>review(reviewReq()),/REVIEW_FAILED/);
  assert.deepEqual(saved(),before);assert.deepEqual(counts(),{commands:3,events:3});
  db.exec('DROP TRIGGER abort_review');
  assert.equal(review(reviewReq()).code,'REROLL_REVIEW_RECORDED');
}));
test('pure inspector rejects extra attributes and returns a frozen no-effect result',()=>fixture(({prepare,saved})=>{
  prepare();const s=saved().turn.pendingCombat.fixtureLeaderCasualtyPreview;
  const data={attempt:s.rerollAttempt,reservationId:RES,attackerSide:'A',
    diceCount:2,consentRevision:11,currentRevision:12,
    originalRollDigestSha256:s.physicalAgreement.rollDigestSha256};
  const ok=inspectLabLeaderRerollReviewState(data);
  assert.equal(ok.status,'PHYSICAL_REROLL_AWAITING_OPPONENT');
  assert.equal(Object.isFrozen(ok),true);assert.equal(ok.combatAuthorized,false);
  assert.equal(inspectLabLeaderRerollReviewState({...data,attempt:{...s.rerollAttempt,hack:true}}),null);
}));
