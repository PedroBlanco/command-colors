import test from 'node:test';
import assert from 'node:assert/strict';
import {precheckAncientsMovementPath as precheck} from './movement-path-precheck.mjs';

const at = (col,row) => ({col,row});
const a = (type='LIGHT_INFANTRY') => ({id:'unit_a',side:'A',type,col:4,row:4});
const enemy = {id:'unit_b',side:'B',type:'MEDIUM_INFANTRY',col:9,row:4};
const tile = (col,row,kind) => ({col,row,kind});
const check = (type,path,terrain=[],extras=[]) => precheck({
  units:[a(type),enemy,...extras],unitId:'unit_a',path,terrain
});

test('the combined route checker keeps prior clear-board behavior',()=>{
  const r=check('LIGHT_INFANTRY',[at(5,4)]);
  assert.equal(r.status,'CANDIDATE');
  assert.equal(r.battleAfterMovement,'POSSIBLE');
  assert.equal(r.terrain.destinationTerrain,'CLEAR');
  assert.equal(r.needsFullLegalityCheck,true);
});

test('medium infantry moving into forest may not battle even when its unit profile permits it',()=>{
  const r=check('MEDIUM_INFANTRY',[at(5,4)],[tile(5,4,'FOREST')]);
  assert.equal(r.status,'CANDIDATE');
  assert.equal(r.profile.battle,'POSSIBLE');
  assert.equal(r.terrain.battleOnEntry,'UNAVAILABLE');
  assert.equal(r.battleAfterMovement,'UNAVAILABLE');
});

test('light foot forest exception does not override auxilia two-step combat prohibition',()=>{
  const r=check('AUXILIA_INFANTRY',[at(5,4),at(6,4)],[tile(6,4,'FOREST')]);
  assert.equal(r.status,'CANDIDATE');
  assert.equal(r.terrain.battleOnEntry,'NOT_BARRED_BY_TERRAIN');
  assert.equal(r.profile.battle,'UNAVAILABLE');
  assert.equal(r.battleAfterMovement,'UNAVAILABLE');
});

test('warrior conditional mandatory battle remains flagged when charging into forest',()=>{
  const r=check('WARRIOR_INFANTRY',[at(5,4),at(6,4)],[tile(6,4,'FOREST')],
    [{id:'enemy_near',side:'B',type:'LIGHT_CAVALRY',col:7,row:4}]);
  assert.equal(r.status,'CANDIDATE');
  assert.equal(r.terrain.destinationTerrain,'FOREST');
  assert.equal(r.battleAfterMovement,'MANDATORY_CLOSE_COMBAT');
  assert.equal(r.requiresMandatoryCloseCombat,true);
});

test('war machine cannot enter broken ground in combined checker',()=>{
  const r=check('HEAVY_WAR_MACHINE',[at(5,4)],[tile(5,4,'BROKEN_GROUND')]);
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.reason,'WAR_MACHINE_CANNOT_ENTER_BROKEN_GROUND');
  assert.equal(r.terrain.status,'BLOCKED');
  assert.equal(r.needsFullLegalityCheck,true);
});

test('mounted unit entering broken ground cannot move beyond it and cannot battle on arrival',()=>{
  const blocked=check('ELEPHANT',[at(5,4),at(6,4)],[tile(5,4,'BROKEN_GROUND')]);
  assert.equal(blocked.status,'BLOCKED');
  assert.equal(blocked.reason,'MOUNTED_MUST_STOP_ON_BROKEN_GROUND');
  const final=check('ELEPHANT',[at(5,4)],[tile(5,4,'BROKEN_GROUND')]);
  assert.equal(final.status,'CANDIDATE');
  assert.equal(final.battleAfterMovement,'UNAVAILABLE');
});

test('terrain overrides are not silently applied when profile range is exceeded',()=>{
  const r=check('MEDIUM_INFANTRY',[at(5,4),at(6,4)],[tile(5,4,'HILL')]);
  assert.equal(r.status,'REQUIRES_RULE_EXCEPTION');
  assert.equal(r.needsFullLegalityCheck,true);
  assert.equal(r.profile.status,'EXCEEDS_STANDARD_PROFILE');
});

test('invalid terrain tiles fail closed on an otherwise valid route',()=>{
  assert.throws(()=>check('LIGHT_INFANTRY',[at(5,4)],[tile(5,4,'UNSUPPORTED')]),
    /INVALID_BASE_TERRAIN_MAP/);
});

test('occupied destination stays blocked regardless of terrain metadata',()=>{
  const r=check('LIGHT_INFANTRY',[at(5,4)],[tile(5,4,'FOREST')],
    [{id:'ally',side:'A',type:'LIGHT_INFANTRY',col:5,row:4}]);
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.reason,'OCCUPIED_HEX');
});
