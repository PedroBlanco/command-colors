/**
 * TEST-FIXTURE ONLY: atomic direct-hit block mutation in a separate CCRL lab.
 * It is NOT authorized Ancients combat. No HTTP route may expose this API.
 * An opt-in fixture bit and a trusted preview callback are BOTH mandatory.
 */
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {prepareLabDirectHitEffect} from './lab-direct-hit-effect.mjs';

const CCRL=0x4343524c;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const KEY=/^[A-Za-z0-9_-]{8,80}$/;
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
const expectedDDL=schema.split(';').map(x=>x.trim()).filter(Boolean)
  .map(sql=>({name:/^CREATE TABLE ([a-z_]+)/.exec(sql)?.[1],sql}))
  .sort((a,b)=>a.name.localeCompare(b.name));
const compact=sql=>sql.replace(/\s+/g,'');
const denied=(status,code)=>Object.freeze({status,code});
const digest=value=>createHash('sha256').update(value).digest('hex');

export function openLabOnlyDirectHitCommit({file,deriveTrustedPreview,allowTestFixtureMutation=false}={}) {
  if (typeof file!=='string' || !file || file===':memory:' ||
      typeof deriveTrustedPreview!=='function' || allowTestFixtureMutation!==true)
    throw new TypeError('UNSAFE_LAB_HIT_COMMIT_DISABLED');
  const db=new DatabaseSync(file);
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=4000');
    if (db.prepare('PRAGMA application_id').get().application_id!==CCRL ||
        db.prepare('PRAGMA user_version').get().user_version!==1) throw new Error('NOT_CCRL_LAB');
    const tables=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
    if(JSON.stringify(tables)!==JSON.stringify(['lab_commands','lab_events','lab_matches']))
      throw new Error('NOT_CCRL_LAB');
    const actualDDL=db.prepare(`SELECT name,sql FROM sqlite_schema
      WHERE type IN ('table','index','trigger','view') AND sql IS NOT NULL
      ORDER BY name`).all();
    if(actualDDL.length!==expectedDDL.length || actualDDL.some((entry,i)=>
      entry.name!==expectedDDL[i].name || compact(entry.sql)!==compact(expectedDDL[i].sql)))
      throw new Error('LAB_SCHEMA_MISMATCH');
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')
      throw new Error('LAB_DATABASE_CORRUPT');
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
  }catch(e){db.close();throw e;}
  const match=db.prepare('SELECT * FROM lab_matches WHERE id=?');
  const command=db.prepare('SELECT * FROM lab_commands WHERE match_id=? AND actor=? AND idem_key=?');
  const update=db.prepare('UPDATE lab_matches SET revision=?,turn_json=?,board_json=? WHERE id=? AND revision=?');
  const event=db.prepare('INSERT INTO lab_events(match_id,sequence,payload) VALUES(?,?,?)');
  const insertCommand=db.prepare('INSERT INTO lab_commands(match_id,actor,idem_key,signature,reservation_id,committed_revision) VALUES(?,?,?,?,?,?)');
  let closed=false;

  function apply(request={}) {
    if(!request || typeof request!=='object' || Array.isArray(request))
      return denied(400,'INVALID_LAB_HIT_REQUEST');
    const {matchId,sessionUserId,reservationId,expectedRevision,idempotencyKey,...extra}=request;
    if(Object.keys(extra).length || typeof matchId!=='string' || !UUID.test(matchId) ||
        typeof sessionUserId!=='string' || !sessionUserId ||
        typeof reservationId!=='string' || !UUID.test(reservationId) ||
        !Number.isSafeInteger(expectedRevision) || expectedRevision<0 ||
        typeof idempotencyKey!=='string' || !KEY.test(idempotencyKey))
      return denied(400,'INVALID_LAB_HIT_REQUEST');
    db.exec('BEGIN IMMEDIATE');
    try {
      const entry=match.get(matchId);
      const side=entry?.owner_id===sessionUserId?'A':entry?.guest_id===sessionUserId?'B':null;
      if (!side) return finish(denied(404,'NOT_FOUND'));
      const signature=JSON.stringify(['LAB_APPLY_DIRECT_HITS_V1',expectedRevision,reservationId]);
      const replay=command.get(matchId,side,idempotencyKey);
      const state=JSON.parse(entry.turn_json);
      if(state.revision!==entry.revision)throw new Error('LAB_REVISION_MISMATCH');
      const marker=state.pendingCombat;
      if(replay) {
        if(replay.signature!==signature) return finish(denied(409,'IDEMPOTENCY_KEY_REUSED'));
        if(!marker || marker.kind!=='LAB_DIRECT_HITS_APPLIED_FIXTURE' ||
            marker.reservationId!==reservationId || marker.actor!==side ||
            !marker.appliedFixture || marker.appliedFixture.revision!==replay.committed_revision)
          return finish(denied(409,'LAB_REPLAY_UNAVAILABLE'));
        return finish(Object.freeze({status:200,code:'ALREADY_APPLIED_FIXTURE',
          revision:replay.committed_revision,summary:structuredClone(marker.appliedFixture.summary),
          labOnly:true,attackAuthorized:false,combatResolved:false}));
      }
      if(entry.revision!==expectedRevision)return finish(denied(409,'STALE_REVISION'));
      if(state.labFixtureOnly!==true || state.status!=='ACTIVE' || state.turn!==side ||
          state.phase!=='COMBAT' || !marker ||
          marker.kind!=='RANGED_DICE_STAGED_OFFICIAL_PREVIEW' ||
          marker.actor!==side || marker.reservationId!==reservationId ||
          marker.fullValidationRequired!==true ||
          marker.boardSnapshotSha256!==digest(entry.board_json))
        return finish(denied(409,'LAB_HITS_NOT_APPLICABLE'));

      let effect;
      try {
        const board=JSON.parse(entry.board_json);
        const preview=deriveTrustedPreview({turnState:structuredClone(state),
          board:structuredClone(board),sessionSide:side,reservationId,expectedRevision});
        effect=prepareLabDirectHitEffect({board,targetId:marker.targetId,preview});
      } catch {return finish(denied(409,'LAB_HITS_NOT_APPLICABLE'));}
      const revision=entry.revision+1;
      const boardJson=JSON.stringify(effect.board);
      marker.kind='LAB_DIRECT_HITS_APPLIED_FIXTURE';
      marker.appliedFixture={revision,summary:effect.summary,
        boardAfterSha256:digest(boardJson),unverifiedFullRules:true};
      state.revision=revision;
      if(update.run(revision,JSON.stringify(state),boardJson,matchId,entry.revision).changes!==1)
        throw new Error('LAB_CONCURRENT_UPDATE');
      const eventType=effect.summary.blocksRemoved>0?'LAB_DIRECT_HITS_APPLIED':'LAB_DIRECT_HITS_SKIPPED';
      event.run(matchId,revision,JSON.stringify({sequence:revision,type:eventType,side,
        blocksRemoved:effect.summary.blocksRemoved}));
      insertCommand.run(matchId,side,idempotencyKey,signature,reservationId,revision);
      return finish(Object.freeze({status:200,code:'LAB_DIRECT_HITS_APPLIED_FIXTURE',
        revision,summary:structuredClone(effect.summary),labOnly:true,
        attackAuthorized:false,combatResolved:false}));
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  function finish(value){db.exec('COMMIT');return value;}
  return Object.freeze({apply,close:()=>{if(!closed){db.close();closed=true;}}});
}
