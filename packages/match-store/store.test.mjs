import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMatchStore, openLocalFileStore} from './store.mjs';

const command = (actor, rev, key='command_1234') => ({actor, type:'pass_demo_turn', expectedRevision:rev, idempotencyKey:key});

test('proyección: cada actor recibe solo su mano y unidades públicas', () => {
  const store=createMatchStore(), a=store.view('A'), b=store.view('B');
  assert.equal(store.view('E'),null);
  assert.equal(JSON.stringify(a).includes('PRIVATE_B_'),false);
  assert.equal(JSON.stringify(b).includes('PRIVATE_A_'),false);
  assert.equal(JSON.stringify(a).includes('UNREVEALED_'),false);
  assert.equal(a.opponentCardCount,3);
  assert.deepEqual(a.board,b.board);
  a.board[0].id='tampered'; a.yourHand.push('fake');
  assert.equal(store.view('A').board[0].id,'unit-a');
  assert.equal(store.view('A').yourHand.length,2);
});

test('autorización, fase y datos erróneos nunca modifican el estado', async () => {
  const store=createMatchStore();
  assert.equal((await store.dispatch(command('C',0))).code,'FORBIDDEN');
  assert.equal((await store.dispatch(command('B',0))).code,'NOT_YOUR_TURN');
  assert.equal((await store.dispatch(command('A',0,'x'))).code,'INVALID_COMMAND');
  assert.equal(store.view('A').revision,0);
  assert.deepEqual(store.publicEvents('A'),[]);
  assert.equal(store.publicEvents('C'),null);
});

test('concurrencia optimista: una única acción de dos solicitudes simultáneas', async () => {
  const store=createMatchStore();
  const results=await Promise.all([store.dispatch(command('A',0,'attempt_001')),store.dispatch(command('A',0,'attempt_002'))]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal(store.view('B').revision,1);
  assert.equal(store.publicEvents('B').length,1);
});

test('idempotencia: reintento con clave igual no repite ni revela secretos', async () => {
  const store=createMatchStore();
  assert.equal((await store.dispatch(command('A',0))).code,'APPLIED');
  assert.equal((await store.dispatch(command('A',0))).code,'ALREADY_APPLIED');
  assert.equal((await store.dispatch(command('A',1))).code,'IDEMPOTENCY_KEY_REUSED');
  assert.equal(store.view('A').revision,1);
  assert.equal(store.publicEvents('A').length,1);
  assert.equal(JSON.stringify(store.publicEvents('A')).includes('PRIVATE_'),false);
});

test('transacción simulada: error de escritura no altera estado; reintento posible', async () => {
  let fails=true;
  const store=createMatchStore({commitSnapshot: async () => {if(fails) throw new Error('DISK_FAILURE');}});
  await assert.rejects(store.dispatch(command('A',0)),/DISK_FAILURE/);
  assert.equal(store.view('A').revision,0);
  fails=false;
  assert.equal((await store.dispatch(command('A',0))).code,'APPLIED');
  assert.equal(store.view('A').revision,1);
});

test('fichero local: recupera revisión, turno, eventos e idempotencia tras reabrir', async () => {
  const dir=await mkdtemp(join(tmpdir(),'ccw-store-'));
  const file=join(dir,'match.json');
  try {
    const first=await openLocalFileStore(file);
    assert.equal((await first.dispatch(command('A',0))).code,'APPLIED');
    const second=await openLocalFileStore(file);
    assert.equal(second.view('A').revision,1);
    assert.equal(second.view('A').turn,'B');
    assert.equal(second.publicEvents('A')[0].type,'DEMO_TURN_PASSED');
    assert.equal((await second.dispatch(command('A',0))).code,'ALREADY_APPLIED');
    assert.equal((await second.dispatch(command('B',1,'command_b5678'))).code,'APPLIED');
    const third=await openLocalFileStore(file);
    assert.equal(third.view('A').revision,2);
    assert.equal(third.publicEvents('B').length,2);
    const raw=await readFile(file,'utf8');
    assert.ok(raw.includes('UNREVEALED_1')); // secretos solo en archivo del servidor
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('snapshot corrupto: rechaza carga sin sobrescribir el archivo', async () => {
  const dir=await mkdtemp(join(tmpdir(),'ccw-corrupt-'));
  const file=join(dir,'match.json');
  try {
    await writeFile(file,'INVALID_JSON');
    await assert.rejects(openLocalFileStore(file),SyntaxError);
    assert.equal(await readFile(file,'utf8'),'INVALID_JSON');
  } finally {await rm(dir,{recursive:true,force:true});}
});
