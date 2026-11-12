/**
 * LAB-ANC: a single durable PRIVATE movement proposal, not an executed move.
 * Independent from game_events and game_revision. The server must revalidate
 * session, orders, and movement preview under a SQLite writer transaction
 * before storing. A draft NEVER grants game authority.
 */
import {createHash} from 'node:crypto';
import {inBounds} from '../hex-grid/hex.mjs';

export const MOVEMENT_DRAFT_KIND='ANCIENTS_PRIVATE_MOVEMENT_DRAFT_V1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const KEY=/^[a-zA-Z0-9_-]{8,80}$/;
const ID=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  Object.getPrototypeOf(x)===Object.prototype;
const exactKeys=(x,keys)=>record(x)&&Object.keys(x).length===keys.length&&
  keys.every(k=>own(x,k));
const validRevision=n=>Number.isSafeInteger(n)&&n>=0;
const validActions=xs=>Array.isArray(xs)&&xs.length>=1&&xs.length<=117&&xs.every(a=>
  exactKeys(a,['kind','id','path'])&&['UNIT','LEADER'].includes(a.kind)&&
  typeof a.id==='string'&&ID.test(a.id)&&a.id!=='__proto__'&&
  Array.isArray(a.path)&&a.path.length>=1&&a.path.length<=32&&
  a.path.every(c=>exactKeys(c,['col','row'])&&inBounds(c)));
// Include the draft revision in the checksum: changing the CAS version
// alone must be detectable, not merely a change to moves or ownership.
// Encode action fields in a fixed order so equivalent JSON key order yields
// the same idempotency fingerprint.
const signature=({matchId,actor,gameRevision,draftRevision,idempotencyKey,actions})=>
  createHash('sha256').update(JSON.stringify([
    MOVEMENT_DRAFT_KIND,matchId,actor,gameRevision,draftRevision,idempotencyKey,
    actions.map(a=>[a.kind,a.id,a.path.map(c=>[c.col,c.row])])
  ])).digest('hex');
const denied=code=>Object.freeze({ok:false,code});

export function assertMovementDraft(draft,matchId) {
  if(!exactKeys(draft,['kind','matchId','actor','gameRevision','draftRevision',
    'idempotencyKey','actions','signature'])||
    draft.kind!==MOVEMENT_DRAFT_KIND||draft.matchId!==matchId||
    !UUID.test(matchId)||!['A','B'].includes(draft.actor)||
    !validRevision(draft.gameRevision)||!validRevision(draft.draftRevision)||
    draft.draftRevision<1||!KEY.test(draft.idempotencyKey)||
    !validActions(draft.actions)||
    typeof draft.signature!=='string'||draft.signature!==signature(draft))
    throw new Error('SECTION_LAB_MOVEMENT_DRAFT_CORRUPT');
  return true;
}

/**
 * Pure draft transition. The caller is responsible for validating a fresh
 * CANDIDATE_SEQUENCE in the same SQLite write transaction before invoking it.
 * No movement reducer, game counter, game event or public projection.
 */
export function proposeMovementDraft({previous=null,matchId,actor,gameRevision,
  expectedDraftRevision,idempotencyKey,actions}={}) {
  if(!UUID.test(String(matchId??''))||!['A','B'].includes(actor)||
    !validRevision(gameRevision)||!validRevision(expectedDraftRevision)||
    typeof idempotencyKey!=='string'||!KEY.test(idempotencyKey)||
    !validActions(actions))
    throw new TypeError('INVALID_MOVEMENT_DRAFT_REQUEST');
  if(previous!==null)assertMovementDraft(previous,matchId);
  const normalized=structuredClone(actions);
  const req={matchId,actor,gameRevision,idempotencyKey,actions:normalized};
  // A draft tied to an older game revision or another player's turn
  // does not carry authority forward. Do not expose it to the new actor.
  const live=previous!==null&&previous.gameRevision===gameRevision&&
    previous.actor===actor ? previous : null;
  if(live && live.idempotencyKey===idempotencyKey) {
    const fingerprint=signature({...req,draftRevision:live.draftRevision});
    return live.signature===fingerprint
      ? Object.freeze({ok:true,code:'ALREADY_APPLIED',draft:structuredClone(live)})
      : denied('IDEMPOTENCY_KEY_REUSED');
  }
  const revision=live?.draftRevision??0;
  if(expectedDraftRevision!==revision)return denied('STALE_DRAFT_REVISION');
  if(revision===Number.MAX_SAFE_INTEGER)return denied('DRAFT_REVISION_EXHAUSTED');
  const draftRevision=revision+1;
  const draft={
    kind:MOVEMENT_DRAFT_KIND,matchId,actor,gameRevision,draftRevision,
    idempotencyKey,actions:normalized,
    signature:signature({...req,draftRevision})
  };
  return Object.freeze({ok:true,code:'DRAFT_STORED',draft:Object.freeze(draft)});
}

/** Only the actor who saved the current-revision draft can inspect it.
 * This is an INTERNAL private view, never a public HTTP/SSE projection. */
export function projectMovementDraft({draft,matchId,actor,gameRevision}={}) {
  if(!UUID.test(String(matchId??''))||!['A','B'].includes(actor)||
     !validRevision(gameRevision))throw new TypeError('INVALID_MOVEMENT_DRAFT_SCOPE');
  if(draft===null||draft===undefined)return null;
  assertMovementDraft(draft,matchId);
  if(draft.actor!==actor||draft.gameRevision!==gameRevision)return null;
  return Object.freeze({
    draftRevision:draft.draftRevision,baseGameRevision:draft.gameRevision,
    actions:structuredClone(draft.actions),
    movementAuthorized:false,attackAuthorized:false,stateChanged:false,
    needsFullLegalityCheck:true
  });
}
