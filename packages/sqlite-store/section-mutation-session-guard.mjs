/**
 * Internal-only revalidation of a live CCWB experimental actor, at the point
 * where the caller already holds its SQLite BEGIN IMMEDIATE transaction.
 *
 * The preflight actor is only a side expectation, not proof of permission.
 * We must ask the authenticated session resolver again while the lock is held.
 */
const denied = (status,code) => Object.freeze({status,code});

export function makeSectionMutationSessionGuard({db,resolveActor,sessionToken,expectedActor}={}) {
  if (!db || typeof db.isTransaction !== 'boolean' || typeof resolveActor !== 'function' ||
      typeof sessionToken !== 'string' || !['A','B'].includes(expectedActor)) {
    throw new TypeError('INVALID_SECTION_LAB_AUTH_GUARD');
  }
  return () => {
    if (!db.isTransaction) throw new Error('SECTION_LAB_AUTH_REQUIRES_TRANSACTION');
    const current=resolveActor(sessionToken);
    if (!current || typeof current!=='object') return denied(401,'UNAUTHENTICATED');
    if (current.error) return current.error;
    return current.actor===expectedActor ? true : denied(404,'NOT_FOUND');
  };
}
