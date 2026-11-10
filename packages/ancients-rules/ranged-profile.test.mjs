import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE_RANGED_REACH, assessAncientsRangedProfile as assess} from './ranged-profile.mjs';
import {BASE_MOVEMENT_PROFILES} from './movement-profile.mjs';

const shot = (unitType, movedSteps=0, targetDistance=2) =>
  assess({unitType,movedSteps,targetDistance});

test('base range maps to the six missile-equipped unit types in current ruleset',()=>{
  assert.deepEqual({...BASE_RANGED_REACH},{
    LIGHT_INFANTRY:2,LIGHT_SLING_INFANTRY:3,LIGHT_BOW_INFANTRY:3,
    AUXILIA_INFANTRY:2,LIGHT_CAVALRY:2,HEAVY_WAR_MACHINE:6
  });
  assert.equal(Object.isFrozen(BASE_RANGED_REACH),true);
});

test('every ranged-capable base unit fires only at nonadjacent hexes within its range',()=>{
  for(const [unitType,range] of Object.entries(BASE_RANGED_REACH)){
    assert.equal(shot(unitType,0,1).reason,'RANGED_TARGET_ADJACENT');
    assert.equal(shot(unitType,0,range).status,'CANDIDATE');
    assert.equal(shot(unitType,0,range).range,range);
    assert.equal(shot(unitType,0,range+1).reason,'TARGET_OUT_OF_RANGE');
  }
});

test('ordinary stationary missile fire is two dice and moving fire is one',()=>{
  for(const unit of Object.keys(BASE_RANGED_REACH)){
    const stationary=shot(unit,0);
    assert.equal(stationary.baseDice,2);
    assert.equal(stationary.attackAuthorized,false);
    if(!['HEAVY_WAR_MACHINE'].includes(unit)){
      const moved=shot(unit,1);
      assert.equal(moved.baseDice,1);
      assert.equal(moved.status,'CANDIDATE');
    }
  }
});

test('auxilia cannot fire after moving two hexes',()=>{
  assert.equal(shot('AUXILIA_INFANTRY',2).reason,'AUXILIA_MOVED_TWO');
  assert.equal(shot('AUXILIA_INFANTRY',2).baseDice,0);
});

test('heavy war machine cannot fire after moving even one hex',()=>{
  assert.equal(shot('HEAVY_WAR_MACHINE',1,6).reason,'WAR_MACHINE_MOVED');
});

test('nonmissile ordinary units are rejected without inventing a ranged weapon',()=>{
  for(const unit of Object.keys(BASE_MOVEMENT_PROFILES).filter(u=>!Object.hasOwn(BASE_RANGED_REACH,u))){
    assert.equal(shot(unit).reason,'NO_BASE_RANGED_WEAPON');
    assert.equal(shot(unit).range,null);
    assert.equal(shot(unit).baseDice,0);
  }
});

test('movement outside standard profile is blocked, not automatically legalized by a card',()=>{
  assert.equal(shot('LIGHT_INFANTRY',3).reason,'EXCEEDS_STANDARD_MOVEMENT');
  assert.equal(shot('HEAVY_WAR_MACHINE',2,6).reason,'EXCEEDS_STANDARD_MOVEMENT');
  assert.equal(shot('LIGHT_CAVALRY',5).reason,'EXCEEDS_STANDARD_MOVEMENT');
});

test('all outputs are frozen and never represent authorization',()=>{
  for(const result of [shot('LIGHT_BOW_INFANTRY'),shot('HEAVY_INFANTRY')]){
    assert.equal(Object.isFrozen(result),true);
    assert.equal(result.needsFullLegalityCheck,true);
    assert.equal(result.attackAuthorized,false);
    assert.equal(result.ordersAndPhaseChecked,false);
    assert.equal(result.lineOfSightChecked,false);
    assert.equal(result.cardModifiersApplied,false);
  }
});

test('reject unsupported/expansion types without prototype inheritance',()=>{
  for(const unit of ['__proto__','LIGHT_BOW_CAVALRY', 'CAMEL',null,undefined])
    assert.throws(()=>shot(unit),/UNSUPPORTED_BASE_UNIT_TYPE/);
});

test('reject malformed step and distance inputs, including fractional, negative and unsafe',()=>{
  for(const steps of [-1,1.5,null,undefined,Number.MAX_SAFE_INTEGER+1])
    assert.throws(()=>assess({unitType:'LIGHT_INFANTRY',movedSteps:steps,targetDistance:2}),/INVALID_RANGED_PROFILE_INPUT/);
  for(const targetDistance of [0,-1,1.5,undefined,Infinity])
    assert.throws(()=>assess({unitType:'LIGHT_INFANTRY',movedSteps:0,targetDistance}),/INVALID_RANGED_PROFILE_INPUT/);
});
