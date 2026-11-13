/**
 * HTTP transport for experimental identity/invitations/game-store contracts.
 * Browser mode is for loopback testing. This is not ready for Internet deployment.
 */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {browserConfig, cookieSession, sessionCookie, allowedBrowserRequest, validBrowserMutation} from './browser-session.mjs';
import {startRevisionStream} from './revision-stream.mjs';

const MAX_BODY = 8192;
const MAX_REVISION_STREAMS = 16;
const denied = (code, status = 403) => ({status, body: {code}});
const HTML_FILE = fileURLToPath(new URL('./browser-ui.html',import.meta.url));
const CLIENT_FILE = fileURLToPath(new URL('./browser-ui.mjs',import.meta.url));
const DECK_CONTROLS_FILE = fileURLToPath(new URL('./deck-controls.mjs',import.meta.url));
const HEX_SELECTION_FILE = fileURLToPath(new URL('./hex-selection.mjs',import.meta.url));
const MOVEMENT_BOARD_FILE = fileURLToPath(new URL('./movement-board-ui.mjs',import.meta.url));
const PRIVATE_VIEW_SCOPE_FILE = fileURLToPath(new URL('./private-view-scope.mjs',import.meta.url));
const PRIVATE_PROJECTION_FILE = fileURLToPath(new URL('./private-projection.mjs',import.meta.url));
const REVISION_REFRESH_FILE = fileURLToPath(new URL('./revision-refresh.mjs',import.meta.url));
const HEX_GRID_FILE = fileURLToPath(new URL('../hex-grid/hex.mjs',import.meta.url));
// Exact same-origin allowlist: never serve arbitrary repository paths.
const BROWSER_ASSETS = new Map([
  ['/browser-ui.mjs', CLIENT_FILE],
  ['/deck-controls.mjs', DECK_CONTROLS_FILE],
  ['/hex-selection.mjs', HEX_SELECTION_FILE],
  ['/movement-board-ui.mjs', MOVEMENT_BOARD_FILE],
  ['/private-view-scope.mjs', PRIVATE_VIEW_SCOPE_FILE],
  ['/private-projection.mjs', PRIVATE_PROJECTION_FILE],
  ['/revision-refresh.mjs', REVISION_REFRESH_FILE],
  ['/hex-grid/hex.mjs', HEX_GRID_FILE]
]);

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

