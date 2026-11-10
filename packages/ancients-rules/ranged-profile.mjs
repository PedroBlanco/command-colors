/**
 * Ordinary ranged weapon reach and fire after movement in Ancients base 3e.
 * No card/scenario exceptions, orders, phase, line of sight or authorization.
 */
import {ANCIENTS_RULESET, BASE_MOVEMENT_PROFILES} from './movement-profile.mjs';

export const BASE_RANGED_REACH = Object.freeze({
  LIGHT_INFANTRY: 2,
  LIGHT_SLING_INFANTRY: 3,
  LIGHT_BOW_INFANTRY: 3,
  AUXILIA_INFANTRY: 2,
  LIGHT_CAVALRY: 2,
  HEAVY_WAR_MACHINE: 6
});

function result(status, reason, range, baseDice, distance) {
  return Object.freeze({
    ruleset: ANCIENTS_RULESET, status, reason, range, distance, baseDice,
    needsFullLegalityCheck: true, attackAuthorized: false,
    ordersAndPhaseChecked: false, lineOfSightChecked: false,
    cardModifiersApplied: false
  });
}

/**
 * movedSteps must be supplied by a trusted server turn/movement record.
 * CANDIDATE describes a profile only and NEVER means a permitted battle.
 */
export function assessAncientsRangedProfile({unitType, movedSteps, targetDistance} = {}) {
  if (typeof unitType !== 'string' || !Object.hasOwn(BASE_MOVEMENT_PROFILES, unitType))
    throw new TypeError('UNSUPPORTED_BASE_UNIT_TYPE');
  if (!Number.isSafeInteger(movedSteps) || movedSteps < 0 ||
      !Number.isSafeInteger(targetDistance) || targetDistance < 1)
    throw new TypeError('INVALID_RANGED_PROFILE_INPUT');
  const range = Object.hasOwn(BASE_RANGED_REACH, unitType) ? BASE_RANGED_REACH[unitType] : null;
  const block = reason => result('BLOCKED', reason, range, 0, targetDistance);
  if (movedSteps > BASE_MOVEMENT_PROFILES[unitType].maxSteps)
    return block('EXCEEDS_STANDARD_MOVEMENT');
  if (range === null) return block('NO_BASE_RANGED_WEAPON');
  if (targetDistance === 1) return block('RANGED_TARGET_ADJACENT');
  if (targetDistance > range) return block('TARGET_OUT_OF_RANGE');
  if (unitType === 'HEAVY_WAR_MACHINE' && movedSteps > 0)
    return block('WAR_MACHINE_MOVED');
  if (unitType === 'AUXILIA_INFANTRY' && movedSteps > 1)
    return block('AUXILIA_MOVED_TWO');
  return result('CANDIDATE', null, range, movedSteps === 0 ? 2 : 1, targetDistance);
}
