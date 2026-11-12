/**
 * LAB-ANC / R-04–R-05: read-only normal movement of an individually ordered
 * leader (including detaching from an unmoved unit). This is a preliminary
 * screen, NEVER an authorization to move, escape, evade or alter a CCWB match.
 * Board and terrain MUST originate from a replay-verified server snapshot.
 */
import {distance, inBounds} from '../hex-grid/hex.mjs';

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SIDES = new Set(['A','B']);
const TERRAINS = new Set(['FOREST','HILL','BROKEN_GROUND']);
const key = ({col,row}) => col+','+row;
const validCell = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  Number.isSafeInteger(x.col) && Number.isSafeInteger(x.row) && inBounds(x);
const validId = x => typeof x === 'string' && ID.test(x) && x !== '__proto__';
const blocked = (reason,step=null) => Object.freeze({status:'BLOCKED',reason,step,
  movementAuthorized:false,attackAuthorized:false,stateChanged:false,needsFullLegalityCheck:true});

function boardIndex(units,leaders) {
  if (!Array.isArray(units)||!Array.isArray(leaders)||units.length+leaders.length>117)
    throw new TypeError('INVALID_LEADER_BOARD');
  const ids=new Set(), occupied=new Map(), leaderCells=new Map();
  for (const piece of units) {
    if (!piece || !validId(piece.id)||!SIDES.has(piece.side)||!validCell(piece)||
      ids.has(piece.id)||occupied.has(key(piece))) throw new TypeError('INVALID_LEADER_BOARD');
    ids.add(piece.id);occupied.set(key(piece),piece);
  }
  for (const piece of leaders) {
    if (!piece || !validId(piece.id)||!SIDES.has(piece.side)||!validCell(piece)||
      ids.has(piece.id)||leaderCells.has(key(piece))||
      (occupied.has(key(piece))&&occupied.get(key(piece)).side!==piece.side))
      throw new TypeError('INVALID_LEADER_BOARD');
    ids.add(piece.id);leaderCells.set(key(piece),piece);
  }
  return {occupied,leaderCells};
}

function terrainIndex(terrain) {
  if (!Array.isArray(terrain)||terrain.length>117)throw new TypeError('INVALID_LEADER_TERRAIN_MAP');
  const index=new Map();
  for(const tile of terrain) {
    if(!tile||!validCell(tile)||!TERRAINS.has(tile.kind)||index.has(key(tile)))
      throw new TypeError('INVALID_LEADER_TERRAIN_MAP');
    index.set(key(tile),tile.kind);
  }
  return index;
}

/** The supplied path excludes the leader's origin and includes each hex crossed.
 * A CANDIDATE is never a decision that the move is fully legal. */
export function precheckAncientsLeaderPath({
  units,leaders,leaderId,path,terrain
}={}) {
  const {occupied,leaderCells}=boardIndex(units,leaders);
  const terrainByCell=terrainIndex(terrain);
  if(!validId(leaderId)||!Array.isArray(path)||path.length<1||path.length>32||
    !path.every(validCell))throw new TypeError('INVALID_LEADER_PATH');
  const leader=leaders.find(x=>x.id===leaderId);
  if(!leader)throw new TypeError('UNKNOWN_MOVING_LEADER');
  if(path.length>3)return blocked('LEADER_RANGE_EXCEEDED',3);
  const fromAttached=occupied.get(key(leader))?.side===leader.side;
  const seen=new Set([key(leader)]);
  let last=leader;
  for(let i=0;i<path.length;i++){
    const destination=path[i], cellKey=key(destination);
    if(distance(last,destination)!==1)return blocked('NON_ADJACENT_HEX',i);
    if(seen.has(cellKey))return blocked('REPEATED_HEX',i);
    const unit=occupied.get(cellKey), otherLeader=leaderCells.get(cellKey);
    if(unit&&unit.side!==leader.side)return blocked('ENEMY_OCCUPIED_HEX',i);
    if(otherLeader&&otherLeader.side!==leader.side)return blocked('ENEMY_OCCUPIED_HEX',i);
    // An ordered leader may cross friendly units or leaders but may not
    // finish in a hex already occupied by another friendly leader.
    if(i===path.length-1&&otherLeader)return blocked('FRIENDLY_LEADER_AT_DESTINATION',i);
    const ground=terrainByCell.get(cellKey);
    if((ground==='FOREST'||ground==='BROKEN_GROUND')&&i!==path.length-1)
      return blocked('LEADER_MUST_STOP_ON_TERRAIN',i);
    seen.add(cellKey);last=destination;
  }
  const dest=path.at(-1),friendlyUnit=occupied.get(key(dest));
  return Object.freeze({
    status:'CANDIDATE',reason:null,step:null,
    leaderId,steps:path.length,
    detachesFromUnit:Boolean(fromAttached),
    attachesToUnit:Boolean(friendlyUnit&&friendlyUnit.side===leader.side),
    destination:{col:dest.col,row:dest.row},
    movementAuthorized:false,attackAuthorized:false,stateChanged:false,
    needsFullLegalityCheck:true
  });
}
