/**
 * CCW-013 local-only, server-owned synthetic order context for SQLite matches.
 * Sector boundaries and card order limits below are invented laboratory values,
 * NOT official Command & Colors: Ancients rules or authorized scenario content.
 * Never construct this context from fields in a browser request.
 */
import {inBounds} from '../hex-grid/hex.mjs';

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const MAX_BOARD_UNITS = 117;

function syntheticSectors(col) {
  // Invented overlap at columns 4 and 8; not a claim about Ancients sectors.
  return [
    ...(col <= 4 ? ['left'] : []),
    ...(col >= 4 && col <= 8 ? ['center'] : []),
    ...(col >= 8 ? ['right'] : [])
  ];
}

/** Called inside the SQLite transaction with persisted, server-created board. */
export function createServerSyntheticOrderContext(board, activeCard) {
  if (!Array.isArray(board) || board.length > MAX_BOARD_UNITS ||
      typeof activeCard !== 'string' || !ID.test(activeCard)) {
    throw new TypeError('INVALID_SERVER_ORDER_SETUP');
  }
  const units = [], sectorMembership = Object.create(null);
  const ids = new Set(), occupied = new Set();
  for (const unit of board) {
    if (!unit || typeof unit !== 'object' || Array.isArray(unit) ||
        typeof unit.id !== 'string' || !ID.test(unit.id) ||
        !['A', 'B'].includes(unit.side) ||
        !inBounds({col: unit.col, row: unit.row}) ||
        (unit.orderable !== undefined && typeof unit.orderable !== 'boolean')) {
      throw new TypeError('INVALID_SERVER_BOARD_UNIT');
    }
    const cellKey = `${unit.col},${unit.row}`;
    if (ids.has(unit.id) || occupied.has(cellKey)) throw new TypeError('DUPLICATE_SERVER_BOARD_UNIT');
    ids.add(unit.id);
    occupied.add(cellKey);
    sectorMembership[cellKey] = syntheticSectors(unit.col);
    units.push({id: unit.id, side: unit.side, cell: {col: unit.col, row: unit.row},
      orderable: unit.orderable !== false});
  }
  // Deliberately permissive all-sector test card: the validator still checks
  // side, existence, availability, duplicates and a finite order limit.
  const cardProfiles = {[activeCard]: {maxUnits: 2, allowedSectors: ['left', 'center', 'right']}};
  return {cardProfiles, units, sectorMembership};
}
