/**
 * CCW-015: isolated CCHL event journal for section cards. NOT the CCWB store.
 * Test-only bootstrapping; sessionUserId MUST come from trusted server auth.
 * The events contain private hands and must NEVER be served over HTTP.
 */
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {initializeSectionHistoryLab,applySectionHistoryLabCommand,
  assertSectionHistoryLab,projectSectionHistoryLab} from './section-history-journal.mjs';

const APP_ID=0x4343484c; // CCHL; different from both CCWB and CCRL
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const KEY=/^[A-Za-z0-9_-]{8,80}$/;
const TABLES=['history_commands','history_events','history_matches'];
const SQL=`
 CREATE TABLE history_matches (
  id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,guest_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>=0),private_json TEXT NOT NULL,
  CHECK(owner_id<>guest_id)
 );
 CREATE TABLE history_events (
  match_id TEXT NOT NULL REFERENCES history_matches(id),seq INTEGER NOT NULL,
  private_payload TEXT NOT NULL,public_payload TEXT NOT NULL,
  PRIMARY KEY(match_id,seq)
 );
 CREATE TABLE history_commands (
  match_id TEXT NOT NULL REFERENCES history_matches(id),actor TEXT NOT NULL,
  idem_key TEXT NOT NULL,signature TEXT NOT NULL,committed_revision INTEGER NOT NULL,
  PRIMARY KEY(match_id,actor,idem_key)
 );`;
const deny=(status,code)=>Object.freeze({status,code});
const allowed={PLAY_SECTION_CARD:['cardInstanceId'],ASSIGN_SECTION_ORDERS:['unitIds','leaderIds'],END_EXPERIMENTAL_TURN:[]};
const isRecord=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const validateRequest=r=>{
 if(!isRecord(r)||!Object.hasOwn(allowed,r.type)||!UUID.test(String(r.matchId))||
    typeof r.sessionUserId!=='string'||!r.sessionUserId||
    !Number.isSafeInteger(r.expectedRevision)||r.expectedRevision<0||
    typeof r.idempotencyKey!=='string'||!KEY.test(r.idempotencyKey))return false;
 const keys=['type','matchId','sessionUserId','expectedRevision','idempotencyKey',...allowed[r.type]];
 return Object.keys(r).length===keys.length&&keys.every(k=>Object.hasOwn(r,k));
};
const closeEnough=(x,y)=>JSON.stringify(x)===JSON.stringify(y);

