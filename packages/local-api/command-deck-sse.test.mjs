/** Real browser-cookie SSE regression for synthetic command decks; no public content. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer as portServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openSqliteComposition} from '../sqlite-store/sqlite.mjs';
import {createAccessGateway} from './gateway.mjs';

async function lab(run) {
 const dir=await mkdtemp(join(tmpdir(),'ccw-cards-sse-'));
 const store=openSqliteComposition({file:join(dir,'test.sqlite')});
 const p=portServer();p.listen(0,'127.0.0.1');await once(p,'listening');
 const port=p.address().port;await new Promise(resolve=>p.close(resolve));
 const origin=`http://127.0.0.1:${port}`;
 const server=createAccessGateway({...store,browser:{origin,insecureLoopback:true},revisionPollMs:35});
 const watchers=[];
 try{
   for(const handle of ['alice','bob','carol']) assert.equal((await store.identity.provisionAccount({handle,password:'synthetic-cookie-sse-pass'})).ok,true);
   server.listen(port,'127.0.0.1');await once(server,'listening');
   async function call(method,path,{cookie,body}={}){
     const response=await fetch(origin+path,{method,headers:{...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{}),...(method!=='GET'?{origin,'x-ccw-request':'1'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
     return {status:response.status,body:await response.json(),headers:response.headers};
   }
   async function login(handle){
     const r=await call('POST','/api/session',{body:{handle,password:'synthetic-cookie-sse-pass'}});
     assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];
   }
   async function prepare(){
     const a=await login('alice'),b=await login('bob'),c=await login('carol');
     const created=await call('POST','/api/matches',{cookie:a});assert.equal(created.status,201);
     const id=created.body.matchId;
     const invited=await call('POST',`/api/matches/${id}/invitations`,{cookie:a,body:{targetHandle:'bob'}});
     assert.equal(invited.status,201);
     assert.equal((await call('POST','/api/invitations/accept',{cookie:b,body:{invitationToken:invited.body.token}})).status,200);
     return {id,a,b,c};
   }
   async function subscribe(id,cookie){
     const controller=new AbortController();
     const response=await fetch(`${origin}/api/matches/${id}/updates`,{headers:{cookie},signal:controller.signal});
     if(response.status!==200){controller.abort();return {status:response.status};}
     const events=[],reader=response.body.getReader(),decoder=new TextDecoder();let text='',closed=false;
     const readerPromise=(async()=>{
       try{for(;;){const r=await reader.read();if(r.done)break;text+=decoder.decode(r.value,{stream:true});
         while(text.includes('\n\n')){const end=text.indexOf('\n\n'),frame=text.slice(0,end);text=text.slice(end+2);
           if(frame.includes('event: revision')){const line=frame.split('\n').find(x=>x.startsWith('data: '));
             if(line)events.push({payload:JSON.parse(line.slice(6)),raw:frame});}
         }
       }}catch(err){if(!controller.signal.aborted)throw err}finally{closed=true}
     })();
     const watcher={status:response.status,events,stop:()=>controller.abort(),
       async waitFor(check,ms=5000){const end=Date.now()+ms;while(Date.now()<end){const e=events.find(check);if(e)return e;if(closed)throw new Error('SSE_CLOSED');await new Promise(r=>setTimeout(r,10))}throw new Error('SSE_TIMEOUT')},
       async waitClosed(ms=5000){const end=Date.now()+ms;while(!closed&&Date.now()<end)await new Promise(r=>setTimeout(r,10));assert.equal(closed,true,'SSE should close after logout')},
       readerPromise};
     watchers.push(watcher);return watcher;
   }
   await run({store,call,login,prepare,subscribe});
 }finally{
   for(const watcher of watchers)watcher.stop();
   await Promise.allSettled(watchers.map(w=>w.readerPromise));
   server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
   store.close();await rm(dir,{recursive:true,force:true});
 }
}

test('SSE: two cookie sessions see revision only for synthetic command deck changes',()=>lab(async({call,prepare,subscribe,store})=>{
 const {id,a,b,c}=await prepare(),path=`/api/matches/${id}`;
 assert.equal((await subscribe(id,c)).status,404);
 const sa=await subscribe(id,a),sb=await subscribe(id,b);
 assert.equal(sa.status,200);assert.equal(sb.status,200);
 const initialA=await sa.waitFor(e=>e.payload.gameRevision===0);
 const initialB=await sb.waitFor(e=>e.payload.gameRevision===0);
 assert.deepEqual(Object.keys(initialA.payload).sort(),['gameRevision','lobbyRevision']);
 assert.deepEqual(Object.keys(initialB.payload).sort(),['gameRevision','lobbyRevision']);
 assert.equal((await call('POST',`${path}/deck/initialize`,{cookie:a,body:{}})).status,201);
 // Initialize mutates lobby revision, and must generate an update even though gameRevision stays 0.
 const initNotice=await sa.waitFor(e=>e.payload.lobbyRevision>initialA.payload.lobbyRevision);
 assert.equal(initNotice.payload.gameRevision,0);
 const view=(await call('GET',path,{cookie:a})).body.state;
 const played=await call('POST',`${path}/commands`,{cookie:a,body:{type:'play_synthetic_card',cardRef:view.yourHand[0],expectedRevision:0,idempotencyKey:'cookie_sse_play_001'}});
 assert.equal(played.status,200);
 const a1=await sa.waitFor(e=>e.payload.gameRevision===1),b1=await sb.waitFor(e=>e.payload.gameRevision===1);
 for(const frame of [...sa.events,...sb.events]){
   assert.equal(frame.raw.includes('synthetic_card_'),false);
   assert.equal(frame.raw.includes('yourHand'),false);
   assert.deepEqual(Object.keys(frame.payload).sort(),['gameRevision','lobbyRevision']);
 }
 assert.equal(a1.payload.gameRevision,1);assert.equal(b1.payload.gameRevision,1);
 // Reconnect: current revision, not a replay of hidden events.
 sb.stop();await sb.waitClosed();
 const reconnected=await subscribe(id,b);
 assert.equal((await reconnected.waitFor(e=>e.payload.gameRevision===1)).payload.gameRevision,1);
 const privateState=JSON.parse(store.unsafeTestDatabase().prepare('SELECT private_state FROM matches WHERE id=?').get(id).private_state).commandSession;
 for(const s of [...sa.events,...reconnected.events])for(const hidden of privateState.drawPile)assert.equal(s.raw.includes(hidden),false);
}));

test('SSE: logout revokes the existing stream and stale cookie cannot reconnect',()=>lab(async({call,prepare,subscribe})=>{
 const {id,b}=await prepare();
 const stream=await subscribe(id,b);
 await stream.waitFor(e=>e.payload.gameRevision===0);
 assert.equal((await call('DELETE','/api/session',{cookie:b})).status,200);
 await stream.waitClosed();
 const stale=await subscribe(id,b);
 assert.equal(stale.status,401);
}));

test('SSE: authenticated movement reaches both players with counters only; rejected move is silent',()=>lab(async({call,prepare,subscribe,store})=>{
 const {id,a,b,c}=await prepare(),path=`/api/matches/${id}`;
 assert.equal((await subscribe(id,c)).status,404);
 const sa=await subscribe(id,a),sb=await subscribe(id,b);
 await sa.waitFor(e=>e.payload.gameRevision===0);
 await sb.waitFor(e=>e.payload.gameRevision===0);
 assert.equal((await call('POST',`${path}/deck/initialize`,{cookie:a,body:{}})).status,201);
 const first=(await call('GET',path,{cookie:a})).body.state;
 const command=(cookie,type,rev,key,extra={})=>call('POST',`${path}/commands`,{cookie,body:{type,expectedRevision:rev,idempotencyKey:key,...extra}});
 assert.equal((await command(a,'play_synthetic_card',0,'sse_move_card_0001',{cardRef:first.yourHand[0]})).status,200);
 assert.equal((await command(a,'assign_synthetic_orders',1,'sse_move_orders_01',{unitIds:['synthetic-a']})).status,200);
 await sa.waitFor(e=>e.payload.gameRevision===2);
 await sb.waitFor(e=>e.payload.gameRevision===2);
 const before=sa.events.length;
 assert.equal((await command(b,'move_synthetic_unit',2,'sse_move_enemy_001',{unitId:'synthetic-a',path:[{col:4,row:4}]})).status,403);
 await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(sa.events.length,before);
 assert.equal((await command(a,'move_synthetic_unit',2,'sse_move_valid_001',{unitId:'synthetic-a',path:[{col:4,row:4}]})).status,200);
 await sa.waitFor(e=>e.payload.gameRevision===3);
 await sb.waitFor(e=>e.payload.gameRevision===3);
 const viewA=(await call('GET',path,{cookie:a})).body.state;
 const viewB=(await call('GET',path,{cookie:b})).body.state;
 assert.equal(viewA.revision,3);assert.equal(viewB.revision,3);
 assert.deepEqual(viewA.board[0],viewB.board[0]);assert.equal(viewB.board[0].col,4);
 const secret=JSON.parse(store.unsafeTestDatabase().prepare('SELECT private_state FROM matches WHERE id=?').get(id).private_state).commandSession;
 for(const watcher of [sa,sb])for(const frame of watcher.events){
  assert.deepEqual(Object.keys(frame.payload).sort(),['gameRevision','lobbyRevision']);
  for(const id of [...secret.hands.A,...secret.hands.B,...secret.drawPile])assert.equal(frame.raw.includes(id),false);
  for(const word of ['UNIT_MOVED_SIMULATED','path','unitId','yourHand','synthetic_card_'])assert.equal(frame.raw.includes(word),false);
 }
 sb.stop();await sb.waitClosed();
 const reconnected=await subscribe(id,b);
 assert.equal((await reconnected.waitFor(e=>e.payload.gameRevision===3)).payload.gameRevision,3);
 assert.equal((await call('DELETE','/api/session',{cookie:b})).status,200);
 await reconnected.waitClosed();
 assert.equal((await subscribe(id,b)).status,401);
}));
