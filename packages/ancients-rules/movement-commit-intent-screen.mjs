/**
 * LAB-ANC / issue #97: input-shape screen for a FUTURE authoritative movement
 * command. This module does not authenticate, read a match, apply rules,
 * authorize a move, or persist any state. Do not expose it as an HTTP action.
 *
 * A result called INTENT_SHAPE_VALID is only a parsed UNTRUSTED REQUEST.
 * The eventual reducer must independently authenticate/revalidate the whole
 * match in its SQLite write transaction and must not trust this result alone.
 */
import {inBounds} from '../hex-grid/hex.mjs';

const ID=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const KEY=/^[A-Za-z0-9_-]{8,80}$/;
const REQUEST_FIELDS=Object.freeze([
  'sessionToken','expectedRevision','idempotencyKey','kind','pieceId','path'
]);
const LOCATION_FIELDS=Object.freeze(['col','row']);
const guard=Object.freeze({
  movementAuthorized:false,attackAuthorized:false,
  stateChanged:false,needsFullLegalityCheck:true
});
const blocked=()=>Object.freeze({
  status:'BLOCKED',code:'INVALID_MOVEMENT_INTENT',intent:null,...guard
});

function exactDataRecord(value,fields) {
  if(value===null||typeof value!=='object'||Array.isArray(value)||
     Object.getPrototypeOf(value)!==Object.prototype) return false;
  const keys=Reflect.ownKeys(value);
  return keys.length===fields.length&&fields.every(key=>{
    const desc=Object.getOwnPropertyDescriptor(value,key);
    return desc!==undefined&&Object.hasOwn(desc,'value')&&desc.enumerable;
  });
}
function exactPath(value) {
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||
     value.length<1||value.length>32||
     Reflect.ownKeys(value).length!==value.length+1) return false;
  for(let i=0;i<value.length;i++) {
    const entry=Object.getOwnPropertyDescriptor(value,String(i));
    if(!entry||!Object.hasOwn(entry,'value')||!entry.enumerable||
       !exactDataRecord(entry.value,LOCATION_FIELDS)) return false;
    const col=entry.value.col,row=entry.value.row;
    if(!Number.isSafeInteger(col)||!Number.isSafeInteger(row)||
       !inBounds({col,row})) return false;
  }
  return true;
}

/**
 * Scope: strict JSON-equivalent envelope only; not legality, order spending,
 * user authentication or the existence of a piece. Caller must retain and
 * validate sessionToken separately: it is deliberately absent from result.
 *
 * No client-supplied actor, matchId, board, terrain, card, contextDigest,
 * journal or authoritative outcome is accepted.
 */
export function screenAncientsMovementCommitIntent(request) {
  try {
    if(!exactDataRecord(request,REQUEST_FIELDS)||
       typeof request.sessionToken!=='string'||
       request.sessionToken.length<16||request.sessionToken.length>256||
       typeof request.idempotencyKey!=='string'||
       !KEY.test(request.idempotencyKey)||
       !Number.isSafeInteger(request.expectedRevision)||
       request.expectedRevision<0||
       !['UNIT','LEADER'].includes(request.kind)||
       typeof request.pieceId!=='string'||!ID.test(request.pieceId)||
       request.pieceId==='__proto__'||!exactPath(request.path))
      return blocked();

    const path=Object.freeze(request.path.map(({col,row})=>Object.freeze({col,row})));
    const intent=Object.freeze({
      expectedRevision:request.expectedRevision,
      idempotencyKey:request.idempotencyKey,
      kind:request.kind,pieceId:request.pieceId,path
    });
    // The credential remains solely in the caller's request. This is not
    // a commit command and must never be sent to game_events.
    return Object.freeze({status:'INTENT_SHAPE_VALID',code:null,intent,...guard});
  } catch {
    // Accessor/proxy errors and hostile objects cannot become a command.
    return blocked();
  }
}
