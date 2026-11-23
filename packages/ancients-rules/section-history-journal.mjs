/**
 * CCW-015: event-replayable, experimental Ancients ordinary-section card journal.
 * The initial scenario, physical card instances and board sector mapping MUST
 * come from a trusted server setup, never a request. NOT an official game turn.
 */
import {randomInt} from 'node:crypto';
import {screenBaseAncientsSectionCardOrders, BASE_SECTION_CARD_LIMITS} from './section-card-order-screen.mjs';
import {ANCIENTS_RULESET} from './movement-profile.mjs';
import {assessAncientsMovementRegime} from './movement-regimes.mjs';
import {assessAncientsTerrainMovement,BASE_TERRAIN_TYPES} from './terrain-movement.mjs';
import {BASE_MOUNTED_TYPES,previewBaseMountedPath} from './base-mounted-path.mjs';
import {precheckAncientsLeaderPath} from './leader-movement-preflight.mjs';
import {
  OPEN_FOOT_PATH_CORE_KIND, OPEN_FOOT_PATH_CORE_POLICY, reduceCoreOpenFootPath
} from './core-open-foot-path-v2.mjs';

export const SECTION_HISTORY_LAB_KIND='ANCIENTS_SECTION_HISTORY_LAB_V1';
const ID=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SIDES=['A','B'];
const validId=x=>typeof x==='string'&&ID.test(x)&&x!=='__proto__';
const isRecord=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const same=a=>new Set(a).size===a.length;
const copy=structuredClone;
const fail=code=>{throw new TypeError(code)};
const reject=code=>Object.freeze({accepted:false,code});
const loc=p=>p.col+','+p.row;
const reversedSection=sector=>sector==='LEFT'?'RIGHT':sector==='RIGHT'?'LEFT':sector;
const goodLoc=p=>Number.isSafeInteger(p.col)&&p.col>=0&&p.col<13&&Number.isSafeInteger(p.row)&&p.row>=0&&p.row<9;
const isCards=a=>Array.isArray(a)&&a.length<=128&&a.every(c=>isRecord(c)&&validId(c.instanceId)&&
  Object.hasOwn(BASE_SECTION_CARD_LIMITS,c.definitionId));

/**
 * Strict server-owned LAB scope: ordinary foot or five mounted base types,
 * with three verified terrain types and opt-in leader movement/attachment.
 * No special cards, charge, combat or scenario exceptions.
 */
function validFootLabSetup(board,sectorCells,types,terrain=[]){
  if(!isRecord(board)||Object.keys(board).length!==2||
     !Array.isArray(board.units)||!Array.isArray(board.leaders)||
     board.units.length<1||board.units.length+board.leaders.length>117||
     !isRecord(types)||Object.keys(types).length!==board.units.length||
     !isRecord(sectorCells)||Reflect.ownKeys(sectorCells).length!==117||
     !Array.isArray(terrain)||terrain.length>117)return false;
  const hexes=new Set();
  for(const tile of terrain){
    if(!isRecord(tile)||Object.keys(tile).length!==3||
       !['col','row','kind'].every(k=>Object.hasOwn(tile,k))||
       !goodLoc(tile)||!BASE_TERRAIN_TYPES.includes(tile.kind)||
       hexes.has(loc(tile)))return false;
    hexes.add(loc(tile));
  }
  const ids=new Set(),positions=new Set();
  for(const unit of board.units){
    if(!isRecord(unit)||Object.keys(unit).length!==4||
       !['id','side','col','row'].every(k=>Object.hasOwn(unit,k))||
       !validId(unit.id)||!SIDES.includes(unit.side)||!goodLoc(unit)||
       ids.has(unit.id)||positions.has(loc(unit))||
       !Object.hasOwn(types,unit.id))return false;
    const regime=assessAncientsMovementRegime({
      unitType:types[unit.id],steps:1
    });
    if(regime.status!=='SUBSET_ELIGIBLE'&&
       !BASE_MOUNTED_TYPES.includes(types[unit.id]))return false;
    ids.add(unit.id);positions.add(loc(unit));
  }
  const leaderCells=new Set();
  for(const leader of board.leaders){
    if(!isRecord(leader)||Object.keys(leader).length!==4||
       !validId(leader.id)||!SIDES.includes(leader.side)||
       !goodLoc(leader)||ids.has(leader.id)||leaderCells.has(loc(leader))||
       board.units.some(u=>loc(u)===loc(leader)&&u.side!==leader.side))
       return false;
    ids.add(leader.id);leaderCells.add(loc(leader));
  }
  for(let col=0;col<13;col++)for(let row=0;row<9;row++){
    const sectors=sectorCells[col+','+row];
    if(!Array.isArray(sectors)||sectors.length<1||sectors.length>2||
       !sectors.every(x=>['LEFT','CENTER','RIGHT'].includes(x))||
       !same(sectors)||
       (sectors.length===2&&!(
         (sectors.includes('LEFT')&&sectors.includes('CENTER'))||
         (sectors.includes('CENTER')&&sectors.includes('RIGHT'))
       )))return false;
  }
  return true;
}

