/**
 * CCWB SQLite/WAL process-isolation contract.
 * Independent native exercise for the TOCTOU window addressed by PR #88.
 * Does not depend on game rules or browser code.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

// Separate Node process. The guard is intentionally after BEGIN IMMEDIATE.
const WORKER = `
import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync(process.argv[1]);
db.exec('PRAGMA busy_timeout=4000; PRAGMA journal_mode=WAL;');
process.send({kind:'ready'});
process.on('message', message=>{
  if(message!=='start')return;
  process.send({kind:'attempt'});
  try {
    db.exec('BEGIN IMMEDIATE');
    const row=db.prepare('SELECT valid FROM sessions WHERE token=?').get('live');
    if(row?.valid===1){
      db.prepare('INSERT INTO writes (value) VALUES (?)').run('accepted');
      db.exec('COMMIT');
      process.send({kind:'result',accepted:true});
    } else {
      db.exec('ROLLBACK');
      process.send({kind:'result',accepted:false});
    }
  }catch(error){
    if(db.isTransaction)db.exec('ROLLBACK');
    process.send({kind:'error',message:String(error)});
  }finally{db.close();process.disconnect();}
});
`;

function worker(file,source=WORKER){
  const child=spawn(process.execPath,['--input-type=module','-e',source,file],
    {stdio:['ignore','ignore','pipe','ipc']});
  let stderr='';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data',s=>{stderr+=s;});
  const queue=[];let waiting=null;
  child.on('message',value=>{
    if(waiting){const resolve=waiting;waiting=null;resolve(value);}else queue.push(value);
  });
  const next=async()=>{
    if(queue.length)return queue.shift();
    return await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{waiting=null;reject(new Error('worker timeout: '+stderr));},4000);
      waiting=value=>{clearTimeout(timeout);resolve(value);};
    });
  };
  return {child,next,stderr:()=>stderr};
}

test('CCWB: a revoked session cannot authorize a queued writer in another Node process',
  {timeout:10000},async()=>{
    const dir=mkdtempSync(join(tmpdir(),'ccw-two-process-'));
    const file=join(dir,'lab.sqlite');
    const a=new DatabaseSync(file);
    let task;
    try{
      a.exec('PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL;');
      a.exec("CREATE TABLE sessions(token TEXT PRIMARY KEY,valid INTEGER NOT NULL); CREATE TABLE writes(value TEXT NOT NULL); INSERT INTO sessions VALUES('live',1);");
      // Process A commits a revocation while holding the writer lock.
      a.exec('BEGIN IMMEDIATE');
      a.prepare('UPDATE sessions SET valid=0 WHERE token=?').run('live');
      task=worker(file);
      assert.deepEqual(await task.next(),{kind:'ready'});
      task.child.send('start');
      assert.deepEqual(await task.next(),{kind:'attempt'});
      await delay(80);
      // Process B cannot acquire the lock while A is active.
      assert.equal(a.prepare('SELECT COUNT(*) n FROM writes').get().n,0);
      a.exec('COMMIT');
      assert.deepEqual(await task.next(),{kind:'result',accepted:false});
      assert.equal(a.prepare('SELECT COUNT(*) n FROM writes').get().n,0);
      assert.equal(a.prepare('SELECT valid FROM sessions WHERE token=?').get('live').valid,0);
    }finally{
      if(a.isTransaction)a.exec('ROLLBACK');
      a.close();
      if(task && task.child.exitCode===null)task.child.kill();
      rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
    }
  });

// Inverse ordering: an already-authorized command holds the writer lock,
// so logout must not silently revoke it *within* that committed transaction.
const LOCK_FIRST_WORKER = `
import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync(process.argv[1]);
db.exec('PRAGMA busy_timeout=2000; PRAGMA journal_mode=WAL;');
db.exec('BEGIN IMMEDIATE');
const current=db.prepare('SELECT valid FROM sessions WHERE token=?').get('live');
process.send({kind:'locked',authorized:current?.valid===1});
process.on('message',message=>{
  if(message!=='finish')return;
  try {
    if(current?.valid===1){
      db.prepare('INSERT INTO writes(value) VALUES (?)').run('before-logout');
      db.exec('COMMIT');
      process.send({kind:'result',accepted:true});
    }else{
      db.exec('ROLLBACK');
      process.send({kind:'result',accepted:false});
    }
  }catch(e){if(db.isTransaction)db.exec('ROLLBACK');process.send({kind:'error',message:String(e)});}
  finally {db.close();process.disconnect();}
});
`;

test('CCWB: logout waits for an already-authorized writer in another process',
  {timeout:10000},async()=>{
    const dir=mkdtempSync(join(tmpdir(),'ccw-lock-first-'));
    const file=join(dir,'lab.sqlite');
    const a=new DatabaseSync(file);
    let task;
    try{
      a.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=50;');
      a.exec("CREATE TABLE sessions(token TEXT PRIMARY KEY,valid INTEGER NOT NULL); CREATE TABLE writes(value TEXT NOT NULL); INSERT INTO sessions VALUES('live',1);");
      task=worker(file,LOCK_FIRST_WORKER);
      assert.deepEqual(await task.next(),{kind:'locked',authorized:true});
      assert.throws(()=>a.prepare('UPDATE sessions SET valid=0 WHERE token=?').run('live'),
        /SQLITE_BUSY|database is locked/i);
      task.child.send('finish');
      assert.deepEqual(await task.next(),{kind:'result',accepted:true});
      assert.equal(a.prepare('SELECT COUNT(*) n FROM writes').get().n,1);
      assert.equal(a.prepare('UPDATE sessions SET valid=0 WHERE token=?').run('live').changes,1);
      assert.equal(a.prepare('SELECT valid FROM sessions WHERE token=?').get('live').valid,0);
    }finally{
      a.close();
      if(task && task.child.exitCode===null)task.child.kill();
      rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
    }
  });
