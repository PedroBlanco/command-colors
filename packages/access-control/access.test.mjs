import test from 'node:test';
import assert from 'node:assert/strict';
import {createIdentityService, normalizeHandle} from './identity.mjs';
import {createInvitationService} from './invitations.mjs';

const SECRET = 'correct-horse-battery-staple-for-tests';
const provision = (identity, handle) => identity.provisionAccount({handle, password: SECRET});
const signIn = async (identity, handle) => {
  const result = await identity.logIn({handle, password: SECRET});
  assert.equal(result.ok, true);
  return result.token;
};
const setup = async () => {
  let now = 1000;
  const clock = () => now;
  const identity = createIdentityService({clock, sessionTtlMs: 100_000});
  for (const name of ['alice', 'bob', 'carol', 'dave']) assert.equal((await provision(identity, name)).ok, true);
  const tokens = {};
  for (const name of ['alice', 'bob', 'carol', 'dave']) tokens[name] = await signIn(identity, name);
  const invitations = createInvitationService({identity, clock, invitationTtlMs: 10_000});
  return {identity, invitations, tokens, moveTime: n => {now = n;}};
};

test('normalize handle: case-insensitive, predictable, rejects invalid', () => {
  assert.equal(normalizeHandle('  Alice_12  '), 'alice_12');
  assert.equal(normalizeHandle('álvaro'), null);
  assert.equal(normalizeHandle('x'), null);
  assert.equal(normalizeHandle('../alice'), null);
  assert.equal(normalizeHandle(12), null);
});

test('account bootstrap: password requirements, duplicate and case folding', async () => {
  const identity = createIdentityService();
  assert.equal((await identity.provisionAccount({handle: 'alice', password: 'short'})).code, 'INVALID_ACCOUNT');
  assert.equal((await provision(identity, 'Alice')).ok, true);
  assert.equal((await provision(identity, '  ALICE  ')).code, 'ACCOUNT_ALREADY_EXISTS');
  const unknown = await identity.logIn({handle: 'nobody', password: SECRET});
  const wrong = await identity.logIn({handle: 'alice', password: SECRET + 'wrong'});
  assert.equal(unknown.code, 'INVALID_CREDENTIALS');
  assert.equal(wrong.code, 'INVALID_CREDENTIALS');
});

test('provisioning same account concurrently cannot produce duplicates', async () => {
  const identity = createIdentityService();
  const [one, two] = await Promise.all([provision(identity, 'alice'), provision(identity, 'ALICE')]);
  assert.deepEqual([one.ok, two.ok].sort(), [false, true]);
});

test('login issues opaque random sessions, expire and logout', async () => {
  let now = 10_000;
  const identity = createIdentityService({clock:()=>now,sessionTtlMs:10_000});
  await provision(identity, 'alice');
  const a = await signIn(identity, 'alice'), b = await signIn(identity, 'alice');
  assert.notEqual(a,b);
  assert.equal(identity.resolveSession(a).handle, 'alice');
  assert.equal(identity.resolveSession('forged'), null);
  identity.logOut(a);
  assert.equal(identity.resolveSession(a),null);
  assert.ok(identity.resolveSession(b));
  now += 10_000;
  assert.equal(identity.resolveSession(b), null);
});

test('two participants only; uninvited registered account has no visibility', async () => {
  const {invitations, tokens} = await setup();
  const created = invitations.createMatch({sessionToken:tokens.alice});
  assert.equal(created.ok,true);
  const unknown = invitations.getMatch({sessionToken:tokens.carol,matchId:created.matchId});
  const nonexistent = invitations.getMatch({sessionToken:tokens.carol,matchId:'does-not-exist'});
  assert.deepEqual(unknown,nonexistent);
  assert.equal(unknown.code, 'NOT_FOUND');
  assert.equal(invitations.getMatch({sessionToken:'invalid',matchId:created.matchId}).code,'UNAUTHENTICATED');
  assert.equal(invitations.getMatch({sessionToken:tokens.alice,matchId:created.matchId}).players.length,1);
});