/** Lab-only setup: server determines shuffled card inventory and scenario metadata. */
export function initializeSectionHistoryLab({cardInstances,handSizes,board,sectorCells,
  startingSide='A',randomIndex=randomInt,movementUnitTypes=undefined,
  movementTerrain=[],sectorPerspective='FIXED'}={}) {
  if(!isCards(cardInstances)||cardInstances.length<2||!same(cardInstances.map(c=>c.instanceId))||
    !isRecord(handSizes)||!SIDES.every(s=>Number.isSafeInteger(handSizes[s])&&
      handSizes[s]>=1&&handSizes[s]<=20)||handSizes.A+handSizes.B>cardInstances.length||
    !SIDES.includes(startingSide)||!isRecord(board)||!Array.isArray(board.units)||
    !Array.isArray(board.leaders)||board.units.length+board.leaders.length>117||
    !isRecord(sectorCells)||typeof randomIndex!=='function'||
    !['FIXED','PLAYER_RELATIVE'].includes(sectorPerspective))fail('INVALID_SECTION_HISTORY_SETUP');
  const pieces=[...board.units.map(x=>({...x,kind:'UNIT'})),...board.leaders.map(x=>({...x,kind:'LEADER'}))];
  if(!pieces.every(x=>isRecord(x)&&validId(x.id)&&SIDES.includes(x.side)&&goodLoc(x))||
    !same(pieces.map(x=>x.id))||!same(board.units.map(loc))||!same(board.leaders.map(loc))||
    pieces.some(x=>!Array.isArray(sectorCells[loc(x)])||
      sectorCells[loc(x)].length<1||sectorCells[loc(x)].length>2||
      !sectorCells[loc(x)].every(s=>['LEFT','CENTER','RIGHT'].includes(s))||
      !same(sectorCells[loc(x)])))fail('INVALID_SECTION_HISTORY_BOARD');
  const drawPile=copy(cardInstances);
  for(let i=drawPile.length-1;i>0;i--){
    const j=randomIndex(i+1);
    if(!Number.isSafeInteger(j)||j<0||j>i)fail('INVALID_SHUFFLE_RESULT');
    [drawPile[i],drawPile[j]]=[drawPile[j],drawPile[i]];
  }
  const hands={A:[],B:[]};
  for(const side of SIDES)for(let n=0;n<handSizes[side];n++)hands[side].push(drawPile.pop());
  const state={schemaVersion:1,kind:SECTION_HISTORY_LAB_KIND,revision:0,
    turn:startingSide,phase:'AWAIT_CARD',totalCards:cardInstances.length,
    drawPile,hands,discardPile:[],activeCard:null,
    handAtPlay:null,cardPlay:null,orderSnapshot:null,
    board:copy(board),sectorCells:copy(sectorCells),
    ...(sectorPerspective==='PLAYER_RELATIVE'?{sectorPerspective}: {})};
  if(movementUnitTypes!==undefined){
    if(!validFootLabSetup(board,sectorCells,movementUnitTypes,movementTerrain))
      fail('INVALID_FOOT_LAB_SETUP');
    state.footLab={unitTypes:copy(movementUnitTypes),movedUnitIds:[],
      terrain:copy(movementTerrain),
      ...(board.leaders.length?{movedLeaderIds:[]}: {})};
  }else if(!Array.isArray(movementTerrain)||movementTerrain.length>0){
    fail('FOOT_TERRAIN_REQUIRES_FOOT_LAB');
  }
  assertSectionHistoryLab(state);
  return state;
}

