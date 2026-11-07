/** Local-only maintenance CLI. No server, no player data; requires Node 22.16+ node:sqlite. */
import {DatabaseSync} from 'node:sqlite';
import {lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createVerifiedBackup, restoreVerifiedBackup, verifyBackup} from '../packages/sqlite-store/backup.mjs';

async function requireFile(path) {
  const info = await lstat(path);
  if (!info.isFile()) throw new Error('SOURCE_NOT_REGULAR_FILE');
}

export async function main(args) {
  const [command, ...rest] = args;
  if (command === 'backup' && rest.length === 2) {
    const [from, to] = rest.map(path => resolve(path));
    if (from === to) throw new Error('BACKUP_SOURCE_EQUALS_DESTINATION');
    await requireFile(from); // opening a non-existent SQLite file must never create an empty DB
    const db = new DatabaseSync(from, {readOnly: true});
    try {
      const result = await createVerifiedBackup({sourceDb: db, destination: to});
      return {operation: 'backup', ...result};
    } finally {db.close();}
  }
  if (command === 'verify' && rest.length === 1) {
    return {operation: 'verify', ...await verifyBackup({backupPath: resolve(rest[0])})};
  }
  if (command === 'restore' && rest.length === 2) {
    const result = await restoreVerifiedBackup({backupPath: resolve(rest[0]), destination: resolve(rest[1])});
    return {operation: 'restore', ...result};
  }
  throw new Error('USAGE: node scripts/sqlite-maintenance.mjs backup <source.sqlite> <new-backup.sqlite> | verify <backup.sqlite> | restore <backup.sqlite> <new-destination.sqlite>');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2))
    .then(result => {console.log(JSON.stringify(result, null, 2));})
    .catch(error => {console.error(error.message); process.exitCode = 1;});
}
