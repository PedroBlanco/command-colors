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

/**
 * Create a descriptor-only snapshot of an untrusted plain record.
 * Never check descriptors and then read source properties again: a Proxy's
 * get trap (or a mutation during validation) may yield different data.
 * Frozen results of this function are untrusted DATA, not authorized facts.
 */
function snapshotRecord(value,fields) {
  if(value===null||typeof value!=='object'||Array.isArray(value)||
     Object.getPrototypeOf(value)!==Object.prototype) return null;
  const keys=Reflect.ownKeys(value);
  if(keys.length!==fields.length||!fields.every(key=>keys.includes(key)))return null;
  const snapshot=Object.create(null);
  for(const key of fields) {
    const desc=Object.getOwnPropertyDescriptor(value,key);
    if(!desc||!Object.hasOwn(desc,'value')||!desc.enumerable)return null;
    snapshot[key]=desc.value;
  }
  return snapshot;
}
function snapshotPath(value) {
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)
    return null;
  const length=Object.getOwnPropertyDescriptor(value,'length')?.value;
  if(!Number.isSafeInteger(length)||length<1||length>32||
     Reflect.ownKeys(value).length!==length+1)return null;
  const path=[];
  for(let i=0;i<length;i++) {
    const entry=Object.getOwnPropertyDescriptor(value,String(i));
    if(!entry||!Object.hasOwn(entry,'value')||!entry.enumerable)return null;
    const cell=snapshotRecord(entry.value,LOCATION_FIELDS);
    if(!cell||!Number.isSafeInteger(cell.col)||!Number.isSafeInteger(cell.row)||
       !inBounds({col:cell.col,row:cell.row}))return null;
    path.push(Object.freeze({col:cell.col,row:cell.row}));
  }
  return Object.freeze(path);
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
    const data=snapshotRecord(request,REQUEST_FIELDS);
    if(!data||typeof data.sessionToken!=='string'||
       data.sessionToken.length<16||data.sessionToken.length>256||
       typeof data.idempotencyKey!=='string'||!KEY.test(data.idempotencyKey)||
       !Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<0||
       !['UNIT','LEADER'].includes(data.kind)||
       typeof data.pieceId!=='string'||!ID.test(data.pieceId)||
       data.pieceId==='__proto__')
      return blocked();
    const path=snapshotPath(data.path);
    if(!path)return blocked();
    const intent=Object.freeze({
      expectedRevision:data.expectedRevision,
      idempotencyKey:data.idempotencyKey,
      kind:data.kind,pieceId:data.pieceId,path
    });
    // The credential remains solely in the caller's request. This is not
    // a commit command and must never be sent to game_events.
    return Object.freeze({status:'INTENT_SHAPE_VALID',code:null,intent,...guard});
  } catch {
    // Accessor/proxy errors and hostile objects cannot become a command.
    return blocked();
  }
}
