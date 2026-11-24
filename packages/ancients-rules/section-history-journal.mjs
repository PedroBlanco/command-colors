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
import {screenAncientsCombatTurn} from './combat-turn-guard.mjs';
import {precheckAncientsRangedAttack} from './ranged-precheck.mjs';
import {createRangedDicePlan} from './dice-plan.mjs';
import {initializeSectionDiceLab,assertSectionDiceLab,SECTION_DICE_COMMANDS,
  applySectionDiceCommand,projectSectionDiceLab,resetSectionDiceTurn
} from './section-ranged-roll-lab.mjs';
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
 * with three verified terrain types. No leaders, special cards, charge,
 * battles or scenario exceptions. Full sector lookup survives later turns.
 */
function validFootLabSetup(board,sectorCells,types,terrain=[],allowLeaders=false){
  if(!isRecord(board)||Object.keys(board).length!==2||
     !Array.isArray(board.units)||!Array.isArray(board.leaders)||
     board.units.length<1||board.units.length>117||
     board.units.length+board.leaders.length>117||
     (!allowLeaders&&board.leaders.length!==0)||
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
       !['id','side','col','row'].every(k=>Object.hasOwn(leader,k))||
       !validId(leader.id)||!SIDES.includes(leader.side)||!goodLoc(leader)||
       ids.has(leader.id)||leaderCells.has(loc(leader)))return false;
    const occupant=board.units.find(u=>loc(u)===loc(leader));
    if(occupant&&occupant.side!==leader.side)return false;
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
  movementTerrain=[],sectorPerspective='FIXED',enableLeaderLab=false,enableCombatLab=false,enableDiceLab=false,enableCasualtyLab=false,enableEvadeLab=false}={}) {
  if(!isCards(cardInstances)||cardInstances.length<2||!same(cardInstances.map(c=>c.instanceId))||
    !isRecord(handSizes)||!SIDES.every(s=>Number.isSafeInteger(handSizes[s])&&
      handSizes[s]>=1&&handSizes[s]<=20)||handSizes.A+handSizes.B>cardInstances.length||
    !SIDES.includes(startingSide)||!isRecord(board)||!Array.isArray(board.units)||
    !Array.isArray(board.leaders)||board.units.length+board.leaders.length>117||
    !isRecord(sectorCells)||typeof randomIndex!=='function'||
    !['FIXED','PLAYER_RELATIVE'].includes(sectorPerspective)||
    (typeof enableLeaderLab!=='boolean'||typeof enableCombatLab!=='boolean'||
      typeof enableDiceLab!=='boolean'||(enableDiceLab&&!enableCombatLab)||
      typeof enableCasualtyLab!=='boolean'||(enableCasualtyLab&&!enableDiceLab)||
      typeof enableEvadeLab!=='boolean'||(enableEvadeLab&&!enableCasualtyLab)))fail('INVALID_SECTION_HISTORY_SETUP');
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
    if(!validFootLabSetup(board,sectorCells,movementUnitTypes,movementTerrain,enableLeaderLab))
      fail('INVALID_FOOT_LAB_SETUP');
    state.footLab={unitTypes:copy(movementUnitTypes),movedUnitIds:[],
      terrain:copy(movementTerrain)};
    if(enableLeaderLab)state.leaderLab={movedLeaderIds:[],joinedUnitIds:[]};
    if(enableCombatLab)state.combatLab={movementClosed:false,movement:{},plan:null};
    if(enableDiceLab)state.diceLab=initializeSectionDiceLab(state.footLab.unitTypes,{casualties:enableCasualtyLab,evade:enableEvadeLab});
  }else if(enableLeaderLab||enableCombatLab||!Array.isArray(movementTerrain)||movementTerrain.length>0){
    fail('FOOT_TERRAIN_REQUIRES_FOOT_LAB');
  }
  assertSectionHistoryLab(state);
  return state;
}

