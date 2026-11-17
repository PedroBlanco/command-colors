/**
 * Read-only geometric illustration of Ancients BASE movement profiles.
 * Unlike a game adjudicator, this requires a user-picked HYPOTHETICAL unit
 * type: the synthetic board has no official troop-type provenance.
 * Obstacles are public occupied hexes; terrain, leaders, cards and scenario
 * modifiers are intentionally outside this preview. Nothing is authorized.
 */
import {neighbors, inBounds, distance} from '../hex-grid/hex.mjs';
import {assessAncientsRangedProfile} from '../ancients-rules/ranged-profile.mjs';
import {assessAncientsLineOfSight} from '../ancients-rules/line-of-sight.mjs';
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

/**
 * Read-only shooter/target preview. The synthetic match has NO canonical troop
 * type, terrain, leader or complete movement-step history. Hence:
 * - the chosen unitType is hypothetical;
 * - a moved unit has UNKNOWN moved steps, not zero;
 * - VISIBLE means only a corridor free of intervening public unit blockers in
 *   the ASSUMED clear-ground / no-leader scenario, NOT official line of sight.
 * All results are non-authorizing, and cannot be sent as a battle command.
 */
export function previewBaseRangedOnBoard({unitType,origin,actor,board,movedUnitIds=null,
  terrain=null}={}){
  if(!Object.hasOwn(BASE_MOVEMENT_PROFILES,unitType))
    throw new TypeError('UNSUPPORTED_BASE_UNIT_TYPE');
  if(!origin||!Number.isSafeInteger(origin.col)||
      !Number.isSafeInteger(origin.row)||!inBounds(origin)||
      !['A','B'].includes(actor)||!Array.isArray(board)||board.length>117)
    throw new TypeError('INVALID_RANGED_BOARD_REFERENCE');
  const unitIds=new Set(),positions=new Set();
  for(const unit of board){
    if(!unit||typeof unit.id!=='string'||
        !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(unit.id)||
        !['A','B'].includes(unit.side)||
        !Number.isSafeInteger(unit.col)||!Number.isSafeInteger(unit.row)||
        !inBounds(unit)||unitIds.has(unit.id)||positions.has(key(unit)))
      throw new TypeError('INVALID_RANGED_BOARD_REFERENCE');
    unitIds.add(unit.id);positions.add(key(unit));
  }
  const terrainIndex=new Map();
  if(terrain!==null){
    if(!Array.isArray(terrain)||terrain.length>117)
      throw new TypeError('INVALID_RANGED_TRAINING_TERRAIN');
    for(const tile of terrain){
      if(!tile||!Number.isSafeInteger(tile.col)||
         !Number.isSafeInteger(tile.row)||!inBounds(tile)||
         !['FOREST','HILL','BROKEN_GROUND'].includes(tile.kind)||
         terrainIndex.has(key(tile)))
        throw new TypeError('INVALID_RANGED_TRAINING_TERRAIN');
      terrainIndex.set(key(tile),{col:tile.col,row:tile.row,kind:tile.kind});
    }
  }
  const shooter=board.find(u=>key(u)===key(origin));
  if(!shooter||shooter.side!==actor)
    throw new TypeError('INVALID_RANGED_SHOOTER');
  if(movedUnitIds!==null&&(!Array.isArray(movedUnitIds)||
      movedUnitIds.length>117||movedUnitIds.some(id=>!unitIds.has(id))))
    throw new TypeError('INVALID_RANGED_MOVEMENT_LEDGER');
  const blockedStatus=movedUnitIds===null?'NO_MOVEMENT_LEDGER':
    movedUnitIds.includes(shooter.id)?'MOVEMENT_STEPS_UNKNOWN':null;
  const base={
    unitType,shooterId:shooter.id,
    status:blockedStatus??'REFERENCE_ONLY',
    assumedTerrain:terrain===null?'UNKNOWN':'SERVER_TRAINING_ONLY',leadersKnown:false,
    movementAuthorized:false,attackAuthorized:false,
    canCommit:false,needsFullLegalityCheck:true
  };
  if(blockedStatus)return Object.freeze({...base,targets:Object.freeze([])});
  const allPositions=board.map(ownCell);
  const targets=board.filter(u=>u.side!==actor).map(target=>{
    const range=distance(origin,target);
    const profile=assessAncientsRangedProfile({
      unitType,movedSteps:0,targetDistance:range
    });
    const los=profile.status==='CANDIDATE'
      ? assessAncientsLineOfSight({
          from:ownCell(origin),to:ownCell(target),units:allPositions,
          leaders:[],terrain:terrain===null?[]:[...terrainIndex.values()]
        })
      : null;
    const hasTrainingBlocker=los?.obstructions.some(c=>terrainIndex.has(key(c)))??false;
    return Object.freeze({
      id:target.id,col:target.col,row:target.row,distance:range,
      profileStatus:profile.status,profileReason:profile.reason,
      nominalDice:profile.status==='CANDIDATE'?profile.baseDice:null,
      visibleUnitCorridor:los===null?'NOT_EVALUATED':
        los.status==='BLOCKED'?(hasTrainingBlocker?
          'BLOCKED_BY_TRAINING_TERRAIN':'BLOCKED_BY_VISIBLE_UNITS'):
          'NO_VISIBLE_UNIT_OBSTRUCTION',
      obstructingHexes:Object.freeze(los?.obstructions.map(ownCell)??[]),
      attackAuthorized:false,lineOfSightAuthorized:false
    });
  });
  return Object.freeze({...base,targets:Object.freeze(targets)});
}
