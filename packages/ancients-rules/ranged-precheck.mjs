/**
 * Combined ranged-attack precheck from trusted server state, Ancients 3e base.
 * This function is NOT a command handler and NEVER authorizes combat.
 */
import {distance, inBounds} from '../hex-grid/hex.mjs';
import {BASE_MOVEMENT_PROFILES} from './movement-profile.mjs';
import {assessAncientsRangedProfile} from './ranged-profile.mjs';
import {assessAncientsLineOfSight} from './line-of-sight.mjs';
import {assessAncientsTerrainDiceCap} from './terrain-dice-cap.mjs';

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SIDES = new Set(['A', 'B']);
const TERRAIN_TYPES = new Set(['FOREST', 'HILL', 'BROKEN_GROUND']);
const key = ({col,row}) => `${col},${row}`;
const validCell = c => c && typeof c === 'object' && !Array.isArray(c) &&
  Number.isSafeInteger(c.col) && Number.isSafeInteger(c.row) && inBounds(c);
const validId = id => typeof id === 'string' && ID.test(id);

function trustedBoard(units, leaders, terrain) {
  if (!Array.isArray(units) || units.length < 2 || units.length > 117 ||
      !Array.isArray(leaders) || leaders.length > 117 ||
      !Array.isArray(terrain) || terrain.length > 117)
    throw new TypeError('INVALID_RANGED_BOARD');
  const byId = new Map(), occupied = new Map(), leadersOn = new Set(), terrainIndex = new Map();
  for (const unit of units) {
    if (!unit || typeof unit !== 'object' || Array.isArray(unit) ||
        !validId(unit.id) || !SIDES.has(unit.side) || !validCell(unit) ||
        typeof unit.type !== 'string' || !Object.hasOwn(BASE_MOVEMENT_PROFILES, unit.type) ||
        byId.has(unit.id) || occupied.has(key(unit))) throw new TypeError('INVALID_RANGED_BOARD');
    byId.set(unit.id, unit);
    occupied.set(key(unit), unit);
  }
  for (const leader of leaders) {
    if (!leader || typeof leader !== 'object' || Array.isArray(leader) ||
        !validId(leader.id) || !SIDES.has(leader.side) || !validCell(leader) ||
        byId.has(leader.id) || leadersOn.has(key(leader)) ||
        (occupied.has(key(leader)) && occupied.get(key(leader)).side !== leader.side))
      throw new TypeError('INVALID_RANGED_BOARD');
    leadersOn.add(key(leader));
    byId.set(leader.id, leader);
  }
  for (const tile of terrain) {
    if (!tile || typeof tile !== 'object' || Array.isArray(tile) ||
        !validCell(tile) || !TERRAIN_TYPES.has(tile.kind) || terrainIndex.has(key(tile)))
      throw new TypeError('INVALID_RANGED_BOARD');
    terrainIndex.set(key(tile), tile.kind);
  }
  return {byId, terrainIndex};
}

const result = (status, reason, extra = {}) => Object.freeze({
  status, reason, ...extra, needsFullLegalityCheck: true,
  attackAuthorized: false, ordersAndPhaseChecked: false,
  cardModifiersApplied: false, scenarioExceptionsChecked: false
});

/**
 * units/leaders/terrain/movedSteps: authoritative server-side only.
 * The eventual HTTP adapter MUST NOT accept them as client-controlled values.
 */
export function precheckAncientsRangedAttack({units, leaders = [], terrain = [],
  attackerId, targetId, movedSteps} = {}) {
  const {byId, terrainIndex} = trustedBoard(units, leaders, terrain);
  if (!validId(attackerId) || !validId(targetId) || attackerId === targetId ||
      !Number.isSafeInteger(movedSteps) || movedSteps < 0)
    throw new TypeError('INVALID_RANGED_ATTACK');
  const attacker = units.find(u => u.id === attackerId);
  const target = units.find(u => u.id === targetId);
  if (!attacker || !target || !byId.has(attackerId) || !byId.has(targetId))
    throw new TypeError('UNKNOWN_RANGED_UNIT'); // leader-only targets need their own rules
  if (attacker.side === target.side) return result('BLOCKED', 'FRIENDLY_TARGET');

  const profile = assessAncientsRangedProfile({
    unitType: attacker.type, movedSteps, targetDistance: distance(attacker, target)
  });
  if (profile.status !== 'CANDIDATE')
    return result('BLOCKED', profile.reason, {profile});
  const adjacentEnemy = [...units, ...leaders].some(piece =>
    piece.side !== attacker.side && distance(attacker, piece) === 1);
  if (adjacentEnemy)
    return result('BLOCKED', 'ADJACENT_ENEMY_PREVENTS_RANGED', {profile});

  const los = assessAncientsLineOfSight({from: attacker, to: target,
    units: units.map(({col,row}) => ({col,row})),
    leaders: leaders.map(({col,row}) => ({col,row})), terrain});
  if (los.status !== 'VISIBLE')
    return result('BLOCKED', 'LINE_OF_SIGHT_BLOCKED', {profile, los});

  const cap = assessAncientsTerrainDiceCap({attackerType:attacker.type,
    attackerTerrain: terrainIndex.get(key(attacker)) ?? 'CLEAR',
    targetTerrain: terrainIndex.get(key(target)) ?? 'CLEAR', attackKind:'RANGED'});
  const diceAfterTerrain = cap.maxDice === null ? profile.baseDice
    : Math.min(profile.baseDice, cap.maxDice);
  return result('CANDIDATE', null, {
    profile, los, terrainDice: cap,
    distance:profile.distance, range:profile.range,
    baseDice:profile.baseDice, diceAfterTerrain,
    rangedProfileChecked:true, lineOfSightChecked:true
  });
}