/** Only the replayed server state may supply movement, orders, terrain or dice. */
function screenRangedPlan(state,attackerId,targetId){
  if(!state.combatLab?.movementClosed||state.phase!=='LAB_RESOLUTION_PENDING')
    return reject('COMBAT_PHASE_NOT_AVAILABLE');
  const attacker=state.board.units.find(u=>u.id===attackerId);
  const target=state.board.units.find(u=>u.id===targetId);
  if(!validId(attackerId)||!validId(targetId)||!attacker||!target||
     attacker.side!==state.turn||target.side===state.turn)
    return reject('INVALID_RANGED_TARGET');
  const ordered=state.orderSnapshot.pieces.filter(p=>p.kind==='UNIT'&&
    p.side===state.turn).map(p=>p.id);
  const movedStepsByUnit=Object.fromEntries(ordered.map(id=>[
    id,state.combatLab.movement[id]?.steps??0
  ]));
  const gate=screenAncientsCombatTurn({
    turnState:{schemaVersion:1,ruleset:ANCIENTS_RULESET,status:'ACTIVE',
      phase:'COMBAT',turn:state.turn,revision:state.revision,
      orderedUnitIds:ordered,resolvedBattleUnitIds:state.diceLab?.resolvedUnitIds??[],movedStepsByUnit,
      pendingCombat:null,pendingDecision:null},
    sessionSide:state.turn,attackerId,targetId,expectedRevision:state.revision
  });
  if(gate.status!=='CANDIDATE')return reject(gate.reason);
  if(state.combatLab.movement[attackerId]?.battle!=='POSSIBLE'&&
     Object.hasOwn(state.combatLab.movement,attackerId))
    return reject('BATTLE_AFTER_MOVEMENT_UNAVAILABLE');
  const units=state.board.units.map(u=>({...u,type:state.footLab.unitTypes[u.id]}));
  const checked=precheckAncientsRangedAttack({units,leaders:state.board.leaders,
    terrain:state.footLab.terrain??[],attackerId,targetId,movedSteps:gate.movedSteps});
  if(checked.status!=='CANDIDATE')return reject(checked.reason);
  const dice=createRangedDicePlan({mode:'OFFICIAL_PREVIEW',screening:{ranged:checked},
    board:{units},targetId});
  if(!dice)return reject('RANGED_DICE_PLAN_UNAVAILABLE');
  return {accepted:true,plan:{kind:'RANGED_PREVIEW',attackerId,targetId,
    distance:checked.distance,movedSteps:gate.movedSteps,baseDice:checked.baseDice,
    diceCount:dice.diceCount,targetUnitType:dice.targetUnitType,dieFaces:[...dice.dieFaces]}};
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
    if(!isRecord(info)||
       !(Object.keys(info).length===2||
         (Object.keys(info).length===3&&Object.hasOwn(info,'terrain')))||
       !isRecord(info.unitTypes)||!Array.isArray(info.movedUnitIds)||
       !validFootLabSetup(s.board,s.sectorCells,info.unitTypes,
         Object.hasOwn(info,'terrain')?info.terrain:[],Object.hasOwn(s,'leaderLab'))||
       info.movedUnitIds.length>117||
       !info.movedUnitIds.every(validId)||!same(info.movedUnitIds)||
       (s.phase!=='LAB_RESOLUTION_PENDING'&&info.movedUnitIds.length>0)||
       (s.phase==='LAB_RESOLUTION_PENDING'&&
        (!isRecord(s.orderSnapshot)||
         info.movedUnitIds.some(id=>!s.orderSnapshot.pieces.some(p=>
           p.kind==='UNIT'&&p.id===id&&p.side===s.turn)))))
      fail('INVALID_FOOT_LAB_STATE');
  }
  if(Object.hasOwn(s,'leaderLab')){
    const info=s.leaderLab;
    if(!Object.hasOwn(s,'footLab')||!isRecord(info)||
       Object.keys(info).length!==2||
       !['movedLeaderIds','joinedUnitIds'].every(k=>Object.hasOwn(info,k))||
       !Array.isArray(info.movedLeaderIds)||!Array.isArray(info.joinedUnitIds)||
       !same(info.movedLeaderIds)||!same(info.joinedUnitIds)||
       !info.movedLeaderIds.every(validId)||!info.joinedUnitIds.every(validId)||
       info.movedLeaderIds.some(id=>!s.board.leaders.some(l=>l.id===id&&l.side===s.turn))||
       info.joinedUnitIds.some(id=>!s.board.units.some(u=>u.id===id&&u.side===s.turn))||
       info.joinedUnitIds.some(id=>s.footLab.movedUnitIds.includes(id))||
       (s.phase!=='LAB_RESOLUTION_PENDING'&&
         (info.movedLeaderIds.length>0||info.joinedUnitIds.length>0)))
      fail('INVALID_LEADER_LAB_STATE');
  }
  if(Object.hasOwn(s,'combatLab')){
    const c=s.combatLab;
    if(!s.footLab||!isRecord(c)||Object.keys(c).length!==3||
       typeof c.movementClosed!=='boolean'||!isRecord(c.movement)||
       !(c.plan===null||isRecord(c.plan))||
       (s.phase!=='LAB_RESOLUTION_PENDING'&&
        (c.movementClosed||Object.keys(c.movement).length||c.plan!==null))||
       Object.keys(c.movement).length!==s.footLab.movedUnitIds.length||
       Object.entries(c.movement).some(([id,m])=>
         !s.footLab.movedUnitIds.includes(id)||!isRecord(m)||
         Object.keys(m).length!==2||!Number.isSafeInteger(m.steps)||
         m.steps<1||m.steps>4||!['POSSIBLE','UNAVAILABLE'].includes(m.battle))||
       (c.plan!==null&&!c.movementClosed))fail('INVALID_COMBAT_LAB_STATE');
    if(c.plan!==null){
      const checked=screenRangedPlan(s,c.plan.attackerId,c.plan.targetId);
      if(!checked.accepted||JSON.stringify(checked.plan)!==JSON.stringify(c.plan))
        fail('INVALID_COMBAT_LAB_PLAN');
    }
  }
  if(Object.hasOwn(s,'diceLab'))assertSectionDiceLab(s);
  if((s.phase==='AWAIT_CARD')!== (s.activeCard===null)||
     (s.phase==='AWAIT_CARD'&&(s.cardPlay!==null||s.handAtPlay!==null||s.orderSnapshot!==null))||
     (s.phase!=='AWAIT_CARD'&&(!isRecord(s.cardPlay)||!isRecord(s.handAtPlay)))||
     (s.phase==='LAB_RESOLUTION_PENDING'&&!isRecord(s.orderSnapshot))||
     (s.phase==='ASSIGN_ORDERS'&&s.orderSnapshot!==null))fail('SECTION_HISTORY_PHASE_MISMATCH');
  return true;
}

