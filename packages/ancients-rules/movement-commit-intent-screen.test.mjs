import test from 'node:test';
import assert from 'node:assert/strict';
import {screenAncientsMovementCommitIntent as screen} from './movement-commit-intent-screen.mjs';

const origin=()=>({
  sessionToken:'a'.repeat(64),expectedRevision:3,
  idempotencyKey:'physicalMove-001',kind:'UNIT',pieceId:'front',
  path:[{col:2,row:4},{col:3,row:4}]
});
const denied=result=>{
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.code,'INVALID_MOVEMENT_INTENT');
  assert.equal(result.intent,null);
  assert.equal(result.movementAuthorized,false);
  assert.equal(result.attackAuthorized,false);
  assert.equal(result.stateChanged,false);
};

test('a screened request is a deeply frozen untrusted intent, never a move',()=>{
  const request=origin(),before=structuredClone(request);
  const result=screen(request);
  assert.equal(result.status,'INTENT_SHAPE_VALID');
  assert.equal(result.code,null);
  assert.equal(result.movementAuthorized,false);
  assert.equal(result.attackAuthorized,false);
  assert.equal(result.stateChanged,false);
  assert.equal(result.needsFullLegalityCheck,true);
  assert.equal(result.intent.expectedRevision,3);
  assert.equal(result.intent.pieceId,'front');
  assert.equal(Object.isFrozen(result),true);
  assert.equal(Object.isFrozen(result.intent),true);
  assert.equal(Object.isFrozen(result.intent.path),true);
  assert.equal(Object.isFrozen(result.intent.path[0]),true);
  assert.deepEqual(request,before);
  assert.notStrictEqual(result.intent.path,request.path);
  assert.equal(JSON.stringify(result).includes(request.sessionToken),false);
  assert.equal(Object.hasOwn(result,'actor'),false);
  assert.equal(Object.hasOwn(result.intent,'sessionToken'),false);
});

test('never accept actor, match, terrain, hands, card or precomputed decisions',()=>{
  for(const extra of [
    {actor:'A'}, {matchId:'match'}, {board:{}}, {terrain:[]},
    {hand:[]}, {cardInstanceId:'Card1'}, {journal:{}},
    {contextDigest:'a'.repeat(64)}, {movementAuthorized:true},
    {code:'APPLIED'},{unitTypes:{}}
  ]) denied(screen({...origin(),...extra}));
});

test('only ordinary UNIT or LEADER identity, no reserved keys or extra fields',()=>{
  assert.equal(screen({...origin(),kind:'LEADER',pieceId:'commander_1'}).status,
    'INTENT_SHAPE_VALID');
  for(const patch of [
    {kind:'SQUAD'}, {kind:'unit'}, {kind:null}, {pieceId:'__proto__'},
    {pieceId:'1bad'}, {pieceId:'bad.path'}, {pieceId:'x'.repeat(65)}
  ]) denied(screen({...origin(),...patch}));
});

test('credential is syntactically bounded, NEVER authenticated by this function',()=>{
  for(const sessionToken of ['', 'a'.repeat(15),'x'.repeat(257),null,123])
    denied(screen({...origin(),sessionToken}));
  const different=screen({...origin(),sessionToken:'b'.repeat(64)});
  assert.equal(different.status,'INTENT_SHAPE_VALID');
  assert.deepEqual(different.intent,screen(origin()).intent);
});

test('revision and idempotency key use bounded strict existing contracts',()=>{
  for(const expectedRevision of [-1,1.5,Number.MAX_SAFE_INTEGER+1,'3',null])
    denied(screen({...origin(),expectedRevision}));
  for(const idempotencyKey of ['short','x'.repeat(81),null,'bad key','ábc-defghi'])
    denied(screen({...origin(),idempotencyKey}));
  assert.equal(screen({...origin(),expectedRevision:0}).status,'INTENT_SHAPE_VALID');
});

test('only in-bounds integer hex coordinates and a bounded nonempty path',()=>{
  for(const path of [
    [],Array.from({length:33},()=>({col:2,row:4})),
    [{col:-1,row:2}],[{col:13,row:2}],[{col:2,row:9}],
    [{col:2.5,row:3}],[{col:2,row:'3'}],
    [{col:1,row:2,actor:'B'}],[null],
    [{col:1,row:2},'2,3']
  ]) denied(screen({...origin(),path}));
});

test('shape screening never claims adjacency, orders or rule legality',()=>{
  const input={...origin(),path:[{col:12,row:8},{col:0,row:0}]};
  const result=screen(input);
  assert.equal(result.status,'INTENT_SHAPE_VALID');
  assert.equal(result.movementAuthorized,false);
  assert.equal(result.needsFullLegalityCheck,true);
});

test('rejects sparse paths and extra array properties or symbols',()=>{
  const sparse=new Array(2);
  sparse[0]={col:1,row:2};
  denied(screen({...origin(),path:sparse}));
  const extra=origin();
  extra.path.actor='B';
  denied(screen(extra));
  const symbol=origin();
  symbol.path[Symbol('private')]='hidden';
  denied(screen(symbol));
});

