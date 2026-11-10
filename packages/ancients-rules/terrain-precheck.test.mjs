import test from 'node:test';
import assert from 'node:assert/strict';
import {precheckAncientsTerrainMovement as check,BASE_TERRAINS} from './terrain-precheck.mjs';

const cell=(col,row)=>({col,row});
const run=(unitType,path,terrain=[])=>check({unitType,path,terrain});
const t=(type,col=5,row=4)=>({type,col,row});
const one=[cell(5,4)], two=[cell(5,4),cell(6,4)];
const mounted=['LIGHT_CAVALRY','MEDIUM_CAVALRY','HEAVY_CAVALRY','ELEPHANT','HEAVY_CHARIOT'];
const forestExceptions=['LIGHT_INFANTRY','LIGHT_SLING_INFANTRY','LIGHT_BOW_INFANTRY','AUXILIA_INFANTRY','WARRIOR_INFANTRY'];

test('base terrain vocabulary is immutable and explicit',()=>{
  assert.deepEqual(BASE_TERRAINS,['PLAIN','FOREST','HILL','BROKEN_GROUND']);
  assert.equal(Object.isFrozen(BASE_TERRAINS),true);
});
test('empty terrain map is ordinary open movement, never an authorization',()=>{
  const r=run('LIGHT_INFANTRY',two);
  assert.equal(r.status,'CANDIDATE');
  assert.equal(r.battle,'POSSIBLE');
  assert.equal(r.needsFullLegalityCheck,true);
  assert.equal(Object.isFrozen(r),true);
});
test('forest stops every unit, including light units and mounted units',()=>{
  for(const unit of ['LIGHT_INFANTRY','HEAVY_INFANTRY','LIGHT_CAVALRY','ELEPHANT']){
    const r=run(unit,two,[t('FOREST')]);
    assert.equal(r.status,'BLOCKED',unit);
    assert.equal(r.reason,'MUST_STOP_IN_FOREST',unit);
    assert.equal(r.step,0);
  }
});
test('light foot and warriors retain possible battle when entering forest',()=>{
  for(const unit of forestExceptions){
    const r=run(unit,one,[t('FOREST')]);
    assert.equal(r.status,'CANDIDATE',unit);
    assert.equal(r.battle,'POSSIBLE',unit);
  }
});
test('other units cannot battle after entering forest',()=>{
  for(const unit of ['MEDIUM_INFANTRY','HEAVY_INFANTRY','HEAVY_WAR_MACHINE',...mounted]){
    const r=run(unit,one,[t('FOREST')]);
    assert.equal(r.status,'CANDIDATE',unit);
    assert.equal(r.battle,'UNAVAILABLE',unit);
  }
});
test('hill does not restrict normal movement or battle-on-entry',()=>{
  const r=run('LIGHT_CAVALRY',two,[t('HILL'),t('HILL',6,4)]);
  assert.equal(r.status,'CANDIDATE');
  assert.equal(r.battle,'POSSIBLE');
});
test('broken ground excludes war machines',()=>{
  const r=run('HEAVY_WAR_MACHINE',one,[t('BROKEN_GROUND')]);
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.reason,'WAR_MACHINE_CANNOT_ENTER_BROKEN_GROUND');
});
test('mounted units must stop upon entering broken ground',()=>{
  for(const unit of mounted){
    const r=run(unit,two,[t('BROKEN_GROUND')]);
    assert.equal(r.reason,'MOUNTED_MUST_STOP_ON_BROKEN_GROUND',unit);
  }
});
test('mounted units cannot battle after entering broken ground',()=>{
  for(const unit of mounted){
    const r=run(unit,one,[t('BROKEN_GROUND')]);
    assert.equal(r.status,'CANDIDATE',unit);
    assert.equal(r.battle,'UNAVAILABLE',unit);
  }
});
test('foot units other than war machine may continue through broken ground',()=>{
  for(const unit of ['LIGHT_INFANTRY','AUXILIA_INFANTRY','WARRIOR_INFANTRY']){
    const r=run(unit,two,[t('BROKEN_GROUND')]);
    assert.equal(r.status,unit==='WARRIOR_INFANTRY'?'CANDIDATE':'CANDIDATE');
    assert.equal(r.battle,unit==='LIGHT_INFANTRY'?'POSSIBLE':unit==='AUXILIA_INFANTRY'?'UNAVAILABLE':'MANDATORY_CLOSE_COMBAT');
  }
});
test('forest at final hex cannot restore battle lost to distance',()=>{
  const r=run('AUXILIA_INFANTRY',two,[t('FOREST',6,4)]);
  assert.equal(r.status,'CANDIDATE');
  assert.equal(r.battle,'UNAVAILABLE');
});
test('terrain never grants movement beyond standard allowance',()=>{
  const r=run('HEAVY_INFANTRY',two,[t('HILL')]);
  assert.equal(r.status,'REQUIRES_RULE_EXCEPTION');
  assert.equal(r.reason,'STANDARD_MOVEMENT_EXCEEDED');
});
test('reject malformed paths and off-board coordinates',()=>{
  for(const path of [null,[],[cell(-1,4)],[cell(13,4)],[cell(5,9)],[{col:1.5,row:2}],Array(33).fill(cell(5,4))]){
    assert.throws(()=>run('LIGHT_INFANTRY',path),/INVALID_TERRAIN_PATH/);
  }
});
test('reject unknown unit types rather than infer movement permissions',()=>{
  assert.throws(()=>run('CATAPHRACT_CAMEL',one),/UNSUPPORTED_BASE_UNIT_TYPE/);
});
test('reject unknown, duplicate, malformed or plain terrain entries',()=>{
  for(const terrain of [
    null,[t('RIVER')],[t('PLAIN')],[t('FOREST'),t('HILL')],
    [{type:'FOREST',col:13,row:0}],[{type:'FOREST',col:1.5,row:4}],
    [{type:'FOREST',col:4,row:4},{type:'FOREST',col:4,row:4}],
    Array(118).fill(t('HILL'))
  ]) assert.throws(()=>run('LIGHT_INFANTRY',one,terrain),/INVALID_TERRAIN_MAP/);
});
test('terrain values cannot be changed by consumers',()=>{
  const r=run('LIGHT_INFANTRY',one,[t('FOREST')]);
  assert.equal(Object.isFrozen(r),true);
  assert.equal(Object.isFrozen(r.profile),true);
});
