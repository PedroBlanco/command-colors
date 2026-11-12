/**
 * CCW-015: regression for accidental exposure of internal section-card lab
 * through previously existing generic HTTP routes (no new HTTP endpoint).
 * Uses real SQLite identity, invitations and the loopback HTTP gateway.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer as netServer} from 'node:net';
import {openSqliteComposition} from '../sqlite-store/sqlite.mjs';
import {createAccessGateway} from './gateway.mjs';

const PASSWORD='CCW-local-HTTP-lab-test-only-password-2026';
const setup=()=>({cardInstances:[
  {instanceId:'card_a_left',definitionId:'ORDER_2_LEFT'},
  {instanceId:'card_b_right',definitionId:'ORDER_2_RIGHT'},
  {instanceId:'card_c_left',definitionId:'ORDER_3_LEFT'},
  {instanceId:'card_d_right',definitionId:'ORDER_3_RIGHT'},
  {instanceId:'card_e_left',definitionId:'ORDER_4_LEFT'},
  {instanceId:'card_f_right',definitionId:'ORDER_4_RIGHT'}],
  handSizes:{A:2,B:2},startingSide:'A',randomIndex:()=>0,
  board:{units:[{id:'unitA',side:'A',col:2,row:4},
    {id:'unitB',side:'B',col:10,row:4}],leaders:[]},
  sectorCells:{'2,4':['LEFT'],'10,4':['RIGHT']}
});
async function availablePort(){
  const server=netServer();
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return port;
}
async function fixture(work){
  const dir=mkdtempSync(join(tmpdir(),'ccw-http-lab-isolation-'));
  const app=openSqliteComposition({file:join(dir,'lab.sqlite')});
  const servers=[];
  try {
    for(const handle of ['alice','bob','outsider'])
      assert.equal((await app.identity.provisionAccount({handle,password:PASSWORD})).ok,true);
    const tokens={};
    for(const handle of ['alice','bob','outsider'])
      tokens[handle]=(await app.identity.logIn({handle,password:PASSWORD})).token;
    const created=app.invitations.createMatch({sessionToken:tokens.alice});
    const invited=app.invitations.issueInvitation({sessionToken:tokens.alice,
      matchId:created.matchId,targetHandle:'bob'});
    assert.equal(app.invitations.acceptInvitation({
      sessionToken:tokens.bob,invitationToken:invited.token
    }).ok,true);
    const start=async({browser=false,revisionPollMs=30}={})=>{
      const port=await availablePort();
      const origin=`http://127.0.0.1:${port}`;
      const srv=createAccessGateway({
        identity:app.identity,invitations:app.invitations,getStore:app.getStore,
        revisionPollMs,...(browser?{browser:{origin,insecureLoopback:true}}:{})
      });
      await new Promise((resolve,reject)=>srv.once('error',reject).listen(port,'127.0.0.1',resolve));
      servers.push(srv);
      return {origin,srv};
    };
    return await work({app,tokens,matchId:created.matchId,start});
  } finally {
    for(const srv of servers.reverse()){
      srv.closeAllConnections?.();
      await new Promise(resolve=>srv.close(()=>resolve()));
    }
    app.close();
    rmSync(dir,{recursive:true,force:true,maxRetries:12,retryDelay:100});
  }
}
async function api(origin,path,token,{method='GET',body}={}){
  const r=await fetch(origin+path,{
    method,headers:{authorization:`Bearer ${token}`,
      ...(body!==undefined?{'content-type':'application/json'}:{})},
    ...(body!==undefined?{body:JSON.stringify(body)}:{})
  });
  const raw=await r.text();
  return {status:r.status,raw,body:JSON.parse(raw)};
}

test('HTTP: regular synthetic match GET still works before internal lab activation',()=>fixture(async({tokens,matchId,start})=>{
  const {origin}=await start();
  const result=await api(origin,`/api/matches/${matchId}`,tokens.alice);
  assert.equal(result.status,200);
  assert.equal(result.body.matchId,matchId);
  assert.equal(result.body.state.matchId,matchId);
}));

test('HTTP: generic match GET never serves internal lab hand or private journal to either player',()=>fixture(async({app,tokens,matchId,start})=>{
  const {origin}=await start();
  const store=app.getStore(matchId);
  assert.equal(store.initializeExperimentalSectionHistory({
    sessionToken:tokens.alice,trustedSetup:setup()
  }).status,201);
  for(const token of [tokens.alice,tokens.bob]){
    const r=await api(origin,`/api/matches/${matchId}`,token);
    assert.equal(r.status,409);
    assert.deepEqual(r.body,{code:'SECTION_LAB_INTERNAL_ONLY'});
    assert.equal(r.raw.includes('card_a_left'),false);
    assert.equal(r.raw.includes('yourHand'),false);
    assert.equal(r.raw.includes('ancientsSectionHistoryLab'),false);
  }
  const outsider=await api(origin,`/api/matches/${matchId}`,tokens.outsider);
  assert.equal(outsider.status,404);
}));

test('HTTP: events and commands are closed in lab mode, with zero additional DB writes',()=>fixture(async({app,tokens,matchId,start})=>{
  const {origin}=await start(),store=app.getStore(matchId);
  assert.equal(store.initializeExperimentalSectionHistory({
    sessionToken:tokens.alice,trustedSetup:setup()
  }).status,201);
  const card=store.viewExperimentalSectionHistory({sessionToken:tokens.alice}).view.yourHand[0].instanceId;
  assert.equal(store.dispatchExperimentalSectionHistory({
    sessionToken:tokens.alice,type:'PLAY_SECTION_CARD',expectedRevision:0,
    idempotencyKey:'private_http_lab_card_001',cardInstanceId:card
  }).status,200);
  const db=app.unsafeTestDatabase();
  const prior={
    row:db.prepare('SELECT * FROM matches WHERE id=?').get(matchId),
    events:db.prepare('SELECT * FROM game_events WHERE match_id=? ORDER BY sequence').all(matchId),
    keys:db.prepare('SELECT * FROM game_commands WHERE match_id=? ORDER BY committed_revision').all(matchId)
  };
  for(const token of [tokens.alice,tokens.bob]){
    const events=await api(origin,`/api/matches/${matchId}/events`,token);
    assert.equal(events.status,409);assert.deepEqual(events.body,{code:'SECTION_LAB_INTERNAL_ONLY'});
    const command=await api(origin,`/api/matches/${matchId}/commands`,token,{
      method:'POST',body:{type:'pass_demo_turn',expectedRevision:1,idempotencyKey:'blocked_http_001'}
    });
    assert.equal(command.status,409);
    assert.deepEqual(command.body,{code:'SECTION_LAB_INTERNAL_ONLY'});
  }
  assert.deepEqual(db.prepare('SELECT * FROM matches WHERE id=?').get(matchId),prior.row);
  assert.deepEqual(db.prepare('SELECT * FROM game_events WHERE match_id=? ORDER BY sequence').all(matchId),prior.events);
  assert.deepEqual(db.prepare('SELECT * FROM game_commands WHERE match_id=? ORDER BY committed_revision').all(matchId),prior.keys);
}));

test('HTTP: initializing another deck in lab mode fails without returning private state',()=>fixture(async({app,tokens,matchId,start})=>{
  const {origin}=await start(),store=app.getStore(matchId);
  assert.equal(store.initializeExperimentalSectionHistory({
    sessionToken:tokens.alice,trustedSetup:setup()
  }).status,201);
  const result=await api(origin,`/api/matches/${matchId}/deck/initialize`,tokens.alice,{method:'POST',body:{}});
  assert.equal(result.status,409);
  assert.deepEqual(result.body,{code:'SECTION_LAB_MODE_ACTIVE'});
  assert.equal(result.raw.includes('yourHand'),false);
}));

test('HTTP browser SSE rejects new subscriptions to internal laboratory matches',()=>fixture(async({app,matchId,start})=>{
  const {origin}=await start({browser:true}),store=app.getStore(matchId);
  const login=await fetch(origin+'/api/session',{
    method:'POST',headers:{'content-type':'application/json',origin,'x-ccw-request':'1'},
    body:JSON.stringify({handle:'alice',password:PASSWORD})
  });
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const token=cookie.split('=')[1];
  assert.equal(store.initializeExperimentalSectionHistory({
    sessionToken:token,trustedSetup:setup()
  }).status,201);
  const sse=await fetch(origin+`/api/matches/${matchId}/updates`,{headers:{cookie}});
  assert.equal(sse.status,409);
  assert.deepEqual(await sse.json(),{code:'SECTION_LAB_INTERNAL_ONLY'});
}));

test('HTTP browser SSE subscription opened before lab activation closes on first lab revision',()=>fixture(async({app,matchId,start})=>{
  const {origin}=await start({browser:true,revisionPollMs:25}),store=app.getStore(matchId);
  const login=await fetch(origin+'/api/session',{
    method:'POST',headers:{'content-type':'application/json',origin,'x-ccw-request':'1'},
    body:JSON.stringify({handle:'alice',password:PASSWORD})
  });
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const token=cookie.split('=')[1];
  const controller=new AbortController();
  const sse=await fetch(origin+`/api/matches/${matchId}/updates`,{
    headers:{cookie},signal:controller.signal
  });
  assert.equal(sse.status,200);
  try {
    const reader=sse.body.getReader();
    const first=await reader.read();
    assert.equal(first.done,false);
    assert.match(new TextDecoder().decode(first.value),/retry:/);
    assert.equal(store.initializeExperimentalSectionHistory({
      sessionToken:token,trustedSetup:setup()
    }).status,201);
    let done=false;
    for(let i=0;i<5&&!done;i++){
      const next=await Promise.race([
        reader.read(),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('SSE_LAB_NOT_CLOSED')),1500))
      ]);
      done=next.done;
      if(!done) {
        const chunk=new TextDecoder().decode(next.value);
        assert.equal(chunk.includes('card_a_left'),false);
      }
    }
    assert.equal(done,true);
  } finally {controller.abort();}
}));
