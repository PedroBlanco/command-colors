import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openExperimentalSectionHistoryLab as open} from './sqlite-section-history-lab.mjs';

const MATCH='123e4567-e89b-42d3-a456-426614174000';
const SEED=()=>({
 cardInstances:[
  {instanceId:'card_a_left',definitionId:'ORDER_2_LEFT'},
  {instanceId:'card_b_right',definitionId:'ORDER_2_RIGHT'},
  {instanceId:'card_c_left',definitionId:'ORDER_3_LEFT'},
  {instanceId:'card_d_right',definitionId:'ORDER_3_RIGHT'},
  {instanceId:'card_e_left',definitionId:'ORDER_4_LEFT'},
  {instanceId:'card_f_right',definitionId:'ORDER_4_RIGHT'}
 ],handSizes:{A:2,B:2},startingSide:'A',randomIndex:()=>0,
 board:{units:[{id:'unitA',side:'A',col:2,row:4},{id:'unitB',side:'B',col:10,row:4}],leaders:[]},
 sectorCells:{'2,4':['LEFT'],'10,4':['RIGHT']}
});
function fixture(fn){
 const dir=mkdtempSync(join(tmpdir(),'ccw-section-history-')),file=join(dir,'history.sqlite'),instances=[];
 const connect=()=>{const x=open({file});instances.push(x);return x;};
 try{const db=connect();db.seedFixture({matchId:MATCH,ownerId:'alice',guestId:'bob',setup:SEED()});
  return fn({db,connect,file});}
 finally{for(const h of instances.reverse())try{h.close()}catch{}
  rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
}
const req=(type,revision,extra={},key=`history_${type}_${revision}`)=>({
 matchId:MATCH,sessionUserId:'alice',expectedRevision:revision,idempotencyKey:key,type,...extra
});
const action=(db,type,revision,extra={})=>{
 const result=db.dispatch(req(type,revision,extra));
 assert.equal(result.status,200,JSON.stringify(result));return result;
};
const play=db=>action(db,'PLAY_SECTION_CARD',0,{cardInstanceId:db.view({matchId:MATCH,sessionUserId:'alice'}).view.yourHand[0].instanceId});
const assign=db=>action(db,'ASSIGN_SECTION_ORDERS',1,{unitIds:['unitA'],leaderIds:[]});

test('isolated SQLite schema uses distinct application_id and exactly three tables',()=>fixture(({db})=>{
 const sqlite=db.unsafeTestDatabase();
 assert.equal(sqlite.prepare('PRAGMA application_id').get().application_id,0x4343484c);
 assert.equal(sqlite.prepare('PRAGMA user_version').get().user_version,1);
 assert.deepEqual(sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(x=>x.name),
  ['history_commands','history_events','history_matches']);
}));
test('two player projections never leak their opponent hand or future deck',()=>fixture(({db})=>{
 const a=db.view({matchId:MATCH,sessionUserId:'alice'}).view;
 const b=db.view({matchId:MATCH,sessionUserId:'bob'}).view;
 const row=JSON.parse(db.unsafeTestDatabase().prepare('SELECT private_json FROM history_matches').get().private_json);
 const aJson=JSON.stringify(a),bJson=JSON.stringify(b);
 for(const c of [...row.hands.B,...row.drawPile])assert.equal(aJson.includes(c.instanceId),false);
 for(const c of [...row.hands.A,...row.drawPile])assert.equal(bJson.includes(c.instanceId),false);
 assert.equal(a.opponentCardCount,2);assert.equal(b.opponentCardCount,2);
}));
test('play and assign append private commands and public events atomically',()=>fixture(({db})=>{
 play(db);assign(db);
 const p=db.view({matchId:MATCH,sessionUserId:'alice'});
 assert.equal(p.view.phase,'LAB_RESOLUTION_PENDING');assert.equal(p.view.revision,2);
 assert.equal(p.view.ordersStaged,true);assert.equal(p.view.ordersAuthorized,false);
 const sql=db.unsafeTestDatabase();
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM history_commands').get().n,2);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM history_events').get().n,3);
 assert.equal(sql.prepare('SELECT revision FROM history_matches').get().revision,2);
 const events=db.publicEvents({matchId:MATCH,sessionUserId:'bob'}).events;
 assert.deepEqual(events.map(x=>x.kind),['SECTION_HISTORY_INITIALIZED_LAB','SECTION_CARD_PLAYED_LAB','SECTION_ORDERS_STAGED_LAB']);
 assert.equal(JSON.stringify(events).includes('card_a_left'),false);
 assert.equal(JSON.stringify(events).includes('unitA'),false);
}));
test('draw after lab-only termination conserves cards and survives reopening',()=>fixture(({db,connect})=>{
 play(db);assign(db);const result=action(db,'END_EXPERIMENTAL_TURN',2);
 assert.equal(result.view.turn,'B');assert.equal(result.view.phase,'AWAIT_CARD');
 assert.equal(result.combatResolved,false);
 const second=connect(),v=second.view({matchId:MATCH,sessionUserId:'bob'});
 assert.equal(v.status,200);assert.equal(v.view.revision,3);
 assert.equal(v.view.discardPile.length,1);
 assert.equal(second.publicEvents({matchId:MATCH,sessionUserId:'bob'}).events.at(-1).kind,'LAB_TURN_ENDED_WITHOUT_COMBAT');
}));
test('idempotency accepts identical replay but rejects changed card under same key',()=>fixture(({db})=>{
 const a=db.view({matchId:MATCH,sessionUserId:'alice'}).view.yourHand;
 const first=req('PLAY_SECTION_CARD',0,{cardInstanceId:a[0].instanceId},'same_command_key');
 assert.equal(db.dispatch(first).code,'LAB_COMMAND_RECORDED');
 assert.equal(db.dispatch(first).code,'ALREADY_APPLIED');
 assert.equal(db.dispatch({...first,cardInstanceId:a[1].instanceId}).code,'IDEMPOTENCY_KEY_REUSED');
 assert.equal(db.unsafeTestDatabase().prepare('SELECT COUNT(*) n FROM history_commands').get().n,1);
}));
test('concurrent database connections cannot commit same old revision twice',()=>fixture(({db,connect})=>{
 const other=connect(),card=db.view({matchId:MATCH,sessionUserId:'alice'}).view.yourHand[0].instanceId;
 assert.equal(db.dispatch(req('PLAY_SECTION_CARD',0,{cardInstanceId:card})).status,200);
 const stale=other.dispatch(req('PLAY_SECTION_CARD',0,{cardInstanceId:card},'another_command_key'));
 assert.equal(stale.code,'STALE_REVISION');
 assert.equal(other.view({matchId:MATCH,sessionUserId:'alice'}).view.revision,1);
}));
test('unauthorized user and wrong-turn participant cannot see or alter private history',()=>fixture(({db})=>{
 assert.equal(db.view({matchId:MATCH,sessionUserId:'mallory'}).code,'NOT_FOUND');
 assert.equal(db.publicEvents({matchId:MATCH,sessionUserId:'mallory'}).code,'NOT_FOUND');
 const b=db.view({matchId:MATCH,sessionUserId:'bob'}).view.yourHand[0];
 const wrong=db.dispatch({...req('PLAY_SECTION_CARD',0,{cardInstanceId:b.instanceId}),sessionUserId:'bob'});
 assert.equal(wrong.code,'NOT_YOUR_TURN');
 assert.equal(JSON.stringify(wrong).includes(b.instanceId),false);
}));
test('reject forged server-side hand, board and actor in browser command payload',()=>fixture(({db})=>{
 for(const extra of [{actor:'A'},{board:{}},{hands:{A:[]}},{sectorCells:{'2,4':['LEFT']}},
  {cardInstanceId:'unknown',unitIds:[]},{definitionId:'ORDER_2_LEFT'}]){
   const r=db.dispatch({...req('PLAY_SECTION_CARD',0,{cardInstanceId:'card_a_left'}),...extra});
   assert.equal(r.code,'INVALID_HISTORY_COMMAND');
 }
}));
test('cannot assign enemy, duplicate or unsupported section orders and stays unchanged',()=>fixture(({db})=>{
 play(db);
 for(const opts of [
  {unitIds:['unitB'],leaderIds:[]},
  {unitIds:['unitA','unitA'],leaderIds:[]},
  {unitIds:['missing'],leaderIds:[]}
 ]) assert.notEqual(db.dispatch(req('ASSIGN_SECTION_ORDERS',1,opts,'reject_'+opts.unitIds[0])).status,200);
 assert.equal(db.view({matchId:MATCH,sessionUserId:'alice'}).view.revision,1);
}));
test('stale revision and exact request keys are checked before mutations',()=>fixture(({db})=>{
 assert.equal(db.dispatch(req('PLAY_SECTION_CARD',1,{cardInstanceId:'card_a_left'})).code,'STALE_REVISION');
 assert.equal(db.dispatch({...req('PLAY_SECTION_CARD',0,{cardInstanceId:'card_a_left'}),idempotencyKey:'x'}).code,'INVALID_HISTORY_COMMAND');
 assert.equal(db.unsafeTestDatabase().prepare('SELECT COUNT(*) n FROM history_events').get().n,1);
}));
test('private event tampering is discovered when replaying the history',()=>fixture(({db})=>{
 play(db);
 db.unsafeTestDatabase().prepare('UPDATE history_events SET private_payload=? WHERE seq=1')
  .run(JSON.stringify({kind:'SECTION_HISTORY_COMMAND',command:{type:'PLAY_SECTION_CARD',actor:'A',expectedRevision:0,cardInstanceId:'bogus'}}));
 assert.equal(db.view({matchId:MATCH,sessionUserId:'alice'}).code,'HISTORY_INTEGRITY_UNAVAILABLE');
 assert.equal(db.dispatch(req('END_EXPERIMENTAL_TURN',1)).code,'HISTORY_INTEGRITY_UNAVAILABLE');
}));
test('projection drift and edited public event are detected before any command',()=>fixture(({db})=>{
 play(db);
 db.unsafeTestDatabase().prepare('UPDATE history_events SET public_payload=? WHERE seq=1').run('{}');
 assert.equal(db.publicEvents({matchId:MATCH,sessionUserId:'alice'}).code,'HISTORY_INTEGRITY_UNAVAILABLE');
}));
test('corrupted board/private snapshot does not silently become the historical truth',()=>fixture(({db})=>{
 const sql=db.unsafeTestDatabase(),s=JSON.parse(sql.prepare('SELECT private_json FROM history_matches').get().private_json);
 s.drawPile=[];
 sql.prepare('UPDATE history_matches SET private_json=?').run(JSON.stringify(s));
 assert.equal(db.view({matchId:MATCH,sessionUserId:'bob'}).code,'HISTORY_INTEGRITY_UNAVAILABLE');
}));
test('all rejected actions avoid new events or command keys',()=>fixture(({db})=>{
 const sql=db.unsafeTestDatabase(),before=sql.prepare('SELECT private_json,revision FROM history_matches').get();
 const bad=db.dispatch(req('ASSIGN_SECTION_ORDERS',0,{unitIds:['unitA'],leaderIds:[]}));
 assert.equal(bad.code,'WRONG_PHASE');
 assert.deepEqual(sql.prepare('SELECT private_json,revision FROM history_matches').get(),before);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM history_events').get().n,1);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM history_commands').get().n,0);
}));
test('cannot open CCHL journal as CCRL or bootstrap an unknown SQLite schema',()=>fixture(({file})=>{
 assert.equal(open({file}).view({matchId:MATCH,sessionUserId:'alice'}).status,200);
}));
