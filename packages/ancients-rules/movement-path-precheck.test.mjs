import test from 'node:test';
import assert from 'node:assert/strict';
import {precheckAncientsMovementPath as check} from './movement-path-precheck.mjs';
const A = {id:'unit_a', side:'A', type:'LIGHT_INFANTRY', col:4, row:4};
const B = {id:'unit_b', side:'B', type:'MEDIUM_INFANTRY', col:9, row:4};
const at = (col,row) => ({col,row});
const withUnit = (updates={}, additions=[], leaders=[]) => ({
  units:[{...A,...updates},B,...additions], leaders, unitId:'unit_a'
});
const probe=(path,updates={},additions=[],leaders=[]) => check({...withUnit(updates,additions,leaders),path});

test('one or two adjacent hexes are ordinary candidates, not legal moves',()=>{
  for (const path of [[at(5,4)],[at(5,4),at(6,4)]]){
    const result=probe(path);
    assert.equal(result.status,'CANDIDATE');
    assert.equal(result.needsFullLegalityCheck,true);
    assert.equal(result.requiresLeaderResolution,false);
    assert.equal(Object.isFrozen(result),true);
  }
});

test('third step is not granted by light infantry standard profile',()=>{
  const value=probe([at(5,4),at(6,4),at(7,4)]);
  assert.equal(value.status,'REQUIRES_RULE_EXCEPTION');
  assert.equal(value.reason,'STANDARD_MOVEMENT_EXCEEDED');
  assert.equal(value.profile.status,'EXCEEDS_STANDARD_PROFILE');
});

test('unit cannot skip a hex or exit odd-q 13x9 battlefield',()=>{
  assert.deepEqual([probe([at(6,4)]).status,probe([at(6,4)]).reason],['BLOCKED','NON_ADJACENT_HEX']);
  assert.throws(()=>probe([at(-1,4)]),/INVALID_BASE_PATH/);
  assert.throws(()=>probe([at(13,4)]),/INVALID_BASE_PATH/);
  assert.throws(()=>probe([at(4,9)]),/INVALID_BASE_PATH/);
});

test('repeated hex including return to origin is rejected',()=>{
  const result=probe([at(5,4),at(4,4)]);
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.reason,'REPEATED_HEX');
  assert.equal(result.step,1);
});

test('another friendly unit blocks an ordinary movement path',()=>{
  const result=probe([at(5,4)],{},[{id:'friend',side:'A',type:'HEAVY_INFANTRY',col:5,row:4}]);
  assert.equal(result.reason,'OCCUPIED_HEX');
  assert.equal(result.needsFullLegalityCheck,true);
});

test('enemy unit blocks even an otherwise valid destination',()=>{
  const result=probe([at(5,4)],{},[{id:'foe',side:'B',type:'LIGHT_CAVALRY',col:5,row:4}]);
  assert.equal(result.reason,'OCCUPIED_HEX');
});

test('moving through any occupied unit is blocked, including allies',()=>{
  const result=probe([at(5,4),at(6,4)],{},[{id:'ally',side:'A',type:'AUXILIA_INFANTRY',col:5,row:4}]);
  assert.equal(result.reason,'OCCUPIED_HEX');
  assert.equal(result.step,0);
});

test('lone enemy leader blocks destination',()=>{
  const result=probe([at(5,4)],{},[],[{id:'enemy_leader',side:'B',col:5,row:4}]);
  assert.equal(result.reason,'ENEMY_LEADER_HEX');
});

test('friendly lone leader at final hex is pending attachment, not authority',()=>{
  const result=probe([at(5,4)],{},[],[{id:'friendly_leader',side:'A',col:5,row:4}]);
  assert.equal(result.status,'CANDIDATE');
  assert.equal(result.requiresLeaderResolution,true);
  assert.equal(result.needsFullLegalityCheck,true);
});