function reply(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
    ...extraHeaders
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
 * Browser mode options: {origin:'http://127.0.0.1:8788',insecureLoopback:true} for dev;
 * production transport would require HTTPS and a separate full security review.
 * Legacy bearer mode (browser omitted) is retained only for earlier laboratory tests.
 */
// When available, a SQLite store authenticates the user and builds the
// public projection in the SAME WAL snapshot. The generic actor-based API
// remains for earlier in-memory laboratory adapters.
function readAuthorizedState(store,actor,sessionToken) {
  return typeof store.viewForSession==='function'
    ? store.viewForSession({sessionToken})
    : store.view(actor,{denyExperimentalLab:true});
}
function publicReadError(result) {
  // Authorization must take precedence over an internal laboratory marker.
  // If an adapter accidentally returns both, never reveal that a private
  // laboratory exists to a revoked session or a non-member.
  if(result?.code==='UNAUTHENTICATED')return {status:401,code:'UNAUTHENTICATED'};
  if(result?.code==='NOT_FOUND')return {status:404,code:'NOT_FOUND'};
  if(result?.code==='SECTION_LAB_INTERNAL_ONLY'||result?.status==='LAB_ONLY')
    return {status:409,code:'SECTION_LAB_INTERNAL_ONLY'};
  return null;
}

export function createAccessGateway({identity, invitations, getStore, browser = null, revisionPollMs = 1000} = {}) {
  if (!identity || !invitations || typeof getStore !== 'function') throw new TypeError('Servicios requeridos');
  if (!Number.isSafeInteger(revisionPollMs) || revisionPollMs < 20) throw new TypeError('INVALID_POLL_INTERVAL');
  const config = browser === null ? null : browserConfig(browser);
  let revisionStreams = 0;
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const route = url.pathname;
      if (config && !allowedBrowserRequest(req, config)) return reply(res, 403, {code:'LOOPBACK_ONLY'});
      if (config && ['POST','PUT','PATCH','DELETE'].includes(req.method) && !validBrowserMutation(req, config)) {
        return reply(res, 403, {code:'ORIGIN_REJECTED'});
      }
      if (url.search) return reply(res, 400, {code: 'QUERY_NOT_SUPPORTED'});
      if (config && req.method === 'GET' && (route === '/' || BROWSER_ASSETS.has(route))) {
        const html = route === '/';
        res.writeHead(200, {
          'content-type': html ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8',
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
          'referrer-policy':'no-referrer','x-frame-options':'DENY',
          'content-security-policy':"default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
        });
        res.end(await readFile(html ? HTML_FILE : BROWSER_ASSETS.get(route)));
        return;
      }
      if (req.method === 'GET' && route === '/health') return reply(res, 200, {ok: true});
      if (req.method === 'POST' && route === '/api/session') {
        const body = await jsonRequest(req);
        const result = await identity.logIn({handle: body.handle, password: body.password});
        if (!result?.ok) return reply(res, 401, {code: 'INVALID_CREDENTIALS'});
        if (config) {
          const existing = cookieSession(req.headers.cookie,config);
          if (existing) identity.logOut(existing);
          return reply(res, 200, {ok: true, expiresAt: result.expiresAt}, {
            'set-cookie': sessionCookie(result.token,config)
          });
        }
        return reply(res, 200, {token: result.token, expiresAt: result.expiresAt});
      }
      const token = config ? cookieSession(req.headers.cookie, config) : bearer(req);
      const current = token && identity.resolveSession(token);
      if (!current) return reply(res, 401, {code: 'UNAUTHENTICATED'});
      if (config && req.method === 'GET' && route === '/api/session') {
        return reply(res, 200, {authenticated: true, handle: current.handle});
      }
      if (req.method === 'DELETE' && route === '/api/session') {
        identity.logOut(token);
        return reply(res, 200, {ok: true}, config ? {'set-cookie':sessionCookie(null,config,{clear:true})} : {});
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
      const matchRoute = /^\/api\/matches\/([0-9a-fA-F-]{36})(?:\/(invitations|commands|events|updates|deck\/initialize))?$/.exec(route);
      if (!matchRoute) return reply(res, 404, {code: 'NOT_FOUND'});
      const [, matchId, resource] = matchRoute;
      const lobby = invitations.getMatch({sessionToken: token, matchId});
      if (!lobby?.ok) return reply(res, ...Object.values(domainReply(lobby)));
      const actor = lobby.players.find(p => p.handle === current.handle)?.side;
      if (!actor || !['A', 'B'].includes(actor)) return reply(res, 404, {code: 'NOT_FOUND'});

      if (req.method === 'GET' && !resource) {
        if (lobby.status !== 'READY') return reply(res, 200, {matchId, status: lobby.status, players: lobby.players});
        const store = await getStore(matchId);
        const state = readAuthorizedState(store,actor,token);
        const publicError=publicReadError(state);
        if(publicError)return reply(res,publicError.status,{code:publicError.code});
        if (!state || state.matchId !== matchId) return reply(res, 503, {code: 'SERVICE_UNAVAILABLE'});
        return reply(res, 200, {matchId, status: lobby.status, players: lobby.players, state});
      }
      if (req.method === 'POST' && resource === 'invitations') {
        const body = await jsonRequest(req);
        const result = invitations.issueInvitation({sessionToken: token, matchId, targetHandle: body.targetHandle});
        return reply(res, ...Object.values(domainReply(result, 201)));
      }
      if (req.method === 'GET' && resource === 'updates' && config) {
        // Guard the initial SSE handshake. revision-stream.mjs also rechecks
        // every tick, so activation after subscription closes the stream.
        if (lobby.status === 'READY') {
          const store = await getStore(matchId);
          const state=readAuthorizedState(store,actor,token);
          const publicError=publicReadError(state);
          if(publicError)return reply(res,publicError.status,{code:publicError.code});
          if(!state||state.matchId!==matchId)
            return reply(res,503,{code:'SERVICE_UNAVAILABLE'});
        }
        if (revisionStreams >= MAX_REVISION_STREAMS) return reply(res, 429, {code: 'TOO_MANY_STREAMS'});
        revisionStreams++;
        res.once('close', () => {revisionStreams--;});
        startRevisionStream({res, token, matchId, identity, invitations, getStore, intervalMs: revisionPollMs});
        return;
      }
      if (req.method === 'POST' && resource === 'deck/initialize') {
        // No caller-controlled card list or scenario parameters: laboratory
        // setup uses server-owned opaque fixtures only.
        const body = await jsonRequest(req);
        if (Object.keys(body).length !== 0) return reply(res, 400, {code: 'INVALID_SETUP'});
        if (lobby.status !== 'READY') return reply(res, 409, {code: 'MATCH_NOT_READY'});
        const store = await getStore(matchId);
        if(typeof store.initializeCommandDeckForSession!=='function'&&
           typeof store.initializeCommandDeck!=='function')
          return reply(res,404,{code:'NOT_FOUND'});
        const result=typeof store.initializeCommandDeckForSession==='function'
          ? await store.initializeCommandDeckForSession({sessionToken:token})
          : await store.initializeCommandDeck(actor);
        // Never return a private deck projection belonging to another match.
        if (result.view && result.view.matchId !== matchId)
          return reply(res, 503, {code:'SERVICE_UNAVAILABLE'});
        return reply(res, result.status, {code: result.code, ...(result.view ? {state: result.view} : {})});
      }
      if (lobby.status !== 'READY') return reply(res, 409, {code: 'MATCH_NOT_READY'});
      if (req.method === 'GET' && resource === 'events') {
        const store = await getStore(matchId);
        const state=readAuthorizedState(store,actor,token);
        const readError=publicReadError(state);
        if(readError)return reply(res,readError.status,{code:readError.code});
        if(!state||state.matchId!==matchId)
          return reply(res,503,{code:'SERVICE_UNAVAILABLE'});
        // Revalidate session and lab exclusion under the event read's own
        // WAL snapshot, even if a second connection changed membership.
        const events=typeof store.publicEventsForSession==='function'
          ? store.publicEventsForSession({sessionToken:token})
          : store.publicEvents(actor,{denyExperimentalLab:true});
        const eventError=publicReadError(events);
        if(eventError)return reply(res,eventError.status,{code:eventError.code});
        // Never serialize an unexpected internal event result as a public
        // array. Other errors must fail closed, not become response data.
        if (events != null && !Array.isArray(events))
          return reply(res, 503, {code:'SERVICE_UNAVAILABLE'});
        return reply(res, 200, {events: events ?? []});
      }
      if (req.method === 'POST' && resource === 'commands') {
        const body = await jsonRequest(req);
        const store = await getStore(matchId);
        const state=readAuthorizedState(store,actor,token);
        const readError=publicReadError(state);
        if(readError)return reply(res,readError.status,{code:readError.code});
        if(!state||state.matchId!==matchId)
          return reply(res,503,{code:'SERVICE_UNAVAILABLE'});
        const command={type:body.type,
          expectedRevision:body.expectedRevision,idempotencyKey:body.idempotencyKey,
          cardRef:body.cardRef,unitIds:body.unitIds,unitId:body.unitId,
          path:body.path,targetUnit:body.targetUnit,choice:body.choice};
        const result=typeof store.dispatchForSession==='function'
          ? await store.dispatchForSession({sessionToken:token,...command})
          : await store.dispatch({actor,...command});
        if (result.view && result.view.matchId !== matchId) return reply(res, 503, {code: 'SERVICE_UNAVAILABLE'});
        return reply(res, result.status, {code: result.code, ...(result.view ? {state: result.view} : {})});
      }
      return reply(res, 404, {code: 'NOT_FOUND'});
    } catch (error) {
      if (Number.isInteger(error.httpStatus)) return reply(res, error.httpStatus, {code: error.message});
      return reply(res, 503, {code: 'SERVICE_UNAVAILABLE'});
    }
  });
}
