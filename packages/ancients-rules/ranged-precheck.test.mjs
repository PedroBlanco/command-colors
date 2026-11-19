import test from 'node:test';
import assert from 'node:assert/strict';
import {precheckAncientsRangedAttack as assess} from './ranged-precheck.mjs';
const at=(col,row)=>({col,row});
const unit=(id,side,type,col,row)=>({id,side,type,col,row});
const shooter=unit('shooter','A','LIGHT_BOW_INFANTRY',2,4);
const target=unit('target','B','HEAVY_INFANTRY',5,4);
const state=opts=>({units:[shooter,target],attackerId:'shooter',targetId:'target',movedSteps:0,...opts});
const check=opts=>assess(state(opts));

test('normal shot with trusted board is a candidate with two dice, never an authorization',()=>{
  const r=check();
  assert.equal(r.status,'CANDIDATE');
  assert.equal(r.distance,3);
  assert.equal(r.range,3);
  assert.equal(r.baseDice,2);
  assert.equal(r.diceAfterTerrain,2);
  assert.equal(r.lineOfSightChecked,true);
  assert.equal(r.ordersAndPhaseChecked,false);
  assert.equal(r.attackAuthorized,false);
  assert.equal(Object.isFrozen(r),true);
  assert.equal(Object.isFrozen(r.profile),true);
});

test('moving one hex yields one die before/after terrain cap',()=>{
  const r=check({movedSteps:1});
  assert.equal(r.status,'CANDIDATE');
  assert.equal(r.diceAfterTerrain,1);
});

test('forest target reduces stationary fire to one die',()=>{
  const r=check({terrain:[{...target,kind:'FOREST'}]});
  assert.equal(r.status,'CANDIDATE');
  assert.equal(r.baseDice,2);
  assert.equal(r.terrainDice.maxDice,1);
  assert.equal(r.diceAfterTerrain,1);
});

test('forest at firing hex does not impose ranged dice cap',()=>{
  const r=check({terrain:[{...shooter,kind:'FOREST'}]});
  assert.equal(r.status,'CANDIDATE');
  assert.equal(r.diceAfterTerrain,2);
});

test('intervening forest blocks LOS even when unit has range',()=>{
  const r=check({terrain:[{col:4,row:4,kind:'FOREST'}]});
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.reason,'LINE_OF_SIGHT_BLOCKED');
  assert.equal(r.los.status,'BLOCKED');
  assert.equal(r.attackAuthorized,false);
});

test('intervening friendly and enemy units block line of sight',()=>{
  for(const side of ['A','B']){
    const r=check({units:[shooter,target,unit('block',side,'LIGHT_INFANTRY',4,4)]});
    assert.equal(r.reason,'LINE_OF_SIGHT_BLOCKED');
  }
});

test('enemy adjacent to attacker prevents shooting at a different nonadjacent target',()=>{
  const r=check({units:[shooter,target,unit('near','B','MEDIUM_INFANTRY',3,4)]});
  assert.equal(r.reason,'ADJACENT_ENEMY_PREVENTS_RANGED');
});

test('friendly unit adjacent to shooter is not an adjacency prohibition',()=>{
  const r=check({units:[shooter,target,unit('near','A','MEDIUM_INFANTRY',3,5)]});
  assert.equal(r.status,'CANDIDATE');
});

test('enemy lone leader adjacent to attacker prevents ranged fire',()=>{
  const r=check({leaders:[{id:'leader',side:'B',col:3,row:4}]});
  assert.equal(r.reason,'ADJACENT_ENEMY_PREVENTS_RANGED');
});

test('ranged target cannot be in adjacent hex; own-side unit cannot be targeted',()=>{
  assert.equal(check({units:[shooter,{...target,col:3,row:4}]}).reason,'RANGED_TARGET_ADJACENT');
  assert.equal(check({units:[shooter,{...target,side:'A'}]}).reason,'FRIENDLY_TARGET');
});

test('outside range blocked before LOS; nonmissile attacker blocked',()=>{
  assert.equal(check({units:[shooter,{...target,col:6,row:4}]}).reason,'TARGET_OUT_OF_RANGE');
  assert.equal(check({units:[{...shooter,type:'HEAVY_INFANTRY'},target]}).reason,'NO_BASE_RANGED_WEAPON');
});

test('heavy war machine can fire six hexes stationary and cannot after moving',()=>{
  const units=[{...shooter,type:'HEAVY_WAR_MACHINE'},{...target,col:8,row:4}];
  const stationary=check({units});
  assert.equal(stationary.status,'CANDIDATE');
  assert.equal(stationary.distance,6);
  assert.equal(stationary.baseDice,2);
  assert.equal(check({units,movedSteps:1}).reason,'WAR_MACHINE_MOVED');
});

test('auxilia moving two hexes cannot shoot',()=>{
  const r=check({units:[{...shooter,type:'AUXILIA_INFANTRY'},{...target,col:4,row:4}],movedSteps:2});
  assert.equal(r.reason,'AUXILIA_MOVED_TWO');
});

test('reject duplicate board IDs, occupied positions and wrong-side leaders',()=>{
  for(const extra of [
    {units:[shooter,target,{...shooter,col:1,row:1}]},
    {units:[shooter,target,{...target,id:'dup'}]},
    {leaders:[{id:'leader',side:'B',col:2,row:4}]},
    {leaders:[{id:'shooter',side:'A',col:2,row:4}]},
    {terrain:[{col:4,row:4,kind:'FOREST'},{col:4,row:4,kind:'HILL'}]},
    {terrain:[{col:4,row:4,kind:'MARSH'}]},
    {units:[shooter,{...target,col:13}]}
  ]) assert.throws(()=>check(extra),/INVALID_RANGED_BOARD/);
});

test('reject unknown unit IDs, invalid move counts and leader-only targets',()=>{
  for(const extra of [{attackerId:'missing'},{targetId:'missing'},
    {attackerId:'shooter',targetId:'shooter'}, {movedSteps:-1},
    {movedSteps:0.5},{targetId:'leader',leaders:[{id:'leader',side:'B',col:5,row:4}]}])
    assert.throws(()=>check(extra),/INVALID_RANGED_ATTACK|UNKNOWN_RANGED_UNIT/);
});

test('attached friendly leader does not duplicate or falsely obstruct shooter',()=>{
  const r=check({leaders:[{id:'hero',side:'A',col:2,row:4}]});
  assert.equal(r.status,'CANDIDATE');
});

test('input is not mutated, result is immutable, no physical dice or events are recorded',()=>{
  const input=state({terrain:[{col:5,row:4,kind:'HILL'}]});
  const before=structuredClone(input);
  const r=assess(input);
  assert.equal(r.status,'CANDIDATE');
  assert.deepEqual(input,before);
  assert.equal(Object.isFrozen(r),true);
  assert.equal(r.cardModifiersApplied,false);
  assert.equal(r.scenarioExceptionsChecked,false);
  assert.equal(r.attackAuthorized,false);
});
