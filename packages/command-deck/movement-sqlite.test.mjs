import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSqliteCommandDeckStore} from './sqlite-game.mjs';

const MATCH='11111111-1111-4111-8111-111111111111';
const board=()=>[
 {id:'synthetic-a',side:'A',col:3,row:4},
 {id:'synthetic-b',side:'B',col:9,row:4},
 {id:'synthetic-a2',side:'A',col:3,row:6}
];
const initial=()=>({schemaVersion:1,matchId:MATCH,status:'ACTIVE',turn:'A',board:board(),
 hands:{A:['legacy_a'],B:['legacy_b']},deck:['legacy_future']});
function lab(fn){
 const folder=mkdtempSync(join(tmpdir(),'ccw-moving-')),file=join(folder,'lab.sqlite');let primary;
 function connect(){
   const db=new DatabaseSync(file);
   db.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=2000;');
   db.exec('CREATE TABLE IF NOT EXISTS matches(id TEXT PRIMARY KEY,owner_id TEXT,guest_id TEXT,private_state TEXT NOT NULL,lobby_revision INTEGER NOT NULL DEFAULT 0,game_revision INTEGER NOT NULL DEFAULT 0);');
   db.exec('CREATE TABLE IF NOT EXISTS game_events(match_id TEXT,sequence INTEGER,visibility TEXT,payload TEXT,PRIMARY KEY(match_id,sequence));');
   db.exec('CREATE TABLE IF NOT EXISTS game_commands(match_id TEXT,actor TEXT,idem_key TEXT,signature TEXT,committed_revision INTEGER,PRIMARY KEY(match_id,actor,idem_key));');
   const getRow=id=>db.prepare('SELECT * FROM matches WHERE id=?').get(id);
   const atomic=run=>{db.exec('BEGIN IMMEDIATE');try{const out=run();db.exec('COMMIT');return out;}catch(err){db.exec('ROLLBACK');throw err;}};
   return {db,store:createSqliteCommandDeckStore({db,matchId:MATCH,getRow,atomic}),getRow};
 }
 try{
   primary=connect();primary.db.prepare('INSERT INTO matches(id,owner_id,guest_id,private_state) VALUES (?,?,?,?)')
     .run(MATCH,'acc-a','acc-b',JSON.stringify(initial()));
   fn({connection:primary,connect,file});
 }finally{try{primary?.db.close();}catch{}rmSync(folder,{recursive:true,force:true});}
}
function send(store,actor,type,rev,fields={},key='req_'+type+'_'+rev){
 return store.dispatch({actor,type,expectedRevision:rev,idempotencyKey:key,...fields});
}
function success(store,actor,type,rev,fields={},key){
 const out=send(store,actor,type,rev,fields,key);
 assert.equal(out.status,200,type+': '+JSON.stringify(out));assert.equal(out.code,'APPLIED');return out;
}
function prepared(store){
 assert.equal(store.initialize('A').status,201);
 const card=store.view('A').yourHand[0];
 success(store,'A','play_synthetic_card',0,{cardRef:card});
 success(store,'A','assign_synthetic_orders',1,{unitIds:['synthetic-a','synthetic-a2']});
}
const move=(s,actor,rev,id,path,extra={},key='movement_request_001')=>
 send(s,actor,'move_synthetic_unit',rev,{unitId:id,path,...extra},key);
const cell=(col,row)=>({col,row});
const snapshot=db=>JSON.parse(db.prepare('SELECT private_state FROM matches WHERE id=?').get(MATCH).private_state);
const events=db=>db.prepare('SELECT sequence,payload FROM game_events WHERE match_id=? ORDER BY sequence').all(MATCH);

test('SQLite movement commits board, revision and one public event, without private hands',()=>lab(({connection:{db,store}})=>{
 prepared(store);const out=move(store,'A',2,'synthetic-a',[cell(4,4)]);
 assert.equal(out.code,'APPLIED');assert.equal(out.view.revision,3);
 assert.equal(out.view.board[0].col,4);
 const state=snapshot(db);
 assert.equal(state.board[0].col,4);assert.deepEqual(state.movedUnitIds,['synthetic-a']);
 assert.equal(state.commandSession.phaseState.revision,3);
 assert.equal(events(db).length,3);
 const event=JSON.parse(events(db)[2].payload);
 assert.equal(event.type,'UNIT_MOVED_SIMULATED');assert.deepEqual(event.path,[cell(4,4)]);
 assert.equal(JSON.stringify(event).includes('synthetic_card'),false);
 assert.equal(store.view('B').opponentCardCount,1);
 assert.equal(JSON.stringify(store.view('B')).includes(store.view('A').yourHand[0]),false);
}));

test('invalid moves and wrong actor do not change board, revision or command history',()=>lab(({connection:{db,store}})=>{
 prepared(store);const before=JSON.stringify(snapshot(db));
 for(const [index,unitId,path,code] of [
  [0,'synthetic-b',[cell(8,4)],'UNIT_NOT_ELIGIBLE'],
  [1,'missing',[cell(4,4)],'UNIT_NOT_ELIGIBLE'],
  [2,'synthetic-a',[cell(5,5)],'NON_ADJACENT_STEP'],
  [3,'synthetic-a',[cell(4,4),cell(4,5),cell(5,5)],'MOVEMENT_LIMIT_EXCEEDED'],
  [4,'synthetic-a',[cell(4,4),cell(3,4)],'REPEATED_HEX']
 ]){
  const r=move(store,'A',2,unitId,path,{},'invalid_move_'+index);
  assert.equal(r.status,400);assert.equal(r.code,code);
 }
 assert.equal(move(store,'B',2,'synthetic-b',[cell(8,4)],{},'wrong_actor_001').status,403);
 assert.equal(JSON.stringify(snapshot(db)),before);
 assert.equal(events(db).length,2);
 assert.equal(db.prepare('SELECT count(*) AS n FROM game_commands').get().n,2);
}));