/** Verify complete card conservation and the minimal internal lab contract. */
export function assertSectionHistoryLab(s){
  if(!isRecord(s)||s.kind!==SECTION_HISTORY_LAB_KIND||s.schemaVersion!==1||
     !Number.isSafeInteger(s.revision)||s.revision<0||!SIDES.includes(s.turn)||
     !['AWAIT_CARD','ASSIGN_ORDERS','LAB_RESOLUTION_PENDING'].includes(s.phase)||
     !Number.isSafeInteger(s.totalCards)||s.totalCards<2||s.totalCards>128||
     !isCards(s.drawPile)||!isCards(s.discardPile)||!isRecord(s.hands)||
     !SIDES.every(side=>isCards(s.hands[side]))||
     !(s.activeCard===null||isCards([s.activeCard]))||
     !isRecord(s.board)||!isRecord(s.sectorCells)||
     (Object.hasOwn(s,'sectorPerspective')&&s.sectorPerspective!=='PLAYER_RELATIVE'))
     fail('INVALID_SECTION_HISTORY_STATE');
  const all=[...s.drawPile,...s.discardPile,...s.hands.A,...s.hands.B,
    ...(s.activeCard?[s.activeCard]:[])];
  if(all.length!==s.totalCards||!same(all.map(c=>c.instanceId)))fail('SECTION_CARD_CONSERVATION_FAILED');
  if(Object.hasOwn(s,'footLab')){
    const info=s.footLab;
    const names=Object.keys(info);
    const hasLeaders=Object.hasOwn(info,'movedLeaderIds');
    if(!isRecord(info)||!names.includes('unitTypes')||
       !names.includes('movedUnitIds')||
       !names.every(k=>['unitTypes','movedUnitIds','terrain','movedLeaderIds'].includes(k))||
       (s.board.leaders.length>0)!==hasLeaders||
       !isRecord(info.unitTypes)||!Array.isArray(info.movedUnitIds)||
       (hasLeaders&&!Array.isArray(info.movedLeaderIds))||
       !validFootLabSetup(s.board,s.sectorCells,info.unitTypes,
         Object.hasOwn(info,'terrain')?info.terrain:[])||
       info.movedUnitIds.length>117||
       !info.movedUnitIds.every(validId)||!same(info.movedUnitIds)||
       (s.phase!=='LAB_RESOLUTION_PENDING'&&info.movedUnitIds.length>0)||
       (s.phase==='LAB_RESOLUTION_PENDING'&&
        (!isRecord(s.orderSnapshot)||
         info.movedUnitIds.some(id=>!s.orderSnapshot.pieces.some(p=>
           p.kind==='UNIT'&&p.id===id&&p.side===s.turn)))))
      fail('INVALID_FOOT_LAB_STATE');
    if(hasLeaders){
      const ids=info.movedLeaderIds;
      if(ids.length>s.board.leaders.length||!ids.every(validId)||!same(ids)||
         (s.phase!=='LAB_RESOLUTION_PENDING'&&ids.length>0)||
         (s.phase==='LAB_RESOLUTION_PENDING'&&ids.some(id=>{
           const leader=s.board.leaders.find(x=>x.id===id);
           if(!leader||leader.side!==s.turn)return true;
           const ordered=s.orderSnapshot?.pieces.some(p=>
             p.kind==='LEADER'&&p.id===id&&p.side===s.turn);
           const accompanied=s.board.units.some(u=>
             u.side===s.turn&&loc(u)===loc(leader)&&
             info.movedUnitIds.includes(u.id));
           return !ordered&&!accompanied;
         })))fail('INVALID_LEADER_LAB_STATE');
    }
  }
  if((s.phase==='AWAIT_CARD')!== (s.activeCard===null)||
     (s.phase==='AWAIT_CARD'&&(s.cardPlay!==null||s.handAtPlay!==null||s.orderSnapshot!==null))||
     (s.phase!=='AWAIT_CARD'&&(!isRecord(s.cardPlay)||!isRecord(s.handAtPlay)))||
     (s.phase==='LAB_RESOLUTION_PENDING'&&!isRecord(s.orderSnapshot))||
     (s.phase==='ASSIGN_ORDERS'&&s.orderSnapshot!==null))fail('SECTION_HISTORY_PHASE_MISMATCH');
  return true;
}

/**
 * A unit carries its attached leader. It can stop on a friendly lone
 * leader but cannot pass through one or enter any enemy leader's cell.
 */
