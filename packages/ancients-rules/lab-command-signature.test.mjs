import test from 'node:test';
import assert from 'node:assert/strict';
import {SECTION_COMMAND_SIGNATURE_V2 as PREFIX, signSectionJournalCommand as sign,
  checkSectionJournalSignature as verify, matchesSectionJournalRetry as sameRetry}
  from './lab-command-signature.mjs';

const key = 'section_new_key_001';
const command = () => ({type:'PLAY_SECTION_CARD',actor:'A',expectedRevision:0,cardInstanceId:'example_card'});
const proof = (overrides = {}) => ({signature:sign(command(),key),command:command(),
  journalKey:key,sqlKey:key,...overrides});

test('new signatures use an explicit version and stable private command/key encoding', () => {
  assert.equal(sign(command(),key),sign(command(),key));
  assert.ok(sign(command(),key).startsWith(PREFIX));
  assert.equal(sign(command(),key),PREFIX+JSON.stringify({command:command(),idempotencyKey:key}));
});
test('valid v2 record is recognized as bound', () => {
  assert.equal(verify(proof()),'V2_BOUND');
});
test('deleting the private key cannot downgrade a v2 record to legacy', () => {
  assert.throws(()=>verify(proof({journalKey:null})),/SECTION_CCWB_HISTORY_TAMPERED/);
});
test('changing the SQLite key alone is detected', () => {
  assert.throws(()=>verify(proof({sqlKey:'other_sql_key_01'})),/SECTION_CCWB_HISTORY_TAMPERED/);
});
test('changing the private key alone is detected', () => {
  assert.throws(()=>verify(proof({journalKey:'other_private_key_01'})),/SECTION_CCWB_HISTORY_TAMPERED/);
});
test('changing the command without updating the signature is detected', () => {
  assert.throws(()=>verify(proof({command:{...command(),cardInstanceId:'other_card'}})),/SECTION_CCWB_HISTORY_TAMPERED/);
});
test('legacy keyless commands remain readable but are explicitly unbound', () => {
  assert.equal(verify({signature:JSON.stringify(command()),command:command(),journalKey:null,sqlKey:key}),
    'LEGACY_UNBOUND');
});
test('legacy commands containing a journal key still compare it against SQLite', () => {
  assert.equal(verify({signature:JSON.stringify(command()),command:command(),journalKey:key,sqlKey:key}),
    'LEGACY_UNBOUND');
  assert.throws(()=>verify({signature:JSON.stringify(command()),command:command(),
    journalKey:'other_private_key_01',sqlKey:key}),/SECTION_CCWB_HISTORY_TAMPERED/);
});
test('retries match both new and old signatures only for the same command', () => {
  assert.equal(sameRetry(sign(command(),key),command(),key),true);
  assert.equal(sameRetry(JSON.stringify(command()),command(),key),true);
  assert.equal(sameRetry(sign(command(),'different_key_001'),command(),key),false);
  assert.equal(sameRetry(JSON.stringify({...command(),expectedRevision:1}),command(),key),false);
});
test('malformed and unrecognized signature formats fail closed', () => {
  for (const signature of ['', '{not JSON}', 'CCW_SECTION_COMMAND_V3:'+JSON.stringify(command()),
    PREFIX+JSON.stringify({command:command(),idempotencyKey:'wrong_key_0001'})]) {
    assert.throws(()=>verify(proof({signature})),/SECTION_CCWB_HISTORY_TAMPERED/);
  }
});
test('invalid keys and caller-provided key fields are rejected', () => {
  assert.throws(()=>sign(command(),'short'),/SECTION_CCWB_SIGNATURE_INPUT_INVALID/);
  assert.throws(()=>sign({...command(),idempotencyKey:key},key),/SECTION_CCWB_SIGNATURE_INPUT_INVALID/);
  assert.throws(()=>verify(proof({sqlKey:'short'})),/SECTION_CCWB_HISTORY_TAMPERED/);
  assert.throws(()=>sameRetry('{}',command(),'short'),/SECTION_CCWB_SIGNATURE_INPUT_INVALID/);
});
