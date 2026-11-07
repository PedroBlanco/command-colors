/** End-to-end executable launcher test; only synthetic data and a loopback listener. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtemp, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const launcher = join(root, 'scripts', 'browser-lab.mjs');
const headers = origin => ({'origin': origin, 'x-ccw-request': '1', 'content-type': 'application/json'});

async function unusedPort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function startLab(file, port) {
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [launcher, file], {
    cwd: root, env: {...process.env, CCW_LAB_PORT: String(port)},
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '', settled = false;
  try {
    await new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error('LAB_START_TIMEOUT')), 15000);
      const ready = () => {
        if (settled || !stdout.includes(`Laboratorio del navegador: ${origin}`)) return;
        settled = true;
        clearTimeout(timer);
        done();
      };
      child.stdout.on('data', data => { stdout += data.toString('utf8'); ready(); });
      child.once('error', error => {clearTimeout(timer); fail(error);});
      child.once('exit', code => {
        if (!settled) {clearTimeout(timer);fail(new Error(`LAB_EXIT_${code}`));}
      });
    });
    const passwords = {};
    for (const match of stdout.matchAll(/Cuenta de prueba (alice|bob): ([A-Za-z0-9_-]+)/g)) {
      passwords[match[1]] = match[2];
    }
    return {child, origin, passwords};
  } catch (error) {
    child.kill();
    throw error;
  }
}

async function stopLab(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('LAB_STOP_TIMEOUT')), 10000);
    child.once('exit', () => {clearTimeout(timeout);resolve();});
    child.kill('SIGTERM');
  });
}

async function request(origin, method, path, {cookie, body} = {}) {
  const response = await fetch(origin + path, {
    method, headers: {
      ...(cookie ? {cookie} : {}),
      ...(method === 'GET' ? {} : headers(origin))
    },
    ...(body === undefined ? {} : {body: JSON.stringify(body)})
  });
  return {status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')};
}

async function login(origin, handle, password) {
  const result = await request(origin, 'POST', '/api/session', {body: {handle, password}});
  assert.equal(result.status, 200);
  assert.equal('token' in result.body, false);
  assert.match(result.cookie ?? '', /HttpOnly/);
  return result.cookie.split(';')[0];
}

test('launcher real: primera ejecución, dos jugadores, cierre y reinicio sin perder partida', {timeout: 45000}, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ccw-launcher-e2e-'));
  const file = join(dir, 'synthetic.sqlite');
  let first, second;
  try {
    first = await startLab(file, await unusedPort());
    assert.equal(Object.keys(first.passwords).length, 2);
    assert.notEqual(first.passwords.alice, first.passwords.bob);
    assert.equal((await fetch(first.origin + '/')).status, 200);
    assert.equal((await fetch(first.origin + '/browser-ui.mjs')).status, 200);
    const a = await login(first.origin, 'alice', first.passwords.alice);
    const b = await login(first.origin, 'bob', first.passwords.bob);
    const created = await request(first.origin, 'POST', '/api/matches', {cookie: a});
    assert.equal(created.status, 201);
    const id = created.body.matchId;
    assert.equal((await request(first.origin, 'GET', `/api/matches/${id}`, {cookie: b})).status, 404);
    const invitation = await request(first.origin, 'POST', `/api/matches/${id}/invitations`, {
      cookie: a, body: {targetHandle: 'bob'}
    });
    assert.equal(invitation.status, 201);
    assert.equal((await request(first.origin, 'POST', '/api/invitations/accept', {
      cookie: b, body: {invitationToken: invitation.body.token}
    })).status, 200);
    const cmd = await request(first.origin, 'POST', `/api/matches/${id}/commands`, {
      cookie: a, body: {type: 'pass_demo_turn', expectedRevision: 0, idempotencyKey: 'launcher_recover_001'}
    });
    assert.equal(cmd.status, 200);
    await stopLab(first.child);
    first = null;
    second = await startLab(file, await unusedPort());
    assert.deepEqual(second.passwords, {}); // credentials shown only during initial provisioning
    const restored = await request(second.origin, 'GET', `/api/matches/${id}`, {cookie: b});
    assert.equal(restored.status, 200);
    assert.equal(restored.body.state.revision, 1);
    assert.equal(restored.body.state.turn, 'B');
    assert.deepEqual(restored.body.state.yourHand, ['PRIVATE_B_1','PRIVATE_B_2','PRIVATE_B_3']);
    assert.equal(JSON.stringify(restored.body).includes('PRIVATE_A_'), false);
    const events = await request(second.origin, 'GET', `/api/matches/${id}/events`, {cookie: a});
    assert.equal(events.status, 200);
    assert.equal(events.body.events.length, 1);
  } finally {
    if (first?.child) await stopLab(first.child);
    if (second?.child) await stopLab(second.child);
    await rm(dir, {recursive: true, force: true});
  }
});

test('launcher: puerto ocupado no crea una base sin credenciales recuperables', {timeout: 10000}, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ccw-launcher-port-'));
  const file = join(dir, 'should-not-exist.sqlite');
  const blocker = createServer();
  blocker.listen(0, '127.0.0.1');
  await once(blocker, 'listening');
  const port = blocker.address().port;
  try {
    const result = spawnSync(process.execPath, [launcher, file], {
      cwd: root, env: {...process.env, CCW_LAB_PORT: String(port)},
      windowsHide: true, encoding: 'utf8', timeout: 8000
    });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(file), false);
    assert.equal(result.stdout.includes('Cuenta de prueba'), false);
  } finally {
    await new Promise(resolve => blocker.close(resolve));
    await rm(dir, {recursive: true, force: true});
  }
});
