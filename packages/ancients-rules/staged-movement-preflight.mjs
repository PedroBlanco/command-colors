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
import {precheckAncientsLeaderPath} from './leader-movement-preflight.mjs';
import {precheckAncientsMovementSequence} from './leader-unit-sequence-preflight.mjs';
import {buildAncientsCandidateJournal} from './movement-candidate-journal.mjs';
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
 * All staged previews use the SAME complete server-side order ledger check.
 * A requested piece can be individually correct while a sibling entry was
 * changed or duplicated. No CANDIDATE may escape such an inconsistent ledger.
 * This is defense in depth: the caller still MUST replay-verify its CCWB row.
 */
function consistentStagedOrderLedger(state,actor) {
  const snapshot=state.orderSnapshot;
  if(!record(snapshot)||!record(snapshot.sectorCells)||
     JSON.stringify(snapshot.sectorCells)!==JSON.stringify(state.sectorCells)||
     !Array.isArray(snapshot.pieces)||snapshot.pieces.length>117)
    return false;
  const seen=new Set();
  return snapshot.pieces.every(piece=>{
    if(!record(piece)||Reflect.ownKeys(piece).length!==5||
       !['id','kind','side','col','row'].every(k=>own(piece,k))||
       typeof piece.id!=='string'||!ID.test(piece.id)||piece.id==='__proto__'||
       !['UNIT','LEADER'].includes(piece.kind)||piece.side!==actor||
       !Number.isSafeInteger(piece.col)||!Number.isSafeInteger(piece.row)||
       seen.has(piece.id))return false;
    seen.add(piece.id);
    const collection=piece.kind==='UNIT'?state.board.units:state.board.leaders;
    return collection.some(current=>current.id===piece.id&&current.side===piece.side&&
      current.col===piece.col&&current.row===piece.row);
  });
}

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
  if(!consistentStagedOrderLedger(state,actor))
    return blocked('ORDER_LEDGER_MISMATCH');
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


/**
 * LAB-ANC R-04: read-only preview for a separately ordered leader. Unlike
 * normal units, a leader can pass through a friendly unit or leader, but
 * cannot finish on another leader; the base-path check is deliberately separate.
 *
 * The state must first be replay-verified by the trusted CCWB caller.
 * Only the server provides the terrain map. No database or HTTP mutation.
 */
export function precheckStagedAncientsLeaderMovement({
  state,actor,expectedRevision,leaderId,path,serverContext
}={}) {
  assertSectionHistoryLab(state);
  if(!SIDES.has(actor))return blocked('FORBIDDEN');
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)
    throw new TypeError('INVALID_STAGED_LEADER_REVISION');
  if(state.revision!==expectedRevision)return blocked('STALE_REVISION');
  if(state.turn!==actor)return blocked('NOT_ACTING_PLAYER');
  if(state.phase!=='LAB_RESOLUTION_PENDING'||!record(state.orderSnapshot)||
    state.orderSnapshot.side!==actor||state.orderSnapshot.revision!==state.revision||
    !Array.isArray(state.orderSnapshot.pieces))
    return blocked('ORDERS_NOT_STAGED');
  // Do not distinguish foreign, missing and unordered leader identifiers.
  if(typeof leaderId!=='string'||!ID.test(leaderId)||leaderId==='__proto__'||
    !state.orderSnapshot.pieces.some(piece=>record(piece)&&
      piece.id===leaderId&&piece.kind==='LEADER'&&piece.side===actor&&
      state.board.leaders.some(current=>current.id===piece.id&&
        current.side===piece.side&&current.col===piece.col&&current.row===piece.row)))
    return blocked('LEADER_NOT_ORDERED');
  if(!consistentStagedOrderLedger(state,actor))
    return blocked('ORDER_LEDGER_MISMATCH');
  if(!record(serverContext)||!Array.isArray(serverContext.terrain))
    throw new TypeError('INVALID_STAGED_LEADER_CONTEXT');
  const preview=precheckAncientsLeaderPath({
    units:structuredClone(state.board.units),
    leaders:structuredClone(state.board.leaders),
    leaderId,path:structuredClone(path),terrain:structuredClone(serverContext.terrain)
  });
  return preview;
}


/**
 * LAB-ANC: simulate a hypothetical ordered movement sequence on a copy.
 * This is NOT a journal, cannot spend orders and cannot authorize movement.
 * The caller must first verify its private CCWB replay and authenticate actor.
 */
export function precheckStagedAncientsMovementSequence({
  state,actor,expectedRevision,actions,serverContext
}={}){
  assertSectionHistoryLab(state);
  if(!SIDES.has(actor))return blocked('FORBIDDEN');
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)
    throw new TypeError('INVALID_STAGED_SEQUENCE_REVISION');
  if(state.revision!==expectedRevision)return blocked('STALE_REVISION');
  if(state.turn!==actor)return blocked('NOT_ACTING_PLAYER');
  const snapshot=state.orderSnapshot;
  if(state.phase!=='LAB_RESOLUTION_PENDING'||!record(snapshot)||
     snapshot.side!==actor||snapshot.revision!==state.revision||
     !Array.isArray(snapshot.pieces))
    return blocked('ORDERS_NOT_STAGED');
  // Do not extrapolate from or trust an incomplete/forged set of orders.
  // These rows must also be authenticated against the event replay by caller.
  if(!consistentStagedOrderLedger(state,actor))
    return blocked('ORDER_LEDGER_MISMATCH');
  // An otherwise validly shaped hypothetical route cannot consume more
  // moves than the authenticated order ledger contains. Fail closed rather
  // than let the lower-level sequence reject with a configuration error.
  if(Array.isArray(actions)&&actions.length>snapshot.pieces.length)
    return blocked('PIECE_NOT_ORDERED');
  // Context is supplied by the server, never copied from a browser request.
  const roster=trustedRoster(state,serverContext);
  const orderedUnitIds=snapshot.pieces.filter(p=>p.kind==='UNIT').map(p=>p.id);
  const orderedLeaderIds=snapshot.pieces.filter(p=>p.kind==='LEADER').map(p=>p.id);
  return precheckAncientsMovementSequence({
    ...roster,actor,orderedUnitIds,orderedLeaderIds,
    actions:structuredClone(actions)
  });
}


/**
 * LAB-ANC: evidence for a hypothetical sequence, bound to the replay-verified
 * section orders and to a trusted server context. This never executes moves.
 * matchId comes from the authenticated CCWB row, never from client data.
 */
export function precheckStagedAncientsMovementEvidence({
  matchId,state,actor,expectedRevision,actions,serverContext
}={}) {
  const screened=precheckStagedAncientsMovementSequence({
    state,actor,expectedRevision,actions,serverContext
  });
  if(screened.status!=='CANDIDATE_SEQUENCE')
    return Object.freeze({
      status:'BLOCKED',reason:screened.reason,step:screened.step??null,
      journal:null,movementAuthorized:false,attackAuthorized:false,
      stateChanged:false,needsFullLegalityCheck:true
    });
  const roster=trustedRoster(state,serverContext);
  const orderedUnitIds=state.orderSnapshot.pieces
    .filter(piece=>piece.kind==='UNIT').map(piece=>piece.id);
  const orderedLeaderIds=state.orderSnapshot.pieces
    .filter(piece=>piece.kind==='LEADER').map(piece=>piece.id);
  return buildAncientsCandidateJournal({
    matchId,actor,baseRevision:state.revision,...roster,
    orderedUnitIds,orderedLeaderIds,actions:structuredClone(actions)
  });
}
