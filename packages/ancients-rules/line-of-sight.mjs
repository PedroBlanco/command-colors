/**
 * Partial Ancients base-game LOS screen (R-06), not an attack authorization.
 * Only FOREST, HILL and BROKEN_GROUND terrain are supported here. Terrain and
 * positions MUST come from a trusted server-owned board, never a client claim.
 * Geometry uses the 13x9 odd-q hex centers and true intervening hex interiors.
 */
import {allCells, distance, inBounds, pixelCenter, polygonPoints} from '../hex-grid/hex.mjs';

const KINDS = new Set(['FOREST', 'HILL', 'BROKEN_GROUND']);
const EPS = 1e-8;
const key = ({col, row}) => `${col},${row}`;
const cell = v => v && typeof v === 'object' && !Array.isArray(v)
  && Number.isSafeInteger(v.col) && Number.isSafeInteger(v.row) && inBounds(v);
const cross = (a, b) => a.x * b.y - a.y * b.x;
const sub = (a, b) => ({x:a.x - b.x, y:a.y - b.y});

function indexCells(items, kind) {
  if (!Array.isArray(items) || items.length > 117) throw new TypeError('INVALID_LOS_' + kind);
  const found = new Map();
  for (const value of items) {
    if (!cell(value) || found.has(key(value)) || (kind === 'TERRAIN' && !KINDS.has(value.kind)))
      throw new TypeError('INVALID_LOS_' + kind);
    found.set(key(value), value);
  }
  return found;
}

/**
 * Clip the center-to-center line to one convex hexagon. A positive-length
 * intersection is INTERIOR unless the line coincides with a polygon edge.
 * Vertex-only touches do not obstruct LOS. This avoids unstable pixel/ray
 * sampling and deals with the rule for two blockers on opposite edge sides.
 */
function crossedHex(start, end, tile) {
  const polygon = polygonPoints(tile, 1);
  const d = sub(end, start);
  let low = 0, high = 1;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const edge = sub(b, a);
    const a0 = cross(edge, sub(start, a));
    const slope = cross(edge, d);
    if (Math.abs(slope) <= EPS) {
      if (a0 < -EPS) return null;
    } else {
      const t = -a0 / slope;
      if (slope > 0) low = Math.max(low, t);
      else high = Math.min(high, t);
    }
    if (high < low - EPS) return null;
  }
  if (high - low <= EPS) return null;
  const t = (low + high) / 2;
  const midpoint = {x:start.x + t*d.x, y:start.y + t*d.y};
  const interior = polygon.every((a, i) => cross(sub(polygon[(i + 1) % 6], a), sub(midpoint, a)) > EPS);
  return {low, high, interior};
}

const freeze = (status, reason, obstructions = []) => Object.freeze({
  status, reason, obstructions:Object.freeze(obstructions.map(item=>Object.freeze({...item}))),
  needsFullLegalityCheck:true, attackAuthorized:false,
  rangedWeaponAndRangeChecked:false, cardModifiersApplied:false
});

/**
 * `VISIBLE` means only that the included map/occupants do not block the line.
 * No shot, phase, range, weapon or sequence is authorized by this result.
 */
export function assessAncientsLineOfSight({from, to, units = [], leaders = [], terrain = []} = {}) {
  if (!cell(from) || !cell(to) || key(from) === key(to)) throw new TypeError('INVALID_LOS_ENDPOINTS');
  const terrainCells = indexCells(terrain, 'TERRAIN');
  const occupiedUnits = indexCells(units, 'UNITS');
  const occupiedLeaders = indexCells(leaders, 'LEADERS');
  const originKind = terrainCells.get(key(from))?.kind ?? 'CLEAR';
  const targetKind = terrainCells.get(key(to))?.kind ?? 'CLEAR';
  const start = pixelCenter(from, 1), end = pixelCenter(to, 1);
  const hit = [];
  for (const hex of allCells()) {
    const position = key(hex);
    if (position === key(from) || position === key(to)) continue;
    const section = crossedHex(start, end, hex);
    if (!section) continue;
    hit.push({...hex, position, ...section,
      kind:terrainCells.get(position)?.kind ?? 'CLEAR',
      occupant:occupiedUnits.has(position) || occupiedLeaders.has(position)});
  }

  // A hill does not block two units on the same continuous, all-hill plateau.
  // A clear intervening hex breaks that assumption, even if endpoints are hills.
  // A single continuous hill-side trace suffices along a shared edge.
  const plateau = (() => {
    if (originKind !== 'HILL' || targetKind !== 'HILL') return false;
    // Search a continuous, edge-connected hill corridor along the actual
    // sightline; a valley gap breaks plateau sight even if hills join elsewhere.
    const chain = [from, ...hit.filter(h => h.kind === 'HILL'), to]
      .map(h => ({...h, ...crossedHex(start,end,h)}))
      .filter(h => h.low !== undefined);
    const reachable = new Set([key(from)]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const a of chain) if (reachable.has(key(a))) for (const b of chain) {
        if (reachable.has(key(b)) || distance(a,b) !== 1) continue;
        if (a.low <= b.high + EPS && b.low <= a.high + EPS) {
          reachable.add(key(b)); changed = true;
        }
      }
    }
    return reachable.has(key(to));
  })();
  const opaque = h => h.occupant || h.kind === 'FOREST' || (h.kind === 'HILL' && !plateau);

  const insideBlockers = hit.filter(h => h.interior && opaque(h));
  if (insideBlockers.length) {
    const first = insideBlockers.sort((a,b)=>a.low-b.low)[0];
    return freeze('BLOCKED', 'INTERVENING_OBSTRUCTION', [{col:first.col,row:first.row}]);
  }
  const edgeBlockers = hit.filter(h => !h.interior && opaque(h));
  // Along a shared hex edge, an obstruction on one side does not block LOS.
  // Two distinct blockers whose overlap has positive length DO block LOS.
  for (let i=0; i<edgeBlockers.length; i++) for(let j=i+1; j<edgeBlockers.length; j++) {
    const a=edgeBlockers[i], b=edgeBlockers[j];
    if (Math.min(a.high,b.high) - Math.max(a.low,b.low) > EPS) {
      return freeze('BLOCKED','BOTH_SIDES_OF_EDGE',
        [{col:a.col,row:a.row},{col:b.col,row:b.row}]);
    }
  }
  return freeze('VISIBLE',null);
}
