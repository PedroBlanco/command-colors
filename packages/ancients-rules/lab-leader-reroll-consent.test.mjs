import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {makeLabLeaderRerollConsentCommand} from './lab-leader-reroll-consent.mjs';
import {makeLabLeaderDiceGateReader} from './lab-leader-dice-gate.mjs';
import {inspectLabRerollConsent} from './lab-reroll-consent-state.mjs';

const MATCH='123e4567-e89b-42d3-a456-426614174000';
const RES='123e4567-e89b-42d3-a456-426614174010';
const sha=x=>createHash('sha256').update(x).digest('hex');
function fixture(fn,{agreementChoice='DISPUTE',digital=false,fixtureOnly=true,eliminated=false}={}) {
  const db=new DatabaseSync(':memory:');
  db.exec(\`CREATE TABLE lab_matches (id TEXT PRIMARY KEY,owner_id TEXT,guest_id TEXT,revision INTEGER,turn_json TEXT,board_json TEXT);
    CREATE TABLE lab_events (match_id TEXT,sequence INTEGER,payload TEXT,PRIMARY KEY(match_id,sequence));
    CREATE TABLE lab_commands (match_id TEXT,actor TEXT,idem_key TEXT,signature TEXT,reservation_id TEXT,committed_revision INTEGER,PRIMARY KEY(match_id,actor,idem_key));\`);
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
  const req=(side='A',overrides={})=>({matchId:MATCH,sessionUserId:side==='A'?'alice':'bob',
    reservationId:RES,expectedRevision:side==='A'?9:10,
    idempotencyKey:side==='A'?'attacker_reroll_yes_01':'defender_reroll_yes_01',
    choice:'CONSENT_REROLL',...overrides});
  const status=revision=>gate({matchId:MATCH,sessionUserId:'alice',reservationId:RES,expectedRevision:revision});
  const saved=()=>{const r=db.prepare('SELECT revision,turn_json,board_json FROM lab_matches').get();return {...r,turn:JSON.parse(r.turn_json)};};
  const counts=()=>({commands:db.prepare('SELECT count(*) n FROM lab_commands').get().n,
    events:db.prepare('SELECT count(*) n FROM lab_events').get().n});
  try {return fn({db,command,gate,req,status,saved,counts});}finally{db.close();}
}

test('initial disputed gate blocks combat and requires both new consents',()=>fixture(({status})=>{
  const r=status(9);assert.equal(r.status,200);
  assert.equal(r.gate.status,'PHYSICAL_DISPUTED');
  assert.equal(r.gate.rerollConsentStatus,'AWAITING_BOTH_CONSENTS');
  assert.equal(r.gate.rerollConsentVotes,0);
  assert.equal(r.gate.disputeBlocksContinuation,true);
}));
test('attacker vote is recorded but cannot independently reroll',()=>fixture(({command,req,status})=>{
  const vote=command(req());
  assert.equal(vote.code,'REROLL_CONSENT_RECORDED');assert.equal(vote.revision,10);
  assert.equal(vote.consentStatus,'AWAITING_OTHER_CONSENT');
  assert.equal(vote.unanimousConsent,false);assert.equal(vote.rerollPerformed,false);
  const gate=status(10).gate;assert.equal(gate.status,'PHYSICAL_DISPUTED');
  assert.equal(gate.rerollConsentVotes,1);assert.equal(gate.rerollAllowed,false);
}));
test('explicit consent from both parties reaches unanimity without rerolling dice',()=>fixture(({command,req,status,saved,counts})=>{
  const original=saved();
  assert.equal(command(req()).status,200);
  const result=command(req('B'));
  assert.equal(result.status,200);assert.equal(result.revision,11);
  assert.equal(result.consentStatus,'BOTH_CONSENTED_NO_REROLL_YET');
  assert.equal(result.unanimousConsent,true);assert.equal(result.rerollPerformed,false);
  const current=status(11).gate;
  assert.equal(current.unanimousConsentForReroll,true);
  assert.equal(current.disputeBlocksContinuation,true);
  assert.equal(current.combatAuthorized,false);assert.equal(current.rerollAllowed,false);
  assert.equal(saved().board_json,original.board_json);
  assert.deepEqual(saved().turn.pendingCombat.fixtureLeaderCasualtyPreview.roll,
    original.turn.pendingCombat.fixtureLeaderCasualtyPreview.roll);
  assert.deepEqual(counts(),{commands:2,events:2});
}));
test('defender may vote first, attacker second',()=>fixture(({command,req,status})=>{
  assert.equal(command(req('B',{expectedRevision:9})).status,200);
  assert.equal(command(req('A',{expectedRevision:10})).status,200);
  assert.equal(status(11).gate.rerollConsentStatus,'BOTH_CONSENTED_NO_REROLL_YET');
}));
test('an explicit refusal vetoes a reroll even if the other player consents',()=>fixture(({command,req,status})=>{
  assert.equal(command(req('A',{choice:'REFUSE_REROLL'})).consentStatus,'REROLL_REFUSED');
  assert.equal(command(req('B')).consentStatus,'REROLL_REFUSED');
  assert.equal(status(11).gate.unanimousConsentForReroll,false);
  assert.equal(status(11).gate.disputeBlocksContinuation,true);
}));
test('two refusals preserve a permanent disputed blocker',()=>fixture(({command,req,status})=>{
  command(req('A',{choice:'REFUSE_REROLL'}));
  command(req('B',{choice:'REFUSE_REROLL'}));
  assert.equal(status(11).gate.rerollConsentStatus,'REROLL_REFUSED');
  assert.equal(status(11).gate.combatResolved,false);
}));
test('same vote can be replayed after the other actor voted',()=>fixture(({command,req,counts})=>{
  const one=command(req());const two=command(req('B'));
  const replay=command(req());
  assert.equal(replay.code,'REROLL_CONSENT_ALREADY_RECORDED');
  assert.equal(replay.revision,one.revision);
  assert.equal(replay.consentStatus,two.consentStatus);
  assert.deepEqual(counts(),{commands:2,events:2});
}));
test('a different key cannot replace the same side vote',()=>fixture(({command,req,counts})=>{
  command(req());
  const attempt=command(req('A',{expectedRevision:10,idempotencyKey:'attacker_other_key_01'}));
  assert.equal(attempt.code,'REROLL_CONSENT_ALREADY_RECORDED');
  assert.deepEqual(counts(),{commands:1,events:1});
}));
test('same key with modified choice or expected revision is refused',()=>fixture(({command,req})=>{
  command(req());
  assert.equal(command(req('A',{choice:'REFUSE_REROLL'})).code,'IDEMPOTENCY_KEY_REUSED');
  assert.equal(command(req('A',{expectedRevision:10})).code,'IDEMPOTENCY_KEY_REUSED');
}));
test('third parties are hidden and neither player may forge the other vote',()=>fixture(({command,req,counts})=>{
  assert.equal(command(req('A',{sessionUserId:'mallory'})).code,'NOT_FOUND');
  assert.equal(command(req('A',{sessionUserId:'bob',expectedRevision:9})).status,200);
  assert.equal(command(req('B',{sessionUserId:'alice',expectedRevision:10})).status,200);
  assert.deepEqual(counts(),{commands:2,events:2});
}));
test('a confirmed physical roll has no reason to solicit reroll consent',()=>fixture(({command,req})=>{
  assert.equal(command(req()).code,'REROLL_CONSENT_UNAVAILABLE');
},{agreementChoice:'CONFIRM'}));
test('digital results are excluded from the physical dispute workflow',()=>fixture(({command,req})=>{
  assert.equal(command(req()).code,'REROLL_CONSENT_UNAVAILABLE');
},{digital:true}));
test('fixture flag missing prohibits reroll consent',()=>fixture(({command,req})=>{
  assert.equal(command(req()).code,'REROLL_CONSENT_UNAVAILABLE');
},{fixtureOnly:false}));
test('stale revision cannot append a vote or reveal stored rolls',()=>fixture(({command,req})=>{
  assert.equal(command(req('A',{expectedRevision:8})).code,'STALE_REVISION');
}));
test('client cannot choose board, faces, RNG or author identity',()=>fixture(({command,req})=>{
  for(const extra of [{board:{}},{declaredFaces:['LEADER']},{diceCount:1},
    {randomIndex:()=>3},{side:'B'},{rollId:'foo'}])
    assert.equal(command(req('A',extra)).code,'INVALID_REROLL_CONSENT_REQUEST');
}));
test('unexpected choice, idempotency key and UUIDs are rejected',()=>fixture(({command,req})=>{
  for(const extra of [{choice:'AGREE'},{idempotencyKey:'short'},
    {reservationId:'nope'},{matchId:null},{expectedRevision:1.5},{sessionUserId:null}])
    assert.equal(command(req('A',extra)).status,400);
}));
test('event contains only decision and acting side',()=>fixture(({command,req,db})=>{
  command(req());
  const event=JSON.parse(db.prepare('SELECT payload FROM lab_events').get().payload);
  assert.deepEqual(event,{sequence:10,type:'LAB_LEADER_REROLL_CONSENT_RECORDED',
    side:'A',choice:'CONSENT_REROLL'});
  const raw=JSON.stringify(event);
  for(const value of [RES,'\\"results\\":','\\"rollId\\":','\\"helmetCount\\":','\\"leaderWouldBeEliminated\\":'])
    assert.equal(raw.includes(value),false,value);
}));
test('failed event insert rolls back vote, state, revision and command',()=>fixture(({command,req,db,saved,counts})=>{
  const before=saved();
  db.exec("CREATE TRIGGER abort_event BEFORE INSERT ON lab_events BEGIN SELECT RAISE(ABORT,'DISPUTE_TEST_ROLLBACK'); END");
  assert.throws(()=>command(req()),/DISPUTE_TEST_ROLLBACK/);
  assert.deepEqual(saved(),before);assert.deepEqual(counts(),{commands:0,events:0});
  db.exec('DROP TRIGGER abort_event');
  assert.equal(command(req()).status,200);
}));
test('tampered original dice after one vote invalidate both gate and further votes',()=>fixture(({command,req,db,status})=>{
  command(req());
  const turn=JSON.parse(db.prepare('SELECT turn_json FROM lab_matches').get().turn_json);
  turn.pendingCombat.fixtureLeaderCasualtyPreview.roll.results=['FLAG','FLAG'];
  db.prepare('UPDATE lab_matches SET turn_json=?').run(JSON.stringify(turn));
  assert.equal(status(10).code,'LEADER_GATE_UNAVAILABLE');
  assert.equal(command(req('B')).code,'REROLL_CONSENT_UNAVAILABLE');
}));
test('forged one-sided vote revision is rejected',()=>fixture(({command,req,db,status})=>{
  command(req());
  const turn=JSON.parse(db.prepare('SELECT turn_json FROM lab_matches').get().turn_json);
  turn.pendingCombat.fixtureLeaderCasualtyPreview.rerollConsent.votes.A.revision=900;
  db.prepare('UPDATE lab_matches SET turn_json=?').run(JSON.stringify(turn));
  assert.equal(status(10).code,'LEADER_GATE_UNAVAILABLE');
  assert.equal(command(req('B')).code,'REROLL_CONSENT_UNAVAILABLE');
}));
test('forged roll digest prevents any future vote or agreement',()=>fixture(({command,req,db,status})=>{
  command(req());
  const turn=JSON.parse(db.prepare('SELECT turn_json FROM lab_matches').get().turn_json);
  turn.pendingCombat.fixtureLeaderCasualtyPreview.rerollConsent.rollDigestSha256='0'.repeat(64);
  db.prepare('UPDATE lab_matches SET turn_json=?').run(JSON.stringify(turn));
  assert.equal(status(10).code,'LEADER_GATE_UNAVAILABLE');
}));
test('no vote marker with an unexplained later revision fails closed',()=>fixture(({command,req,db,status})=>{
  const turn=JSON.parse(db.prepare('SELECT turn_json FROM lab_matches').get().turn_json);
  turn.revision=10;
  db.prepare('UPDATE lab_matches SET revision=10,turn_json=?').run(JSON.stringify(turn));
  assert.equal(status(10).code,'LEADER_GATE_UNAVAILABLE');
  assert.equal(command(req('B')).code,'REROLL_CONSENT_UNAVAILABLE');
}));
test('reader output never includes original helmet count or faces',()=>fixture(({command,req,status})=>{
  command(req());command(req('B'));
  const output=JSON.stringify(status(11));
  for(const value of ['helmetCount','results','rollId','"LEADER","FLAG"',RES,'leaderWouldBeEliminated'])
    assert.equal(output.includes(value),false,value);
}));
test('pure consent-state inspector is immutable and does not permit an actual reroll',()=>{
  const r=inspectLabRerollConsent({resolution:undefined,agreementRevision:9,
    rollDigestSha256:'a'.repeat(64),currentRevision:9,attackerSide:'A'});
  assert.equal(Object.isFrozen(r),true);assert.equal(r.rerollAllowed,false);
  assert.equal(r.rerollPerformed,false);
});
