import test from 'node:test';
import assert from 'node:assert/strict';
import {generateDigitalRoll, recordPhysicalRoll} from './dice.mjs';

const spec = () => ({rollId: 'roll_1', actor: 'A', diceCount: 3, dieFaces: ['RED', 'BLUE', 'FLAG', 'RED']});
const typeError = (f, code) => assert.throws(f, error => error instanceof TypeError && error.message === code);

test('digital dice: injected indices produce reproducible, ordered results (T-011)', () => {
  const indices = [3, 1, 2]; let calls = 0;
  const result = generateDigitalRoll(spec(), limit => { assert.equal(limit, 4); return indices[calls++]; });
  assert.equal(calls, 3);
  assert.deepEqual(result, {type: 'DICE_ROLLED_SYNTHETIC', rollId: 'roll_1', actor: 'A',
    source: 'DIGITAL', diceCount: 3, results: ['RED','BLUE','FLAG'], verification: 'SERVER_GENERATED'});
});

test('digital dice: default cryptographic source emits only configured symbols', () => {
  const result = generateDigitalRoll(spec());
  assert.equal(result.results.length, 3);
  assert.ok(result.results.every(face => spec().dieFaces.includes(face)));
  assert.equal('seed' in result, false);
  assert.equal('dieFaces' in result, false);
});

test('duplicate face slots are supported as distinct random slots', () => {
  const result = generateDigitalRoll({...spec(), diceCount: 2}, () => 3);
  assert.deepEqual(result.results, ['RED', 'RED']);
});

test('physical dice: exact symbols and count can be recorded (T-013)', () => {
  const result = recordPhysicalRoll(spec(), ['FLAG','RED','BLUE']);
  assert.equal(result.source, 'PHYSICAL');
  assert.equal(result.verification, 'PLAYER_DECLARED');
  assert.deepEqual(result.results, ['FLAG','RED','BLUE']);
});

test('equal digital and physical faces provide equal downstream results, with different provenance', () => {
  const digital = generateDigitalRoll(spec(), (() => {const values=[2,0,1];let n=0;return()=>values[n++];})());
  const physical = recordPhysicalRoll(spec(), ['FLAG','RED','BLUE']);
  assert.deepEqual(digital.results, physical.results);
  assert.notEqual(digital.verification, physical.verification);
});

test('input specification and physical declarations are not mutated or shared', () => {
  const definition = spec(), declarations = ['RED','FLAG','BLUE'];
  const before = structuredClone(definition);
  const result = recordPhysicalRoll(definition, declarations);
  result.results[0] = 'BLUE';
  assert.deepEqual(definition, before);
  assert.deepEqual(declarations, ['RED','FLAG','BLUE']);
});

test('reject invalid roll IDs, actor or specification shape', () => {
  typeError(() => generateDigitalRoll(null), 'INVALID_ROLL_SPEC');
  typeError(() => generateDigitalRoll([]), 'INVALID_ROLL_SPEC');
  typeError(() => generateDigitalRoll({...spec(), rollId: '../escape'}), 'INVALID_ROLL_ID');
  typeError(() => recordPhysicalRoll({...spec(), actor: 'admin'}, ['RED','RED','RED']), 'INVALID_ROLL_ACTOR');
});

test('reject invalid dice count, including fractional, huge or zero', () => {
  for (const diceCount of [0, -1, 1.5, 33, Infinity, '3']) {
    typeError(() => generateDigitalRoll({...spec(), diceCount}, () => 0), 'INVALID_DICE_COUNT');
  }
});

test('reject invalid face sets, empty and noncanonical IDs', () => {
  for (const dieFaces of [[], ['RED'], ['red','FLAG'], ['RED',null], new Array(17).fill('RED')]) {
    typeError(() => generateDigitalRoll({...spec(), dieFaces}, () => 0), 'INVALID_DIE_FACES');
  }
});

test('reject missing or invalid digital randomness provider', () => {
  typeError(() => generateDigitalRoll(spec(), null), 'INVALID_RANDOM_SOURCE');
  for (const output of [-1, 4, 1.5, NaN, '1', Infinity]) {
    typeError(() => generateDigitalRoll(spec(), () => output), 'INVALID_RANDOM_RESULT');
  }
});

test('reject invalid physical count and unknown symbols (T-012)', () => {
  for (const faces of [null, [], ['RED','FLAG'], ['RED','FLAG','BLUE','RED'],
    ['RED','FLAG','INVALID'], ['RED',null,'BLUE'], 'RED,FLAG,BLUE']) {
    typeError(() => recordPhysicalRoll(spec(), faces), 'INVALID_PHYSICAL_DECLARATION');
  }
});

test('physical declarations preserve duplicates and cannot alter the server-selected dice count', () => {
  const result = recordPhysicalRoll(spec(), ['RED','RED','RED']);
  assert.equal(result.diceCount, 3);
  assert.deepEqual(result.results, ['RED','RED','RED']);
  typeError(() => recordPhysicalRoll(spec(), ['RED','RED','RED','RED']), 'INVALID_PHYSICAL_DECLARATION');
});