test('invite by handle without lookup; sensitive token only returned at issuance', async () => {
  const {invitations, tokens} = await setup();
  const matchId = invitations.createMatch({sessionToken:tokens.alice}).matchId;
  const unknown = invitations.issueInvitation({sessionToken:tokens.alice,matchId,targetHandle:'ghost'});
  const known = invitations.issueInvitation({sessionToken:tokens.alice,matchId,targetHandle:' BOB '});
  assert.equal(unknown.ok, true);
  assert.equal(known.ok, true);
  assert.equal(known.token.length > 32, true);
  const owner = invitations.getMatch({sessionToken:tokens.alice,matchId});
  assert.equal(JSON.stringify(owner).includes(known.token), false);
  assert.equal(JSON.stringify(owner).includes(unknown.token), false);
  assert.equal(owner.invitations.length,2);
  assert.equal(invitations.getMatch({sessionToken:tokens.carol,matchId}).code,'NOT_FOUND');
  const refused = invitations.acceptInvitation({sessionToken:tokens.carol,invitationToken:known.token});
  assert.equal(refused.code,'INVITATION_NOT_AVAILABLE');
  const accepted = invitations.acceptInvitation({sessionToken:tokens.bob,invitationToken:known.token});
  assert.equal(accepted.ok, true);
  assert.equal(accepted.side,'B');
  assert.equal(invitations.getMatch({sessionToken:tokens.bob,matchId}).status,'READY');
  assert.equal(invitations.getMatch({sessionToken:tokens.bob,matchId}).invitations,undefined);
  assert.equal(invitations.getMatch({sessionToken:tokens.carol,matchId}).code,'NOT_FOUND');
  assert.equal(invitations.acceptInvitation({sessionToken:tokens.bob,invitationToken:known.token}).code,'INVITATION_NOT_AVAILABLE');
  assert.equal(invitations.issueInvitation({sessionToken:tokens.alice,matchId,targetHandle:'dave'}).code,'INVITATION_NOT_AVAILABLE');
  assert.equal(invitations.acceptInvitation({sessionToken:tokens.dave,invitationToken:unknown.token}).code,'INVITATION_NOT_AVAILABLE');
});

test('invitation expiration checked at exact deadline', async () => {
  const {invitations,tokens,moveTime} = await setup();
  const matchId = invitations.createMatch({sessionToken:tokens.alice}).matchId;
  const inv = invitations.issueInvitation({sessionToken:tokens.alice,matchId,targetHandle:'bob'});
  moveTime(11_000); // issued at 1_000, TTL 10_000
  assert.equal(invitations.acceptInvitation({sessionToken:tokens.bob,invitationToken:inv.token}).code,'INVITATION_NOT_AVAILABLE');
  const owner=invitations.getMatch({sessionToken:tokens.alice,matchId});
  assert.equal(owner.invitations[0].status,'EXPIRED');
});

test('creator can revoke, non-creator cannot revoke or issue', async () => {
  const {invitations,tokens} = await setup();
  const matchId=invitations.createMatch({sessionToken:tokens.alice}).matchId;
  const inv=invitations.issueInvitation({sessionToken:tokens.alice,matchId,targetHandle:'bob'});
  assert.equal(invitations.issueInvitation({sessionToken:tokens.carol,matchId,targetHandle:'dave'}).code,'NOT_FOUND');
  assert.equal(invitations.revokeInvitation({sessionToken:tokens.carol,matchId,invitationId:inv.invitationId}).code,'NOT_FOUND');
  assert.equal(invitations.revokeInvitation({sessionToken:tokens.alice,matchId,invitationId:inv.invitationId}).ok,true);
  assert.equal(invitations.acceptInvitation({sessionToken:tokens.bob,invitationToken:inv.token}).code,'INVITATION_NOT_AVAILABLE');
  assert.equal(invitations.getMatch({sessionToken:tokens.alice,matchId}).invitations[0].status,'REVOKED');
});

test('invitee can reject; another invite remains possible', async () => {
  const {invitations,tokens}=await setup();
  const matchId=invitations.createMatch({sessionToken:tokens.alice}).matchId;
  const first=invitations.issueInvitation({sessionToken:tokens.alice,matchId,targetHandle:'bob'});
  assert.equal(invitations.rejectInvitation({sessionToken:tokens.carol,invitationToken:first.token}).code,'INVITATION_NOT_AVAILABLE');
  assert.equal(invitations.rejectInvitation({sessionToken:tokens.bob,invitationToken:first.token}).ok,true);
  assert.equal(invitations.acceptInvitation({sessionToken:tokens.bob,invitationToken:first.token}).code,'INVITATION_NOT_AVAILABLE');
  const second=invitations.issueInvitation({sessionToken:tokens.alice,matchId,targetHandle:'bob'});
  assert.equal(invitations.acceptInvitation({sessionToken:tokens.bob,invitationToken:second.token}).ok,true);
});

test('two valid invitations cannot add a third participant', async () => {
  const {invitations,tokens}=await setup();
  const matchId=invitations.createMatch({sessionToken:tokens.alice}).matchId;
  const bob=invitations.issueInvitation({sessionToken:tokens.alice,matchId,targetHandle:'bob'});
  const carol=invitations.issueInvitation({sessionToken:tokens.alice,matchId,targetHandle:'carol'});
  assert.equal(invitations.acceptInvitation({sessionToken:tokens.carol,invitationToken:carol.token}).ok,true);
  assert.equal(invitations.acceptInvitation({sessionToken:tokens.bob,invitationToken:bob.token}).code,'INVITATION_NOT_AVAILABLE');
  const view=invitations.getMatch({sessionToken:tokens.alice,matchId});
  assert.equal(view.players.length,2);
  assert.equal(view.revision,1);
});

test('login session expiry also blocks access to existing match', async () => {
  const {invitations,tokens,moveTime}=await setup();
  const matchId=invitations.createMatch({sessionToken:tokens.alice}).matchId;
  moveTime(101_000);
  assert.equal(invitations.getMatch({sessionToken:tokens.alice,matchId}).code,'UNAUTHENTICATED');
});
