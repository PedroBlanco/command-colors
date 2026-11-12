/**
 * Native SQLite/WAL durability tests for the pure PRIVATE draft contract.
 * This isolated fixture deliberately does NOT pretend to execute the full
 * CCWB composition, which has separate pending integration tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {proposeMovementDraft,projectMovementDraft,assertMovementDraft} from './movement-draft-contract.mjs';

const MATCH='123e4567-e89b-42d3-a456-426614174000';
const actions=()=>[{kind:'LEADER',id:'leaderA',path:[{col:2,row:5}]}];
const proposal=(changes={})=>({matchId:MATCH,actor:'A',gameRevision:2,
  expectedDraftRevision:0,idempotencyKey:'draft_sqlite_001',actions:actions(),...changes});
function fixture(fn){
  const dir=mkdtempSync(join(tmpdir(),'ccw-draft-wal-'));
  const file=join(dir,'matches.sqlite');
  const opened=[];
  function connect(){
    const db=new DatabaseSync(file);opened.push(db);
    db.exec('PRAGMA busy_timeout=200; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    return db;
  }
  try{
    const first=connect();
    first.exec(`CREATE TABLE matches(id TEXT PRIMARY KEY,game_revision INTEGER NOT NULL,private_state TEXT NOT NULL);
      CREATE TABLE public_events(id INTEGER PRIMARY KEY,payload TEXT NOT NULL);`);
    first.prepare('INSERT INTO matches(id,game_revision,private_state) VALUES(?,?,?)')
      .run(MATCH,2,JSON.stringify({board:{units:[{id:'front',col:2,row:4}]}}));
    fn({first,connect});
  }finally{
    for(const db of opened.reverse())try{db.close()}catch{}
    rmSync(dir,{recursive:true,force:true,maxRetries:15,retryDelay:100});
  }
}
const row=db=>db.prepare('SELECT * FROM matches WHERE id=?').get(MATCH);
const savedDraft=db=>JSON.parse(row(db).private_state).draft??null;
function store(db,request){
  db.exec('BEGIN IMMEDIATE');
  try{
    const current=row(db),state=JSON.parse(current.private_state);
    if(current.game_revision!==request.gameRevision){db.exec('ROLLBACK');return {ok:false,code:'STALE_GAME_REVISION'};}
    const result=proposeMovementDraft({previous:state.draft??null,...request});
    if(!result.ok||result.code==='ALREADY_APPLIED'){
      db.exec('ROLLBACK');return result;
    }
    state.draft=result.draft;
    db.prepare('UPDATE matches SET private_state=? WHERE id=?').run(JSON.stringify(state),MATCH);
    db.exec('COMMIT');
    return result;
  }catch(error){db.exec('ROLLBACK');throw error;}
}

test('native WAL: private movement draft persists across new SQLite connection without game mutation',()=>fixture(({first,connect})=>{
  const before=row(first),eventCount=first.prepare('SELECT COUNT(*) AS n FROM public_events').get().n;
  const result=store(first,proposal());
  assert.equal(result.code,'DRAFT_STORED');
  assert.equal(first.isTransaction,false);
  const other=connect(),state=JSON.parse(row(other).private_state);
  assertMovementDraft(state.draft,MATCH);
  assert.deepEqual(projectMovementDraft({draft:state.draft,matchId:MATCH,actor:'A',gameRevision:2}).actions,actions());
  assert.equal(projectMovementDraft({draft:state.draft,matchId:MATCH,actor:'B',gameRevision:2}),null);
  assert.equal(row(other).game_revision,before.game_revision);
  assert.deepEqual(state.board,JSON.parse(before.private_state).board);
  assert.equal(other.prepare('SELECT COUNT(*) AS n FROM public_events').get().n,eventCount);
}));

test('native WAL: retry and stale optimistic update leave durable bytes unchanged',()=>fixture(({first,connect})=>{
  const one=store(first,proposal());assert.equal(one.code,'DRAFT_STORED');
  const before=row(first).private_state;
  const second=connect();
  assert.equal(store(second,proposal()).code,'ALREADY_APPLIED');
  assert.deepEqual(store(first,proposal({idempotencyKey:'draft_sqlite_002'})),{ok:false,code:'STALE_DRAFT_REVISION'});
  assert.deepEqual(store(first,proposal({actions:[{kind:'LEADER',id:'leaderA',path:[{col:3,row:5}]}]})),
    {ok:false,code:'IDEMPOTENCY_KEY_REUSED'});
  assert.equal(row(second).private_state,before);
  assert.equal(first.isTransaction,false);
}));

test('native WAL: overlapping read snapshot sees consistent old draft until it finishes',()=>fixture(({first,connect})=>{
  store(first,proposal());
  const reader=connect();reader.exec('BEGIN');
  const old=row(reader);
  assert.equal(JSON.parse(old.private_state).draft.draftRevision,1);
  assert.equal(store(first,proposal({expectedDraftRevision:1,idempotencyKey:'draft_sqlite_002'})).code,'DRAFT_STORED');
  assert.equal(JSON.parse(row(reader).private_state).draft.draftRevision,1);
  reader.exec('COMMIT');
  assert.equal(JSON.parse(row(reader).private_state).draft.draftRevision,2);
  assert.equal(reader.isTransaction,false);
}));

test('native SQLite: BEGIN IMMEDIATE serializes draft writers and prevents lost update',()=>fixture(({first,connect})=>{
  const second=connect();
  first.exec('BEGIN IMMEDIATE');
  try{
    assert.throws(()=>second.exec('BEGIN IMMEDIATE'),error=>error.code==='ERR_SQLITE_ERROR');
    assert.equal(second.isTransaction,false);
  }finally{first.exec('ROLLBACK');}
  assert.equal(store(second,proposal()).code,'DRAFT_STORED');
  const stale=store(first,proposal({idempotencyKey:'draft_sqlite_003'}));
  assert.deepEqual(stale,{ok:false,code:'STALE_DRAFT_REVISION'});
  assert.equal(row(first).game_revision,2);
}));

test('native SQLite: advancing game revision makes an old draft invisible to both participants',()=>fixture(({first,connect})=>{
  store(first,proposal());
  const writer=connect();
  writer.prepare('UPDATE matches SET game_revision=game_revision+1 WHERE id=?').run(MATCH);
  assert.equal(projectMovementDraft({draft:savedDraft(first),matchId:MATCH,actor:'A',gameRevision:3}),null);
  assert.equal(projectMovementDraft({draft:savedDraft(first),matchId:MATCH,actor:'B',gameRevision:3}),null);
  assert.deepEqual(store(first,proposal()),{ok:false,code:'STALE_GAME_REVISION'});
  assert.equal(first.isTransaction,false);
}));

test('native SQLite: corrupt serialized draft is detected and cannot be projected',()=>fixture(({first})=>{
  store(first,proposal());
  const state=JSON.parse(row(first).private_state);
  state.draft.actions[0].path[0].row=6;
  first.prepare('UPDATE matches SET private_state=? WHERE id=?').run(JSON.stringify(state),MATCH);
  assert.throws(()=>projectMovementDraft({draft:savedDraft(first),matchId:MATCH,actor:'A',gameRevision:2}),
    /SECTION_LAB_MOVEMENT_DRAFT_CORRUPT/);
  assert.equal(first.isTransaction,false);
}));
