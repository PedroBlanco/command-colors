import test from 'node:test';
import assert from 'node:assert/strict';
import {assessAncientsLineOfSight as see} from './line-of-sight.mjs';

const at=(col,row)=>({col,row});
const check=(from,to,extra={})=>see({from,to,...extra});
const terrain=(kind,...cells)=>cells.map(c=>({...c,kind}));

test('empty map allows sight between distinct hex centers without authorizing a shot',()=>{
  const result=check(at(1,4),at(8,4));
  assert.equal(result.status,'VISIBLE');
  assert.equal(result.attackAuthorized,false);
  assert.equal(result.needsFullLegalityCheck,true);
  assert.equal(result.rangedWeaponAndRangeChecked,false);
  assert.equal(Object.isFrozen(result),true);
  assert.equal(Object.isFrozen(result.obstructions),true);
});

test('units and lone leaders of either player block intervening clear terrain',()=>{
  for(const field of ['units','leaders']) {
    const result=check(at(2,4),at(6,4),{[field]:[at(4,4)]});
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.reason,'INTERVENING_OBSTRUCTION');
    assert.deepEqual(result.obstructions,[at(4,4)]);
  }
});

test('terrain in target or firing hex does not itself obstruct',()=>{
  assert.equal(check(at(2,4),at(4,4),{terrain:[...terrain('FOREST',at(2,4)),...terrain('FOREST',at(4,4))]}).status,'VISIBLE');
  assert.equal(check(at(2,4),at(4,4),{units:[at(2,4),at(4,4)]}).status,'VISIBLE');
});

test('forest blocks intervening path; broken ground does not',()=>{
  assert.equal(check(at(2,4),at(6,4),{terrain:terrain('FOREST',at(4,4))}).status,'BLOCKED');
  assert.equal(check(at(2,4),at(6,4),{terrain:terrain('BROKEN_GROUND',at(4,4))}).status,'VISIBLE');
});

test('intermediate hill blocks low-to-low, low-to-high and high-to-low',()=>{
  for(const endKinds of [[],terrain('HILL',at(6,4)),terrain('HILL',at(2,4))]) {
    const result=check(at(2,4),at(6,4),{terrain:[...terrain('HILL',at(4,4)),...endKinds]});
    assert.equal(result.status,'BLOCKED');
  }
});

test('continuous hill plateau between endpoints remains visible',()=>{
  const result=check(at(2,4),at(6,4),{
    terrain:terrain('HILL',at(2,4),at(3,4),at(4,4),at(5,4),at(6,4))
  });
  assert.equal(result.status,'VISIBLE');
});

test('hill plateau with a clear intervening gap blocks through a later hill',()=>{
  const result=check(at(2,4),at(6,4),{
    terrain:terrain('HILL',at(2,4),at(4,4),at(5,4),at(6,4))
  });
  assert.equal(result.status,'BLOCKED');
});

test('screening is symmetric for forest, units and hills',()=>{
  const a=at(2,4),b=at(6,4);
  for(const extra of [{}, {units:[at(4,4)]}, {terrain:terrain('FOREST',at(4,4))},
    {terrain:terrain('HILL',at(4,4))},
    {terrain:terrain('HILL',at(2,4),at(3,4),at(4,4),at(5,4),at(6,4))}]) {
    assert.equal(check(a,b,extra).status,check(b,a,extra).status);
  }
});

test('rejects invalid coordinates, overlapping markers and unsupported terrain kinds',()=>{
  for(const input of [{from:at(-1,0),to:at(3,3)},
    {from:at(0,0),to:at(0,0)},
    {from:at(0.5,0),to:at(4,4)},
    {from:at(1,1),to:at(3,1),terrain:[{col:2,row:1,kind:'MARSH'}]},
    {from:at(1,1),to:at(3,1),terrain:terrain('HILL',at(2,1),at(2,1))},
    {from:at(1,1),to:at(3,1),units:[at(2,1),at(2,1)]}])
    assert.throws(()=>see(input),/INVALID_LOS_/);
});

test('attached leader may share a unit hex; no mutation of board input',()=>{
  const unit=at(4,4),input={from:at(2,4),to:at(6,4),units:[unit],leaders:[unit]};
  assert.equal(see(input).status,'BLOCKED');
  assert.deepEqual(input.units,[unit]);
});

test('a line along a hex edge is blocked only when both sides obstruct at once',()=>{
  const from=at(2,4),to=at(6,4);
  // The first shared edge is (3,3) / (3,4). The second is (5,3) / (5,4).
  assert.equal(check(from,to,{units:[at(3,3)]}).status,'VISIBLE');
  assert.equal(check(from,to,{units:[at(3,4)]}).status,'VISIBLE');
  assert.equal(check(from,to,{units:[at(3,3),at(3,4)]}).status,'BLOCKED');
  assert.equal(check(from,to,{units:[at(3,3),at(3,4)]}).reason,'BOTH_SIDES_OF_EDGE');
  assert.equal(check(from,to,{units:[at(3,3),at(5,4)]}).status,'VISIBLE');
  assert.equal(check(to,from,{terrain:terrain('FOREST',at(3,3),at(3,4))}).status,'BLOCKED');
});

test('partial hill plateau can follow one side of a shared edge',()=>{
  assert.equal(check(at(2,4),at(6,4),{
    terrain:terrain('HILL',at(2,4),at(3,4),at(4,4),at(5,4),at(6,4))
  }).status,'VISIBLE');
});

test('a forest or occupant still blocks sight across an otherwise continuous hill',()=>{
  const hills=terrain('HILL',at(2,4),at(3,4),at(4,4),at(5,4),at(6,4));
  assert.equal(check(at(2,4),at(6,4),{terrain:hills,units:[at(4,4)]}).status,'BLOCKED');
  assert.equal(check(at(2,4),at(6,4),{terrain:[...hills.filter(h=>h.col!==4),...terrain('FOREST',at(4,4))]}).status,'BLOCKED');
});

test('opposite edge obstructions may combine different categories',()=>{
  assert.equal(check(at(2,4),at(6,4),{
    terrain:terrain('FOREST',at(3,3)),leaders:[at(3,4)]
  }).reason,'BOTH_SIDES_OF_EDGE');
});
