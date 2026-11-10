/**
 * Partial, ordinary-terrain precheck for Ancients (base game, Third Edition).
 * NOT an authorization. No command-card exceptions, terrain LOS, combat
 * resolution, scenario restrictions or server authentication are decided here.
 */
import {inBounds} from '../hex-grid/hex.mjs';
import {BASE_MOVEMENT_PROFILES} from './movement-profile.mjs';
import {precheckAncientsMovementPath} from './movement-path-precheck.mjs';

const TERRAIN_KINDS = new Set(['CLEAR', 'FOREST', 'HILL', 'BROKEN_GROUND']);
const LIGHT_FOREST_FOOT = new Set([
  'LIGHT_INFANTRY', 'LIGHT_SLING_INFANTRY', 'LIGHT_BOW_INFANTRY',
  'AUXILIA_INFANTRY', 'WARRIOR_INFANTRY'
]);
const MOUNTED = new Set([
  'LIGHT_CAVALRY', 'MEDIUM_CAVALRY', 'HEAVY_CAVALRY', 'ELEPHANT', 'HEAVY_CHARIOT'
]);
const key = cell => `${cell.col},${cell.row}`;
const validCell = cell => cell && typeof cell === 'object' && !Array.isArray(cell)
  && Number.isSafeInteger(cell.col) && Number.isSafeInteger(cell.row) && inBounds(cell);

function terrainMap(terrain) {
  // Requiring an explicit array prevents silently assuming a scenario is clear.
  if (!Array.isArray(terrain) || terrain.length > 117) throw new TypeError('INVALID_TERRAIN_BOARD');
  const tiles = new Map();
  for (const entry of terrain) {
    if (!validCell(entry) || typeof entry.kind !== 'string' || !TERRAIN_KINDS.has(entry.kind))
      throw new TypeError('UNSUPPORTED_OR_INVALID_TERRAIN');
    if (tiles.has(key(entry))) throw new TypeError('DUPLICATE_TERRAIN_HEX');
    if (entry.kind !== 'CLEAR') tiles.set(key(entry), entry.kind);
    else tiles.set(key(entry), 'CLEAR');
  }
  return tiles;
}

function result(base, status, reason, step, entryTerrain, battle) {
  return Object.freeze({status, reason, step, entryTerrain, battle,
    profile: base.profile ?? null,
    requiresLeaderResolution: base.requiresLeaderResolution === true,
    requiresMandatoryCloseCombat: base.requiresMandatoryCloseCombat === true,
    needsFullLegalityCheck: true});
}

/**
 * Checks terrain effects of an ordinary unit move, from server-owned state.
 * CANDIDATE only means the small set of ordinary rules screened here passes.
 * The calling authoritative engine MUST check all remaining rules separately.
 */
export function precheckAncientsTerrainMovement({units, leaders = [], unitId, path, terrain} = {}) {
  const tiles = terrainMap(terrain);
  const base = precheckAncientsMovementPath({units, leaders, unitId, path});
  const unit = units.find(item => item.id === unitId);
  const mounted = MOUNTED.has(unit.type);
  const entryTerrain = tiles.get(key(path.at(-1))) ?? 'CLEAR';
  if (base.status === 'BLOCKED')
    return result(base, 'BLOCKED', base.reason, base.step, entryTerrain, 'UNAVAILABLE');

  for (let i = 0; i < path.length; i++) {
    const kind = tiles.get(key(path[i])) ?? 'CLEAR';
    if (kind === 'BROKEN_GROUND' && unit.type === 'HEAVY_WAR_MACHINE')
      return result(base, 'BLOCKED', 'WAR_MACHINE_CANNOT_ENTER_BROKEN_GROUND', i, entryTerrain, 'UNAVAILABLE');
    if (i < path.length - 1 && kind === 'FOREST')
      return result(base, 'BLOCKED', 'MUST_STOP_ON_ENTERING_FOREST', i, entryTerrain, 'UNAVAILABLE');
    if (i < path.length - 1 && kind === 'BROKEN_GROUND' && mounted)
      return result(base, 'BLOCKED', 'MOUNTED_MUST_STOP_ON_BROKEN_GROUND', i, entryTerrain, 'UNAVAILABLE');
  }

  if (base.status === 'REQUIRES_RULE_EXCEPTION')
    return result(base, base.status, base.reason, null, entryTerrain, 'REQUIRES_RULE_EXCEPTION');

  let battle = base.profile.battle;
  if ((entryTerrain === 'FOREST' && !LIGHT_FOREST_FOOT.has(unit.type))
      || (entryTerrain === 'BROKEN_GROUND' && mounted)) battle = 'UNAVAILABLE';
  return result(base, 'CANDIDATE', null, null, entryTerrain, battle);
}

/**
 * Ordinary terrain caps only. Null means terrain does not cap the dice.
 * Cards, attached leaders, LOS, unit dice and battle permissions are unchecked.
 */
export function assessAncientsTerrainDiceCap({attackerType, attackerTerrain,
  targetTerrain, attackKind} = {}) {
  if (typeof attackerType !== 'string' || !Object.hasOwn(BASE_MOVEMENT_PROFILES, attackerType))
    throw new TypeError('UNSUPPORTED_BASE_UNIT_TYPE');
  if (!TERRAIN_KINDS.has(attackerTerrain) || !TERRAIN_KINDS.has(targetTerrain)
      || !['CLOSE', 'RANGED'].includes(attackKind)) throw new TypeError('INVALID_TERRAIN_BATTLE');

  let maxDice = null;
  if (attackKind === 'RANGED') {
    if (targetTerrain === 'FOREST') maxDice = 1;
  } else {
    if (['FOREST', 'BROKEN_GROUND'].includes(attackerTerrain)
        || ['FOREST', 'BROKEN_GROUND'].includes(targetTerrain)) maxDice = 2;
    const fromHill = attackerTerrain === 'HILL', toHill = targetTerrain === 'HILL';
    if (fromHill || toHill) {
      const hillLimit = toHill && !fromHill ? 2 : (MOUNTED.has(attackerType) ? 2 : 3);
      maxDice = maxDice === null ? hillLimit : Math.min(maxDice, hillLimit);
    }
  }
  return Object.freeze({maxDice, needsFullLegalityCheck: true,
    lineOfSightChecked: false, cardModifiersApplied: false});
}
