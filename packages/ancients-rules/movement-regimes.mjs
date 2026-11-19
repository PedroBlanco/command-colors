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

const denied=reason=>Object.freeze({
  status:'BLOCKED',reason,regime:null,
  movementAuthorized:false,canCommit:false,needsFullLegalityCheck:true
});
const geometry=(status,reason)=>Object.freeze({
  status,reason,movementAuthorized:false,canCommit:false,
  needsFullLegalityCheck:true
});
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  Object.getPrototypeOf(x)===Object.prototype;
const field=(source,name)=>{
  const d=Object.getOwnPropertyDescriptor(source,name);
  return d&&d.enumerable&&Object.hasOwn(d,'value')?d.value:undefined;
};
const hasFields=(source,keys)=>plain(source)&&
  Reflect.ownKeys(source).length===keys.length&&
  keys.every(k=>Object.hasOwn(source,k)&&
    Object.getOwnPropertyDescriptor(source,k)?.enumerable===true&&
    Object.hasOwn(Object.getOwnPropertyDescriptor(source,k),'value'));
const readCell=value=>{
  if(!plain(value))return null;
  const col=field(value,'col'),row=field(value,'row');
  return Number.isSafeInteger(col)&&Number.isSafeInteger(row)&&
    inBounds({col,row})?{col,row}:null;
};
const key=cell=>cell.col+','+cell.row;

/**
 * Select a RULE REGIME without running a separate type-specific reducer.
 * Movement distances and battle allowances are read from the existing
 * BASE_MOVEMENT_PROFILES; they are not duplicated in this module.
 */
export function assessAncientsMovementRegime(input={}){
  try {
    if(!plain(input))return denied('INVALID_MOVEMENT_REGIME_INPUT');
    const keys=Reflect.ownKeys(input);
    if(keys.length<1||keys.length>2||keys.some(k=>
      k!=='unitType'&&k!=='steps')||
      !Object.hasOwn(input,'unitType')||
      !keys.every(k=>Object.getOwnPropertyDescriptor(input,k)?.enumerable&&
        Object.hasOwn(Object.getOwnPropertyDescriptor(input,k),'value')))
      return denied('INVALID_MOVEMENT_REGIME_INPUT');
    const unitType=field(input,'unitType'),
      steps=Object.hasOwn(input,'steps')?field(input,'steps'):1;
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

/**
 * Type-agnostic candidate for ONE hex edge; unit-side and order constraints
 * are enforced elsewhere. Occupancy considers both friendly and enemy units.
 * No eligible result alone authorizes a movement or changes a board.
 */
export function assessOpenHexStepGeometry(input={}){
  try{
    if(!hasFields(input,['from','to','occupiedCells']))
      return geometry('BLOCKED','INVALID_GEOMETRY_INPUT');
    const from=readCell(field(input,'from')),to=readCell(field(input,'to')),
      occupied=field(input,'occupiedCells');
    if(!from||!to||!Array.isArray(occupied)||
       Object.getPrototypeOf(occupied)!==Array.prototype)
      return geometry('BLOCKED','INVALID_GEOMETRY_INPUT');
    const count=Object.getOwnPropertyDescriptor(occupied,'length')?.value;
    if(!Number.isSafeInteger(count)||count<0||count>117||
       Reflect.ownKeys(occupied).length!==count+1)
      return geometry('BLOCKED','INVALID_GEOMETRY_INPUT');
    const positions=[];
    for(let i=0;i<count;i++){
      const d=Object.getOwnPropertyDescriptor(occupied,String(i));
      if(!d||!d.enumerable||!Object.hasOwn(d,'value'))
        return geometry('BLOCKED','INVALID_GEOMETRY_INPUT');
      const cell=readCell(d.value);
      if(!cell)return geometry('BLOCKED','INVALID_GEOMETRY_INPUT');
      positions.push(cell);
    }
    if(distance(from,to)!==1)
      return geometry('BLOCKED','NOT_ONE_ADJACENT_HEX');
    if(positions.some(unit=>key(unit)===key(to)))
      return geometry('BLOCKED','OCCUPIED_DESTINATION');
    return geometry('CANDIDATE_GEOMETRY',null);
  }catch{return geometry('BLOCKED','INVALID_GEOMETRY_INPUT');}
}

/**
 * Type-agnostic complete path geometry, composed from the same one-edge
 * primitive. It copies all coordinates via own data descriptors BEFORE
 * walking the path; no getter or browser-calculated permission is trusted.
 *
 * This is not an authorization and never changes a board or a revision.
 */
const pathVerdict=(status,reason,step=null,destination=null,steps=null)=>
  Object.freeze({
    status,reason,step,destination:destination===null?null:
      Object.freeze({col:destination.col,row:destination.row}),
    steps,movementAuthorized:false,canCommit:false,needsFullLegalityCheck:true
  });
const cellArray=(source,min,max)=>{
  if(!Array.isArray(source)||Object.getPrototypeOf(source)!==Array.prototype)
    return null;
  const size=Object.getOwnPropertyDescriptor(source,'length')?.value;
  if(!Number.isSafeInteger(size)||size<min||size>max||
     Reflect.ownKeys(source).length!==size+1)return null;
  const cells=[];
  for(let i=0;i<size;i++){
    const desc=Object.getOwnPropertyDescriptor(source,String(i));
    if(!desc?.enumerable||!Object.hasOwn(desc,'value'))return null;
    const cell=readCell(desc.value);
    if(!cell)return null;
    cells.push(cell);
  }
  return cells;
};
export function assessOpenHexPathGeometry(input={}){
  try{
    if(!hasFields(input,['from','path','occupiedCells']))
      return pathVerdict('BLOCKED','INVALID_PATH_GEOMETRY_INPUT');
    const from=readCell(field(input,'from'));
    const path=cellArray(field(input,'path'),1,32);
    const occupied=cellArray(field(input,'occupiedCells'),0,117);
    if(!from||!path||!occupied)
      return pathVerdict('BLOCKED','INVALID_PATH_GEOMETRY_INPUT');
    let previous=from;
    const visited=new Set([key(from)]);
    for(let i=0;i<path.length;i++){
      const target=path[i];
      if(visited.has(key(target)))
        return pathVerdict('BLOCKED','REPEATED_HEX',i);
      const edge=assessOpenHexStepGeometry({
        from:previous,to:target,occupiedCells:occupied
      });
      if(edge.status!=='CANDIDATE_GEOMETRY')
        return pathVerdict('BLOCKED',edge.reason,i);
      visited.add(key(target));
      previous=target;
    }
    return pathVerdict('CANDIDATE_PATH_GEOMETRY',null,null,previous,path.length);
  }catch{
    return pathVerdict('BLOCKED','INVALID_PATH_GEOMETRY_INPUT');
  }
}
