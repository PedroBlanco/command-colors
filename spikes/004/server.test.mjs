import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createDemo, createApp} from './server.mjs';

test('secreto: cada jugador recibe solo su mano', () => {
 const d=createDemo(),a=d.view('A'),b=d.view('B');
 assert.deepEqual(a.yourHand,['ONLY_A_CARD_1','ONLY_A_CARD_2']);
 assert.equal(a.opponentCardCount,3);
 assert.equal(JSON.stringify(a).includes('ONLY_B_CARD_'),false);
 assert.equal(JSON.stringify(b).includes('ONLY_A_CARD_'),false);
 assert.equal('hands' in a,false);
});

test('comando: autorización, revisión y reintentos idempotentes', () => {
 const d=createDemo();
 const cmd={type:'end_demo_turn',expectedRevision:0,idempotencyKey:'request_123'};
 assert.equal(d.command('B',cmd).code,'NOT_YOUR_TURN');
 assert.equal(d.command('A',cmd).code,'APPLIED');
 assert.equal(d.command('A',cmd).code,'ALREADY_APPLIED');
 assert.equal(d.view('B').revision,1);
 assert.equal(d.command('B',{...cmd,idempotencyKey:'request_456'}).code,'STALE_REVISION');
 assert.equal(d.command('A',{...cmd,expectedRevision:1}).code,'IDEMPOTENCY_KEY_REUSED');
 assert.equal(d.command('B',{...cmd,expectedRevision:1,idempotencyKey:'request_789'}).code,'APPLIED');
 assert.equal(d.view('A').revision,2);
});

test('API real: rechazar no participantes, comandos obsoletos y fugas', async () => {
 const server=createApp();server.listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address(),root=`http://127.0.0.1:${address.port}`;
 const get=(who)=>fetch(root+'/api/state',{headers: who?{'x-demo-player':who}:{}});
 const post=(who,expectedRevision,key)=>fetch(root+'/api/command',{method:'POST',headers:{'x-demo-player':who,'content-type':'application/json'},body:JSON.stringify({type:'end_demo_turn',expectedRevision,idempotencyKey:key})});
 try{
  assert.equal((await get()).status,401);
  assert.equal((await get('Z')).status,401);
  const ra=await get('A'), rb=await get('B');
  const a=await ra.text(),b=await rb.text();
  assert.equal(a.includes('ONLY_B_CARD'),false);
  assert.equal(b.includes('ONLY_A_CARD'),false);
  assert.equal((await post('B',0,'req-b-before')).status,403);
  const simultaneous=await Promise.all([post('A',0,'req-a-first'),post('A',0,'req-a-second')]);
  assert.deepEqual(simultaneous.map(x=>x.status).sort(),[200,409]);
  const result=await (await get('B')).json();
  assert.equal(result.revision,1);
  assert.equal(result.turn,'B');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('SSE: publicar solo revisión (no contenidos privados)', () => {
 const demo=createDemo(),notifications=[];
 const unsubscribe=demo.subscribe(revision=>notifications.push(revision));
 demo.command('A',{type:'end_demo_turn',expectedRevision:0,idempotencyKey:'evt-first'});
 unsubscribe();
 assert.deepEqual(notifications,[1]);
});
