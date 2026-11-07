/** End-to-end HTTP smoke test with real local SQLite and cookie sessions. Synthetic data only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer as createPortProbe} from 'node:net';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openSqliteComposition} from '../sqlite-store/sqlite.mjs';
import {createAccessGateway} from './gateway.mjs';

const PASSWORD = 'synthetic-test-only-not-for-users-2026';
const headerFor = origin => ({origin, 'x-ccw-request': '1'});

async function freePort() {
  const probe = createPortProbe();
  probe.listen(0, '127.0.0.1');
  await once(probe,'listening');
  const port=probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

async function withLiveSqlite(fn) {
  const directory=await mkdtemp(join(tmpdir(),'ccw-browser-sqlite-'));
  const file=join(directory,'ccw.sqlite');
  let db=openSqliteComposition({file});
  let api=null, origin=null;
  async function start() {
    const port=await freePort();
    origin=`http://127.0.0.1:${port}`;
    api=createAccessGateway({...db,browser:{origin,insecureLoopback:true}});
    api.listen(port,'127.0.0.1');
    await once(api,'listening');
  }
  async function stop() {
    if(api){api.closeAllConnections();await new Promise(resolve=>api.close(resolve));api=null;}
    db.close();
  }
  async function restart() {
    await stop();
    db=openSqliteComposition({file});
    await start();
  }
  async function call(method,route,{cookie,body,headers={}}={}) {
    const response=await fetch(origin+route,{
      method,
      headers:{...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{}),...headers},
      ...(body!==undefined?{body:JSON.stringify(body)}:{})
    });
    const value=await response.json();
    return {status:response.status,value,headers:response.headers};
  }
  async function login(handle) {
    const r=await call('POST','/api/session',{body:{handle,password:PASSWORD},headers:headerFor(origin)});
    assert.equal(r.status,200);
    assert.equal('token' in r.value,false);
    assert.match(r.headers.get('set-cookie')??'',/HttpOnly/);
    return r.headers.get('set-cookie').split(';')[0];
  }
  try {
    for(const handle of ['alice','bob','carol']) {
      const created=await db.identity.provisionAccount({handle,password:PASSWORD});
      assert.equal(created.ok,true);
    }
    await start();
    return await fn({call,login,restart,origin:()=>origin});
  } finally {
    await stop();
    await rm(directory,{recursive:true,force:true});
  }
}

test('HTTP+SQLite: invitation, private hands, retries and restart with intact cookie',()=>withLiveSqlite(async({call,login,restart,origin})=>{
  const a=await login('alice'), b=await login('bob'), outsider=await login('carol');
  const created=await call('POST','/api/matches',{cookie:a,headers:headerFor(origin())});
  assert.equal(created.status,201);
  const id=created.value.matchId;
  assert.equal((await call('GET',`/api/matches/${id}`,{cookie:b})).status,404);
  const invitation=await call('POST',`/api/matches/${id}/invitations`,{
    cookie:a,headers:headerFor(origin()),body:{targetHandle:'bob'}
  });
  assert.equal(invitation.status,201);
  assert.equal((await call('POST','/api/invitations/accept',{
    cookie:outsider,headers:headerFor(origin()),body:{invitationToken:invitation.value.token}
  })).status,404);
  assert.equal((await call('POST','/api/invitations/accept',{
    cookie:b,headers:headerFor(origin()),body:{invitationToken:invitation.value.token}
  })).status,200);
  const left=await call('GET',`/api/matches/${id}`,{cookie:a});
  const right=await call('GET',`/api/matches/${id}`,{cookie:b});
  assert.equal(left.status,200);assert.equal(right.status,200);
  assert.equal(left.value.state.matchId,id);assert.equal(right.value.state.matchId,id);
  assert.equal(left.value.state.you,'A');assert.equal(right.value.state.you,'B');
  assert.equal(JSON.stringify(left.value).includes('PRIVATE_B_'),false);
  assert.equal(JSON.stringify(right.value).includes('PRIVATE_A_'),false);
  assert.equal(JSON.stringify([left.value,right.value]).includes('HIDDEN_FUTURE_CARD'),false);
  const command={type:'pass_demo_turn',expectedRevision:0,idempotencyKey:'smoke_request_001',actor:'B'};
  const committed=await call('POST',`/api/matches/${id}/commands`,{cookie:a,headers:headerFor(origin()),body:command});
  assert.equal(committed.status,200);assert.equal(committed.value.state.revision,1);
  assert.equal(committed.value.state.you,'A');
  const retry=await call('POST',`/api/matches/${id}/commands`,{cookie:a,headers:headerFor(origin()),body:command});
  assert.equal(retry.status,200);assert.equal(retry.value.code,'ALREADY_APPLIED');
  await restart();
  const state=await call('GET',`/api/matches/${id}`,{cookie:b});
  assert.equal(state.status,200);
  assert.equal(state.value.state.revision,1);
  assert.equal(state.value.state.turn,'B');
  const events=await call('GET',`/api/matches/${id}/events`,{cookie:b});
  assert.equal(events.status,200);assert.equal(events.value.events.length,1);
  assert.equal(JSON.stringify(events.value).includes('PRIVATE_'),false);
  assert.equal((await call('GET',`/api/matches/${id}`,{cookie:outsider})).status,404);
}));

test('HTTP+SQLite: CSRF, invalid Host, logout and actor spoofing denied',()=>withLiveSqlite(async({call,login,origin})=>{
  const a=await login('alice');
  assert.equal((await call('POST','/api/matches',{cookie:a})).status,403);
  assert.equal((await call('POST','/api/matches',{cookie:a,headers:{...headerFor(origin()),'sec-fetch-site':'cross-site'}})).status,403);
  assert.equal((await call('POST','/api/matches',{headers:{...headerFor(origin()),authorization:'Bearer '+a}})).status,401);
  assert.equal((await call('POST','/api/matches',{cookie:a,headers:headerFor(origin())})).status,201);
  assert.equal((await call('DELETE','/api/session',{cookie:a,headers:headerFor(origin())})).status,200);
  assert.equal((await call('GET','/api/session',{cookie:a})).status,401);
}));
