/**
 * Experimental, separate SQLite store for reserving *candidates* of Ancients
 * ranged combat. NEVER attach this schema to the six-table CCW v1 database.
 * Only authenticated server code may supply sessionUserId and the checker.
 * No HTTP gateway, combat resolution, or official authorization is included.
 */
import {DatabaseSync} from 'node:sqlite';
import {randomUUID, createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {generateDigitalRoll, recordPhysicalRoll} from '../dice-roller/dice.mjs';
import {captureBaseAncientsRangedDice, interpretBaseAncientsRangedDice} from './battle-dice.mjs';
import {createRangedDicePlan, classifyRangedDicePlan} from './dice-plan.mjs';
import {deriveStagedAncientsRangedBlockLoss} from './ranged-block-snapshot.mjs';
import {planBaseAncientsRangedResolution} from './ranged-resolution-sequence.mjs';
import {preflightStagedAncientsRangedHits} from './ranged-hit-commit-preflight.mjs';
import {screenBaseAncientsSectionCardOrders} from './section-card-order-screen.mjs';

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
export function openAncientsReservationLab({file, checkDeclaration, dicePlanMode = 'SYNTHETIC'} = {}) {
  if (typeof file !== 'string' || !file || file === ':memory:' ||
      typeof checkDeclaration !== 'function' ||
      !['SYNTHETIC','OFFICIAL_PREVIEW'].includes(dicePlanMode)) throw new TypeError('INVALID_LAB_OPTIONS');
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
      const dicePlan=createRangedDicePlan({mode:dicePlanMode,screening:screened,board,targetId});
      turnState.pendingCombat={kind:'RANGED_SCREENING_ONLY',actor:side,
        attackerId,targetId,reservationId,fullValidationRequired:true,dicePlan};
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

  /**
   * Abort an UNRESOLVED screening reservation only. No dice or random outcome
   * exists in this lab; this is NOT an undo operation on a real combat.
   * Authorization is bound to the authenticated reserving player, never
   * inferred from a client-supplied side or participant label.
   */
  function cancel({matchId,sessionUserId,reservationId,expectedRevision,idempotencyKey} = {}) {
    if (!MATCH.test(String(matchId)) || typeof sessionUserId!=='string' || !sessionUserId ||
        !MATCH.test(String(reservationId)) ||
        !Number.isSafeInteger(expectedRevision) || expectedRevision<0 ||
        typeof idempotencyKey!=='string' || !KEY.test(idempotencyKey))
      return denied(400,'INVALID_CANCELLATION');
    return inTransaction(() => {
      const entry=row.get(matchId);
      const side=entry && sideFor(entry,sessionUserId);
      if (!side) return denied(404,'NOT_FOUND');
      const signature=JSON.stringify(['CANCEL_SCREENING',expectedRevision,reservationId]);
      const replay=previous.get(matchId,side,idempotencyKey);
      if (replay) return replay.signature===signature
        ? Object.freeze({status:200,code:'ALREADY_CANCELLED',revision:replay.committed_revision,
            reservationId:replay.reservation_id,attackAuthorized:false})
        : denied(409,'IDEMPOTENCY_KEY_REUSED');
      if (entry.revision!==expectedRevision) return denied(409,'STALE_REVISION');
      const turnState=JSON.parse(entry.turn_json);
      if (turnState.revision!==entry.revision) throw new Error('LAB_REVISION_MISMATCH');
      const marker=turnState.pendingCombat;
      if (!marker || marker.kind!=='RANGED_SCREENING_ONLY' || marker.actor!==side ||
          marker.reservationId!==reservationId || marker.fullValidationRequired!==true)
        return denied(409,'RESERVATION_NOT_CANCELLABLE');
      turnState.pendingCombat=null;
      const revision=entry.revision+1;
      turnState.revision=revision;
      if (update.run(revision,JSON.stringify(turnState),matchId,entry.revision).changes!==1)
        throw new Error('LAB_CONCURRENT_UPDATE');
      // Do not expose attack participants or internal reservation details.
      eventInsert.run(matchId,revision,JSON.stringify({sequence:revision,type:'RANGED_SCREENING_CANCELLED',side}));
      commandInsert.run(matchId,side,idempotencyKey,signature,reservationId,revision);
      return Object.freeze({status:200,code:'SCREENING_CANCELLED',revision,reservationId,
        attackAuthorized:false});
    });
  }

  /**
   * Records *synthetic* dice from an UNRESOLVED screening. It is not legal
   * combat resolution: no casualties, flags or turn-battle count are changed.
   * sessionUserId must be derived from a trusted authenticated server session.
   */
  function stageDice({matchId,sessionUserId,reservationId,expectedRevision,
    idempotencyKey,mode,declaredFaces} = {}) {
    if (!MATCH.test(String(matchId)) || typeof sessionUserId!=='string' || !sessionUserId ||
        !MATCH.test(String(reservationId)) || !Number.isSafeInteger(expectedRevision) ||
        expectedRevision<0 || typeof idempotencyKey!=='string' || !KEY.test(idempotencyKey) ||
        !['DIGITAL','PHYSICAL'].includes(mode) ||
        (mode==='DIGITAL' && declaredFaces!==undefined) ||
        (mode==='PHYSICAL' && (!Array.isArray(declaredFaces) ||
          declaredFaces.length<1 || declaredFaces.length>32 ||
          !declaredFaces.every(x=>typeof x==='string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(x)))))
      return denied(400,'INVALID_DICE_DECLARATION');
    // Copy the physical array to prevent mutation between signature and check.
    const faces=mode==='PHYSICAL' ? structuredClone(declaredFaces) : null;
    const signature=JSON.stringify(['STAGE_RANGED_DICE',expectedRevision,reservationId,mode,faces]);
    return inTransaction(() => {
      const entry=row.get(matchId);
      const side=entry && sideFor(entry,sessionUserId);
      if (!side) return denied(404,'NOT_FOUND');
      const replay=previous.get(matchId,side,idempotencyKey);
      const turnState=JSON.parse(entry.turn_json);
      if (turnState.revision!==entry.revision) throw new Error('LAB_REVISION_MISMATCH');
      if (replay) {
        if (replay.signature!==signature) return denied(409,'IDEMPOTENCY_KEY_REUSED');
        const saved=turnState.pendingCombat;
        if (!saved || !['RANGED_DICE_STAGED_SYNTHETIC','RANGED_DICE_STAGED_OFFICIAL_PREVIEW'].includes(saved.kind) ||
            saved.reservationId!==reservationId || saved.actor!==side || !saved.stagedDice)
          return denied(409,'DICE_REPLAY_UNAVAILABLE');
        return Object.freeze({status:200,code:'ALREADY_STAGED',revision:replay.committed_revision,
          reservationId,roll:structuredClone(saved.stagedDice),
          ...(saved.kind==='RANGED_DICE_STAGED_OFFICIAL_PREVIEW'
            ? {interpretation:structuredClone(saved.previewInterpretation),previewOnly:true} : {}),
          attackAuthorized:false,combatResolved:false});
      }
      if (entry.revision!==expectedRevision) return denied(409,'STALE_REVISION');
      const marker=turnState.pendingCombat;
      if (!marker || marker.kind!=='RANGED_SCREENING_ONLY' || marker.actor!==side ||
          marker.reservationId!==reservationId || marker.fullValidationRequired!==true)
        return denied(409,'RESERVATION_NOT_STAGEABLE');
      // Plans are server-owned, versioned and checked before any random draw.
      // Unknown or forged snapshots fail closed instead of becoming official.
      const plan=marker.dicePlan;
      const planKind=classifyRangedDicePlan(plan);
      if (!planKind) return denied(409,'DICE_PLAN_UNAVAILABLE');
      const spec={rollId:'roll_'+reservationId.replaceAll('-',''),actor:side,
        diceCount:plan.diceCount,dieFaces:plan.dieFaces};
      let roll,interpretation;
      try {
        if (planKind==='OFFICIAL_PREVIEW') {
          roll=captureBaseAncientsRangedDice({rollId:spec.rollId,actor:side,
            diceCount:plan.diceCount,mode,
            ...(mode==='PHYSICAL' ? {declaredFaces:faces} : {})});
          interpretation=interpretBaseAncientsRangedDice({
            roll,targetUnitType:plan.targetUnitType,expectedDiceCount:plan.diceCount});
        } else {
          roll=mode==='DIGITAL' ? generateDigitalRoll(spec) : recordPhysicalRoll(spec,faces);
        }
      } catch (error) {
        if (error instanceof TypeError) return denied(400,'INVALID_DICE_DECLARATION');
        throw error;
      }
      marker.kind=planKind==='OFFICIAL_PREVIEW'
        ? 'RANGED_DICE_STAGED_OFFICIAL_PREVIEW' : 'RANGED_DICE_STAGED_SYNTHETIC';
      marker.stagedDice=roll;
      if (interpretation) {
        marker.previewInterpretation=interpretation;
        // Bind a future read-only preview to the exact board bytes at dice staging.
        // Older captures without this marker stay readable by the old APIs, but
        // cannot be treated as block-loss snapshots without explicit attestation.
        marker.boardSnapshotSha256=createHash('sha256').update(entry.board_json).digest('hex');
      }
      const revision=entry.revision+1;
      turnState.revision=revision;
      if (update.run(revision,JSON.stringify(turnState),matchId,entry.revision).changes!==1)
        throw new Error('LAB_CONCURRENT_UPDATE');
      // Intentionally do not publish the faces, unit identifiers or roll ID.
      eventInsert.run(matchId,revision,JSON.stringify({sequence:revision,
        type:planKind==='OFFICIAL_PREVIEW' ? 'RANGED_DICE_STAGED_OFFICIAL_PREVIEW' : 'RANGED_DICE_STAGED_SYNTHETIC',
        side,source:mode,diceCount:plan.diceCount}));
      commandInsert.run(matchId,side,idempotencyKey,signature,reservationId,revision);
      return Object.freeze({status:200,code:planKind==='OFFICIAL_PREVIEW'
          ? 'DICE_STAGED_OFFICIAL_PREVIEW' : 'DICE_STAGED_SYNTHETIC',revision,reservationId,
        roll:structuredClone(roll),
        ...(interpretation ? {interpretation:structuredClone(interpretation),previewOnly:true} : {}),
        attackAuthorized:false,combatResolved:false});
    });
  }

  /**
   * Read one same-revision, server-owned snapshot of the original ranged roll,
   * target's remaining blocks and attached leaders. NO board write/event occurs.
   * This is deliberately NOT an HTTP handler or a battle resolution endpoint.
   */
  function previewStagedBlockLoss(request = {}) {
    const allowed = ['matchId','sessionUserId','reservationId','expectedRevision'];
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
        Object.keys(request).some(key => !allowed.includes(key)))
      return denied(400,'INVALID_PREVIEW_REQUEST');
    const {matchId,sessionUserId,reservationId,expectedRevision} = request;
    if (!MATCH.test(String(matchId)) || typeof sessionUserId!=='string' || !sessionUserId ||
        !MATCH.test(String(reservationId)) || !Number.isSafeInteger(expectedRevision) ||
        expectedRevision < 0) return denied(400,'INVALID_PREVIEW_REQUEST');
    return inTransaction(() => {
      const entry=row.get(matchId);
      const side=entry && sideFor(entry,sessionUserId);
      if (!side) return denied(404,'NOT_FOUND');
      if (entry.revision!==expectedRevision) return denied(409,'STALE_REVISION');
      const turnState=JSON.parse(entry.turn_json);
      if (turnState.revision!==entry.revision) throw new Error('LAB_REVISION_MISMATCH');
      const marker=turnState.pendingCombat;
      if (!marker || marker.actor!==side || marker.reservationId!==reservationId ||
          marker.kind!=='RANGED_DICE_STAGED_OFFICIAL_PREVIEW' ||
          typeof marker.boardSnapshotSha256!=='string' ||
          marker.boardSnapshotSha256!==createHash('sha256').update(entry.board_json).digest('hex'))
        return denied(409,'PREVIEW_NOT_AVAILABLE');
      let preview;
      try {
        preview=deriveStagedAncientsRangedBlockLoss({
          turnState,board:JSON.parse(entry.board_json),sessionSide:side,
          reservationId,expectedRevision
        });
      } catch {
        // Do not disclose which board, dice or leader field is inconsistent.
        return denied(409,'PREVIEW_NOT_AVAILABLE');
      }
      return Object.freeze({status:200,code:'BLOCK_LOSS_PREVIEW',revision:entry.revision,
        preview,attackAuthorized:false,combatResolved:false,boardMutated:false});
    });
  }

  /**
   * Read-only checklist for the next provisional post-dice resolution steps.
   * Delegates to the same authenticated/revision-bound SQLite snapshot reader.
   * It is NOT a command, effect application, or leader-dice executor.
   */
  function previewResolutionChecklist(request = {}) {
    const snapshot = previewStagedBlockLoss(request);
    if (snapshot.code !== 'BLOCK_LOSS_PREVIEW') return snapshot;
    const checklist = planBaseAncientsRangedResolution({blockLoss:snapshot.preview});
    return Object.freeze({status:200,code:'RANGED_RESOLUTION_CHECKLIST',
      revision:snapshot.revision,checklist,
      attackAuthorized:false,combatResolved:false,boardMutated:false});
  }

  /**
   * Propose the exact target-block delta without applying it. A future commit
   * MUST repeat all checks inside its own authorized write transaction.
   */
  function preflightDirectHits(request = {}) {
    const allowed=['matchId','sessionUserId','reservationId','expectedRevision'];
    if (!request || typeof request!=='object' || Array.isArray(request) ||
        Object.keys(request).some(key=>!allowed.includes(key)))
      return denied(400,'INVALID_PREVIEW_REQUEST');
    const {matchId,sessionUserId,reservationId,expectedRevision}=request;
    if (!MATCH.test(String(matchId)) || typeof sessionUserId!=='string' || !sessionUserId ||
        !MATCH.test(String(reservationId)) || !Number.isSafeInteger(expectedRevision) ||
        expectedRevision<0) return denied(400,'INVALID_PREVIEW_REQUEST');
    return inTransaction(()=>{
      const entry=row.get(matchId);
      const side=entry && sideFor(entry,sessionUserId);
      if (!side) return denied(404,'NOT_FOUND');
      if (entry.revision!==expectedRevision) return denied(409,'STALE_REVISION');
      const turnState=JSON.parse(entry.turn_json),marker=turnState.pendingCombat;
      if (turnState.revision!==entry.revision) throw new Error('LAB_REVISION_MISMATCH');
      if (!marker || marker.actor!==side || marker.reservationId!==reservationId ||
          marker.kind!=='RANGED_DICE_STAGED_OFFICIAL_PREVIEW' ||
          typeof marker.boardSnapshotSha256!=='string' ||
          marker.boardSnapshotSha256!==createHash('sha256').update(entry.board_json).digest('hex'))
        return denied(409,'PREFLIGHT_UNAVAILABLE');
      let proposal;
      try {
        proposal=preflightStagedAncientsRangedHits({
          turnState,board:JSON.parse(entry.board_json),sessionSide:side,
          reservationId,expectedRevision
        });
      } catch {return denied(409,'PREFLIGHT_UNAVAILABLE');}
      return Object.freeze({status:200,code:'DIRECT_HITS_PREFLIGHT',
        revision:entry.revision,proposal,attackAuthorized:false,
        commitPermitted:false,boardMutated:false});
    });
  }

  /**
   * Read-only diagnostic of an optional SERVER-ONLY order provenance fixture.
   * It NEVER authorizes a card; deck/event and sector-map authenticity are
   * still unverified. Private hand and unit identifiers never leave this API.
   */
  function previewSectionOrderProof(request = {}) {
    const allowed=['matchId','sessionUserId','expectedRevision'];
    if (!request || typeof request!=='object' || Array.isArray(request) ||
        Object.keys(request).some(key=>!allowed.includes(key)))
      return denied(400,'INVALID_SECTION_ORDER_REQUEST');
    const {matchId,sessionUserId,expectedRevision}=request;
    if (!MATCH.test(String(matchId)) || typeof sessionUserId!=='string' ||
        !sessionUserId || !Number.isSafeInteger(expectedRevision) ||
        expectedRevision<0) return denied(400,'INVALID_SECTION_ORDER_REQUEST');
    return inTransaction(()=>{
      const entry=row.get(matchId);
      const side=entry && sideFor(entry,sessionUserId);
      if (!side) return denied(404,'NOT_FOUND');
      if (entry.revision!==expectedRevision) return denied(409,'STALE_REVISION');
      const turnState=JSON.parse(entry.turn_json);
      if (turnState.revision!==entry.revision)
        throw new Error('LAB_REVISION_MISMATCH');
      const proof=turnState.sectionOrderProof;
      if (!proof || typeof proof!=='object' || Array.isArray(proof))
        return denied(409,'SECTION_ORDER_PROOF_UNAVAILABLE');
      let screened;
      try {
        screened=screenBaseAncientsSectionCardOrders({
          turnState,sessionSide:side,expectedRevision,
          handAtPlay:proof.handAtPlay,cardPlay:proof.cardPlay,
          orderSnapshot:proof.orderSnapshot
        });
      } catch {return denied(409,'SECTION_ORDER_PROOF_UNAVAILABLE');}
      if (screened.status!=='CANDIDATE')
        return denied(409,'SECTION_ORDER_PROOF_UNAVAILABLE');
      return Object.freeze({status:200,code:'SECTION_ORDERS_SCREENED',
        revision:entry.revision,screening:screened,
        cardPlayAuthorized:false,ordersAuthorized:false,
        attackAuthorized:false,boardMutated:false});
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
  return Object.freeze({seedFixture,reserve,cancel,stageDice,previewStagedBlockLoss,previewResolutionChecklist,preflightDirectHits,previewSectionOrderProof,inspectFixture,
    unsafeTestDatabase:()=>db,
    close:()=>{if (!closed) {db.close();closed=true;}}});
}
