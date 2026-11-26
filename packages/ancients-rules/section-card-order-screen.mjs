/**
 * Ancients 3e, ordinary Section Command cards only. Pure SERVER-SNAPSHOT screen.
 * This does not prove the snapshot came from the deck/hand event log, and is
 * never a command-card or combat authorization. No card text is reproduced.
 */
import {distance} from '../hex-grid/hex.mjs';

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

// V22: rules for cards that change order selection without a new combat phase.
// Inputs are supplied only by the authoritative journal before any movement.
export const SELECTION_CARD_DEFINITIONS=Object.freeze({
  ORDER_LIGHT_TROOPS:'LIGHT',ORDER_MEDIUM_TROOPS:'MEDIUM',ORDER_HEAVY_TROOPS:'HEAVY',
  ORDER_MOUNTED_TROOPS:'MOUNTED',COORDINATED_ATTACK:'COORDINATED',OUT_FLANKED:'FLANKS'
});
export const GROUP_CARD_DEFINITIONS=Object.freeze({LINE_COMMAND:'LINE',DOUBLE_TIME:'DOUBLE_TIME'});
const mountedTypes=new Set(['LIGHT_CAVALRY','MEDIUM_CAVALRY','HEAVY_CAVALRY','ELEPHANT','HEAVY_CHARIOT']);
const troopClasses={
  LIGHT:new Set(['LIGHT_INFANTRY','LIGHT_SLING_INFANTRY','LIGHT_BOW_INFANTRY','AUXILIA_INFANTRY','LIGHT_CAVALRY']),
  MEDIUM:new Set(['MEDIUM_INFANTRY','WARRIOR_INFANTRY','MEDIUM_CAVALRY']),
  HEAVY:new Set(['HEAVY_INFANTRY','HEAVY_WAR_MACHINE','HEAVY_CAVALRY','ELEPHANT','HEAVY_CHARIOT']),
  MOUNTED:mountedTypes
};
export function selectionCardOptions({definitionId,side,command,board,unitTypes,sectorCells}){
  if(!Object.hasOwn(SELECTION_CARD_DEFINITIONS,definitionId)&&!Object.hasOwn(GROUP_CARD_DEFINITIONS,definitionId))return null;
  const family=SELECTION_CARD_DEFINITIONS[definitionId]??GROUP_CARD_DEFINITIONS[definitionId];
  const units=board.units.filter(u=>u.side===side),leaders=board.leaders.filter(l=>l.side===side);
  if(family==='LINE'||family==='DOUBLE_TIME'){
    const foot=units.filter(u=>!mountedTypes.has(unitTypes[u.id]));
    const fallback=foot.length===0;
    return {family,maximumOrders:fallback?1:family==='LINE'?foot.length:Math.min(4,foot.length),
      unitIds:(fallback?units:foot).map(u=>u.id),leaderIds:[],fallback,
      ...(fallback?{}:{connected:true,maximumSections:family==='LINE'?3:2})};
  }
  if(family==='COORDINATED'||family==='FLANKS'){
    const capacities=family==='COORDINATED'?{LEFT:1,CENTER:1,RIGHT:1}:{LEFT:2,CENTER:0,RIGHT:2};
    const allowed=p=>sectorCells[cell(p)]?.some(s=>capacities[s]>0);
    return {family,maximumOrders:Object.values(capacities).reduce((a,b)=>a+b,0),
      unitIds:units.filter(allowed).map(u=>u.id),leaderIds:leaders.filter(allowed).map(l=>l.id),capacities};
  }
  const eligible=units.filter(u=>troopClasses[family].has(unitTypes[u.id]));
  const fallback=eligible.length===0;
  return {family,maximumOrders:fallback&&family!=='MOUNTED'?1:command,
    unitIds:(fallback?units:eligible).map(u=>u.id),
    leaderIds:family==='MOUNTED'?leaders.map(l=>l.id):[],fallback};
}
export function screenSelectionCardOrders(options,pieces,sectorCells){
  if(!options||pieces.length>options.maximumOrders||pieces.some(p=>!(p.kind==='UNIT'?options.unitIds:options.leaderIds).includes(p.id)))return false;
  if(options.fallback){
    const units=pieces.filter(p=>p.kind==='UNIT');
    // Mounted card can order leaders; a substitute foot order is instead a
    // single unit, never an extra order added to the leader allowance.
    if(units.length&&(units.length!==1||pieces.length!==1))return false;
  }
  if(options.connected&&pieces.length){
    // Selected units themselves must form a connected group at order time.
    // Movement later in the turn is free to split that group.
    const reached=new Set([0]),queue=[0];
    for(let i=0;i<queue.length;i++){
      for(let k=0;k<pieces.length;k++)if(!reached.has(k)&&distance(pieces[queue[i]],pieces[k])===1){
        reached.add(k);queue.push(k);
      }
    }
    if(reached.size!==pieces.length)return false;
    if(options.maximumSections===2&&![
      ['LEFT','CENTER'],['CENTER','RIGHT']
    ].some(pair=>pieces.every(p=>sectorCells[cell(p)]?.some(x=>pair.includes(x)))))return false;
  }
  if(!options.capacities)return true;
  const remaining={...options.capacities};
  // Each boundary piece consumes exactly one slot. Try all assignments
  // (at most four pieces) rather than selecting a sector greedily.
  function assign(i){
    if(i===pieces.length)return true;
    for(const sector of sectorCells[cell(pieces[i])]??[]){
      if(!(remaining[sector]>0))continue;
      remaining[sector]--;
      if(assign(i+1))return true;
      remaining[sector]++;
    }
    return false;
  }
  return assign(0);
}
