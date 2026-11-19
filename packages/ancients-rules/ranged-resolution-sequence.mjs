/**
 * Ancients base 3e: read-only post-ranged-dice resolution checklist.
 * Every step is a PROPOSAL awaiting a fully authorized combat executor.
 * It never confirms casualties, decides morale, moves units or awards banners.
 */
import {previewBaseAncientsRangedBlockLoss} from './block-loss-preview.mjs';
import {ANCIENTS_BATTLE_DIE_FACES} from './battle-dice.mjs';
import {ANCIENTS_RULESET} from './movement-profile.mjs';
import {generateDigitalRoll,recordPhysicalRoll} from '../dice-roller/dice.mjs';

export const RANGED_RESOLUTION_SEQUENCE_VERSION = 1;
const FACES = ANCIENTS_BATTLE_DIE_FACES;
const reject = code => {throw new TypeError(code);};
const freezeStep = (kind, details = {}) => Object.freeze({kind, ...details, executed:false});

/**
 * Uses a trusted block-loss preview calculated from a staged roll/board.
 * The original preview is recomputed and checked to refuse a forged summary.
 */
export function planBaseAncientsRangedResolution({blockLoss} = {}) {
  if (!blockLoss || typeof blockLoss !== 'object' || Array.isArray(blockLoss) ||
      blockLoss.kind !== 'BASE_RANGED_BLOCK_LOSS_PREVIEW' ||
      typeof blockLoss.leaderAttached !== 'boolean') reject('INVALID_BLOCK_LOSS_SEQUENCE_INPUT');
  let checked;
  try {
    checked = previewBaseAncientsRangedBlockLoss({
      unitType:blockLoss.unitType,blocksRemaining:blockLoss.originalBlocks,
      diceCount:blockLoss.diceCount,matchingColorHits:blockLoss.matchingColorHits,
      flagsPending:blockLoss.flagsRolled,leaderAttached:blockLoss.leaderAttached
    });
  } catch {reject('INVALID_BLOCK_LOSS_SEQUENCE_INPUT');}
  // Ensure no contradictory cached values, not merely matching leading fields.
  if (JSON.stringify(checked) !== JSON.stringify(blockLoss))
    reject('INCONSISTENT_BLOCK_LOSS_SEQUENCE_INPUT');

  const steps = [];
  if (checked.blocksToRemove > 0) steps.push(freezeStep('APPLY_DIRECT_HITS', {
    blocksToRemove:checked.blocksToRemove,unitWouldBeEliminated:checked.unitWouldBeEliminated,
    requiresFullAuthorization:true
  }));
  if (checked.leaderCasualtyCheck) steps.push(freezeStep('LEADER_CASUALTY_CHECK', {
    diceCount:checked.leaderCasualtyCheck.diceCount,
    requiredLeaderSymbols:checked.leaderCasualtyCheck.requiredLeaderSymbols,
    follows:'APPLY_DIRECT_HITS',maximumChecksForThisCombat:1
  }));
  if (checked.unitWouldBeEliminated && checked.leaderAttached)
    steps.push(freezeStep('LEADER_EVADE_IF_SURVIVES', {
      requiresLeaderSurvival:true,requiresPathValidation:true
    }));
  if (checked.effectiveFlagsPending > 0) {
    steps.push(freezeStep('DEFENDER_MORALE_CHOICE', {
      flagsRolled:checked.effectiveFlagsPending,
      flagsThatMayBeIgnored:'NOT_YET_VALIDATED',
      defenderMayChooseToAcceptFlags:true
    }));
    steps.push(freezeStep('RESOLVE_RETREAT_OR_BLOCK_LOSS', {
      requiresPathValidation:true,requiresDefenderChoice:true,
      possibleRetreatBlockLoss:true
    }));
    if (checked.leaderAttached && checked.leaderCasualtyCheck === null)
      steps.push(freezeStep('LEADER_CHECK_IF_RETREAT_CAUSES_BLOCK_LOSS', {
        maximumChecksForThisCombat:1,conditional:true
      }));
  }
  steps.push(freezeStep('AUTHORITATIVE_FINALIZATION', {
    requiresFullAuthorization:true,awardVictoryBanner:false
  }));
  return Object.freeze({kind:'ANCIENTS_BASE_RANGED_RESOLUTION_CHECKLIST',schemaVersion:1,
    blockLoss:checked,steps:Object.freeze(steps),
    nextRequiredStep:steps[0].kind,
    leaderCheckAlreadyRolled:false,
    fullRulesValidated:false,attackAuthorized:false,combatResolved:false,
    boardMutated:false,bannerAwarded:false
  });
}

/**
 * Capture separate leader-casualty dice with the canonical six faces. No dice
 * can be reused from the original ranged attack: type and purpose differ.
 * In production actor, count and rollId MUST come from server state.
 * Test-only randomIndex injection must NEVER cross an HTTP boundary.
 */
