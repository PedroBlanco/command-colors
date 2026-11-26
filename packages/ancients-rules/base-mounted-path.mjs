/**
 * Ancients base / standard mounted path only (LAB proposal, not authorization).
 * Cavalry, elephants and heavy chariots; no leaders, special cards, scenario
 * exceptions, battles, momentum, retreats or special combat rules.
 * Caller supplies server-owned origin, unit positions and terrain.
 */
import {inBounds} from '../hex-grid/hex.mjs';
import {BASE_MOVEMENT_PROFILES,assessBaseMovement} from './movement-profile.mjs';
import {ANCIENTS_MOVEMENT_REGIMES,assessOpenHexPathGeometry}
  from './movement-regimes.mjs';
import {assessAncientsTerrainMovement} from './terrain-movement.mjs';

export const BASE_MOUNTED_TYPES=Object.freeze([
  'LIGHT_CAVALRY','MEDIUM_CAVALRY','HEAVY_CAVALRY',
  'ELEPHANT','HEAVY_CHARIOT'
]);
const VALID=new Set(BASE_MOUNTED_TYPES);
const deny=(reason,step=null)=>Object.freeze({
  status:'BLOCKED',reason,step,destination:null,steps:null,
  battleAfterMovement:null,destinationTerrain:null,
  movementAuthorized:false,officialMovementAuthorized:false,canCommit:false,
  needsServerTransaction:true
});
const own=(o,k)=>Object.getOwnPropertyDescriptor(o,k);
const plain=o=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&
  Object.getPrototypeOf(o)===Object.prototype;
const value=(o,k)=>own(o,k).value;
function cell(source){
  if(!plain(source)||Reflect.ownKeys(source).length!==2)return null;
  for(const k of ['col','row']){
    const d=own(source,k);
    if(!d||!d.enumerable||!Object.hasOwn(d,'value')||
       !Number.isSafeInteger(d.value))return null;
  }
  const col=value(source,'col'),row=value(source,'row');
  return inBounds({col,row})?{col,row}:null;
}
function pathCells(path){
  if(!Array.isArray(path)||Object.getPrototypeOf(path)!==Array.prototype||
     path.length<1||path.length>4||Reflect.ownKeys(path).length!==path.length+1)
    return null;
  const result=[];
  for(let i=0;i<path.length;i++){
    const d=own(path,String(i));
    if(!d?.enumerable||!Object.hasOwn(d,'value'))return null;
    const at=cell(d.value);
    if(!at)return null;
    result.push(at);
  }
  return result;
}
export function previewBaseMountedPath(input={},{mountedCharge=false}={}){
  try{
    if(!plain(input)||Reflect.ownKeys(input).length!==5||
       !['unitType','from','path','occupiedCells','terrain'].every(k=>{
         const d=own(input,k);
         return d?.enumerable===true&&Object.hasOwn(d,'value');
       }))return deny('INVALID_MOUNTED_PATH_REQUEST');
    const unitType=value(input,'unitType');
    if(!VALID.has(unitType)||
       !['CAVALRY','ELEPHANT','CHARIOT'].includes(ANCIENTS_MOVEMENT_REGIMES[unitType]))
      return deny('UNSUPPORTED_MOUNTED_UNIT');
    const from=cell(value(input,'from'));
    const path=pathCells(value(input,'path'));
    if(!from||!path)return deny('INVALID_MOUNTED_PATH');
    const profile=BASE_MOVEMENT_PROFILES[unitType];
    const charge=mountedCharge===true&&['HEAVY_CAVALRY','ELEPHANT','HEAVY_CHARIOT'].includes(unitType);
    if(path.length>(charge?3:profile.maxSteps))return deny('STANDARD_MOUNTED_MOVEMENT_EXCEEDED');
    const geometry=assessOpenHexPathGeometry({
      from,path,occupiedCells:value(input,'occupiedCells')
    });
    if(geometry.status!=='CANDIDATE_PATH_GEOMETRY')
      return deny(geometry.reason,geometry.step);
    const terrainResult=assessAncientsTerrainMovement({
      unitType,origin:from,path,terrain:value(input,'terrain')
    });
    if(terrainResult.status!=='CANDIDATE')
      return deny(terrainResult.reason,terrainResult.step);
    const normal=charge&&path.length===3?{status:'WITHIN_PROFILE',battle:'POSSIBLE'}:assessBaseMovement({unitType,steps:path.length});
    if(normal.status!=='WITHIN_PROFILE')
      return deny('STANDARD_MOUNTED_MOVEMENT_EXCEEDED');
    return Object.freeze({
      status:'MOUNTED_PATH_PROPOSAL',reason:null,step:null,
      steps:path.length,destination:geometry.destination,
      destinationTerrain:terrainResult.destinationTerrain,
      battleAfterMovement:terrainResult.battleOnEntry==='UNAVAILABLE'
        ? 'UNAVAILABLE':normal.battle,
      movementAuthorized:false,officialMovementAuthorized:false,canCommit:false,
      needsServerTransaction:true
    });
  }catch{return deny('INVALID_MOUNTED_PATH_INPUT');}
}
