import test from 'node:test';
import assert from 'node:assert/strict';
import {ANCIENTS_RULESET, BASE_MOVEMENT_PROFILES, assessBaseMovement} from './movement-profile.mjs';

const profile = (unitType, steps) => assessBaseMovement({unitType, steps});

for (const [type, max, battleMax] of [
  ['LIGHT_INFANTRY',2,2], ['LIGHT_SLING_INFANTRY',2,2], ['LIGHT_BOW_INFANTRY',2,2],
  ['AUXILIA_INFANTRY',2,1], ['MEDIUM_INFANTRY',1,1], ['HEAVY_INFANTRY',1,1],
  ['HEAVY_WAR_MACHINE',1,0], ['LIGHT_CAVALRY',4,4], ['MEDIUM_CAVALRY',3,3],
  ['HEAVY_CAVALRY',2,2], ['ELEPHANT',2,2], ['HEAVY_CHARIOT',2,2]
]) {
  test(`movement allowance and attack restriction: ${type}`, () => {
    assert.deepEqual(BASE_MOVEMENT_PROFILES[type], {maxSteps:max, battleAfterSteps:battleMax, exception:null});
    for (let steps=0;steps<=max;steps++) {
      const result=profile(type,steps);
      assert.equal(result.status,'WITHIN_PROFILE');
      assert.equal(result.battle,steps<=battleMax?'POSSIBLE':'UNAVAILABLE');
      assert.equal(result.needsFullLegalityCheck,true);
      assert.equal(result.ruleset,ANCIENTS_RULESET);
    }
    assert.deepEqual([profile(type,max+1).status, profile(type,max+1).battle],
      ['EXCEEDS_STANDARD_PROFILE','UNAVAILABLE']);
  });
}

test('warrior may move two only as conditional mandatory close combat',()=>{
  assert.equal(profile('WARRIOR_INFANTRY',0).battle,'POSSIBLE');
  assert.equal(profile('WARRIOR_INFANTRY',1).status,'WITHIN_PROFILE');
  assert.equal(profile('WARRIOR_INFANTRY',1).battle,'POSSIBLE');
  assert.deepEqual([profile('WARRIOR_INFANTRY',2).status,profile('WARRIOR_INFANTRY',2).battle],
    ['CONDITIONAL_CHARGE','MANDATORY_CLOSE_COMBAT']);
  assert.deepEqual([profile('WARRIOR_INFANTRY',3).status,profile('WARRIOR_INFANTRY',3).battle],
    ['EXCEEDS_STANDARD_PROFILE','UNAVAILABLE']);
});

test('unknown or expansion unit types fail closed',()=>{
  for (const unitType of ['', 'LIGHT_BOW_CAVALRY', 'CAMEL', 'CATAPHRACT_CAMEL',
    'LIGHT_BARBARIAN_CHARIOT','HEAVY_CATAPHRACT_CAVALRY','LEADER','__proto__',undefined]) {
    assert.throws(()=>assessBaseMovement({unitType,steps:1}),/UNSUPPORTED_BASE_UNIT_TYPE/);
  }
});

test('movement steps must be a non-negative safe integer',()=>{
  for(const steps of [-1,0.5,NaN,Infinity,'2',null,Number.MAX_SAFE_INTEGER+1,undefined]){
    assert.throws(()=>profile('LIGHT_INFANTRY',steps),/INVALID_MOVEMENT_STEPS/);
  }
});

test('profiles and resulting decisions are immutable and contain no mutable public references',()=>{
  assert.equal(Object.isFrozen(BASE_MOVEMENT_PROFILES),true);
  for(const entry of Object.values(BASE_MOVEMENT_PROFILES))assert.equal(Object.isFrozen(entry),true);
  assert.equal(Object.isFrozen(profile('LIGHT_INFANTRY',1)),true);
  assert.equal(Object.keys(BASE_MOVEMENT_PROFILES).length,13);
});

test('a distance-zero move is not equivalent to a completed legal movement action',()=>{
  const result=profile('HEAVY_WAR_MACHINE',0);
  assert.equal(result.battle,'POSSIBLE');
  assert.equal(result.needsFullLegalityCheck,true);
});
