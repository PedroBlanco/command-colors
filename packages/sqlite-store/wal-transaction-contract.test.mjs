/**
 * Native Node 22 SQLite/WAL contract used by the CCWB experimental section lab.
 * Deliberately independent of the full repository and any player credentials.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function fixture(work) {
  const directory=mkdtempSync(join(tmpdir(),'ccw-wal-contract-'));
  const file=join(directory,'fixture.sqlite');
  const connections=[];
  const connect=()=>{
    const db=new DatabaseSync(file);
    db.exec('PRAGMA busy_timeout=50; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
    connections.push(db);
    return db;
  };
  try {
    const a=connect();
    a.exec("CREATE TABLE sessions(token TEXT PRIMARY KEY, valid INTEGER NOT NULL); INSERT INTO sessions VALUES ('valid', 1);");
    return work({a,connect});
  } finally {
    for(const db of connections.reverse())try{db.close();}catch{}
    rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:30});
  }
}

test('CCWB WAL: readonly BEGIN can read while a second connection holds BEGIN IMMEDIATE',()=>fixture(({a,connect})=>{
  const writer=connect();
  writer.exec('BEGIN IMMEDIATE');
  try {
    a.exec('BEGIN');
    assert.equal(a.isTransaction,true);
    assert.equal(a.prepare('SELECT valid FROM sessions WHERE token=?').get('valid').valid,1);
    a.exec('COMMIT');
    assert.equal(a.isTransaction,false);
  } finally {writer.exec('ROLLBACK');}
}));

test('CCWB WAL: first read fixes snapshot even when another connection commits',()=>fixture(({a,connect})=>{
  const other=connect();
  a.exec('BEGIN');
  assert.equal(a.prepare('SELECT valid FROM sessions WHERE token=?').get('valid').valid,1);
  other.exec("UPDATE sessions SET valid=0 WHERE token='valid'");
  assert.equal(a.prepare('SELECT valid FROM sessions WHERE token=?').get('valid').valid,1);
  a.exec('COMMIT');
  assert.equal(a.prepare('SELECT valid FROM sessions WHERE token=?').get('valid').valid,0);
}));

test('CCWB WAL: BEGIN IMMEDIATE holds writer lock against concurrent revocation',()=>fixture(({a,connect})=>{
  const other=connect();
  a.exec('BEGIN IMMEDIATE');
  assert.equal(a.isTransaction,true);
  assert.equal(a.prepare('SELECT valid FROM sessions WHERE token=?').get('valid').valid,1);
  assert.throws(()=>other.prepare('DELETE FROM sessions WHERE token=?').run('valid'), /SQLITE_BUSY|database is locked/i);
  assert.equal(a.prepare('SELECT valid FROM sessions WHERE token=?').get('valid').valid,1);
  a.exec('COMMIT');
  assert.equal(a.isTransaction,false);
  assert.equal(other.prepare('DELETE FROM sessions WHERE token=?').run('valid').changes,1);
}));

test('CCWB WAL: rollback after rejected read releases its transaction',()=>fixture(({a,connect})=>{
  const writer=connect();
  a.exec('BEGIN');
  assert.equal(a.prepare('SELECT valid FROM sessions WHERE token=?').get('valid').valid,1);
  a.exec('ROLLBACK');
  assert.equal(a.isTransaction,false);
  assert.equal(writer.prepare('UPDATE sessions SET valid=0 WHERE token=?').run('valid').changes,1);
  assert.equal(a.prepare('SELECT valid FROM sessions WHERE token=?').get('valid').valid,0);
}));

test('CCWB WAL: a read without prior SELECT captures the first committed state',()=>fixture(({a,connect})=>{
  const other=connect();
  a.exec('BEGIN');
  other.exec("UPDATE sessions SET valid=0 WHERE token='valid'");
  assert.equal(a.prepare('SELECT valid FROM sessions WHERE token=?').get('valid').valid,0);
  a.exec('COMMIT');
}));
