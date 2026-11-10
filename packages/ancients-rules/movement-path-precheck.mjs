/**
 * R-05 partial rule check for normal Ancients movement, not an authorization.
 * Orders, terrain, phases, cards, leader attachment and scenario exceptions
 * still require authoritative validation. No special card is executed here.
 */
import {distance, inBounds} from '../hex-grid/hex.mjs';
import {assessBaseMovement, BASE_MOVEMENT_PROFILES} from './movement-profile.mjs';

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SIDES = new Set(['A', 'B']);
const key = cell => `${cell.col},${cell.row}`;
const goodId = value => typeof value === 'string' && ID.test(value);
const goodCell = value => value && typeof value === 'object' && !Array.isArray(value)
  && Number.isSafeInteger(value.col) && Number.isSafeInteger(value.row) && inBounds(value);
const fail = (reason, step = null, profile = null) => Object.freeze({
  status: 'BLOCKED', reason, step, profile, needsFullLegalityCheck: true
});

function validatePieces(units, leaders) {
  if (!Array.isArray(units) || units.length > 117 || !Array.isArray(leaders) || leaders.length > 117)
    throw new TypeError('INVALID_BASE_BOARD');
  const ids = new Set(), occupied = new Map();
  for (const unit of units) {
    if (!unit || typeof unit !== 'object' || Array.isArray(unit) || !goodId(unit.id)
      || !SIDES.has(unit.side) || !goodCell(unit)
      || typeof unit.type !== 'string' || !Object.hasOwn(BASE_MOVEMENT_PROFILES, unit.type)
      || ids.has(unit.id) || occupied.has(key(unit))) throw new TypeError('INVALID_BASE_BOARD');
    ids.add(unit.id); occupied.set(key(unit), unit);
  }
  const leaderIds = new Set(), leadersByCell = new Map();
  for (const leader of leaders) {
    if (!leader || typeof leader !== 'object' || Array.isArray(leader)
      || !goodId(leader.id) || !SIDES.has(leader.side) || !goodCell(leader)
      || ids.has(leader.id) || leaderIds.has(leader.id) || leadersByCell.has(key(leader))
      || (occupied.has(key(leader)) && occupied.get(key(leader)).side !== leader.side))
      throw new TypeError('INVALID_BASE_BOARD');
    leaderIds.add(leader.id); leadersByCell.set(key(leader), leader);
  }
  return {occupied, leadersByCell};
}

/**
 * Path excludes the unit's origin. Status CANDIDATE means only that ordinary
 * geometry, occupancy and movement-distance screening found no obstacle.
 * A candidate MUST NOT be committed, persisted or shown as a legal move.
 */
export function precheckAncientsMovementPath({units, leaders = [], unitId, path} = {}) {
  const {occupied, leadersByCell} = validatePieces(units, leaders);
  if (!goodId(unitId) || !Array.isArray(path) || path.length < 1 || path.length > 32
      || !path.every(goodCell)) throw new TypeError('INVALID_BASE_PATH');
  const unit = units.find(item => item.id === unitId);
  if (!unit) throw new TypeError('UNKNOWN_MOVING_UNIT');
  const profile = assessBaseMovement({unitType:unit.type, steps:path.length});
  let previous = unit;
  const visited = new Set([key(unit)]);
  let attachLeader = false;
  for (let i = 0; i < path.length; i++) {
    const target = path[i], dest = key(target);
    if (distance(previous, target) !== 1) return fail('NON_ADJACENT_HEX', i, profile);
    if (visited.has(dest)) return fail('REPEATED_HEX', i, profile);
    if (occupied.has(dest)) return fail('OCCUPIED_HEX', i, profile);
    const leader = leadersByCell.get(dest);
    if (leader?.side !== undefined && leader.side !== unit.side)
      return fail('ENEMY_LEADER_HEX', i, profile);
    if (leader) {
      if (i !== path.length - 1) return fail('MUST_STOP_WITH_FRIENDLY_LEADER', i, profile);
      attachLeader = true;
    }
    previous = target;
    visited.add(dest);
  }
  if (profile.status === 'EXCEEDS_STANDARD_PROFILE')
    return Object.freeze({status:'REQUIRES_RULE_EXCEPTION', reason:'STANDARD_MOVEMENT_EXCEEDED',
      step:null, profile, needsFullLegalityCheck:true});
  const destination = path.at(-1);
  const charge = profile.status === 'CONDITIONAL_CHARGE';
  if (charge && ![...occupied.values(), ...leadersByCell.values()].some(enemy =>
      enemy.side !== unit.side && distance(destination, enemy) === 1))
    return fail('WARRIOR_CHARGE_TARGET_MISSING', path.length - 1, profile);
  const carriesLeader = leadersByCell.get(key(unit))?.side === unit.side;
  if (carriesLeader && attachLeader) return fail('TWO_LEADERS_COLLIDE', path.length - 1, profile);
  return Object.freeze({
    status:'CANDIDATE', reason:null, step:null, profile,
    requiresLeaderResolution: attachLeader || carriesLeader,
    requiresMandatoryCloseCombat:charge,
    needsFullLegalityCheck:true
  });
}