function screenUnitLeaderPassage(state,unit,path){
  if(!Object.hasOwn(state.footLab,'movedLeaderIds'))
    return {ok:true,carried:null,joined:null};
  const leaders=state.board.leaders;
  const carried=leaders.find(l=>loc(l)===loc(unit))??null;
  if(carried&&state.footLab.movedLeaderIds.includes(carried.id))
    return {ok:false,reason:'ATTACHED_LEADER_ALREADY_MOVED'};
  let joined=null;
  for(let i=0;i<path.length;i++){
    const leader=leaders.find(l=>loc(l)===loc(path[i]));
    if(!leader)continue;
    if(leader.side!==unit.side)return {ok:false,reason:'ENEMY_LEADER_BLOCKS_PATH'};
    if(i<path.length-1)return {ok:false,reason:'UNIT_MUST_STOP_ON_LEADER'};
    if(carried)return {ok:false,reason:'LEADER_ALREADY_ATTACHED_TO_UNIT'};
    joined=leader;
  }
  return {ok:true,carried,joined};
}
function commitUnitLeaderPassage(next,check,destination){
  const leader=check.carried??check.joined;
  if(!leader)return null;
  const target=next.board.leaders.find(x=>x.id===leader.id);
  target.col=destination.col;target.row=destination.row;
  if(!next.footLab.movedLeaderIds.includes(target.id))
    next.footLab.movedLeaderIds.push(target.id);
  return target.id;
}

