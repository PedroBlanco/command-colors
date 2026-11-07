import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openSqliteComposition} from './sqlite.mjs';
import {inspectSchema, verifyDatabase, CCW_SCHEMA_SQL} from './schema-version.mjs';
import {createVerifiedBackup} from './backup.mjs';

function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ccw-schema-hardening-'));
  const file = join(dir,'lab.sqlite');
  try { return fn(file, dir); }
  finally { rmSync(dir, {recursive:true, force:true}); }
}

// This database has the right names and columns but drops all real constraints.
// Earlier schema inspection incorrectly adopted it as an authorized CCW v1 DB.
test('schema: reject unconstrained lookalike tables; never mark them as CCW', () => withDb(file => {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE accounts(id TEXT,handle TEXT,salt TEXT,password_hash TEXT);
    CREATE TABLE sessions(token_digest TEXT,user_id TEXT,expires_at INTEGER);
    CREATE TABLE matches(id TEXT,owner_id TEXT,guest_id TEXT,lobby_revision INTEGER,game_revision INTEGER,private_state TEXT);
    CREATE TABLE invitations(id TEXT,match_id TEXT,token_digest TEXT,target_handle TEXT,expires_at INTEGER,status TEXT);
    CREATE TABLE game_events(match_id TEXT,sequence INTEGER,visibility TEXT,payload TEXT);
    CREATE TABLE game_commands(match_id TEXT,actor TEXT,idem_key TEXT,signature TEXT,committed_revision INTEGER);
    CREATE INDEX invitations_by_match ON invitations(match_id);`);
  assert.throws(() => inspectSchema(db,{allowLegacy:true}), /DATABASE_STRUCTURE_MISMATCH/);
  db.close();
  assert.throws(() => openSqliteComposition({file}), /DATABASE_STRUCTURE_MISMATCH/);
  const reopened = new DatabaseSync(file);
  try {
    assert.equal(reopened.prepare('PRAGMA user_version').get().user_version,0);
    assert.equal(reopened.prepare('PRAGMA application_id').get().application_id,0);
  } finally {reopened.close();}
}));

test('schema: reject dropped required index before opening or backing up', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccw-schema-index-'));
  const file = join(dir,'lab.sqlite');
  try {
    const app = openSqliteComposition({file});
    app.unsafeTestDatabase().exec('DROP INDEX invitations_by_match');
    assert.throws(() => verifyDatabase(app.unsafeTestDatabase()),/DATABASE_OBJECTS_MISMATCH/);
    await assert.rejects(createVerifiedBackup({sourceDb:app.unsafeTestDatabase(),destination:join(dir,'backup.sqlite')}),/DATABASE_OBJECTS_MISMATCH/);
    app.close();
    assert.throws(() => openSqliteComposition({file}),/DATABASE_OBJECTS_MISMATCH/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('schema: reject unexpected triggers, even when tables match', () => withDb(file => {
  const app = openSqliteComposition({file});
  const db=app.unsafeTestDatabase();
  db.exec('CREATE TRIGGER unexpected AFTER INSERT ON accounts BEGIN SELECT 1; END;');
  assert.throws(() => inspectSchema(db),/DATABASE_OBJECTS_MISMATCH/);
  app.close();
  assert.throws(() => openSqliteComposition({file}),/DATABASE_OBJECTS_MISMATCH/);
}));

test('schema: accept canonical v1 with all constraints and expected index', () => withDb(file => {
  const app = openSqliteComposition({file});
  try {
    const info=verifyDatabase(app.unsafeTestDatabase());
    assert.equal(info.version,1);
    assert.equal(info.status,'current');
  } finally {app.close();}
}));


test('schema: reject changed CHECK literal despite matching names and columns', () => withDb(file => {
  const db = new DatabaseSync(file);
  try {
    db.exec(CCW_SCHEMA_SQL.replace("'PENDING'", "'pending'"));
    assert.throws(() => inspectSchema(db,{allowLegacy:true}), /DATABASE_STRUCTURE_MISMATCH:invitations/);
  } finally {db.close();}
  assert.throws(() => openSqliteComposition({file}), /DATABASE_STRUCTURE_MISMATCH:invitations/);
}));
