import test from 'node:test';
import assert from 'node:assert/strict';
import {bindLabJournalIdempotency as bind, readLabJournalIdempotency as read} from './lab-idempotency-binding.mjs';

const command=()=>({type:'PLAY_SECTION_CARD',actor:'A',expectedRevision:0,cardInstanceId:'card_a'});

test('binds private idempotency key without mutating original command',()=>{
  const input=command();const result=bind(input,'section_key_001');
  assert.equal(result.idempotencyKey,'section_key_001');
  assert.equal(Object.hasOwn(input,'idempotencyKey'),false);
  assert.equal(Object.isFrozen(result),true);
});
test('replay extracts same canonical signed command with metadata excluded',()=>{
  const original=command();const {command:replayed,idempotencyKey,legacyUnverified}=read(bind(original,'section_key_002'));
  assert.deepEqual(replayed,original);
  assert.equal(JSON.stringify(replayed),JSON.stringify(original));
  assert.equal(idempotencyKey,'section_key_002');
  assert.equal(legacyUnverified,false);
});
test('legacy entries retain old signature but are explicitly marked unverified',()=>{
  const original=command();const result=read(original);
  assert.deepEqual(result.command,original);
  assert.equal(result.idempotencyKey,null);
  assert.equal(result.legacyUnverified,true);
});
test('rejects invalid empty, short and long keys',()=>{
  for(const key of [null,3,'', 'short','a'.repeat(81),'embedded space','ññññññññ']){
    assert.throws(()=>bind(command(),key),/IDEMPOTENCY_BINDING_INVALID/);
    assert.throws(()=>read({...command(),idempotencyKey:key}),/IDEMPOTENCY_BINDING_INVALID/);
  }
});
test('rejects forged key already embedded inside a command',()=>{
  assert.throws(()=>bind({...command(),idempotencyKey:'forged_value'},'section_key_003'),/IDEMPOTENCY_BINDING_INVALID/);
});
test('rejects arrays, null and prototype-bearing records',()=>{
  for(const value of [null,[],new Date(),Object.create(null)]){
    assert.throws(()=>bind(value,'section_key_004'),/IDEMPOTENCY_BINDING_INVALID/);
    assert.throws(()=>read(value),/IDEMPOTENCY_BINDING_INVALID/);
  }
});
test('keeps private key out of signed command after replay',()=>{
  const entry=bind(command(),'section_key_005');
  const output=read(entry);
  assert.equal(JSON.stringify(output.command).includes('section_key_005'),false);
  assert.equal(entry.idempotencyKey,'section_key_005');
});
test('metadata binding protects caller from later nested mutations',()=>{
  const original={...command(),payload:{selected:['unit_a']}};
  const entry=bind(original,'section_key_006');
  original.payload.selected[0]='unit_b';
  assert.deepEqual(entry.payload.selected,['unit_a']);
});
