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
import {loadAncientsScenarioDirectory} from '../../scripts/scenario-import.mjs';
import {createAncientsScenarioCatalog} from '../ancients-rules/scenario-catalog.mjs';
import {fileURLToPath} from 'node:url';

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
    const start=async({browser=false,revisionPollMs=30,storeFactory=app.getStore,
      ancientsBrowserLab=false,ancientsScenarioCatalog=undefined}={})=>{
      const port=await availablePort();
      const origin=`http://127.0.0.1:${port}`;
      const srv=createAccessGateway({
        identity:app.identity,invitations:app.invitations,getStore:storeFactory,
        revisionPollMs,ancientsBrowserLab,ancientsScenarioCatalog,...(browser?{browser:{origin,insecureLoopback:true}}:{})
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
  for(const [who,side,opponent] of [['alice','A','bob'],['bob','B','alice']]){
    const listed=await api(origin,'/api/matches',tokens[who]);
    assert.equal(listed.status,200);
    assert.deepEqual(listed.body,{ok:true,handle:who,more:false,matches:[{matchId,side,opponent,status:'READY'}]});
  }
  assert.deepEqual((await api(origin,'/api/matches',tokens.outsider)).body,{ok:true,handle:'outsider',more:false,matches:[]});
  assert.equal((await api(origin,'/api/matches','invalid')).status,401);
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

test('Ancients HTTP: opt-in cannot be enabled without explicit loopback browser',()=>fixture(async({app,start,tokens,matchId})=>{
 assert.throws(()=>createAccessGateway({...app,ancientsBrowserLab:true}),
  /ANCIENTS_LAB_LOOPBACK_ONLY/);
 assert.throws(()=>createAccessGateway({...app,
  browser:{origin:'https://example.org',insecureLoopback:false},ancientsBrowserLab:true}),
  /ANCIENTS_LAB_LOOPBACK_ONLY/);
 const {origin}=await start({browser:true});
 const login=await fetch(origin+'/api/session',{
  method:'POST',headers:{'content-type':'application/json',origin,'x-ccw-request':'1'},
  body:JSON.stringify({handle:'alice',password:PASSWORD})
 });
 const cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await fetch(origin+`/api/matches/${matchId}/ancients-lab`,{headers:{cookie}})).status,404);
 const disabled=await fetch(origin+`/api/matches/${matchId}/ancients-lab/initialize`,{
  method:'POST',headers:{cookie,origin,'x-ccw-request':'1','content-type':'application/json'},
  body:'{}'
 });
 assert.equal(disabled.status,404);
 assert.equal(app.getStore(matchId).viewExperimentalSectionHistory({sessionToken:tokens.alice}).status,409);
}));

test('Ancients HTTP: own hand, ordered movement and SQLite replay through explicit opt-in',()=>fixture(async({app,matchId,start})=>{
 // This particular movement walkthrough needs ordinary section cards for
 // both players. Keep the production shuffle unchanged; fix only the fixture.
 const realCatalog=createAncientsScenarioCatalog();
 const deterministicCatalog={list:()=>realCatalog.list(),setup:id=>{
  const config=realCatalog.setup(id);
  if(!config)return null;
  config.cardInstances.sort((a,b)=>Number(/^ORDER_[234]_/.test(a.definitionId))-Number(/^ORDER_[234]_/.test(b.definitionId)));
  return {...config,randomIndex:n=>n-1};
 }};
 const {origin}=await start({browser:true,ancientsBrowserLab:true,ancientsScenarioCatalog:deterministicCatalog});
 const login=async(handle)=>{
  const res=await fetch(origin+'/api/session',{
   method:'POST',headers:{origin,'x-ccw-request':'1','content-type':'application/json'},
   body:JSON.stringify({handle,password:PASSWORD})
  });
  assert.equal(res.status,200);
  return res.headers.get('set-cookie').split(';')[0];
 };
 const cookies={alice:await login('alice'),bob:await login('bob'),outsider:await login('outsider')};
 const endpoint=`/api/matches/${matchId}/ancients-lab`;
 const request=async(cookie,resource='',method='GET',data=undefined)=>{
  const res=await fetch(origin+endpoint+resource,{
   method,headers:{cookie,...(data===undefined?{}:{
    origin,'x-ccw-request':'1','content-type':'application/json'
   })},
   ...(data===undefined?{}:{body:JSON.stringify(data)})
  });
  return {status:res.status,body:await res.json()};
 };
 assert.equal((await request(cookies.alice)).body.code,'SECTION_LAB_NOT_INITIALIZED');
 assert.equal((await request(cookies.outsider)).status,404);
 assert.equal((await request(cookies.bob,'/initialize','POST',{})).status,403);
 assert.equal((await request(cookies.bob,'/initialize','POST',{scenarioId:'open-field-v1'})).status,403);
 assert.equal((await request(cookies.alice,'/initialize','POST',{scenarioId:'__proto__'})).body.code,'UNKNOWN_SECTION_SCENARIO');
 const catalog=await fetch(origin+`/api/matches/${matchId}`,{headers:{cookie:cookies.alice}});
 assert.deepEqual((await catalog.json()).ancientsScenarios.map(s=>s.id),['demo-v1','open-field-v1','crossroads-v1']);
 assert.equal((await request(cookies.alice,'/initialize','POST',{
  board:{units:[]},actor:'A'
 })).status,400);
 const init=await request(cookies.alice,'/initialize','POST',{});
 assert.equal(init.status,201);
 const a=await request(cookies.alice),b=await request(cookies.bob);
 assert.equal(a.status,200);assert.equal(b.status,200);
 assert.equal(a.body.state.status,'LAB_ONLY');
 assert.equal(b.body.state.status,'LAB_ONLY');
 assert.equal(a.body.state.board.length,6);
 assert.equal(a.body.state.yourHand.length,3);
 assert.equal(b.body.state.yourHand.length,3);
 assert.equal(a.body.state.opponentCardCount,3);
 assert.equal(JSON.stringify(a.body).includes(b.body.state.yourHand[0].instanceId),false);
 assert.equal(JSON.stringify(b.body).includes(a.body.state.yourHand[0].instanceId),false);
 // A corrupted or miswired adapter must not leak the other side's private
 // projection, even if its match ID and laboratory status are correct.
 const wrong=await start({browser:true,ancientsBrowserLab:true,storeFactory:()=>({
  viewExperimentalSectionHistory:()=>({status:200,view:b.body.state})
 })});
 const rejected=await fetch(wrong.origin+endpoint,{headers:{cookie:cookies.alice}});
 assert.equal(rejected.status,503);
 assert.deepEqual(await rejected.json(),{code:'SERVICE_UNAVAILABLE'});
 assert.equal((await fetch(origin+`/api/matches/${matchId}`,{
  headers:{cookie:cookies.alice}
 })).status,409);
 const card=a.body.state.yourHand[0];
 const section=card.definitionId.split('_').at(-1);
 const unit=section==='LEFT'?'A_light':section==='CENTER'?'A_medium':'A_cavalry';
 const path=section==='LEFT'?[{col:3,row:7}]:
  section==='CENTER'?[{col:6,row:6}]:[{col:11,row:7}];
 const action=async(type,expectedRevision,key,fields)=>request(cookies.alice,
  '/commands','POST',{type,expectedRevision,idempotencyKey:key,...fields});
 assert.equal((await action('PLAY_SECTION_CARD',0,'browser_card_001',{
  cardInstanceId:card.instanceId
 })).status,200);
 assert.equal((await action('ASSIGN_SECTION_ORDERS',1,'browser_order_001',{
  unitIds:[unit],leaderIds:[]
 })).status,200);
 const ordered=(await request(cookies.alice)).body.state;
 assert.deepEqual(ordered.orderedUnitIds,[unit]);
 assert.deepEqual((await request(cookies.bob)).body.state.orderedUnitIds,[]);
 const command={
  type:unit==='A_cavalry'?'MOVE_SECTION_MOUNTED_PATH_V1':'MOVE_SECTION_FOOT_PATH_V2',
  expectedRevision:2,idempotencyKey:'browser_move_001',unitId:unit,path
 };
 const forged=await request(cookies.alice,'/commands','POST',{...command,actor:'A'});
 assert.equal(forged.status,400);
 const moved=await request(cookies.alice,'/commands','POST',command);
 assert.equal(moved.status,200);
 assert.equal(moved.body.code,'SECTION_LAB_APPLIED');
 const movedView=(await request(cookies.alice)).body.state;
 assert.equal(movedView.revision,3);
 assert.deepEqual(movedView.movedUnitIds,[unit]);
 const at=movedView.board.find(p=>p.id===unit);
 assert.deepEqual({col:at.col,row:at.row},path.at(-1));
 assert.equal((await request(cookies.alice,'/commands','POST',command)).body.code,'ALREADY_APPLIED');
 const rows=app.unsafeTestDatabase().prepare(
  'SELECT COUNT(*) n FROM game_events WHERE match_id=?'
 ).get(matchId);
 assert.equal(rows.n,3);
 assert.equal((await request(cookies.alice,'/commands','POST',{
  ...command,idempotencyKey:'browser_move_002',expectedRevision:3
 })).status,409);
 const finalB=(await request(cookies.bob)).body.state;
 assert.equal(finalB.board.find(p=>p.id===unit).col,at.col);
 assert.equal(JSON.stringify(finalB).includes(a.body.state.yourHand[1].instanceId),false);
 // The other player now gets a complete turn, with LEFT/RIGHT understood
 // from B's rotated viewpoint rather than from side A's board coordinates.
 const finished=await request(cookies.alice,'/commands','POST',{
  type:'END_EXPERIMENTAL_TURN',expectedRevision:3,
  idempotencyKey:'browser_finish_a_001'
 });
 assert.equal(finished.status,200);
 const turnB=(await request(cookies.bob)).body.state;
 assert.equal(turnB.turn,'B');
 assert.equal(turnB.revision,4);
 const bCard=turnB.yourHand[0];
 const bSection=bCard.definitionId.split('_').at(-1);
 const bUnit=bSection==='LEFT'?'B_cavalry':
  bSection==='RIGHT'?'B_heavy':'B_auxilia';
 const bPath=bSection==='LEFT'?[{col:9,row:1}]:
  bSection==='RIGHT'?[{col:3,row:1}]:[{col:6,row:2}];
 const bCommand=async(type,revision,key,fields)=>request(cookies.bob,
  '/commands','POST',{type,expectedRevision:revision,
   idempotencyKey:key,...fields});
 assert.equal((await bCommand('PLAY_SECTION_CARD',4,'browser_card_b_001',{
  cardInstanceId:bCard.instanceId
 })).status,200);
 assert.equal((await bCommand('ASSIGN_SECTION_ORDERS',5,'browser_order_b_001',{
  unitIds:[bUnit],leaderIds:[]
 })).status,200);
 const bType=bUnit==='B_cavalry'?'MOVE_SECTION_MOUNTED_PATH_V1':
  'MOVE_SECTION_FOOT_PATH_V2';
 assert.equal((await bCommand(bType,6,'browser_move_b_001',{
  unitId:bUnit,path:bPath
 })).status,200);
 const finalA=(await request(cookies.alice)).body.state;
 assert.equal(finalA.board.find(x=>x.id===bUnit).col,bPath[0].col);
 assert.deepEqual(finalA.orderedUnitIds,[]);
 assert.equal(JSON.stringify(finalA).includes(bCard.instanceId),false);
}));

test('Ancients HTTP SSE: opt-in stream notifies revision only; generic SSE remains denied',()=>fixture(async({app,matchId,start})=>{
 const {origin}=await start({browser:true,ancientsBrowserLab:true,revisionPollMs:30});
 const login=await fetch(origin+'/api/session',{
  method:'POST',
  headers:{'content-type':'application/json',origin,'x-ccw-request':'1'},
  body:JSON.stringify({handle:'alice',password:PASSWORD})
 });
 assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const token=cookie.split('=')[1];
 const store=app.getStore(matchId);
 const setupResult=store.initializeExperimentalSectionHistory({
  sessionToken:token,trustedSetup:setup()
 });
 assert.equal(setupResult.status,201);
 const generic=await fetch(origin+`/api/matches/${matchId}/updates`,{
  headers:{cookie}
 });
 assert.equal(generic.status,409);
 const controller=new AbortController();
 const endpoint=origin+`/api/matches/${matchId}/ancients-lab/updates`;
 const stream=await fetch(endpoint,{headers:{cookie},signal:controller.signal});
 assert.equal(stream.status,200);
 assert.match(stream.headers.get('content-type'),/text\/event-stream/);
 const reader=stream.body.getReader(),decoder=new TextDecoder();
 const readUntil=async pattern=>{
  let output='';
  for(let i=0;i<8&&!pattern.test(output);i++){
   const next=await Promise.race([
    reader.read(),
    new Promise((_,reject)=>setTimeout(()=>reject(Error('PRIVATE_SSE_TIMEOUT')),2500))
   ]);
   if(next.done)throw Error('PRIVATE_SSE_ENDED_UNEXPECTEDLY');
   output+=decoder.decode(next.value);
  }
  assert.match(output,pattern);
  return output;
 };
 try{
  const initial=await readUntil(/"gameRevision":0/);
  assert.match(initial,/event: revision/);
  assert.doesNotMatch(initial,/card_a_left|yourHand|privateJournal|unitId|path/);
  const own=store.viewExperimentalSectionHistory({sessionToken:token}).view.yourHand[0];
  const play=store.dispatchExperimentalSectionHistory({
   sessionToken:token,type:'PLAY_SECTION_CARD',expectedRevision:0,
   idempotencyKey:'private_sse_play_a_001',cardInstanceId:own.instanceId
  });
  assert.equal(play.status,200);
  const next=await readUntil(/"gameRevision":1/);
  assert.match(next,/event: revision/);
  assert.doesNotMatch(next,/card_a_left|yourHand|privateJournal|unitId|path/);
 }finally{
  controller.abort();
 }
}));

test('HTTP: imported scenario selected by owner survives a server without the catalog',()=>fixture(async({matchId,start})=>{
 const catalog=loadAncientsScenarioDirectory(fileURLToPath(new URL('../../scenarios/examples/',import.meta.url)));
 const {origin}=await start({browser:true,ancientsBrowserLab:true,ancientsScenarioCatalog:catalog});
 const login=async(handle)=>{
  const res=await fetch(origin+'/api/session',{method:'POST',
   headers:{origin,'x-ccw-request':'1','content-type':'application/json'},body:JSON.stringify({handle,password:PASSWORD})});
  assert.equal(res.status,200);return res.headers.get('set-cookie').split(';')[0];
 };
 const [alice,bob]=await Promise.all(['alice','bob'].map(login));
 const url='/api/matches/'+matchId,lab=url+'/ancients-lab';
 const view=async(base,cookie,path=lab)=>{const res=await fetch(base+path,{headers:{cookie}});assert.equal(res.status,200);return await res.json();};
 const init=async(cookie,body)=>fetch(origin+lab+'/initialize',{method:'POST',headers:{cookie,origin,'x-ccw-request':'1','content-type':'application/json'},body:JSON.stringify(body)});
 assert.ok((await view(origin,alice,url)).ancientsScenarios.some(s=>s.id==='ford-example-v1'));
 assert.equal((await view(origin,bob,url)).ancientsScenarios,undefined);
 assert.equal((await init(bob,{scenarioId:'ford-example-v1'})).status,403);
 assert.equal((await init(alice,{scenarioId:'ford-example-v1',board:{}})).status,400);
 assert.equal((await init(alice,{scenarioId:'ford-example-v1'})).status,201);
 const a=(await view(origin,alice)).state,b=(await view(origin,bob)).state;
 assert.equal(a.scenario.id,'ford-example-v1');assert.equal(b.scenario.id,a.scenario.id);
 assert.equal(a.yourHand.length,4);assert.equal(b.yourHand.length,5);assert.equal(a.turn,'B');
 assert.equal(a.victoryObjectives.length,2);
 assert.equal(JSON.stringify(a).includes(b.yourHand[0].instanceId),false);
 const second=await start({browser:true,ancientsBrowserLab:true});
 assert.deepEqual((await view(second.origin,alice)).state,a);
}));
