/**
 * LAB-ANC / SEC-001 — native SQLite/WAL contract probes.
 * Standalone tests of SQLite snapshot/rollback semantics. They deliberately do
 * NOT claim to execute the full CCWB composition or authorize game moves.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function withWal(run) {
  const dir=mkdtempSync(join(tmpdir(),'ccw-wal-contract-'));
  const file=join(dir,'lab.sqlite');
  const dbs=[];
  const connect=()=>{
    const db=new DatabaseSync(file);
    db.exec('PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON;');
    dbs.push(db);
    return db;
  };
  try {
    const a=connect();
    a.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE sessions (token TEXT PRIMARY KEY, live INTEGER NOT NULL);
      CREATE TABLE memberships (user_id TEXT PRIMARY KEY, side TEXT NOT NULL);
      CREATE TABLE matches (id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
      CREATE TABLE events (match_id TEXT NOT NULL, revision INTEGER NOT NULL,
        payload TEXT NOT NULL, PRIMARY KEY(match_id,revision));
      INSERT INTO sessions VALUES('token-a',1);
      INSERT INTO memberships VALUES('user-a','A');
      INSERT INTO matches VALUES('match-1',0);`);
    return run({reader:a,writer:connect(),connect});
  } finally {
    for(const db of dbs.reverse())try {if(db.isTransaction) db.exec('ROLLBACK');db.close();}catch{}
    rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:50});
  }
}
const scalar=(db,sql)=>db.prepare(sql).get();

test('WAL: an uncommitted logout cannot revoke an already-open reader snapshot',()=>withWal(({reader,writer})=>{
  reader.exec('BEGIN');
  try {
    assert.equal(scalar(reader,"SELECT live FROM sessions WHERE token='token-a'").live,1);
    writer.exec('BEGIN IMMEDIATE');
    try {
      writer.exec("UPDATE sessions SET live=0 WHERE token='token-a'");
      assert.equal(scalar(reader,"SELECT live FROM sessions WHERE token='token-a'").live,1);
    } finally {writer.exec('ROLLBACK');}
    assert.equal(scalar(reader,"SELECT live FROM sessions WHERE token='token-a'").live,1);
  } finally {reader.exec('COMMIT');}
  assert.equal(scalar(reader,"SELECT live FROM sessions WHERE token='token-a'").live,1);
}));

test('WAL: a committed logout becomes visible on the next snapshot only',()=>withWal(({reader,writer})=>{
  reader.exec('BEGIN');
  try {
    assert.equal(scalar(reader,"SELECT live FROM sessions WHERE token='token-a'").live,1);
    writer.exec("UPDATE sessions SET live=0 WHERE token='token-a'");
    assert.equal(scalar(reader,"SELECT live FROM sessions WHERE token='token-a'").live,1);
  } finally {reader.exec('COMMIT');}
  assert.equal(scalar(reader,"SELECT live FROM sessions WHERE token='token-a'").live,0);
}));

test('WAL: membership change and session resolve never mix two commits within a read snapshot',()=>withWal(({reader,writer})=>{
  reader.exec('BEGIN');
  try {
    assert.equal(scalar(reader,"SELECT live FROM sessions WHERE token='token-a'").live,1);
    writer.exec("DELETE FROM memberships WHERE user_id='user-a'");
    assert.deepEqual(scalar(reader,"SELECT side FROM memberships WHERE user_id='user-a'")?.side,'A');
  } finally {reader.exec('COMMIT');}
  assert.equal(scalar(reader,"SELECT side FROM memberships WHERE user_id='user-a'"),undefined);
}));

test('WAL: replay sees match revision and event count from the same version',()=>withWal(({reader,writer})=>{
  reader.exec('BEGIN');
  try {
    assert.equal(scalar(reader,"SELECT revision FROM matches WHERE id='match-1'").revision,0);
    writer.exec('BEGIN IMMEDIATE');
    try {
      writer.exec("UPDATE matches SET revision=1 WHERE id='match-1'");
      writer.exec("INSERT INTO events VALUES('match-1',1,'public-event')");
      writer.exec('COMMIT');
    } catch(error) {writer.exec('ROLLBACK');throw error;}
    assert.equal(scalar(reader,"SELECT count(*) AS n FROM events WHERE match_id='match-1'").n,0);
  } finally {reader.exec('COMMIT');}
  assert.equal(scalar(reader,"SELECT revision FROM matches WHERE id='match-1'").revision,1);
  assert.equal(scalar(reader,"SELECT count(*) AS n FROM events WHERE match_id='match-1'").n,1);
}));

test('WAL: a failed writer transaction never leaves partial match or events changes',()=>withWal(({reader,writer})=>{
  writer.exec('BEGIN IMMEDIATE');
  try {
    writer.exec("UPDATE matches SET revision=1 WHERE id='match-1'");
    writer.exec("INSERT INTO events VALUES('match-1',1,'incomplete')");
    throw Error('simulated event serialization failure');
  } catch(error) {
    assert.match(error.message,/simulated/);
    writer.exec('ROLLBACK');
  }
  assert.equal(scalar(reader,"SELECT revision FROM matches WHERE id='match-1'").revision,0);
  assert.equal(scalar(reader,"SELECT count(*) AS n FROM events WHERE match_id='match-1'").n,0);
  assert.equal(writer.isTransaction,false);
}));

test('WAL: read transaction does not block another connection obtaining BEGIN IMMEDIATE',()=>withWal(({reader,writer})=>{
  reader.exec('BEGIN');
  try {
    assert.equal(scalar(reader,"SELECT revision FROM matches WHERE id='match-1'").revision,0);
    writer.exec('BEGIN IMMEDIATE');
    try {
      writer.exec("UPDATE matches SET revision=1 WHERE id='match-1'");
      writer.exec('COMMIT');
    } catch(error) {writer.exec('ROLLBACK');throw error;}
    assert.equal(scalar(reader,"SELECT revision FROM matches WHERE id='match-1'").revision,0);
  } finally {reader.exec('COMMIT');}
  assert.equal(scalar(reader,"SELECT revision FROM matches WHERE id='match-1'").revision,1);
  assert.equal(reader.isTransaction,false);
}));


test('WAL: a stale read snapshot cannot be upgraded into a writer after another commit',()=>withWal(({reader,writer})=>{
  reader.exec('BEGIN');
  try {
    assert.equal(scalar(reader,"SELECT revision FROM matches WHERE id='match-1'").revision,0);
    writer.exec("UPDATE matches SET revision=1 WHERE id='match-1'");
    assert.throws(()=>reader.exec("UPDATE matches SET revision=2 WHERE id='match-1'"),
      error=>/locked|busy/i.test(error?.message??'')&&
        ['ERR_SQLITE_ERROR','SQLITE_BUSY_SNAPSHOT','SQLITE_BUSY'].includes(error?.code));
  } finally {reader.exec('ROLLBACK');}
  assert.equal(scalar(reader,"SELECT revision FROM matches WHERE id='match-1'").revision,1);
  assert.equal(reader.isTransaction,false);
}));

test('WAL: BEGIN IMMEDIATE prevents a second writer changing session before revalidation',()=>withWal(({reader,writer})=>{
  writer.exec('PRAGMA busy_timeout=1;');
  reader.exec('BEGIN IMMEDIATE');
  try {
    assert.equal(scalar(reader,"SELECT live FROM sessions WHERE token='token-a'").live,1);
    assert.throws(()=>writer.exec("UPDATE sessions SET live=0 WHERE token='token-a'"),
      error=>error?.code==='SQLITE_BUSY'||/locked|busy/i.test(error?.message??''));
    reader.exec("UPDATE matches SET revision=1 WHERE id='match-1'");
  } finally {reader.exec('COMMIT');}
  writer.exec("UPDATE sessions SET live=0 WHERE token='token-a'");
  assert.equal(scalar(reader,"SELECT live FROM sessions WHERE token='token-a'").live,0);
  assert.equal(scalar(reader,"SELECT revision FROM matches WHERE id='match-1'").revision,1);
  assert.equal(reader.isTransaction,false);
}));
