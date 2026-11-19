import test from 'node:test';
import assert from 'node:assert/strict';
import {createRevisionRefresh} from './revision-refresh.mjs';

const flush = async () => {for (let i = 0; i < 8; i++) await Promise.resolve();};
function clock() {
  let serial = 0;
  const timers = new Map();
  return {
    timers,
    schedule(fn, ms) {const id=++serial;timers.set(id,{fn,ms});return id;},
    cancel(id) {timers.delete(id);},
    fire() {const first=timers.entries().next().value;assert.ok(first);timers.delete(first[0]);first[1].fn();return first[1].ms;}
  };
}
const deferred = () => {let resolve, reject;const promise=new Promise((ok,fail)=>{resolve=ok;reject=fail;});return {promise,resolve,reject};};

test('one notice triggers one inspection; duplicates are ignored after acknowledgement',async()=>{
  const seen=[], inbox=createRevisionRefresh({inspect:async()=>{seen.push('GET')}});
  assert.equal(inbox.notice('0:null'),true);
  assert.equal(inbox.notice('0:null'),false);
  await flush();
  assert.deepEqual(seen,['GET']);
  assert.equal(inbox.notice('0:null'),false);
});

test('newer revision queued during inspection is inspected next',async()=>{
  const wait=deferred(),seen=[];
  const inbox=createRevisionRefresh({inspect:()=>{seen.push('GET');return seen.length===1?wait.promise:true;}});
  inbox.notice('1:1');await flush();
  inbox.notice('1:2');await flush();
  assert.equal(seen.length,1);
  wait.resolve(true);await flush();
  assert.equal(seen.length,2);
});

test('temporary HTTP rejection keeps the revision pending and retries',async()=>{
  const time=clock(), seen=[], errors=[];
  const inbox=createRevisionRefresh({inspect:async()=>{seen.push('GET');if(seen.length===1)throw Error('HTTP_503');return true;},onError:e=>errors.push(e.message),schedule:time.schedule,cancel:time.cancel});
  inbox.notice('1:3');await flush();
  assert.deepEqual(errors,['HTTP_503']);assert.equal(time.timers.size,1);
  assert.equal(time.fire(),3000);await flush();
  assert.equal(seen.length,2);assert.equal(time.timers.size,0);
  assert.equal(inbox.notice('1:3'),false);
});

test('an inspection returning false also retries without acknowledging',async()=>{
  const time=clock(),seen=[];
  const inbox=createRevisionRefresh({inspect:async()=>{seen.push(1);return seen.length===1?false:true;},schedule:time.schedule,cancel:time.cancel,retryMs:25});
  inbox.notice('2:7');await flush();
  assert.equal(time.fire(),25);await flush();
  assert.equal(seen.length,2);assert.equal(inbox.notice('2:7'),false);
});

test('exponential retry is capped to avoid a hot failure loop',async()=>{
  const time=clock(),inbox=createRevisionRefresh({inspect:async()=>{throw Error('offline');},schedule:time.schedule,cancel:time.cancel,retryMs:100});
  inbox.notice('1:0');await flush();
  const intervals=[];
  for(let i=0;i<7;i++){intervals.push(time.fire());await flush();}
  assert.deepEqual(intervals,[100,200,400,800,1600,1600,1600]);
});

test('newer notice cancels old backoff and runs immediately',async()=>{
  const time=clock(),seen=[];
  const inbox=createRevisionRefresh({inspect:async()=>{seen.push(1);if(seen.length===1)throw Error('fail');return true;},schedule:time.schedule,cancel:time.cancel});
  inbox.notice('3:1');await flush();assert.equal(time.timers.size,1);
  inbox.notice('3:2');await flush();
  assert.equal(time.timers.size,0);assert.equal(seen.length,2);
});

