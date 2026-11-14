/**
 * Shared hex geometry and Ancients unit-regime classification.
 *
 * One geometry engine; data-driven movement profiles; separate rule policies.
 * The status SUBSET_ELIGIBLE means ONLY that the pre-existing one-hex,
 * open-ground, no-leader FOOT core can consider this type. It is not movement
 * authorization, a card/terrain check or a permission to persist a turn.
 *
 * Napoleonics can reuse the geometric concept but must supply its own
 * ruleset/bounds and eligibility policy. No Napoleonics rules live here.
 */
import {distance,inBounds} from '../hex-grid/hex.mjs';
import {ANCIENTS_RULESET,BASE_MOVEMENT_PROFILES,assessBaseMovement}
  from './movement-profile.mjs';

export const ANCIENTS_MOVEMENT_REGIMES=Object.freeze({
  LIGHT_INFANTRY:'ORDINARY_FOOT',
  LIGHT_SLING_INFANTRY:'ORDINARY_FOOT',
  LIGHT_BOW_INFANTRY:'ORDINARY_FOOT',
  AUXILIA_INFANTRY:'ORDINARY_FOOT',
  MEDIUM_INFANTRY:'ORDINARY_FOOT',
  HEAVY_INFANTRY:'ORDINARY_FOOT',
  WARRIOR_INFANTRY:'WARRIOR_CHARGE',
  HEAVY_WAR_MACHINE:'WAR_MACHINE',
  LIGHT_CAVALRY:'CAVALRY',
  MEDIUM_CAVALRY:'CAVALRY',
  HEAVY_CAVALRY:'CAVALRY',
  ELEPHANT:'ELEPHANT',
  HEAVY_CHARIOT:'CHARIOT'
});

const denied=(reason)=>Object.freeze({
  status:'BLOCKED',reason,regime:null,
  movementAuthorized:false,canCommit:false,needsFullLegalityCheck:true
});
const geometry=(status,reason)=>Object.freeze({
  status,reason,movementAuthorized:false,canCommit:false,
  needsFullLegalityCheck:true
});

/**
 * Select a RULE REGIME without running a separate type-specific reducer.
 * Movement distances and battle allowances are read from the existing
 * BASE_MOVEMENT_PROFILES; they are not duplicated in this module.
 */
export function assessAncientsMovementRegime({unitType,steps=1}={}){
  try {
    if(typeof unitType!=='string'||
       !Object.hasOwn(BASE_MOVEMENT_PROFILES,unitType)||
       !Object.hasOwn(ANCIENTS_MOVEMENT_REGIMES,unitType))
      return denied('UNKNOWN_BASE_UNIT_TYPE');
    if(!Number.isSafeInteger(steps)||steps<1||steps>32)
      return denied('INVALID_MOVEMENT_STEP_COUNT');
    const selected=ANCIENTS_MOVEMENT_REGIMES[unitType];
    const existing=assessBaseMovement({unitType,steps});
    const supported=selected==='ORDINARY_FOOT'&&steps===1&&
      existing.status==='WITHIN_PROFILE';
    return Object.freeze({
      status:supported?'SUBSET_ELIGIBLE':'NEEDS_EXTENDED_RULES',
      reason:supported?null:steps!==1?'MULTI_HEX_RULES_NOT_IMPLEMENTED':
        'UNIT_REGIME_NOT_IMPLEMENTED',
      ruleset:ANCIENTS_RULESET,unitType,steps,regime:selected,
      maxSteps:BASE_MOVEMENT_PROFILES[unitType].maxSteps,
      battleAfterSteps:BASE_MOVEMENT_PROFILES[unitType].battleAfterSteps,
      profileStatus:existing.status,battle:existing.battle,
      movementAuthorized:false,canCommit:false,needsFullLegalityCheck:true
    });
  }catch{return denied('INVALID_MOVEMENT_REGIME_INPUT');}
}

const cell=value=>value!==null&&typeof value==='object'&&
  !Array.isArray(value)&&Number.isSafeInteger(value.col)&&
  Number.isSafeInteger(value.row)&&inBounds({col:value.col,row:value.row});
const key=value=>value.col+','+value.row;

/**
 * Type-agnostic candidate for ONE hex edge; unit-side and order constraints
 * are enforced elsewhere. Occupancy considers both friendly and enemy units.
 * No eligible result alone authorizes a movement or changes a board.
 */
export function assessOpenHexStepGeometry({from,to,occupiedCells}={}){
  try{
    if(!cell(from)||!cell(to)||!Array.isArray(occupiedCells)||
       occupiedCells.length>117||!occupiedCells.every(cell))
      return geometry('BLOCKED','INVALID_GEOMETRY_INPUT');
    if(distance(from,to)!==1)
      return geometry('BLOCKED','NOT_ONE_ADJACENT_HEX');
    if(occupiedCells.some(unit=>key(unit)===key(to)))
      return geometry('BLOCKED','OCCUPIED_DESTINATION');
    return geometry('CANDIDATE_GEOMETRY',null);
  }catch{return geometry('BLOCKED','INVALID_GEOMETRY_INPUT');}
}
