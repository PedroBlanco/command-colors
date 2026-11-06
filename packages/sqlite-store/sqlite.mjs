/**
 * CCW-008 local SQLite durability spike. Node 22 `node:sqlite` is experimental.
 * All operations use one DB transaction; never use with real player data or expose via Internet.
 */
import {DatabaseSync} from 'node:sqlite';
import {randomBytes, randomUUID, createHash, scrypt as callbackScrypt, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

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

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL, password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_digest TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES accounts(id),
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id),
  guest_id TEXT REFERENCES accounts(id), lobby_revision INTEGER NOT NULL DEFAULT 0,
  game_revision INTEGER NOT NULL DEFAULT 0, private_state TEXT NOT NULL,
  CHECK (guest_id IS NULL OR guest_id <> owner_id)
);
CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY, match_id TEXT NOT NULL REFERENCES matches(id),
  token_digest TEXT NOT NULL UNIQUE, target_handle TEXT NOT NULL,
  expires_at INTEGER NOT NULL, status TEXT NOT NULL
    CHECK (status IN ('PENDING','REVOKED','ACCEPTED','REJECTED','EXPIRED'))
);
CREATE INDEX IF NOT EXISTS invitations_by_match ON invitations(match_id);
CREATE TABLE IF NOT EXISTS game_events (
  match_id TEXT NOT NULL REFERENCES matches(id), sequence INTEGER NOT NULL,
  visibility TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY (match_id, sequence)
);
CREATE TABLE IF NOT EXISTS game_commands (
  match_id TEXT NOT NULL REFERENCES matches(id), actor TEXT NOT NULL,
  idem_key TEXT NOT NULL, signature TEXT NOT NULL,
  committed_revision INTEGER NOT NULL,
  PRIMARY KEY (match_id, actor, idem_key)
);
`;

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
  db.exec('PRAGMA busy_timeout = 4000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
  db.exec(SCHEMA);
  function atomic(fn) {
    db.exec('BEGIN IMMEDIATE');
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
    return {
      view(actor) {return project(rowOrThrow(), actor);},
      publicEvents(actor) {
        if (!['A','B'].includes(actor)) return null;
        rowOrThrow();
        return db.prepare("SELECT payload FROM game_events WHERE match_id=? AND visibility='public' ORDER BY sequence")
          .all(matchId).map(x => decode(x.payload));
      },
      async dispatch({actor,type,expectedRevision,idempotencyKey} = {}) {
        if (!['A','B'].includes(actor)) return {status:403,code:'FORBIDDEN'};
        if (type !== 'pass_demo_turn' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
            || typeof idempotencyKey !== 'string' || !COMMAND_KEY.test(idempotencyKey)) return {status:400,code:'INVALID_COMMAND'};
        return atomic(() => {
          const row = rowOrThrow();
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
