import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {makeLabLeaderRerollConsentCommand} from './lab-leader-reroll-consent.mjs';
import {makeLabLeaderDiceGateReader} from './lab-leader-dice-gate.mjs';
import {inspectLabLeaderRerollAttempt} from './lab-leader-reroll-attempt-contract.mjs';
import {makeLabPhysicalLeaderRerollAttemptCommand} from './lab-physical-leader-reroll-attempt.mjs';

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
  try {return fn({db,command,declaration,newRoll,both,gate,req,status,saved,counts});}
  finally{db.close();}
}

test('without bilateral consent new physical dice are rejected',()=>fixture(({declaration,newRoll})=>{
  assert.equal(declaration(newRoll({expectedRevision:9})).code,'REROLL_UNAVAILABLE');
}));
test('one consenting player cannot unilaterally declare a new roll',()=>fixture(({command,req,declaration,newRoll})=>{
  command(req());
  assert.equal(declaration(newRoll({expectedRevision:10})).code,'REROLL_UNAVAILABLE');
}));
test('a refusal by either player prevents the attempted reroll',()=>fixture(({command,req,declaration,newRoll})=>{
  command(req('A',{choice:'REFUSE_REROLL'}));command(req('B'));
  assert.equal(declaration(newRoll()).code,'REROLL_UNAVAILABLE');
}));
test('real stored two-vote consent allows one separately identified new physical declaration',()=>fixture(({both,declaration,newRoll,saved,status,counts})=>{
  both();const before=saved();const original=structuredClone(before.turn.pendingCombat.fixtureLeaderCasualtyPreview);
  const result=declaration(newRoll());
  assert.equal(result.code,'LAB_REROLL_DECLARED');assert.equal(result.revision,12);
  assert.equal(result.roll.source,'PHYSICAL');assert.equal(result.roll.verification,'PLAYER_DECLARED');
  assert.equal(result.roll.actor,'A');assert.equal(result.roll.diceCount,2);
  assert.ok(result.roll.rollId.startsWith('lab_reroll_leader_'));
  assert.notEqual(result.roll.rollId,original.roll.rollId);
  assert.deepEqual(result.roll.results,['FLAG','LIGHT']);
  assert.equal(result.pendingOpponentReview,true);
  assert.equal(result.combatAuthorized,false);assert.equal(result.combatResolved,false);
  const after=saved();
  assert.deepEqual(after.turn.pendingCombat.fixtureLeaderCasualtyPreview.roll,original.roll);
  assert.deepEqual(after.turn.pendingCombat.fixtureLeaderCasualtyPreview.outcome,original.outcome);
  assert.deepEqual(after.turn.pendingCombat.fixtureLeaderCasualtyPreview.physicalAgreement,original.physicalAgreement);
  assert.deepEqual(after.turn.pendingCombat.fixtureLeaderCasualtyPreview.rerollConsent,original.rerollConsent);
  assert.equal(after.board_json,before.board_json);
  const gate=status(12);assert.equal(gate.code,'LAB_LEADER_DICE_GATE');
  assert.equal(gate.gate.status,'PHYSICAL_DISPUTED');
  assert.equal(gate.gate.rerollAttemptStatus,'PHYSICAL_REROLL_AWAITING_OPPONENT');
  assert.equal(gate.gate.disputeBlocksContinuation,true);
  assert.equal(gate.gate.rerollAllowed,false);
  assert.equal(gate.gate.combatAuthorized,false);
  assert.deepEqual(counts(),{commands:3,events:3});
}));
test('unit eliminated: new physical declaration uses one rather than two dice',()=>fixture(({both,declaration,newRoll,status})=>{
  both();const r=declaration(newRoll());
  assert.equal(r.code,'LAB_REROLL_DECLARED');assert.equal(r.roll.diceCount,1);
  assert.deepEqual(r.roll.results,['FLAG']);
  assert.equal(status(12).gate.rerollPendingOpponentReview,true);
},{eliminated:true}));
test('new declared faces count is not chosen by the client',()=>fixture(({both,declaration,newRoll,counts})=>{
  both();assert.equal(declaration(newRoll({declaredFaces:['LEADER']})).code,'REROLL_UNAVAILABLE');
  assert.deepEqual(counts(),{commands:2,events:2});
}));
test('digital dice are not handled by the physical reroll agreement',()=>fixture(({declaration,newRoll})=>{
  assert.equal(declaration(newRoll({expectedRevision:9})).code,'REROLL_UNAVAILABLE');
},{digital:true}));
test('confirmed original dice cannot be replaced via the dispute protocol',()=>fixture(({declaration,newRoll})=>{
  assert.equal(declaration(newRoll({expectedRevision:9})).code,'REROLL_UNAVAILABLE');
},{agreementChoice:'CONFIRM'}));
test('the fixture-only marker is mandatory',()=>fixture(({declaration,newRoll})=>{
  assert.equal(declaration(newRoll({expectedRevision:9})).code,'REROLL_UNAVAILABLE');
},{fixtureOnly:false}));
