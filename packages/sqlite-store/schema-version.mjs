/** CCW local SQLite schema contract. Not a production migration framework. */
export const CURRENT_SCHEMA_VERSION = 1;
export const CCW_APPLICATION_ID = 0x43435742; // 'CCWB' (SQLite signed 32-bit application_id)

/** Canonical DDL of the original six-table lab schema. Keep schema and validation together. */
export const CCW_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL, password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_digest TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES accounts(id),
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id),
  guest_id TEXT REFERENCES accounts(id), lobby_revision INTEGER NOT NULL DEFAULT 0,
  game_revision INTEGER NOT NULL DEFAULT 0, private_state TEXT NOT NULL,
  CHECK (guest_id IS NULL OR guest_id <> owner_id)
);
CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY, match_id TEXT NOT NULL REFERENCES matches(id),
  token_digest TEXT NOT NULL UNIQUE, target_handle TEXT NOT NULL,
  expires_at INTEGER NOT NULL, status TEXT NOT NULL
    CHECK (status IN ('PENDING','REVOKED','ACCEPTED','REJECTED','EXPIRED'))
);
CREATE INDEX IF NOT EXISTS invitations_by_match ON invitations(match_id);
CREATE TABLE IF NOT EXISTS game_events (
  match_id TEXT NOT NULL REFERENCES matches(id), sequence INTEGER NOT NULL,
  visibility TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY (match_id, sequence)
);
CREATE TABLE IF NOT EXISTS game_commands (
  match_id TEXT NOT NULL REFERENCES matches(id), actor TEXT NOT NULL,
  idem_key TEXT NOT NULL, signature TEXT NOT NULL,
  committed_revision INTEGER NOT NULL,
  PRIMARY KEY (match_id, actor, idem_key)
);
`;

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
  // Table/column names alone do not establish a compatible schema. A database
  // without PRIMARY KEY, UNIQUE, FOREIGN KEY or CHECK can appear identical to
  // the prototype while silently losing the constraints used by the API.
  // Compare the full versioned DDL, including all explicit indexes; do not
  // accept extra triggers, views or indexes in a v1 database either.
  const actualObjects = db.prepare(`SELECT type,name,sql FROM sqlite_schema
    WHERE type IN ('table','index','trigger','view') AND name NOT LIKE 'sqlite_%'
      AND sql IS NOT NULL`).all();
  const expectedObjects = new Map(CCW_SCHEMA_SQL.split(';').map(part => part.trim())
    .filter(part => /^CREATE\s+(TABLE|INDEX)\s+IF\s+NOT\s+EXISTS/i.test(part))
    .map(sql => {
      const [, type, name] = /^CREATE\s+(TABLE|INDEX)\s+IF\s+NOT\s+EXISTS\s+([a-z_][a-z0-9_]*)/i.exec(sql);
      return [`${type.toLowerCase()}:${name}`, sql];
    }));
  // Strip formatting whitespace, but not whitespace or case inside SQL literals:
  // CHECK(status IN ('PENDING',...)) is case-sensitive in SQLite.
  function normalized(sql) {
    const ddl = sql.replace(/\bIF\s+NOT\s+EXISTS\b/gi, '');
    let output = '', quote = null;
    for (let i = 0; i < ddl.length; i++) {
      const ch = ddl[i];
      if (quote) {
        output += ch;
        if (ch === quote) {
          if (ddl[i + 1] === quote) output += ddl[++i];
          else quote = null;
        }
      } else if (ch === "'" || ch === '"') {
        quote = ch;
        output += ch;
      } else if (!/\s/.test(ch)) output += ch;
    }
    return output;
  }
  if (actualObjects.length !== expectedObjects.size) throw new Error('DATABASE_OBJECTS_MISMATCH');
  for (const object of actualObjects) {
    const expected = expectedObjects.get(`${object.type}:${object.name}`);
    if (!expected || normalized(object.sql) !== normalized(expected)) {
      throw new Error(`DATABASE_STRUCTURE_MISMATCH:${object.name}`);
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
