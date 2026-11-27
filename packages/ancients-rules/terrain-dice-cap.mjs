/**
 * Ordinary/base-game terrain dice limits only; NOT an attack authorization.
 * The caller supplies terrain derived from trusted, server-owned scenario data.
 * LOS, card bonuses, unit dice, range, leaders and attack sequencing are external.
 */
import {BASE_MOVEMENT_PROFILES} from './movement-profile.mjs';
import {BASE_TERRAIN_TYPES,isImpassableTerrain} from './terrain-movement.mjs';

const allowed = new Set(['CLEAR', ...BASE_TERRAIN_TYPES]);
const mounted = new Set(['LIGHT_CAVALRY', 'MEDIUM_CAVALRY', 'HEAVY_CAVALRY', 'ELEPHANT', 'HEAVY_CHARIOT']);
const reducedClose = new Set(['FOREST', 'BROKEN_GROUND', 'FORDABLE_RIVER', 'BRIDGE', 'MARSH', 'BUILDING']);

/** maxDice null means *terrain* imposes no ordinary limit; it does not mean unlimited dice. */
export function assessAncientsTerrainDiceCap({attackerType, attackerTerrain,
  targetTerrain, attackKind} = {}) {
  if (typeof attackerType !== 'string' || !Object.hasOwn(BASE_MOVEMENT_PROFILES, attackerType))
    throw new TypeError('UNSUPPORTED_BASE_UNIT_TYPE');
  if (!allowed.has(attackerTerrain) || !allowed.has(targetTerrain)
      || !['CLOSE', 'RANGED'].includes(attackKind)) throw new TypeError('INVALID_TERRAIN_BATTLE');

  if(attackKind==='RANGED'&&(attackerTerrain==='BUILDING'||targetTerrain==='BUILDING'))
    return Object.freeze({maxDice:0,needsFullLegalityCheck:true,lineOfSightChecked:false,cardModifiersApplied:false});
  if(isImpassableTerrain(attackerTerrain)||isImpassableTerrain(targetTerrain))
    return Object.freeze({maxDice:0,needsFullLegalityCheck:true,lineOfSightChecked:false,cardModifiersApplied:false});
  let maxDice = null;
  if (attackKind === 'RANGED') {
    if (targetTerrain === 'FOREST'||['FORDABLE_RIVER','BRIDGE','MARSH'].includes(attackerTerrain)) maxDice = 1;
  } else {
    if (reducedClose.has(attackerTerrain) || reducedClose.has(targetTerrain)) maxDice = 2;
    const fromHill = attackerTerrain === 'HILL', toHill = targetTerrain === 'HILL';
    if (fromHill || toHill) {
      const hillLimit = toHill && !fromHill ? 2 : (mounted.has(attackerType) ? 2 : 3);
      maxDice = maxDice === null ? hillLimit : Math.min(maxDice, hillLimit);
    }
  }
  return Object.freeze({maxDice,...(attackerTerrain==='FORTIFIED_CAMP'?{dicePenalty:1}:{}), needsFullLegalityCheck: true,
    lineOfSightChecked: false, cardModifiersApplied: false});
}
