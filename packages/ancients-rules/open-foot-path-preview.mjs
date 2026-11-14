/**
 * Ancients base rules: NON-AUTHORIZING open-ground infantry path preview.
 *
 * This is a deliberately narrow pure rules slice: ordinary infantry, normal
 * section card, fully clear scenario, no leaders and no scenario exceptions.
 * Geometry is shared for every troop type; the existing profile table gives
 * the maximum steps and battle-after-movement limits.
 *
 * No actor, session, board revision, order, idempotency key, private journal,
 * official event or trusted scenario provenance is accepted from this API.
 * It must never be treated as a committed or commit-ready move.
 */
import {ANCIENTS_RULESET,assessBaseMovement}
  from './movement-profile.mjs';
import {assessAncientsMovementRegime,assessOpenHexPathGeometry}
  from './movement-regimes.mjs';

export const OPEN_FOOT_PATH_PREVIEW_SCOPE='BASE_FOOT_OPEN_PATH_PREVIEW_V1';
const ROOT=['scope','ruleset','unitType','cardFamily','from','path',
  'occupiedCells','terrain','leaders','scenarioExceptions'];

const denied=(reason,step=null)=>Object.freeze({
  status:'BLOCKED',reason,step,steps:null,destination:null,
  battleAfterMovement:null,profileStatus:null,
  movementAuthorized:false,officialMovementAuthorized:false,
  canCommit:false,dbChanged:false,needsFullLegalityCheck:true
});
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  Object.getPrototypeOf(x)===Object.prototype;
const fields=(x,keys)=>plain(x)&&Reflect.ownKeys(x).length===keys.length&&
  keys.every(k=>{
    const d=Object.getOwnPropertyDescriptor(x,k);
    return d?.enumerable===true&&Object.hasOwn(d,'value');
  });
const value=(x,k)=>Object.getOwnPropertyDescriptor(x,k).value;
const emptyList=x=>Array.isArray(x)&&
  Object.getPrototypeOf(x)===Array.prototype&&
  Object.getOwnPropertyDescriptor(x,'length')?.value===0&&
  Reflect.ownKeys(x).length===1;

export function previewBaseOpenFootPath(request={}){
  try{
    if(!fields(request,ROOT))return denied('INVALID_OPEN_FOOT_PATH_REQUEST');
    const scope=value(request,'scope'),ruleset=value(request,'ruleset'),
      unitType=value(request,'unitType'),
      cardFamily=value(request,'cardFamily'),
      terrain=value(request,'terrain'),leaders=value(request,'leaders'),
      scenarioExceptions=value(request,'scenarioExceptions');
    if(scope!==OPEN_FOOT_PATH_PREVIEW_SCOPE)
      return denied('UNSUPPORTED_FOOT_PATH_SCOPE');
    if(ruleset!==ANCIENTS_RULESET)
      return denied('UNSUPPORTED_FOOT_PATH_RULESET');
    if(cardFamily!=='ORDINARY_SECTION')
      return denied('UNSUPPORTED_FOOT_PATH_CARD');
    if(!emptyList(terrain)||!emptyList(leaders)||
       !emptyList(scenarioExceptions))
      return denied('UNSUPPORTED_FOOT_PATH_CONTEXT');
    const unit=assessAncientsMovementRegime({unitType,steps:1});
    if(unit.status!=='SUBSET_ELIGIBLE')
      return denied('UNSUPPORTED_FOOT_UNIT');
    const geometry=assessOpenHexPathGeometry({
      from:value(request,'from'),path:value(request,'path'),
      occupiedCells:value(request,'occupiedCells')
    });
    if(geometry.status!=='CANDIDATE_PATH_GEOMETRY')
      return denied(geometry.reason,geometry.step);
    const profile=assessBaseMovement({unitType,steps:geometry.steps});
    if(profile.status!=='WITHIN_PROFILE')
      return denied('STANDARD_FOOT_MOVEMENT_EXCEEDED');
    return Object.freeze({
      status:'OPEN_FOOT_PATH_CANDIDATE',reason:null,step:null,
      steps:geometry.steps,
      destination:geometry.destination,
      battleAfterMovement:profile.battle,
      profileStatus:profile.status,
      movementAuthorized:false,officialMovementAuthorized:false,
      canCommit:false,dbChanged:false,needsFullLegalityCheck:true
    });
  }catch{
    return denied('INVALID_OPEN_FOOT_PATH_REQUEST');
  }
}
