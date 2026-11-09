/**
 * Ancients: default/base-box unit movement allowances, Third Edition (2009).
 * This intentionally does NOT validate a complete legal move: orders, terrain,
 * occupancy, command cards, leaders and scenario exceptions need other rules.
 * No card text, scenario contents or licensed artwork are reproduced.
 */
export const ANCIENTS_RULESET = 'ancients-base-3e-2009';

const rows = [
  ['LIGHT_INFANTRY', 2, 2],
  ['LIGHT_SLING_INFANTRY', 2, 2],
  ['LIGHT_BOW_INFANTRY', 2, 2],
  ['AUXILIA_INFANTRY', 2, 1],
  ['WARRIOR_INFANTRY', 2, 1, 'CHARGE_AT_TWO'],
  ['MEDIUM_INFANTRY', 1, 1],
  ['HEAVY_INFANTRY', 1, 1],
  ['HEAVY_WAR_MACHINE', 1, 0],
  ['LIGHT_CAVALRY', 4, 4],
  ['MEDIUM_CAVALRY', 3, 3],
  ['HEAVY_CAVALRY', 2, 2],
  ['ELEPHANT', 2, 2],
  ['HEAVY_CHARIOT', 2, 2]
];

/** Small frozen records prevent accidental per-match mutation of the ruleset. */
export const BASE_MOVEMENT_PROFILES = Object.freeze(Object.fromEntries(rows.map(([type, maxSteps, battleAfterSteps, exception]) => [
  type, Object.freeze({maxSteps, battleAfterSteps, exception: exception ?? null})
])));

/**
 * Profile-only precheck, never an authoritative movement authorization.
 * `steps` is path length (number of crossed hex edges), not the hex distance
 * between origin and destination; detours are still counted in full.
 */
export function assessBaseMovement({unitType, steps} = {}) {
  if (typeof unitType !== 'string' || !Object.hasOwn(BASE_MOVEMENT_PROFILES, unitType))
    throw new TypeError('UNSUPPORTED_BASE_UNIT_TYPE');
  if (!Number.isSafeInteger(steps) || steps < 0)
    throw new TypeError('INVALID_MOVEMENT_STEPS');

  const profile = BASE_MOVEMENT_PROFILES[unitType];
  const tooFar = steps > profile.maxSteps;
  const charge = !tooFar && profile.exception === 'CHARGE_AT_TWO' && steps === 2;
  const status = tooFar ? 'EXCEEDS_STANDARD_PROFILE' : charge ? 'CONDITIONAL_CHARGE' : 'WITHIN_PROFILE';
  const battle = tooFar ? 'UNAVAILABLE' : charge ? 'MANDATORY_CLOSE_COMBAT'
    : steps <= profile.battleAfterSteps ? 'POSSIBLE' : 'UNAVAILABLE';

  return Object.freeze({
    ruleset: ANCIENTS_RULESET,
    unitType,
    steps,
    status,
    battle,
    // True even for WITHIN_PROFILE: terrain, card, scenario, order and occupancy
    // validation must be performed by the authoritative server first.
    needsFullLegalityCheck: true
  });
}
