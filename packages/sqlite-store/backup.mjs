/** SQLite laboratory backup/restore with integrity checks. Not an off-site backup system. */
import {DatabaseSync, backup as sqliteBackup} from 'node:sqlite';
import {createHash, randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {chmod, copyFile, link, lstat, mkdir, open, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {CCW_APPLICATION_ID, CURRENT_SCHEMA_VERSION, verifyDatabase} from './schema-version.mjs';

export const BACKUP_MANIFEST_FORMAT = 'ccw-sqlite-lab-backup-v1';
const manifestPath = path => `${path}.manifest.json`;

async function hashFile(path) {
  const sha = createHash('sha256');
  for await (const chunk of createReadStream(path)) sha.update(chunk);
  return sha.digest('hex');
}

async function regularFile(path) {
  const info = await lstat(path);
  if (!info.isFile()) throw new Error('BACKUP_NOT_REGULAR_FILE');
  return info;
}

async function mustNotExist(path) {
  try { await lstat(path); throw new Error('DESTINATION_EXISTS'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function inspectFile(path) {
  const db = new DatabaseSync(path, {readOnly: true});
  try { return verifyDatabase(db); }
  finally {db.close();}
}

/**
 * A SQLite backup may retain the source's WAL journal-mode flag. Turn the
 * completed COPY ONLY into a standalone DELETE-journal database so that
 * verifying/restoring it does not create -wal/-shm sidecars containing data.
 * The live source remains in WAL mode.
 */
function finalizeSnapshotJournal(path) {
  const copy = new DatabaseSync(path);
  try {
    copy.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    const mode = copy.prepare('PRAGMA journal_mode=DELETE').get().journal_mode;
    if (mode !== 'delete') throw new Error('BACKUP_JOURNAL_FINALIZATION_FAILED');
  } finally { copy.close(); }
}

async function fsyncFile(path) {
  const f = await open(path, 'r');
  try {await f.sync();}
  finally {await f.close();}
}

/** Copy a live SQLite DB using SQLite's backup API (WAL-safe). Never overwrite. */
export async function createVerifiedBackup({sourceDb, destination} = {}) {
  if (!sourceDb || typeof destination !== 'string' || !destination.trim()) throw new TypeError('INVALID_BACKUP_ARGUMENTS');
  const dest = resolve(destination);
  const sidecar = manifestPath(dest);
  await mkdir(dirname(dest), {recursive: true});
  await mustNotExist(dest);
  await mustNotExist(sidecar);
  verifyDatabase(sourceDb);
  const tmp = `${dest}.${randomUUID()}.partial`;
  const tmpManifest = `${sidecar}.${randomUUID()}.partial`;
  let sidecarLinked = false;
  try {
    await sqliteBackup(sourceDb, tmp);
    finalizeSnapshotJournal(tmp);
    await chmod(tmp, 0o600); // POSIX only; Windows requires filesystem ACLs
    await fsyncFile(tmp);
    const schema = inspectFile(tmp);
    const info = await regularFile(tmp);
    const manifest = {
      format: BACKUP_MANIFEST_FORMAT,
      schemaVersion: schema.version,
      applicationId: CCW_APPLICATION_ID,
      sizeBytes: info.size,
      sha256: await hashFile(tmp),
      createdAt: new Date().toISOString()
    };
    await writeFile(tmpManifest, JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    await fsyncFile(tmpManifest);
    await mustNotExist(sidecar);
    await mustNotExist(dest);
    await link(tmpManifest, sidecar); // manifest alone means incomplete backup
    sidecarLinked = true;
    await link(tmp, dest); // backup is published last, without replacing anything
    return {destination: dest, manifestPath: sidecar, sha256: manifest.sha256, sizeBytes: info.size};
  } catch (error) {
    if (sidecarLinked) await rm(sidecar, {force: true}).catch(() => {});
    throw error;
  } finally {
    await rm(tmp, {force: true}).catch(() => {});
    await rm(`${tmp}-wal`, {force: true}).catch(() => {});
    await rm(`${tmp}-shm`, {force: true}).catch(() => {});
    await rm(tmpManifest, {force: true}).catch(() => {});
  }
}

/** Verify bytes against a sidecar and then check SQLite schema and constraints. */
export async function verifyBackup({backupPath} = {}) {
  if (typeof backupPath !== 'string' || !backupPath.trim()) throw new TypeError('BACKUP_PATH_REQUIRED');
  const path = resolve(backupPath);
  const info = await regularFile(path);
  const manifest = JSON.parse(await readFile(manifestPath(path), 'utf8'));
  if (manifest.format !== BACKUP_MANIFEST_FORMAT || manifest.schemaVersion !== CURRENT_SCHEMA_VERSION
      || manifest.applicationId !== CCW_APPLICATION_ID || manifest.sizeBytes !== info.size
      || typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.sha256)) {
    throw new Error('BACKUP_MANIFEST_INVALID');
  }
  const actual = await hashFile(path);
  if (actual !== manifest.sha256) throw new Error('BACKUP_CHECKSUM_MISMATCH');
  inspectFile(path);
  return {valid: true, sha256: actual, sizeBytes: info.size, schemaVersion: manifest.schemaVersion};
}

/** Restore ONLY to a missing destination. Requires maintenance downtime. */
export async function restoreVerifiedBackup({backupPath, destination} = {}) {
  if (typeof destination !== 'string' || !destination.trim()) throw new TypeError('DESTINATION_REQUIRED');
  const target = resolve(destination);
  const source = resolve(backupPath ?? '');
  if (source === target) throw new Error('RESTORE_SOURCE_EQUALS_DESTINATION');
  await verifyBackup({backupPath: source});
  await mkdir(dirname(target), {recursive: true});
  await mustNotExist(target);
  // Refuse to restore into an existing WAL database or a partially removed one.
  await mustNotExist(`${target}-wal`);
  await mustNotExist(`${target}-shm`);
  const tmp = `${target}.${randomUUID()}.restore-partial`;
  try {
    await copyFile(source, tmp);
    await chmod(tmp, 0o600);
    await fsyncFile(tmp);
    const schema = inspectFile(tmp);
    if (schema.version !== CURRENT_SCHEMA_VERSION) throw new Error('DATABASE_VERSION_UNSUPPORTED');
    if (await hashFile(tmp) !== (await verifyBackup({backupPath: source})).sha256) {
      throw new Error('RESTORED_COPY_CHECKSUM_MISMATCH');
    }
    await link(tmp, target); // link fails if a destination appeared during restore
    return {restored: true, destination: target};
  } finally {
    await rm(tmp, {force: true}).catch(() => {});
    await rm(`${tmp}-wal`, {force: true}).catch(() => {});
    await rm(`${tmp}-shm`, {force: true}).catch(() => {});
  }
}
