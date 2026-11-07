import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createLocalTestComposition} from './compose.mjs';

const PASSWORD = 'test-only-never-use-outside-tests-1234';

async function start() {
  const services = createLocalTestComposition();
  for (const handle of ['alice', 'bob', 'carol']) {
    const provisioned = await services.identity.provisionAccount({handle, password: PASSWORD});
    assert.equal(provisioned.ok, true);
  }
  const server = services.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function call(method, path, {token, data} = {}) {
    const response = await fetch(origin + path, {
      method,
      headers: {
        ...(token ? {authorization: `Bearer ${token}`} : {}),
        ...(data !== undefined ? {'content-type': 'application/json'} : {})
      },
      ...(data !== undefined ? {body: JSON.stringify(data)} : {})
    });
    return {status: response.status, value: await response.json()};
  }
  async function login(handle) {
    const result = await call('POST', '/api/session', {data: {handle, password: PASSWORD}});
    assert.equal(result.status, 200);
    assert.ok(result.value.token);
    return result.value.token;
  }
  async function shutdown() {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  return {services, call, login, shutdown};
}

async function readyMatch(env) {
  const {call, login} = env;
  const a = await login('alice');
  const b = await login('bob');
  const c = await login('carol');
  const created = await call('POST', '/api/matches', {token: a});
  assert.equal(created.status, 201);
  const id = created.value.matchId;
  assert.match(id, /^[0-9a-f-]{36}$/);

  // Before acceptance, only A can inspect the waiting lobby and it has no hand.
  const waiting = await call('GET', `/api/matches/${id}`, {token: a});
  assert.equal(waiting.status, 200);
  assert.equal(waiting.value.status, 'INVITING');
  assert.equal('state' in waiting.value, false);
  assert.equal((await call('GET', `/api/matches/${id}`, {token: b})).status, 404);
  assert.equal((await call('GET', `/api/matches/${id}`, {token: c})).status, 404);

  const issued = await call('POST', `/api/matches/${id}/invitations`, {token: a, data: {targetHandle: 'bob'}});
  assert.equal(issued.status, 201);
  const accepted = await call('POST', '/api/invitations/accept', {
    token: b, data: {invitationToken: issued.value.token}
  });
  assert.equal(accepted.status, 200);
  return {id, a, b, c};
}

test('real integration: invitation, private projections, and rejected third party', async () => {
  const env = await start();
  try {
    const {id, a, b, c} = await readyMatch(env);
    const [ra, rb, rc] = await Promise.all([
      env.call('GET', `/api/matches/${id}`, {token: a}),
      env.call('GET', `/api/matches/${id}`, {token: b}),
      env.call('GET', `/api/matches/${id}`, {token: c})
    ]);
    assert.equal(ra.status, 200);
    assert.equal(rb.status, 200);
    assert.equal(rc.status, 404);
    assert.equal(ra.value.state.matchId, id);
    assert.equal(rb.value.state.matchId, id);
    assert.equal(ra.value.state.you, 'A');
    assert.equal(rb.value.state.you, 'B');
    assert.equal(ra.value.state.opponentCardCount, 3);
    assert.equal(rb.value.state.opponentCardCount, 2);
    assert.equal(JSON.stringify(ra.value).includes('PRIVATE_B_'), false);
    assert.equal(JSON.stringify(rb.value).includes('PRIVATE_A_'), false);
    assert.equal(JSON.stringify(ra.value).includes('UNREVEALED_'), false);
    assert.equal(JSON.stringify(rb.value).includes('UNREVEALED_'), false);
  } finally { await env.shutdown(); }
});

test('real integration: client-supplied actor is ignored, revisions and retry are enforced', async () => {
  const env = await start();
  try {
    const {id, a, b, c} = await readyMatch(env);
    const url = `/api/matches/${id}/commands`;
    const key = 'first_request_test';
    const spoofB = await env.call('POST', url, {
      token: b, data: {actor: 'A', type: 'pass_demo_turn', expectedRevision: 0, idempotencyKey: key}
    });
    assert.equal(spoofB.status, 403);
    assert.equal(spoofB.value.code, 'NOT_YOUR_TURN');
    const applied = await env.call('POST', url, {
      token: a, data: {actor: 'B', type: 'pass_demo_turn', expectedRevision: 0, idempotencyKey: key}
    });
    assert.equal(applied.status, 200);
    assert.equal(applied.value.state.you, 'A');
    assert.equal(applied.value.state.revision, 1);
    const retry = await env.call('POST', url, {
      token: a, data: {type: 'pass_demo_turn', expectedRevision: 0, idempotencyKey: key}
    });
    assert.equal(retry.status, 200);
    assert.equal(retry.value.code, 'ALREADY_APPLIED');
    const stale = await env.call('POST', url, {
      token: b, data: {type: 'pass_demo_turn', expectedRevision: 0, idempotencyKey: 'second_request_test'}
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.value.state.you, 'B');
    assert.equal(JSON.stringify(stale.value).includes('PRIVATE_A_'), false);
    const outsider = await env.call('POST', url, {
      token: c, data: {type: 'pass_demo_turn', expectedRevision: 1, idempotencyKey: 'outsider_request'}
    });
    assert.equal(outsider.status, 404);
    const events = await env.call('GET', `/api/matches/${id}/events`, {token: b});
    assert.equal(events.status, 200);
    assert.equal(events.value.events.length, 1);
    assert.equal(JSON.stringify(events.value).includes('PRIVATE_'), false);
  } finally {await env.shutdown();}
});

test('real integration: two concurrent commands cannot both commit the same revision', async () => {
  const env = await start();
  try {
    const {id, a, b} = await readyMatch(env);
    const url = `/api/matches/${id}/commands`;
    const responses = await Promise.all([
      env.call('POST', url, {token:a, data:{type:'pass_demo_turn', expectedRevision:0, idempotencyKey:'concurrent_one'}}),
      env.call('POST', url, {token:a, data:{type:'pass_demo_turn', expectedRevision:0, idempotencyKey:'concurrent_two'}})
    ]);
    assert.deepEqual(responses.map(x => x.status).sort(), [200, 409]);
    const result = await env.call('GET', `/api/matches/${id}`, {token:b});
    assert.equal(result.value.state.revision, 1);
    assert.equal(result.value.state.turn, 'B');
  } finally {await env.shutdown();}
});

test('real integration: stores for two separate matches never leak state or history', async () => {
  const env=await start();
  try {
    const a=await env.login('alice');
    const b=await env.login('bob');
    const one=(await env.call('POST','/api/matches',{token:a})).value.matchId;
    const two=(await env.call('POST','/api/matches',{token:a})).value.matchId;
    assert.notEqual(one,two);
    for (const id of [one,two]) {
      const invitation=await env.call('POST',`/api/matches/${id}/invitations`,{token:a,data:{targetHandle:'bob'}});
      assert.equal(invitation.status,201);
      assert.equal((await env.call('POST','/api/invitations/accept',{token:b,data:{invitationToken:invitation.value.token}})).status,200);
    }
    const result=await env.call('POST',`/api/matches/${one}/commands`,{token:a,data:{type:'pass_demo_turn',expectedRevision:0,idempotencyKey:'first_match_only'}});
    assert.equal(result.status,200);
    const first=await env.call('GET',`/api/matches/${one}`,{token:b});
    const second=await env.call('GET',`/api/matches/${two}`,{token:b});
    assert.equal(first.value.state.matchId,one);
    assert.equal(second.value.state.matchId,two);
    assert.equal(first.value.state.revision,1);
    assert.equal(second.value.state.revision,0);
    assert.equal((await env.call('GET',`/api/matches/${one}/events`,{token:a})).value.events.length,1);
    assert.equal((await env.call('GET',`/api/matches/${two}/events`,{token:a})).value.events.length,0);
  } finally {await env.shutdown();}
});

test('real integration: expired session cannot inspect a match', async () => {
  let now=5000;
  const services=createLocalTestComposition({clock:()=>now});
  for(const handle of ['alice','bob']) await services.identity.provisionAccount({handle,password:PASSWORD});
  const login=await services.identity.logIn({handle:'alice',password:PASSWORD});
  const created=services.invitations.createMatch({sessionToken:login.token});
  assert.equal(created.ok,true);
  now+=12*60*60*1000;
  assert.equal(services.invitations.getMatch({sessionToken:login.token,matchId:created.matchId}).code,'UNAUTHENTICATED');
});
