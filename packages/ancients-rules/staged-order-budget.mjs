/**
 * LAB-ANC: INTERNAL PRIVATE and READ-ONLY plan of how a hypothetical movement
 * sequence would affect staged orders. A carried/joined leader can make an
 * otherwise unused order unavailable; that order is NOT actually consumed.
 *
 * The caller must authenticate the session, replay-verify CCWB history and
 * supply trusted rules/context. This planner never grants movement authority,
 * changes the actual board, consumes a game order or writes to SQLite.
 */
import {projectStagedAncientsBoard} from './staged-board-projection.mjs';

export const STAGED_ORDER_BUDGET_KIND='PRIVATE_STAGED_ORDER_BUDGET_V1';

const flags=Object.freeze({
  movementAuthorized:false,officialMovementAuthorized:false,
  attackAuthorized:false,stateChanged:false,canCommit:false,
  needsFullLegalityCheck:true,labSimulationOnly:true
});
const deny=reason=>Object.freeze({
  status:'BLOCKED',kind:STAGED_ORDER_BUDGET_KIND,reason,
  projectedBoard:null,moves:null,orders:null,spentCount:0,
  lockedCount:0,availableCount:0,totalOrders:0,...flags
});
const key=(kind,id)=>kind+':'+id;

/**
 * Classify every staged order as USED by a direct hypothetical action,
 * LOCKED by a leader's attached/joined movement, or still AVAILABLE.
 * USED does not mean spent in a game: only the future server-authoritative
 * reducer, after full rule checks inside BEGIN IMMEDIATE, could do that.
 */
export function previewStagedAncientsOrderBudget({
  state,actor,expectedRevision,actions,serverContext
}={}){
  const projected=projectStagedAncientsBoard({
    state,actor,expectedRevision,actions,serverContext
  });
  if(projected.status!=='PRIVATE_BOARD_CANDIDATE')
    return deny(projected.reason??'MOVEMENT_PRECHECK_BLOCKED');

  const staged=state.orderSnapshot?.pieces;
  if(!Array.isArray(staged)||staged.length<1||staged.length>117)
    return deny('ORDER_BUDGET_INCONSISTENT');

  const orderKeys=new Set();
  for(const piece of staged){
    if(!piece||!['UNIT','LEADER'].includes(piece.kind)||
       typeof piece.id!=='string'||piece.side!==actor||
       orderKeys.has(key(piece.kind,piece.id)))
      return deny('ORDER_BUDGET_INCONSISTENT');
    orderKeys.add(key(piece.kind,piece.id));
  }

  const used=new Set(),locked=new Set();
  for(const move of projected.moves){
    const id=key(move.kind,move.id);
    if(!orderKeys.has(id)||used.has(id)||locked.has(id))
      return deny('ORDER_BUDGET_INCONSISTENT');
    used.add(id);
    if(move.kind==='UNIT'){
      // Moving with an attached leader (or joining a stationary leader)
      // makes that leader's separate order unusable for this same turn.
      for(const leader of [move.leaderCarried,move.attachedLeader]){
        if(leader!==null&&leader!==undefined){
          const leaderKey=key('LEADER',leader);
          if(orderKeys.has(leaderKey))locked.add(leaderKey);
        }
      }
    }else if(move.kind==='LEADER'){
      // An independently ordered leader joining a stationary unit
      // prevents that unit using a separate order later this turn.
      if(move.joinedUnit!==null&&move.joinedUnit!==undefined){
        const unitKey=key('UNIT',move.joinedUnit);
        if(orderKeys.has(unitKey))locked.add(unitKey);
      }
    }
  }

  if([...used].some(id=>locked.has(id)))
    return deny('ORDER_BUDGET_INCONSISTENT');
  const orders=Object.freeze(staged.map(piece=>Object.freeze({
    kind:piece.kind,id:piece.id,
    status:used.has(key(piece.kind,piece.id))?'USED':
      locked.has(key(piece.kind,piece.id))?'LOCKED':'AVAILABLE'
  })));
  const availableCount=orders.filter(x=>x.status==='AVAILABLE').length,
    lockedCount=orders.filter(x=>x.status==='LOCKED').length;
  if(orders.length!==used.size+lockedCount+availableCount)
    return deny('ORDER_BUDGET_INCONSISTENT');

  return Object.freeze({
    status:'PRIVATE_ORDER_BUDGET_CANDIDATE',
    kind:STAGED_ORDER_BUDGET_KIND,reason:null,
    baseRevision:expectedRevision,
    projectedBoard:projected.projectedBoard,
    moves:projected.moves,orders,
    spentCount:used.size,lockedCount,availableCount,totalOrders:orders.length,
    ...flags
  });
}