test('idempotent retry returns the same state and rejects changed requests',()=>lab(({connection:{db,store}})=>{
 prepared(store);
 const key='same_move_0001';
 assert.equal(move(store,'A',2,'synthetic-a',[cell(4,4)],{},key).code,'APPLIED');
 assert.equal(move(store,'A',2,'synthetic-a',[cell(4,4)],{},key).code,'ALREADY_APPLIED');
 assert.equal(move(store,'A',2,'synthetic-a',[cell(4,5)],{},key).code,'IDEMPOTENCY_KEY_REUSED');
 assert.equal(move(store,'A',2,'synthetic-a2',[cell(4,6)],{},'stale_move_01').code,'STALE_REVISION');
 assert.equal(move(store,'A',3,'synthetic-a',[cell(5,4)],{},'twice_move_01').code,'UNIT_NOT_ELIGIBLE');
 assert.equal(events(db).length,3);
}));

test('once a unit has moved, orders cannot be undone',()=>lab(({connection:{db,store}})=>{
 prepared(store);assert.equal(move(store,'A',2,'synthetic-a',[cell(4,4)]).code,'APPLIED');
 const out=send(store,'A','undo_synthetic_orders',3,{},'undo_after_move_01');
 assert.equal(out.status,409);assert.equal(out.code,'UNDO_NOT_AVAILABLE_AFTER_MOVEMENT');
 assert.equal(store.view('A').phase,'MOVEMENT');assert.equal(events(db).length,3);
}));

test('multiple ordered units can move; next turn resets the once-per-turn guard',()=>lab(({connection:{db,store}})=>{
 prepared(store);
 success(store,'A','move_synthetic_unit',2,{unitId:'synthetic-a',path:[cell(4,4)]},'move_one_001');
 success(store,'A','move_synthetic_unit',3,{unitId:'synthetic-a2',path:[cell(4,6)]},'move_two_001');
 success(store,'A','finish_synthetic_movement',4);
 success(store,'A','finish_synthetic_combat',5);
 success(store,'A','acknowledge_synthetic_draw',6);
 assert.equal(store.view('B').turn,'B');assert.deepEqual(snapshot(db).movedUnitIds,[]);
 const card=store.view('B').yourHand[0];
 success(store,'B','play_synthetic_card',7,{cardRef:card});
 success(store,'B','assign_synthetic_orders',8,{unitIds:['synthetic-b']});
 success(store,'B','move_synthetic_unit',9,{unitId:'synthetic-b',path:[cell(8,4)]});
 assert.equal(store.view('A').board[1].col,8);
}));

test('SQLite rolls back the board, revision and idempotency key if event writing fails',()=>lab(({connection:{db,store}})=>{
 prepared(store);const previous=JSON.stringify(snapshot(db));
 db.exec("CREATE TRIGGER block_movement BEFORE INSERT ON game_events WHEN json_extract(NEW.payload, '$.type')='UNIT_MOVED_SIMULATED' BEGIN SELECT RAISE(ABORT, 'movement-failed'); END;");
 assert.throws(()=>move(store,'A',2,'synthetic-a',[cell(4,4)]),/movement-failed/);
 assert.equal(JSON.stringify(snapshot(db)),previous);
 assert.equal(events(db).length,2);
 assert.equal(db.prepare('SELECT count(*) AS n FROM game_commands').get().n,2);
}));

test('reopening SQLite preserves moved units and prevents a second move',()=>lab(({connection,connect})=>{
 prepared(connection.store);
 success(connection.store,'A','move_synthetic_unit',2,{unitId:'synthetic-a',path:[cell(4,4)]});
 const second=connect();
 try{
  assert.equal(second.store.view('A').board[0].col,4);
  assert.equal(move(second.store,'A',3,'synthetic-a',[cell(5,4)]).code,'UNIT_NOT_ELIGIBLE');
  assert.equal(second.store.view('B').revision,3);
 }finally{second.db.close();}
}));

test('forged movement limits and board in command fields are ignored',()=>lab(({connection:{db,store}})=>{
 prepared(store);
 const forged=move(store,'A',2,'synthetic-a',[cell(4,4),cell(4,5),cell(5,5)],
 {maxStepsByUnit:{'synthetic-a':100},board:[],movedUnitIds:[],blockedCells:[]},'forged_move_01');
 assert.equal(forged.code,'MOVEMENT_LIMIT_EXCEEDED');
 assert.equal(events(db).length,2);
}));

test('legacy lab snapshots without a movement guard fail closed',()=>lab(({connection:{db,store}})=>{
 prepared(store);
 const state=snapshot(db);delete state.movedUnitIds;
 db.prepare('UPDATE matches SET private_state=? WHERE id=?').run(JSON.stringify(state),MATCH);
 const out=move(store,'A',2,'synthetic-a',[cell(4,4)]);
 assert.equal(out.status,409);assert.equal(out.code,'MOVEMENT_STATE_UNAVAILABLE');
 assert.equal(events(db).length,2);
}));
