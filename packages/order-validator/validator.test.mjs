import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSyntheticOrderAssignment as check} from './validator.mjs';

const base = () => ({phaseState: {phase: 'ASSIGN_ORDERS', turn: 'A', revision: 4, pendingDecision: null}, activeCard: 'card_01'});
const input = (unitIds = ['a_left', 'a_shared']) => ({type: 'assign_synthetic_orders', actor: 'A', expectedRevision: 4, unitIds});
const context = () => ({
  cardProfiles: {card_01: {maxUnits: 2, allowedSectors: ['left']}},
  units: [
    {id: 'a_left', side: 'A', cell: {col: 1, row: 1}, orderable: true},
    {id: 'a_shared', side: 'A', cell: {col: 2, row: 2}, orderable: true},
    {id: 'a_center', side: 'A', cell: {col: 3, row: 2}, orderable: true},
    {id: 'a_blocked', side: 'A', cell: {col: 4, row: 2}, orderable: false},
    {id: 'b_enemy', side: 'B', cell: {col: 1, row: 2}, orderable: true}
  ],
  sectorMembership: {'1,1': ['left'], '2,2': ['left', 'center'], '3,2': ['center'],
    '4,2': ['left'], '1,2': ['left']}
});
const reason = (cmd, expected, state=base(), server=context()) => {
  assert.deepEqual(check(state, cmd, server), {accepted: false, reason: expected});
};

test('accept own units in granted sector and preserve order, without passing extra fields', () => {
  const selection = input();
  selection.actorOverride = 'B'; selection.cardProfiles = {card_01: {maxUnits:117}};
  assert.deepEqual(check(base(), selection, context()), {accepted: true, command: input()});
});

test('a hex shared by two sectors is eligible in either permitted sector', () => {
  const server = context(); server.cardProfiles.card_01.allowedSectors = ['center'];
  assert.equal(check(base(), input(['a_shared', 'a_center']), server).accepted, true);
  reason(input(['a_left']), 'UNIT_NOT_ELIGIBLE', base(), server);
});

test('empty selection is permitted without automatically ordering extra units', () => {
  assert.deepEqual(check(base(), input([]), context()).command.unitIds, []);
});

test('enforce explicit per-card order limit', () => {
  reason(input(['a_left', 'a_shared', 'a_center']), 'ORDER_LIMIT_EXCEEDED');
});

test('reject wrong sector, unavailable, enemy and missing units without distinguishing secrets', () => {
  for (const id of ['a_center', 'a_blocked', 'b_enemy', 'not_real']) {
    reason(input([id]), 'UNIT_NOT_ELIGIBLE');
  }
});

test('reject duplicate unit IDs and invalid command inputs', () => {
  for (const ids of [['a_left', 'a_left'], ['bad id'], 'a_left', Array(118).fill('a_left')]) {
    reason(input(ids), 'INVALID_ORDER_COMMAND');
  }
  reason(null, 'INVALID_ORDER_COMMAND');
  reason({...input(), type: 'finish_synthetic_movement'}, 'INVALID_ORDER_COMMAND');
});

test('reject stale revision, wrong player and wrong phase before eligibility details', () => {
  reason({...input(), expectedRevision: 3}, 'STALE_REVISION');
  reason({...input(), actor: 'B'}, 'NOT_ACTING_PLAYER');
  reason(input(), 'WRONG_PHASE', {...base(), phaseState: {...base().phaseState, phase: 'MOVEMENT'}});
  reason(input(), 'WRONG_PHASE', {...base(), phaseState: {...base().phaseState, pendingDecision: {actor:'B'}}});
});

test('unknown card instances fail closed rather than accepting generic orders', () => {
  const server = context();
  delete server.cardProfiles.card_01;
  reason(input(), 'UNSUPPORTED_CARD', base(), server);
});

test('reject corrupt trusted card profiles and invalid server rosters', () => {
  for (const profile of [{maxUnits: 0, allowedSectors:['left']},
    {maxUnits: 118, allowedSectors:['left']},
    {maxUnits: 2, allowedSectors:['unknown']},
    {maxUnits: 2, allowedSectors:['left','left']}]) {
    const server = context(); server.cardProfiles.card_01 = profile;
    assert.throws(() => check(base(), input(), server), /INVALID_SERVER_CARD_PROFILE/);
  }
  const invalid = context(); invalid.units.push({...invalid.units[0]});
  assert.throws(() => check(base(), input(), invalid), /INVALID_SERVER_UNIT_ROSTER/);
  const offboard = context(); offboard.units[0].cell.col = 13;
  assert.throws(() => check(base(), input(), offboard), /INVALID_SERVER_UNIT_ROSTER/);
  const missingSector = context(); delete missingSector.sectorMembership['2,2'];
  assert.throws(() => check(base(), input(), missingSector), /INVALID_SERVER_SECTOR_DATA/);
  assert.throws(() => check(base(), input(), null), /INVALID_SERVER_ORDER_CONTEXT/);
});

test('validation does not mutate state, command, or server-owned definitions', () => {
  const snapshot = base(), command = input(), server = context();
  const originals = structuredClone([snapshot, command, server]);
  const result = check(snapshot, command, server);
  result.command.unitIds[0] = 'other';
  assert.deepEqual([snapshot, command, server], originals);
});

test('invalid order snapshots are rejected explicitly', () => {
  assert.throws(() => check(null, input(), context()), /INVALID_ORDER_SNAPSHOT/);
  assert.throws(() => check({...base(), activeCard: null}, input(), context()), /INVALID_ORDER_SNAPSHOT/);
});
