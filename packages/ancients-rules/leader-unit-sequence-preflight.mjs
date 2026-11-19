/**
 * LAB-ANC: read-only, hypothetical movement sequencing for ordinary Section
 * orders. Replays a candidate sequence on a LOCAL COPY of a trusted board.
 * This is NOT the game move reducer, not a journal and not an authorization.
 *
 * In particular, a leader carried with a moved unit cannot later detach,
 * while a unit joined by an independently moving leader cannot move later.
 * Neither action spends real orders or persists anything in CCWB/SQLite.
 */
import {inBounds} from '../hex-grid/hex.mjs';
import {BASE_MOVEMENT_PROFILES} from './movement-profile.mjs';
import {precheckAncientsMovementPath} from './movement-path-precheck.mjs';
import {precheckAncientsLeaderPath} from './leader-movement-preflight.mjs';

const ID=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const record=o=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&
  (Object.getPrototypeOf(o)===Object.prototype||Object.getPrototypeOf(o)===null);
const validId=id=>typeof id==='string'&&ID.test(id)&&id!=='__proto__';
const validCell=cell=>record(cell)&&Object.keys(cell).length===2&&
  Number.isSafeInteger(cell.col)&&Number.isSafeInteger(cell.row)&&inBounds(cell);
const cellKey=x=>x.col+','+x.row;
const blocked=(reason,step=null)=>Object.freeze({
  status:'BLOCKED',reason,step,
  movementAuthorized:false,attackAuthorized:false,stateChanged:false,
  needsFullLegalityCheck:true
});
const invalid=()=>{throw new TypeError('INVALID_SEQUENCE_CONTEXT')};
const validOrder=(list,collection,actor)=>Array.isArray(list)&&list.length<=117&&
  new Set(list).size===list.length&&list.every(id=>validId(id)&&
    collection.some(piece=>piece.id===id&&piece.side===actor));

function assertContext({units,leaders,actor,orderedUnitIds,orderedLeaderIds,actions,terrain}) {
  if(!['A','B'].includes(actor)||!Array.isArray(units)||!Array.isArray(leaders)||
     units.length+leaders.length>117||
     !units.every(u=>record(u)&&validId(u.id)&&['A','B'].includes(u.side)&&
       Number.isSafeInteger(u.col)&&Number.isSafeInteger(u.row)&&inBounds(u)&&
       typeof u.type==='string'&&own(BASE_MOVEMENT_PROFILES,u.type))||
     !leaders.every(l=>record(l)&&validId(l.id)&&['A','B'].includes(l.side)&&
       Number.isSafeInteger(l.col)&&Number.isSafeInteger(l.row)&&inBounds(l)))
    invalid();
  const pieces=[...units,...leaders],ids=pieces.map(x=>x.id);
  if(new Set(ids).size!==ids.length||
     !validOrder(orderedUnitIds,units,actor)||
     !validOrder(orderedLeaderIds,leaders,actor)||
     !Array.isArray(actions)||actions.length<1||actions.length>117||
     actions.length>orderedUnitIds.length+orderedLeaderIds.length||
     !actions.every(a=>record(a)&&Object.keys(a).length===3&&
       ['kind','id','path'].every(k=>own(a,k))&&
       ['UNIT','LEADER'].includes(a.kind)&&validId(a.id)&&
       Array.isArray(a.path)&&a.path.length>=1&&a.path.length<=32&&a.path.every(validCell))||
     !Array.isArray(terrain))invalid();
  // The geometry modules further reject occupied/invalid boards and terrain.
}

/** Ordered identities are from a verified server journal, never a browser.
 * actions is a hypothetical move order, not an executable game command. */
