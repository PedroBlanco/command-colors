import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp, readdir, readFile, writeFile, rm, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {CCW_APPLICATION_ID, CURRENT_SCHEMA_VERSION, initializeSchema, inspectSchema, verifyDatabase} from './schema-version.mjs';
import {createVerifiedBackup, restoreVerifiedBackup, verifyBackup} from './backup.mjs';

const LEGACY_SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,handle TEXT NOT NULL UNIQUE,salt TEXT NOT NULL,password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_digest TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id),expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS matches(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES accounts(id),guest_id TEXT REFERENCES accounts(id),lobby_revision INTEGER NOT NULL DEFAULT 0,game_revision INTEGER NOT NULL DEFAULT 0,private_state TEXT NOT NULL,CHECK(guest_id IS NULL OR guest_id <> owner_id));
CREATE TABLE IF NOT EXISTS invitations(id TEXT PRIMARY KEY,match_id TEXT NOT NULL REFERENCES matches(id),token_digest TEXT NOT NULL UNIQUE,target_handle TEXT NOT NULL,expires_at INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN ('PENDING','REVOKED','ACCEPTED','REJECTED','EXPIRED')));
CREATE INDEX IF NOT EXISTS invitations_by_match ON invitations(match_id);
CREATE TABLE IF NOT EXISTS game_events(match_id TEXT NOT NULL REFERENCES matches(id),sequence INTEGER NOT NULL,visibility TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(match_id,sequence));
CREATE TABLE IF NOT EXISTS game_commands(match_id TEXT NOT NULL REFERENCES matches(id),actor TEXT NOT NULL,idem_key TEXT NOT NULL,signature TEXT NOT NULL,committed_revision INTEGER NOT NULL,PRIMARY KEY(match_id,actor,idem_key));
`;
async function withTemp(fn) {
  const dir=await mkdtemp(join(tmpdir(),'ccw-lifecycle-'));
  // SQLite WAL sidecars may remain briefly locked on native Windows after close().
  // Retry only the deletion of this unique test directory; never suppress errors.
  try {return await fn(dir);} finally {
    await rm(dir,{recursive:true,force:true,maxRetries:12,retryDelay:100});
  }
}
function newDB(path) {
 const db=new DatabaseSync(path);
 db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
 return db;
}
function init(db) {return initializeSchema(db,()=>db.exec(LEGACY_SCHEMA));}
function seed(db) {
 db.prepare('INSERT INTO accounts(id,handle,salt,password_hash) VALUES (?,?,?,?)')
  .run('u1','alice','salt','synthetic-hash');
 db.prepare('INSERT INTO sessions(token_digest,user_id,expires_at) VALUES (?,?,?)')
  .run('secret-token-digest','u1',9999999999);
 db.prepare('INSERT INTO matches(id,owner_id,game_revision,private_state) VALUES (?,?,?,?)')
  .run('match1','u1',1,JSON.stringify({matchId:'match1',deck:['SECRET_FUTURE'],hands:{A:['SECRET_A'],B:['SECRET_B']}}));
 db.prepare('INSERT INTO game_events(match_id,sequence,visibility,payload) VALUES(?,?,?,?)')
  .run('match1',1,'public','{"type":"demo"}');
 db.prepare('INSERT INTO game_commands(match_id,actor,idem_key,signature,committed_revision) VALUES(?,?,?,?,?)')
  .run('match1','A','request-123','type:0',1);
}

test('schema: new database marked v1; reopening does not migrate or lose rows',()=>withTemp(async dir=>{
 const path=join(dir,'game.sqlite'),db=newDB(path);
 assert.equal(init(db).status,'current');
 assert.equal(db.prepare('PRAGMA user_version').get().user_version,CURRENT_SCHEMA_VERSION);
 assert.equal(db.prepare('PRAGMA application_id').get().application_id,CCW_APPLICATION_ID);
 seed(db);db.close();
 const reopened=newDB(path);
 assert.equal(init(reopened).status,'current');
 assert.equal(reopened.prepare('SELECT count(*) AS n FROM matches').get().n,1);
 reopened.close();
}));

test('schema: exact unversioned legacy DB adopted without changing existing records',()=>withTemp(async dir=>{
 const path=join(dir,'legacy.sqlite'),db=newDB(path);
 db.exec(LEGACY_SCHEMA);seed(db);
 assert.equal(inspectSchema(db,{allowLegacy:true}).status,'legacy');
 assert.equal(init(db).version,1);
 assert.equal(db.prepare('SELECT private_state AS s FROM matches').get().s.includes('SECRET_FUTURE'),true);
 db.close();
}));

test('schema: unknown newer version rejected without altering metadata',()=>withTemp(async dir=>{
 const db=newDB(join(dir,'future.sqlite'));
 db.exec(LEGACY_SCHEMA);db.exec('PRAGMA user_version=99');
 assert.throws(()=>init(db),/DATABASE_FUTURE_VERSION/);
 assert.equal(db.prepare('PRAGMA user_version').get().user_version,99);
 db.close();
}));

test('schema: foreign app, unrelated tables and missing columns rejected',()=>withTemp(async dir=>{
 const a=newDB(join(dir,'foreign.sqlite'));
 a.exec('PRAGMA application_id=123456;');
 assert.throws(()=>init(a),/DATABASE_APPLICATION_MISMATCH/);a.close();
 const b=newDB(join(dir,'other.sqlite'));
 b.exec('CREATE TABLE unrelated(id TEXT)');
 assert.throws(()=>init(b),/DATABASE_TABLES_MISMATCH/);b.close();
 const c=newDB(join(dir,'partial.sqlite'));
 c.exec(LEGACY_SCHEMA);c.exec('ALTER TABLE accounts ADD COLUMN surprise TEXT');
 assert.throws(()=>init(c),/DATABASE_COLUMNS_MISMATCH/);c.close();
}));

test('backup: WAL database copied consistently and verified with manifest hash',()=>withTemp(async dir=>{
 const db=newDB(join(dir,'live.sqlite'));init(db);seed(db);
 const source=join(dir,'safe-copy.sqlite');
 const done=await createVerifiedBackup({sourceDb:db,destination:source});
 assert.equal(done.destination,source);
 assert.equal(done.sha256.length,64);
 assert.equal((await verifyBackup({backupPath:source})).schemaVersion,1);
 const view=new DatabaseSync(source,{readOnly:true});
 assert.equal(view.prepare('SELECT game_revision AS n FROM matches').get().n,1);
 assert.equal(view.prepare('SELECT count(*) AS n FROM sessions').get().n,1);
 assert.equal(view.prepare('PRAGMA journal_mode').get().journal_mode,'delete');
 view.close();
 const leftover=await readdir(dir);
 assert.equal(leftover.some(n=>n.startsWith('safe-copy.sqlite') && (n.endsWith('-wal') || n.endsWith('-shm') || n.includes('.partial'))),false);
 db.close();
}));

test('backup: existing backup or sidecar never overwritten',()=>withTemp(async dir=>{
 const db=newDB(join(dir,'live.sqlite'));init(db);
 const to=join(dir,'backup.sqlite');
 await createVerifiedBackup({sourceDb:db,destination:to});
 const before=await readFile(to);
 await assert.rejects(createVerifiedBackup({sourceDb:db,destination:to}),/DESTINATION_EXISTS/);
 assert.deepEqual(await readFile(to),before);db.close();
}));

test('verify: tampering is detected by checksum before database access',()=>withTemp(async dir=>{
 const db=newDB(join(dir,'live.sqlite'));init(db);
 const to=join(dir,'backup.sqlite');await createVerifiedBackup({sourceDb:db,destination:to});db.close();
 const bytes=await readFile(to);bytes[bytes.length-1]^=1;
 await writeFile(to,bytes);
 await assert.rejects(verifyBackup({backupPath:to}),/BACKUP_CHECKSUM_MISMATCH/);
}));

test('restore: a new destination opens in a brand-new Node.js process',()=>withTemp(async dir=>{
 const db=newDB(join(dir,'live.sqlite'));init(db);seed(db);
 const to=join(dir,'backup.sqlite');await createVerifiedBackup({sourceDb:db,destination:to});db.close();
 const restored=join(dir,'restored.sqlite');
 assert.equal((await restoreVerifiedBackup({backupPath:to,destination:restored})).restored,true);
 const moduleUrl=new URL('./schema-version.mjs',import.meta.url).href;
 const snippet=`import {DatabaseSync} from 'node:sqlite';import {verifyDatabase} from ${JSON.stringify(moduleUrl)};
  const db=new DatabaseSync(process.argv[1],{readOnly:true});verifyDatabase(db);
  console.log(JSON.stringify({accounts:db.prepare('SELECT count(*) AS n FROM accounts').get().n,
    sessions:db.prepare('SELECT count(*) AS n FROM sessions').get().n,
    turns:db.prepare('SELECT game_revision AS n FROM matches').get().n}));db.close();`;
 const p=spawnSync(process.execPath,['--input-type=module','-e',snippet,restored],{encoding:'utf8',timeout:15000});
 assert.equal(p.status,0,p.stderr);
 assert.deepEqual(JSON.parse(p.stdout.trim()),{accounts:1,sessions:1,turns:1});
}));

test('restore: existing destination cannot be overwritten',()=>withTemp(async dir=>{
 const db=newDB(join(dir,'live.sqlite'));init(db);
 const to=join(dir,'backup.sqlite');await createVerifiedBackup({sourceDb:db,destination:to});db.close();
 const target=join(dir,'target.sqlite');await writeFile(target,'DO-NOT-OVERWRITE');
 await assert.rejects(restoreVerifiedBackup({backupPath:to,destination:target}),/DESTINATION_EXISTS/);
 assert.equal(await readFile(target,'utf8'),'DO-NOT-OVERWRITE');
}));

test('backup: invalid foreign-key reference blocks backup before publishing it',()=>withTemp(async dir=>{
 const db=newDB(join(dir,'live.sqlite'));init(db);
 db.exec('PRAGMA foreign_keys=OFF');
 db.prepare('INSERT INTO sessions(token_digest,user_id,expires_at) VALUES(?,?,?)').run('bad-token','missing-account',999);
 const to=join(dir,'backup.sqlite');
 await assert.rejects(createVerifiedBackup({sourceDb:db,destination:to}),/DATABASE_FOREIGN_KEY_ERROR/);
 await assert.rejects(stat(to),{code:'ENOENT'});
 db.close();
}));

test('CLI: backup, verify, restore end-to-end without overwriting data',()=>withTemp(async dir=>{
 const live=join(dir,'live.sqlite'),db=newDB(live);init(db);seed(db);db.close();
 const tool=new URL('../../scripts/sqlite-maintenance.mjs',import.meta.url);
 const invoke=(...args)=>spawnSync(process.execPath,[fileURLToPath(tool),...args],{encoding:'utf8',timeout:15000});
 const dest=join(dir,'backup.sqlite'),target=join(dir,'restored.sqlite');
 const b=invoke('backup',live,dest);assert.equal(b.status,0,b.stderr);
 assert.equal(JSON.parse(b.stdout).operation,'backup');
 const v=invoke('verify',dest);assert.equal(v.status,0,v.stderr);
 assert.equal(JSON.parse(v.stdout).valid,true);
 const r=invoke('restore',dest,target);assert.equal(r.status,0,r.stderr);
 assert.equal(JSON.parse(r.stdout).restored,true);
 const output=new DatabaseSync(target,{readOnly:true});
 assert.equal(output.prepare('SELECT count(*) AS n FROM matches').get().n,1);output.close();
 assert.notEqual(invoke('restore',dest,target).status,0);
}));

test('CLI: nonexistent source must fail without creating an empty database',()=>withTemp(async dir=>{
 const source=join(dir,'not-exist.sqlite'),target=join(dir,'backup.sqlite');
 const tool=new URL('../../scripts/sqlite-maintenance.mjs',import.meta.url);
 const p=spawnSync(process.execPath,[fileURLToPath(tool),'backup',source,target],{encoding:'utf8',timeout:15000});
 assert.notEqual(p.status,0);
 await assert.rejects(stat(source),{code:'ENOENT'});
 await assert.rejects(stat(target),{code:'ENOENT'});
}));
