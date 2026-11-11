/**
 * Ancients 3e, ordinary Section Command cards only. Pure SERVER-SNAPSHOT screen.
 * This does not prove the snapshot came from the deck/hand event log, and is
 * never a command-card or combat authorization. No card text is reproduced.
 */
export const SECTION_CARD_ORDER_SCREEN_VERSION = 1;
export const BASE_SECTION_CARD_LIMITS = Object.freeze(Object.fromEntries(
  ['LEFT','CENTER','RIGHT'].flatMap(section => [2,3,4].map(count => [
    'ORDER_'+count+'_'+section, Object.freeze({section, maxOrders:count})
  ]))
));
const SIDES=new Set(['A','B']);
const SECTIONS=new Set(['LEFT','CENTER','RIGHT']);
const ID=/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const record=x=>x!==null && typeof x==='object' && !Array.isArray(x) &&
  (Object.getPrototypeOf(x)===Object.prototype || Object.getPrototypeOf(x)===null);
const ident=x=>typeof x==='string' && ID.test(x) && x!=='__proto__';
const rev=x=>Number.isSafeInteger(x)&&x>=0;
const coord=x=>record(x)&&Number.isSafeInteger(x.col)&&Number.isSafeInteger(x.row)&&
  x.col>=0&&x.col<13&&x.row>=0&&x.row<9;
const cell=x=>x.col+','+x.row;
const list=xs=>Array.isArray(xs)&&xs.length<=117&&xs.every(ident)&&new Set(xs).size===xs.length;
const forbidden=x=>Object.keys(x).some(k=>['__proto__','constructor','prototype'].includes(k));
const blocked=reason=>Object.freeze({status:'BLOCKED',reason,
  cardHandEventVerified:false,sectionGeometryVerified:false,
  cardPlayAuthorized:false,ordersAuthorized:false,attackAuthorized:false,
  needsFullLegalityCheck:true});

/**
 * All five inputs MUST be captured by a trusted server from one game history.
 * orderSnapshot positions/sections are from ORDER ASSIGNMENT, not the current
 * post-movement board; sector labels are relative to the active player's side.
 */
export function screenBaseAncientsSectionCardOrders({turnState,sessionSide,
  expectedRevision,handAtPlay,cardPlay,orderSnapshot}={}) {
  if (!record(turnState)||turnState.schemaVersion!==1||
      turnState.ruleset!=='ancients-base-3e-2009'||
      turnState.status!=='ACTIVE'||turnState.phase!=='COMBAT'||
      !SIDES.has(turnState.turn)||!rev(turnState.revision)||
      !list(turnState.orderedUnitIds)||!list(turnState.orderedLeaderIds)||
      !record(handAtPlay)||!record(cardPlay)||!record(orderSnapshot)||
      !record(orderSnapshot.sectorCells)||forbidden(orderSnapshot.sectorCells))
    throw new TypeError('INVALID_SECTION_ORDER_SNAPSHOT');
  if (!SIDES.has(sessionSide)||sessionSide!==turnState.turn)
    return blocked('NOT_ACTING_PLAYER');
  if (!rev(expectedRevision)||expectedRevision!==turnState.revision)
    return blocked('STALE_REVISION');
  if (handAtPlay.side!==sessionSide||cardPlay.side!==sessionSide||
      orderSnapshot.side!==sessionSide) return blocked('WRONG_CARD_OWNER');
  if (!rev(handAtPlay.revision)||!rev(cardPlay.revision)||
      !rev(orderSnapshot.revision)||
      !(handAtPlay.revision<cardPlay.revision &&
        cardPlay.revision<=orderSnapshot.revision &&
        orderSnapshot.revision<=turnState.revision))
    return blocked('INVALID_ORDER_HISTORY');
  if (!ident(cardPlay.instanceId)||!ident(cardPlay.definitionId)||
      !Array.isArray(handAtPlay.cards)||handAtPlay.cards.length>128||
      handAtPlay.cards.some(x=>!record(x)||!ident(x.instanceId)||!ident(x.definitionId)))
    throw new TypeError('INVALID_SECTION_CARD_HAND');
  const handIds=handAtPlay.cards.map(x=>x.instanceId);
  if (new Set(handIds).size!==handIds.length)
    throw new TypeError('DUPLICATE_CARD_INSTANCE');
  const card=handAtPlay.cards.find(x=>x.instanceId===cardPlay.instanceId);
  if (!card || card.definitionId!==cardPlay.definitionId)
    return blocked('CARD_NOT_IN_ACTOR_HAND_AT_PLAY');
  const rule=BASE_SECTION_CARD_LIMITS[cardPlay.definitionId];
  if (!Object.hasOwn(BASE_SECTION_CARD_LIMITS,cardPlay.definitionId)||!rule)
    return blocked('UNSUPPORTED_CARD_FAMILY');
  const pieces=orderSnapshot.pieces;
  if (!Array.isArray(pieces)||pieces.length>117||pieces.some(x=>
      !record(x)||!ident(x.id)||!['UNIT','LEADER'].includes(x.kind)||
      !SIDES.has(x.side)||!coord(x)))
    throw new TypeError('INVALID_ORDER_PIECE_SNAPSHOT');
  const seenIds=new Set(),seenUnits=new Set(),seenLeaders=new Set(),
        usedCells={units:new Set(),leaders:new Set()};
  for (const piece of pieces) {
    if (seenIds.has(piece.id)) return blocked('DUPLICATE_ORDER');
    seenIds.add(piece.id);
    if (piece.side!==sessionSide) return blocked('FOREIGN_PIECE_ORDER');
    const sameKind=piece.kind==='UNIT'?usedCells.units:usedCells.leaders;
    if (sameKind.has(cell(piece))) return blocked('IMPOSSIBLE_ORDER_POSITION');
    sameKind.add(cell(piece));
    (piece.kind==='UNIT'?seenUnits:seenLeaders).add(piece.id);
    const sections=orderSnapshot.sectorCells[cell(piece)];
    if (!Array.isArray(sections)||sections.length<1||sections.length>2||
        !sections.every(s=>SECTIONS.has(s))||new Set(sections).size!==sections.length||
        (sections.length===2&&!((sections.includes('LEFT')&&sections.includes('CENTER'))||
                                (sections.includes('CENTER')&&sections.includes('RIGHT')))))
      return blocked('SECTOR_MEMBERSHIP_UNAVAILABLE');
    if (!sections.includes(rule.section)) return blocked('PIECE_OUT_OF_CARD_SECTION');
  }
  if (pieces.length>rule.maxOrders) return blocked('TOO_MANY_ORDERS');
  if (seenUnits.size!==turnState.orderedUnitIds.length||
      turnState.orderedUnitIds.some(x=>!seenUnits.has(x))||
      seenLeaders.size!==turnState.orderedLeaderIds.length||
      turnState.orderedLeaderIds.some(x=>!seenLeaders.has(x)))
    return blocked('ORDER_LEDGER_MISMATCH');
  return Object.freeze({status:'CANDIDATE',reason:null,
    ruleset:turnState.ruleset,screenVersion:SECTION_CARD_ORDER_SCREEN_VERSION,
    cardFamily:'ORDINARY_SECTION',section:rule.section,
    maximumOrders:rule.maxOrders,ordersInSnapshot:pieces.length,
    unitOrders:seenUnits.size,leaderOrders:seenLeaders.size,
    handSnapshotMatched:true,sectionSelectionScreened:true,
    cardHandEventVerified:false,sectionGeometryVerified:false,
    cardPlayAuthorized:false,ordersAuthorized:false,attackAuthorized:false,
    needsFullLegalityCheck:true
  });
}
