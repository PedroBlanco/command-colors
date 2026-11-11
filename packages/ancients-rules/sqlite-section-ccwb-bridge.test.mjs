import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSqliteAncientsSectionBridge as create,hasExperimentalSectionHistory as hasMode} from './sqlite-section-ccwb-bridge.mjs';

const MATCH='123e4567-e89b-42d3-a456-426614174000';
const setup=()=>({cardInstances:[
 {instanceId:'a_card_left',definitionId:'ORDER_2_LEFT'},
 {instanceId:'b_card_right',definitionId:'ORDER_2_RIGHT'},
 {instanceId:'c_card_left',definitionId:'ORDER_3_LEFT'},
 {instanceId:'d_card_right',definitionId:'ORDER_3_RIGHT'},
 {instanceId:'e_card_left',definitionId:'ORDER_4_LEFT'},
 {instanceId:'f_card_right',definitionId:'ORDER_4_RIGHT'}],
 handSizes:{A:2,B:2},startingSide:'A',randomIndex:()=>0,
 board:{units:[{id:'unitA',side:'A',col:2,row:4},{id:'unitB',side:'B',col:10,row:4}],leaders:[]},
 sectorCells:{'2,4':['LEFT'],'10,4':['RIGHT']}
});
function fixture(fn){
 const dir=mkdtempSync(join(tmpdir(),'ccw-ccwb-section-'));
 const file=join(dir,'match.sqlite'),clients=[];
 const connect=()=>{
  const db=new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout=4000; PRAGMA foreign_keys=ON');
  db.exec([
    'CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY,handle TEXT NOT NULL UNIQUE,salt TEXT NOT NULL,password_hash TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS sessions (token_digest TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id),expires_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES accounts(id),guest_id TEXT REFERENCES accounts(id),lobby_revision INTEGER NOT NULL DEFAULT 0,game_revision INTEGER NOT NULL DEFAULT 0,private_state TEXT NOT NULL,CHECK(guest_id IS NULL OR guest_id<>owner_id))',
    'CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY,match_id TEXT NOT NULL REFERENCES matches(id),token_digest TEXT NOT NULL UNIQUE,target_handle TEXT NOT NULL,expires_at INTEGER NOT NULL,status TEXT NOT NULL)',
    'CREATE INDEX IF NOT EXISTS invitations_by_match ON invitations(match_id)',
    'CREATE TABLE IF NOT EXISTS game_events (match_id TEXT NOT NULL REFERENCES matches(id),sequence INTEGER NOT NULL,visibility TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(match_id,sequence))',
    'CREATE TABLE IF NOT EXISTS game_commands (match_id TEXT NOT NULL REFERENCES matches(id),actor TEXT NOT NULL,idem_key TEXT NOT NULL,signature TEXT NOT NULL,committed_revision INTEGER NOT NULL,PRIMARY KEY(match_id,actor,idem_key))'
  ].join(';')+';');
  const atomic=work=>{db.exec('BEGIN IMMEDIATE');try{const r=work();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
  const getRow=id=>db.prepare('SELECT * FROM matches WHERE id=?').get(id);
  const bridge=create({db,matchId:MATCH,getRow,atomic});
  const ctx={db,bridge,getRow,close:()=>db.close()};clients.push(ctx);return ctx;
 };
 try{
  const root=connect();
  root.db.prepare('INSERT INTO accounts(id,handle,salt,password_hash) VALUES(?,?,?,?)').run('alice','alice','sample','sample');
  root.db.prepare('INSERT INTO accounts(id,handle,salt,password_hash) VALUES(?,?,?,?)').run('bob','bob','sample','sample');
  root.db.prepare('INSERT INTO matches(id,owner_id,guest_id,private_state) VALUES(?,?,?,?)')
    .run(MATCH,'alice','bob',JSON.stringify({schemaVersion:1,matchId:MATCH,status:'ACTIVE',turn:'A',board:[],hands:{A:['LEGACY_A'],B:['LEGACY_B']},deck:['LEGACY_FUTURE']}));
  return fn({root,connect});
 }finally{for(const x of clients.reverse())try{x.close()}catch{}rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:50});}
}
const req=(type,revision,extra={},key='section_lab_'+type+'_'+revision)=>({actor:'A',type,expectedRevision:revision,idempotencyKey:key,...extra});
function play(ctx){const card=ctx.bridge.view('A').yourHand[0].instanceId;
 const request=req('PLAY_SECTION_CARD',0,{cardInstanceId:card});
 assert.equal(ctx.bridge.dispatch(request).code,'SECTION_LAB_APPLIED');return request;}