export function precheckAncientsMovementSequence({
  units,leaders,actor,orderedUnitIds,orderedLeaderIds,actions,terrain
}={}) {
  assertContext({units,leaders,actor,orderedUnitIds,orderedLeaderIds,actions,terrain});
  const boardUnits=structuredClone(units),boardLeaders=structuredClone(leaders),
        movedUnits=new Set(),movedLeaders=new Set(),joinedUnitIds=new Set(),
        steps=[];
  const unitOrders=new Set(orderedUnitIds),leaderOrders=new Set(orderedLeaderIds);
  for(let index=0;index<actions.length;index++){
    const {kind,id,path}=actions[index];
    const allowed=kind==='UNIT'?unitOrders:leaderOrders;
    if(!allowed.has(id))return blocked('PIECE_NOT_ORDERED',index);
    const pieces=kind==='UNIT'?boardUnits:boardLeaders;
    const piece=pieces.find(item=>item.id===id);
    if(!piece||piece.side!==actor)return blocked('PIECE_NOT_ORDERED',index);
    const from={col:piece.col,row:piece.row};
    const destination=path.at(-1);
    if(kind==='UNIT'){
      if(movedUnits.has(id))return blocked('UNIT_ALREADY_MOVED',index);
      if(joinedUnitIds.has(id))return blocked('UNIT_LOCKED_AFTER_LEADER_JOIN',index);
      const accompanying=boardLeaders.find(l=>l.side===actor&&
        l.col===piece.col&&l.row===piece.row);
      // Normal unit movement can carry an already-attached leader at no
      // extra order cost. An individually moved leader cannot move twice.
      if(accompanying&&movedLeaders.has(accompanying.id))
        return blocked('LEADER_ALREADY_MOVED',index);
      const screened=precheckAncientsMovementPath({
        units:boardUnits,leaders:boardLeaders,unitId:id,path,terrain
      });
      if(screened.status!=='CANDIDATE')
        return blocked(screened.reason??'MOVEMENT_REQUIRES_RULE_EXCEPTION',index);
      const stationaryLeader=boardLeaders.find(l=>l.side===actor&&
        l.col===destination.col&&l.row===destination.row);
      piece.col=destination.col;piece.row=destination.row;
      if(accompanying) {
        accompanying.col=destination.col;accompanying.row=destination.row;
        movedLeaders.add(accompanying.id);
      }
      if(stationaryLeader&&!accompanying)movedLeaders.add(stationaryLeader.id);
      movedUnits.add(id);
      steps.push(Object.freeze({kind,id,from,to:{...destination},
        leaderCarried:accompanying?.id??null,
        attachedLeader:stationaryLeader?.id??accompanying?.id??null}));
    } else {
      if(movedLeaders.has(id))return blocked('LEADER_ALREADY_MOVED',index);
      // If this leader is still attached after the unit moves, it cannot
      // detach in the same turn, including if it was ordered separately.
      const host=boardUnits.find(u=>u.side===actor&&u.col===piece.col&&u.row===piece.row);
      if(host&&movedUnits.has(host.id))
        return blocked('ATTACHED_UNIT_ALREADY_MOVED',index);
      const screened=precheckAncientsLeaderPath({
        units:boardUnits,leaders:boardLeaders,leaderId:id,path,terrain
      });
      if(screened.status!=='CANDIDATE')
        return blocked(screened.reason??'MOVEMENT_REQUIRES_RULE_EXCEPTION',index);
      const targetUnit=boardUnits.find(u=>u.side===actor&&
        u.col===destination.col&&u.row===destination.row);
      piece.col=destination.col;piece.row=destination.row;
      movedLeaders.add(id);
      if(targetUnit)joinedUnitIds.add(targetUnit.id);
      steps.push(Object.freeze({kind,id,from,to:{...destination},
        detachedFromUnit:host?.id??null,joinedUnit:targetUnit?.id??null}));
    }
  }
  return Object.freeze({
    status:'CANDIDATE_SEQUENCE',reason:null,
    steps:Object.freeze(steps),reviewedMoves:steps.length,
    unitsWithMovementLockedByLeader:Object.freeze([...joinedUnitIds].sort()),
    movementAuthorized:false,attackAuthorized:false,stateChanged:false,
    needsFullLegalityCheck:true
  });
}
