/** CCW local SQLite schema contract. Not a production migration framework. */
export const CURRENT_SCHEMA_VERSION = 1;
export const CCW_APPLICATION_ID = 0x43435742; // 'CCWB' (SQLite signed 32-bit application_id)

const TABLE_COLUMNS = Object.freeze({
  accounts: ['id', 'handle', 'salt', 'password_hash'],
  sessions: ['token_digest', 'user_id', 'expires_at'],
  matches: ['id', 'owner_id', 'guest_id', 'lobby_revision', 'game_revision', 'private_state'],
  invitations: ['id', 'match_id', 'token_digest', 'target_handle', 'expires_at', 'status'],
  game_events: ['match_id', 'sequence', 'visibility', 'payload'],
  game_commands: ['match_id', 'actor', 'idem_key', 'signature', 'committed_revision']
});

const pragmaNumber = (db, sql, field) => Number(db.prepare(sql).get()[field]);
const tables = db => db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  .all().map(x => x.name);

/** Check schema without executing migrations or mutating the database. */
export function inspectSchema(db, {allowLegacy = false} = {}) {
  const applicationId = pragmaNumber(db, 'PRAGMA application_id', 'application_id');
  const version = pragmaNumber(db, 'PRAGMA user_version', 'user_version');
  if (applicationId !== 0 && applicationId !== CCW_APPLICATION_ID) throw new Error('DATABASE_APPLICATION_MISMATCH');
  if (version > CURRENT_SCHEMA_VERSION) throw new Error('DATABASE_FUTURE_VERSION');
  if (version < 0 || ![0, CURRENT_SCHEMA_VERSION].includes(version)) throw new Error('DATABASE_VERSION_UNSUPPORTED');
  const existing = tables(db);
  if (existing.length === 0) {
    if (version !== 0 || applicationId !== 0) throw new Error('DATABASE_SCHEMA_MISSING');
    return {status: 'empty', version: 0, applicationId};
  }
  const expected = Object.keys(TABLE_COLUMNS);
  if (existing.length !== expected.length || existing.some(name => !expected.includes(name))) {
    throw new Error('DATABASE_TABLES_MISMATCH');
  }
  for (const [name, fields] of Object.entries(TABLE_COLUMNS)) {
    const info = db.prepare(`PRAGMA table_info(${name})`).all();
    const cols = info.map(x => x.name);
    if (cols.length !== fields.length || cols.some(name => !fields.includes(name))) {
      throw new Error(`DATABASE_COLUMNS_MISMATCH:${name}`);
    }
  }
  if (!allowLegacy && (version !== CURRENT_SCHEMA_VERSION || applicationId !== CCW_APPLICATION_ID)) {
    throw new Error('DATABASE_LEGACY_SCHEMA_UNMARKED');
  }
  return {status: version === 0 || applicationId === 0 ? 'legacy' : 'current', version, applicationId};
}

/**
 * Adopt the exact original six-table v0 lab schema, or initialize a new database.
 * Never migrate unrecognized structures; reject newer versions before CREATE TABLE.
 */
export function initializeSchema(db, createLegacySchema) {
  if (typeof createLegacySchema !== 'function') throw new TypeError('createLegacySchema required');
  const previous = inspectSchema(db, {allowLegacy: true});
  if (previous.status === 'current') return previous;
  // Legacy acceptance is deliberately narrow: exact baseline table names/columns only.
  db.exec('BEGIN IMMEDIATE');
  try {
    if (previous.status === 'empty') createLegacySchema();
    inspectSchema(db, {allowLegacy: true});
    if (db.prepare('PRAGMA foreign_key_check').all().length !== 0) throw new Error('DATABASE_FOREIGN_KEY_ERROR');
    db.exec(`PRAGMA application_id = ${CCW_APPLICATION_ID}; PRAGMA user_version = ${CURRENT_SCHEMA_VERSION};`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return inspectSchema(db);
}

/** Consistency checks for backup or restore, never expose private rows. */
export function verifyDatabase(db) {
  const schema = inspectSchema(db);
  const rows = db.prepare('PRAGMA integrity_check').all();
  if (rows.length !== 1 || rows[0].integrity_check !== 'ok') throw new Error('DATABASE_INTEGRITY_FAILED');
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('DATABASE_FOREIGN_KEY_ERROR');
  return schema;
}
