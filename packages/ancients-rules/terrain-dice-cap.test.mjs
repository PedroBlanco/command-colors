import test from 'node:test';
import assert from 'node:assert/strict';
import {assessAncientsTerrainDiceCap as assess} from './terrain-dice-cap.mjs';

const cap = (attackerType,attackerTerrain,targetTerrain,attackKind='CLOSE') =>
  assess({attackerType,attackerTerrain,targetTerrain,attackKind});

test('forest and broken ground cap close combat at two dice in and out',()=>{
  for(const t of ['FOREST','BROKEN_GROUND']){
    assert.equal(cap('HEAVY_INFANTRY','CLEAR',t).maxDice,2);
    assert.equal(cap('HEAVY_INFANTRY',t,'CLEAR').maxDice,2);
    assert.equal(cap('HEAVY_CAVALRY',t,'CLEAR').maxDice,2);
  }
});

test('ranged target in forest caps at one die',()=>{
  assert.equal(cap('LIGHT_BOW_INFANTRY','CLEAR','FOREST','RANGED').maxDice,1);
  assert.equal(cap('LIGHT_BOW_INFANTRY','HILL','FOREST','RANGED').maxDice,1);
});

test('ranged firing from forest does not impose a terrain cap by itself',()=>{
  assert.equal(cap('LIGHT_BOW_INFANTRY','FOREST','CLEAR','RANGED').maxDice,null);
  assert.equal(cap('LIGHT_BOW_INFANTRY','BROKEN_GROUND','BROKEN_GROUND','RANGED').maxDice,null);
});

test('all unit types attack uphill with at most two ordinary dice',()=>{
  for(const type of ['LIGHT_INFANTRY','HEAVY_WAR_MACHINE','LIGHT_CAVALRY','ELEPHANT','HEAVY_CHARIOT']){
    assert.equal(cap(type,'CLEAR','HILL').maxDice,2);
  }
});

test('downhill and hill-to-hill: foot max three, mounted max two',()=>{
  for(const target of ['CLEAR','HILL']){
    for(const foot of ['LIGHT_INFANTRY','WARRIOR_INFANTRY','HEAVY_INFANTRY'])
      assert.equal(cap(foot,'HILL',target).maxDice,3);
    for(const mounted of ['LIGHT_CAVALRY','HEAVY_CAVALRY','ELEPHANT','HEAVY_CHARIOT'])
      assert.equal(cap(mounted,'HILL',target).maxDice,2);
  }
});

test('when hill and a restricted-hex terrain coincide, tighter cap wins',()=>{
  assert.equal(cap('HEAVY_INFANTRY','HILL','FOREST').maxDice,2);
  assert.equal(cap('HEAVY_INFANTRY','BROKEN_GROUND','HILL').maxDice,2);
  assert.equal(cap('HEAVY_INFANTRY','HILL','BROKEN_GROUND').maxDice,2);
});

test('no terrain effect does not invent a numeric dice allowance',()=>{
  assert.equal(cap('LIGHT_CAVALRY','CLEAR','CLEAR').maxDice,null);
  assert.equal(cap('LIGHT_CAVALRY','HILL','CLEAR','RANGED').maxDice,null);
});

test('return value is frozen and clearly not authoritative',()=>{
  const r=cap('LIGHT_BOW_INFANTRY','CLEAR','FOREST','RANGED');
  assert.equal(r.maxDice,1);
  assert.equal(r.needsFullLegalityCheck,true);
  assert.equal(r.lineOfSightChecked,false);
  assert.equal(r.cardModifiersApplied,false);
  assert.equal(Object.isFrozen(r),true);
});

test('reject unknown or expansion units without prototype inheritance',()=>{
  for(const type of ['CAMEL','__proto__',undefined,null])
    assert.throws(()=>cap(type,'CLEAR','HILL'),/UNSUPPORTED_BASE_UNIT_TYPE/);
});

test('reject unsupported or unspecified battle/terrain values',()=>{
  for(const [from,to,kind] of [
    [null,'CLEAR','CLOSE'], ['CLEAR','MARSH','CLOSE'], ['CLEAR','CLEAR','MAGIC'],
    [undefined,'CLEAR','CLOSE'], ['HILL',undefined,'RANGED']])
    assert.throws(()=>cap('HEAVY_INFANTRY',from,to,kind),/INVALID_TERRAIN_BATTLE/);
});
