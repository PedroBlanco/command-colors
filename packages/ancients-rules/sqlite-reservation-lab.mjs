/**
 * Experimental, separate SQLite store for reserving *candidates* of Ancients
 * ranged combat. NEVER attach this schema to the six-table CCW v1 database.
 * Only authenticated server code may supply sessionUserId and the checker.
 * No HTTP gateway, combat resolution, or official authorization is included.
 */
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

const APP_ID = 0x4343524c; // 'CCRL', distinct from the main CCWB SQLite app_id.
const KEY = /^[a-zA-Z0-9_-]{8,80}$/;
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const MATCH = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const denied = (status, code) => Object.freeze({status, code});
const schema = `
 CREATE TABLE lab_matches (
   id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, guest_id TEXT NOT NULL,
   revision INTEGER NOT NULL CHECK(revision>=0), turn_json TEXT NOT NULL,
   board_json TEXT NOT NULL, CHECK(owner_id<>guest_id)
 );
 CREATE TABLE lab_events (
   match_id TEXT NOT NULL REFERENCES lab_matches(id), sequence INTEGER NOT NULL,
   payload TEXT NOT NULL, PRIMARY KEY(match_id,sequence)
 );
 CREATE TABLE lab_commands (
   match_id TEXT NOT NULL REFERENCES lab_matches(id), actor TEXT NOT NULL,
   idem_key TEXT NOT NULL, signature TEXT NOT NULL, reservation_id TEXT NOT NULL,
   committed_revision INTEGER NOT NULL,
   PRIMARY KEY(match_id,actor,idem_key)
 );`;
const expectedTables = ['lab_commands','lab_events','lab_matches'];

