/**
 * CCW-014: browser-only lifetime for responses bound to a private session/match.
 * This is a UI race guard, not authorization; the server still authenticates.
 * In particular, an old POST/GET response cannot populate a newly signed-in
 * user's board even when they happen to select the same match ID again.
 */
const MATCH_ID = /^[0-9a-fA-F-]{36}$/;

export function createPrivateViewScope() {
  let generation = 0;
  let matchId = null;

  const reset = () => {
    generation++;
    matchId = null;
  };
  const selectMatch = id => {
    if (typeof id !== 'string' || !MATCH_ID.test(id)) throw new TypeError('INVALID_MATCH_ID');
    if (matchId !== id) {
      generation++;
      matchId = id;
    }
  };
  const capture = () => Object.freeze({generation, matchId});
  const isCurrent = (ticket, expectedMatch = matchId) => Boolean(ticket &&
    ticket.generation === generation && ticket.matchId === matchId &&
    expectedMatch === matchId);
  return Object.freeze({reset, selectMatch, capture, isCurrent});
}
