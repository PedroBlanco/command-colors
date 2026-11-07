import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSqliteTestComposition} from './sqlite-compose.mjs';

const PASSWORD = 'synthetic-only-test-password-2026';

async function lab(run) {
  const dir = await mkdtemp(join(tmpdir(), 'ccw-command-http-'));
  const file = join(dir, 'lab.sqlite');
  const opened=[];
  async function start() {
    const service=createSqliteTestComposition({file});
    const server=service.createServer();
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const origin=`http://127.0.0.1:${server.address().port}`;
    async function call(method,path,token,data){
      const response=await fetch(origin+path,{method,headers:{...(token?{authorization:`Bearer ${token}`}:{}) ,
        ...(data!==undefined?{'content-type':'application/json'}:{})},
      ...(data!==undefined?{body:JSON.stringify(data)}:{})});
      return {status:response.status,data:await response.json()};
    }
    let stopped=false;
    async function close(){if(stopped)return;stopped=true;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));service.close();}
    const result={service,call,close};opened.push(result);return result;
  }
  try {await run(start);}finally {await Promise.allSettled(opened.map(x=>x.close()));await rm(dir,{recursive:true,force:true});}
}

async function setupLab(h){
  for(const handle of ['alice','bob','carol']){
    assert.equal((await h.service.identity.provisionAccount({handle,password:PASSWORD})).ok,true);
  }
  const tokens={};
  for(const handle of ['alice','bob','carol']){
    const login=await h.call('POST','/api/session',null,{handle,password:PASSWORD});
    assert.equal(login.status,200);tokens[handle]=login.data.token;
  }
  const created=await h.call('POST','/api/matches',tokens.alice);
  assert.equal(created.status,201);
  const matchId=created.data.matchId;
  const invitation=await h.call('POST',`/api/matches/${matchId}/invitations`,tokens.alice,{targetHandle:'bob'});
  assert.equal(invitation.status,201);
  assert.equal((await h.call('POST','/api/invitations/accept',tokens.bob,{invitationToken:invitation.data.token})).status,200);
  return {tokens,matchId,url:`/api/matches/${matchId}`};
}

async function command(h,url,token,type,expectedRevision,data={},idempotencyKey=`request_${type}_${expectedRevision}`){
  return h.call('POST',`${url}/commands`,token,{type,expectedRevision,idempotencyKey,...data});
}

test('HTTP: only the authenticated owner initializes a fixed synthetic command deck',()=>lab(async start=>{
  const h=await start();const {tokens,url}=await setupLab(h);
  assert.equal((await h.call('POST',`${url}/deck/initialize`,tokens.bob,{})).status,403);
  assert.equal((await h.call('POST',`${url}/deck/initialize`,tokens.carol,{})).status,404);
  assert.equal((await h.call('POST',`${url}/deck/initialize`,tokens.alice,{cardIds:['forged']})).status,400);
  const init=await h.call('POST',`${url}/deck/initialize`,tokens.alice,{});
  assert.equal(init.status,201);assert.equal(init.data.code,'DECK_INITIALIZED');
  assert.equal(init.data.state.you,'A');assert.equal(init.data.state.yourHand.length,2);
  assert.equal(init.data.state.opponentCardCount,3);
  assert.equal((await h.call('POST',`${url}/deck/initialize`,tokens.alice,{})).status,409);
}));

test('HTTP: secret cards never cross owner/opponent boundary, including errors and events',()=>lab(async start=>{
  const h=await start();const {tokens,url}=await setupLab(h);
  const init=await h.call('POST',`${url}/deck/initialize`,tokens.alice,{});
  assert.equal(init.status,201);
  const [a,b,c]=await Promise.all([
    h.call('GET',url,tokens.alice),h.call('GET',url,tokens.bob),h.call('GET',url,tokens.carol)
  ]);
  assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(c.status,404);
  const privateState=JSON.parse(h.service.unsafeTestDatabase().prepare('SELECT private_state FROM matches').get().private_state).commandSession;
  for(const name of [...privateState.hands.B,...privateState.drawPile])assert.equal(JSON.stringify(a.data).includes(name),false);
  for(const name of [...privateState.hands.A,...privateState.drawPile])assert.equal(JSON.stringify(b.data).includes(name),false);
  const wrong=await command(h,url,tokens.alice,'play_synthetic_card',0,{cardRef:privateState.hands.B[0]});
  assert.equal(wrong.status,400);
  assert.equal(JSON.stringify(wrong.data).includes(privateState.hands.B[0]),false);
  const events=await h.call('GET',`${url}/events`,tokens.bob);
  assert.equal(events.status,200);assert.deepEqual(events.data.events,[]);
}));

test('HTTP: client cannot forge actor; command, event and revision are durable',()=>lab(async start=>{
  const first=await start();const {tokens,url}=await setupLab(first);
  assert.equal((await first.call('POST',`${url}/deck/initialize`,tokens.alice,{})).status,201);
  const a=await first.call('GET',url,tokens.alice);
  const cardRef=a.data.state.yourHand[0];
  const forged=await first.call('POST',`${url}/commands`,tokens.bob,{
    actor:'A',type:'play_synthetic_card',expectedRevision:0,cardRef,
    idempotencyKey:'forged_action_0001'
  });
  assert.equal(forged.status,403);
  const valid=await first.call('POST',`${url}/commands`,tokens.alice,{
    actor:'B',type:'play_synthetic_card',expectedRevision:0,cardRef,
    idempotencyKey:'legitimate_play_001'
  });
  assert.equal(valid.status,200);assert.equal(valid.data.state.phase,'ASSIGN_ORDERS');
  await first.close();
  const restored=await start();
  const view=await restored.call('GET',url,tokens.bob);
  assert.equal(view.status,200);assert.equal(view.data.state.revision,1);
  assert.equal(view.data.state.cardInPlay,cardRef);
  const replay=await restored.call('POST',`${url}/commands`,tokens.alice,{
    type:'play_synthetic_card',cardRef,expectedRevision:0,idempotencyKey:'legitimate_play_001'
  });
  assert.equal(replay.status,200);assert.equal(replay.data.code,'ALREADY_APPLIED');
  const conflict=await restored.call('POST',`${url}/commands`,tokens.alice,{
    type:'play_synthetic_card',cardRef:'other_card',expectedRevision:0,idempotencyKey:'legitimate_play_001'
  });
  assert.equal(conflict.status,409);assert.equal(conflict.data.code,'IDEMPOTENCY_KEY_REUSED');
  const events=await restored.call('GET',`${url}/events`,tokens.bob);
  assert.equal(events.status,200);assert.equal(events.data.events.length,1);
  assert.equal(JSON.stringify(events.data.events).includes('LEGACY_FUTURE'),false);
}));

test('HTTP: a match without deck retains legacy demo-turn behavior',()=>lab(async start=>{
  const h=await start();const {tokens,url}=await setupLab(h);
  const old=await command(h,url,tokens.alice,'pass_demo_turn',0,{},'original_turn_01');
  assert.equal(old.status,200);assert.equal(old.data.state.revision,1);
  const denied=await h.call('POST',`${url}/deck/initialize`,tokens.alice,{});
  assert.equal(denied.status,409);
}));
