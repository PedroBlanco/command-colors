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
    const start=async({browser=false,revisionPollMs=30,storeFactory=app.getStore}={})=>{
      const port=await availablePort();
      const origin=`http://127.0.0.1:${port}`;
      const srv=createAccessGateway({
        identity:app.identity,invitations:app.invitations,getStore:storeFactory,
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

test('HTTP: malformed internal events fail closed instead of serializing a private object',()=>fixture(async({app,tokens,matchId,start})=>{
  const normal=app.getStore(matchId);
  const {origin}=await start({storeFactory:()=>({
    view:actor=>normal.view(actor),
    publicEvents:()=>({privateJournal:{yourHand:['DO_NOT_LEAK_CARD'],commands:['DO_NOT_LEAK_KEY']}})
  })});
  const response=await api(origin,`/api/matches/${matchId}/events`,tokens.alice);
  assert.equal(response.status,503);
  assert.deepEqual(response.body,{code:'SERVICE_UNAVAILABLE'});
  assert.equal(response.raw.includes('DO_NOT_LEAK'),false);
}));

test('SEC-001 HTTP: logout between lobby check and store lookup denies every public read',async()=>{
  for(const [method,pathEnd] of [['GET',''],['GET','/events'],['POST','/commands']]){
    await fixture(async({app,tokens,matchId,start})=>{
      let revocations=0;
      const {origin}=await start({storeFactory:id=>{
        revocations++;
        app.identity.logOut(tokens.alice);
        return app.getStore(id);
      }});
      const response=await api(origin,`/api/matches/${matchId}${pathEnd}`,tokens.alice,{
        method,...(method==='POST'?{body:{
          type:'pass_demo_turn',expectedRevision:0,idempotencyKey:'revoked_before_read_001'
        }}:{})
      });
      assert.equal(revocations,1);
      assert.equal(response.status,401);
      assert.deepEqual(response.body,{code:'UNAUTHENTICATED'});
      assert.doesNotMatch(response.raw,/yourHand|PRIVATE_A|card_a_left|gameRevision/);
      assert.equal(app.getStore(matchId).view('A').revision,0);
    });
  }
});

test('SEC-001 HTTP: events revalidate session after earlier authorized match view',()=>fixture(async({app,tokens,matchId,start})=>{
  const real=app.getStore(matchId),calls=[];
  const {origin}=await start({storeFactory:()=>({
    viewForSession:request=>{
      calls.push('view');
      const response=real.viewForSession(request);
      app.identity.logOut(request.sessionToken);
      return response;
    },
    publicEventsForSession:request=>{
      calls.push('events');
      return real.publicEventsForSession(request);
    },
    view:()=>{throw new Error('UNSAFE_ACTOR_VIEW_CALLED');},
    publicEvents:()=>{throw new Error('UNSAFE_ACTOR_EVENTS_CALLED');}
  })});
  const response=await api(origin,`/api/matches/${matchId}/events`,tokens.alice);
  assert.equal(response.status,401);
  assert.deepEqual(response.body,{code:'UNAUTHENTICATED'});
  assert.deepEqual(calls,['view','events']);
  assert.doesNotMatch(response.raw,/yourHand|gameRevision|PRIVATE_A/);
}));


test('SEC-001 HTTP: command rejected after logout between read snapshot and writer lock',()=>fixture(async({app,tokens,matchId,start})=>{
  const real=app.getStore(matchId);
  const {origin}=await start({storeFactory:()=>({
    viewForSession:request=>{
      const state=real.viewForSession(request);
      app.identity.logOut(request.sessionToken);
      return state;
    },
    dispatchForSession:request=>real.dispatchForSession(request),
    view:()=>{throw new Error('UNSAFE_ACTOR_VIEW_CALLED');},
    dispatch:()=>{throw new Error('UNSAFE_ACTOR_COMMAND_CALLED');}
  })});
  const result=await api(origin,`/api/matches/${matchId}/commands`,tokens.alice,{
    method:'POST',body:{type:'pass_demo_turn',expectedRevision:0,
      idempotencyKey:'session_revoked_mid_request_001'}
  });
  assert.equal(result.status,401);
  assert.deepEqual(result.body,{code:'UNAUTHENTICATED'});
  assert.equal(real.view('A').revision,0);
  assert.equal(app.unsafeTestDatabase().prepare(
    'SELECT count(*) n FROM game_commands WHERE match_id=?').get(matchId).n,0);
}));

test('SEC-001 HTTP: deck initialization never trusts the stale preflight session',()=>fixture(async({app,tokens,matchId,start})=>{
  const {origin}=await start({storeFactory:id=>{
    app.identity.logOut(tokens.alice);
    return app.getStore(id);
  }});
  const result=await api(origin,`/api/matches/${matchId}/deck/initialize`,tokens.alice,{
    method:'POST',body:{}
  });
  assert.equal(result.status,401);
  assert.deepEqual(result.body,{code:'UNAUTHENTICATED'});
  assert.equal(app.getStore(matchId).view('A').revision,0);
  assert.equal(app.unsafeTestDatabase().prepare(
    'SELECT count(*) n FROM game_commands WHERE match_id=?').get(matchId).n,0);
}));

test('HTTP: match, events and commands request a deny-on-read private lab snapshot',()=>fixture(async({app,tokens,matchId,start})=>{
  const real=app.getStore(matchId);
  assert.equal(real.initializeExperimentalSectionHistory({
    sessionToken:tokens.alice,trustedSetup:setup()
  }).status,201);
  const readFlags=[];
  const filtered={
    view:(actor,options)=>{
      readFlags.push(options?.denyExperimentalLab);
      assert.equal(options?.denyExperimentalLab,true,
        'HTTP must request a private-lab-denying SQLite read snapshot');
      return real.view(actor,options);
    },
    publicEvents:(...args)=>real.publicEvents(...args),
    dispatch:(...args)=>real.dispatch(...args)
  };
  const {origin}=await start({storeFactory:()=>filtered});
  const routes=[
    ['GET',`/api/matches/${matchId}`],
    ['GET',`/api/matches/${matchId}/events`],
    ['POST',`/api/matches/${matchId}/commands`]
  ];
  for(const [method,path] of routes){
    const response=await api(origin,path,tokens.alice,{
      method,...(method==='POST'?{body:{type:'pass_demo_turn',expectedRevision:0,
        idempotencyKey:'safe_private_view_001'}}:{})
    });
    assert.equal(response.status,409);
    assert.deepEqual(response.body,{code:'SECTION_LAB_INTERNAL_ONLY'});
    assert.doesNotMatch(response.raw,/yourHand|privateJournal|card_a_left/);
  }
  assert.deepEqual(readFlags,[true,true,true]);
}));

test('SEC-001: mid-request revocation takes precedence over private lab denial',()=>fixture(async({app,tokens,matchId})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  assert.equal(store.initializeExperimentalSectionHistory({
    sessionToken:tokens.alice,trustedSetup:setup()
  }).status,201);
  const before={
    match:db.prepare('SELECT * FROM matches WHERE id=?').get(matchId),
    events:db.prepare('SELECT * FROM game_events WHERE match_id=? ORDER BY sequence').all(matchId),
    commands:db.prepare('SELECT * FROM game_commands WHERE match_id=? ORDER BY committed_revision').all(matchId)
  };
  const original=app.identity.resolveSession;
  let revoked=false;
  try {
    app.identity.resolveSession=token=>{
      const identity=original(token);
      if(token===tokens.alice&&identity&&!revoked){
        revoked=true;
        // Race after a successful preflight but before BEGIN IMMEDIATE.
        assert.equal(app.identity.logOut(token).ok,true);
      }
      return identity;
    };
    const result=await store.dispatchForSession({
      sessionToken:tokens.alice,type:'pass_demo_turn',
      expectedRevision:0,idempotencyKey:'revoked_lab_denial_001'
    });
    assert.equal(revoked,true);
    assert.deepEqual(result,{status:401,code:'UNAUTHENTICATED'});
    assert.equal(JSON.stringify(result).includes('SECTION_LAB'),false);
    assert.deepEqual({
      match:db.prepare('SELECT * FROM matches WHERE id=?').get(matchId),
      events:db.prepare('SELECT * FROM game_events WHERE match_id=? ORDER BY sequence').all(matchId),
      commands:db.prepare('SELECT * FROM game_commands WHERE match_id=? ORDER BY committed_revision').all(matchId)
    },before);
    assert.equal(db.isTransaction,false);
  } finally {app.identity.resolveSession=original;}
}));