test('prototype pollution, inherited fields and symbol-valued records are rejected',()=>{
  const inherited=Object.create(origin());
  denied(screen(inherited));
  const nullProto=Object.assign(Object.create(null),origin());
  denied(screen(nullProto));
  const request=origin();
  request[Symbol('new')]=true;
  denied(screen(request));
  const coord=origin();
  coord.path[0]=Object.assign(Object.create(null),coord.path[0]);
  denied(screen(coord));
});

test('accessor side effects are rejected without reading the getter',()=>{
  const input=origin();let calls=0;
  Object.defineProperty(input,'pieceId',{enumerable:true,get(){
    calls++;throw Error('should never execute');
  }});
  denied(screen(input));
  assert.equal(calls,0);
  const another=origin();
  Object.defineProperty(another.path[0],'col',{enumerable:true,get(){
    calls++;throw Error('should never execute');
  }});
  denied(screen(another));
  assert.equal(calls,0);
});

test('unexpected hostile proxies are refused, not allowed to authorize',()=>{
  const input=new Proxy(origin(),{ownKeys(){throw Error('hostile')}});
  denied(screen(input));
});

test('repeated identical serializable envelopes normalize identically',()=>{
  const input=origin();
  const one=screen(input),two=screen(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(one,two);
  assert.equal(one.intent.path[0].col,2);
  input.path[0].col=12;
  assert.equal(one.intent.path[0].col,2);
  assert.equal(two.intent.path[0].col,2);
});

test('returned shape cannot be promoted by modifying nested fields',()=>{
  const result=screen(origin());
  assert.throws(()=>{result.movementAuthorized=true},TypeError);
  assert.throws(()=>{result.intent.pieceId='foe'},TypeError);
  assert.throws(()=>{result.intent.path[0].row=7},TypeError);
});


test('descriptor snapshot ignores hostile top-level get traps and never accesses credentials twice',()=>{
  const raw=origin(),reads=[];
  const proxy=new Proxy(raw,{
    get(target,key,receiver){
      reads.push(key);
      if(key==='kind')return 'ATTACK';
      if(key==='expectedRevision')return -123;
      if(key==='pieceId')return 'ENEMY_SECRET';
      if(key==='sessionToken')throw Error('GET_TOKEN_MUST_NOT_RUN');
      return Reflect.get(target,key,receiver);
    }
  });
  const result=screen(proxy);
  assert.equal(result.status,'INTENT_SHAPE_VALID');
  assert.deepEqual(result.intent,screen(raw).intent);
  assert.deepEqual(reads,[]);
  assert.equal(JSON.stringify(result).includes(raw.sessionToken),false);
});

test('descriptor snapshot ignores hostile array and coordinate getters, not changing approved data',()=>{
  const input=origin(),reads=[];
  input.path=new Proxy(input.path,{
    get(target,key,receiver){
      reads.push('path:'+String(key));
      if(key==='length')return 999;
      if(key==='map')throw Error('UNTRUSTED_MAP_MUST_NOT_RUN');
      return Reflect.get(target,key,receiver);
    }
  });
  input.path[0]=new Proxy(input.path[0],{
    get(target,key,receiver){
      reads.push('cell:'+String(key));
      if(key==='col')return 99;
      if(key==='row')throw Error('UNTRUSTED_ROW_GET_MUST_NOT_RUN');
      return Reflect.get(target,key,receiver);
    }
  });
  const response=screen(input);
  assert.equal(response.status,'INTENT_SHAPE_VALID');
  assert.deepEqual(response.intent.path,[{col:2,row:4},{col:3,row:4}]);
  assert.deepEqual(reads,[]);
});

test('descriptor snapshot does not change after the original request is mutated',()=>{
  const input=origin();
  const result=screen(input);
  assert.equal(result.status,'INTENT_SHAPE_VALID');
  input.expectedRevision=200;
  input.pieceId='attacker';
  input.path[0].col=11;
  input.path.push({col:12,row:7});
  assert.deepEqual(result.intent,screen(origin()).intent);
  assert.equal(Object.isFrozen(result.intent.path[1]),true);
});

test('proxy changing descriptor after first snapshot cannot smuggle a new move',()=>{
  const input=origin(),reads=[];
  const proxy=new Proxy(input,{
    getOwnPropertyDescriptor(target,key){
      reads.push(key);
      const desc=Reflect.getOwnPropertyDescriptor(target,key);
      if(key==='path') {
        // Mutate source AFTER copying the descriptor value; even this path
        // can only be accepted if its final captured cells are valid.
        target.pieceId='mutated_after_snapshot';
      }
      return desc;
    },
    get(){throw Error('SOURCE_GET_MUST_NEVER_RUN');}
  });
  const result=screen(proxy);
  assert.equal(result.status,'INTENT_SHAPE_VALID');
  assert.equal(result.intent.pieceId,'front');
  assert.deepEqual(result.intent.path,[{col:2,row:4},{col:3,row:4}]);
  assert.equal(reads.includes('pieceId'),true);
  assert.equal(input.pieceId,'mutated_after_snapshot');
});
