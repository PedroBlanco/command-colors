/**
 * Versioned, SERVER-OWNED dice plans for the isolated SQLite laboratory.
 * OFFICIAL_PREVIEW only records provisional results; it NEVER authorizes a battle.
 * Legacy synthetic snapshots are recognized but never silently upgraded.
 */
import {ANCIENTS_RULESET} from './movement-profile.mjs';
import {ANCIENTS_BATTLE_DIE_FACES, BASE_UNIT_DIE_SYMBOLS} from './battle-dice.mjs';

export const SYNTHETIC_DICE_PLAN = 'SYNTHETIC_RANGED_V1';
export const OFFICIAL_PREVIEW_DICE_PLAN = 'ANCIENTS_BASE_RANGED_PREVIEW_V1';
export const LAB_DIE_FACES = Object.freeze(['RED','BLUE','FLAG','RED']);

const equal = (a,b) => Array.isArray(a) && a.length===b.length && a.every((x,i)=>x===b[i]);
const countOK = x => Number.isSafeInteger(x) && x>=1 && x<=32;
const exactKeys = (obj,names) => Object.keys(obj).length===names.length && names.every(k=>Object.hasOwn(obj,k));
const record = obj => obj && typeof obj==='object' && !Array.isArray(obj);

/** Trusted server configuration only. No client selects a ruleset or a dice plan. */
export function createRangedDicePlan({mode, screening, board, targetId}={}) {
  if (!['SYNTHETIC','OFFICIAL_PREVIEW'].includes(mode)) throw new TypeError('INVALID_LAB_DICE_MODE');
  const diceCount=screening?.ranged?.diceAfterTerrain;
  if (!countOK(diceCount)) return null;
  if (mode==='SYNTHETIC') return Object.freeze({
    schemaVersion:1,kind:SYNTHETIC_DICE_PLAN,diceCount,
    dieFaces:Object.freeze([...LAB_DIE_FACES])
  });
  const target=Array.isArray(board?.units) ? board.units.find(u=>u?.id===targetId) : null;
  if (!target || !Object.hasOwn(BASE_UNIT_DIE_SYMBOLS, target.type)) return null;
  return Object.freeze({schemaVersion:1,kind:OFFICIAL_PREVIEW_DICE_PLAN,
    ruleset:ANCIENTS_RULESET,targetUnitType:target.type,diceCount,
    dieFaces:Object.freeze([...ANCIENTS_BATTLE_DIE_FACES])});
}

/** Fail-closed reader: invalid version, distribution or target is never guessed. */
export function classifyRangedDicePlan(plan) {
  if (!record(plan) || !countOK(plan.diceCount)) return null;
  if (plan.schemaVersion===undefined && exactKeys(plan,['diceCount','dieFaces'])
      && equal(plan.dieFaces,LAB_DIE_FACES)) return 'SYNTHETIC_LEGACY';
  if (plan.schemaVersion!==1) return null;
  if (plan.kind===SYNTHETIC_DICE_PLAN && exactKeys(plan,['schemaVersion','kind','diceCount','dieFaces'])
      && equal(plan.dieFaces,LAB_DIE_FACES)) return 'SYNTHETIC';
  if (plan.kind===OFFICIAL_PREVIEW_DICE_PLAN && exactKeys(plan,
      ['schemaVersion','kind','ruleset','targetUnitType','diceCount','dieFaces'])
      && plan.ruleset===ANCIENTS_RULESET
      && Object.hasOwn(BASE_UNIT_DIE_SYMBOLS,plan.targetUnitType)
      && equal(plan.dieFaces,ANCIENTS_BATTLE_DIE_FACES)) return 'OFFICIAL_PREVIEW';
  return null;
}