function order(ctx){const request=req('ASSIGN_SECTION_ORDERS',1,{unitIds:['unitA'],leaderIds:[]});
 assert.equal(ctx.bridge.dispatch(request).code,'SECTION_LAB_APPLIED');return request;}

test('CCWB: opt-in uses canonical six-table names without migrations',()=>fixture(({root})=>{
 assert.equal(hasMode(root.getRow(MATCH)),false);
 assert.equal(root.bridge.initialize('A',setup()).code,'SECTION_LAB_INITIALIZED');
 assert.equal(hasMode(root.getRow(MATCH)),true);
 assert.deepEqual(root.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(x=>x.name),
  ['accounts','game_commands','game_events','invitations','matches','sessions']);
 assert.equal(root.getRow(MATCH).game_revision,0);
 assert.equal(root.getRow(MATCH).lobby_revision,1);
}));
test('CCWB: initialization is owner-only and exclusive with synthetic deck',()=>fixture(({root})=>{
 assert.equal(root.bridge.initialize('B',setup()).code,'FORBIDDEN');
 root.db.prepare('UPDATE matches SET private_state=?').run(JSON.stringify({schemaVersion:1,matchId:MATCH,board:[],commandSession:{}}));
 assert.equal(root.bridge.initialize('A',setup()).code,'SECTION_LAB_NOT_AVAILABLE');
}));
test('CCWB: second initialization cannot replace private hand or state',()=>fixture(({root})=>{
 root.bridge.initialize('A',setup());const state=root.getRow(MATCH).private_state;
 assert.equal(root.bridge.initialize('A',setup()).code,'SECTION_LAB_NOT_AVAILABLE');
 assert.equal(root.getRow(MATCH).private_state,state);
}));
test('CCWB: private hands, legacy fixture secrets and deck are never projected',()=>fixture(({root})=>{
 root.bridge.initialize('A',setup());
 const state=JSON.parse(root.getRow(MATCH).private_state),s=state.ancientsSectionHistoryLab.state;
 const a=JSON.stringify(root.bridge.view('A')),b=JSON.stringify(root.bridge.view('B'));
 for(const c of [...s.hands.B,...s.drawPile])assert.equal(a.includes(c.instanceId),false);
 for(const c of [...s.hands.A,...s.drawPile])assert.equal(b.includes(c.instanceId),false);
 for(const text of ['LEGACY_A','LEGACY_B','LEGACY_FUTURE']){
  assert.equal(a.includes(text),false);assert.equal(b.includes(text),false);
 }
 assert.equal(root.bridge.view('C'),null);
}));
test('CCWB: card and orders persist atomically as private log and public events',()=>fixture(({root})=>{
 root.bridge.initialize('A',setup());play(root);order(root);
 assert.equal(root.bridge.view('A').revision,2);
 assert.equal(root.bridge.view('A').ordersStaged,true);
 assert.equal(root.db.prepare('SELECT COUNT(*) n FROM game_events').get().n,2);
 assert.equal(root.db.prepare('SELECT COUNT(*) n FROM game_commands').get().n,2);
 const state=JSON.parse(root.getRow(MATCH).private_state).ancientsSectionHistoryLab;
 assert.equal(state.commands.length,2);assert.equal(state.state.revision,2);
 for(const row of root.db.prepare('SELECT visibility,payload FROM game_events').all()){
  assert.equal(row.visibility,'public');
  assert.equal(row.payload.includes('unitA'),false);
  assert.equal(row.payload.includes('card_a_left'),false);
 }
}));
test('CCWB: repeat same request is idempotent, changed payload is not',()=>fixture(({root})=>{
 root.bridge.initialize('A',setup());const original=play(root);
 assert.equal(root.bridge.dispatch(original).code,'ALREADY_APPLIED');
 assert.equal(root.bridge.dispatch({...original,cardInstanceId:'another'}).code,'IDEMPOTENCY_KEY_REUSED');
 assert.equal(root.db.prepare('SELECT COUNT(*) n FROM game_events').get().n,1);
}));
test('CCWB: separate connections serialize updates and reject stale revision',()=>fixture(({root,connect})=>{
 root.bridge.initialize('A',setup());const second=connect();const card=root.bridge.view('A').yourHand[0].instanceId;
 play(root);
 const stale=second.bridge.dispatch(req('PLAY_SECTION_CARD',0,{cardInstanceId:card},'other_second_key'));
 assert.equal(stale.code,'STALE_REVISION');
 assert.equal(second.bridge.view('A').revision,1);
}));
test('CCWB: unknown commands, oversized keys and extra authority fields fail closed',()=>fixture(({root})=>{
 root.bridge.initialize('A',setup());
 for(const invalid of [
  req('pass_demo_turn',0),req('PLAY_SECTION_CARD',0,{cardInstanceId:'x',hands:{A:[]}}),
  {...req('PLAY_SECTION_CARD',0,{cardInstanceId:'x'}),idempotencyKey:'short'}
 ])assert.equal(root.bridge.dispatch(invalid).code,'INVALID_SECTION_LAB_COMMAND');
 assert.equal(root.db.prepare('SELECT COUNT(*) n FROM game_commands').get().n,0);
}));
test('CCWB: rejection of invalid orders does not mutate persisted state',()=>fixture(({root})=>{
 root.bridge.initialize('A',setup());play(root);
 const before=root.getRow(MATCH);
 assert.equal(root.bridge.dispatch(req('ASSIGN_SECTION_ORDERS',1,{unitIds:['unitB'],leaderIds:[]})).code,'INVALID_ORDER_IDENTITIES');
 assert.deepEqual(root.getRow(MATCH),before);
}));
test('CCWB: event tampering blocks all reads and new commands',()=>fixture(({root})=>{
 root.bridge.initialize('A',setup());play(root);
 root.db.prepare('UPDATE game_events SET payload=?').run('{}');
 assert.throws(()=>root.bridge.view('A'),/SECTION_CCWB_HISTORY_TAMPERED/);
 assert.throws(()=>root.bridge.dispatch(req('END_EXPERIMENTAL_TURN',1)),/SECTION_CCWB_HISTORY_TAMPERED/);
}));
test('CCWB: deleted idempotency row blocks replay and does not grant new turn',()=>fixture(({root})=>{
 root.bridge.initialize('A',setup());play(root);
 root.db.exec('DELETE FROM game_commands');
 assert.throws(()=>root.bridge.view('B'),/SECTION_CCWB_EVENT_COUNT/);
}));
test('CCWB: changing only persisted private snapshot cannot rewrite event history',()=>fixture(({root})=>{
 root.bridge.initialize('A',setup());play(root);
 const row=root.getRow(MATCH),state=JSON.parse(row.private_state);
 state.ancientsSectionHistoryLab.state.hands.A=[];
 root.db.prepare('UPDATE matches SET private_state=?').run(JSON.stringify(state));
 assert.throws(()=>root.bridge.view('A'),/SECTION_CCWB_SNAPSHOT_DRIFT/);
}));
test('CCWB: lab turn-ending command has no combat effects and turns swap',()=>fixture(({root})=>{
 root.bridge.initialize('A',setup());play(root);order(root);
 const result=root.bridge.dispatch(req('END_EXPERIMENTAL_TURN',2));
 assert.equal(result.code,'SECTION_LAB_APPLIED');assert.equal(result.view.turn,'B');
 assert.equal(result.combatResolved,false);assert.equal(result.view.attackAuthorized,false);
 assert.equal(root.bridge.view('B').opponentCardCount,2);
}));
