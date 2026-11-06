/** CCW-007: local, in-memory two-player game-invitation policy. No HTTP or persistence. */
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {normalizeHandle} from './identity.mjs';

export const DEFAULT_INVITATION_TTL_MS = 72 * 60 * 60 * 1000;
const fingerprint = token => createHash('sha256').update(token, 'utf8').digest('hex');
const denied = code => ({ok: false, code});

export function createInvitationService({identity, clock = Date.now, invitationTtlMs = DEFAULT_INVITATION_TTL_MS} = {}) {
  if (!identity || typeof identity.resolveSession !== 'function' || typeof clock !== 'function'
      || !Number.isSafeInteger(invitationTtlMs) || invitationTtlMs < 1000) {
    throw new TypeError('Configuración de invitaciones inválida');
  }
  const matches = new Map();
  const invitations = new Map(); // token digest -> private record
  const invitationIds = new Map(); // id -> digest
  const login = sessionToken => identity.resolveSession(sessionToken);

  function getMatch({sessionToken, matchId}) {
    const actor = login(sessionToken);
    if (!actor) return denied('UNAUTHENTICATED');
    const match = matches.get(matchId);
    if (!match || !match.players.some(p => p.userId === actor.userId)) return denied('NOT_FOUND');
    const result = {ok: true, matchId: match.id, revision: match.revision,
      players: match.players.map(p => ({side: p.side, handle: p.handle})),
      status: match.players.length === 2 ? 'READY' : 'INVITING'};
    if (actor.userId === match.ownerId) {
      result.invitations = [...invitationIds.values()]
        .map(digest => invitations.get(digest))
        .filter(i => i.matchId === matchId)
        .map(i => ({invitationId: i.id, targetHandle: i.targetHandle,
          status: i.status === 'PENDING' && clock() >= i.expiresAt ? 'EXPIRED' : i.status,
          expiresAt: i.expiresAt}));
    }
    return result;
  }

  function createMatch({sessionToken}) {
    const actor = login(sessionToken);
    if (!actor) return denied('UNAUTHENTICATED');
    const id = randomUUID();
    matches.set(id, {id, ownerId: actor.userId, revision: 0,
      players: [{userId: actor.userId, handle: actor.handle, side: 'A'}]});
    return {ok: true, matchId: id};
  }

  function issueInvitation({sessionToken, matchId, targetHandle}) {
    const actor = login(sessionToken);
    if (!actor) return denied('UNAUTHENTICATED');
    const match = matches.get(matchId);
    if (!match || match.ownerId !== actor.userId) return denied('NOT_FOUND');
    const normalized = normalizeHandle(targetHandle);
    if (!normalized || normalized === actor.handle || match.players.length === 2) {
      return denied('INVITATION_NOT_AVAILABLE');
    }
    // Issue by handle without looking up account: owner cannot use this to enumerate accounts.
    const token = randomBytes(32).toString('base64url');
    const digest = fingerprint(token);
    const id = randomUUID();
    const expiresAt = clock() + invitationTtlMs;
    const record = {id, matchId, targetHandle: normalized, expiresAt, status: 'PENDING'};
    invitations.set(digest, record);
    invitationIds.set(id, digest);
    return {ok: true, invitationId: id, token, expiresAt}; // show token only once to inviter
  }

  function invitationFor(token, actor) {
    if (typeof token !== 'string' || token.length > 256) return null;
    const record = invitations.get(fingerprint(token));
    if (!record || record.status !== 'PENDING' || record.targetHandle !== actor.handle) return null;
    if (clock() >= record.expiresAt) { record.status = 'EXPIRED'; return null; }
    return record;
  }

  function acceptInvitation({sessionToken, invitationToken}) {
    const actor = login(sessionToken);
    if (!actor) return denied('UNAUTHENTICATED');
    const invite = invitationFor(invitationToken, actor);
    if (!invite) return denied('INVITATION_NOT_AVAILABLE');
    const match = matches.get(invite.matchId);
    if (!match || match.players.length !== 1 || match.players[0].userId === actor.userId) {
      return denied('INVITATION_NOT_AVAILABLE');
    }
    match.players.push({userId: actor.userId, handle: actor.handle, side: 'B'});
    match.revision++;
    invite.status = 'ACCEPTED';
    // A filled match cannot accept other previously issued invitations.
    for (const candidate of invitations.values()) {
      if (candidate.matchId === match.id && candidate.status === 'PENDING') candidate.status = 'REVOKED';
    }
    return {ok: true, matchId: match.id, side: 'B', revision: match.revision};
  }

  function rejectInvitation({sessionToken, invitationToken}) {
    const actor = login(sessionToken);
    if (!actor) return denied('UNAUTHENTICATED');
    const invite = invitationFor(invitationToken, actor);
    if (!invite) return denied('INVITATION_NOT_AVAILABLE');
    invite.status = 'REJECTED';
    return {ok: true};
  }

  function revokeInvitation({sessionToken, matchId, invitationId}) {
    const actor = login(sessionToken);
    if (!actor) return denied('UNAUTHENTICATED');
    const match = matches.get(matchId);
    if (!match || match.ownerId !== actor.userId) return denied('NOT_FOUND');
    const digest = invitationIds.get(invitationId);
    const invite = digest && invitations.get(digest);
    if (!invite || invite.matchId !== matchId || invite.status !== 'PENDING') {
      return denied('INVITATION_NOT_AVAILABLE');
    }
    invite.status = 'REVOKED';
    return {ok: true};
  }

  return Object.freeze({createMatch, getMatch, issueInvitation, acceptInvitation, rejectInvitation, revokeInvitation});
}
