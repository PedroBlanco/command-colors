/**
 * LAB-ANC: private, READ-ONLY one-hex synthetic movement preview.
 *
 * This composes the UNTRUSTED request-shape screen and the restricted board
 * simulator. Caller MUST independently authenticate the session and match
 * membership, verify the private CCWB replay and supply its trusted actor,
 * board, unit profiles and policy. This function NEVER authenticates,
 * authorizes, writes or emits game events, and has NO HTTP/SSE entry point.
 */
import {screenAncientsMovementCommitIntent} from './movement-commit-intent-screen.mjs';
import {reduceOneHexClearLab} from './clear-lab-movement-reducer.mjs';

const flags=Object.freeze({
  movementAuthorized:false,attackAuthorized:false,officialMovementAuthorized:false,
  stateChanged:false,needsFullLegalityCheck:true,canCommit:false,
  labSimulationOnly:true
});
const denied=(reason)=>Object.freeze({
  status:'BLOCKED',reason,simulatedBoard:null,moves:null,...flags
});

/**
 * Authenticated actor is NOT a field in the request. It must be obtained from
 * the same server-side authenticated snapshot as the verified section journal.
 * A good syntactic request does not establish session or movement authority.
 */
export function previewPrivateOneHexAncientsIntent({
  request,authenticatedActor,verifiedSectionState,serverContext,policy
}={}) {
  // Validate the request shape before even examining a private board.
  const checked=screenAncientsMovementCommitIntent(request);
  if(checked.status!=='INTENT_SHAPE_VALID')return denied('INVALID_MOVEMENT_INTENT');
  if(!['A','B'].includes(authenticatedActor))
    return denied('AUTHENTICATED_ACTOR_REQUIRED');
  if(checked.intent.kind!=='UNIT')return denied('NOT_IN_CLEAR_LAB_SCOPE');
  // A single-step synthetic preview cannot be used to bypass the limit of
  // the future authoritative engine; no implicit truncation of longer paths.
  if(checked.intent.path.length!==1)return denied('NOT_IN_CLEAR_LAB_SCOPE');

  const action={
    kind:'UNIT',id:checked.intent.pieceId,
    path:checked.intent.path.map(({col,row})=>({col,row}))
  };
  // Only the trusted server may supply the lab state/context/policy.
  // No token, client-provided actor or idempotency key enters the simulator.
  const result=reduceOneHexClearLab({
    state:verifiedSectionState,actor:authenticatedActor,
    expectedRevision:checked.intent.expectedRevision,
    actions:[action],serverContext,policy
  });
  if(result.status!=='LAB_REDUCTION_CANDIDATE')return denied(result.reason);
  // A simulated board is NOT a committed board and must remain internal.
  return Object.freeze({
    status:'PRIVATE_LAB_SIMULATION',reason:null,
    simulatedBoard:result.simulatedBoard,moves:result.moves,
    moveCount:result.moveCount,...flags
  });
}
