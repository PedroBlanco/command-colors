import test from 'node:test';
import assert from 'node:assert/strict';
import {ANCIENTS_RULESET} from './movement-profile.mjs';
import {precheckAncientsRangedDeclaration as check} from './ranged-turn-precheck.mjs';

const shooter = {id:'a1',side:'A',type:'LIGHT_BOW_INFANTRY',col:2,row:4};
const target = {id:'b1',side:'B',type:'HEAVY_INFANTRY',col:5,row:4};
const board = () => ({units:[{...shooter},{...target}],leaders:[],terrain:[]});
const turn = (updates = {}) => ({
  schemaVersion:1,ruleset:ANCIENTS_RULESET,status:'ACTIVE',
  revision:12,turn:'A',phase:'COMBAT',
  orderedUnitIds:['a1'],resolvedBattleUnitIds:[],
  movedStepsByUnit:{a1:0},pendingCombat:null,pendingDecision:null,...updates
});
const input = (updates = {}) => ({
  turnState:turn(),board:board(),sessionSide:'A',
  attackerId:'a1',targetId:'b1',expectedRevision:12,...updates
});

test('eligible attack stays read-only and unauthorised after all partial checks',()=>{
  const r=check(input());
  assert.equal(r.status,'CANDIDATE');
  assert.equal(r.reason,null);
  assert.equal(r.attackAuthorized,false);
  assert.equal(r.combatRecorded,false);
  assert.equal(r.commandCardValidated,false);
  assert.equal(r.turnGate.status,'CANDIDATE');
  assert.equal(r.ranged.status,'CANDIDATE');
  assert.equal(r.ranged.diceAfterTerrain,2);
  assert.equal(Object.isFrozen(r),true);
});

test('movedSteps comes from trusted turn context, not an attempted action override',()=>{
  const params=input({turnState:turn({movedStepsByUnit:{a1:1}})});
  params.movedSteps=0; // unsupported client field cannot override the snapshot
  const r=check(params);
  assert.equal(r.status,'CANDIDATE');
  assert.equal(r.ranged.baseDice,1);
  assert.equal(r.turnGate.movedSteps,1);
});

test('forest terrain on target restricts ordinary dice but still does not grant shot',()=>{
  const b=board();b.terrain=[{col:5,row:4,kind:'FOREST'}];
  const r=check(input({board:b}));
  assert.equal(r.status,'CANDIDATE');
  assert.equal(r.ranged.diceAfterTerrain,1);
  assert.equal(r.attackAuthorized,false);
});

test('stale revision never reaches LOS or target details',()=>{
  const r=check(input({expectedRevision:11}));
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.reason,'STALE_REVISION');
  assert.equal('ranged' in r,false);
});

test('wrong actor, phase or ended match blocks before inspecting a board',()=>{
  for(const change of [
    {sessionSide:'B'}, {turnState:turn({phase:'MOVEMENT'})},
    {turnState:turn({status:'FINISHED'})}
  ]) {
    const r=check(input({...change,board:null}));
    assert.equal(r.status,'BLOCKED');
    assert.equal('ranged' in r,false);
  }
});

test('cannot attack with a unit that was not ordered',()=>{
  const r=check(input({turnState:turn({orderedUnitIds:[],movedStepsByUnit:{}})}));
  assert.equal(r.reason,'UNIT_NOT_ELIGIBLE');
});

test('cannot attack again with a unit that already resolved close or ranged battle',()=>{
  const r=check(input({turnState:turn({resolvedBattleUnitIds:['a1']})}));
  assert.equal(r.reason,'UNIT_ALREADY_BATTLED');
});

test('pending combat and defender decision block another attack',()=>{
  for (const change of [{pendingCombat:{kind:'RANGED'}},{pendingDecision:{kind:'DEFENSE_CHOICE'}}]){
    const r=check(input({turnState:turn(change)}));
    assert.equal(r.reason,'COMBAT_OR_DECISION_PENDING');
  }
});

test('missing movement history is blocked, never treated as stationary',()=>{
  const r=check(input({turnState:turn({movedStepsByUnit:{}})}));
  assert.equal(r.reason,'MISSING_SERVER_MOVEMENT_RECORD');
});

test('cannot misuse an ordered enemy unit as attacker via another session',()=>{
  const b=board();b.units[0].side='B';
  const r=check(input({board:b}));
  assert.equal(r.reason,'UNIT_NOT_ELIGIBLE');
  assert.equal('ranged' in r,false);
});

test('unknown unit and enemy unit identifiers receive identical non-disclosing response',()=>{
  for(const b of [
    {units:[{...shooter, id:'other'},target],leaders:[],terrain:[]},
    {units:[{...shooter, side:'B'},target],leaders:[],terrain:[]}
  ]){
    const r=check(input({board:b}));
    assert.equal(r.reason,'UNIT_NOT_ELIGIBLE');
  }
});

test('friendly target is blocked by ranged rules even when attacker is ordered',()=>{
  const b=board();b.units[1].side='A';
  const r=check(input({board:b}));
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.reason,'FRIENDLY_TARGET');
});

test('LOS and weapon restrictions remain effective after the phase/order gate',()=>{
  const b=board();b.terrain=[{col:4,row:4,kind:'FOREST'}];
  assert.equal(check(input({board:b})).reason,'LINE_OF_SIGHT_BLOCKED');
  b.terrain=[];b.units[0].type='HEAVY_INFANTRY';
  assert.equal(check(input({board:b})).reason,'NO_BASE_RANGED_WEAPON');
});

test('reject malformed board and corrupt ranged data rather than authorizing',()=>{
  assert.throws(()=>check(input({board:null})),/INVALID_SERVER_RANGED_BOARD/);
  assert.throws(()=>check(input({board:{units:[],leaders:[],terrain:[]}})),/INVALID_SERVER_RANGED_BOARD/);
  const b=board();b.terrain=[{col:3,row:4,kind:'MARSH'}];
  assert.throws(()=>check(input({board:b})),/INVALID_RANGED_BOARD|INVALID_LOS_TERRAIN/);
});

test('reject synthetic phase contract as official turn state',()=>{
  assert.throws(()=>check(input({turnState:turn({ruleset:'synthetic-phases-v1'})})),
    /INVALID_ANCIENTS_TURN_STATE/);
});

test('two calls remain pure and cannot reserve a combat without a transaction',()=>{
  const snapshot=input(), before=structuredClone(snapshot);
  const first=check(snapshot), second=check(snapshot);
  assert.equal(first.status,'CANDIDATE');
  assert.equal(second.status,'CANDIDATE');
  assert.deepEqual(snapshot,before);
  assert.equal('nextState' in first,false);
  assert.equal('events' in first,false);
});
