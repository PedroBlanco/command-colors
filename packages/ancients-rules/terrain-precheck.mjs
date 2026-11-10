/**
 * Partial, ordinary-movement terrain screen for Ancients base game (2009).
 * Terrain does not authorize an order, battle, leader move or scenario action.
 * Caller must supply server-owned terrain and the already validated unit path.
 */
import {inBounds} from '../hex-grid/hex.mjs';
import {assessBaseMovement} from './movement-profile.mjs';

export const BASE_TERRAINS = Object.freeze(['PLAIN', 'FOREST', 'HILL', 'BROKEN_GROUND']);
const TERRAINS = new Set(BASE_TERRAINS);
const FOREST_BATTLE_EXCEPTIONS = new Set([
  'LIGHT_INFANTRY', 'LIGHT_SLING_INFANTRY', 'LIGHT_BOW_INFANTRY',
  'AUXILIA_INFANTRY', 'WARRIOR_INFANTRY'
]);
const MOUNTED = new Set(['LIGHT_CAVALRY', 'MEDIUM_CAVALRY', 'HEAVY_CAVALRY',
  'ELEPHANT', 'HEAVY_CHARIOT']);
const key = ({col,row}) => `${col},${row}`;
const cell = value => value && typeof value === 'object' && !Array.isArray(value)
  && Number.isSafeInteger(value.col) && Number.isSafeInteger(value.row) && inBounds(value);
const result = (status, reason, step, battle, profile) => Object.freeze({
  status, reason, step, battle, profile, needsFullLegalityCheck:true
});

/**
 * `terrain` is a sparse list of non-plain cells, from trusted scenario state.
 * `path` excludes origin; adjacency/occupancy are handled by the other screen.
 * `CANDIDATE` NEVER means legal movement or permission to attack.
 */
export function precheckAncientsTerrainMovement({unitType, path, terrain} = {}) {
  if (!Array.isArray(path) || path.length < 1 || path.length > 32
    || !path.every(cell)) throw new TypeError('INVALID_TERRAIN_PATH');
  if (!Array.isArray(terrain) || terrain.length > 117) throw new TypeError('INVALID_TERRAIN_MAP');
  const profile = assessBaseMovement({unitType,steps:path.length});
  const tiles = new Map();
  for (const entry of terrain) {
    if (!cell(entry) || typeof entry.type !== 'string' || !TERRAINS.has(entry.type)
      || entry.type === 'PLAIN' || tiles.has(key(entry)))
      throw new TypeError('INVALID_TERRAIN_MAP');
    tiles.set(key(entry),entry.type);
  }
  let battle = profile.battle;
  for (let i=0;i<path.length;i++) {
    const type = tiles.get(key(path[i])) ?? 'PLAIN';
    if (type === 'FOREST') {
      if (i < path.length-1) return result('BLOCKED','MUST_STOP_IN_FOREST',i,battle,profile);
      if (!FOREST_BATTLE_EXCEPTIONS.has(unitType)) battle='UNAVAILABLE';
    } else if (type === 'BROKEN_GROUND') {
      if (unitType === 'HEAVY_WAR_MACHINE')
        return result('BLOCKED','WAR_MACHINE_CANNOT_ENTER_BROKEN_GROUND',i,battle,profile);
      if (MOUNTED.has(unitType)) {
        if (i < path.length-1) return result('BLOCKED','MOUNTED_MUST_STOP_ON_BROKEN_GROUND',i,battle,profile);
        battle='UNAVAILABLE';
      }
    }
    // HILL has no ordinary movement or battle-on-entry restriction.
  }
  if (profile.status === 'EXCEEDS_STANDARD_PROFILE')
    return result('REQUIRES_RULE_EXCEPTION','STANDARD_MOVEMENT_EXCEEDED',null,battle,profile);
  return result('CANDIDATE',null,null,battle,profile);
}
