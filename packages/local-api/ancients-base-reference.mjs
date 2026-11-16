/**
 * Read-only geometric illustration of Ancients BASE movement profiles.
 * Unlike a game adjudicator, this requires a user-picked HYPOTHETICAL unit
 * type: the synthetic board has no official troop-type provenance.
 * Obstacles are public occupied hexes; terrain, leaders, cards and scenario
 * modifiers are intentionally outside this preview. Nothing is authorized.
 */
import {neighbors, inBounds} from '../hex-grid/hex.mjs';
import {BASE_MOVEMENT_PROFILES,assessBaseMovement} from '../ancients-rules/movement-profile.mjs';
import {BASE_RANGED_REACH} from '../ancients-rules/ranged-profile.mjs';

const key=c=>c.col+','+c.row;
const ownCell=c=>({col:c.col,row:c.row});
export function previewBaseMovementOnBoard({unitType,origin,occupiedCells=[]}={}){
  if(!Object.hasOwn(BASE_MOVEMENT_PROFILES,unitType))
    throw new TypeError('UNSUPPORTED_BASE_UNIT_TYPE');
  if(!origin||!inBounds(origin)||!Number.isSafeInteger(origin.col)||
     !Number.isSafeInteger(origin.row))
    throw new TypeError('INVALID_PROFILE_ORIGIN');
  if(!Array.isArray(occupiedCells)||occupiedCells.length>117||
      occupiedCells.some(c=>!c||!Number.isSafeInteger(c.col)||
        !Number.isSafeInteger(c.row)||!inBounds(c)))
    throw new TypeError('INVALID_PROFILE_OCCUPANTS');
  const blocked=new Set(occupiedCells.map(key));
  if(new Set(occupiedCells.map(key)).size!==occupiedCells.length)
    throw new TypeError('DUPLICATE_PROFILE_OCCUPANTS');
  const profile=BASE_MOVEMENT_PROFILES[unitType];
  const queue=[ownCell(origin)],visited=new Set([key(origin)]),reached=[];
  for(let i=0;i<queue.length;i++){
    const current=queue[i];
    const steps=current.steps??0;
    if(steps>=profile.maxSteps)continue;
    for(const next of neighbors(current)){
      if(visited.has(key(next))||blocked.has(key(next)))continue;
      visited.add(key(next));
      const count=steps+1;
      const assessed=assessBaseMovement({unitType,steps:count});
      const record=Object.freeze({...ownCell(next),steps:count,
        battle:assessed.battle,status:assessed.status});
      reached.push(record);
      queue.push(record);
    }
  }
  return Object.freeze({
    unitType,maxSteps:profile.maxSteps,
    battleAfterSteps:profile.battleAfterSteps,
    rangedReach:BASE_RANGED_REACH[unitType]??null,
    origin:Object.freeze(ownCell(origin)),
    reachable:Object.freeze(reached),
    status:'HYPOTHETICAL_GEOMETRIC_PREVIEW',
    movementAuthorized:false,attackAuthorized:false,canCommit:false,
    needsFullLegalityCheck:true
  });
}