export function captureBaseAncientsLeaderCasualtyDice({rollId,actor,diceCount,mode,
  declaredFaces,randomIndex} = {}) {
  if (!Number.isSafeInteger(diceCount) || ![1,2].includes(diceCount))
    reject('INVALID_LEADER_CASUALTY_DICE_COUNT');
  if (!['DIGITAL','PHYSICAL'].includes(mode)) reject('INVALID_LEADER_CASUALTY_MODE');
  if (mode==='DIGITAL' && declaredFaces!==undefined)
    reject('DIGITAL_LEADER_DICE_CANNOT_BE_DECLARED');
  if (mode==='PHYSICAL' && randomIndex!==undefined)
    reject('PHYSICAL_LEADER_DICE_CANNOT_INJECT_RANDOMNESS');
  const spec={rollId,actor,diceCount,dieFaces:[...FACES]};
  const event=mode==='DIGITAL'
    ? randomIndex===undefined ? generateDigitalRoll(spec) : generateDigitalRoll(spec,randomIndex)
    : recordPhysicalRoll(spec,declaredFaces);
  return Object.freeze({type:'ANCIENTS_BASE_LEADER_CASUALTY_CAPTURED',
    purpose:'LEADER_CASUALTY_CHECK',ruleset:ANCIENTS_RULESET,
    rollId:event.rollId,actor:event.actor,source:event.source,
    verification:event.verification,diceCount:event.diceCount,
    results:Object.freeze([...event.results]),attackAuthorized:false,
    combatResolved:false,needsFullLegalityCheck:true});
}

/**
 * Preview an already captured/validated leader-check roll; NEVER roll dice here.
 * The caller must have performed the preceding authorized hit-removal step.
 * It cannot clear a real pending leader check or confirm a combat.
 */
export function previewBaseAncientsLeaderCasualtyCheck({checklist,roll} = {}) {
  if (!checklist || checklist.kind !== 'ANCIENTS_BASE_RANGED_RESOLUTION_CHECKLIST' ||
      checklist.schemaVersion !== 1 || checklist.attackAuthorized !== false ||
      checklist.combatResolved !== false || checklist.leaderCheckAlreadyRolled !== false ||
      !Array.isArray(checklist.steps) ||
      !checklist.steps.some(s => s.kind === 'LEADER_CASUALTY_CHECK'))
    reject('LEADER_CASUALTY_CHECK_NOT_REQUIRED');
  let canonical;
  try {canonical=planBaseAncientsRangedResolution({blockLoss:checklist.blockLoss});}
  catch {reject('INCONSISTENT_LEADER_CASUALTY_CHECKLIST');}
  if (JSON.stringify(canonical) !== JSON.stringify(checklist))
    reject('INCONSISTENT_LEADER_CASUALTY_CHECKLIST');
  const expected = checklist.blockLoss?.leaderCasualtyCheck;
  if (!expected || expected.completed !== false ||
      ![1,2].includes(expected.diceCount) ||
      expected.requiredLeaderSymbols !== expected.diceCount)
    reject('INVALID_LEADER_CASUALTY_REQUIREMENT');
  if (!roll || typeof roll !== 'object' || Array.isArray(roll) ||
      roll.type !== 'ANCIENTS_BASE_LEADER_CASUALTY_CAPTURED' ||
      roll.purpose !== 'LEADER_CASUALTY_CHECK' ||
      roll.ruleset !== ANCIENTS_RULESET ||
      !['A','B'].includes(roll.actor) ||
      !['DIGITAL','PHYSICAL'].includes(roll.source) ||
      roll.verification !== (roll.source === 'DIGITAL' ? 'SERVER_GENERATED' : 'PLAYER_DECLARED') ||
      roll.diceCount !== expected.diceCount || !Array.isArray(roll.results) ||
      roll.results.length !== expected.diceCount ||
      !roll.results.every(face => FACES.includes(face)))
    reject('INVALID_LEADER_CASUALTY_ROLL');
  const leaderSymbols = roll.results.filter(x => x === 'LEADER').length;
  const leaderWouldBeEliminated = leaderSymbols === expected.requiredLeaderSymbols;
  const leaderMustEvadeIfApplied = !leaderWouldBeEliminated &&
    checklist.blockLoss.unitWouldBeEliminated;
  const nextRequiredStep = leaderMustEvadeIfApplied ? 'LEADER_EVADE_IF_SURVIVES' :
    checklist.blockLoss.effectiveFlagsPending > 0 ? 'DEFENDER_MORALE_CHOICE' :
    'AUTHORITATIVE_FINALIZATION';
  return Object.freeze({kind:'LEADER_CASUALTY_OUTCOME_PREVIEW',
    diceCount:expected.diceCount,leaderSymbols,leaderWouldBeEliminated,
    leaderMustEvadeIfApplied,nextRequiredStep,
    source:roll.source,verification:roll.verification,
    leaderRemoved:false,blocksRemoved:false,retreatResolved:false,
    attackAuthorized:false,combatResolved:false,boardMutated:false,
    requiresFullAuthorization:true
  });
}
