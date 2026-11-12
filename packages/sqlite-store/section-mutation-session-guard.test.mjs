import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {makeSectionMutationSessionGuard as guard} from './section-mutation-session-guard.mjs';

function fixture(work) {
  const dir=mkdtempSync(join(tmpdir(),'ccw-guard-'));
  const filename=join(dir,'match.sqlite');
  const db=new DatabaseSync(filename),connections=[db];
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=50;');
    db.exec("CREATE TABLE sessions(token TEXT PRIMARY KEY, actor TEXT NOT NULL); INSERT INTO sessions VALUES('live','A');");
    const resolveActor=token=>{
      const member=db.prepare('SELECT actor FROM sessions WHERE token=?').get(token);
      return member ? {actor:member.actor} : {error:{status:401,code:'UNAUTHENTICATED'}};
    };
    const openSecond=()=>{
      const other=new DatabaseSync(filename); connections.push(other);
      other.exec('PRAGMA busy_timeout=50; PRAGMA journal_mode=WAL;');
      return other;
    };
    return work({db,resolveActor,openSecond});
  }finally {
    for (const conn of connections.reverse()) {
      try { if(conn.isTransaction)conn.exec('ROLLBACK');conn.close(); } catch {}
    }
    rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:50});
  }
}

test('guard requires session resolver and real SQLite transaction dependency',()=>{
  assert.throws(()=>guard(),/INVALID_SECTION_LAB_AUTH_GUARD/);
  assert.throws(()=>guard({db:{isTransaction:false},resolveActor:()=>{},sessionToken:'x',expectedActor:'C'}),
    /INVALID_SECTION_LAB_AUTH_GUARD/);
});

test('guard fails closed outside a transaction without consulting identity',()=>fixture(({db})=>{
  let called=0;
  const authorize=guard({db,sessionToken:'live',expectedActor:'A',resolveActor:()=>{called++;return {actor:'A'};}});
  assert.throws(authorize,/SECTION_LAB_AUTH_REQUIRES_TRANSACTION/);
  assert.equal(called,0);
}));

test('guard checks live identity inside BEGIN IMMEDIATE and accepts matching actor',()=>fixture(({db,resolveActor})=>{
  const authorize=guard({db,resolveActor,sessionToken:'live',expectedActor:'A'});
  db.exec('BEGIN IMMEDIATE');
  assert.equal(db.isTransaction,true);
  assert.equal(authorize(),true);
  db.exec('COMMIT');
}));

test('guard rejects revoked token between precheck and write lock',()=>fixture(({db,resolveActor,openSecond})=>{
  const authorize=guard({db,resolveActor,sessionToken:'live',expectedActor:'A'});
  assert.deepEqual(resolveActor('live'),{actor:'A'});
  const other=openSecond();
  other.prepare('DELETE FROM sessions WHERE token=?').run('live');
  db.exec('BEGIN IMMEDIATE');
  assert.deepEqual(authorize(),{status:401,code:'UNAUTHENTICATED'});
  db.exec('ROLLBACK');
}));

test('guard rejects side reassignment after precheck',()=>fixture(({db,resolveActor,openSecond})=>{
  const authorize=guard({db,resolveActor,sessionToken:'live',expectedActor:'A'});
  assert.deepEqual(resolveActor('live'),{actor:'A'});
  openSecond().prepare('UPDATE sessions SET actor=? WHERE token=?').run('B','live');
  db.exec('BEGIN IMMEDIATE');
  assert.deepEqual(authorize(),{status:404,code:'NOT_FOUND'});
  db.exec('ROLLBACK');
}));

test('a concurrent connection cannot revoke while the guarded writer owns the lock',()=>fixture(({db,resolveActor,openSecond})=>{
  const authorize=guard({db,resolveActor,sessionToken:'live',expectedActor:'A'});
  const other=openSecond();
  db.exec('BEGIN IMMEDIATE');
  assert.equal(authorize(),true);
  assert.throws(()=>other.prepare('DELETE FROM sessions WHERE token=?').run('live'),/SQLITE_BUSY|database is locked/i);
  assert.equal(authorize(),true);
  db.exec('COMMIT');
  assert.equal(other.prepare('DELETE FROM sessions WHERE token=?').run('live').changes,1);
}));

test('guard preserves consistent authentication errors from session resolver',()=>fixture(({db})=>{
  const authorize=guard({db,sessionToken:'expired',expectedActor:'B',resolveActor:()=>({error:{status:401,code:'UNAUTHENTICATED'}})});
  db.exec('BEGIN IMMEDIATE');
  assert.deepEqual(authorize(),{status:401,code:'UNAUTHENTICATED'});
  db.exec('ROLLBACK');
}));

test('missing resolver record fails closed rather than passing an unknown actor',()=>fixture(({db})=>{
  const authorize=guard({db,sessionToken:'live',expectedActor:'A',resolveActor:()=>null});
  db.exec('BEGIN IMMEDIATE');
  assert.deepEqual(authorize(),{status:401,code:'UNAUTHENTICATED'});
  db.exec('ROLLBACK');
}));