test('must stop on entering friendly lone-leader hex',()=>{
  const result=probe([at(5,4),at(6,4)],{},[],[{id:'friendly_leader',side:'A',col:5,row:4}]);
  assert.equal(result.reason,'MUST_STOP_WITH_FRIENDLY_LEADER');
  assert.equal(result.step,0);
});

test('moving with attached leader requires resolving its movement too',()=>{
  const result=probe([at(5,4)],{},[],[{id:'attached',side:'A',col:4,row:4}]);
  assert.equal(result.status,'CANDIDATE');
  assert.equal(result.requiresLeaderResolution,true);
});

test('unit with attached leader cannot also enter a second friendly leader hex',()=>{
  const result=probe([at(5,4)],{},[],[
    {id:'attached',side:'A',col:4,row:4}, {id:'other_leader',side:'A',col:5,row:4}
  ]);
  assert.equal(result.reason,'TWO_LEADERS_COLLIDE');
});

test('warrior two-hex charge requires an enemy near its final destination',()=>{
  const noEnemy=probe([at(5,4),at(6,4)],{type:'WARRIOR_INFANTRY'});
  assert.equal(noEnemy.reason,'WARRIOR_CHARGE_TARGET_MISSING');
  const withEnemy=probe([at(5,4),at(6,4)],{type:'WARRIOR_INFANTRY'},[
    {id:'nearby',side:'B',type:'MEDIUM_INFANTRY',col:7,row:4}
  ]);
  assert.equal(withEnemy.status,'CANDIDATE');
  assert.equal(withEnemy.requiresMandatoryCloseCombat,true);
  assert.equal(withEnemy.profile.battle,'MANDATORY_CLOSE_COMBAT');
});

test('warrior charge can screen adjacency to lone enemy leader',()=>{
  const result=probe([at(5,4),at(6,4)],{type:'WARRIOR_INFANTRY'},[],[
    {id:'enemy_leader',side:'B',col:7,row:4}
  ]);
  assert.equal(result.status,'CANDIDATE');
  assert.equal(result.requiresMandatoryCloseCombat,true);
});

test('auxilia moving two hexes cannot battle under ordinary profile',()=>{
  const result=probe([at(5,4),at(6,4)],{type:'AUXILIA_INFANTRY'});
  assert.equal(result.status,'CANDIDATE');
  assert.equal(result.profile.battle,'UNAVAILABLE');
});

test('heavy war machine may move one but ordinary battle becomes unavailable',()=>{
  const result=probe([at(5,4)],{type:'HEAVY_WAR_MACHINE'});
  assert.equal(result.status,'CANDIDATE');
  assert.equal(result.profile.battle,'UNAVAILABLE');
});

test('reject unknown or expansion types and malformed unit identities',()=>{
  assert.throws(()=>probe([at(5,4)],{type:'CAMEL'}),/INVALID_BASE_BOARD/);
  assert.throws(()=>probe([at(5,4)],{id:'wrong;id'}),/INVALID_BASE_BOARD/);
  assert.throws(()=>check({...withUnit(),unitId:'missing',path:[at(5,4)]}),/UNKNOWN_MOVING_UNIT/);
});

test('reject malformed or contradictory occupancy and leader data',()=>{
  const additions=[{id:'friend',side:'A',type:'LIGHT_CAVALRY',col:4,row:4}];
  assert.throws(()=>probe([at(5,4)],{},additions),/INVALID_BASE_BOARD/);
  assert.throws(()=>probe([at(5,4)],{},[],[{id:'foe',side:'B',col:4,row:4}]),/INVALID_BASE_BOARD/);
  assert.throws(()=>probe([at(5,4)],{},[],[
    {id:'l1',side:'A',col:3,row:4},{id:'l2',side:'A',col:3,row:4}
  ]),/INVALID_BASE_BOARD/);
});

test('reject bad paths without exposing a legal authorization',()=>{
  for(const path of [[],[at(5,4),null],null,'5,4',Array.from({length:33},()=>at(5,4))]){
    assert.throws(()=>check({...withUnit(),path}),/INVALID_BASE_PATH/);
  }
});