/** Deterministic command step; the caller controls actor via authenticated session. */
export function applySectionHistoryLabCommand(state,command={}){
  assertSectionHistoryLab(state);
  if(!isRecord(command)||!SIDES.includes(command.actor)||
     !Number.isSafeInteger(command.expectedRevision)||command.expectedRevision<0)
    return reject('INVALID_LAB_COMMAND');
  if(command.expectedRevision!==state.revision)return reject('STALE_REVISION');
  if(command.actor!==state.turn)return reject('NOT_YOUR_TURN');
  const next=copy(state),side=command.actor;
  let publicEvent;
  if(command.type==='PLAY_SECTION_CARD'){
    if(state.phase!=='AWAIT_CARD'||!validId(command.cardInstanceId))return reject('WRONG_PHASE_OR_CARD');
    const index=next.hands[side].findIndex(c=>c.instanceId===command.cardInstanceId);
    if(index<0)return reject('CARD_NOT_IN_OWN_HAND');
    next.handAtPlay={side,revision:state.revision,cards:copy(next.hands[side])};
    const card=next.hands[side].splice(index,1)[0];
    next.activeCard=card;
    next.cardPlay={side,revision:state.revision+1,instanceId:card.instanceId,definitionId:card.definitionId};
    next.phase='ASSIGN_ORDERS';
    publicEvent={kind:'SECTION_CARD_PLAYED_LAB',side,definitionId:card.definitionId};
  }else if(command.type==='ASSIGN_SECTION_ORDERS'){
    if(state.phase!=='ASSIGN_ORDERS')return reject('WRONG_PHASE');
    const {unitIds,leaderIds}=command;
    if(!Array.isArray(unitIds)||!Array.isArray(leaderIds)||
      unitIds.length+leaderIds.length>117||
      ![...unitIds,...leaderIds].every(validId)||!same([...unitIds,...leaderIds]))
      return reject('INVALID_ORDER_IDENTITIES');
    const pieces=[];
    for(const [kind,ids,collection] of [['UNIT',unitIds,state.board.units],['LEADER',leaderIds,state.board.leaders]]){
      for(const id of ids){
        const piece=collection.find(x=>x.id===id);
        if(!piece || piece.side!==side)return reject('INVALID_ORDER_IDENTITIES');
        pieces.push({id,kind,side,col:piece.col,row:piece.row});
      }
    }
    // Ordinary section cards refer to each commander's own left and right.
    // The canonical board sectors are defined from side A's viewpoint.
    // Legacy journals without sectorPerspective retain their original scope.
    const perspective=state.sectorPerspective==='PLAYER_RELATIVE'&&side==='B'
      ?Object.fromEntries(Object.entries(state.sectorCells)
        .map(([hex,sectors])=>[hex,sectors.map(reversedSection)]))
      :copy(state.sectorCells);
    const proof={side,revision:state.revision+1,pieces,
      sectorCells:perspective};
    const screened=screenBaseAncientsSectionCardOrders({
      turnState:{schemaVersion:1,ruleset:'ancients-base-3e-2009',status:'ACTIVE',
        phase:'COMBAT',turn:side,revision:state.revision+1,
        orderedUnitIds:[...unitIds],orderedLeaderIds:[...leaderIds]},
      sessionSide:side,expectedRevision:state.revision+1,
      handAtPlay:state.handAtPlay,cardPlay:state.cardPlay,orderSnapshot:proof
    });
    if(screened.status!=='CANDIDATE')return reject('ORDERS_NOT_ELIGIBLE');
    next.orderSnapshot=proof;
    next.phase='LAB_RESOLUTION_PENDING';
    publicEvent={kind:'SECTION_ORDERS_STAGED_LAB',side,unitCount:unitIds.length,
      leaderCount:leaderIds.length};
  }else if(command.type==='MOVE_SECTION_FOOT_PATH_V2'){
    if(state.phase!=='LAB_RESOLUTION_PENDING'||!Object.hasOwn(state,'footLab'))
      return reject('FOOT_LAB_NOT_AVAILABLE');
    // Orders were screened against the card when staged, and every command
    // is replay-verified again inside the SQLite writer transaction.
    const ids=state.orderSnapshot.pieces
      .filter(p=>p.kind==='UNIT').map(p=>p.id);
    const coreState={
      kind:OPEN_FOOT_PATH_CORE_KIND,schemaVersion:2,
      ruleset:ANCIENTS_RULESET,revision:state.revision,
      turn:side,phase:'MOVE',
      board:{units:state.board.units.map(u=>({
        id:u.id,side:u.side,col:u.col,row:u.row
      })),leaders:[]},
      orderLedger:{issuedUnitIds:ids,
        movedUnitIds:[...state.footLab.movedUnitIds]}
    };
    const policy={
      scope:OPEN_FOOT_PATH_CORE_POLICY,ruleset:ANCIENTS_RULESET,
      cardFamily:'ORDINARY_SECTION',terrain:[],scenarioExceptions:[],
      unitTypes:copy(state.footLab.unitTypes)
    };
    const result=reduceCoreOpenFootPath({
      state:coreState,policy,
      action:{actor:side,expectedRevision:state.revision,
        unitId:command.unitId,path:command.path}
    });
    if(result.status!=='RULE_PATH_TRANSITION_CANDIDATE')
      return reject(result.reason??'FOOT_LAB_MOVE_REJECTED');
    // Open-ground V2 checks card-independent movement/profile/occupancy;
    // the existing terrain policy independently rejects entry restrictions.
    // Both verdicts are required before any mutation or SQLite event.
    const moving=state.board.units.find(u=>u.id===command.unitId);
    const terrain=assessAncientsTerrainMovement({
      unitType:state.footLab.unitTypes[command.unitId],
      origin:{col:moving.col,row:moving.row},
      path:command.path,terrain:state.footLab.terrain??[]
    });
    if(terrain.status!=='CANDIDATE')
      return reject(terrain.reason??'FOOT_LAB_TERRAIN_BLOCKED');
    const battleAfterMovement=terrain.battleOnEntry==='UNAVAILABLE'
      ? 'UNAVAILABLE':result.transition.battleAfterMovement;
    // The reducer determines every changed cell and public event field.
    // A client cannot supply its own board, rules or movement result.
    next.board.units=result.nextState.board.units;
    next.footLab.movedUnitIds=result.nextState.orderLedger.movedUnitIds;
    publicEvent={
      kind:'SECTION_FOOT_PATH_APPLIED_LAB',side,
      unitId:result.transition.unitId,from:result.transition.from,
      to:result.transition.to,path:result.transition.path,
      battleAfterMovement,
      ...(Object.hasOwn(state.footLab,'terrain')?{
        destinationTerrain:terrain.destinationTerrain
      }:{})
    };
  }else if(command.type==='MOVE_SECTION_MOUNTED_PATH_V1'){
    if(state.phase!=='LAB_RESOLUTION_PENDING'||!Object.hasOwn(state,'footLab'))
      return reject('MOUNTED_LAB_NOT_AVAILABLE');
    const piece=state.board.units.find(u=>u.id===command.unitId);
    if(!piece||piece.side!==side||
       !state.orderSnapshot.pieces.some(p=>p.kind==='UNIT'&&p.id===piece.id))
      return reject('UNIT_NOT_ORDERED');
    if(state.footLab.movedUnitIds.includes(piece.id))
      return reject('UNIT_ALREADY_MOVED');
    // All inputs are derived from replayed CCWB state, not the request:
    // only piece identity/path are selectable by the acting participant.
    const checked=previewBaseMountedPath({
      unitType:state.footLab.unitTypes[piece.id],
      from:{col:piece.col,row:piece.row},
      path:command.path,occupiedCells:state.board.units,
      terrain:state.footLab.terrain??[]
    });
    if(checked.status!=='MOUNTED_PATH_PROPOSAL')
      return reject(checked.reason??'MOUNTED_LAB_MOVE_REJECTED');
    const target=next.board.units.find(u=>u.id===piece.id);
    target.col=checked.destination.col;
    target.row=checked.destination.row;
    next.footLab.movedUnitIds.push(piece.id);
    publicEvent={
      kind:'SECTION_MOUNTED_PATH_APPLIED_LAB',side,unitId:piece.id,
      from:{col:piece.col,row:piece.row},
      to:{col:target.col,row:target.row},
      path:command.path.map(p=>({col:p.col,row:p.row})),
      battleAfterMovement:checked.battleAfterMovement,
      destinationTerrain:checked.destinationTerrain
    };
  }else if(command.type==='END_EXPERIMENTAL_TURN'){
    if(state.phase!=='LAB_RESOLUTION_PENDING')return reject('WRONG_PHASE');
    next.discardPile.push(next.activeCard);
    next.activeCard=null;
    const drew=next.drawPile.length>0;
    if(drew)next.hands[side].push(next.drawPile.pop());
    next.turn=side==='A'?'B':'A';
    next.phase='AWAIT_CARD';next.handAtPlay=null;next.cardPlay=null;next.orderSnapshot=null;
    if(next.footLab)next.footLab.movedUnitIds=[];
    publicEvent={kind:'LAB_TURN_ENDED_WITHOUT_COMBAT',side,drewCard:drew};
  }else return reject('UNSUPPORTED_LAB_COMMAND');
  next.revision=state.revision+1;
  assertSectionHistoryLab(next);
  return {accepted:true,nextState:next,
    publicEvent:Object.freeze({sequence:next.revision,...publicEvent}),
    // Never serialize private command or nextState into a public event.
    cardPlayAuthorized:false,ordersAuthorized:false,attackAuthorized:false,
    movementAppliedInLab:['MOVE_SECTION_FOOT_PATH_V2',
      'MOVE_SECTION_MOUNTED_PATH_V1'].includes(command.type),
    officialMovementAuthorized:false,combatResolved:false};
}

