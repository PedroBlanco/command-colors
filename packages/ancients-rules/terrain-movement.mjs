/**
 * Terrain-only screen for ordinary movement in Ancients (2009 base rules).
 * It never authorizes movement, combat, a command card or a leader action.
 * The terrain board MUST be supplied by trusted, server-owned scenario data.
 */
import {distance, inBounds} from '../hex-grid/hex.mjs';
import {BASE_MOVEMENT_PROFILES} from './movement-profile.mjs';

export const BASE_TERRAIN_TYPES = Object.freeze(['FOREST', 'HILL', 'BROKEN_GROUND']);

const mounted = new Set(['LIGHT_CAVALRY', 'MEDIUM_CAVALRY', 'HEAVY_CAVALRY', 'ELEPHANT', 'HEAVY_CHARIOT']);
const forestBattleExceptions = new Set([
  'LIGHT_INFANTRY', 'LIGHT_SLING_INFANTRY', 'LIGHT_BOW_INFANTRY',
  'AUXILIA_INFANTRY', 'WARRIOR_INFANTRY'
]);
const key = cell => `${cell.col},${cell.row}`;
const cell = value => value && typeof value === 'object' && !Array.isArray(value)
  && Number.isSafeInteger(value.col) && Number.isSafeInteger(value.row) && inBounds(value);
const result = (status, reason, step, destinationTerrain, battleOnEntry) => Object.freeze({
  status, reason, step, destinationTerrain, battleOnEntry, needsFullLegalityCheck: true
});

function terrainIndex(terrain) {
  if (!Array.isArray(terrain) || terrain.length > 117) throw new TypeError('INVALID_BASE_TERRAIN_MAP');
  const index = new Map();
  for (const tile of terrain) {
    if (!tile || typeof tile !== 'object' || Array.isArray(tile)
      || !cell(tile) || !BASE_TERRAIN_TYPES.includes(tile.kind)
      || index.has(key(tile))) throw new TypeError('INVALID_BASE_TERRAIN_MAP');
    index.set(key(tile), tile.kind);
  }
  return index;
}

/**
 * Path excludes the moving unit's origin and counts each crossed hex edge.
 * The result only describes standard terrain effects: other rules can override
 * an ordinary restriction, but no such exceptions are granted here.
 */
export function assessAncientsTerrainMovement({unitType, origin, path, terrain = []} = {}) {
  if (typeof unitType !== 'string' || !Object.hasOwn(BASE_MOVEMENT_PROFILES, unitType))
    throw new TypeError('INVALID_BASE_TERRAIN_UNIT');
  if (!cell(origin) || !Array.isArray(path) || path.length < 1 || path.length > 32
      || !path.every(cell)) throw new TypeError('INVALID_BASE_TERRAIN_PATH');
  const index = terrainIndex(terrain);
  const visited = new Set([key(origin)]);
  let last = origin;
  for (let i = 0; i < path.length; i++) {
    const next = path[i], hex = key(next);
    if (distance(last, next) !== 1)
      return result('BLOCKED', 'NON_ADJACENT_HEX', i, null, 'UNAVAILABLE');
    if (visited.has(hex))
      return result('BLOCKED', 'REPEATED_HEX', i, null, 'UNAVAILABLE');
    const kind = index.get(hex) ?? 'CLEAR';
    if (kind === 'BROKEN_GROUND') {
      if (unitType === 'HEAVY_WAR_MACHINE')
        return result('BLOCKED', 'WAR_MACHINE_CANNOT_ENTER_BROKEN_GROUND', i, kind, 'UNAVAILABLE');
      if (mounted.has(unitType) && i !== path.length - 1)
        return result('BLOCKED', 'MOUNTED_MUST_STOP_ON_BROKEN_GROUND', i, kind, 'UNAVAILABLE');
    }
    if (kind === 'FOREST' && i !== path.length - 1)
      return result('BLOCKED', 'MUST_STOP_ON_FOREST_ENTRY', i, kind, 'UNAVAILABLE');
    last = next;
    visited.add(hex);
  }
  const kind = index.get(key(path.at(-1))) ?? 'CLEAR';
  const noBattle = (kind === 'FOREST' && !forestBattleExceptions.has(unitType))
    || (kind === 'BROKEN_GROUND' && mounted.has(unitType));
  return result('CANDIDATE', null, null, kind,
    noBattle ? 'UNAVAILABLE' : 'NOT_BARRED_BY_TERRAIN');
}
