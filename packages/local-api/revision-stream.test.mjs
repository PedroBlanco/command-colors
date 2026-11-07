import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter, once} from 'node:events';
import {createServer as createPortProbe} from 'node:net';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openSqliteComposition} from '../sqlite-store/sqlite.mjs';
import {createAccessGateway} from './gateway.mjs';

const PASSWORD = 'synthetic-only-sse-tests-no-personal-data';
const mutating = origin => ({origin, 'x-ccw-request':'1'});

async function freePort() {
  const probe = createPortProbe();
  probe.listen(0, '127.0.0.1');
  await once(probe,'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

async function fixture(run, {clock = Date.now, sessionTtlMs} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ccw-sse-'));
  const db = openSqliteComposition({file:join(dir,'test.sqlite'),clock,...(sessionTtlMs?{sessionTtlMs}:{})});
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = createAccessGateway({...db,browser:{origin,insecureLoopback:true},revisionPollMs:40});
  try {
    for (const handle of ['alice','bob','carol']) assert.equal((await db.identity.provisionAccount({handle,password:PASSWORD})).ok,true);
    server.listen(port,'127.0.0.1'); await once(server,'listening');
    const call=async(method,path,{cookie,body,headers={}}={})=>{
      const response=await fetch(origin+path,{method,headers:{...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
      return {status:response.status,body:await response.json(),headers:response.headers};
    };
    const login=async(handle)=>{
      const result=await call('POST','/api/session',{body:{handle,password:PASSWORD},headers:mutating(origin)});
      assert.equal(result.status,200);return result.headers.get('set-cookie').split(';')[0];
    };
    const eventStreams=[];
    async function listen(id,cookie) {
      const abort=new AbortController();
      const response=await fetch(`${origin}/api/matches/${id}/updates`,{headers:cookie?{cookie}:{},signal:abort.signal});
      if(response.status!==200){abort.abort();return {status:response.status};}
      const seen=[],emitter=new EventEmitter(),reader=response.body.getReader();
      const decoding=new TextDecoder();let buffer='';
      const pending=(async()=>{
        try {
          while(true){
            const {done,value}=await reader.read();if(done)break;
            buffer+=decoding.decode(value,{stream:true});
            let end;
            while((end=buffer.indexOf('\n\n'))!==-1){
              const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);
              if(!frame.includes('event: revision'))continue;
              const raw=frame.split('\n').find(s=>s.startsWith('data: '));
              const idLine=frame.split('\n').find(s=>s.startsWith('id: '));
              const item={...JSON.parse(raw.slice(6)),eventId:idLine?.slice(4),raw:frame};
              seen.push(item);emitter.emit('revision',item);
            }
          }
        }catch(error){if(!abort.signal.aborted)emitter.emit('failure',error)}
        finally{emitter.emit('closed')}
      })();
      const stream={status:response.status,seen,closed:false,close:()=>{abort.abort();stream.closed=true;},async waitFor(predicate,timeout=2500){
        const known=seen.find(predicate);if(known)return known;
        return await new Promise((resolve,reject)=>{
          const timeoutId=setTimeout(()=>{cleanup();reject(new Error('SSE_TIMEOUT'))},timeout);
          function cleanup(){clearTimeout(timeoutId);emitter.off('revision',onItem);emitter.off('failure',onError);emitter.off('closed',onClosed)}
          function onItem(value){if(predicate(value)){cleanup();resolve(value)}}
          function onError(err){cleanup();reject(err)}
          function onClosed(){cleanup();reject(new Error('SSE_CLOSED'))}
          emitter.on('revision',onItem);emitter.on('failure',onError);emitter.on('closed',onClosed);
        });
      },async waitClosed(timeout=2500){
        return await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>reject(new Error('STREAM_NOT_CLOSED')),timeout);
          pending.then(()=>{clearTimeout(timer);resolve()},err=>{clearTimeout(timer);reject(err)});
        });
      }};
      eventStreams.push(stream);
      return stream;
    }
    await run({origin,call,login,listen,db});
    for(const s of eventStreams)s.close();
  }finally{
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();
    await rm(dir,{recursive:true,force:true});
  }
}

async function invite({call,origin},a,b){
  const created=await call('POST','/api/matches',{cookie:a,headers:mutating(origin)});
  assert.equal(created.status,201);const id=created.body.matchId;
  const issued=await call('POST',`/api/matches/${id}/invitations`,{cookie:a,body:{targetHandle:'bob'},headers:mutating(origin)});
  assert.equal(issued.status,201);
  const accept=async()=>{
    const accepted=await call('POST','/api/invitations/accept',{cookie:b,body:{invitationToken:issued.body.token},headers:mutating(origin)});
    assert.equal(accepted.status,200);
  };
  return {id,accept};
}

test('SSE private: lobby, join and commands send ONLY revision counters',()=>fixture(async ctx=>{
  const a=await ctx.login('alice'),b=await ctx.login('bob'),c=await ctx.login('carol');
  const {id,accept}=await invite(ctx,a,b);
  const unknown=await ctx.listen(id,c);
  assert.equal(unknown.status,404);
  const owner=await ctx.listen(id,a);
  assert.equal(owner.status,200);
  const initial=await owner.waitFor(e=>e.lobbyRevision===0);
  assert.equal(initial.gameRevision,null);
  await accept();
  const joined=await owner.waitFor(e=>e.lobbyRevision===1 && e.gameRevision===0);
  const guest=await ctx.listen(id,b);
  const guestInitial=await guest.waitFor(e=>e.lobbyRevision===1 && e.gameRevision===0);
  assert.equal(guestInitial.eventId,'1:0');
  const command=await ctx.call('POST',`/api/matches/${id}/commands`,{cookie:a,headers:mutating(ctx.origin),body:{type:'pass_demo_turn',expectedRevision:0,idempotencyKey:'sse_command_001'}});
  assert.equal(command.status,200);
  const notified=await guest.waitFor(e=>e.gameRevision===1);
  assert.equal(notified.eventId,'1:1');
  assert.equal((await owner.waitFor(e=>e.gameRevision===1)).gameRevision,1);
  assert.equal(JSON.stringify([initial,joined,notified,guestInitial]).includes('PRIVATE_'),false);
  assert.equal(JSON.stringify(guest.seen).includes('HIDDEN_FUTURE_CARD'),false);
  guest.close();owner.close();
}));

test('SSE reconnect: first event is the current durable revision; no repeated command',()=>fixture(async ctx=>{
  const a=await ctx.login('alice'),b=await ctx.login('bob');
  const {id,accept}=await invite(ctx,a,b);await accept();
  const first=await ctx.listen(id,b);await first.waitFor(e=>e.gameRevision===0);first.close();
  for(const [cookie,rev,key] of [[a,0,'command_first01'],[b,1,'command_second2']]){
    const applied=await ctx.call('POST',`/api/matches/${id}/commands`,{cookie,headers:mutating(ctx.origin),body:{type:'pass_demo_turn',expectedRevision:rev,idempotencyKey:key}});
    assert.equal(applied.status,200);
  }
  const reconnect=await ctx.listen(id,b);
  const current=await reconnect.waitFor(e=>e.gameRevision===2);
  assert.equal(current.eventId,'1:2');
  assert.equal((await ctx.call('GET',`/api/matches/${id}/events`,{cookie:b})).body.events.length,2);
  assert.equal(JSON.stringify(current).includes('PRIVATE_'),false);
  reconnect.close();
}));

test('SSE expires live session and closes the stream on the next poll',()=>{
  let now=1000;
  return fixture(async ctx=>{
    const a=await ctx.login('alice'),b=await ctx.login('bob');
    const {id,accept}=await invite(ctx,a,b);await accept();
    const live=await ctx.listen(id,a);await live.waitFor(e=>e.gameRevision===0);
    now+=1500;
    await live.waitClosed();
  },{clock:()=>now,sessionTtlMs:1500});
});


test('SSE stream cap: 17th subscription rejected; closing one frees capacity',()=>fixture(async ctx=>{
  const a=await ctx.login('alice'),b=await ctx.login('bob');
  const {id,accept}=await invite(ctx,a,b);await accept();
  const open=[];
  for(let i=0;i<16;i++){
    const stream=await ctx.listen(id,a);
    assert.equal(stream.status,200);
    await stream.waitFor(e=>e.gameRevision===0);
    open.push(stream);
  }
  const overflow=await ctx.listen(id,b);
  assert.equal(overflow.status,429);
  open[0].close();
  await new Promise(resolve=>setTimeout(resolve,80));
  const again=await ctx.listen(id,b);
  assert.equal(again.status,200);
  await again.waitFor(e=>e.gameRevision===0);
  for(const stream of open)stream.close();
  again.close();
}));