/** Only accepts empty SQLite files or previously marked CCRL v1 databases. */
export function openAncientsReservationLab({file, checkDeclaration} = {}) {
  if (typeof file !== 'string' || !file || file === ':memory:' ||
      typeof checkDeclaration !== 'function') throw new TypeError('INVALID_LAB_OPTIONS');
  mkdirSync(dirname(file), {recursive:true});
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=4000;');
    const app = db.prepare('PRAGMA application_id').get().application_id;
    const version = db.prepare('PRAGMA user_version').get().user_version;
    const existing = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all().map(x=>x.name);
    if (existing.length === 0 && app === 0 && version === 0) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec(schema);
        db.exec(`PRAGMA application_id=${APP_ID}; PRAGMA user_version=1;`);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    } else if (app !== APP_ID || version !== 1 ||
        JSON.stringify(existing) !== JSON.stringify(expectedTables)) {
      throw new Error('NOT_ANCIENTS_RESERVATION_LAB');
    }
    // A matching app_id is not enough: reject a modified laboratory schema.
    const actualDDL=db.prepare(`SELECT name,sql FROM sqlite_schema
      WHERE type IN ('table','index','trigger','view') AND sql IS NOT NULL
      ORDER BY name`).all();
    const expectedDDL=schema.split(';').map(s=>s.trim()).filter(Boolean)
      .map(sql=>({name:/^CREATE TABLE ([a-z_]+)/.exec(sql)?.[1],sql}))
      .sort((a,b)=>a.name.localeCompare(b.name));
    const compact=sql=>sql.replace(/\s+/g,'').replace(/IFNOTEXISTS/gi,'');
    if (actualDDL.length!==expectedDDL.length || actualDDL.some((entry,i)=>
        entry.name!==expectedDDL[i].name || compact(entry.sql)!==compact(expectedDDL[i].sql)))
      throw new Error('LAB_SCHEMA_MISMATCH');
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok')
      throw new Error('LAB_DATABASE_CORRUPT');
  } catch (e) { db.close(); throw e; }

  const row = db.prepare('SELECT * FROM lab_matches WHERE id=?');
  const previous = db.prepare('SELECT * FROM lab_commands WHERE match_id=? AND actor=? AND idem_key=?');
  const insertMatch = db.prepare('INSERT INTO lab_matches(id,owner_id,guest_id,revision,turn_json,board_json) VALUES(?,?,?,?,?,?)');
  const update = db.prepare('UPDATE lab_matches SET revision=?,turn_json=? WHERE id=? AND revision=?');
  const eventInsert = db.prepare('INSERT INTO lab_events(match_id,sequence,payload) VALUES(?,?,?)');
  const commandInsert = db.prepare('INSERT INTO lab_commands(match_id,actor,idem_key,signature,reservation_id,committed_revision) VALUES(?,?,?,?,?,?)');
  const events = db.prepare('SELECT payload FROM lab_events WHERE match_id=? ORDER BY sequence');
  const inTransaction = operation => {
    db.exec('BEGIN IMMEDIATE');
    try { const value=operation(); db.exec('COMMIT'); return value; }
    catch (e) {db.exec('ROLLBACK'); throw e;}
  };
  const sideFor = (entry, userId) => entry.owner_id===userId ? 'A' : entry.guest_id===userId ? 'B' : null;

  /** DEV FIXTURE ONLY. Caller must construct trusted board and turn state. */
  function seedFixture({matchId, ownerId, guestId, turnState, board} = {}) {
    if (!MATCH.test(String(matchId)) || typeof ownerId!=='string' || !ownerId ||
        typeof guestId!=='string' || !guestId || ownerId===guestId ||
        !turnState || !Number.isSafeInteger(turnState.revision) || turnState.revision<0 ||
        !board || typeof board!=='object') throw new TypeError('INVALID_LAB_FIXTURE');
    return inTransaction(() => {
      insertMatch.run(matchId,ownerId,guestId,turnState.revision,JSON.stringify(turnState),JSON.stringify(board));
      return Object.freeze({matchId,revision:turnState.revision});
    });
  }

  /** This is not an HTTP endpoint; sessionUserId MUST be verified by server. */
  function reserve({matchId,sessionUserId,attackerId,targetId,expectedRevision,idempotencyKey} = {}) {
    if (!MATCH.test(String(matchId)) || typeof sessionUserId!=='string' || !sessionUserId ||
        typeof attackerId!=='string' || !ID.test(attackerId) ||
        typeof targetId!=='string' || !ID.test(targetId) || attackerId===targetId ||
        !Number.isSafeInteger(expectedRevision) || expectedRevision<0 ||
        typeof idempotencyKey!=='string' || !KEY.test(idempotencyKey))
      return denied(400,'INVALID_DECLARATION');
    return inTransaction(() => {
      const entry=row.get(matchId);
      const side=entry && sideFor(entry,sessionUserId);
      if (!side) return denied(404,'NOT_FOUND');
      const signature=JSON.stringify([expectedRevision,attackerId,targetId]);
      const replay=previous.get(matchId,side,idempotencyKey);
      if (replay) return replay.signature===signature
        ? Object.freeze({status:200,code:'ALREADY_RESERVED',revision:replay.committed_revision,
            reservationId:replay.reservation_id,attackAuthorized:false})
        : denied(409,'IDEMPOTENCY_KEY_REUSED');
      if (entry.revision!==expectedRevision) return denied(409,'STALE_REVISION');
      const turnState=JSON.parse(entry.turn_json),board=JSON.parse(entry.board_json);
      if (turnState.revision!==entry.revision) throw new Error('LAB_REVISION_MISMATCH');
      const screened=checkDeclaration({turnState:structuredClone(turnState),board:structuredClone(board),
        sessionSide:side,attackerId,targetId,expectedRevision});
      if (!screened || screened.status!=='CANDIDATE' || screened.attackAuthorized!==false ||
          screened.needsFullLegalityCheck!==true) return denied(409,'DECLARATION_REJECTED');
      const reservationId=randomUUID(),revision=entry.revision+1;
      turnState.pendingCombat={kind:'RANGED_SCREENING_ONLY',actor:side,
        attackerId,targetId,reservationId,fullValidationRequired:true};
      turnState.revision=revision;
      if (update.run(revision,JSON.stringify(turnState),matchId,entry.revision).changes!==1)
        throw new Error('LAB_CONCURRENT_UPDATE');
      // Minimal public audit event; never persist hands, dice or LOS diagnostics.
      eventInsert.run(matchId,revision,JSON.stringify({sequence:revision,type:'RANGED_SCREENING_RESERVED',side}));
      commandInsert.run(matchId,side,idempotencyKey,signature,reservationId,revision);
      return Object.freeze({status:200,code:'SCREENING_RESERVED',revision,reservationId,
        attackAuthorized:false,fullValidationRequired:true});
    });
  }

  /** Restricted test-only inspection; intentionally not part of a network API. */
  const inspectFixture = ({matchId,sessionUserId} = {}) => {
    const entry=row.get(matchId);
    if (!entry || !sideFor(entry,sessionUserId)) return null;
    return {revision:entry.revision,turnState:JSON.parse(entry.turn_json),
      events:events.all(matchId).map(x=>JSON.parse(x.payload))};
  };
  let closed=false;
  return Object.freeze({seedFixture,reserve,inspectFixture,
    unsafeTestDatabase:()=>db,
    close:()=>{if (!closed) {db.close();closed=true;}}});
}
