import test from 'node:test';
import assert from 'node:assert/strict';
import {ANCIENTS_RULESET} from './movement-profile.mjs';
import {screenAncientsCombatTurn as screen} from './combat-turn-guard.mjs';

const state = (updates = {}) => ({
  schemaVersion:1, ruleset:ANCIENTS_RULESET, status:'ACTIVE',
  turn:'A', phase:'COMBAT', revision:8,
  orderedUnitIds:['a1'], resolvedBattleUnitIds:[],
  movedStepsByUnit:{a1:0}, pendingCombat:null, pendingDecision:null,
  ...updates
});
const check = (changes = {}, attempt = {}) => screen({
  turnState: state(changes), sessionSide:'A',
  attackerId:'a1', targetId:'b1', expectedRevision:8, ...attempt
});

test('valid owned ordered unit enters only CANDIDATE, never attack authorization', () => {
  const r=check();
  assert.equal(r.status,'CANDIDATE');
  assert.equal(r.reason,null);
  assert.equal(r.movedSteps,0);
  assert.equal(r.revision,8);
  assert.equal(r.attackAuthorized,false);
  assert.equal(r.commandCardValidated,false);
  assert.equal(r.needsFullLegalityCheck,true);
  assert.equal(Object.isFrozen(r),true);
});

test('current revision is compulsory and stale requests cannot pass', () => {
  assert.equal(check({}, {expectedRevision:7}).reason,'STALE_REVISION');
  assert.equal(check({}, {expectedRevision:9}).reason,'STALE_REVISION');
});

test('acting identity must originate from a known authenticated session', () => {
  assert.equal(check({}, {sessionSide:'B'}).reason,'NOT_ACTING_PLAYER');
  assert.equal(check({}, {sessionSide:null}).reason,'SESSION_SIDE_REQUIRED');
  assert.equal(check({}, {sessionSide:'admin'}).reason,'SESSION_SIDE_REQUIRED');
});

test('every non-combat phase blocks a declaration', () => {
  for (const phase of ['AWAIT_CARD','ASSIGN_ORDERS','MOVEMENT','DRAW_CARD'])
    assert.equal(check({phase}).reason,'WRONG_PHASE');
});

test('finished game does not permit another attack', () => {
  assert.equal(check({status:'FINISHED'}).reason,'MATCH_NOT_ACTIVE');
});

test('pending combat prevents a concurrent declaration', () => {
  assert.equal(check({pendingCombat:{kind:'RANGED', attackerId:'a1'}}).reason,
    'COMBAT_OR_DECISION_PENDING');
});

test('pending defensive decision prevents bypassing defender', () => {
  assert.equal(check({pendingDecision:{kind:'DEFENSE_CHOICE'}}).reason,
    'COMBAT_OR_DECISION_PENDING');
});

test('an un-ordered attacker is blocked even when an opponent is in range', () => {
  assert.equal(check({orderedUnitIds:[],movedStepsByUnit:{} }).reason,'UNIT_NOT_ELIGIBLE');
  assert.equal(check({}, {attackerId:'a2'}).reason,'UNIT_NOT_ELIGIBLE');
});

test('unit cannot attack twice in its ordinary turn', () => {
  assert.equal(check({resolvedBattleUnitIds:['a1']}).reason,'UNIT_ALREADY_BATTLED');
});

test('a movement record is required; never assume that unit remained still', () => {
  assert.equal(check({movedStepsByUnit:{}}).reason,'MISSING_SERVER_MOVEMENT_RECORD');
});

test('the result derives moved steps strictly from the turn snapshot', () => {
  assert.equal(check({movedStepsByUnit:{a1:2}}).movedSteps,2);
  assert.equal(check({movedStepsByUnit:Object.assign(Object.create(null),{a1:1})}).movedSteps,1);
});

test('synthetic turn state cannot be mistaken for the official guard context', () => {
  assert.throws(()=>check({ruleset:'synthetic-phases-v1'}),/INVALID_ANCIENTS_TURN_STATE/);
});

test('reject duplicate, contradictory and malformed server turn records', () => {
  for (const updates of [
    {orderedUnitIds:['a1','a1']}, {orderedUnitIds:['__proto__']},
    {resolvedBattleUnitIds:['b1']}, {resolvedBattleUnitIds:['a1','a1']},
    {movedStepsByUnit:{a1:1,b1:0}}, {movedStepsByUnit:{a1:-1}},
    {movedStepsByUnit:{a1:1.5}}, {movedStepsByUnit:Object.create({a1:0})},
    {orderedUnitIds:null}, {pendingDecision:1}, {pendingCombat:'pending'},
    {revision:-1}, {phase:'MAGIC'}, {turn:'X'}, {schemaVersion:2},
    {ruleset:undefined}, {status:'PAUSED'}
  ]) assert.throws(()=>check(updates),/INVALID_ANCIENTS_TURN_STATE/);
});

test('reject malformed declarations rather than allowing default revision or target', () => {
  for (const attempt of [
    {attackerId:''}, {attackerId:'__proto__'}, {targetId:'a1'},
    {targetId:null}, {expectedRevision:null}, {expectedRevision:-1},
    {expectedRevision:0.5}, {expectedRevision:undefined}
  ]) assert.throws(()=>check({},attempt),/INVALID_COMBAT_DECLARATION/);
});

test('snapshots remain unchanged and frozen result has no replayable command', () => {
  const turnState=state({orderedUnitIds:['a1','a2'],movedStepsByUnit:{a1:1,a2:0}});
  const original=structuredClone(turnState);
  const result=screen({turnState,sessionSide:'A',attackerId:'a1',targetId:'b1',expectedRevision:8});
  assert.equal(result.status,'CANDIDATE');
  assert.deepEqual(turnState,original);
  assert.equal('nextState' in result,false);
  assert.equal('events' in result,false);
});