/** Rebuild an entire state from a server-only initial snapshot and private commands. */
export function replaySectionHistoryLab(initialState,commands){
  assertSectionHistoryLab(initialState);
  if(initialState.revision!==0||!Array.isArray(commands)||commands.length>256)
    fail('INVALID_SECTION_HISTORY_REPLAY');
  let state=copy(initialState);
  for(const command of commands){
    const result=applySectionHistoryLabCommand(state,command);
    if(!result.accepted)fail('INVALID_SECTION_HISTORY_EVENT_CHAIN');
    state=result.nextState;
  }
  return state;
}

export function projectSectionHistoryLab(state,side){
  assertSectionHistoryLab(state);
  if(!SIDES.includes(side))return null;
  const other=side==='A'?'B':'A';
  return Object.freeze({revision:state.revision,you:side,turn:state.turn,
    phase:state.phase, yourHand:copy(state.hands[side]),
    opponentCardCount:state.hands[other].length,
    drawPileCount:state.drawPile.length,
    discardPile:state.discardPile.map(c=>c.definitionId),
    cardInPlay:state.activeCard?.definitionId??null,
    ordersStaged:state.orderSnapshot!==null,
    ...(state.footLab?{
      board:state.board.units.map(u=>({
        id:u.id,side:u.side,col:u.col,row:u.row,
        unitType:state.footLab.unitTypes[u.id]
      })),
      movedUnitIds:[...state.footLab.movedUnitIds],
      // A participant may select ONLY their own ordered units. Do not
      // expose the opponent's still-private selection.
      orderedUnitIds:state.turn===side&&state.phase==='LAB_RESOLUTION_PENDING'
        ?state.orderSnapshot.pieces.filter(p=>p.kind==='UNIT'&&p.side===side)
          .map(p=>p.id):[],
      ...(Object.hasOwn(state.footLab,'terrain')?{
        terrain:copy(state.footLab.terrain)
      }:{})
    }:{}),
    cardPlayAuthorized:false,ordersAuthorized:false,
    attackAuthorized:false,combatResolved:false});
}
