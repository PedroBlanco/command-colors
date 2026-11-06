import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createSqliteTestComposition} from './sqlite-compose.mjs';

const PASSWORD = 'test-only-DO-NOT-USE-in-production-00000';
async function withDb(fn) {
  const dir=await mkdtemp(join(tmpdir(),'ccw-httpdb-'));
  const file=join(dir,'state.sqlite');
  const opened=[];
  const open=async()=>{
    const services=createSqliteTestComposition({file});
    const server=services.createServer();
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const base=`http://127.0.0.1:${server.address().port}`;
    const call=async(method,path,token,body)=>{
      const r=await fetch(base+path,{method,headers:{...(token?{authorization:`Bearer ${token}`}:{}) ,...(body!==undefined?{'content-type':'application/json'}:{})},
        ...(body!==undefined?{body:JSON.stringify(body)}:{})});
      return {status:r.status,data:await r.json()};
    };
    let closed=false;
    const close=async()=>{
      if(closed)return; closed=true;
      server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
      services.close();
    };
    const inst={services,call,close};opened.push(inst);
    return inst;
  };
  try {await fn(open);} finally {await Promise.allSettled(opened.map(inst=>inst.close()));await rm(dir,{recursive:true,force:true});}
}
async function createUsers(h) {
  for(const handle of ['alice','bob','carol']) {
    assert.equal((await h.services.identity.provisionAccount({handle,password:PASSWORD})).ok,true);
  }
}
async function login(h,handle) {
  const response=await h.call('POST','/api/session',null,{handle,password:PASSWORD});
  assert.equal(response.status,200);return response.data.token;
}
async function establish(h,a,b) {
  const created=await h.call('POST','/api/matches',a);
  assert.equal(created.status,201);const id=created.data.matchId;
  const invite=await h.call('POST',`/api/matches/${id}/invitations`,a,{targetHandle:'bob'});
  assert.equal(invite.status,201);
  assert.equal((await h.call('POST','/api/invitations/accept',b,{invitationToken:invite.data.token})).status,200);
  return id;
}

test('HTTP SQLite: two real players, invitation and private hands survive restart',()=>withDb(async open=>{
  const first=await open();await createUsers(first);
  const a=await login(first,'alice'),b=await login(first,'bob'),c=await login(first,'carol');
  const id=await establish(first,a,b);
  const aView=await first.call('GET',`/api/matches/${id}`,a);
  const bView=await first.call('GET',`/api/matches/${id}`,b);
  assert.equal(aView.status,200);assert.equal(bView.status,200);
  assert.equal(JSON.stringify(aView.data).includes('PRIVATE_B_'),false);
  assert.equal(JSON.stringify(bView.data).includes('PRIVATE_A_'),false);
  assert.equal(JSON.stringify(aView.data).includes('HIDDEN_FUTURE_CARD'),false);
  assert.equal((await first.call('GET',`/api/matches/${id}`,c)).status,404);
  const command={type:'pass_demo_turn',expectedRevision:0,idempotencyKey:'turn_00001',actor:'B'};
  assert.equal((await first.call('POST',`/api/matches/${id}/commands`,a,command)).status,200);
  await first.close();
  const second=await open();
  const restored=await second.call('GET',`/api/matches/${id}`,b);
  assert.equal(restored.status,200);assert.equal(restored.data.state.revision,1);
  assert.equal(restored.data.state.turn,'B');
  assert.equal((await second.call('POST',`/api/matches/${id}/commands`,a,command)).data.code,'ALREADY_APPLIED');
  assert.equal((await second.call('GET',`/api/matches/${id}/events`,b)).data.events.length,1);
  assert.equal((await second.call('GET',`/api/matches/${id}`,c)).status,404);
}));

test('HTTP SQLite: authorization and stale command remain correct across instances',()=>withDb(async open=>{
 const one=await open();await createUsers(one);
 const a=await login(one,'alice'),b=await login(one,'bob'),c=await login(one,'carol');
 const id=await establish(one,a,b);const other=await open();
 const url=`/api/matches/${id}/commands`;
 const denied=await other.call('POST',url,b,{actor:'A',type:'pass_demo_turn',expectedRevision:0,idempotencyKey:'fake_actor_0001'});
 assert.equal(denied.status,403);
 const outsider=await one.call('POST',url,c,{type:'pass_demo_turn',expectedRevision:0,idempotencyKey:'outsider_0001'});
 assert.equal(outsider.status,404);
 const success=await one.call('POST',url,a,{type:'pass_demo_turn',expectedRevision:0,idempotencyKey:'legit_000001'});
 const stale=await other.call('POST',url,a,{type:'pass_demo_turn',expectedRevision:0,idempotencyKey:'stale_000001'});
 assert.equal(success.status,200);assert.equal(stale.status,409);
 assert.equal(stale.data.state.revision,1);
 assert.equal(JSON.stringify(stale.data).includes('PRIVATE_B_'),false);
}));

test('HTTP SQLite: invitation issued before restart can be accepted afterwards',()=>withDb(async open=>{
 const one=await open();await createUsers(one);
 const a=await login(one,'alice'),b=await login(one,'bob');
 const m=await one.call('POST','/api/matches',a);
 const id=m.data.matchId;
 const invite=await one.call('POST',`/api/matches/${id}/invitations`,a,{targetHandle:'bob'});
 assert.equal(invite.status,201);
 assert.equal((await one.call('GET',`/api/matches/${id}`,b)).status,404);
 await one.close();
 const two=await open();
 assert.equal((await two.call('POST','/api/invitations/accept',b,{invitationToken:invite.data.token})).status,200);
 assert.equal((await two.call('GET',`/api/matches/${id}`,b)).status,200);
 assert.equal((await two.call('POST','/api/invitations/accept',b,{invitationToken:invite.data.token})).status,404);
}));
