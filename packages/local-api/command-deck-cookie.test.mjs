/** Real HTTP+SQLite cookie regression; synthetic users and cards only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAccessGateway} from './gateway.mjs';
import {openSqliteComposition} from '../sqlite-store/sqlite.mjs';

const PASSWORD = 'synthetic-test-password-only-2026';

async function withLab(run) {
  const dir = await mkdtemp(join(tmpdir(), 'ccw-cookie-deck-'));
  const service = openSqliteComposition({file:join(dir,'db.sqlite')});
  let server;
  try {
    for (const handle of ['alice','bob','carol']) {
      assert.equal((await service.identity.provisionAccount({handle,password:PASSWORD})).ok,true);
    }
    // Use the configured ephemeral origin for Host/Origin protection.
    // Choose a port beforehand because gateway needs a fixed expected Origin.
    const net = await import('node:net');
    const probe = net.createServer();
    probe.listen(0,'127.0.0.1');await once(probe,'listening');
    const port = probe.address().port;
    await new Promise(resolve=>probe.close(resolve));
    const origin=`http://127.0.0.1:${port}`;
    server=createAccessGateway({...service,browser:{origin,insecureLoopback:true},revisionPollMs:25});
    server.listen(port,'127.0.0.1');await once(server,'listening');
    async function call(method,path,{cookie,body,headers}={}){
      const response=await fetch(origin+path,{method,headers:{...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{}),...(method!=='GET'?{'x-ccw-request':'1',origin}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
      return {status:response.status,data:await response.json(),headers:response.headers};
    }
    async function login(handle){
      const result=await call('POST','/api/session',{body:{handle,password:PASSWORD}});
      assert.equal(result.status,200);
      assert.equal('token' in result.data,false);
      assert.match(result.headers.get('set-cookie'),/HttpOnly/);
      return result.headers.get('set-cookie').split(';')[0];
    }
    async function prepare(){
      const alice=await login('alice'),bob=await login('bob'),carol=await login('carol');
      const created=await call('POST','/api/matches',{cookie:alice});
      assert.equal(created.status,201);const id=created.data.matchId;
      const invite=await call('POST',`/api/matches/${id}/invitations`,{cookie:alice,body:{targetHandle:'bob'}});
      assert.equal(invite.status,201);
      const accept=await call('POST','/api/invitations/accept',{cookie:bob,body:{invitationToken:invite.data.token}});
      assert.equal(accept.status,200);
      return {id,alice,bob,carol};
    }
    await run({service,call,login,prepare,origin});
  } finally {
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    service.close();
    await rm(dir,{recursive:true,force:true});
  }
}

test('cookie mode: CSRF, owner-only init and privacy of both hands',()=>withLab(async({service,call,prepare})=>{
 const {id,alice,bob,carol}=await prepare();
 const path=`/api/matches/${id}`;
 const bad=await call('POST',`${path}/deck/initialize`,{cookie:alice,body:{},headers:{origin:'https://bad.example'}});
 assert.equal(bad.status,403);
 assert.equal((await call('POST',`${path}/deck/initialize`,{cookie:bob,body:{}})).status,403);
 assert.equal((await call('POST',`${path}/deck/initialize`,{cookie:carol,body:{}})).status,404);
 const initialized=await call('POST',`${path}/deck/initialize`,{cookie:alice,body:{}});
 assert.equal(initialized.status,201);
 const a=await call('GET',path,{cookie:alice}),b=await call('GET',path,{cookie:bob});
 assert.equal(a.status,200);assert.equal(b.status,200);
 assert.equal(a.data.state.yourHand.length,2);
 assert.equal(b.data.state.yourHand.length,3);
 const db=service.unsafeTestDatabase();
 const secret=JSON.parse(db.prepare('SELECT private_state FROM matches WHERE id=?').get(id).private_state).commandSession;
 for(const x of [...secret.hands.B,...secret.drawPile])assert.equal(JSON.stringify(a.data).includes(x),false);
 for(const x of [...secret.hands.A,...secret.drawPile])assert.equal(JSON.stringify(b.data).includes(x),false);
}));

test('cookie mode: cannot forge actor and keeps private revisions through defense',()=>withLab(async({call,prepare})=>{
 const {id,alice,bob}=await prepare(),path=`/api/matches/${id}`;
 assert.equal((await call('POST',`${path}/deck/initialize`,{cookie:alice,body:{}})).status,201);
 const a=(await call('GET',path,{cookie:alice})).data.state;
 const forged=await call('POST',`${path}/commands`,{cookie:bob,body:{actor:'A',type:'play_synthetic_card',cardRef:a.yourHand[0],expectedRevision:0,idempotencyKey:'forge_actor_0001'}});
 assert.equal(forged.status,403);
 const played=await call('POST',`${path}/commands`,{cookie:alice,body:{actor:'B',type:'play_synthetic_card',cardRef:a.yourHand[0],expectedRevision:0,idempotencyKey:'valid_play_0001'}});
 assert.equal(played.status,200);assert.equal(played.data.state.phase,'ASSIGN_ORDERS');
 const key=(name,rev)=>`lab_${name}_${String(rev).padStart(4,'0')}`;
 let rev=1;
 async function command(cookie,type,fields={}){const x=await call('POST',`${path}/commands`,{cookie,body:{type,expectedRevision:rev,idempotencyKey:key(type,rev),...fields}});assert.equal(x.status,200,type+JSON.stringify(x.data));rev++;return x.data.state}
 await command(alice,'assign_synthetic_orders',{unitIds:['synthetic-a']});
 await command(alice,'finish_synthetic_movement');
 const blocked=await command(alice,'ask_synthetic_defense',{targetUnit:'synthetic-b'});
 assert.equal(blocked.actingSide,'B');
 const refused=await call('POST',`${path}/commands`,{cookie:alice,body:{type:'answer_synthetic_defense',choice:'STAND',expectedRevision:rev,idempotencyKey:key('wrong_defense',rev)}});
 assert.equal(refused.status,403);
 const answered=await command(bob,'answer_synthetic_defense',{choice:'STAND'});
 assert.equal(answered.actingSide,'A');
 await command(alice,'finish_synthetic_combat');
 const finished=await command(alice,'acknowledge_synthetic_draw');
 assert.equal(finished.turn,'B');assert.equal(finished.phase,'AWAIT_CARD');
 const b=(await call('GET',path,{cookie:bob})).data.state;
 assert.equal(b.turn,'B');assert.equal(b.revision,rev);
 assert.equal(JSON.stringify(b).includes('drawPile'),true); // only count, not secret sequence
 assert.equal('drawPile' in b,false);
}));


test('cookie/SQLite: server checks units and rejects forged orders without persisting events',()=>withLab(async({service,call,prepare})=>{
 const {id,alice,bob}=await prepare(),path=`/api/matches/${id}`;
 assert.equal((await call('POST',`${path}/deck/initialize`,{cookie:alice,body:{}})).status,201);
 const initial=(await call('GET',path,{cookie:alice})).data.state;
 assert.equal((await call('POST',`${path}/commands`,{cookie:alice,body:{
   type:'play_synthetic_card',cardRef:initial.yourHand[0],expectedRevision:0,idempotencyKey:'order_card_0001'
 }})).status,200);
 const send=async(cookie,key,unitIds,extra={})=>call('POST',`${path}/commands`,{cookie,body:{
   type:'assign_synthetic_orders',expectedRevision:1,idempotencyKey:key,unitIds,...extra
 }});
 const attempts=[
   [['synthetic-b'],'UNIT_NOT_ELIGIBLE'],
   [['unknown_unit'],'UNIT_NOT_ELIGIBLE'],
   [['synthetic-a','synthetic-a'],'INVALID_ORDER_COMMAND'],
   [['synthetic-a','synthetic-b','unknown_unit'],'ORDER_LIMIT_EXCEEDED']
 ];
 for(let i=0;i<attempts.length;i++){
   const [unitIds,code]=attempts[i];
   const result=await send(alice,`invalid_order_${i+1000}`,unitIds);
   assert.equal(result.status,400);
   assert.equal(result.data.code,code);
   assert.equal(result.data.state.revision,1);
 }
 const forged=await send(alice,'forged_data_0001',['not_on_board'],{
   actor:'A',cardProfiles:{[initial.yourHand[0]]:{maxUnits:117,allowedSectors:['left']}},
   units:[{id:'not_on_board',side:'A',col:3,row:4}],sectorMembership:{'3,4':['left']}
 });
 assert.equal(forged.status,400);assert.equal(forged.data.code,'UNIT_NOT_ELIGIBLE');
 const enemy=await send(bob,'enemy_orders_01',['synthetic-a']);
 assert.equal(enemy.status,403);
 assert.equal(enemy.data.code,'NOT_ACTING_PLAYER');
 const row=service.unsafeTestDatabase().prepare(
   'SELECT game_revision FROM matches WHERE id=?').get(id);
 assert.equal(row.game_revision,1);
 assert.equal(service.unsafeTestDatabase().prepare(
   'SELECT COUNT(*) AS n FROM game_events WHERE match_id=?').get(id).n,1);
 const legal=await send(alice,'legal_order_0001',['synthetic-a']);
 assert.equal(legal.status,200);assert.equal(legal.data.code,'APPLIED');
 assert.equal(legal.data.state.phase,'MOVEMENT');
 const repeated=await send(alice,'legal_order_0001',['synthetic-a']);
 assert.equal(repeated.status,200);assert.equal(repeated.data.code,'ALREADY_APPLIED');
 const changed=await send(alice,'legal_order_0001',[]);
 assert.equal(changed.status,409);assert.equal(changed.data.code,'IDEMPOTENCY_KEY_REUSED');
 assert.equal((await call('GET',path,{cookie:bob})).data.state.revision,2);
 assert.equal(service.unsafeTestDatabase().prepare(
   'SELECT COUNT(*) AS n FROM game_events WHERE match_id=?').get(id).n,2);
}));

test('HTTP cookie/SQLite: both authorized players see a persisted move but cannot forge its actor',()=>withLab(async({service,call,prepare})=>{
 const {id,alice,bob,carol}=await prepare(),path='/api/matches/'+id;
 assert.equal((await call('POST',path+'/deck/initialize',{cookie:alice,body:{}})).status,201);
 const init=(await call('GET',path,{cookie:alice})).data.state;
 const send=(cookie,type,rev,key,fields={})=>call('POST',path+'/commands',{cookie,body:{
  actor:'B', type, expectedRevision:rev, idempotencyKey:key, ...fields
 }});
 const played=await send(alice,'play_synthetic_card',0,'http_card_moving_01',{cardRef:init.yourHand[0]});
 assert.equal(played.status,200);
 const ordered=await send(alice,'assign_synthetic_orders',1,'http_orders_moving_01',{unitIds:['synthetic-a']});
 assert.equal(ordered.status,200);
 const refused=await send(bob,'move_synthetic_unit',2,'http_enemy_moving_01',{
  unitId:'synthetic-a',path:[{col:4,row:4}]});
 assert.equal(refused.status,403);
 const forged=await send(alice,'move_synthetic_unit',2,'http_bad_moving_001',{
  unitId:'synthetic-a',path:[{col:4,row:4},{col:4,row:5},{col:5,row:5}],
  maxStepsByUnit:{'synthetic-a':100},blockedCells:[],board:[]});
 assert.equal(forged.status,400);assert.equal(forged.data.code,'MOVEMENT_LIMIT_EXCEEDED');
 const applied=await send(alice,'move_synthetic_unit',2,'http_valid_moving_01',{
  unitId:'synthetic-a',path:[{col:4,row:4}]});
 assert.equal(applied.status,200);assert.equal(applied.data.code,'APPLIED');
 const own=(await call('GET',path,{cookie:alice})).data.state;
 const opponent=(await call('GET',path,{cookie:bob})).data.state;
 assert.equal(own.revision,3);assert.equal(opponent.revision,3);
 assert.equal(own.board[0].col,4);assert.equal(opponent.board[0].col,4);
 assert.equal(own.board[0].row,4);assert.equal(opponent.board[0].row,4);
 assert.equal((await call('GET',path,{cookie:carol})).status,404);
 const repeat=await send(alice,'move_synthetic_unit',2,'http_valid_moving_01',{
  unitId:'synthetic-a',path:[{col:4,row:4}]});
 assert.equal(repeat.status,200);assert.equal(repeat.data.code,'ALREADY_APPLIED');
 const second=await send(alice,'move_synthetic_unit',3,'http_double_moving_1',{
  unitId:'synthetic-a',path:[{col:5,row:4}]});
 assert.equal(second.status,400);assert.equal(second.data.code,'UNIT_NOT_ELIGIBLE');
 const undo=await send(alice,'undo_synthetic_orders',3,'http_undo_moving_01');
 assert.equal(undo.status,409);assert.equal(undo.data.code,'UNDO_NOT_AVAILABLE_AFTER_MOVEMENT');
 const sql=service.unsafeTestDatabase();
 assert.equal(sql.prepare('SELECT game_revision FROM matches WHERE id=?').get(id).game_revision,3);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM game_events WHERE match_id=?').get(id).n,3);
}));