export function openExperimentalSectionHistoryLab({file}={}){
 if(typeof file!=='string'||!file||file===':memory:')throw new TypeError('INVALID_HISTORY_LAB_FILE');
 mkdirSync(dirname(file),{recursive:true});
 const db=new DatabaseSync(file);
 try{
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=4000;');
  const app=db.prepare('PRAGMA application_id').get().application_id;
  const version=db.prepare('PRAGMA user_version').get().user_version;
  const tables=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map(x=>x.name);
  if(app===0&&version===0&&tables.length===0){
    db.exec('BEGIN IMMEDIATE');
    try{db.exec(SQL);db.exec(`PRAGMA application_id=${APP_ID}; PRAGMA user_version=1;`);db.exec('COMMIT');}
    catch(e){db.exec('ROLLBACK');throw e;}
  }else if(app!==APP_ID||version!==1||!closeEnough(tables,TABLES))
    throw new Error('NOT_SECTION_HISTORY_LAB');
  const actual=db.prepare("SELECT name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND type IN ('table','index','view','trigger') ORDER BY name").all();
  const expected=SQL.split(';').map(x=>x.trim()).filter(Boolean).map(sql=>({
    name:/^CREATE TABLE ([a-z_]+)/.exec(sql)?.[1],sql
  })).sort((a,b)=>a.name.localeCompare(b.name));
  const compact=x=>x.replace(/\s+/g,'');
  if(actual.length!==expected.length||actual.some((x,i)=>x.name!==expected[i].name||compact(x.sql)!==compact(expected[i].sql)))
    throw new Error('SECTION_HISTORY_SCHEMA_MISMATCH');
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('HISTORY_LAB_CORRUPT');
 }catch(e){db.close();throw e;}
 const get=db.prepare('SELECT * FROM history_matches WHERE id=?');
 const events=db.prepare('SELECT seq,private_payload,public_payload FROM history_events WHERE match_id=? ORDER BY seq');
 const existing=db.prepare('SELECT signature,committed_revision FROM history_commands WHERE match_id=? AND actor=? AND idem_key=?');
 const commandHistory=db.prepare('SELECT actor,signature,committed_revision FROM history_commands WHERE match_id=? ORDER BY committed_revision');
 const writeState=db.prepare('UPDATE history_matches SET revision=?,private_json=? WHERE id=? AND revision=?');
 const insertEvent=db.prepare('INSERT INTO history_events(match_id,seq,private_payload,public_payload) VALUES(?,?,?,?)');
 const insertCommand=db.prepare('INSERT INTO history_commands(match_id,actor,idem_key,signature,committed_revision) VALUES(?,?,?,?,?)');
 const tx=work=>{db.exec('BEGIN IMMEDIATE');try{const result=work();db.exec('COMMIT');return result;}
   catch(e){db.exec('ROLLBACK');throw e;}};
 const sideFor=(row,user)=>row.owner_id===user?'A':row.guest_id===user?'B':null;
 /** Replay all events; reject any mismatched/private public event or current projection. */
 function verify(row){
  const ev=events.all(row.id),commands=commandHistory.all(row.id);
  if(commands.length!==row.revision)throw new Error('SECTION_HISTORY_COMMAND_COUNT_MISMATCH');
  if(ev.length!==row.revision+1||ev.length>257)throw new Error('SECTION_HISTORY_EVENT_COUNT_MISMATCH');
  if(ev[0]?.seq!==0)throw new Error('SECTION_HISTORY_BOOTSTRAP_MISSING');
  const seed=JSON.parse(ev[0].private_payload);
  if(seed.kind!=='SECTION_HISTORY_BOOTSTRAP'||!seed.state)throw new Error('INVALID_HISTORY_BOOTSTRAP');
  let state=seed.state;assertSectionHistoryLab(state);
  if(state.revision!==0||!closeEnough(JSON.parse(ev[0].public_payload),{kind:'SECTION_HISTORY_INITIALIZED_LAB',sequence:0}))
    throw new Error('SECTION_HISTORY_INITIAL_EVENT_INVALID');
  for(let i=1;i<ev.length;i++){
   if(ev[i].seq!==i)throw new Error('SECTION_HISTORY_EVENT_SEQUENCE');
   const saved=JSON.parse(ev[i].private_payload);
   if(saved.kind!=='SECTION_HISTORY_COMMAND'||!isRecord(saved.command))throw new Error('INVALID_HISTORY_COMMAND_EVENT');
   if(commands[i-1]?.committed_revision!==i||commands[i-1].actor!==saved.command.actor||
      commands[i-1].signature!==JSON.stringify(saved.command))
     throw new Error('SECTION_HISTORY_COMMAND_EVENT_MISMATCH');
   const result=applySectionHistoryLabCommand(state,saved.command);
   if(!result.accepted||!closeEnough(result.publicEvent,JSON.parse(ev[i].public_payload)))
     throw new Error('SECTION_HISTORY_REPLAY_MISMATCH');
   state=result.nextState;
  }
  if(row.revision!==state.revision||!closeEnough(state,JSON.parse(row.private_json)))
    throw new Error('SECTION_HISTORY_SNAPSHOT_DRIFT');
  return state;
 }
 const safeRow=(matchId,user)=>{const row=get.get(matchId);const side=row&&sideFor(row,user);return side?{row,side}:null;};
 /** DEV-ONLY fixture; no exposed HTTP adapter. Card setup is server-trusted. */
 function seedFixture({matchId,ownerId,guestId,setup}={}){
  if(!UUID.test(String(matchId))||typeof ownerId!=='string'||!ownerId||
     typeof guestId!=='string'||!guestId||ownerId===guestId||!isRecord(setup))
    throw new TypeError('INVALID_HISTORY_SEED');
  const state=initializeSectionHistoryLab(setup);
  return tx(()=>{
    db.prepare('INSERT INTO history_matches(id,owner_id,guest_id,revision,private_json) VALUES(?,?,?,?,?)')
      .run(matchId,ownerId,guestId,0,JSON.stringify(state));
    insertEvent.run(matchId,0,JSON.stringify({kind:'SECTION_HISTORY_BOOTSTRAP',state}),
      JSON.stringify({kind:'SECTION_HISTORY_INITIALIZED_LAB',sequence:0}));
    return {matchId,revision:0};
  });
 }
 function dispatch(request={}){
  if(!validateRequest(request))return deny(400,'INVALID_HISTORY_COMMAND');
  return tx(()=>{
   const found=safeRow(request.matchId,request.sessionUserId);
   if(!found)return deny(404,'NOT_FOUND');
   const {row,side}=found;
   let state;
   try{state=verify(row);}catch{return deny(409,'HISTORY_INTEGRITY_UNAVAILABLE');}
   const command={type:request.type,actor:side,expectedRevision:request.expectedRevision};
   for(const field of allowed[request.type])command[field]=structuredClone(request[field]);
   const signature=JSON.stringify(command);
   const prior=existing.get(row.id,side,request.idempotencyKey);
   if(prior)return prior.signature===signature
     ? Object.freeze({status:200,code:'ALREADY_APPLIED',revision:prior.committed_revision,view:projectSectionHistoryLab(state,side)})
     :deny(409,'IDEMPOTENCY_KEY_REUSED');
   if(row.revision!==request.expectedRevision)return deny(409,'STALE_REVISION');
   const result=applySectionHistoryLabCommand(state,command);
   if(!result.accepted)return deny(result.code==='NOT_YOUR_TURN'?403:409,result.code);
   const next=result.nextState;
   if(writeState.run(next.revision,JSON.stringify(next),row.id,row.revision).changes!==1)
     throw new Error('HISTORY_CONCURRENT_UPDATE');
   insertEvent.run(row.id,next.revision,
      JSON.stringify({kind:'SECTION_HISTORY_COMMAND',command}),JSON.stringify(result.publicEvent));
   insertCommand.run(row.id,side,request.idempotencyKey,signature,next.revision);
   return Object.freeze({status:200,code:'LAB_COMMAND_RECORDED',revision:next.revision,
     view:projectSectionHistoryLab(next,side),attackAuthorized:false,combatResolved:false});
  });
 }
 function view({matchId,sessionUserId}={}){
  if(!UUID.test(String(matchId))||typeof sessionUserId!=='string'||!sessionUserId)
   return deny(400,'INVALID_HISTORY_VIEW');
  return tx(()=>{
   const found=safeRow(matchId,sessionUserId);if(!found)return deny(404,'NOT_FOUND');
   try{return Object.freeze({status:200,code:'LAB_HISTORY_VIEW',view:projectSectionHistoryLab(verify(found.row),found.side)});}
   catch{return deny(409,'HISTORY_INTEGRITY_UNAVAILABLE');}
  });
 }
 function publicEvents({matchId,sessionUserId}={}){
  if(!UUID.test(String(matchId))||typeof sessionUserId!=='string'||!sessionUserId)
   return deny(400,'INVALID_HISTORY_VIEW');
  return tx(()=>{
   const found=safeRow(matchId,sessionUserId);if(!found)return deny(404,'NOT_FOUND');
   try{verify(found.row);}catch{return deny(409,'HISTORY_INTEGRITY_UNAVAILABLE');}
   return Object.freeze({status:200,code:'LAB_PUBLIC_EVENTS',
     events:events.all(matchId).map(x=>JSON.parse(x.public_payload))});
  });
 }
 let closed=false;
 return Object.freeze({seedFixture,dispatch,view,publicEvents,
  unsafeTestDatabase:()=>db,close:()=>{if(!closed){db.close();closed=true;}}});
}
