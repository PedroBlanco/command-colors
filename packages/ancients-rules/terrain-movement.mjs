/**
 * Terrain-only screen for ordinary movement in Ancients (2009 base rules).
 * It never authorizes movement, combat, a command card or a leader action.
 * The terrain board MUST be supplied by trusted, server-owned scenario data.
 */
import {distance, inBounds, pixelCenter} from '../hex-grid/hex.mjs';
import {BASE_MOVEMENT_PROFILES} from './movement-profile.mjs';

export const BASE_TERRAIN_TYPES = Object.freeze(['FOREST', 'HILL', 'BROKEN_GROUND', 'RIVER', 'FORDABLE_RIVER', 'SEACOAST', 'BRIDGE', 'FORTIFIED_CAMP', 'RAMPART']);
export const isImpassableTerrain=kind=>kind==='RIVER'||kind==='SEACOAST';
export const isImpassableHex=(terrain,cell)=>terrain.some(t=>t.col===cell.col&&t.row===cell.row&&isImpassableTerrain(t.kind));

const mounted = new Set(['LIGHT_CAVALRY', 'MEDIUM_CAVALRY', 'HEAVY_CAVALRY', 'ELEPHANT', 'HEAVY_CHARIOT']);
const forestBattleExceptions = new Set([
  'LIGHT_INFANTRY', 'LIGHT_SLING_INFANTRY', 'LIGHT_BOW_INFANTRY',
  'AUXILIA_INFANTRY', 'WARRIOR_INFANTRY'
]);
// Side i joins polygon vertices i and (i+1)%6; indices never rotate with viewers.
export function validRampartSides(sides){
  return Array.isArray(sides)&&[2,3].includes(sides.length)&&sides.every(i=>Number.isInteger(i)&&i>=0&&i<6)&&
    new Set(sides).size===sides.length&&sides.some(start=>Array.from({length:sides.length},(_,i)=>(start+i)%6).every(i=>sides.includes(i)));
}
export function terrainTileShapeOK(tile,strict=false){
  return !!tile&&typeof tile==='object'&&!Array.isArray(tile)&&BASE_TERRAIN_TYPES.includes(tile.kind)&&
    (!strict||Object.keys(tile).length===(tile.kind==='RAMPART'?4:3))&&['col','row','kind'].every(k=>Object.hasOwn(tile,k))&&
    (tile.kind!=='RAMPART'||validRampartSides(tile.sides));
}
export function fortificationProtects(terrain,attacker,target,targetType){
  if(!targetType||targetType==='LEADER'||mounted.has(targetType))return false;
  const tile=terrain.find(t=>t.col===target.col&&t.row===target.row);
  if(tile?.kind==='FORTIFIED_CAMP')return true;
  if(tile?.kind!=='RAMPART')return false;
  const a=pixelCenter(attacker,1),b=pixelCenter(target,1);
  // A center ray crosses the edge whose outward normal has maximal dot product.
  // On an exact vertex, either adjacent protected side grants protection.
  const dots=Array.from({length:6},(_,i)=>(a.x-b.x)*Math.cos((i+.5)*Math.PI/3)+(a.y-b.y)*Math.sin((i+.5)*Math.PI/3));
  const max=Math.max(...dots);
  return tile.sides.some(i=>Math.abs(dots[i]-max)<1e-8);
}
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
      || !cell(tile) || !terrainTileShapeOK(tile)
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
    if(isImpassableTerrain(kind))return result('BLOCKED','IMPASSABLE_TERRAIN',i,kind,'UNAVAILABLE');
    if(kind==='FORDABLE_RIVER'&&i!==path.length-1)return result('BLOCKED','MUST_STOP_ON_FORD_ENTRY',i,kind,'UNAVAILABLE');
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
