/**
 * Versioned, private SQLite signature for experimental section-card commands.
 * A v2 signature binds the semantic command to its persisted idempotency key.
 * It is a consistency check, NOT a cryptographic authentication tag.
 */
export const SECTION_COMMAND_SIGNATURE_V2 = 'CCW_SECTION_COMMAND_V2:';
const KEY = /^[A-Za-z0-9_-]{8,80}$/;
const own = (value, name) => Object.prototype.hasOwnProperty.call(value, name);
const record = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const validKey = value => typeof value === 'string' && KEY.test(value);

function check(command, key) {
  if (!record(command) || own(command, 'idempotencyKey') || !validKey(key)) {
    throw new TypeError('SECTION_CCWB_SIGNATURE_INPUT_INVALID');
  }
}

/** Only used for new journal writes; never serialize this signature publicly. */
export function signSectionJournalCommand(command, idempotencyKey) {
  check(command, idempotencyKey);
  return SECTION_COMMAND_SIGNATURE_V2 + JSON.stringify({command, idempotencyKey});
}

/**
 * Validate the existing DB signature against a replayed private command.
 * Old signatures are accepted for compatibility, but are *not* v2 proofs.
 * In a v2 row deleting journalKey cannot silently downgrade the audit.
 */
export function checkSectionJournalSignature({signature, command, journalKey, sqlKey} = {}) {
  if (typeof signature !== 'string' || !record(command) || own(command, 'idempotencyKey') ||
      !validKey(sqlKey) || (journalKey !== null && !validKey(journalKey))) {
    throw new Error('SECTION_CCWB_HISTORY_TAMPERED');
  }
  if (signature.startsWith(SECTION_COMMAND_SIGNATURE_V2)) {
    if (journalKey === null || journalKey !== sqlKey ||
        signature !== signSectionJournalCommand(command, journalKey)) {
      throw new Error('SECTION_CCWB_HISTORY_TAMPERED');
    }
    return 'V2_BOUND';
  }
  if (signature !== JSON.stringify(command) ||
      (journalKey !== null && journalKey !== sqlKey)) {
    throw new Error('SECTION_CCWB_HISTORY_TAMPERED');
  }
  return 'LEGACY_UNBOUND';
}

/** Retries from the earlier laboratory still have an unversioned signature. */
export function matchesSectionJournalRetry(signature, command, idempotencyKey) {
  check(command, idempotencyKey);
  return signature === signSectionJournalCommand(command, idempotencyKey) ||
    signature === JSON.stringify(command);
}
