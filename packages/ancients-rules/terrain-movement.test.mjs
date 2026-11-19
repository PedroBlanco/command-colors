import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE_TERRAIN_TYPES, assessAncientsTerrainMovement as assess} from './terrain-movement.mjs';

const at = (col, row) => ({col, row});
const origin = at(4, 4);
const check = (unitType, path, terrain = [], from = origin) => assess({unitType, origin:from, path, terrain});
const tile = (col, row, kind) => ({col, row, kind});

test('empty terrain and hills do not restrict standard moves', () => {
  for (const kind of [null, 'HILL']) {
    const terrain = kind ? [tile(5,4,kind),tile(6,4,kind)] : [];
    const v = check('LIGHT_INFANTRY', [at(5,4),at(6,4)], terrain);
    assert.equal(v.status, 'CANDIDATE');
    assert.equal(v.battleOnEntry, 'NOT_BARRED_BY_TERRAIN');
    assert.equal(v.destinationTerrain, kind ?? 'CLEAR');
    assert.equal(v.needsFullLegalityCheck, true);
  }
});

test('forest stops all unit classes immediately on entry', () => {
  for (const type of ['LIGHT_INFANTRY', 'MEDIUM_INFANTRY', 'LIGHT_CAVALRY', 'ELEPHANT', 'HEAVY_WAR_MACHINE']) {
    const v=check(type,[at(5,4),at(6,4)],[tile(5,4,'FOREST')]);
    assert.equal(v.status,'BLOCKED');
    assert.equal(v.reason,'MUST_STOP_ON_FOREST_ENTRY');
    assert.equal(v.step,0);
  }
});

test('forest permits ordinary battle on entry for the five designated light foot types', () => {
  const lightFoot = ['LIGHT_INFANTRY','LIGHT_SLING_INFANTRY','LIGHT_BOW_INFANTRY','AUXILIA_INFANTRY','WARRIOR_INFANTRY'];
  for (const type of lightFoot) {
    const v=check(type,[at(5,4)],[tile(5,4,'FOREST')]);
    assert.equal(v.status,'CANDIDATE');
    assert.equal(v.battleOnEntry,'NOT_BARRED_BY_TERRAIN');
  }
});

test('forest blocks ordinary battle on entry for medium/heavy foot, machine and mounted', () => {
  const other = ['MEDIUM_INFANTRY','HEAVY_INFANTRY','HEAVY_WAR_MACHINE','LIGHT_CAVALRY',
    'MEDIUM_CAVALRY','HEAVY_CAVALRY','ELEPHANT','HEAVY_CHARIOT'];
  for (const type of other) {
    const v=check(type,[at(5,4)],[tile(5,4,'FOREST')]);
    assert.equal(v.status,'CANDIDATE');
    assert.equal(v.battleOnEntry,'UNAVAILABLE');
  }
});

test('leaving a forest does not count as entering it again', () => {
  const v=check('LIGHT_INFANTRY',[at(5,4),at(6,4)],[tile(4,4,'FOREST')]);
  assert.equal(v.status,'CANDIDATE');
});

test('broken ground is impassable to a heavy war machine', () => {
  const v=check('HEAVY_WAR_MACHINE',[at(5,4)],[tile(5,4,'BROKEN_GROUND')]);
  assert.equal(v.status,'BLOCKED');
  assert.equal(v.reason,'WAR_MACHINE_CANNOT_ENTER_BROKEN_GROUND');
  assert.equal(v.step,0);
});

test('broken ground forces mounted units including elephants and heavy chariots to stop', () => {
  for (const type of ['LIGHT_CAVALRY','MEDIUM_CAVALRY','HEAVY_CAVALRY','ELEPHANT','HEAVY_CHARIOT']) {
    const v=check(type,[at(5,4),at(6,4)],[tile(5,4,'BROKEN_GROUND')]);
    assert.equal(v.status,'BLOCKED');
    assert.equal(v.reason,'MOUNTED_MUST_STOP_ON_BROKEN_GROUND');
    assert.equal(v.step,0);
  }
});

test('mounted unit that stops on broken ground cannot battle that turn', () => {
  for (const type of ['LIGHT_CAVALRY','ELEPHANT','HEAVY_CHARIOT']) {
    const v=check(type,[at(5,4)],[tile(5,4,'BROKEN_GROUND')]);
    assert.equal(v.status,'CANDIDATE');
    assert.equal(v.battleOnEntry,'UNAVAILABLE');
  }
});

test('normal infantry may enter and traverse broken ground without terrain battle penalty', () => {
  const v=check('LIGHT_INFANTRY',[at(5,4),at(6,4)],[tile(5,4,'BROKEN_GROUND')]);
  assert.equal(v.status,'CANDIDATE');
  assert.equal(v.battleOnEntry,'NOT_BARRED_BY_TERRAIN');
});

test('starting on broken ground does not prevent mounted unit from leaving it', () => {
  const v=check('LIGHT_CAVALRY',[at(5,4),at(6,4)],[tile(4,4,'BROKEN_GROUND')]);
  assert.equal(v.status,'CANDIDATE');
});

test('starting in a forest and ending in another forest triggers entry stop only at destination', () => {
  const v=check('LIGHT_INFANTRY',[at(5,4),at(6,4)],[tile(4,4,'FOREST'),tile(6,4,'FOREST')]);
  assert.equal(v.status,'CANDIDATE');
  assert.equal(v.destinationTerrain,'FOREST');
});

test('terrain map rejects malformed tiles and unsupported terrain kinds fail closed', () => {
  const bad = [[tile(5,4,'MARSH')],[tile(5,4,'FOREST'),tile(5,4,'HILL')],
    [tile(13,4,'FOREST')],[tile(-1,4,'FOREST')],[{kind:'HILL',col:4,row:4.5}],
    Array.from({length:118},()=>tile(5,4,'HILL')),null,{}];
  for (const terrain of bad)
    assert.throws(()=>check('LIGHT_INFANTRY',[at(5,4)],terrain),/INVALID_BASE_TERRAIN_MAP/);
});

test('invalid unit type and expansion types are rejected', () => {
  for (const type of ['LEADER','CAMEL','LIGHT_BOW_CAVALRY','__proto__',null])
    assert.throws(()=>check(type,[at(5,4)]),/INVALID_BASE_TERRAIN_UNIT/);
});

test('empty or out-of-range or ill-formed paths fail closed', () => {
  for (const path of [[],null,'5,4',[at(13,4)],[at(5,9)],[{col:5,row:4.5}],
    Array.from({length:33},()=>at(5,4))])
    assert.throws(()=>check('LIGHT_INFANTRY',path),/INVALID_BASE_TERRAIN_PATH/);
});

test('nonadjacent and repeated hexes do not become candidates', () => {
  assert.equal(check('LIGHT_INFANTRY',[at(6,4)]).reason,'NON_ADJACENT_HEX');
  assert.equal(check('LIGHT_INFANTRY',[at(5,4),at(4,4)]).reason,'REPEATED_HEX');
});

test('battle screen is about terrain only; no legal battle or movement implied', () => {
  const res=check('HEAVY_WAR_MACHINE',[at(5,4)],[tile(5,4,'HILL')]);
  assert.equal(res.battleOnEntry,'NOT_BARRED_BY_TERRAIN');
  assert.equal(res.needsFullLegalityCheck,true);
  assert.equal(Object.isFrozen(res),true);
  assert.equal(Object.isFrozen(BASE_TERRAIN_TYPES),true);
  assert.deepEqual(BASE_TERRAIN_TYPES,['FOREST','HILL','BROKEN_GROUND']);
});
