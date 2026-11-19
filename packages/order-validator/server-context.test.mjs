import test from 'node:test';
import assert from 'node:assert/strict';
import {createServerSyntheticOrderContext as context} from './server-context.mjs';
import {validateSyntheticOrderAssignment as validate} from './validator.mjs';

const board = () => [
  {id:'synthetic-a',side:'A',col:3,row:4},
  {id:'synthetic-b',side:'B',col:9,row:4},
  {id:'reserve-a',side:'A',col:4,row:6,orderable:false}
];
const state = () => ({phaseState:{phase:'ASSIGN_ORDERS',turn:'A',revision:1,pendingDecision:null},activeCard:'synthetic_card_01'});
const command = (unitIds) => ({type:'assign_synthetic_orders',actor:'A',expectedRevision:1,unitIds});

test('server-owned board derives synthetic context without changing input', () => {
  const src=board(), before=structuredClone(src), c=context(src,'synthetic_card_01');
  assert.deepEqual(src,before);
  assert.deepEqual(c.sectorMembership['4,6'],['left','center']);
  assert.deepEqual(c.sectorMembership['9,4'],['right']);
  assert.equal(c.cardProfiles.synthetic_card_01.maxUnits,2);
  assert.equal(c.units[2].orderable,false);
});
test('valid existing own-side unit is accepted and sanitized', () => {
  const x=validate(state(),command(['synthetic-a']),context(board(),'synthetic_card_01'));
  assert.equal(x.accepted,true);
  assert.deepEqual(x.command.unitIds,['synthetic-a']);
});
test('enemy, missing and unavailable units all fail without information leakage', () => {
  const c=context(board(),'synthetic_card_01');
  for (const id of ['synthetic-b','unknown','reserve-a']) {
    assert.deepEqual(validate(state(),command([id]),c),{accepted:false,reason:'UNIT_NOT_ELIGIBLE'});
  }
});
test('reject excessive orders, duplicates, invalid IDs and stale revision', () => {
  const c=context(board(),'synthetic_card_01');
  assert.deepEqual(validate(state(),command(['synthetic-a','synthetic-b','reserve-a']),c),{accepted:false,reason:'ORDER_LIMIT_EXCEEDED'});
  assert.deepEqual(validate(state(),command(['synthetic-a','synthetic-a']),c),{accepted:false,reason:'INVALID_ORDER_COMMAND'});
  assert.deepEqual(validate(state(),command(['bad id']),c),{accepted:false,reason:'INVALID_ORDER_COMMAND'});
  assert.deepEqual(validate(state(),{...command([]),expectedRevision:0},c),{accepted:false,reason:'STALE_REVISION'});
});
test('invalid board IDs, occupied cells and out-of-bounds positions fail closed', () => {
  const invalid=[
    [{id:'invalid ID',side:'A',col:3,row:3}],
    [{id:'x',side:'C',col:3,row:3}],
    [{id:'x',side:'A',col:13,row:3}],
    [{id:'x',side:'A',col:3,row:3,orderable:'yes'}],
    [{id:'x',side:'A',col:3,row:3},{id:'y',side:'B',col:3,row:3}],
    [{id:'x',side:'A',col:3,row:3},{id:'x',side:'A',col:4,row:3}]
  ];
  for (const value of invalid) assert.throws(()=>context(value,'card'),/INVALID_SERVER_BOARD_UNIT|DUPLICATE_SERVER_BOARD_UNIT/);
  assert.throws(()=>context(null,'card'),/INVALID_SERVER_ORDER_SETUP/);
  assert.throws(()=>context(board(),'bad card'),/INVALID_SERVER_ORDER_SETUP/);
});
test('empty-order case succeeds without creating an imaginary unit', () => {
  assert.deepEqual(validate(state(),command([]),context([],'synthetic_card_01')).command.unitIds,[]);
});
