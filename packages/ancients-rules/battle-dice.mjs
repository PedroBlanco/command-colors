/**
 * Command & Colors: Ancients base, 3rd edition (2009): six physical die faces
 * and a PURE interpretation of ordinary ranged dice against a UNIT.
 * Source: https://www.commandsandcolors.net/ancients/the-game/main/02-contents-base-game.html
 * and https://www.commandsandcolors.net/ancients/the-game/main/10-ranged-combat-fire.html
 * No leader-only targets, scenario/card exceptions, morale, retreats, block
 * losses, or battle authorisation are implemented here.
 */
import {ANCIENTS_RULESET, BASE_MOVEMENT_PROFILES} from './movement-profile.mjs';
import {generateDigitalRoll, recordPhysicalRoll} from '../dice-roller/dice.mjs';

export const ANCIENTS_BATTLE_DIE_FACES = Object.freeze([
  'LIGHT', 'MEDIUM', 'HEAVY', 'LEADER', 'FLAG', 'SWORDS'
]);

/** White-bordered unit stickers match the same colour die result. */
export const BASE_UNIT_DIE_SYMBOLS = Object.freeze({
  LIGHT_INFANTRY:'LIGHT',
  LIGHT_SLING_INFANTRY:'LIGHT',
  LIGHT_BOW_INFANTRY:'LIGHT',
  AUXILIA_INFANTRY:'LIGHT',
  WARRIOR_INFANTRY:'MEDIUM',
  MEDIUM_INFANTRY:'MEDIUM',
  HEAVY_INFANTRY:'HEAVY',
  HEAVY_WAR_MACHINE:'HEAVY',
  LIGHT_CAVALRY:'LIGHT',
  MEDIUM_CAVALRY:'MEDIUM',
  HEAVY_CAVALRY:'HEAVY',
  ELEPHANT:'HEAVY',
  HEAVY_CHARIOT:'HEAVY'
});

if (Object.keys(BASE_UNIT_DIE_SYMBOLS).length !== Object.keys(BASE_MOVEMENT_PROFILES).length ||
  Object.keys(BASE_MOVEMENT_PROFILES).some(type => !Object.hasOwn(BASE_UNIT_DIE_SYMBOLS, type))) {
  throw new Error('ANCIENTS_DICE_UNIT_COVERAGE_MISMATCH');
}

const invalid = reason => { throw new TypeError(reason); };

/**
 * Capture a roll with official six-face distribution. The caller must derive
 * actor/diceCount/rollId from trusted server state and persist atomically.
 * Injecting randomIndex is permitted only in tests. This does NOT resolve a battle.
 */
export function captureBaseAncientsRangedDice({rollId, actor, diceCount, mode,
  declaredFaces, randomIndex} = {}) {
  if (mode !== 'DIGITAL' && mode !== 'PHYSICAL') invalid('INVALID_ANCIENTS_DICE_MODE');
  if (mode === 'DIGITAL' && declaredFaces !== undefined) invalid('DIGITAL_CANNOT_DECLARE_FACES');
  if (mode === 'PHYSICAL' && randomIndex !== undefined) invalid('PHYSICAL_CANNOT_INJECT_RANDOMNESS');
  const spec = {rollId, actor, diceCount, dieFaces:[...ANCIENTS_BATTLE_DIE_FACES]};
  const event = mode === 'PHYSICAL'
    ? recordPhysicalRoll(spec, declaredFaces)
    : randomIndex === undefined ? generateDigitalRoll(spec) : generateDigitalRoll(spec, randomIndex);
  return Object.freeze({
    type:'ANCIENTS_BASE_RANGED_DICE_CAPTURED', ruleset:ANCIENTS_RULESET,
    rollId:event.rollId, actor:event.actor, source:event.source,
    verification:event.verification, diceCount:event.diceCount,
    results:Object.freeze([...event.results]),
    attackAuthorized:false, combatResolved:false, needsFullLegalityCheck:true
  });
}

/**
 * Decode a previously captured, server-trusted roll. Colour matches are only
 * POTENTIAL unit-block hits; flags still need morale/retreat resolution.
 * A leader alone in a hex is a different attack target and is NOT supported.
 * This function cannot authorize the declaration or write anything to a board.
 */
export function interpretBaseAncientsRangedDice({roll, targetUnitType, expectedDiceCount} = {}) {
  if (typeof targetUnitType !== 'string' || !Object.hasOwn(BASE_UNIT_DIE_SYMBOLS, targetUnitType))
    invalid('UNSUPPORTED_ANCIENTS_DICE_TARGET');
  if (!Number.isSafeInteger(expectedDiceCount) || expectedDiceCount < 1 || expectedDiceCount > 32)
    invalid('INVALID_EXPECTED_DICE_COUNT');
  if (!roll || typeof roll !== 'object' || Array.isArray(roll) ||
      roll.type !== 'ANCIENTS_BASE_RANGED_DICE_CAPTURED' || roll.ruleset !== ANCIENTS_RULESET ||
      (roll.actor !== 'A' && roll.actor !== 'B') ||
      (roll.source !== 'DIGITAL' && roll.source !== 'PHYSICAL') ||
      roll.verification !== (roll.source === 'DIGITAL' ? 'SERVER_GENERATED' : 'PLAYER_DECLARED') ||
      roll.diceCount !== expectedDiceCount || !Array.isArray(roll.results) ||
      roll.results.length !== expectedDiceCount ||
      roll.results.some(face => !ANCIENTS_BATTLE_DIE_FACES.includes(face))) {
    invalid('INVALID_ANCIENTS_CAPTURED_ROLL');
  }
  const targetSymbol = BASE_UNIT_DIE_SYMBOLS[targetUnitType];
  let matchingColorHits = 0, flagsPending = 0, misses = 0;
  const dieEffects = roll.results.map(face => {
    let outcome;
    if (face === targetSymbol) { outcome = 'MATCHING_COLOR_HIT'; matchingColorHits++; }
    else if (face === 'FLAG') { outcome = 'FLAG_PENDING'; flagsPending++; }
    else { outcome = 'NO_RANGED_EFFECT'; misses++; }
    return Object.freeze({face, outcome});
  });
  return Object.freeze({
    ruleset:ANCIENTS_RULESET, kind:'BASE_RANGED_UNIT_DICE_INTERPRETATION',
    targetUnitType, targetSymbol, diceCount:expectedDiceCount,
    matchingColorHits, flagsPending, misses,
    dieEffects:Object.freeze(dieEffects),
    rollSource:roll.source, verification:roll.verification,
    hitsApplied:false, flagsResolved:false, leaderChecksResolved:false,
    boardMutated:false, combatResolved:false, attackAuthorized:false,
    needsFullLegalityCheck:true
  });
}
