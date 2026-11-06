import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createAccessGateway} from './gateway.mjs';

const MATCH='123e4567-e89b-42d3-a456-426614174000';
const A='a'.repeat(40), B='b'.repeat(40), C='c'.repeat(40);
function fixture() {
  const active=new Map([[A,'alice'],[B,'bob'],[C,'carol']]);
  let invited=false, joined=false, revision=0, turn='A';
  const called=[];
  const identity={
    logIn:async({handle,password})=>password==='test-password' && ['alice','bob','carol'].includes(handle)
      ? {ok:true,token:[...active].find(([,h])=>h===handle)[0],expiresAt:99999} : {ok:false},
    resolveSession:token=>active.has(token)?{handle:active.get(token),userId:active.get(token)}:null,
    logOut:token=>{active.delete(token);return {ok:true};}
  };
  const invitations={
    createMatch:({sessionToken})=>active.get(sessionToken)==='alice'?{ok:true,matchId:MATCH}:{ok:false,code:'NOT_FOUND'},
    getMatch:({sessionToken,matchId})=>{
      const who=active.get(sessionToken);
      if(matchId!==MATCH || !['alice',...(joined?['bob']:[])].includes(who))return {ok:false,code:'NOT_FOUND'};
      return {ok:true,status:joined?'READY':'INVITING',players:[{handle:'alice',side:'A'},...(joined?[{handle:'bob',side:'B'}]:[])]};
    },
    issueInvitation:({sessionToken,matchId,targetHandle})=>active.get(sessionToken)==='alice' && matchId===MATCH && targetHandle==='bob' && !joined
      ? (invited=true,{ok:true,token:'invite-test-token'}) : {ok:false,code:'NOT_FOUND'},
    acceptInvitation:({sessionToken,invitationToken})=>active.get(sessionToken)==='bob' && invitationToken==='invite-test-token' && invited && !joined
      ? (joined=true,{ok:true,matchId:MATCH,side:'B'}) : {ok:false,code:'INVITATION_NOT_AVAILABLE'},
    rejectInvitation:({sessionToken,invitationToken})=>active.get(sessionToken)==='bob' && invitationToken==='invite-test-token' && invited
      ? (invited=false,{ok:true}) : {ok:false,code:'INVITATION_NOT_AVAILABLE'}
  };
  const hands={A:['SECRET_A'],B:['SECRET_B_1','SECRET_B_2']};
  const store={
    view:actor=>({matchId:MATCH,you:actor,revision,turn,board:[],yourHand:[...hands[actor]],opponentCardCount:hands[actor==='A'?'B':'A'].length}),
    publicEvents:()=>[{type:'SYNTHETIC',revision}],
    dispatch:async action=>{
      called.push(action);
      if(action.expectedRevision!==revision)return {status:409,code:'STALE_REVISION',view:store.view(action.actor)};
      if(action.actor!==turn)return {status:403,code:'NOT_YOUR_TURN',view:store.view(action.actor)};
      revision++;turn=turn==='A'?'B':'A';return {status:200,code:'APPLIED',view:store.view(action.actor)};
    }
  };
  return {identity,invitations,getStore:async()=>store,called};
}
async function withApi(callback,services=fixture()) {
  const server=createAccessGateway(services);
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(method,path,token,body,contentType='application/json')=>{
    const response=await fetch(base+path,{method,headers:{...(token?{authorization:`Bearer ${token}`}:{}), ...(body!==undefined?{'content-type':contentType}:{})},
      ...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json(),headers:response.headers};
  };
  try {await callback({request,services});}
  finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
async function createReady(request) {
  assert.equal((await request('POST','/api/matches',A)).status,201);
  const invitation=await request('POST',`/api/matches/${MATCH}/invitations`,A,{targetHandle:'bob'});
  assert.equal(invitation.status,201);
  assert.equal((await request('POST','/api/invitations/accept',B,{invitationToken:invitation.body.token})).status,200);
}

test('API: credenciales, no cache y errores genéricos',()=>withApi(async({request})=>{
  assert.equal((await request('GET','/health')).status,200);
  assert.equal((await request('GET',`/api/matches/${MATCH}`)).status,401);
  assert.equal((await request('POST','/api/session',null,{handle:'alice',password:'incorrect'})).status,401);
  const login=await request('POST','/api/session',null,{handle:'alice',password:'test-password'});
  assert.equal(login.body.token,A);assert.equal(login.headers.get('cache-control'),'no-store');
}));

test('API: lobby e invitación sin exponer manos a terceros',()=>withApi(async({request})=>{
  assert.equal((await request('POST','/api/matches',A)).status,201);
  const waiting=await request('GET',`/api/matches/${MATCH}`,A);
  assert.equal(waiting.body.status,'INVITING');assert.equal('state' in waiting.body,false);
  assert.equal((await request('GET',`/api/matches/${MATCH}`,C)).status,404);
  const invitation=await request('POST',`/api/matches/${MATCH}/invitations`,A,{targetHandle:'bob'});
  assert.equal((await request('POST','/api/invitations/accept',C,{invitationToken:invitation.body.token})).status,404);
  assert.equal((await request('POST','/api/invitations/accept',B,{invitationToken:invitation.body.token})).status,200);
  const a=await request('GET',`/api/matches/${MATCH}`,A),b=await request('GET',`/api/matches/${MATCH}`,B);
  assert.deepEqual(a.body.state.yourHand,['SECRET_A']);assert.deepEqual(b.body.state.yourHand,['SECRET_B_1','SECRET_B_2']);
  assert.equal(JSON.stringify(a.body).includes('SECRET_B'),false);
  assert.equal(JSON.stringify(b.body).includes('SECRET_A'),false);
}));

test('API: derivar bando desde sesión; ignorar actor falso',()=>withApi(async({request,services})=>{
  await createReady(request);
  const forged=await request('POST',`/api/matches/${MATCH}/commands`,B,{type:'pass_demo_turn',expectedRevision:0,actor:'A'});
  assert.equal(forged.status,403);assert.equal(services.called[0].actor,'B');
  const applied=await request('POST',`/api/matches/${MATCH}/commands`,A,{type:'pass_demo_turn',expectedRevision:0,actor:'B'});
  assert.equal(applied.status,200);assert.equal(services.called[1].actor,'A');
  const stale=await request('POST',`/api/matches/${MATCH}/commands`,B,{type:'pass_demo_turn',expectedRevision:0});
  assert.equal(stale.status,409);assert.equal(stale.body.state.you,'B');
  assert.equal(JSON.stringify(stale.body).includes('SECRET_A'),false);
}));

test('API: eventos y comandos inaccesibles a terceros',()=>withApi(async({request})=>{
  await createReady(request);
  assert.equal((await request('GET',`/api/matches/${MATCH}/events`,C)).status,404);
  assert.equal((await request('POST',`/api/matches/${MATCH}/commands`,C,{type:'pass_demo_turn'})).status,404);
  assert.equal((await request('POST',`/api/matches/${MATCH}/invitations`,C,{targetHandle:'bob'})).status,404);
}));

test('API: validaciones HTTP y tamaño máximo',()=>withApi(async({request})=>{
  assert.equal((await request('POST','/api/session',null,'{')).status,400);
  assert.equal((await request('POST','/api/session',null,{handle:'alice'},'text/plain')).status,415);
  assert.equal((await request('POST','/api/session',null,{blob:'x'.repeat(10000)})).status,413);
  assert.equal((await request('GET',`/api/matches/${MATCH}?debug=1`,A)).status,400);
}));

test('API: revocar sesión bloquea accesos posteriores',()=>withApi(async({request})=>{
  assert.equal((await request('DELETE','/api/session',B)).status,200);
  assert.equal((await request('POST','/api/matches',B)).status,401);
}));

test('API: error interno no devuelve excepción ni secretos',()=>{
  const services=fixture();services.getStore=async()=>{throw new Error('SECRET_DB_PATH');};
  return withApi(async({request})=>{
    await createReady(request);
    const result=await request('GET',`/api/matches/${MATCH}`,A);
    assert.equal(result.status,503);assert.deepEqual(result.body,{code:'SERVICE_UNAVAILABLE'});
  },services);
});
