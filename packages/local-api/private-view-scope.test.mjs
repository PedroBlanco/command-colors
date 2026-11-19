import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateViewScope} from './private-view-scope.mjs';

const A = '123e4567-e89b-42d3-a456-426614174000';
const B = '123e4567-e89b-42d3-a456-426614174001';

test('capture is immutable and current before a session change', () => {
  const scope = createPrivateViewScope();
  const initial = scope.capture();
  assert.equal(Object.isFrozen(initial), true);
  assert.equal(scope.isCurrent(initial), true);
  assert.equal(scope.isCurrent(initial, A), false);
});

test('switching match invalidates a pending command response', () => {
  const scope = createPrivateViewScope();
  scope.selectMatch(A);
  const pending = scope.capture();
  scope.selectMatch(B);
  assert.equal(scope.isCurrent(pending, A), false);
  assert.equal(scope.isCurrent(scope.capture(), B), true);
});

test('same-match refresh preserves existing response scope', () => {
  const scope = createPrivateViewScope();
  scope.selectMatch(A);
  const ticket = scope.capture();
  scope.selectMatch(A);
  assert.equal(scope.isCurrent(ticket, A), true);
});

test('logout invalidates old responses even if the next login selects the same match', () => {
  const scope = createPrivateViewScope();
  scope.selectMatch(A);
  const old = scope.capture();
  scope.reset();
  assert.equal(scope.isCurrent(old, A), false);
  scope.selectMatch(A);
  assert.equal(scope.isCurrent(old, A), false);
  assert.equal(scope.isCurrent(scope.capture(), A), true);
});

test('repeated reset invalidates responses from each previous identity', () => {
  const scope = createPrivateViewScope();
  const old = scope.capture();
  scope.reset();
  const second = scope.capture();
  scope.reset();
  assert.equal(scope.isCurrent(old), false);
  assert.equal(scope.isCurrent(second), false);
});

test('mismatched match cannot be accepted, even at the same generation', () => {
  const scope = createPrivateViewScope();
  scope.selectMatch(A);
  assert.equal(scope.isCurrent(scope.capture(), B), false);
});

test('malformed match identifiers fail closed without changing the current scope', () => {
  const scope = createPrivateViewScope();
  scope.selectMatch(A);
  const ticket = scope.capture();
  for (const invalid of [null, 1, '', '../secret', 'a'.repeat(35), 'x'.repeat(36)]) {
    assert.throws(() => scope.selectMatch(invalid), /INVALID_MATCH_ID/);
  }
  assert.equal(scope.isCurrent(ticket, A), true);
});

test('a response from an old session with the same ID never becomes current again', () => {
  const scope = createPrivateViewScope();
  scope.selectMatch(A);
  const t1 = scope.capture();
  scope.selectMatch(B);
  scope.selectMatch(A);
  assert.equal(scope.isCurrent(t1, A), false);
});

test('tickets cannot be forged by replacing an ID without a matching generation', () => {
  const scope = createPrivateViewScope();
  scope.selectMatch(A);
  const saved = scope.capture();
  scope.selectMatch(B);
  assert.equal(scope.isCurrent({...saved, matchId: B}, B), false);
});

test('the API intentionally exposes no session secrets or network operations', () => {
  const scope = createPrivateViewScope();
  assert.deepEqual(Object.keys(scope).sort(), ['capture', 'isCurrent', 'reset', 'selectMatch']);
  assert.equal(Object.isFrozen(scope), true);
});
