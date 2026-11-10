/**
 * R-06/R-09/R-13: PURE preview of ordinary Ancients base-game ranged casualties.
 * Inputs must be derived from trusted, fully validated server board and dice.
 * NOT an attack authorization, mutation, victory award, or retreat decision.
 * Does not handle special scenario rules, unit abilities or leader dice results.
 */
export const BASE_UNIT_STARTING_BLOCKS = Object.freeze({
  LIGHT_INFANTRY:4, LIGHT_SLING_INFANTRY:4, LIGHT_BOW_INFANTRY:4,
  AUXILIA_INFANTRY:4, WARRIOR_INFANTRY:4, MEDIUM_INFANTRY:4,
  HEAVY_INFANTRY:4, HEAVY_WAR_MACHINE:2,
  LIGHT_CAVALRY:3, MEDIUM_CAVALRY:3, HEAVY_CAVALRY:3,
  ELEPHANT:2, HEAVY_CHARIOT:2
});

const fail = code => { throw new TypeError(code); };
const count = n => Number.isSafeInteger(n) && n >= 0 && n <= 32;

/**
 * Provisional hit accounting, never executable from an HTTP request.
 * `blocksRemaining` MUST come from server state, not inferred from unit type.
 * Hits/flags/diceCount MUST come from an already validated dice interpretation.
 * `leaderAttached` MUST be derived from the server's leader/hex placement.
 */
export function previewBaseAncientsRangedBlockLoss({unitType, blocksRemaining,
  diceCount, matchingColorHits, flagsPending, leaderAttached} = {}) {
  if (typeof unitType !== 'string' || !Object.hasOwn(BASE_UNIT_STARTING_BLOCKS, unitType))
    fail('UNSUPPORTED_BASE_UNIT_TYPE');
  const maxBlocks = BASE_UNIT_STARTING_BLOCKS[unitType];
  if (!Number.isSafeInteger(blocksRemaining) || blocksRemaining < 1 || blocksRemaining > maxBlocks)
    fail('INVALID_SERVER_UNIT_BLOCKS');
  if (!Number.isSafeInteger(diceCount) || diceCount < 1 || diceCount > 32 ||
      !count(matchingColorHits) || !count(flagsPending) ||
      matchingColorHits + flagsPending > diceCount)
    fail('INVALID_VALIDATED_DICE_COUNTS');
  if (typeof leaderAttached !== 'boolean') fail('LEADER_ATTACHMENT_NOT_VERIFIED');

  const blocksToRemove = Math.min(blocksRemaining, matchingColorHits);
  const excessHits = matchingColorHits - blocksToRemove;
  const remainingBlocks = blocksRemaining - blocksToRemove;
  const unitWouldBeEliminated = remainingBlocks === 0;
  const effectiveFlagsPending = unitWouldBeEliminated ? 0 : flagsPending;
  const flagsNoLongerApplicable = unitWouldBeEliminated ? flagsPending : 0;
  const leaderCasualtyCheck = leaderAttached && blocksToRemove > 0
    ? Object.freeze({kind:'ATTACHED_LEADER_CASUALTY_CHECK',
      diceCount:unitWouldBeEliminated ? 1 : 2,
      requiredLeaderSymbols:unitWouldBeEliminated ? 1 : 2,
      leaderEvasionMayFollow:unitWouldBeEliminated,
      completed:false}) : null;

  return Object.freeze({
    kind:'BASE_RANGED_BLOCK_LOSS_PREVIEW', unitType, maxBlocks,
    originalBlocks:blocksRemaining, matchingColorHits, diceCount,
    blocksToRemove, excessHits, remainingBlocks, unitWouldBeEliminated,
    possibleVictoryBanner:unitWouldBeEliminated ? 1 : 0,
    flagsRolled:flagsPending, effectiveFlagsPending, flagsNoLongerApplicable,
    leaderCasualtyCheck,
    hitsApplied:false, leaderChecksResolved:false, flagsResolved:false,
    bannerAwarded:false, combatResolved:false, boardMutated:false,
    attackAuthorized:false, needsFullLegalityCheck:true
  });
}
