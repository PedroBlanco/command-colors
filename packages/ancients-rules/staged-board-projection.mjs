/**
 * LAB-ANC: deterministic public-only projection of a hypothetical ordered
 * unit/leader sequence. INTERNAL READ-ONLY. Caller must authenticate session,
 * verify CCWB replay and provide server-owned board, rules and orders.
 * CANDIDATE_SEQUENCE is NOT official legality or permission to commit.
 */
import {inBounds} from '../hex-grid/hex.mjs';
import {precheckStagedAncientsMovementSequence}
  from './staged-movement-preflight.mjs';

export const STAGED_BOARD_PROJECTION_KIND='PRIVATE_STAGED_BOARD_PREVIEW_V1';
const flags=Object.freeze({
  movementAuthorized:false,officialMovementAuthorized:false,
  attackAuthorized:false,stateChanged:false,canCommit:false,
  needsFullLegalityCheck:true,labSimulationOnly:true
});
const denied=reason=>Object.freeze({
  status:'BLOCKED',reason,projectedBoard:null,moves:null,moveCount:0,...flags
});
const point=x=>({col:x.col,row:x.row});
const same=(a,b)=>a.col===b.col&&a.row===b.row;
const publicPiece=x=>({id:x.id,side:x.side,col:x.col,row:x.row});
const freeze=x=>{
  if(x!==null&&typeof x==='object'){
    for(const v of Object.values(x))freeze(v);
    Object.freeze(x);
  }
  return x;
};
function consistentBoard(board){
  if(!Array.isArray(board.units)||!Array.isArray(board.leaders)||
     board.units.length+board.leaders.length>117)return false;
  const ids=new Set(),units=new Map(),leaders=new Set();
  for(const x of board.units){
    const key=x.col+','+x.row;
    if(typeof x.id!=='string'||!['A','B'].includes(x.side)||
       !inBounds(x)||ids.has(x.id)||units.has(key))return false;
    ids.add(x.id);units.set(key,x.side);
  }
  for(const x of board.leaders){
    const key=x.col+','+x.row;
    if(typeof x.id!=='string'||!['A','B'].includes(x.side)||
       !inBounds(x)||ids.has(x.id)||leaders.has(key)||
       units.has(key)&&units.get(key)!==x.side)return false;
    ids.add(x.id);leaders.add(key);
  }
  return true;
}
/**
 * Recompute each step on a freshly projected board rather than adopting any
 * prior preflight board. A failure exposes no partial board or move list.
 * Only public id/side/position fields are ever copied into the result.
 */
export function projectStagedAncientsBoard({
  state,actor,expectedRevision,actions,serverContext
}={}){
  const check=precheckStagedAncientsMovementSequence({
    state,actor,expectedRevision,actions,serverContext
  });
  if(check.status!=='CANDIDATE_SEQUENCE')
    return denied(check.reason??'MOVEMENT_PRECHECK_BLOCKED');
  const board={units:state.board.units.map(publicPiece),
    leaders:state.board.leaders.map(publicPiece)};
  if(!consistentBoard(board)||!Array.isArray(check.steps)||
     check.steps.length<1||check.steps.length>117)
    return denied('PROJECTION_INCONSISTENT');
  const moves=[];
  for(const step of check.steps){
    const piece=step.kind==='UNIT'?board.units.find(x=>x.id===step.id):
      step.kind==='LEADER'?board.leaders.find(x=>x.id===step.id):null;
    if(!piece||piece.side!==actor||!same(piece,step.from)||
       !inBounds(step.to)||same(step.from,step.to))
      return denied('PROJECTION_POSITION_DRIFT');
    const from=point(piece),to=point(step.to);
    if(step.kind==='UNIT'){
      const unitAtDestination=board.units.find(x=>same(x,to));
      const leaderAtOrigin=board.leaders.find(x=>same(x,from));
      const leaderAtDestination=board.leaders.find(x=>same(x,to));
      const carried=leaderAtOrigin?.id??null;
      const attached=leaderAtDestination?.id??carried;
      if(unitAtDestination||leaderAtOrigin&&leaderAtOrigin.side!==actor||
         leaderAtDestination&&leaderAtDestination.side!==actor||
         leaderAtOrigin&&leaderAtDestination||
         step.leaderCarried!==carried||step.attachedLeader!==attached)
        return denied('PROJECTION_POSITION_DRIFT');
      piece.col=to.col;piece.row=to.row;
      if(leaderAtOrigin){leaderAtOrigin.col=to.col;leaderAtOrigin.row=to.row;}
      moves.push({kind:'UNIT',id:piece.id,from,to,
        leaderCarried:carried,attachedLeader:attached});
    }else{
      const originUnit=board.units.find(x=>same(x,from));
      const destUnit=board.units.find(x=>same(x,to));
      const destLeader=board.leaders.find(x=>same(x,to));
      const detached=originUnit?.id??null,joined=destUnit?.id??null;
      if(destLeader||originUnit&&originUnit.side!==actor||
         destUnit&&destUnit.side!==actor||
         step.detachedFromUnit!==detached||step.joinedUnit!==joined)
        return denied('PROJECTION_POSITION_DRIFT');
      piece.col=to.col;piece.row=to.row;
      moves.push({kind:'LEADER',id:piece.id,from,to,
        detachedFromUnit:detached,joinedUnit:joined});
    }
    if(!consistentBoard(board))return denied('PROJECTION_INCONSISTENT');
  }
  return freeze({
    status:'PRIVATE_BOARD_CANDIDATE',kind:STAGED_BOARD_PROJECTION_KIND,
    reason:null,projectedBoard:board,moves,moveCount:moves.length,...flags
  });
}
