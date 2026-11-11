/** Real SQLite transactional contract; rule calculations are test doubles. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {makeLeaderPreviewCommand} from './sqlite-leader-preview-command.mjs';

const id='123e4567-e89b-42d3-a456-426614174000';
const reservationId='123e4567-e89b-42d3-a456-426614174010';
function fixture(run,{leader=true,blocks=3}={}) {
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE lab_matches(id TEXT PRIMARY KEY,owner_id TEXT,guest_id TEXT,revision INTEGER,turn_json TEXT,board_json TEXT); CREATE TABLE lab_events(match_id TEXT,sequence INTEGER,payload TEXT,PRIMARY KEY(match_id,sequence)); CREATE TABLE lab_commands(match_id TEXT,actor TEXT,idem_key TEXT,signature TEXT,reservation_id TEXT,committed_revision INTEGER,PRIMARY KEY(match_id,actor,idem_key));');
 const boardJson=JSON.stringify({leader,blocks});
 const turn={revision:6,pendingCombat:{kind:'RANGED_DICE_STAGED_OFFICIAL_PREVIEW',actor:'A',
  reservationId,fullValidationRequired:true,boardSnapshotSha256:createHash('sha256').update(boardJson).digest('hex')}};
 db.prepare('INSERT INTO lab_matches VALUES(?,?,?,?,?,?)').run(id,'alice','bob',6,JSON.stringify(turn),boardJson);
 const inTransaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const out=fn();db.exec('COMMIT');return out;}
  catch(error){db.exec('ROLLBACK');throw error;}};
 const cmd=makeLeaderPreviewCommand({MATCH:/^[a-f0-9-]{36}$/i,KEY:/^[a-zA-Z0-9_-]{8,80}$/,
  denied:(status,code)=>({status,code}),inTransaction,
  row:db.prepare('SELECT * FROM lab_matches WHERE id=?'),
  sideFor:(r,user)=>r.owner_id===user?'A':r.guest_id===user?'B':null,
  previous:db.prepare('SELECT * FROM lab_commands WHERE match_id=? AND actor=? AND idem_key=?'),
  createHash,
  deriveStagedAncientsRangedBlockLoss:({board})=>({leaderCasualtyCheck:board.leader?{diceCount:board.blocks===1?1:2}:null}),
  planBaseAncientsRangedResolution:({blockLoss})=>({blockLoss,steps:blockLoss.leaderCasualtyCheck?[{kind:'LEADER_CASUALTY_CHECK'}]:[]}),
  captureBaseAncientsLeaderCasualtyDice:({rollId,actor,diceCount,mode,declaredFaces})=>{
   if(mode==='PHYSICAL' && (!Array.isArray(declaredFaces) || declaredFaces.length!==diceCount ||
    declaredFaces.some(face=>!['LEADER','FLAG'].includes(face))))throw new TypeError('BAD_FACES');
   return {rollId,actor,diceCount,source:mode,results:mode==='PHYSICAL'?[...declaredFaces]:Array(diceCount).fill('FLAG')};
  },
  previewBaseAncientsLeaderCasualtyCheck:({checklist,roll})=>({diceCount:checklist.blockLoss.leaderCasualtyCheck.diceCount,
   leaderWouldBeEliminated:roll.results.every(x=>x==='LEADER'),leaderRemoved:false}),
  update:db.prepare('UPDATE lab_matches SET revision=?,turn_json=? WHERE id=? AND revision=?'),
  eventInsert:db.prepare('INSERT INTO lab_events VALUES(?,?,?)'),
  commandInsert:db.prepare('INSERT INTO lab_commands VALUES(?,?,?,?,?,?)')
 });
 const req=(overrides={})=>({matchId:id,sessionUserId:'alice',reservationId,expectedRevision:6,
  idempotencyKey:'leader_check_0001',mode:'PHYSICAL',declaredFaces:blocks===1?['LEADER']:['LEADER','FLAG'],...overrides});
 try{return run({db,cmd,req});}finally{db.close();}
}

test('records only a private leader preview and leaves board unchanged',()=>fixture(({db,cmd,req})=>{
 const before=db.prepare('SELECT board_json FROM lab_matches').get().board_json;
 const r=cmd(req());assert.equal(r.code,'LEADER_PREVIEW_STAGED');assert.equal(r.revision,7);
 assert.equal(r.previewOnly,true);assert.equal(r.combatResolved,false);
 assert.equal(db.prepare('SELECT board_json FROM lab_matches').get().board_json,before);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM lab_events').get().n,1);
}));

test('idempotent exact retry returns same result; another key cannot reroll',()=>fixture(({db,cmd,req})=>{
 const r=cmd(req()),again=cmd(req());assert.equal(again.code,'LEADER_PREVIEW_ALREADY_STAGED');
 assert.deepEqual(again.roll,r.roll);assert.equal(cmd(req({expectedRevision:7,idempotencyKey:'leader_check_0002'})).code,'LEADER_PREVIEW_ALREADY_PRESENT');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM lab_commands').get().n,1);
}));

test('membership, stale revisions and client-chosen dice are rejected',()=>fixture(({cmd,req})=>{
 assert.equal(cmd(req({sessionUserId:'mallory'})).code,'NOT_FOUND');
 assert.equal(cmd(req({sessionUserId:'bob'})).code,'LEADER_PREVIEW_UNAVAILABLE');
 assert.equal(cmd(req({expectedRevision:5})).code,'STALE_REVISION');
 assert.equal(cmd(req({diceCount:32})).code,'INVALID_LEADER_PREVIEW_REQUEST');
}));

test('no attached leader and last block use different pending dice contracts',()=>{
 fixture(({cmd,req})=>assert.equal(cmd(req()).code,'LEADER_CHECK_NOT_PENDING'),{leader:false});
 fixture(({cmd,req})=>assert.equal(cmd(req()).roll.diceCount,1),{blocks:1});
});

test('event write failure rolls back state and idempotency key',()=>fixture(({db,cmd,req})=>{
 const before=db.prepare('SELECT revision,turn_json FROM lab_matches').get();
 db.exec("CREATE TRIGGER abort_event BEFORE INSERT ON lab_events BEGIN SELECT RAISE(ABORT,'FAIL'); END");
 assert.throws(()=>cmd(req()),/FAIL/);
 assert.deepEqual(db.prepare('SELECT revision,turn_json FROM lab_matches').get(),before);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM lab_commands').get().n,0);
}));
