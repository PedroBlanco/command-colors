import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {createAccessGateway} from './gateway.mjs';

const ID='123e4567-e89b-42d3-a456-426614174000';
const alice='a'.repeat(43), bob='b'.repeat(43), outsider='c'.repeat(43);
function mockServices() {
  const sessions=new Map([[alice,'alice'],[bob,'bob'],[outsider,'carol']]);
  let hasMatch=false, joined=false, revision=0, current='A', tokenInvited='invitation-token-test';
  const identity={
    logIn:async({handle,password})=>password==='TEST_ONLY_PASSWORD' && ['alice','bob','carol'].includes(handle)
      ? {ok:true,token:[...sessions].find(([,v])=>v===handle)?.[0],expiresAt:Date.now()+10_000} : {ok:false},
    resolveSession:t=>sessions.has(t)?{handle:sessions.get(t),userId:sessions.get(t)}:null,
    logOut:t=>{sessions.delete(t);}
  };
  const invitations={
    createMatch:({sessionToken})=>sessions.get(sessionToken)==='alice'?(hasMatch=true,{ok:true,matchId:ID}):{ok:false,code:'NOT_FOUND'},
    getMatch:({sessionToken,matchId})=>{
      const who=sessions.get(sessionToken);
      if(matchId!==ID || !hasMatch || !['alice',...(joined?['bob']:[])].includes(who))return {ok:false,code:'NOT_FOUND'};
      return {ok:true,status:joined?'READY':'INVITING',players:[{handle:'alice',side:'A'},...(joined?[{handle:'bob',side:'B'}]:[])]};
    },
    issueInvitation:({sessionToken,matchId,targetHandle})=>sessions.get(sessionToken)==='alice' && matchId===ID && targetHandle==='bob'
       ? {ok:true,token:tokenInvited} : {ok:false,code:'NOT_FOUND'},
    acceptInvitation:({sessionToken,invitationToken})=>sessions.get(sessionToken)==='bob' && invitationToken===tokenInvited
       ? (joined=true,{ok:true,matchId:ID,side:'B'}) : {ok:false,code:'INVITATION_NOT_AVAILABLE'},
    rejectInvitation:()=>({ok:true})
  };
  const state=actor=>({matchId:ID,you:actor,revision,turn:current,board:[],yourHand:actor==='A'?['SECRET_A']:['SECRET_B'],opponentCardCount:1});
  const store={view:state,publicEvents:()=>[],dispatch:async({actor,expectedRevision})=>{
    if(expectedRevision!==revision)return {status:409,code:'STALE_REVISION',view:state(actor)};
    if(actor!==current)return {status:403,code:'NOT_YOUR_TURN',view:state(actor)};
    revision++;current=current==='A'?'B':'A';return {status:200,code:'APPLIED',view:state(actor)};
  }};
  return {identity,invitations,getStore:async()=>store};
}
async function harness(testBody) {
  const tmp=createServer();tmp.listen(0,'127.0.0.1');await once(tmp,'listening');
  const port=tmp.address().port;await new Promise(resolve=>tmp.close(resolve));
  const origin=`http://127.0.0.1:${port}`;
  const api=createAccessGateway({...mockServices(),browser:{origin,insecureLoopback:true}});
  api.listen(port,'127.0.0.1');await once(api,'listening');
  async function call(method,path,{cookie,body,headers={}}={}){
    const r=await fetch(origin+path,{method,headers:{...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    const type=r.headers.get('content-type')??'';
    return {status:r.status,headers:r.headers,json:type.includes('application/json')?await r.json():null,text:type.includes('application/json')?null:await r.text()};
  }
  async function login(user){
    const result=await call('POST','/api/session',{body:{handle:user,password:'TEST_ONLY_PASSWORD'},headers:{origin,'x-ccw-request':'1'}});
    assert.equal(result.status,200);
    return {cookie:result.headers.get('set-cookie').split(';')[0],result};
  }
  try {await testBody({call,login,origin});}
  finally {api.closeAllConnections();await new Promise(resolve=>api.close(resolve));}
}
const change=(origin)=>({origin,'x-ccw-request':'1'});

test('serves only the public browser UI, with restrictive CSP',()=>harness(async({call})=>{
  const html=await call('GET','/');
  assert.equal(html.status,200);assert.match(html.text,/Command & Colors/);
  assert.match(html.headers.get('content-security-policy'),/default-src 'none'/);
  const module=await call('GET','/browser-ui.mjs');
  assert.equal(module.status,200);assert.match(module.text,/same-origin/);
  const controls=await call('GET','/deck-controls.mjs');
  assert.equal(controls.status,200);assert.match(controls.text,/deckCommand/);
  assert.match(controls.headers.get('content-type'),/javascript/);
  assert.equal((await call('GET','/packages/sqlite-store/sqlite.mjs')).status,401);
}));

test('login returns HttpOnly cookie, never bearer token in JSON',()=>harness(async({call,origin})=>{
  const {cookie,result}=await (async()=>{
    const res=await call('POST','/api/session',{body:{handle:'alice',password:'TEST_ONLY_PASSWORD'},headers:change(origin)});
    return {cookie:res.headers.get('set-cookie')?.split(';')[0],result:res};
  })();
  assert.equal(result.status,200);assert.equal('token' in result.json,false);
  assert.match(result.headers.get('set-cookie'),/HttpOnly/);
  assert.match(result.headers.get('set-cookie'),/SameSite=Strict/);
  const self=await call('GET','/api/session',{cookie});
  assert.equal(self.status,200);assert.equal(self.json.handle,'alice');
  assert.equal((await call('GET','/api/session',{headers:{authorization:`Bearer ${alice}`}})).status,401);
}));

test('rejects missing or foreign Origin and missing CSRF custom header',()=>harness(async({call,origin})=>{
  for(const headers of [{},{origin},{origin:'https://evil.invalid','x-ccw-request':'1'},{origin,'x-ccw-request':'1','sec-fetch-site':'cross-site'}]){
    const res=await call('POST','/api/session',{body:{handle:'alice',password:'TEST_ONLY_PASSWORD'},headers});
    assert.equal(res.status,403);assert.equal(res.json.code,'ORIGIN_REJECTED');
  }
}));

test('authenticated mutating requests also reject CSRF and forged Authorization',()=>harness(async({call,login,origin})=>{
  const {cookie}=await login('alice');
  assert.equal((await call('POST','/api/matches',{cookie})).status,403);
  assert.equal((await call('POST','/api/matches',{cookie,headers:change(origin)})).status,201);
  assert.equal((await call('POST','/api/matches',{headers:{...change(origin),authorization:`Bearer ${alice}`}})).status,401);
}));

test('two users get private views; third user cannot inspect; actor from cookie',()=>harness(async({call,login,origin})=>{
  const a=(await login('alice')).cookie, b=(await login('bob')).cookie, c=(await login('carol')).cookie;
  const created=await call('POST','/api/matches',{cookie:a,headers:change(origin)});
  assert.equal(created.status,201);const id=created.json.matchId;
  assert.equal((await call('GET',`/api/matches/${id}`,{cookie:b})).status,404);
  const invitation=await call('POST',`/api/matches/${id}/invitations`,{cookie:a,headers:change(origin),body:{targetHandle:'bob'}});
  assert.equal(invitation.status,201);
  const accepted=await call('POST','/api/invitations/accept',{cookie:b,headers:change(origin),body:{invitationToken:invitation.json.token}});
  assert.equal(accepted.status,200);
  const va=await call('GET',`/api/matches/${id}`,{cookie:a});
  const vb=await call('GET',`/api/matches/${id}`,{cookie:b});
  assert.equal(va.status,200);assert.equal(vb.status,200);
  assert.equal(JSON.stringify(va.json).includes('SECRET_B'),false);
  assert.equal(JSON.stringify(vb.json).includes('SECRET_A'),false);
  assert.equal((await call('GET',`/api/matches/${id}`,{cookie:c})).status,404);
  const fake=await call('POST',`/api/matches/${id}/commands`,{cookie:b,headers:change(origin),body:{type:'pass_demo_turn',expectedRevision:0,actor:'A'}});
  assert.equal(fake.status,403);
  const real=await call('POST',`/api/matches/${id}/commands`,{cookie:a,headers:change(origin),body:{type:'pass_demo_turn',expectedRevision:0,actor:'B'}});
  assert.equal(real.status,200);
}));

test('logout clears cookie and revokes server-side session',()=>harness(async({call,login,origin})=>{
  const {cookie}=await login('alice');
  assert.equal((await call('DELETE','/api/session',{cookie,headers:change(origin)})).status,200);
  assert.equal((await call('GET','/api/session',{cookie})).status,401);
}));

test('legacy bearer gateway remains independent of browser-cookie mode',async()=>{
  const server=createAccessGateway(mockServices());
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const login=await fetch(base+'/api/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle:'alice',password:'TEST_ONLY_PASSWORD'})});
    assert.equal(login.status,200);
    assert.equal((await login.json()).token,alice);
    const result=await fetch(base+'/api/matches',{method:'POST',headers:{authorization:`Bearer ${alice}`}});
    assert.equal(result.status,201);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('HTTP rejects forged Host and Host-port even for health and HTML',()=>harness(async({call,origin})=>{
  const localHost=new URL(origin).host;
  assert.equal((await call('GET','/health',{headers:{host:localHost}})).status,200);
  // Node fetch() deliberately ignores a supplied Host header, so use node:http.
  const forged = (path, host) => new Promise((resolve, reject) => {
    const url = new URL(path,origin);
    const req = httpRequest(url,{headers:{Host:host}}, res => {
      res.resume(); res.once('end',()=>resolve(res.statusCode));
    });
    req.once('error',reject);req.end();
  });
  for(const badHost of ['evil.example','localhost:8788','127.0.0.1:65500']) {
    assert.equal(await forged('/',badHost),403);
    assert.equal(await forged('/health',badHost),403);
  }
}));
