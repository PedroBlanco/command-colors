import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {setTimeout as sleep} from 'node:timers/promises';
import {startRevisionStream} from './revision-stream.mjs';

const ID='123e4567-e89b-42d3-a456-426614174000';
const TOKEN='test-authenticated-session-token-001';

class TestResponse extends EventEmitter {
  status=0; headers=null; chunks=[]; ended=false;
  writeHead(status,headers){ this.status=status; this.headers=headers; }
  flushHeaders(){}
  write(chunk){ if(this.ended)throw new Error('WRITE_AFTER_CLOSE'); this.chunks.push(chunk); }
  end(){this.ended=true;this.emit('close');}
  get text(){return this.chunks.join('');}
}

function fixture({initial='ACTIVE',revision=2,ready=true}={}){
  const res=new TestResponse();
  let state=initial,alive=true,member=true,currentRevision=revision;
  const identity={resolveSession:()=>alive?{handle:'alice'}:null};
  const invitations={getMatch:()=>({ok:member,status:ready?'READY':'INVITING',revision:1,
    players:member?[{handle:'alice',side:'A'}]:[]})};
  const getStore=async()=>({view:()=>({matchId:ID,revision:currentRevision,status:state,
    yourHand:['SECRET_CARD_A'],privateJournal:{seed:'SECRET_SEED'}})});
  const stop=startRevisionStream({res,token:TOKEN,matchId:ID,
    identity,invitations,getStore,intervalMs:20});
  return {res,stop,setMode:x=>{state=x;},logout:()=>{alive=false;},removeMember:()=>{member=false;},
    setRevision:x=>{currentRevision=x;}};
}

async function until(predicate,ms=1200){
  for(let i=0;i<ms/10;i++){
    if(predicate())return;
    await sleep(10);
  }
  throw new Error('SSE_TEST_TIMEOUT');
}

const scrub=(f)=>{f.stop();if(!f.res.ended)f.res.end();};

test('SSE sends only public revision counters for a normal active match',async t=>{
  const f=fixture();t.after(()=>scrub(f));
  await until(()=>f.res.text.includes('event: revision'));
  assert.equal(f.res.status,200);
  assert.match(f.res.headers['content-type'],/text\/event-stream/);
  assert.match(f.res.text,/retry: 3000/);
  assert.match(f.res.text,/"lobbyRevision":1,"gameRevision":2/);
  assert.doesNotMatch(f.res.text,/SECRET|yourHand|privateJournal|cardInstanceId/);
  assert.equal(f.res.ended,false);
});

test('SSE closes immediately if match is already in internal lab mode',async t=>{
  const f=fixture({initial:'LAB_ONLY'});t.after(()=>scrub(f));
  await until(()=>f.res.ended);
  assert.equal(f.res.status,200);
  assert.match(f.res.text,/retry: 3000/);
  assert.doesNotMatch(f.res.text,/event: revision|gameRevision|SECRET/);
});

test('SSE opened before lab activation closes instead of publishing lab revisions',async t=>{
  const f=fixture();t.after(()=>scrub(f));
  await until(()=>f.res.text.includes('event: revision'));
  const previous=f.res.text;
  f.setMode('LAB_ONLY');f.setRevision(12);
  await until(()=>f.res.ended);
  assert.equal(f.res.text,previous);
  assert.doesNotMatch(f.res.text,/gameRevision":12|SECRET/);
});

test('SSE closes after a live session is revoked',async t=>{
  const f=fixture();t.after(()=>scrub(f));
  await until(()=>f.res.text.includes('event: revision'));
  f.logout();
  await until(()=>f.res.ended);
  assert.doesNotMatch(f.res.text,/SECRET/);
});

test('SSE closes after the user loses match membership',async t=>{
  const f=fixture();t.after(()=>scrub(f));
  await until(()=>f.res.text.includes('event: revision'));
  f.removeMember();
  await until(()=>f.res.ended);
  assert.doesNotMatch(f.res.text,/SECRET/);
});

test('SSE closes if revision becomes invalid rather than sending corrupted state',async t=>{
  const f=fixture();t.after(()=>scrub(f));
  await until(()=>f.res.text.includes('event: revision'));
  f.setRevision('wrong');
  await until(()=>f.res.ended);
  assert.doesNotMatch(f.res.text,/wrong|SECRET/);
});

test('SEC-001 SSE: prefer session-bound WAL view over stale actor-based view',async t=>{
  const res=new TestResponse(),calls=[];
  const stop=startRevisionStream({
    res,token:TOKEN,matchId:ID,intervalMs:20,
    identity:{resolveSession:()=>({handle:'alice'})},
    invitations:{getMatch:()=>({ok:true,status:'READY',revision:2,
      players:[{handle:'alice',side:'A'}]})},
    getStore:async()=>({
      view:()=>{throw new Error('ACTOR_READ_MUST_NOT_RUN');},
      viewForSession:({sessionToken})=>{
        calls.push(sessionToken);
        return {matchId:ID,revision:3,status:'ACTIVE'};
      }
    })
  });
  t.after(()=>{stop();if(!res.ended)res.end();});
  await until(()=>res.text.includes('event: revision'));
  assert.deepEqual(calls,[TOKEN]);
  assert.match(res.text,/"lobbyRevision":2,"gameRevision":3/);
  assert.doesNotMatch(res.text,/SECRET|yourHand/);
});

test('SEC-001 SSE: logout during async store lookup closes without revision emission',async t=>{
  const res=new TestResponse(),calls=[];
  let alive=true;
  const stop=startRevisionStream({
    res,token:TOKEN,matchId:ID,intervalMs:20,
    identity:{resolveSession:()=>alive?{handle:'alice'}:null},
    invitations:{getMatch:()=>({ok:true,status:'READY',revision:1,
      players:[{handle:'alice',side:'A'}]})},
    getStore:async()=>{
      alive=false;
      return {
        view:()=>{throw new Error('ACTOR_READ_MUST_NOT_RUN');},
        viewForSession:({sessionToken})=>{
          calls.push(sessionToken);
          return {status:401,code:'UNAUTHENTICATED'};
        }
      };
    }
  });
  t.after(()=>{stop();if(!res.ended)res.end();});
  await until(()=>res.ended);
  assert.deepEqual(calls,[TOKEN]);
  assert.doesNotMatch(res.text,/event: revision|gameRevision|SECRET/);
});
