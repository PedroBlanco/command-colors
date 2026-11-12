/**
 * Ancients R-04/R-05: READ-ONLY normal movement screen tied to the verified
 * private section-orders journal. This does NOT authorize or commit a move.
 *
 * The authoritative caller must first replay-verify its CCWB row. The unit
 * profile and terrain MUST originate from trusted server scenario metadata,
 * never the browser's request. No HTTP endpoint is provided.
 */
import {assertSectionHistoryLab} from './section-history-journal.mjs';
import {precheckAncientsMovementPath} from './movement-path-precheck.mjs';
import {BASE_MOVEMENT_PROFILES} from './movement-profile.mjs';

const SIDES=new Set(['A','B']);
const ID=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const record=o=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&
  Object.getPrototypeOf(o)===Object.prototype;
const blocked=reason=>Object.freeze({
  status:'BLOCKED',reason,movementAuthorized:false,attackAuthorized:false,
  stateChanged:false,needsFullLegalityCheck:true
});

/**
 * For convenience the context maps every server-known unit ID to an official
 * profile. No defaults or guessed unit types are permitted.
 */
function trustedRoster(state,serverContext){
  if(!record(serverContext)||!record(serverContext.unitTypes)||
     !Array.isArray(serverContext.terrain))
    throw new TypeError('INVALID_STAGED_MOVEMENT_CONTEXT');
  const board=state.board;
  const names=Object.keys(serverContext.unitTypes);
  if(names.length!==board.units.length||
     !board.units.every(unit=>own(serverContext.unitTypes,unit.id) &&
       typeof serverContext.unitTypes[unit.id]==='string' &&
       own(BASE_MOVEMENT_PROFILES,serverContext.unitTypes[unit.id])))
    throw new TypeError('INVALID_STAGED_MOVEMENT_CONTEXT');
  return {units:board.units.map(unit=>({
    id:unit.id,side:unit.side,col:unit.col,row:unit.row,
    type:serverContext.unitTypes[unit.id]
  })),leaders:structuredClone(board.leaders),terrain:structuredClone(serverContext.terrain)};
}

export function precheckStagedAncientsMovement({
  state,actor,expectedRevision,unitId,path,serverContext
}={}){
  assertSectionHistoryLab(state);
  if(!SIDES.has(actor))return blocked('FORBIDDEN');
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)
    throw new TypeError('INVALID_STAGED_MOVEMENT_REVISION');
  if(state.revision!==expectedRevision)return blocked('STALE_REVISION');
  if(state.turn!==actor)return blocked('NOT_ACTING_PLAYER');
  if(state.phase!=='LAB_RESOLUTION_PENDING'||!record(state.orderSnapshot)||
     state.orderSnapshot.side!==actor||state.orderSnapshot.revision!==state.revision||
     !Array.isArray(state.orderSnapshot.pieces))
    return blocked('ORDERS_NOT_STAGED');
  // Do not distinguish enemy, nonexistent or unordered unit identities.
  if(typeof unitId!=='string'||!ID.test(unitId)||
     !state.orderSnapshot.pieces.some(x=>record(x)&&x.id===unitId&&
       x.kind==='UNIT'&&x.side===actor&&state.board.units.some(y=>
         y.id===x.id&&y.side===x.side&&y.col===x.col&&y.row===x.row)))
    return blocked('UNIT_NOT_ORDERED');
  // Force trusted data to exist and to cover all units before any candidate.
  const roster=trustedRoster(state,serverContext);
  const screen=precheckAncientsMovementPath({
    ...roster,unitId,path:structuredClone(path)
  });
  return Object.freeze({
    ...screen,
    movementAuthorized:false,attackAuthorized:false,stateChanged:false,
    needsFullLegalityCheck:true
  });
}
