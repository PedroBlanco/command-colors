/**
 * Experimental CCWB section-history idempotency metadata.
 * Keys remain private; never serialize journal entries to public events.
 * Legacy records may lack a key because earlier laboratory versions did not
 * store it in the private journal. Such records have weaker audit coverage.
 */
const KEY = /^[A-Za-z0-9_-]{8,80}$/;
const plain = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const validKey = value => typeof value === 'string' && KEY.test(value);

export function bindLabJournalIdempotency(command, idempotencyKey) {
  if (!plain(command) || Object.hasOwn(command, 'idempotencyKey') ||
      !validKey(idempotencyKey)) throw new TypeError('SECTION_CCWB_IDEMPOTENCY_BINDING_INVALID');
  return Object.freeze({...structuredClone(command), idempotencyKey});
}

export function readLabJournalIdempotency(entry) {
  if (!plain(entry)) throw new TypeError('SECTION_CCWB_IDEMPOTENCY_BINDING_INVALID');
  if (!Object.hasOwn(entry, 'idempotencyKey')) {
    return {command:entry, idempotencyKey:null, legacyUnverified:true};
  }
  if (!validKey(entry.idempotencyKey))
    throw new TypeError('SECTION_CCWB_IDEMPOTENCY_BINDING_INVALID');
  const {idempotencyKey, ...command} = entry;
  return {command, idempotencyKey, legacyUnverified:false};
}
