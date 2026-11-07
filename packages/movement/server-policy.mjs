/**
 * Server-owned synthetic movement policy for the isolated local lab.
 * This deliberately does NOT encode Ancients movement ranges or terrain rules.
 * Only use this with the validated board stored in matches.private_state.
 */
import {inBounds} from '../hex-grid/hex.mjs';

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export function createServerSyntheticMovementPolicy(board) {
  if (!Array.isArray(board) || board.length > 117) throw new TypeError('INVALID_SERVER_BOARD');
  const ids = new Set();
  const cells = new Set();
  const maxStepsByUnit = Object.create(null);
  for (const unit of board) {
    if (!unit || typeof unit !== 'object' || Array.isArray(unit)
        || typeof unit.id !== 'string' || !ID.test(unit.id)
        || !['A', 'B'].includes(unit.side)
        || !inBounds({col: unit.col, row: unit.row})
        || (unit.orderable !== undefined && typeof unit.orderable !== 'boolean')) {
      throw new TypeError('INVALID_SERVER_BOARD');
    }
    const cellKey = `${unit.col},${unit.row}`;
    if (ids.has(unit.id) || cells.has(cellKey)) throw new TypeError('INVALID_SERVER_BOARD');
    ids.add(unit.id);
    cells.add(cellKey);
    // An invented, uniform two-hex range. Never copy a movement limit from HTTP.
    maxStepsByUnit[unit.id] = 2;
  }
  return {maxStepsByUnit, blockedCells: []};
}