/** Deterministic command step; the caller controls actor via authenticated session. */
export function applySectionHistoryLabCommand(state,command={}){
  assertSectionHistoryLab(state);
  if(!isRecord(command)||!SIDES.includes(command.actor)||
     !Number.isSafeInteger(command.expectedRevision)||command.expectedRevision<0)
    return reject('INVALID_LAB_COMMAND');
  if(command.expectedRevision!==state.revision)return reject('STALE_REVISION');
  // Only the opposing participant may review a pending declared physical roll.
  // All other commands still require the acting side, even after movement closes.
  if(command.actor!==state.turn&&!['REVIEW_SECTION_RANGED_PHYSICAL_LAB','EVADE_SECTION_LEADER_LAB'].includes(command.type))
    return reject('NOT_YOUR_TURN');
  if(state.combatLab?.movementClosed&&['MOVE_SECTION_FOOT_PATH_V2',
    'MOVE_SECTION_MOUNTED_PATH_V1','MOVE_SECTION_LEADER_PATH_V1'].includes(command.type))
    return reject('MOVEMENT_PHASE_CLOSED');
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
    const moving=state.board.units.find(u=>u.id===command.unitId);
    const attached=state.leaderLab
      ?state.board.leaders.find(l=>l.side===side&&
        l.col===moving.col&&l.row===moving.row):null;
    if(state.leaderLab&&(
       state.leaderLab.joinedUnitIds.includes(command.unitId)||
       (attached&&state.leaderLab.movedLeaderIds.includes(attached.id))))
      return reject('UNIT_LOCKED_BY_LEADER_MOVE');
    if(state.leaderLab){
      const ending=command.path.at(-1);
      if(ending&&state.board.leaders.some(l=>l.col===ending.col&&
         l.row===ending.row&&l.id!==attached?.id))
        return reject('LEADER_DESTINATION_NEEDS_REVIEW');
    }
    // Open-ground V2 checks card-independent movement/profile/occupancy;
    // the existing terrain policy independently rejects entry restrictions.
    // Both verdicts are required before any mutation or SQLite event.
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
    if(next.combatLab)next.combatLab.movement[command.unitId]={
      steps:command.path.length,battle:battleAfterMovement==='POSSIBLE'?'POSSIBLE':'UNAVAILABLE'
    };
    if(attached){
      const destination=result.transition.to;
      const carried=next.board.leaders.find(l=>l.id===attached.id);
      carried.col=destination.col;carried.row=destination.row;
      next.leaderLab.movedLeaderIds.push(attached.id);
    }
    publicEvent={
      kind:'SECTION_FOOT_PATH_APPLIED_LAB',side,
      unitId:result.transition.unitId,from:result.transition.from,
      to:result.transition.to,path:result.transition.path,
      battleAfterMovement,
      ...(attached?{leaderCarried:attached.id}:{}),
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
    const attached=state.leaderLab
      ?state.board.leaders.find(l=>l.side===side&&
        l.col===piece.col&&l.row===piece.row):null;
    if(state.leaderLab&&(
       state.leaderLab.joinedUnitIds.includes(piece.id)||
       (attached&&state.leaderLab.movedLeaderIds.includes(attached.id))))
      return reject('UNIT_LOCKED_BY_LEADER_MOVE');
    if(state.leaderLab){
      const ending=command.path.at(-1);
      if(ending&&state.board.leaders.some(l=>l.col===ending.col&&
         l.row===ending.row&&l.id!==attached?.id))
        return reject('LEADER_DESTINATION_NEEDS_REVIEW');
    }
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
    if(next.combatLab)next.combatLab.movement[piece.id]={
      steps:command.path.length,battle:checked.battleAfterMovement==='POSSIBLE'?'POSSIBLE':'UNAVAILABLE'
    };
    if(attached){
      const carried=next.board.leaders.find(l=>l.id===attached.id);
      carried.col=checked.destination.col;carried.row=checked.destination.row;
      next.leaderLab.movedLeaderIds.push(attached.id);
    }
    publicEvent={
      kind:'SECTION_MOUNTED_PATH_APPLIED_LAB',side,unitId:piece.id,
      from:{col:piece.col,row:piece.row},
      to:{col:target.col,row:target.row},
      path:command.path.map(p=>({col:p.col,row:p.row})),
      battleAfterMovement:checked.battleAfterMovement,
      ...(attached?{leaderCarried:attached.id}:{}),
      destinationTerrain:checked.destinationTerrain
    };
  }else if(command.type==='MOVE_SECTION_LEADER_PATH_V1'){
    if(state.phase!=='LAB_RESOLUTION_PENDING'||!Object.hasOwn(state,'leaderLab'))
      return reject('LEADER_LAB_NOT_AVAILABLE');
    const leader=state.board.leaders.find(l=>l.id===command.leaderId);
    if(!leader||leader.side!==side||
       !state.orderSnapshot.pieces.some(p=>p.kind==='LEADER'&&p.id===leader.id))
      return reject('LEADER_NOT_ORDERED');
    if(state.leaderLab.movedLeaderIds.includes(leader.id))
      return reject('LEADER_ALREADY_MOVED');
    const host=state.board.units.find(u=>u.side===side&&u.col===leader.col&&
       u.row===leader.row);
    if(host&&state.footLab.movedUnitIds.includes(host.id))
      return reject('ATTACHED_UNIT_ALREADY_MOVED');
    let candidate;
    try{
      candidate=precheckAncientsLeaderPath({
        units:state.board.units,leaders:state.board.leaders,
        leaderId:leader.id,path:command.path,terrain:state.footLab.terrain??[]
      });
    }catch{
      return reject('INVALID_LEADER_PATH');
    }
    if(candidate.status!=='CANDIDATE')
      return reject(candidate.reason??'LEADER_LAB_MOVE_REJECTED');
    const targetUnit=state.board.units.find(u=>u.col===candidate.destination.col&&
      u.row===candidate.destination.row);
    if(targetUnit&&state.footLab.movedUnitIds.includes(targetUnit.id))
      return reject('UNIT_ALREADY_MOVED');
    const updated=next.board.leaders.find(l=>l.id===leader.id);
    updated.col=candidate.destination.col;updated.row=candidate.destination.row;
    next.leaderLab.movedLeaderIds.push(leader.id);
    if(targetUnit)next.leaderLab.joinedUnitIds.push(targetUnit.id);
    publicEvent={
      kind:'SECTION_LEADER_PATH_APPLIED_LAB',side,leaderId:leader.id,
      from:{col:leader.col,row:leader.row},to:candidate.destination,
      path:command.path.map(p=>({col:p.col,row:p.row})),
      detachedFromUnit:host?.id??null,
      joinedUnit:targetUnit?.id??null,
      combatResolved:false
    };
  }else if(command.type==='FINISH_SECTION_MOVEMENT_LAB'){
    if(!state.combatLab||state.phase!=='LAB_RESOLUTION_PENDING'||state.combatLab.movementClosed)
      return reject('COMBAT_PHASE_NOT_AVAILABLE');
    next.combatLab.movementClosed=true;
    publicEvent={kind:'SECTION_MOVEMENT_CLOSED_LAB',side};
  }else if(command.type==='PREPARE_SECTION_RANGED_LAB'){
    if(state.combatLab?.plan)return reject('COMBAT_PLAN_PENDING');
    const checked=screenRangedPlan(state,command.attackerId,command.targetId);
    if(!checked.accepted)return checked;
    next.combatLab.plan=checked.plan;
    publicEvent={kind:'SECTION_RANGED_PREPARED_LAB',side,...checked.plan,combatResolved:false};
  }else if(SECTION_DICE_COMMANDS.includes(command.type)){
    const result=applySectionDiceCommand(state,next,command);
    if(!result.accepted)return result;
    publicEvent=result.event;
  }else if(command.type==='CANCEL_SECTION_RANGED_LAB'){
    if(state.diceLab?.pending)return reject('RANGED_ROLL_ALREADY_CAPTURED');
    if(!state.combatLab?.plan)return reject('NO_COMBAT_PLAN_PENDING');
    next.combatLab.plan=null;
    publicEvent={kind:'SECTION_RANGED_CANCELLED_LAB',side};
  }else if(command.type==='END_EXPERIMENTAL_TURN'){
    if(state.combatLab?.plan)return reject('COMBAT_PLAN_PENDING');
    if(state.phase!=='LAB_RESOLUTION_PENDING')return reject('WRONG_PHASE');
    next.discardPile.push(next.activeCard);
    next.activeCard=null;
    const drew=next.drawPile.length>0;
    if(drew)next.hands[side].push(next.drawPile.pop());
    next.turn=side==='A'?'B':'A';
    next.phase='AWAIT_CARD';next.handAtPlay=null;next.cardPlay=null;next.orderSnapshot=null;
    if(next.footLab)next.footLab.movedUnitIds=[];
    if(next.combatLab)next.combatLab={movementClosed:false,movement:{},plan:null};
    if(next.diceLab)resetSectionDiceTurn(next);
    if(next.leaderLab){next.leaderLab.movedLeaderIds=[];next.leaderLab.joinedUnitIds=[];}
    publicEvent={kind:state.diceLab?.resolvedUnitIds.length
      ?'LAB_TURN_ENDED_AFTER_RANGED_REVIEW':'LAB_TURN_ENDED_WITHOUT_COMBAT',side,drewCard:drew};
  }else return reject('UNSUPPORTED_LAB_COMMAND');
  next.revision=state.revision+1;
  assertSectionHistoryLab(next);
  return {accepted:true,nextState:next,
    publicEvent:Object.freeze({sequence:next.revision,...publicEvent}),
    // Never serialize private command or nextState into a public event.
    cardPlayAuthorized:false,ordersAuthorized:false,attackAuthorized:false,
    movementAppliedInLab:['MOVE_SECTION_FOOT_PATH_V2',
      'MOVE_SECTION_MOUNTED_PATH_V1','MOVE_SECTION_LEADER_PATH_V1'].includes(command.type),
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
        unitType:state.footLab.unitTypes[u.id],
        ...(state.diceLab?{blocksRemaining:state.diceLab.blocks[u.id]}:{})
      })),
      movedUnitIds:[...state.footLab.movedUnitIds],
      ...(state.diceLab?{diceLab:projectSectionDiceLab(state,side)}:{}),
      ...(state.combatLab?{
        combatLab:{movementClosed:state.combatLab.movementClosed,
          plan:copy(state.combatLab.plan),
          candidates:state.turn===side&&state.combatLab.movementClosed&&!state.combatLab.plan
            ?state.orderSnapshot.pieces.filter(p=>p.kind==='UNIT'&&p.side===side)
              .flatMap(p=>state.board.units.filter(u=>u.side!==side).flatMap(u=>{
                const checked=screenRangedPlan(state,p.id,u.id);
                return checked.accepted?[{attackerId:p.id,targetId:u.id,diceCount:checked.plan.diceCount}]:[];
              })):[]}
      }:{}),
      ...(state.leaderLab?{
        leaders:copy(state.board.leaders),
        movedLeaderIds:[...state.leaderLab.movedLeaderIds],
        unitsLockedByLeader:[...state.leaderLab.joinedUnitIds],
        orderedLeaderIds:state.turn===side&&state.phase==='LAB_RESOLUTION_PENDING'
          ?state.orderSnapshot.pieces.filter(p=>p.kind==='LEADER'&&p.side===side)
            .map(p=>p.id):[]
      }:{}),
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
