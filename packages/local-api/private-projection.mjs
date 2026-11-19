/**
 * Defensive check for a browser's private match projection.
 * This is a client integrity check, not a substitute for server access control.
 * Accept only a state whose side belongs to the independently verified handle.
 */
const SIDES = new Set(['A','B']);
const MATCH = /^[0-9a-fA-F-]{36}$/;
const validHandle = value => typeof value === 'string' && value.length >= 1 && value.length <= 80;

export function privateProjectionMatches(lobby, handle, matchId) {
  if (!validHandle(handle) || typeof matchId !== 'string' || !MATCH.test(matchId) ||
      !lobby || typeof lobby !== 'object' || Array.isArray(lobby) ||
      lobby.matchId !== matchId ||
      !['READY','INVITING'].includes(lobby.status) ||
      !Array.isArray(lobby.players) || lobby.players.length < 1 || lobby.players.length > 2) return false;
  const handles = new Set(), sides = new Set();
  for (const player of lobby.players) {
    if (!player || typeof player !== 'object' || Array.isArray(player) ||
        !validHandle(player.handle) || !SIDES.has(player.side) ||
        handles.has(player.handle) || sides.has(player.side)) return false;
    handles.add(player.handle); sides.add(player.side);
  }
  const own = lobby.players.find(player => player.handle === handle);
  if (!own) return false;
  if (lobby.status === 'INVITING') return lobby.players.length === 1 && !Object.hasOwn(lobby,'state');
  const state = lobby.state;
  return lobby.players.length === 2 &&
    state !== null && typeof state === 'object' && !Array.isArray(state) &&
    state.matchId === matchId && state.you === own.side &&
    Array.isArray(state.board) && state.board.length <= 117 &&
    Array.isArray(state.yourHand) && Number.isSafeInteger(state.opponentCardCount) &&
    state.opponentCardCount >= 0;
}
