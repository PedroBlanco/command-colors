/**
 * CCW-009: transport adapter for the experimental identity, invitations and match-store contracts.
 * NOT FOR DEPLOYMENT: bearer credentials over loopback HTTP; no rate limiting, TLS or durable accounts.
 * Services are injected so this can be tested without merging pending feature branches.
 */
import {createServer} from 'node:http';

const MAX_BODY = 8192;
const denied = (code, status = 403) => ({status, body: {code}});

async function jsonRequest(req) {
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw Object.assign(new Error('JSON_REQUIRED'), {httpStatus: 415});
  }
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('BODY_TOO_LARGE'), {httpStatus: 413});
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw Object.assign(new Error('INVALID_JSON'), {httpStatus: 400}); }
}

function bearer(req) {
  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9_-]{20,256}$/.test(authorization)) return null;
  return authorization.slice(7);
}

function reply(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY'
  });
  res.end(JSON.stringify(body));
}

function domainReply(result, successStatus = 200) {
  if (result?.ok) return {status: successStatus, body: result};
  const code = result?.code;
  if (code === 'UNAUTHENTICATED') return denied('UNAUTHENTICATED', 401);
  if (code === 'NOT_FOUND') return denied('NOT_FOUND', 404);
  if (code === 'INVALID_ACCOUNT' || code === 'INVALID_COMMAND') return denied(code, 400);
  if (code === 'INVITATION_NOT_AVAILABLE') return denied(code, 404);
  return denied('REQUEST_REJECTED', 403);
}

/**
 * @param {{identity:object,invitations:object,getStore:(matchId:string)=>Promise<object>|object}} deps
 * getStore must return an isolated store for an existing match; it is never called for strangers.
 */
export function createAccessGateway({identity, invitations, getStore} = {}) {
  if (!identity || !invitations || typeof getStore !== 'function') throw new TypeError('Servicios requeridos');
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const route = url.pathname;
      if (url.search) return reply(res, 400, {code: 'QUERY_NOT_SUPPORTED'});
      if (req.method === 'GET' && route === '/health') return reply(res, 200, {ok: true});
      if (req.method === 'POST' && route === '/api/session') {
        const body = await jsonRequest(req);
        const result = await identity.logIn({handle: body.handle, password: body.password});
        if (!result?.ok) return reply(res, 401, {code: 'INVALID_CREDENTIALS'});
        return reply(res, 200, {token: result.token, expiresAt: result.expiresAt});
      }
      const token = bearer(req);
      const current = token && identity.resolveSession(token);
      if (!current) return reply(res, 401, {code: 'UNAUTHENTICATED'});
      if (req.method === 'DELETE' && route === '/api/session') {
        identity.logOut(token);
        return reply(res, 200, {ok: true});
      }
      if (req.method === 'POST' && route === '/api/matches') {
        const result = invitations.createMatch({sessionToken: token});
        return reply(res, ...Object.values(domainReply(result, 201)));
      }
      if (req.method === 'POST' && route === '/api/invitations/accept') {
        const body = await jsonRequest(req);
        const result = invitations.acceptInvitation({sessionToken: token, invitationToken: body.invitationToken});
        return reply(res, ...Object.values(domainReply(result)));
      }
      if (req.method === 'POST' && route === '/api/invitations/reject') {
        const body = await jsonRequest(req);
        const result = invitations.rejectInvitation({sessionToken: token, invitationToken: body.invitationToken});
        return reply(res, ...Object.values(domainReply(result)));
      }
      // Restrict match identifiers to UUIDs, preventing ambiguous URLs and excessive lookup keys.
      const matchRoute = /^\/api\/matches\/([0-9a-fA-F-]{36})(?:\/(invitations|commands|events))?$/.exec(route);
      if (!matchRoute) return reply(res, 404, {code: 'NOT_FOUND'});
      const [, matchId, resource] = matchRoute;
      const lobby = invitations.getMatch({sessionToken: token, matchId});
      if (!lobby?.ok) return reply(res, ...Object.values(domainReply(lobby)));
      const actor = lobby.players.find(p => p.handle === current.handle)?.side;
      if (!actor || !['A', 'B'].includes(actor)) return reply(res, 404, {code: 'NOT_FOUND'});

      if (req.method === 'GET' && !resource) {
        // No board/hand in a lobby waiting for its invited second player.
        if (lobby.status !== 'READY') return reply(res, 200, {matchId, status: lobby.status, players: lobby.players});
        const store = await getStore(matchId);
        const state = store.view(actor);
        if (!state || state.matchId !== matchId) return reply(res, 503, {code: 'SERVICE_UNAVAILABLE'});
        return reply(res, 200, {matchId, status: lobby.status, players: lobby.players, state});
      }
      if (req.method === 'POST' && resource === 'invitations') {
        const body = await jsonRequest(req);
        const result = invitations.issueInvitation({sessionToken: token, matchId, targetHandle: body.targetHandle});
        return reply(res, ...Object.values(domainReply(result, 201)));
      }
      if (lobby.status !== 'READY') return reply(res, 409, {code: 'MATCH_NOT_READY'});
      if (req.method === 'GET' && resource === 'events') {
        const store = await getStore(matchId);
        const events = store.publicEvents(actor);
        return reply(res, 200, {events: events ?? []});
      }
      if (req.method === 'POST' && resource === 'commands') {
        const body = await jsonRequest(req);
        // NEVER trust the actor field supplied by a client.
        const store = await getStore(matchId);
        const result = await store.dispatch({actor, type: body.type,
          expectedRevision: body.expectedRevision, idempotencyKey: body.idempotencyKey});
        // The adapter must not accidentally project another match's state.
        if (result.view && result.view.matchId !== matchId) return reply(res, 503, {code: 'SERVICE_UNAVAILABLE'});
        // Store responses are already projected to actor; whitelist response fields.
        return reply(res, result.status, {code: result.code, ...(result.view ? {state: result.view} : {})});
      }
      return reply(res, 404, {code: 'NOT_FOUND'});
    } catch (error) {
      if (Number.isInteger(error.httpStatus)) return reply(res, error.httpStatus, {code: error.message});
      // Do not return exception messages, tokens, paths, SQL or private state.
      return reply(res, 503, {code: 'SERVICE_UNAVAILABLE'});
    }
  });
}
