/**
 * CCW-008 local SQLite durability spike. Node 22 `node:sqlite` is experimental.
 * All operations use one DB transaction; never use with real player data or expose via Internet.
 */
import {DatabaseSync} from 'node:sqlite';
import {randomBytes, randomUUID, createHash, scrypt as callbackScrypt, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {initializeSchema, CCW_SCHEMA_SQL} from './schema-version.mjs';
import {createSqliteCommandDeckStore, hasCommandDeck} from '../command-deck/sqlite-game.mjs';
import {createSqliteAncientsSectionBridge, hasExperimentalSectionHistory} from '../ancients-rules/sqlite-section-ccwb-bridge.mjs';
import {makeSectionMutationSessionGuard} from './section-mutation-session-guard.mjs';
import {proposeMovementDraft, projectMovementDraft} from '../ancients-rules/movement-draft-contract.mjs';
import {screenAncientsMovementCommitIntent} from '../ancients-rules/movement-commit-intent-screen.mjs';
import {inBounds} from '../hex-grid/hex.mjs';

const scrypt = promisify(callbackScrypt);
const KDF = Object.freeze({N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024});
const COMMAND_KEY = /^[a-zA-Z0-9_-]{8,80}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HANDLE = /^[a-z][a-z0-9_-]{2,31}$/;
const digest = token => createHash('sha256').update(token).digest('hex');
const randomToken = () => randomBytes(32).toString('base64url');
const denied = code => ({ok: false, code});
const decode = json => JSON.parse(json);

function normalizeHandle(value) {
  if (typeof value !== 'string') return null;
  const h = value.trim().toLowerCase();
  return HANDLE.test(h) ? h : null;
}



function initialState(matchId) {
  return {
    schemaVersion: 1, matchId, status: 'ACTIVE', turn: 'A',
    board: [{id: 'synthetic-a', side: 'A', col: 3, row: 4}, {id: 'synthetic-b', side: 'B', col: 9, row: 4}],
    hands: {A: ['PRIVATE_A_1', 'PRIVATE_A_2'], B: ['PRIVATE_B_1','PRIVATE_B_2','PRIVATE_B_3']},
    deck: ['HIDDEN_FUTURE_CARD']
  };
}

function project(row, actor) {
  if (!row || !['A','B'].includes(actor)) return null;
  const state = decode(row.private_state);
  if (state.matchId !== row.id || state.schemaVersion !== 1 || !['A','B'].includes(state.turn)
      || !Array.isArray(state.board) || !Array.isArray(state.hands?.[actor])
      || !Array.isArray(state.hands?.[actor === 'A' ? 'B' : 'A'])) throw new Error('CORRUPT_MATCH');
  return {
    matchId: row.id, revision: row.game_revision, status: state.status,
    turn: state.turn, you: actor, board: structuredClone(state.board),
    yourHand: structuredClone(state.hands[actor]),
    opponentCardCount: state.hands[actor === 'A' ? 'B' : 'A'].length
  };
}

/** In-process synchronous transactions. File locks also serialize separate SQLite processes. */
export function openSqliteComposition({file, clock = Date.now,
  sessionTtlMs = 12*60*60*1000, invitationTtlMs = 72*60*60*1000} = {}) {
  if (typeof file !== 'string' || !file || file === ':memory:' || typeof clock !== 'function'
      || !Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 1000
      || !Number.isSafeInteger(invitationTtlMs) || invitationTtlMs < 1000) {
    throw new TypeError('Parámetros de base de datos de prueba inválidos');
  }
  mkdirSync(dirname(file), {recursive: true});
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=4000;');
    // Reject unknown/future versions before writing anything to this database.
    // Adopt metadata version 0 only when the former lab schema matches exactly.
    initializeSchema(db, () => db.exec(CCW_SCHEMA_SQL));
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  } catch (error) {
    db.close();
    throw error;
  }
  function atomic(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  /**
   * SQLite WAL read snapshot. First SELECT fixes the visible database state:
   * session, membership, match state and event replay must come from that state.
   * Do not take a RESERVED writer lock merely to read public events.
   */
  function readSnapshot(fn) {
    db.exec('BEGIN');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const selectAccount = db.prepare('SELECT id, handle, salt, password_hash FROM accounts WHERE handle = ?');
  const currentSession = db.prepare(`SELECT a.id AS userId, a.handle AS handle FROM sessions s
    JOIN accounts a ON a.id = s.user_id WHERE s.token_digest = ? AND s.expires_at > ?`);
  const getMatchRow = db.prepare('SELECT * FROM matches WHERE id = ?');
  const getMember = db.prepare('SELECT id, owner_id, guest_id FROM matches WHERE id = ?');
  const checkActor = (row, actorId) => row.owner_id === actorId ? 'A' : row.guest_id === actorId ? 'B' : null;
  const sessions = {
    async provisionAccount({handle, password} = {}) {
      const h = normalizeHandle(handle);
      if (!h || typeof password !== 'string' || password.length < 12 || password.length > 256 || password.includes('\0')) return denied('INVALID_ACCOUNT');
      const salt = randomBytes(16);
      const passwordHash = await scrypt(password, salt, 64, KDF);
      const id = randomUUID();
      try {
        db.prepare('INSERT INTO accounts (id, handle, salt, password_hash) VALUES (?,?,?,?)')
          .run(id, h, salt.toString('hex'), passwordHash.toString('hex'));
        return {ok:true, userId:id, handle:h};
      } catch (error) {
        if (String(error.message).includes('UNIQUE constraint failed')) return denied('ACCOUNT_ALREADY_EXISTS');
        throw error;
      }
    },
    async logIn({handle, password} = {}) {
      const h = normalizeHandle(handle);
      if (typeof password !== 'string' || password.length < 12 || password.length > 256) return denied('INVALID_CREDENTIALS');
      const account = h ? selectAccount.get(h) : null;
      const salt = account ? Buffer.from(account.salt, 'hex') : Buffer.alloc(16, 0);
      const candidate = await scrypt(password, salt, 64, KDF);
      if (!account || !timingSafeEqual(candidate, Buffer.from(account.password_hash, 'hex'))) return denied('INVALID_CREDENTIALS');
      const token = randomToken(), expiresAt = clock() + sessionTtlMs;
      db.prepare('INSERT INTO sessions(token_digest,user_id,expires_at) VALUES (?,?,?)')
        .run(digest(token), account.id, expiresAt);
      return {ok: true, token, expiresAt};
    },
    resolveSession(token) {
      if (typeof token !== 'string' || token.length > 256 || token.length < 20) return null;
      const s = currentSession.get(digest(token), clock());
      return s ? {userId: s.userId, handle:s.handle} : null;
    },
    logOut(token) {
      if (typeof token === 'string') db.prepare('DELETE FROM sessions WHERE token_digest=?').run(digest(token));
      return {ok:true};
    }
  };

  const invitations = {
    createMatch({sessionToken} = {}) {
      const user = sessions.resolveSession(sessionToken);
      if (!user) return denied('UNAUTHENTICATED');
      const id = randomUUID();
      db.prepare('INSERT INTO matches(id, owner_id, private_state) VALUES (?,?,?)')
        .run(id, user.userId, JSON.stringify(initialState(id)));
      return {ok:true, matchId:id};
    },
    getMatch({sessionToken, matchId} = {}) {
      const user = sessions.resolveSession(sessionToken);
      if (!user) return denied('UNAUTHENTICATED');
      if (!UUID.test(String(matchId ?? ''))) return denied('NOT_FOUND');
      const match = getMember.get(matchId);
      if (!match || !checkActor(match, user.userId)) return denied('NOT_FOUND');
      const owner = db.prepare('SELECT handle FROM accounts WHERE id = ?').get(match.owner_id);
      const guest = match.guest_id ? db.prepare('SELECT handle FROM accounts WHERE id = ?').get(match.guest_id) : null;
      const result = {ok:true, matchId, revision:getMatchRow.get(matchId).lobby_revision,
        players:[{side:'A',handle:owner.handle},...(guest ? [{side:'B',handle:guest.handle}] : [])],
        status:guest?'READY':'INVITING'};
      if (match.owner_id === user.userId) {
        result.invitations = db.prepare('SELECT id, target_handle, status, expires_at FROM invitations WHERE match_id=? ORDER BY rowid')
          .all(matchId).map(i => ({invitationId:i.id,targetHandle:i.target_handle,
            status: i.status === 'PENDING' && clock() >= i.expires_at ? 'EXPIRED' : i.status,expiresAt:i.expires_at}));
      }
      return result;
    },
    issueInvitation({sessionToken,matchId,targetHandle} = {}) {
      const user = sessions.resolveSession(sessionToken);
      if (!user) return denied('UNAUTHENTICATED');
      const m = getMember.get(matchId);
      if (!m || m.owner_id !== user.userId) return denied('NOT_FOUND');
      const h = normalizeHandle(targetHandle);
      if (!h || h === user.handle || m.guest_id !== null) return denied('INVITATION_NOT_AVAILABLE');
      const id = randomUUID(), token = randomToken(), expiresAt=clock()+invitationTtlMs;
      db.prepare('INSERT INTO invitations(id,match_id,token_digest,target_handle,expires_at,status) VALUES(?,?,?,?,?,?)')
        .run(id,matchId,digest(token),h,expiresAt,'PENDING');
      return {ok:true, invitationId:id, token, expiresAt};
    },
    acceptInvitation({sessionToken,invitationToken} = {}) {
      const user = sessions.resolveSession(sessionToken);
      if (!user) return denied('UNAUTHENTICATED');
      if (typeof invitationToken !== 'string' || invitationToken.length > 256 || invitationToken.length < 20) return denied('INVITATION_NOT_AVAILABLE');
      return atomic(() => {
        const i=db.prepare('SELECT * FROM invitations WHERE token_digest=?').get(digest(invitationToken));
        if (!i || i.status !== 'PENDING' || i.target_handle !== user.handle || clock() >= i.expires_at) return denied('INVITATION_NOT_AVAILABLE');
        const m=getMember.get(i.match_id);
        if (!m || m.guest_id !== null || m.owner_id === user.userId) return denied('INVITATION_NOT_AVAILABLE');
        db.prepare('UPDATE matches SET guest_id=?,lobby_revision=lobby_revision+1 WHERE id=?')
          .run(user.userId,i.match_id);
        db.prepare("UPDATE invitations SET status=CASE WHEN id=? THEN 'ACCEPTED' ELSE 'REVOKED' END WHERE match_id=? AND status='PENDING'")
          .run(i.id,i.match_id);
        return {ok:true,matchId:i.match_id,side:'B',revision:1};
      });
    },
    rejectInvitation({sessionToken, invitationToken} = {}) {
      const user=sessions.resolveSession(sessionToken);
      if (!user) return denied('UNAUTHENTICATED');
      if (typeof invitationToken !== 'string' || invitationToken.length > 256 || invitationToken.length < 20) return denied('INVITATION_NOT_AVAILABLE');
      const row = db.prepare('SELECT id,target_handle,expires_at,status FROM invitations WHERE token_digest=?').get(digest(invitationToken));
      if (!row || row.status!=='PENDING' || row.target_handle!==user.handle || clock()>=row.expires_at) return denied('INVITATION_NOT_AVAILABLE');
      db.prepare("UPDATE invitations SET status='REJECTED' WHERE id=?").run(row.id);
      return {ok:true};
    },
    revokeInvitation({sessionToken,matchId,invitationId}={}) {
      const user=sessions.resolveSession(sessionToken);
      if (!user) return denied('UNAUTHENTICATED');
      const m=getMember.get(matchId);
      if (!m || m.owner_id!==user.userId) return denied('NOT_FOUND');
      const row=db.prepare("UPDATE invitations SET status='REVOKED' WHERE id=? AND match_id=? AND status='PENDING'")
        .run(invitationId,matchId);
      return row.changes === 1 ? {ok:true} : denied('INVITATION_NOT_AVAILABLE');
    }
  };

  function getStore(matchId) {
    if (!UUID.test(String(matchId ?? ''))) throw new TypeError('MATCH_ID_INVALID');
    function rowOrThrow() {
      const row = getMatchRow.get(matchId);
      if (!row || row.guest_id === null) throw new Error('MATCH_NOT_READY');
      return row;
    }
    const commandDeck = createSqliteCommandDeckStore({
      db, matchId, atomic, getRow: id => getMatchRow.get(id)
    });
    const sectionHistory = createSqliteAncientsSectionBridge({
      db, matchId, atomic, getRow: id => getMatchRow.get(id)
    });
    // The experimental bridge accepts a trusted side internally. This composition
    // must derive that side from a live session and CCWB membership, never a request.
    function resolveSectionLabActor(sessionToken) {
      const session = sessions.resolveSession(sessionToken);
      if (!session) return {error:{status:401,code:'UNAUTHENTICATED'}};
      const member = getMember.get(matchId);
      const actor = member && member.guest_id !== null
        ? checkActor(member, session.userId) : null;
      return actor ? {actor} : {error:{status:404,code:'NOT_FOUND'}};
    }
    const plainLabRequest = value => value !== null && typeof value === 'object'
      && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
    // A preflight check provides a useful rejection to the caller, but it is
    // insufficient for mutations: another SQLite connection can revoke the
    // session before the bridge acquires its write lock.
    function mutationSessionGuard(sessionToken, originalActor) {
      return makeSectionMutationSessionGuard({
        db, resolveActor:resolveSectionLabActor, sessionToken, expectedActor:originalActor
      });
    }
    /** Shared strict input contract for the two read-only sequence
     *  previews. Never accept client-supplied actor, game or terrain. */
    function validSequenceRequest(request) {
      return !(!plainLabRequest(request) ||
            Object.keys(request).length!==3 ||
            !['sessionToken','expectedRevision','actions'].every(k => Object.hasOwn(request,k)) ||
            typeof request.sessionToken!=='string' ||
            !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision<0 ||
            !Array.isArray(request.actions) || request.actions.length<1 ||
            request.actions.length>117 ||
            !request.actions.every(action => plainLabRequest(action) &&
              Object.keys(action).length===3 &&
              ['kind','id','path'].every(k => Object.hasOwn(action,k)) &&
              ['UNIT','LEADER'].includes(action.kind) &&
              typeof action.id==='string' &&
              /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(action.id) &&
              action.id!=='__proto__' &&
              Array.isArray(action.path) && action.path.length>0 &&
              action.path.length<=32 &&
              action.path.every(cell => plainLabRequest(cell) &&
                Object.keys(cell).length===2 &&
                Object.hasOwn(cell,'col') && Object.hasOwn(cell,'row') &&
                inBounds(cell))));
    }
    return {
      // Once the synthetic deck is initialized, the legacy fixture hands
      // must never be returned to a player.
      view(actor) {
        const row = rowOrThrow();
        if (hasExperimentalSectionHistory(row)) return sectionHistory.view(actor);
        return hasCommandDeck(row) ? commandDeck.view(actor) : project(row,actor);
      },
      initializeCommandDeck(actor) {
        const row=rowOrThrow();
        if (hasExperimentalSectionHistory(row)) return {status:409,code:'SECTION_LAB_MODE_ACTIVE'};
        return commandDeck.initialize(actor);
      },
      /**
       * TEST-ONLY, never an HTTP route. The trusted fixture is supplied by
       * server code; an authenticated match owner must initialize it.
       */
      initializeExperimentalSectionHistory(request = {}) {
        if (!plainLabRequest(request) ||
            Object.keys(request).some(k => !['sessionToken','trustedSetup'].includes(k)))
          return {status:400,code:'INVALID_SECTION_LAB_REQUEST'};
        const identity = resolveSectionLabActor(request.sessionToken);
        if (identity.error) return identity.error;
        rowOrThrow();
        return sectionHistory.initialize(identity.actor, request.trustedSetup,
          mutationSessionGuard(request.sessionToken, identity.actor));
      },
      /** Private experimental projection bound to the live participant session. */
      viewExperimentalSectionHistory(request = {}) {
        if (!plainLabRequest(request) || Object.keys(request).some(k => k !== 'sessionToken'))
          return {status:400,code:'INVALID_SECTION_LAB_REQUEST'};
        // Keep the session, membership and private projection on one WAL
        // snapshot. Revocation before the snapshot's first read is rejected.
        return readSnapshot(() => {
          const identity = resolveSectionLabActor(request.sessionToken);
          if (identity.error) return identity.error;
          if (!hasExperimentalSectionHistory(rowOrThrow()))
            return {status:409,code:'SECTION_LAB_NOT_INITIALIZED'};
          return {status:200,code:'SECTION_LAB_VIEW',view:sectionHistory.view(identity.actor)};
        });
      },
      /**
       * INTERNAL LAB ONLY, no HTTP route. The request contains a session
       * token but must NEVER contain actor or a client-selected user ID.
       */
      dispatchExperimentalSectionHistory(request = {}) {
        if (!plainLabRequest(request) ||
            Object.hasOwn(request,'actor') || Object.hasOwn(request,'sessionUserId'))
          return {status:400,code:'INVALID_SECTION_LAB_COMMAND'};
        const {sessionToken,...command} = request;
        const identity = resolveSectionLabActor(sessionToken);
        if (identity.error) return identity.error;
        if (!hasExperimentalSectionHistory(rowOrThrow()))
          return {status:409,code:'SECTION_LAB_NOT_INITIALIZED'};
        return sectionHistory.dispatch({...command,actor:identity.actor},
          mutationSessionGuard(sessionToken, identity.actor));
      },
      /** INTERNAL LAB ONLY. Session is the sole source of actor identity;
       *  server-owned unit profiles/terrain are passed separately from request.
       *  No new HTTP route, no game mutation, no raw private journal returned. */
      precheckExperimentalSectionMovement(request = {},trustedContext) {
        if (!plainLabRequest(request) ||
            Object.keys(request).length!==4 ||
            !['sessionToken','expectedRevision','unitId','path'].every(k => Object.hasOwn(request,k)) ||
            typeof request.sessionToken!=='string' ||
            !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision<0 ||
            typeof request.unitId!=='string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(request.unitId) ||
            !Array.isArray(request.path) || request.path.length<1 || request.path.length>32 ||
            !request.path.every(cell => plainLabRequest(cell) &&
              Object.keys(cell).length===2 && Object.hasOwn(cell,'col') &&
              Object.hasOwn(cell,'row') && inBounds(cell)))
          return {status:400,code:'INVALID_SECTION_LAB_MOVEMENT_REQUEST'};
        // One WAL snapshot binds identity, match membership, CCWB replay and
        // the read-only movement filter; a concurrent logout cannot interleave.
        return readSnapshot(() => {
          const identity=resolveSectionLabActor(request.sessionToken);
          if(identity.error)return identity.error;
          if(!hasExperimentalSectionHistory(rowOrThrow()))
            return {status:409,code:'SECTION_LAB_NOT_INITIALIZED'};
          return sectionHistory.previewMovement(identity.actor,request,trustedContext);
        });
      },
      /** INTERNAL LAB ONLY. Preview a separately ordered leader's normal
       * movement under a single WAL snapshot of session, membership and the
       * private CCWB order journal. Never authorize movement or expose HTTP. */
      precheckExperimentalSectionLeaderMovement(request = {},trustedContext) {
        if (!plainLabRequest(request) ||
            Object.keys(request).length!==4 ||
            !['sessionToken','expectedRevision','leaderId','path'].every(k => Object.hasOwn(request,k)) ||
            typeof request.sessionToken!=='string' ||
            !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision<0 ||
            typeof request.leaderId!=='string' ||
            !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(request.leaderId) ||
            request.leaderId==='__proto__' ||
            !Array.isArray(request.path) || request.path.length<1 || request.path.length>32 ||
            !request.path.every(cell => plainLabRequest(cell) &&
              Object.keys(cell).length===2 && Object.hasOwn(cell,'col') &&
              Object.hasOwn(cell,'row') && inBounds(cell)))
          return {status:400,code:'INVALID_SECTION_LAB_LEADER_REQUEST'};
        return readSnapshot(() => {
          const identity=resolveSectionLabActor(request.sessionToken);
          if(identity.error)return identity.error;
          if(!hasExperimentalSectionHistory(rowOrThrow()))
            return {status:409,code:'SECTION_LAB_NOT_INITIALIZED'};
          return sectionHistory.previewLeaderMovement(identity.actor,request,trustedContext);
        });
      },
      /** INTERNAL LAB ONLY: hypothetical movement sequence, read-only and
       * based on the same WAL snapshot as session, membership and replay.
       * No public route, commands, mutations or gameplay authorization. */
      precheckExperimentalSectionMovementSequence(request = {},trustedContext) {
        if (!validSequenceRequest(request))
          return {status:400,code:'INVALID_SECTION_LAB_SEQUENCE_REQUEST'};
        return readSnapshot(() => {
          const identity=resolveSectionLabActor(request.sessionToken);
          if(identity.error)return identity.error;
          if(!hasExperimentalSectionHistory(rowOrThrow()))
            return {status:409,code:'SECTION_LAB_NOT_INITIALIZED'};
          return sectionHistory.previewMovementSequence(identity.actor,request,trustedContext);
        });
      },
      /** INTERNAL LAB ONLY: evidence of a hypothetical sequence. Session,
       *  match membership, private replay and candidate trace share one WAL
       *  snapshot. This cannot change game state or publish public events. */
      precheckExperimentalSectionMovementEvidence(request = {},trustedContext) {
        if (!validSequenceRequest(request))
          return {status:400,code:'INVALID_SECTION_LAB_EVIDENCE_REQUEST'};
        return readSnapshot(() => {
          const identity=resolveSectionLabActor(request.sessionToken);
          if(identity.error)return identity.error;
          if(!hasExperimentalSectionHistory(rowOrThrow()))
            return {status:409,code:'SECTION_LAB_NOT_INITIALIZED'};
          return sectionHistory.previewMovementEvidence(identity.actor,request,trustedContext);
        });
      },
      /**
       * INTERNAL LAB ONLY: a shape-screened, non-committable one-hex
       * simulation. The authenticated actor, section replay and game state
       * are read under ONE SQLite WAL snapshot, not supplied by the client.
       * The trusted context/policy must be created by server-side test code.
       * NEVER expose this method through the HTTP or SSE gateway.
       */
      precheckExperimentalSectionOneHexIntent(request = {},trustedContext,policy) {
        const checked=screenAncientsMovementCommitIntent(request);
        if(checked.status!=='INTENT_SHAPE_VALID')
          return {status:400,code:'INVALID_SECTION_LAB_ONE_HEX_REQUEST'};
        // Do not re-read caller-owned fields after resolving identity. A
        // mutation during the session lookup must not change the piece, path
        // or revision that was screened before opening the WAL snapshot.
        // The screen deliberately omits credentials from its returned intent.
        let sessionToken;
        try { sessionToken=Object.getOwnPropertyDescriptor(request,'sessionToken').value; }
        catch { return {status:400,code:'INVALID_SECTION_LAB_ONE_HEX_REQUEST'}; }
        const normalizedRequest=Object.freeze({
          sessionToken,...checked.intent
        });
        // Verify that the captured credential still satisfies the same
        // strict input contract (a hostile proxy may vary its descriptors).
        if(screenAncientsMovementCommitIntent(normalizedRequest).status!=='INTENT_SHAPE_VALID')
          return {status:400,code:'INVALID_SECTION_LAB_ONE_HEX_REQUEST'};
        return readSnapshot(() => {
          const identity=resolveSectionLabActor(sessionToken);
          if(identity.error)return identity.error;
          if(!hasExperimentalSectionHistory(rowOrThrow()))
            return {status:409,code:'SECTION_LAB_NOT_INITIALIZED'};
          return sectionHistory.previewOneHexIntent(identity.actor,normalizedRequest,trustedContext,policy);
        });
      },
      /**
       * INTERNAL LAB ONLY: persist a PRIVATE hypothetical movement draft.
       * This is NOT an executed move. The game revision, public events and
       * board never change. No HTTP endpoint calls this method.
       */
      saveExperimentalSectionMovementDraft(request = {},trustedContext) {
        if(!plainLabRequest(request) || Object.keys(request).length!==5 ||
           !['sessionToken','expectedRevision','expectedDraftRevision',
             'idempotencyKey','actions'].every(k=>Object.hasOwn(request,k)) ||
           typeof request.sessionToken!=='string' ||
           !Number.isSafeInteger(request.expectedRevision)||request.expectedRevision<0 ||
           !Number.isSafeInteger(request.expectedDraftRevision)||request.expectedDraftRevision<0 ||
           typeof request.idempotencyKey!=='string'||!COMMAND_KEY.test(request.idempotencyKey)||
           !Array.isArray(request.actions)||request.actions.length<1||
           request.actions.length>117||
           !request.actions.every(a=>plainLabRequest(a)&&Object.keys(a).length===3&&
             ['kind','id','path'].every(k=>Object.hasOwn(a,k))&&
             ['UNIT','LEADER'].includes(a.kind)&&typeof a.id==='string'&&
             /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(a.id)&&a.id!=='__proto__'&&
             Array.isArray(a.path)&&a.path.length>0&&a.path.length<=32&&
             a.path.every(c=>plainLabRequest(c)&&Object.keys(c).length===2&&
               Object.hasOwn(c,'col')&&Object.hasOwn(c,'row')&&inBounds(c))))
          return {status:400,code:'INVALID_SECTION_LAB_DRAFT_REQUEST'};
        // No auth may be cached from outside this writer lock. An already
        // committed logout or membership change wins over any draft write.
        return atomic(() => {
          const identity=resolveSectionLabActor(request.sessionToken);
          if(identity.error)return identity.error;
          const row=rowOrThrow();
          if(!hasExperimentalSectionHistory(row))
            return {status:409,code:'SECTION_LAB_NOT_INITIALIZED'};
          if(row.game_revision!==request.expectedRevision)
            return {status:409,code:'STALE_REVISION'};
          const preview=sectionHistory.previewMovementSequence(identity.actor,request,trustedContext);
          if(preview.preview.status!=='CANDIDATE_SEQUENCE')
            return {status:409,code:'SECTION_LAB_DRAFT_NOT_CANDIDATE',
              reason:preview.preview.reason};
          const persisted=decode(row.private_state);
          const previous=Object.hasOwn(persisted,'ancientsSectionMovementDraft')
            ? persisted.ancientsSectionMovementDraft : null;
          const proposal=proposeMovementDraft({
            previous,matchId,actor:identity.actor,gameRevision:row.game_revision,
            expectedDraftRevision:request.expectedDraftRevision,
            idempotencyKey:request.idempotencyKey,actions:request.actions
          });
          if(!proposal.ok)return {status:409,code:proposal.code};
          if(proposal.code==='ALREADY_APPLIED')
            return {status:200,code:'ALREADY_APPLIED',
              draftRevision:proposal.draft.draftRevision,boardChanged:false};
          const updated={...persisted,ancientsSectionMovementDraft:proposal.draft};
          const write=db.prepare('UPDATE matches SET private_state=? WHERE id=? AND game_revision=?')
            .run(JSON.stringify(updated),matchId,row.game_revision);
          if(write.changes!==1)throw new Error('SECTION_LAB_DRAFT_CONCURRENT_UPDATE');
          return {status:200,code:'SECTION_LAB_DRAFT_SAVED',
            draftRevision:proposal.draft.draftRevision,boardChanged:false,
            movementAuthorized:false,attackAuthorized:false};
        });
      },
      /**
       * INTERNAL LAB ONLY: only the actor who owns the current-revision
       * draft sees its actions. A rival, a new turn or missing draft gets
       * the same null projection, never any saved private route or key.
       */
      viewExperimentalSectionMovementDraft(request = {}) {
        if(!plainLabRequest(request)||Object.keys(request).length!==1||
           !Object.hasOwn(request,'sessionToken')||
           typeof request.sessionToken!=='string')
          return {status:400,code:'INVALID_SECTION_LAB_DRAFT_REQUEST'};
        return readSnapshot(() => {
          const identity=resolveSectionLabActor(request.sessionToken);
          if(identity.error)return identity.error;
          const row=rowOrThrow();
          if(!hasExperimentalSectionHistory(row))
            return {status:409,code:'SECTION_LAB_NOT_INITIALIZED'};
          // Ensure private card/command replay still matches the SQLite log,
          // while keeping this new draft completely outside public events.
          sectionHistory.view(identity.actor);
          const persisted=decode(row.private_state);
          const draft=projectMovementDraft({
            draft: Object.hasOwn(persisted,'ancientsSectionMovementDraft')
              ? persisted.ancientsSectionMovementDraft : null,
            matchId,actor:identity.actor,gameRevision:row.game_revision
          });
          return {status:200,code:'SECTION_LAB_DRAFT_VIEW',draft};
        });
      },
      publicEvents(actor, {denyExperimentalLab = false} = {}) {
        if (!['A','B'].includes(actor)) return null;
        // Mode selection, replay verification and event read share a WAL
        // snapshot, without holding an IMMEDIATE writer lock.
        // The HTTP gateway opts out of lab data INSIDE this read transaction;
        // a lab activated after an earlier gateway check cannot leak events.
        return readSnapshot(() => {
          const row = rowOrThrow();
          if (hasExperimentalSectionHistory(row)) {
            if (denyExperimentalLab) return {status:409,code:'SECTION_LAB_INTERNAL_ONLY'};
            sectionHistory.view(actor);
          }
          return db.prepare("SELECT payload FROM game_events WHERE match_id=? AND visibility='public' ORDER BY sequence")
            .all(matchId).map(x => decode(x.payload));
        });
      },
      async dispatch(request = {}) {
        const {actor,type,expectedRevision,idempotencyKey} = request;
        if (!['A','B'].includes(actor)) return {status:403,code:'FORBIDDEN'};
        const row=rowOrThrow();
        if (hasExperimentalSectionHistory(row)) return {status:409,code:'SECTION_LAB_INTERNAL_ONLY'};
        if (hasCommandDeck(row)) return commandDeck.dispatch(request);
        if (type !== 'pass_demo_turn' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
            || typeof idempotencyKey !== 'string' || !COMMAND_KEY.test(idempotencyKey)) return {status:400,code:'INVALID_COMMAND'};
        return atomic(() => {
          const row = rowOrThrow();
          // A second SQLite process may initialize the private section lab
          // after our preflight but before BEGIN IMMEDIATE. Do not append a
          // synthetic demo event to the active lab journal.
          if (hasExperimentalSectionHistory(row))
            return {status:409,code:'SECTION_LAB_INTERNAL_ONLY'};
          const signature = `${type}:${expectedRevision}`;
          const previous = db.prepare('SELECT signature FROM game_commands WHERE match_id=? AND actor=? AND idem_key=?')
            .get(matchId,actor,idempotencyKey);
          if (previous) return previous.signature === signature
            ? {status:200,code:'ALREADY_APPLIED',view:project(row,actor)}
            : {status:409,code:'IDEMPOTENCY_KEY_REUSED'};
          if (row.game_revision !== expectedRevision) return {status:409,code:'STALE_REVISION',view:project(row,actor)};
          const state = decode(row.private_state);
          if (state.turn !== actor) return {status:403,code:'NOT_YOUR_TURN',view:project(row,actor)};
          state.turn = actor === 'A' ? 'B' : 'A';
          const revision = row.game_revision + 1;
          db.prepare('UPDATE matches SET game_revision=?, private_state=? WHERE id=?')
            .run(revision,JSON.stringify(state),matchId);
          const event = {sequence:revision,type:'DEMO_TURN_PASSED',actor,visibility:'public'};
          db.prepare('INSERT INTO game_events(match_id,sequence,visibility,payload) VALUES (?,?,?,?)')
            .run(matchId,revision,'public',JSON.stringify(event));
          db.prepare('INSERT INTO game_commands(match_id,actor,idem_key,signature,committed_revision) VALUES (?,?,?,?,?)')
            .run(matchId,actor,idempotencyKey,signature,revision);
          const updated = {...row,game_revision:revision,private_state:JSON.stringify(state)};
          return {status:200,code:'APPLIED',view:project(updated,actor)};
        });
      }
    };
  }

  let closed = false;
  function close() {if (!closed) {db.close(); closed = true;}}
  return Object.freeze({identity:sessions, invitations, getStore, close,
    /** Raw DB access FOR INTEGRATION TESTS ONLY; never expose to HTTP. */
    unsafeTestDatabase:()=>db});
}