test('hidden browser defers inspection and resumes with latest notice',async()=>{
  const seen=[],inbox=createRevisionRefresh({inspect:async()=>seen.push('GET')});
  inbox.setPaused(true);inbox.notice('0:null');inbox.notice('1:1');await flush();
  assert.deepEqual(seen,[]);
  inbox.setPaused(false);await flush();assert.equal(seen.length,1);
});

test('pausing cancels retry timer; resuming retries retained revision',async()=>{
  const time=clock(),seen=[],inbox=createRevisionRefresh({inspect:async()=>{seen.push(1);return seen.length!==1;},schedule:time.schedule,cancel:time.cancel});
  inbox.notice('1:0');await flush();assert.equal(time.timers.size,1);
  inbox.setPaused(true);assert.equal(time.timers.size,0);
  inbox.setPaused(false);await flush();assert.equal(seen.length,2);
});

test('reset invalidates in-flight response from another match or identity',async()=>{
  const old=deferred(),seen=[];
  const inbox=createRevisionRefresh({inspect:()=>{seen.push(1);return seen.length===1?old.promise:true;}});
  inbox.notice('1:4');await flush();
  inbox.reset();inbox.notice('0:null');await flush();
  old.resolve(true);await flush();
  assert.equal(seen.length,2);assert.equal(inbox.notice('0:null'),false);
});

test('reset cancels pending timer, so no old-session retry can fire',async()=>{
  const time=clock(),inbox=createRevisionRefresh({inspect:async()=>{throw Error('offline');},schedule:time.schedule,cancel:time.cancel});
  inbox.notice('9:9');await flush();assert.equal(time.timers.size,1);
  inbox.reset();assert.equal(time.timers.size,0);
});

test('out of order and malformed notices cannot roll back the displayed revision',async()=>{
  const calls=[],inbox=createRevisionRefresh({inspect:async()=>calls.push(1)});
  for(const x of [undefined,null,'',':','2:NaN','-1:0','0:-1','9007199254740993:1']) assert.equal(inbox.notice(x),false);
  assert.equal(inbox.notice('2:3'),true);await flush();
  for(const x of ['1:99','2:2','2:3','2:null']) assert.equal(inbox.notice(x),false);
  assert.equal(calls.length,1);
  assert.equal(inbox.notice('3:0'),true);await flush();assert.equal(calls.length,2);
});

test('invalid configuration fails closed',()=>{
  for(const options of [{}, {inspect:42}, {inspect:()=>{},retryMs:0},{inspect:()=>{},retryMs:60001}]) {
    assert.throws(()=>createRevisionRefresh(options),/INVALID_REVISION_REFRESH_OPTIONS/);
  }
});

test('hiding while an in-flight inspection returns false defers without a timer',async()=>{
  const wait=deferred(),time=clock(),seen=[];
  const inbox=createRevisionRefresh({inspect:()=>{seen.push('GET');return seen.length===1?wait.promise:true;},schedule:time.schedule,cancel:time.cancel});
  inbox.notice('4:1');await flush();
  inbox.setPaused(true);wait.resolve(false);await flush();
  assert.equal(time.timers.size,0,'hidden tab must not start a delayed retry');
  assert.equal(seen.length,1);
  inbox.setPaused(false);await flush();
  assert.equal(seen.length,2,'visible tab retries queued revision immediately');
  assert.equal(inbox.notice('4:1'),false);
});

test('hiding while an in-flight inspection rejects preserves revision without hidden retries',async()=>{
  const wait=deferred(),time=clock(),seen=[],errors=[];
  const inbox=createRevisionRefresh({inspect:()=>{seen.push('GET');return seen.length===1?wait.promise:true;},schedule:time.schedule,cancel:time.cancel,onError:e=>errors.push(e.message)});
  inbox.notice('4:2');await flush();
  inbox.setPaused(true);wait.reject(new Error('HTTP_503'));await flush();
  assert.deepEqual(errors,['HTTP_503']);
  assert.equal(time.timers.size,0);
  inbox.setPaused(false);await flush();
  assert.equal(seen.length,2);
  assert.equal(inbox.notice('4:2'),false);
});
