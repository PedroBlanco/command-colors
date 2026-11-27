/**
 * CCW-015: event-replayable, experimental Ancients ordinary-section card journal.
 * The initial scenario, physical card instances and board sector mapping MUST
 * come from a trusted server setup, never a request. NOT an official game turn.
 */
import {validScenarioObjectives,claimScenarioObjectives,projectScenarioObjectives} from './scenario-objectives.mjs';
import {initializeScenarioRules,validScenarioRules,isSacredBand,applyScenarioHandGrowth,reserveEntryOptions,reserveCanContinue,reserveEntryBattle,RESERVE_ENTRY_TERRAIN_POLICY} from './scenario-special-rules.mjs';
import {randomInt} from 'node:crypto';
import {getBoardGeometry,LAB_BOARD_GEOMETRY,OFFICIAL_BOARD_GEOMETRY,officialSectorCells} from '../hex-grid/hex.mjs';
import {assessAncientsTerrainDiceCap} from './terrain-dice-cap.mjs';
import {ANCIENTS_BATTLE_DIE_FACES,BASE_UNIT_DIE_SYMBOLS} from './battle-dice.mjs';
import {BASE_UNIT_STARTING_BLOCKS} from './block-loss-preview.mjs';
import {screenBaseAncientsSectionCardOrders, BASE_SECTION_CARD_LIMITS, SELECTION_CARD_DEFINITIONS, GROUP_CARD_DEFINITIONS, ATTACK_CARD_DEFINITIONS, LEADERSHIP_CARD_DEFINITIONS, FIRE_CARD_DEFINITIONS, effectiveSectionCard, selectionCardOptions, screenSelectionCardOrders} from './section-card-order-screen.mjs';
import {ANCIENTS_RULESET,assessBaseMovement,BASE_MOVEMENT_PROFILES} from './movement-profile.mjs';
import {assessAncientsMovementRegime,assessOpenHexPathGeometry} from './movement-regimes.mjs';
import {assessAncientsTerrainMovement,BASE_TERRAIN_TYPES,isImpassableHex,isImpassableTerrain,terrainTileShapeOK,fortificationProtects,isMarshHex,pathHasMarsh,isBuildingHex,buildingOccupantAllowed,isRetreatBlockedHex} from './terrain-movement.mjs';
import {BASE_MOUNTED_TYPES,previewBaseMountedPath} from './base-mounted-path.mjs';
import {precheckAncientsLeaderPath} from './leader-movement-preflight.mjs';
import {screenAncientsCombatTurn} from './combat-turn-guard.mjs';
import {precheckAncientsRangedAttack} from './ranged-precheck.mjs';
import {createRangedDicePlan} from './dice-plan.mjs';
import {initializeSectionDiceLab,assertSectionDiceLab,SECTION_DICE_COMMANDS,
  applySectionDiceCommand,projectSectionDiceLab,resetSectionDiceTurn,sectionVictory,settleSectionVictory,baseCloseAttackDice,sectionCombatSide,sectionMomentumOptions,sectionRollIndex,applyMarshUnitPath,applyMarshLeaderPath,marshLeaderOptions,resolveMarshLeaderEvasion
} from './section-ranged-roll-lab.mjs';
import {
  OPEN_FOOT_PATH_CORE_KIND, OPEN_FOOT_PATH_CORE_POLICY, reduceCoreOpenFootPath
} from './core-open-foot-path-v2.mjs';

export const SECTION_HISTORY_LAB_KIND='ANCIENTS_SECTION_HISTORY_LAB_V1';
// Historical limit retained for V1–V20 and unversioned journals.
export const SECTION_HISTORY_MAX_COMMANDS=256;
export function sectionHistoryCommandLimit(state){
  return state.diceLab?.version>=21?Number.MAX_SAFE_INTEGER:SECTION_HISTORY_MAX_COMMANDS;
}
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
const geometryOf=state=>getBoardGeometry(state.scenario?.geometry);
const goodLoc=(p,geometry)=>geometry.inBounds(p);
const isCards=(a,version=0)=>Array.isArray(a)&&a.length<=128&&a.every(c=>isRecord(c)&&validId(c.instanceId)&&
  (Object.hasOwn(BASE_SECTION_CARD_LIMITS,c.definitionId)||version>=22&&Object.hasOwn(SELECTION_CARD_DEFINITIONS,c.definitionId)||version>=23&&Object.hasOwn(GROUP_CARD_DEFINITIONS,c.definitionId)||version>=24&&Object.hasOwn(ATTACK_CARD_DEFINITIONS,c.definitionId)||version>=25&&Object.hasOwn(LEADERSHIP_CARD_DEFINITIONS,c.definitionId)||version>=26&&Object.hasOwn(FIRE_CARD_DEFINITIONS,c.definitionId)||version>=27&&c.definitionId==='MOVE_FIRE_MOVE'||version>=28&&c.definitionId==='RALLY'||version>=29&&c.definitionId==='I_AM_SPARTACUS'||version>=30&&c.definitionId==='COUNTER_ATTACK'||version>=31&&c.definitionId==='FIRST_STRIKE'));

/**
 * Strict server-owned LAB scope: ordinary foot or five mounted base types,
 * with three verified terrain types. No leaders, special cards, charge,
 * battles or scenario exceptions. Full sector lookup survives later turns.
 */
function validFootLabSetup(board,sectorCells,types,terrain=[],allowLeaders=false,allowEmpty=false,allowWarriors=false,allowMachines=false,geometry=getBoardGeometry()){
  const maxCells=geometry.cellCount;
  if(!isRecord(board)||Object.keys(board).length!==2||
     !Array.isArray(board.units)||!Array.isArray(board.leaders)||
     (!allowEmpty&&board.units.length<1)||board.units.length>maxCells||
     board.units.length+board.leaders.length>maxCells||
     (!allowLeaders&&board.leaders.length!==0)||
     !isRecord(types)||Object.keys(types).length!==board.units.length||
     !isRecord(sectorCells)||Reflect.ownKeys(sectorCells).length!==maxCells||
     !Array.isArray(terrain)||terrain.length>maxCells)return false;
  const hexes=new Set();
  for(const tile of terrain){
    if(!isRecord(tile)||!terrainTileShapeOK(tile,true)||
       !goodLoc(tile,geometry)||!BASE_TERRAIN_TYPES.includes(tile.kind)||
       hexes.has(loc(tile)))return false;
    hexes.add(loc(tile));
  }
  const ids=new Set(),positions=new Set();
  for(const unit of board.units){
    if(!isRecord(unit)||Object.keys(unit).length!==4||
       !['id','side','col','row'].every(k=>Object.hasOwn(unit,k))||
       !validId(unit.id)||!SIDES.includes(unit.side)||!goodLoc(unit,geometry)||
       ids.has(unit.id)||positions.has(loc(unit))||isImpassableHex(terrain,unit)||
       !Object.hasOwn(types,unit.id)||types[unit.id]==='HEAVY_WAR_MACHINE'&&isMarshHex(terrain,unit)||
       isBuildingHex(terrain,unit)&&!buildingOccupantAllowed(types[unit.id]))return false;
    const regime=assessAncientsMovementRegime({
      unitType:types[unit.id],steps:1
    });
    if(regime.status!=='SUBSET_ELIGIBLE'&&
       !BASE_MOUNTED_TYPES.includes(types[unit.id])&&!(allowWarriors&&types[unit.id]==='WARRIOR_INFANTRY')&&!(allowMachines&&types[unit.id]==='HEAVY_WAR_MACHINE'))return false;
    ids.add(unit.id);positions.add(loc(unit));
  }
  const leaderCells=new Set();
  for(const leader of board.leaders){
    if(!isRecord(leader)||Object.keys(leader).length!==4||
       !['id','side','col','row'].every(k=>Object.hasOwn(leader,k))||
       !validId(leader.id)||!SIDES.includes(leader.side)||!goodLoc(leader,geometry)||
       ids.has(leader.id)||leaderCells.has(loc(leader))||isImpassableHex(terrain,leader))return false;
    const occupant=board.units.find(u=>loc(u)===loc(leader));
    if(occupant&&occupant.side!==leader.side)return false;
    ids.add(leader.id);leaderCells.add(loc(leader));
  }
  for(const {col,row} of geometry.allCells()){
    const sectors=sectorCells[col+','+row];
    if(!Array.isArray(sectors)||sectors.length<1||sectors.length>2||
       !sectors.every(x=>['LEFT','CENTER','RIGHT'].includes(x))||
       !same(sectors)||
       (sectors.length===2&&!(
         (sectors.includes('LEFT')&&sectors.includes('CENTER'))||
         (sectors.includes('CENTER')&&sectors.includes('RIGHT'))
       )))return false;
  }
  if(geometry.id===OFFICIAL_BOARD_GEOMETRY){
    const expected=officialSectorCells();
    if(Object.entries(expected).some(([k,v])=>JSON.stringify(v)!==JSON.stringify(sectorCells[k])))return false;
  }
  return true;
}

// Optional public metadata is persisted in the initial snapshot, not resolved
// against a mutable catalog during replay. Older journals have no scenario field.
function validScenarioMetadata(s){
  const short=(x,n)=>typeof x==='string'&&x.trim()===x&&x.length>0&&x.length<=n;
  return isRecord(s)&&validId(s.id)&&validId(s.deckId)&&short(s.title,120)&&
    (Object.keys(s).length===3||
     (Object.keys(s).length===6&&[LAB_BOARD_GEOMETRY,OFFICIAL_BOARD_GEOMETRY].includes(s.geometry)&&isRecord(s.provenance)&&Object.keys(s.provenance).length===2&&
      ['OFFICIAL','COMMUNITY','ORIGINAL'].includes(s.provenance.kind)&&short(s.provenance.source,500)&&
      isRecord(s.factions)&&Object.keys(s.factions).length===2&&SIDES.every(side=>short(s.factions[side],80))));
}

/** Lab-only setup: server determines shuffled card inventory and scenario metadata. */
export function initializeSectionHistoryLab({cardInstances,handSizes,board,sectorCells,scenario,scenarioObjectives,scenarioRules,
  startingSide='A',randomIndex=randomInt,movementUnitTypes=undefined,
  movementTerrain=[],sectorPerspective='FIXED',enableLeaderLab=false,enableCombatLab=false,enableDiceLab=false,enableCasualtyLab=false,enableMoraleLab=false,enableRetreatLab=false,enableRetreatLeaderLab=false,enableLeaderEscapeLab=false,enableRampageLab=false,enableRampageLeaderLab=false,enableElephantRetreatLeaderLab=false,victoryTargets=null,enableCloseCombatLab=false,enableUnitEvadeLab=false,enableBattleBackLab=false,enableMomentumLab=false,enableBonusCloseLab=false,enableElephantCloseLab=false,enableSpecialCloseLab=false,enableSpecialFootLab=false,enableLoneLeaderCombatLab=false,enableDeckRecycleLab=false,enableLongHistoryLab=false,enableSelectionCardsLab=false,enableGroupCardsLab=false,enableAttackCardsLab=false,enableLeadershipCardsLab=false,enableFireCardsLab=false,enableMoveFireMoveLab=false,enableRallyLab=false,enableSpartacusLab=false,enableCounterAttackLab=false,enableFirstStrikeLab=false}={}) {
  if(scenario!==undefined&&!validScenarioMetadata(scenario))fail('INVALID_SECTION_SCENARIO_METADATA');
  const geometry=getBoardGeometry(scenario?.geometry);
  if(geometry.id===OFFICIAL_BOARD_GEOMETRY&&(!movementUnitTypes||!enableFirstStrikeLab||sectorPerspective!=='PLAYER_RELATIVE'))fail('OFFICIAL_GEOMETRY_REQUIRES_FULL_LAB');
  if(!isCards(cardInstances,enableFirstStrikeLab===true?31:enableCounterAttackLab===true?30:enableSpartacusLab===true?29:enableRallyLab===true?28:enableMoveFireMoveLab===true?27:enableFireCardsLab===true?26:enableLeadershipCardsLab===true?25:enableAttackCardsLab===true?24:enableGroupCardsLab===true?23:enableSelectionCardsLab===true?22:0)||cardInstances.length<2||!same(cardInstances.map(c=>c.instanceId))||
    !isRecord(handSizes)||!SIDES.every(s=>Number.isSafeInteger(handSizes[s])&&
      handSizes[s]>=1&&handSizes[s]<=20)||handSizes.A+handSizes.B>cardInstances.length||
    !SIDES.includes(startingSide)||!isRecord(board)||!Array.isArray(board.units)||
    !Array.isArray(board.leaders)||board.units.length+board.leaders.length>geometry.cellCount||
    !isRecord(sectorCells)||typeof randomIndex!=='function'||
    !['FIXED','PLAYER_RELATIVE'].includes(sectorPerspective)||
    (typeof enableLeaderLab!=='boolean'||typeof enableCombatLab!=='boolean'||
      typeof enableDiceLab!=='boolean'||(enableDiceLab&&!enableCombatLab)||
      typeof enableCasualtyLab!=='boolean'||(enableCasualtyLab&&!enableDiceLab)||
      typeof enableMoraleLab!=='boolean'||(enableMoraleLab&&!enableCasualtyLab)||
      typeof enableRetreatLab!=='boolean'||(enableRetreatLab&&!enableMoraleLab)||
      typeof enableRetreatLeaderLab!=='boolean'||(enableRetreatLeaderLab&&!enableRetreatLab)||
      typeof enableLeaderEscapeLab!=='boolean'||(enableLeaderEscapeLab&&!enableRetreatLeaderLab)||
      typeof enableRampageLab!=='boolean'||(enableRampageLab&&!enableLeaderEscapeLab)||
      typeof enableRampageLeaderLab!=='boolean'||(enableRampageLeaderLab&&!enableRampageLab)||
      typeof enableElephantRetreatLeaderLab!=='boolean'||(enableElephantRetreatLeaderLab&&!enableRampageLeaderLab)||
      (victoryTargets!==null&&(!enableElephantRetreatLeaderLab||!movementUnitTypes))||
      typeof enableCloseCombatLab!=='boolean'||(enableCloseCombatLab&&victoryTargets===null)||
      typeof enableUnitEvadeLab!=='boolean'||(enableUnitEvadeLab&&!enableCloseCombatLab)||
      typeof enableBattleBackLab!=='boolean'||(enableBattleBackLab&&!enableUnitEvadeLab)||
      typeof enableMomentumLab!=='boolean'||(enableMomentumLab&&!enableBattleBackLab)||
      typeof enableBonusCloseLab!=='boolean'||(enableBonusCloseLab&&!enableMomentumLab)||
      typeof enableElephantCloseLab!=='boolean'||(enableElephantCloseLab&&!enableBonusCloseLab)||
      typeof enableSpecialCloseLab!=='boolean'||(enableSpecialCloseLab&&!enableElephantCloseLab)||
      typeof enableSpecialFootLab!=='boolean'||(enableSpecialFootLab&&!enableSpecialCloseLab)||
      typeof enableLoneLeaderCombatLab!=='boolean'||(enableLoneLeaderCombatLab&&!enableSpecialFootLab)||
      typeof enableDeckRecycleLab!=='boolean'||(enableDeckRecycleLab&&!enableLoneLeaderCombatLab)||
      typeof enableLongHistoryLab!=='boolean'||(enableLongHistoryLab&&!enableDeckRecycleLab)||
      typeof enableSelectionCardsLab!=='boolean'||(enableSelectionCardsLab&&!enableLongHistoryLab)||
      typeof enableGroupCardsLab!=='boolean'||(enableGroupCardsLab&&!enableSelectionCardsLab)||
      typeof enableAttackCardsLab!=='boolean'||(enableAttackCardsLab&&!enableGroupCardsLab)||
      typeof enableLeadershipCardsLab!=='boolean'||(enableLeadershipCardsLab&&(!enableAttackCardsLab||!enableLeaderLab))||
      typeof enableFireCardsLab!=='boolean'||(enableFireCardsLab&&!enableLeadershipCardsLab)||
      typeof enableMoveFireMoveLab!=='boolean'||(enableMoveFireMoveLab&&!enableFireCardsLab)||
      typeof enableRallyLab!=='boolean'||(enableRallyLab&&!enableMoveFireMoveLab)||
      typeof enableSpartacusLab!=='boolean'||(enableSpartacusLab&&!enableRallyLab)||
      typeof enableCounterAttackLab!=='boolean'||(enableCounterAttackLab&&!enableSpartacusLab)||
      typeof enableFirstStrikeLab!=='boolean'||(enableFirstStrikeLab&&!enableCounterAttackLab)))fail('INVALID_SECTION_HISTORY_SETUP');
  const pieces=[...board.units.map(x=>({...x,kind:'UNIT'})),...board.leaders.map(x=>({...x,kind:'LEADER'}))];
  if(!pieces.every(x=>isRecord(x)&&validId(x.id)&&SIDES.includes(x.side)&&goodLoc(x,geometry))||
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
    ...(scenario!==undefined?{scenario:copy(scenario)}:{}),
    ...(sectorPerspective==='PLAYER_RELATIVE'?{sectorPerspective}: {})};
  if(movementUnitTypes!==undefined){
    if(Array.isArray(movementTerrain)&&movementTerrain.some(t=>t?.kind==='MARSH')&&(!enableFirstStrikeLab||!enableDiceLab))fail('MARSH_REQUIRES_FULL_COMBAT_LAB');
    if(!validFootLabSetup(board,sectorCells,movementUnitTypes,movementTerrain,enableLeaderLab,false,enableElephantCloseLab,enableSpecialCloseLab,geometry))
      fail('INVALID_FOOT_LAB_SETUP');
    state.footLab={unitTypes:copy(movementUnitTypes),movedUnitIds:[],
      terrain:copy(movementTerrain)};
    if(enableLeaderLab)state.leaderLab={movedLeaderIds:[],joinedUnitIds:[]};
    if(enableCombatLab)state.combatLab={movementClosed:false,movement:{},plan:null};
    if(enableDiceLab)state.diceLab=initializeSectionDiceLab(state.footLab.unitTypes,{casualties:enableCasualtyLab,morale:enableMoraleLab,retreat:enableRetreatLab,retreatLeaders:enableRetreatLeaderLab,leaderEscape:enableLeaderEscapeLab,rampage:enableRampageLab,rampageLeaders:enableRampageLeaderLab,elephantRetreatLeaders:enableElephantRetreatLeaderLab,victoryTargets,closeCombat:enableCloseCombatLab,unitEvade:enableUnitEvadeLab,battleBack:enableBattleBackLab,momentum:enableMomentumLab,bonusClose:enableBonusCloseLab,elephantClose:enableElephantCloseLab,specialClose:enableSpecialCloseLab,specialFoot:enableSpecialFootLab,loneLeaderCombat:enableLoneLeaderCombatLab,deckRecycle:enableDeckRecycleLab,longHistory:enableLongHistoryLab,selectionCards:enableSelectionCardsLab,groupCards:enableGroupCardsLab,attackCards:enableAttackCardsLab,leadershipCards:enableLeadershipCardsLab,fireCards:enableFireCardsLab,moveFireMove:enableMoveFireMoveLab,rally:enableRallyLab,spartacus:enableSpartacusLab,counterAttack:enableCounterAttackLab,firstStrike:enableFirstStrikeLab,marsh:movementTerrain.some(t=>t.kind==='MARSH')});
  }else if(enableLeaderLab||enableCombatLab||!Array.isArray(movementTerrain)||movementTerrain.length>0){
    fail('FOOT_TERRAIN_REQUIRES_FOOT_LAB');
  }
  if(scenarioObjectives!==undefined){
    const objectives={rules:copy(scenarioObjectives),claimed:[]};
    if(!state.diceLab?.victoryTargets||!validScenarioObjectives(objectives,state.footLab.terrain,geometry.id))fail('INVALID_SECTION_SCENARIO_OBJECTIVES');
    state.victoryObjectives=objectives;
    claimScenarioObjectives(state,true);
    if(sectionVictory(state).winner)fail('SCENARIO_ALREADY_WON');
  }
  if(scenarioRules!==undefined)state.scenarioRules=initializeScenarioRules(scenarioRules,state,handSizes);
  assertSectionHistoryLab(state);
  return state;
}

// Leaders sharing a hex with a unit cannot be targeted independently.
function loneLeaderTargets(state){
  return state.diceLab?.version>=19?state.board.leaders.filter(l=>!state.board.units.some(u=>loc(u)===loc(l))):[];
}
function combatTargets(state){return [...state.board.units,...loneLeaderTargets(state)];}

function relativeSectors(state,side){
  return state.sectorPerspective==='PLAYER_RELATIVE'&&side==='B'
    ?Object.fromEntries(Object.entries(state.sectorCells).map(([hex,sectors])=>[hex,sectors.map(reversedSection)]))
    :copy(state.sectorCells);
}
function rallySelection(state,side){
  const leaders=state.board.leaders.filter(l=>l.side===side);
  const own=state.board.units.filter(u=>u.side===side);
  if(!leaders.length)return {family:'RALLY',fallback:true,maximumOrders:1,unitIds:own.map(u=>u.id),leaderIds:[]};
  const eligible=own.filter(u=>{
    const type=state.footLab.unitTypes[u.id];
    return !['ELEPHANT','HEAVY_CHARIOT'].includes(type)&&state.diceLab.blocks[u.id]<BASE_UNIT_STARTING_BLOCKS[type]&&leaders.some(l=>geometryOf(state).distance(l,u)<=1);
  });
  const rallyOptions=state.diceLab.rallyFaces.map((face,dieIndex)=>({face,dieIndex,
    unitIds:eligible.filter(u=>face==='LEADER'||BASE_UNIT_DIE_SYMBOLS[state.footLab.unitTypes[u.id]]===face).map(u=>u.id)}));
  return {family:'RALLY',maximumOrders:state.diceLab.rallyFaces.length,unitIds:eligible.map(u=>u.id),leaderIds:[],rallyOptions};
}
function allocateRally(state,selection,allocations){
  if(!Array.isArray(allocations)||allocations.length>selection.rallyOptions.length)return null;
  const blocks=copy(state.diceLab.blocks),used=new Set(),ordered=new Set();
  for(const a of allocations){
    if(!isRecord(a)||Object.keys(a).length!==2||!Number.isSafeInteger(a.dieIndex)||!validId(a.unitId)||used.has(a.dieIndex)||
       !selection.rallyOptions[a.dieIndex]?.unitIds.includes(a.unitId)||blocks[a.unitId]>=BASE_UNIT_STARTING_BLOCKS[state.footLab.unitTypes[a.unitId]])return null;
    used.add(a.dieIndex);ordered.add(a.unitId);blocks[a.unitId]++;
  }
  if(selection.rallyOptions.some(o=>!used.has(o.dieIndex)&&o.unitIds.some(id=>blocks[id]<BASE_UNIT_STARTING_BLOCKS[state.footLab.unitTypes[id]])))return null;
  return {blocks,unitIds:[...ordered]};
}
function spartacusSelection(state,side){
  const faces=state.diceLab.spartacusFaces;
  const capacities=Object.fromEntries(['LIGHT','MEDIUM','HEAVY','LEADER'].map(f=>[f,faces.filter(x=>x===f).length]));
  const units=state.board.units.filter(u=>u.side===side&&(capacities.LEADER||capacities[BASE_UNIT_DIE_SYMBOLS[state.footLab.unitTypes[u.id]]]));
  return {family:'SPARTACUS',maximumOrders:Object.values(capacities).reduce((a,b)=>a+b,0),
    unitIds:units.map(u=>u.id),leaderIds:capacities.LEADER?state.board.leaders.filter(l=>l.side===side).map(l=>l.id):[],symbols:capacities};
}
function spartacusOrdersFit(state,selection,pieces){
  const remaining={...selection.symbols};
  // Spend restricted symbols first; helmets cover deficits and leaders.
  for(const p of pieces){
    const symbol=p.kind==='UNIT'?BASE_UNIT_DIE_SYMBOLS[state.footLab.unitTypes[p.id]]:'LEADER';
    if(remaining[symbol]>0)remaining[symbol]--;
    else if(remaining.LEADER>0)remaining.LEADER--;
    else return false;
  }
  return true;
}
function counteredDefinition(definition){
  if(Object.hasOwn(BASE_SECTION_CARD_LIMITS,definition)||/^INSPIRED_(LEFT|CENTER|RIGHT)_LEADERSHIP$/.test(definition))
    return definition.replace(/LEFT|RIGHT/,reversedSection);
  return definition;
}
function leadershipSection(selection,pieces,sectors,geometryId){
  // Use the first valid anchor/sector in stable board order; a single-unit
  // alternative uses that unit's sector. An empty selection has no anchor.
  const anchor=selection.leadershipAnchors.find(a=>pieces.some(p=>p.id===a.orderId)&&
    screenSelectionCardOrders({...selection,leadershipAnchors:[a]},pieces,sectors,geometryId));
  const cell=anchor??pieces[0];
  return cell?sectors[loc(cell)]?.[0]??null:null;
}
function currentSelectionCard(state,side,sectors=relativeSectors(state,side)){
  if(!(state.diceLab?.version>=22)||!state.activeCard||!state.handAtPlay)return null;
  if(state.diceLab.version>=28&&effectiveSectionCard(state)==='RALLY')return rallySelection(state,side);
  if(state.diceLab.version>=29&&effectiveSectionCard(state)==='I_AM_SPARTACUS')return spartacusSelection(state,side);
  const definition=effectiveSectionCard(state);
  if(definition==='FIRST_STRIKE')return {family:'FIRST_STRIKE',maximumOrders:0,unitIds:[],leaderIds:[]};
  const selection=selectionCardOptions({definitionId:definition,side,
    command:state.handAtPlay.cards.length,board:state.board,unitTypes:state.footLab.unitTypes,sectorCells:sectors,geometryId:state.scenario?.geometry});
  if(definition==='LEADERSHIP_ANY_SECTION'&&state.diceLab?.counter?.section&&selection){
    const section=state.diceLab.counter.section;
    return {...selection,section,leadershipAnchors:selection.leadershipAnchors.filter(a=>sectors[loc(a)]?.includes(section))};
  }
  return selection;
}
const lightFootPassTypes=new Set(['LIGHT_INFANTRY','LIGHT_SLING_INFANTRY','LIGHT_BOW_INFANTRY','AUXILIA_INFANTRY']);
function mayPassFriendlyFoot(state,id){
  return state.diceLab?.version>=22&&(effectiveSectionCard(state)==='ORDER_LIGHT_TROOPS'||!!state.diceLab?.moveFireMove)&&lightFootPassTypes.has(state.footLab.unitTypes[id]);
}
// V23 group effects apply only to foot units, never to the single mounted
// substitute allowed when the player has no foot units.
function groupFootCard(state,id){
  const type=state.footLab?.unitTypes[id],definition=effectiveSectionCard(state);
  return state.diceLab?.version>=23&&type&&!BASE_MOUNTED_TYPES.includes(type)&&Object.hasOwn(GROUP_CARD_DEFINITIONS,definition)
    ?definition:null;
}
function attackCardEffect(state,unitId){
  if(!(state.diceLab?.version>=24))return null;
  const card=effectiveSectionCard(state);
  if(card==='CLASH_OF_SHIELDS')return card;
  if(card==='MOUNTED_CHARGE'&&BASE_MOUNTED_TYPES.includes(state.footLab.unitTypes[unitId]))return card;
  return null;
}
function ambushOptions(state,side){
  const card=effectiveSectionCard(state);
  // Counter Attack is not itself a Leadership card.
  if(state.activeCard?.definitionId!==card||!Object.hasOwn(LEADERSHIP_CARD_DEFINITIONS,card))return null;
  return reserveEntryOptions(state,side,relativeSectors(state,side),geometryOf(state),LEADERSHIP_CARD_DEFINITIONS[card]);
}
function exitRule(state,side,cell){
  const rule=state.scenarioRules?.unitExit?.rule;
  return rule?.side===side&&cell.row===(side==='A'?0:8)&&relativeSectors(state,side)[loc(cell)]?.some(s=>rule.sectors.includes(s));
}
function scenarioPath(state,piece,path,steps,exit=false){
  if(!Array.isArray(path)||path.length>4||!path.every(c=>isRecord(c)&&Object.keys(c).length===2&&goodLoc(c,geometryOf(state))))return false;
  const type=state.footLab.unitTypes[piece.id],group=groupFootCard(state,piece.id);
  const max=group==='LINE_COMMAND'?1:group==='DOUBLE_TIME'&&type!=='HEAVY_WAR_MACHINE'?(type==='WARRIOR_INFANTRY'?3:2):
    attackCardEffect(state,piece.id)==='MOUNTED_CHARGE'&&['HEAVY_CAVALRY','ELEPHANT','HEAVY_CHARIOT'].includes(type)?3:BASE_MOVEMENT_PROFILES[type].maxSteps;
  if(steps>max)return false;
  const terrain=state.footLab.terrain??[],at=c=>terrain.find(t=>loc(t)===loc(c))?.kind??'CLEAR';
  if(exit&&path.length&&['FOREST','FORDABLE_RIVER','MARSH','BUILDING'].includes(at(path.at(-1))))return false;
  if(path.length){
    const checked=assessOpenHexPathGeometry({from:{col:piece.col,row:piece.row},path,
      occupiedCells:[...state.board.units.filter(u=>!(mayPassFriendlyFoot(state,piece.id)&&path.length===2&&u.side===piece.side&&loc(u)===loc(path[0]))),
        ...state.board.leaders.filter(l=>!state.board.units.some(u=>loc(u)===loc(l)))]},state.scenario?.geometry);
    if(checked.status!=='CANDIDATE_PATH_GEOMETRY')return false;
    const ground=assessAncientsTerrainMovement({unitType:type,origin:piece,path,terrain,geometryId:state.scenario?.geometry});
    if(ground.status!=='CANDIDATE'||exit&&ground.destinationTerrain==='BROKEN_GROUND'&&BASE_MOUNTED_TYPES.includes(type))return false;
    if(exit&&['MARSH','BUILDING'].includes(at(piece))&&steps>1)return false;
  }
  return true;
}

// V18 extends the existing foot command; V22/V23 reuse it for card effects.
function previewSpecialFootMove(state,command){
  const piece=state.board.units.find(u=>u.id===command.unitId);
  if(!piece||piece.side!==state.turn||
    !state.orderSnapshot.pieces.some(p=>p.kind==='UNIT'&&p.id===piece.id))return {reason:'UNIT_NOT_ORDERED'};
  if(state.footLab.movedUnitIds.includes(piece.id))return {reason:'UNIT_ALREADY_MOVED'};
  const type=state.footLab.unitTypes[piece.id];
  if(geometryOf(state).id===OFFICIAL_BOARD_GEOMETRY&&BASE_MOUNTED_TYPES.includes(type))return {reason:'UNSUPPORTED_FOOT_UNIT'};
  const path=command.path,group=groupFootCard(state,piece.id);
  if(!Array.isArray(path)||!path.length||path.length>(group==='DOUBLE_TIME'?3:2)||
     !path.every(c=>isRecord(c)&&Object.keys(c).length===2&&goodLoc(c,geometryOf(state))))return {reason:'INVALID_PATH_CORE_ACTION'};
  let profile=assessBaseMovement({unitType:type,steps:path.length});
  if(group==='LINE_COMMAND'&&path.length>1)return {reason:'LINE_COMMAND_MOVEMENT_EXCEEDED'};
  if(group==='DOUBLE_TIME'&&type!=='HEAVY_WAR_MACHINE'){
    const warrior=type==='WARRIOR_INFANTRY',max=warrior?3:2;
    if(path.length>max)return {reason:'DOUBLE_TIME_MOVEMENT_EXCEEDED'};
    profile={status:'WITHIN_PROFILE',battle:warrior&&path.length>=2?'MANDATORY_CLOSE_COMBAT':'POSSIBLE'};
  }
  if(profile.status==='EXCEEDS_STANDARD_PROFILE')return {reason:'STANDARD_FOOT_MOVEMENT_EXCEEDED'};
  const from={col:piece.col,row:piece.row};
  const canPass=mayPassFriendlyFoot(state,piece.id)&&path.length===2;
  const transit=canPass?loc(path[0]):null;
  const geometry=assessOpenHexPathGeometry({from,path,occupiedCells:[
    ...state.board.units.filter(u=>!(canPass&&u.side===piece.side&&loc(u)===transit)),...state.board.leaders.filter(l=>l.side!==piece.side&&!state.board.units.some(u=>loc(u)===loc(l)))
  ]},state.scenario?.geometry);
  if(geometry.status!=='CANDIDATE_PATH_GEOMETRY')return {reason:geometry.reason};
  if(profile.battle==='MANDATORY_CLOSE_COMBAT'&&!combatTargets(state).some(u=>u.side!==piece.side&&geometryOf(state).distance(u,geometry.destination)===1))
    return {reason:'WARRIOR_CHARGE_TARGET_REQUIRED'};
  const board=copy(state.board);
  Object.assign(board.units.find(u=>u.id===piece.id),geometry.destination);
  return {status:'RULE_PATH_TRANSITION_CANDIDATE',
    nextState:{board,orderLedger:{movedUnitIds:[...state.footLab.movedUnitIds,piece.id]}},
    transition:{unitId:piece.id,from,to:geometry.destination,path:copy(path),battleAfterMovement:profile.battle}};
}

// A two-hex charge is compulsory while at least one supported enemy unit
// remains adjacent. If earlier combats remove every target, it is waived.
function pendingWarriorCharges(state){
  if(!(state.diceLab?.version>=18)||state.phase!=='LAB_RESOLUTION_PENDING')return [];
  return Object.entries(state.combatLab.movement).filter(([id,m])=>{
    if(m.battle!=='MANDATORY_CLOSE_COMBAT'||state.diceLab.resolvedUnitIds.includes(id))return false;
    const unit=state.board.units.find(u=>u.id===id&&u.side===state.turn);
    return !!unit&&combatTargets(state).some(u=>u.side!==state.turn&&geometryOf(state).distance(unit,u)===1);
  }).map(([id])=>id);
}

// V20: regenerate only the empty draw pile. The private combat key and
// a separate HMAC domain bind the permutation to the accepted revision.
// Neither card instance identities nor the permutation enter public events.
function recycleSectionDeck(state,revision,force=false){
  if(state.diceLab?.version<20||!state.diceLab||(!force&&state.drawPile.length)||!state.discardPile.length)return 0;
  const draw=sectionRollIndex(state.diceLab.key,'section_deck_'+revision);
  state.drawPile=force?[...state.drawPile,...state.discardPile]:state.discardPile;
  state.discardPile=[];
  for(let i=state.drawPile.length-1;i>0;i--){
    const j=draw(i+1);
    [state.drawPile[i],state.drawPile[j]]=[state.drawPile[j],state.drawPile[i]];
  }
  return state.drawPile.length;
}

const spartacusBonus=state=>state.diceLab?.version>=29&&effectiveSectionCard(state)==='I_AM_SPARTACUS'?1:0;

/** Only the replayed server state may supply movement, orders, terrain or dice. */
function screenRangedPlan(state,attackerId,targetId){
  if(state.diceLab?.moveFireMove==='SECOND')return reject('MFM_FIRE_CLOSED');
  if(!state.combatLab?.movementClosed||state.phase!=='LAB_RESOLUTION_PENDING')
    return reject('COMBAT_PHASE_NOT_AVAILABLE');
  const attacker=state.board.units.find(u=>u.id===attackerId);
  const target=combatTargets(state).find(u=>u.id===targetId);
  if(!validId(attackerId)||!validId(targetId)||!attacker||!target||
     attacker.side!==state.turn||target.side===state.turn)
    return reject('INVALID_RANGED_TARGET');
  const ordered=state.orderSnapshot.pieces.filter(p=>p.kind==='UNIT'&&
    p.side===state.turn).map(p=>p.id);
  const movedStepsByUnit=Object.fromEntries(ordered.map(id=>[
    id,state.combatLab.movement[id]?.steps??0
  ]));
  const already=state.diceLab?.resolvedUnitIds??[];
  const resolved=state.diceLab?.darken&&!state.diceLab.darken.twice.includes(attackerId)?already.filter(id=>id!==attackerId):already;
  const gate=screenAncientsCombatTurn({
    turnState:{schemaVersion:1,ruleset:ANCIENTS_RULESET,status:'ACTIVE',
      phase:'COMBAT',turn:state.turn,revision:state.revision,
      orderedUnitIds:ordered,resolvedBattleUnitIds:resolved,movedStepsByUnit,
      pendingCombat:null,pendingDecision:null},
    sessionSide:state.turn,attackerId,targetId,expectedRevision:state.revision
  });
  if(gate.status!=='CANDIDATE')return reject(gate.reason);
  if(groupFootCard(state,attackerId)==='DOUBLE_TIME')return reject('DOUBLE_TIME_RANGED_FORBIDDEN');
  if(attackCardEffect(state,attackerId))return reject('ATTACK_CARD_RANGED_FORBIDDEN');
  if(state.combatLab.movement[attackerId]?.battle!=='POSSIBLE'&&
     Object.hasOwn(state.combatLab.movement,attackerId))
    return reject('BATTLE_AFTER_MOVEMENT_UNAVAILABLE');
  const units=state.board.units.map(u=>({...u,type:state.footLab.unitTypes[u.id]}));
  const checked=precheckAncientsRangedAttack({units,leaders:state.board.leaders,
    terrain:state.footLab.terrain??[],attackerId,targetId,movedSteps:gate.movedSteps,
    allowLoneLeader:state.diceLab?.version>=19,geometryId:state.scenario?.geometry});
  if(checked.status!=='CANDIDATE')return reject(checked.reason);
  const cardBonusDice=spartacusBonus(state);
  const diceCount=checked.diceAfterTerrain+cardBonusDice;
  if(diceCount<=0)return reject('NO_COMBAT_DICE');
  if(state.diceLab?.version>=19&&loneLeaderTargets(state).some(l=>l.id===targetId)){
    return {accepted:true,plan:{kind:'RANGED_PREVIEW',attackerId,targetId,distance:checked.distance,
      movedSteps:gate.movedSteps,baseDice:checked.baseDice,diceCount,
      ...(cardBonusDice?{cardBonusDice}:{}),targetUnitType:'LEADER',dieFaces:[...ANCIENTS_BATTLE_DIE_FACES],loneLeader:true}};
  }
  const dice=createRangedDicePlan({mode:'OFFICIAL_PREVIEW',screening:{ranged:{...checked,diceAfterTerrain:diceCount}},
    board:{units},targetId});
  if(!dice)return reject('RANGED_DICE_PLAN_UNAVAILABLE');
  return {accepted:true,plan:{kind:'RANGED_PREVIEW',attackerId,targetId,
    distance:checked.distance,movedSteps:gate.movedSteps,baseDice:checked.baseDice,
    diceCount:dice.diceCount,...(cardBonusDice?{cardBonusDice}:{}),targetUnitType:dice.targetUnitType,dieFaces:[...dice.dieFaces]}};
}

// V11: ordinary close combat. V12 adds ordinary unit evasion.
// The existing journal is the only authority; no client dice modifiers.
const lightEvaders=['LIGHT_INFANTRY','LIGHT_SLING_INFANTRY','LIGHT_BOW_INFANTRY','LIGHT_CAVALRY'];
const footAttackers=['LIGHT_INFANTRY','LIGHT_SLING_INFANTRY','LIGHT_BOW_INFANTRY','AUXILIA_INFANTRY',
  'WARRIOR_INFANTRY','MEDIUM_INFANTRY','HEAVY_INFANTRY','HEAVY_WAR_MACHINE'];
function unitEvadePaths(state,attacker,target){
  const at=state.footLab.unitTypes[attacker.id],tt=state.footLab.unitTypes[target.id];
  if(!lightEvaders.includes(tt)&&!(tt==='MEDIUM_CAVALRY'&&
    (footAttackers.includes(at)||['HEAVY_CAVALRY','HEAVY_CHARIOT','ELEPHANT'].includes(at)))&&
    !(tt==='HEAVY_CAVALRY'&&(footAttackers.includes(at)||at==='ELEPHANT'))&&
    !(state.diceLab.version>=17&&(tt==='HEAVY_WAR_MACHINE'||tt==='HEAVY_CHARIOT'&&(footAttackers.includes(at)||at==='ELEPHANT'))))return [];
  const {depth,neighbors}=geometryOf(state),sign=target.side==='A'?1:-1,rear=target.side==='A'?8:0;
  const attached=state.board.leaders.some(l=>l.side===target.side&&loc(l)===loc(target));
  const leaderAt=c=>state.board.leaders.find(l=>loc(l)===loc(c));
  const available=c=>!isRetreatBlockedHex(state.footLab.terrain??[],c)&&!(tt==='HEAVY_WAR_MACHINE'&&isMarshHex(state.footLab.terrain??[],c))&&!state.board.units.some(u=>loc(u)===loc(c))&&
    (!leaderAt(c)||(!attached&&leaderAt(c).side===target.side));
  const successors=c=>c.row===rear?[]:neighbors(c).filter(n=>sign*(depth(n)-depth(c))>0&&available(n));
  const full=[],short=[],join=[];
  for(const first of successors(target)){
    if(leaderAt(first)){join.push([first]);continue;}
    const second=successors(first);
    if(!second.length)short.push([first]);
    else for(const dest of second)full.push([first,dest]);
  }
  // One hex only when a two-hex route is unavailable, or joining a lone
  // friendly leader in the first hex. No passing through occupied cells.
  return [...(full.length?full:short),...join];
}
function screenClosePlan(state,attackerId,targetId,evadePath=undefined,battleBack=false,bonusClose=false,firstStrike=false){
  if(!(state.diceLab?.version>=11))return reject('CLOSE_COMBAT_NOT_AVAILABLE');
  if(!state.combatLab?.movementClosed||state.phase!=='LAB_RESOLUTION_PENDING')
    return reject('COMBAT_PHASE_NOT_AVAILABLE');
  if(state.diceLab.darken)return reject('DARKEN_CLOSE_FORBIDDEN');
  if(state.diceLab.moveFireMove)return reject('MFM_CLOSE_FORBIDDEN');
  const prior=state.diceLab.last;
  if(firstStrike){
    const original=state.diceLab.firstStrike?.original;
    if(!battleBack||bonusClose||!original||original.targetId!==attackerId||original.attackerId!==targetId)return reject('FIRST_STRIKE_NOT_AVAILABLE');
  }else if(battleBack){
    if(state.diceLab.version<13||!['CLOSE',...(state.diceLab.version>=15?['BONUS_CLOSE']:[])].includes(prior?.attackKind)||prior.outcome!=='DIRECT_HITS_APPLIED'||
       prior.targetId!==attackerId||prior.attackerId!==targetId||prior.unitEvasion||prior.retreat?.path.length)
      return reject('BATTLE_BACK_NOT_AVAILABLE');
  }else if(prior?.battleBackPending)return reject('BATTLE_BACK_PENDING');
  if(bonusClose&&!(state.diceLab.version>=15&&!battleBack&&prior?.attackKind==='CLOSE'&&
    prior.attackerId===attackerId&&prior.momentum?.bonusEligible&&prior.momentum.path?.length&&
    !prior.momentum.pending&&state.diceLab.resolvedUnitIds.includes(attackerId)))return reject('BONUS_CLOSE_NOT_AVAILABLE');
  const attacker=state.board.units.find(u=>u.id===attackerId);
  const target=combatTargets(state).find(u=>u.id===targetId);
  if(!validId(attackerId)||!validId(targetId)||!attacker||!target||
     (battleBack?attacker.side===state.turn||target.side!==state.turn:attacker.side!==state.turn||target.side===state.turn)||geometryOf(state).distance(attacker,target)!==1)
    return reject('INVALID_CLOSE_TARGET');
  const ordered=state.orderSnapshot.pieces.filter(p=>p.kind==='UNIT'&&p.side===state.turn).map(p=>p.id);
  const movedStepsByUnit=Object.fromEntries(ordered.map(id=>[id,state.combatLab.movement[id]?.steps??0]));
  const gate=battleBack||bonusClose?{status:'CANDIDATE',movedSteps:0}:screenAncientsCombatTurn({
    turnState:{schemaVersion:1,ruleset:ANCIENTS_RULESET,status:'ACTIVE',phase:'COMBAT',
      turn:state.turn,revision:state.revision,orderedUnitIds:ordered,
      resolvedBattleUnitIds:state.diceLab.resolvedUnitIds,movedStepsByUnit,
      pendingCombat:null,pendingDecision:null},
    sessionSide:state.turn,attackerId,targetId,expectedRevision:state.revision
  });
  if(gate.status!=='CANDIDATE')return reject(gate.reason);
  if(!battleBack&&!bonusClose&&state.combatLab.movement[attackerId]?.battle==='UNAVAILABLE')
    return reject('BATTLE_AFTER_MOVEMENT_UNAVAILABLE');
  const loneLeader=state.diceLab.version>=19&&loneLeaderTargets(state).some(l=>l.id===targetId);
  const attackerType=state.footLab.unitTypes[attackerId],targetUnitType=loneLeader?'LEADER':state.footLab.unitTypes[targetId];
  if((state.diceLab.version<16&&attackerType==='ELEPHANT')||(state.diceLab.version>=13&&state.diceLab.version<17&&attackerType==='HEAVY_CHARIOT'))return reject('CLOSE_COMBAT_SPECIAL_UNIT_PENDING');
  if(!['AUXILIA_INFANTRY','MEDIUM_INFANTRY','HEAVY_INFANTRY','WARRIOR_INFANTRY',
    ...(state.diceLab.version>=12?[...lightEvaders,'MEDIUM_CAVALRY','HEAVY_CAVALRY']:[]),
    ...(battleBack?['HEAVY_WAR_MACHINE']:[]),...(state.diceLab.version>=16?['ELEPHANT']:[]),...(state.diceLab.version>=17?['HEAVY_CHARIOT','HEAVY_WAR_MACHINE']:[]),...(loneLeader?['LEADER']:[])].includes(targetUnitType))
    return reject('CLOSE_COMBAT_SPECIAL_TARGET_PENDING');
  const terrainAt=p=>(state.footLab.terrain??[]).find(t=>loc(t)===loc(p))?.kind??'CLEAR';
  if([terrainAt(attacker),terrainAt(target)].some(isImpassableTerrain))return reject('IMPASSABLE_TERRAIN');
  // Warriors retain their full-strength dice for the response to this attack.
  const elephantAttack=state.diceLab.version>=16&&attackerType==='ELEPHANT';
  const elephantTarget=state.diceLab.version>=16&&targetUnitType==='ELEPHANT';
  const elephantMountedDefense=elephantTarget&&['LIGHT_CAVALRY','MEDIUM_CAVALRY','HEAVY_CAVALRY',...(state.diceLab.version>=17?['HEAVY_CHARIOT']:[])].includes(attackerType);
  const chariotDefense=state.diceLab.version>=17&&targetUnitType==='HEAVY_CHARIOT';
  const baseDice=elephantAttack?(loneLeader?1:['ELEPHANT','WARRIOR_INFANTRY','HEAVY_CHARIOT'].includes(targetUnitType)?3:baseCloseAttackDice(targetUnitType,state.diceLab.blocks[targetId])):
    state.diceLab.version>=17&&battleBack&&attackerType==='HEAVY_CHARIOT'?3:
    baseCloseAttackDice(attackerType,battleBack&&!firstStrike?prior.loss.originalBlocks:state.diceLab.blocks[attackerId]);
  const {maxDice,dicePenalty=0}=assessAncientsTerrainDiceCap({attackerType,attackerTerrain:terrainAt(attacker),
    targetTerrain:terrainAt(target),attackKind:'CLOSE'});
  // Card dice modify the terrain-limited total, never the base profile used
  // by an elephant mirroring its opponent. No bonus on defensive Battle Back.
  const attackCard=battleBack?null:attackCardEffect(state,attackerId);
  const cardBonusDice=attackCard==='MOUNTED_CHARGE'?1:attackCard==='CLASH_OF_SHIELDS'&&!bonusClose?2:battleBack?0:spartacusBonus(state);
  const diceCount=Math.max(0,Math.min(baseDice-dicePenalty,maxDice??baseDice))+cardBonusDice;
  if(diceCount<=0)return reject('NO_COMBAT_DICE');
  const fortificationDefense=fortificationProtects(state.footLab.terrain??[],attacker,target,targetUnitType,state.scenario?.geometry);
  const swordsHit=!loneLeader&&!elephantTarget&&!['LIGHT_INFANTRY','LIGHT_SLING_INFANTRY','LIGHT_BOW_INFANTRY',
    'LIGHT_CAVALRY','HEAVY_WAR_MACHINE'].includes(attackerType);
  const leaderHit=loneLeader||!elephantAttack&&(isSacredBand(state,attacker.id)||state.board.leaders.some(l=>l.side===attacker.side&&geometryOf(state).distance(l,attacker)<=1));
  const evadeOptions=state.diceLab.version>=12&&!battleBack&&!loneLeader?unitEvadePaths(state,attacker,target):[];
  const choice=evadePath===undefined?(evadeOptions.length?null:[]):evadePath;
  if(state.diceLab.version>=12&&!(choice===null&&evadeOptions.length||
     Array.isArray(choice)&&(!choice.length||evadeOptions.some(p=>JSON.stringify(p)===JSON.stringify(choice)))))
    return reject('INVALID_UNIT_EVADE_PATH');
  return {accepted:true,plan:{kind:'CLOSE_PREVIEW',attackerId,targetId,distance:1,
    movedSteps:gate.movedSteps,baseDice,diceCount,
    ...(fortificationDefense?{fortificationDefense:true}:{}),
    ...(cardBonusDice?{cardBonusDice}:{}),
    targetUnitType,dieFaces:[...ANCIENTS_BATTLE_DIE_FACES],swordsHit,leaderHit,
    ...(state.diceLab.version>=12?{evadeOptions,evadePath:choice}:{}),
    ...(battleBack?{battleBack:true}:{}),...(bonusClose?{bonusClose:true}:{}),...(firstStrike?{firstStrike:true}:{}),
    ...(elephantAttack?{elephantAttack:true}:{}),...(elephantMountedDefense?{elephantMountedDefense:true}:{}),...(chariotDefense?{chariotDefense:true}:{}),...(loneLeader?{loneLeader:true}:{})}};
}

function bonusCloseCandidates(state){
  const last=state.diceLab?.last;
  if(!last?.momentum?.bonusPending||state.combatLab.plan)return [];
  return combatTargets(state).filter(u=>u.side!==state.turn).flatMap(u=>{
    const checked=screenClosePlan(state,last.attackerId,u.id,undefined,false,true);
    return checked.accepted?[{kind:'CLOSE_PREVIEW',bonusClose:true,attackerId:last.attackerId,
      targetId:u.id,diceCount:checked.plan.diceCount,...(checked.plan.loneLeader?{loneLeader:true}:{})}]:[];
  });
}

/** Verify complete card conservation and the minimal internal lab contract. */
export function assertSectionHistoryLab(s){
  if(!isRecord(s)||s.kind!==SECTION_HISTORY_LAB_KIND||s.schemaVersion!==1||
     !Number.isSafeInteger(s.revision)||s.revision<0||!SIDES.includes(s.turn)||
     !['AWAIT_CARD','ASSIGN_ORDERS','LAB_RESOLUTION_PENDING'].includes(s.phase)||
     !Number.isSafeInteger(s.totalCards)||s.totalCards<2||s.totalCards>128||
     !isCards(s.drawPile,s.diceLab?.version)||!isCards(s.discardPile,s.diceLab?.version)||!isRecord(s.hands)||
     !SIDES.every(side=>isCards(s.hands[side],s.diceLab?.version))||
     !(s.activeCard===null||isCards([s.activeCard],s.diceLab?.version))||
     !isRecord(s.board)||!isRecord(s.sectorCells)||
     (Object.hasOwn(s,'scenario')&&!validScenarioMetadata(s.scenario))||
     (Object.hasOwn(s,'sectorPerspective')&&s.sectorPerspective!=='PLAYER_RELATIVE'))
     fail('INVALID_SECTION_HISTORY_STATE');
  if(s.scenario?.geometry===OFFICIAL_BOARD_GEOMETRY&&(!s.footLab||!s.diceLab||s.diceLab.version<31||s.sectorPerspective!=='PLAYER_RELATIVE'))fail('OFFICIAL_GEOMETRY_REQUIRES_FULL_LAB');
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
         Object.hasOwn(info,'terrain')?info.terrain:[],Object.hasOwn(s,'leaderLab'),s.diceLab?.version>=10&&s.revision>0,s.diceLab?.version>=16,s.diceLab?.version>=17,geometryOf(s))||
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
         (Object.keys(m).length!==2&&!(Object.keys(m).length===3&&m.buildingMove===true&&m.steps===1&&s.footLab.terrain?.some(t=>t.kind==='BUILDING')))||!Number.isSafeInteger(m.steps)||
         m.steps<1||m.steps>4||!['POSSIBLE','UNAVAILABLE',...(s.diceLab?.version>=18&&(m.steps===2||s.diceLab.version>=23&&m.steps===3&&effectiveSectionCard(s)==='DOUBLE_TIME')&&(s.footLab.unitTypes[id]==='WARRIOR_INFANTRY'||!s.board.units.some(u=>u.id===id))?['MANDATORY_CLOSE_COMBAT']:[])].includes(m.battle))||
       (c.plan!==null&&!c.movementClosed))fail('INVALID_COMBAT_LAB_STATE');
    if(c.plan!==null){
      const checked=(c.plan.kind==='CLOSE_PREVIEW'?screenClosePlan:screenRangedPlan)(s,c.plan.attackerId,c.plan.targetId,c.plan.evadePath,c.plan.battleBack===true,c.plan.bonusClose===true,c.plan.firstStrike===true);
      if(!checked.accepted||JSON.stringify(checked.plan)!==JSON.stringify(c.plan))
        fail('INVALID_COMBAT_LAB_PLAN');
    }
  }
  if(s.diceLab?.last?.momentum?.bonusPending&&!bonusCloseCandidates(s).length)fail('INVALID_COMBAT_LAB_PLAN');
  if(s.diceLab?.version>=30){
    const c=s.diceLab.counter,validEffect=id=>id===null||(id!=='COUNTER_ATTACK'&&id!=='FIRST_STRIKE'&&isCards([{instanceId:'effect',definitionId:id}],29));
    if(!isRecord(c)||Object.keys(c).length!==4||!validEffect(c.previous)||!validEffect(c.effect)||
      ![null,'LEFT','CENTER','RIGHT'].includes(c.previousSection)||![null,'LEFT','CENTER','RIGHT'].includes(c.section)||
      (c.effect!==null)!==(s.activeCard?.definitionId==='COUNTER_ATTACK')||
      (c.effect!==null&&c.effect!==counteredDefinition(c.previous))||
      (c.previousSection!==null&&c.previous!=='LEADERSHIP_ANY_SECTION')||
      (c.section!==null&&effectiveSectionCard(s)!=='LEADERSHIP_ANY_SECTION'))fail('INVALID_COUNTER_ATTACK_STATE');
  }
  if(s.diceLab?.version>=31){
    const f=s.diceLab.firstStrike,p=s.combatLab.plan;
    if(!isRecord(f)||Object.keys(f).length!==5||typeof f.window!=='boolean'||typeof f.suppress!=='boolean'||
      !Number.isSafeInteger(f.replacements)||f.replacements<0||f.replacements>20||
      (f.window&&(!p||p.kind!=='CLOSE_PREVIEW'||p.battleBack||p.loneLeader||s.diceLab.pending||f.suppress))||
      (f.original!==null&&(!isRecord(f.original)||!p?.firstStrike||f.window||f.suppress))||
      (!!p?.firstStrike!==(f.original!==null))||
      (f.prior!==null&&(!isRecord(f.prior)||!f.original?.bonusClose))||
      (f.suppress&&(!p||p.kind!=='CLOSE_PREVIEW'||p.battleBack||f.window))||
      (s.phase!=='LAB_RESOLUTION_PENDING'&&(f.window||f.original!==null||f.prior!==null||f.suppress||f.replacements)))fail('INVALID_FIRST_STRIKE_STATE');
  }
  if(s.footLab?.terrain?.some(t=>t.kind==='MARSH')&&s.diceLab?.version!==32)fail('MARSH_REQUIRES_FULL_COMBAT_LAB');
  if(Object.hasOwn(s,'victoryObjectives')&&(!s.diceLab?.victoryTargets||!validScenarioObjectives(s.victoryObjectives,s.footLab.terrain,s.scenario?.geometry)))fail('INVALID_SECTION_SCENARIO_OBJECTIVES');
  if(Object.hasOwn(s,'scenarioRules')&&!validScenarioRules(s.scenarioRules,s))fail('INVALID_SCENARIO_RULES');
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
  if(sectionVictory(state)?.winner)return reject('MATCH_FINISHED');
  if(state.revision>=sectionHistoryCommandLimit(state))return reject('SECTION_HISTORY_LIMIT_REACHED');
  // Defensive review and mandatory leader evasion belong to the opponent.
  // All other commands require the acting side.
  const actingSide=SECTION_DICE_COMMANDS.includes(command.type)?sectionCombatSide(state):state.turn;
  if(state.diceLab?.marshPending&&command.type!=='EVADE_SECTION_LEADER_LAB')return reject('MARSH_LEADER_EVASION_PENDING');
  if(command.actor!==actingSide&&!['REVIEW_SECTION_RANGED_PHYSICAL_LAB',
    'EVADE_SECTION_LEADER_LAB','CHOOSE_SECTION_ELEPHANT_RED_LAB','CHOOSE_SECTION_MORALE_LAB','RETREAT_SECTION_UNIT_LAB','EVADE_SECTION_RAMPAGE_LEADER_LAB','DECLINE_SECTION_BATTLE_BACK_LAB','ACCEPT_SECTION_BATTLE_BACK_LAB','CHOOSE_SECTION_UNIT_EVADE_LAB','ACCEPT_SECTION_FIRST_STRIKE_LAB','DECLINE_SECTION_FIRST_STRIKE_LAB'].includes(command.type))
    return reject('NOT_YOUR_TURN');
  if(state.diceLab?.version>=24&&effectiveSectionCard(state)==='CLASH_OF_SHIELDS'&&['MOVE_SECTION_FOOT_PATH_V2','MOVE_SECTION_MOUNTED_PATH_V1','MOVE_SECTION_LEADER_PATH_V1'].includes(command.type))return reject('CLASH_MOVEMENT_FORBIDDEN');
  if(state.diceLab?.darken&&['MOVE_SECTION_FOOT_PATH_V2','MOVE_SECTION_MOUNTED_PATH_V1','MOVE_SECTION_LEADER_PATH_V1'].includes(command.type))return reject('DARKEN_MOVEMENT_FORBIDDEN');
  if(state.combatLab?.movementClosed&&state.diceLab?.moveFireMove!=='SECOND'&&['MOVE_SECTION_FOOT_PATH_V2',
    'MOVE_SECTION_MOUNTED_PATH_V1','MOVE_SECTION_LEADER_PATH_V1'].includes(command.type))
    return reject('MOVEMENT_PHASE_CLOSED');
  if(state.diceLab?.firstStrike?.window&&!['ACCEPT_SECTION_FIRST_STRIKE_LAB','DECLINE_SECTION_FIRST_STRIKE_LAB'].includes(command.type))return reject('FIRST_STRIKE_DECISION_PENDING');
  if(!state.diceLab?.marshPending&&state.diceLab?.last?.battleBackPending&&!['DECLINE_SECTION_BATTLE_BACK_LAB','ACCEPT_SECTION_BATTLE_BACK_LAB'].includes(command.type))
    return reject('BATTLE_BACK_PENDING');
  if(!state.diceLab?.marshPending&&state.diceLab?.last?.momentum?.pending&&command.type!=='CHOOSE_SECTION_MOMENTUM_LAB')
    return reject('MOMENTUM_DECISION_PENDING');
  if(!state.diceLab?.marshPending&&state.diceLab?.last?.momentum?.bonusPending&&!['PREPARE_SECTION_CLOSE_LAB','DECLINE_SECTION_BONUS_CLOSE_LAB'].includes(command.type))
    return reject('BONUS_CLOSE_DECISION_PENDING');
  const next=copy(state),side=command.actor;
  let publicEvent;
  if(state.diceLab?.marshPending){
    const result=resolveMarshLeaderEvasion(state,next,command);
    if(!result.accepted)return result;
    publicEvent=result.event;
  }else if(command.type==='PLAY_SECTION_CARD'){
    if(state.phase!=='AWAIT_CARD'||!validId(command.cardInstanceId))return reject('WRONG_PHASE_OR_CARD');
    const index=next.hands[side].findIndex(c=>c.instanceId===command.cardInstanceId);
    if(index<0)return reject('CARD_NOT_IN_OWN_HAND');
    if(next.hands[side][index].definitionId==='COUNTER_ATTACK'&&!next.diceLab?.counter?.previous)return reject('COUNTER_ATTACK_NO_PREVIOUS_CARD');
    next.handAtPlay={side,revision:state.revision,cards:copy(next.hands[side])};
    const card=next.hands[side].splice(index,1)[0];
    next.activeCard=card;
    if(card.definitionId==='COUNTER_ATTACK'){
      const c=next.diceLab.counter;
      c.effect=counteredDefinition(c.previous);
      c.section=c.effect==='LEADERSHIP_ANY_SECTION'&&c.previousSection
        ?(state.sectorPerspective==='PLAYER_RELATIVE'?reversedSection(c.previousSection):c.previousSection):null;
    }
    const effect=effectiveSectionCard(next);
    next.cardPlay={side,revision:state.revision+1,instanceId:card.instanceId,definitionId:card.definitionId};
    next.phase='ASSIGN_ORDERS';
    publicEvent={kind:'SECTION_CARD_PLAYED_LAB',side,definitionId:card.definitionId,...(card.definitionId==='COUNTER_ATTACK'?{effectiveDefinitionId:effect}: {})};
    if(next.diceLab?.version>=28&&effect==='RALLY'&&next.board.leaders.some(l=>l.side===side)){
      const draw=sectionRollIndex(next.diceLab.key,'section_rally_'+(state.revision+1));
      next.diceLab.rallyFaces=Array.from({length:next.handAtPlay.cards.length},()=>ANCIENTS_BATTLE_DIE_FACES[draw(6)]);
      publicEvent.rallyFaces=copy(next.diceLab.rallyFaces);
    }
    if(next.diceLab?.version>=29&&effect==='I_AM_SPARTACUS'){
      const draw=sectionRollIndex(next.diceLab.key,'section_spartacus_'+(state.revision+1));
      next.diceLab.spartacusFaces=Array.from({length:next.handAtPlay.cards.length},()=>ANCIENTS_BATTLE_DIE_FACES[draw(6)]);
      publicEvent.spartacusFaces=copy(next.diceLab.spartacusFaces);
    }
  }else if(['ASSIGN_SECTION_ORDERS','ASSIGN_SECTION_RALLY_LAB'].includes(command.type)){
    if(state.phase!=='ASSIGN_ORDERS')return reject('WRONG_PHASE');
    const rally=state.diceLab?.version>=28&&effectiveSectionCard(state)==='RALLY'?rallySelection(state,side):null;
    const special=command.type==='ASSIGN_SECTION_RALLY_LAB';
    if(special!==!!rally?.rallyOptions)return reject('RALLY_ASSIGNMENT_REQUIRED');
    const recovered=special?allocateRally(state,rally,command.allocations):null;
    if(special&&!recovered)return reject('INVALID_RALLY_ALLOCATION');
    const {unitIds,leaderIds}=special?{unitIds:recovered.unitIds,leaderIds:[]}:command;
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
    const perspective=relativeSectors(state,side);
    const proof={side,revision:state.revision+1,pieces,
      sectorCells:perspective};
    const selection=currentSelectionCard(state,side,perspective);
    const screened=selection?{status:screenSelectionCardOrders(selection,pieces,perspective,state.scenario?.geometry)?'CANDIDATE':'BLOCKED'}:screenBaseAncientsSectionCardOrders({
      turnState:{schemaVersion:1,ruleset:'ancients-base-3e-2009',status:'ACTIVE',
        phase:'COMBAT',turn:side,revision:state.revision+1,
        orderedUnitIds:[...unitIds],orderedLeaderIds:[...leaderIds]},
      sessionSide:side,expectedRevision:state.revision+1,
      handAtPlay:state.handAtPlay,cardPlay:state.cardPlay,orderSnapshot:proof,effectiveDefinitionId:effectiveSectionCard(state),geometryId:state.scenario?.geometry
    });
    if(screened.status!=='CANDIDATE'||selection?.family==='SPARTACUS'&&!spartacusOrdersFit(state,selection,pieces))return reject('ORDERS_NOT_ELIGIBLE');
    next.orderSnapshot=proof;
    if(next.diceLab?.counter&&effectiveSectionCard(state)==='LEADERSHIP_ANY_SECTION'&&!next.diceLab.counter.section)
      next.diceLab.counter.section=leadershipSection(selection,pieces,perspective,state.scenario?.geometry);
    if(selection?.family==='SPARTACUS')next.diceLab.spartacusFaces=null;
    if(recovered){next.diceLab.blocks=recovered.blocks;next.diceLab.rallyFaces=null;}
    if(selection?.family==='DARKEN'&&!selection.fallback)next.diceLab.darken={twice:[]};
    if(selection?.family==='MOVE_FIRE_MOVE'&&!selection.fallback)next.diceLab.moveFireMove='FIRST';
    next.phase='LAB_RESOLUTION_PENDING';
    publicEvent={kind:'SECTION_ORDERS_STAGED_LAB',side,unitCount:unitIds.length,
      leaderCount:leaderIds.length,...(recovered?{rallyAllocations:copy(command.allocations)}:{})};
  }else if(command.type==='DEPLOY_SCENARIO_RESERVE'){
    const available=ambushOptions(state,side),option=available?.options.find(o=>o.section===command.section);
    const placements=command.placements;
    if(!option||!Array.isArray(placements)||placements.length!==3||!same(placements.map(p=>p?.unitId))||
       !same(placements.map(p=>p?.col))||!placements.every(p=>isRecord(p)&&Object.keys(p).length===2&&available.units.some(u=>u.id===p.unitId)&&option.cells.some(c=>c.col===p.col))||
       !placements.some(p=>p.unitId===command.leaderUnitId))return reject('INVALID_SCENARIO_RESERVE');
    const row=side==='A'?0:8,pieces=[];
    for(const p of placements){
      const u=available.units.find(x=>x.id===p.unitId),unit={id:u.id,side,col:p.col,row};
      next.board.units.push(unit);next.footLab.unitTypes[u.id]=u.type;next.diceLab.blocks[u.id]=BASE_UNIT_STARTING_BLOCKS[u.type];
      next.footLab.movedUnitIds.push(u.id);next.combatLab.movement[u.id]={steps:1,battle:reserveEntryBattle(state,u.type,unit)};
      pieces.push({...unit,kind:'UNIT'});
    }
    const host=placements.find(p=>p.unitId===command.leaderUnitId);
    next.board.leaders.push({id:available.leaderId,side,col:host.col,row});
    next.leaderLab.movedLeaderIds.push(available.leaderId);
    next.scenarioRules.reserve.enteredTurn=state.scenarioRules.turns[side];
    next.orderSnapshot={side,revision:state.revision+1,pieces,sectorCells:relativeSectors(state,side)};
    if(effectiveSectionCard(state)==='LEADERSHIP_ANY_SECTION')next.diceLab.counter.section=command.section;
    next.phase='LAB_RESOLUTION_PENDING';
    publicEvent={kind:'SCENARIO_RESERVE_DEPLOYED',side,section:command.section,placements:copy(placements),leaderUnitId:command.leaderUnitId};
  }else if(['MOVE_SECTION_FOOT_PATH_V2','MOVE_SECTION_MOUNTED_PATH_V1'].includes(command.type)&&reserveCanContinue(state,command.unitId)){
    const piece=state.board.units.find(u=>u.id===command.unitId),path=command.path;
    if(!piece||piece.side!==side||state.phase!=='LAB_RESOLUTION_PENDING'||state.combatLab.movementClosed||!Array.isArray(path)||!path.length||
       !scenarioPath(state,piece,path,path.length+1))return reject('INVALID_RESERVE_CONTINUATION');
    const type=state.footLab.unitTypes[piece.id];
    if((command.type==='MOVE_SECTION_MOUNTED_PATH_V1')!==BASE_MOUNTED_TYPES.includes(type))return reject('INVALID_RESERVE_CONTINUATION');
    // Entry from off board already spent a movement step. Building entry
    // consumes the entire one-step movement, including that earlier step.
    if(state.scenarioRules.reserve.rule.entryTerrainPolicy===RESERVE_ENTRY_TERRAIN_POLICY&&path.some(c=>isBuildingHex(state.footLab.terrain,c)))
      return reject('INVALID_RESERVE_CONTINUATION');
    const to=path.at(-1),battle=assessBaseMovement({unitType:type,steps:path.length+1}).battle;
    const terrain=assessAncientsTerrainMovement({unitType:type,origin:piece,path,terrain:state.footLab.terrain??[],geometryId:state.scenario?.geometry});
    if(battle==='MANDATORY_CLOSE_COMBAT'&&(terrain.battleOnEntry==='UNAVAILABLE'||!combatTargets(state).some(u=>u.side!==side&&geometryOf(state).distance(u,to)===1)))return reject('WARRIOR_CHARGE_TARGET_REQUIRED');
    Object.assign(next.board.units.find(u=>u.id===piece.id),to);
    const leader=next.board.leaders.find(l=>l.side===side&&loc(l)===loc(piece));if(leader)Object.assign(leader,to);
    next.combatLab.movement[piece.id]={steps:path.length+1,battle:terrain.battleOnEntry==='UNAVAILABLE'?'UNAVAILABLE':battle};
    publicEvent={kind:'SCENARIO_RESERVE_MOVED',side,unitId:piece.id,path:copy(path),to:copy(to)};
  }else if(command.type==='EXIT_SCENARIO_UNIT'){
    const piece=state.board.units.find(u=>u.id===command.unitId&&u.side===side),path=command.path;
    if(!piece||state.phase!=='LAB_RESOLUTION_PENDING'||(state.combatLab.movementClosed&&state.diceLab?.moveFireMove!=='SECOND')||
       !state.orderSnapshot.pieces.some(p=>p.kind==='UNIT'&&p.id===piece.id)||state.footLab.movedUnitIds.includes(piece.id)||state.leaderLab.joinedUnitIds.includes(piece.id)||
       ['CLASH_OF_SHIELDS','DARKEN_THE_SKY'].includes(effectiveSectionCard(state))||!Array.isArray(path)||
       !exitRule(state,side,path.at(-1)??piece)||!scenarioPath(state,piece,path,path.length+1,true))return reject('INVALID_SCENARIO_EXIT');
    const leader=state.board.leaders.find(l=>l.side===side&&loc(l)===loc(piece));
    if(leader&&state.leaderLab.movedLeaderIds.includes(leader.id))return reject('UNIT_LOCKED_BY_LEADER_MOVE');
    next.board.units=next.board.units.filter(u=>u.id!==piece.id);delete next.footLab.unitTypes[piece.id];delete next.diceLab.blocks[piece.id];
    if(leader)next.board.leaders=next.board.leaders.filter(l=>l.id!==leader.id);
    next.scenarioRules.unitExit.exited.push(piece.id);
    next.footLab.movedUnitIds.push(piece.id);next.combatLab.movement[piece.id]={steps:path.length+1,battle:'UNAVAILABLE'};
    publicEvent={kind:'SCENARIO_UNIT_EXITED',side,unitId:piece.id,path:copy(path),...(leader?{leaderExited:leader.id}:{}),banners:state.scenarioRules.unitExit.rule.banners};
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
    const special=state.diceLab?.version>=18&&(geometryOf(state).id===OFFICIAL_BOARD_GEOMETRY||['WARRIOR_INFANTRY','HEAVY_WAR_MACHINE'].includes(state.footLab.unitTypes[command.unitId])||mayPassFriendlyFoot(state,command.unitId)||groupFootCard(state,command.unitId));
    const result=special?previewSpecialFootMove(state,command):reduceCoreOpenFootPath({
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
      path:command.path,terrain:state.footLab.terrain??[],geometryId:state.scenario?.geometry
    });
    if(terrain.status!=='CANDIDATE')
      return reject(terrain.reason??'FOOT_LAB_TERRAIN_BLOCKED');
    if(special&&result.transition.battleAfterMovement==='MANDATORY_CLOSE_COMBAT'&&terrain.battleOnEntry==='UNAVAILABLE')return reject('WARRIOR_CHARGE_TERRAIN_BLOCKED');
    const battleAfterMovement=terrain.battleOnEntry==='UNAVAILABLE'
      ? 'UNAVAILABLE':result.transition.battleAfterMovement;
    // The reducer determines every changed cell and public event field.
    // A client cannot supply its own board, rules or movement result.
    next.board.units=result.nextState.board.units;
    next.footLab.movedUnitIds=result.nextState.orderLedger.movedUnitIds;
    if(next.combatLab)next.combatLab.movement[command.unitId]={
      steps:command.path.length,battle:battleAfterMovement==='MANDATORY_CLOSE_COMBAT'?'MANDATORY_CLOSE_COMBAT':battleAfterMovement==='POSSIBLE'?'POSSIBLE':'UNAVAILABLE',
      ...(isBuildingHex(state.footLab.terrain??[],moving)||terrain.destinationTerrain==='BUILDING'?{buildingMove:true}:{})
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
    if(!Array.isArray(command.path))return reject('INVALID_MOUNTED_PATH');
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
    },{mountedCharge:attackCardEffect(state,piece.id)==='MOUNTED_CHARGE',geometryId:state.scenario?.geometry});
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
    if(host&&state.diceLab?.version>=25&&Object.hasOwn(LEADERSHIP_CARD_DEFINITIONS,effectiveSectionCard(state)))
      return reject('LEADERSHIP_DETACH_FORBIDDEN');
    if(host&&state.footLab.movedUnitIds.includes(host.id))
      return reject('ATTACHED_UNIT_ALREADY_MOVED');
    let candidate;
    try{
      candidate=precheckAncientsLeaderPath({
        units:state.board.units,leaders:state.board.leaders,
        leaderId:leader.id,path:command.path,terrain:state.footLab.terrain??[],geometryId:state.scenario?.geometry
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
    if(!state.combatLab||state.phase!=='LAB_RESOLUTION_PENDING')return reject('COMBAT_PHASE_NOT_AVAILABLE');
    if(state.combatLab.movementClosed){
      if(state.diceLab?.moveFireMove!=='FIRST')return reject('COMBAT_PHASE_NOT_AVAILABLE');
      if(state.combatLab.plan||state.diceLab.pending)return reject('COMBAT_PLAN_PENDING');
      // Keep combat permanently closed to further declarations, but reset
      // the per-movement allowance, including attached leaders.
      next.diceLab.moveFireMove='SECOND';
      // Building movement consumes the entire turn, not just the first MFM leg.
      next.combatLab.movement=Object.fromEntries(Object.entries(next.combatLab.movement).filter(([,m])=>m.buildingMove));
      next.footLab.movedUnitIds=Object.keys(next.combatLab.movement);
      next.leaderLab.movedLeaderIds=next.leaderLab.movedLeaderIds.filter(id=>next.board.units.some(u=>next.footLab.movedUnitIds.includes(u.id)&&next.board.leaders.some(l=>l.id===id&&loc(l)===loc(u))));
      next.leaderLab.joinedUnitIds=[];
      publicEvent={kind:'SECTION_SECOND_MOVEMENT_OPENED_LAB',side};
    }else{
      next.combatLab.movementClosed=true;
      publicEvent={kind:'SECTION_MOVEMENT_CLOSED_LAB',side};
    }
  }else if(command.type==='PREPARE_SECTION_RANGED_LAB'){
    if(state.combatLab?.plan)return reject('COMBAT_PLAN_PENDING');
    const checked=screenRangedPlan(state,command.attackerId,command.targetId);
    if(!checked.accepted)return checked;
    next.combatLab.plan=checked.plan;
    publicEvent={kind:'SECTION_RANGED_PREPARED_LAB',side,...checked.plan,combatResolved:false};
  }else if(command.type==='PREPARE_SECTION_CLOSE_LAB'){
    if(state.combatLab?.plan)return reject('COMBAT_PLAN_PENDING');
    const bonusClose=!!state.diceLab?.last?.momentum?.bonusPending;
    const checked=screenClosePlan(state,command.attackerId,command.targetId,undefined,false,bonusClose);
    if(!checked.accepted)return checked;
    next.combatLab.plan=checked.plan;
    if(bonusClose)next.diceLab.last.momentum.bonusPending=false;
    if(next.diceLab.firstStrike&&!checked.plan.loneLeader)next.diceLab.firstStrike.window=true;
    publicEvent={kind:bonusClose?'SECTION_BONUS_CLOSE_PREPARED_LAB':'SECTION_CLOSE_PREPARED_LAB',side,...checked.plan,combatResolved:false};
  }else if(['ACCEPT_SECTION_FIRST_STRIKE_LAB','DECLINE_SECTION_FIRST_STRIKE_LAB'].includes(command.type)){
    const f=state.diceLab?.firstStrike,plan=state.combatLab?.plan;
    if(!f?.window||side===state.turn||!plan)return reject('FIRST_STRIKE_NOT_AVAILABLE');
    next.diceLab.firstStrike.window=false;
    if(command.type==='DECLINE_SECTION_FIRST_STRIKE_LAB'){
      publicEvent={kind:'SECTION_FIRST_STRIKE_DECLINED_LAB',side};
    }else{
      const index=next.hands[side].findIndex(c=>c.definitionId==='FIRST_STRIKE');
      if(index<0)return reject('FIRST_STRIKE_CARD_REQUIRED');
      const reaction=next.diceLab.firstStrike;
      reaction.original=copy(plan);
      reaction.prior=plan.bonusClose?copy(state.diceLab.last):null;
      const reversed=screenClosePlan(next,plan.targetId,plan.attackerId,[],true,false,true);
      if(!reversed.accepted)return reversed;
      next.discardPile.push(next.hands[side].splice(index,1)[0]);
      reaction.replacements++;
      next.combatLab.plan=reversed.plan;
      publicEvent={kind:'SECTION_FIRST_STRIKE_PREPARED_LAB',side,...reversed.plan};
    }
  }else if(command.type==='CHOOSE_SECTION_UNIT_EVADE_LAB'){
    const plan=state.combatLab?.plan;
    if(side===state.turn||plan?.kind!=='CLOSE_PREVIEW'||plan.evadePath!==null||
       !plan.evadeOptions?.length||state.diceLab?.pending)return reject('UNIT_EVADE_NOT_AVAILABLE');
    if(!Array.isArray(command.path)||command.path.length>2||
       !command.path.every(c=>isRecord(c)&&Object.keys(c).length===2&&goodLoc(c,geometryOf(state))))
      return reject('INVALID_UNIT_EVADE_PATH');
    const path=command.path.map(c=>({col:c.col,row:c.row}));
    const checked=screenClosePlan(state,plan.attackerId,plan.targetId,path,false,plan.bonusClose===true);
    if(!checked.accepted)return checked;
    next.combatLab.plan=checked.plan;
    publicEvent={kind:'SECTION_UNIT_EVADE_CHOSEN_LAB',side,targetId:plan.targetId,path,
      evading:path.length>0};
  }else if(command.type==='ACCEPT_SECTION_BATTLE_BACK_LAB'){
    const last=state.diceLab?.last;
    if(!(state.diceLab?.version>=13)||!last?.battleBackPending||side===state.turn||state.combatLab.plan)
      return reject('BATTLE_BACK_NOT_AVAILABLE');
    const checked=screenClosePlan(state,last.targetId,last.attackerId,[],true);
    if(!checked.accepted)return checked;
    next.diceLab.last.battleBackPending=false;
    next.combatLab.plan=checked.plan;
    publicEvent={kind:'SECTION_BATTLE_BACK_PREPARED_LAB',side,...checked.plan,combatResolved:false};
  }else if(command.type==='DECLINE_SECTION_BATTLE_BACK_LAB'){
    if(!(state.diceLab?.version>=11)||!state.diceLab?.last?.battleBackPending||side===state.turn)
      return reject('BATTLE_BACK_NOT_AVAILABLE');
    next.diceLab.last.battleBackPending=false;
    publicEvent={kind:'SECTION_BATTLE_BACK_DECLINED_LAB',side,
      attackerId:state.diceLab.last.targetId,targetId:state.diceLab.last.attackerId};
  }else if(command.type==='CHOOSE_SECTION_MOMENTUM_LAB'){
    const last=state.diceLab?.last;
    if(!(state.diceLab?.version>=14)||!last?.momentum?.pending||side!==state.turn||state.combatLab.plan)
      return reject('MOMENTUM_NOT_AVAILABLE');
    if(!Array.isArray(command.path)||command.path.length>2||
      !command.path.every(c=>isRecord(c)&&Object.keys(c).length===2&&goodLoc(c,geometryOf(state))))
      return reject('INVALID_MOMENTUM_PATH');
    const path=command.path.map(c=>({col:c.col,row:c.row}));
    const option=path.length?sectionMomentumOptions(state).find(o=>JSON.stringify(o.path)===JSON.stringify(path)):null;
    if(path.length&&!option)return reject('INVALID_MOMENTUM_PATH');
    const unit=next.board.units.find(u=>u.id===last.attackerId);
    const from={col:unit.col,row:unit.row};
    const attached=next.board.leaders.find(l=>l.side===side&&loc(l)===loc(unit));
    if(option){
      Object.assign(unit,path.at(-1));
      if(attached)Object.assign(attached,path.at(-1));
    }
    next.diceLab.last.momentum={hex:copy(last.momentum.hex),pending:false,path,
      bonusEligible:option?.bonusEligible??false,
      ...(option&&(isBuildingHex(state.footLab.terrain??[],from)||isBuildingHex(state.footLab.terrain??[],path.at(-1)))?{buildingMove:true}:{})};
    if(state.diceLab.version>=15&&option?.bonusEligible){
      next.diceLab.last.momentum.bonusPending=true;
      if(!bonusCloseCandidates(next).length)next.diceLab.last.momentum.bonusPending=false;
    }
    publicEvent={kind:path.length?'SECTION_MOMENTUM_APPLIED_LAB':'SECTION_MOMENTUM_DECLINED_LAB',
      side,unitId:unit.id,from,to:{col:unit.col,row:unit.row},path,
      ...(option&&attached?{leaderCarried:attached.id}:{}),bonusEligible:option?.bonusEligible??false};
  }else if(command.type==='DECLINE_SECTION_BONUS_CLOSE_LAB'){
    if(!state.diceLab?.last?.momentum?.bonusPending)return reject('BONUS_CLOSE_NOT_AVAILABLE');
    next.diceLab.last.momentum.bonusPending=false;
    publicEvent={kind:'SECTION_BONUS_CLOSE_DECLINED_LAB',side,unitId:state.diceLab.last.attackerId};
  }else if(SECTION_DICE_COMMANDS.includes(command.type)){
    const result=applySectionDiceCommand(state,next,command);
    if(!result.accepted)return result;
    publicEvent=result.event;
  }else if(command.type==='CANCEL_SECTION_RANGED_LAB'){
    if(state.diceLab?.firstStrike?.suppress||state.combatLab?.plan?.battleBack||state.combatLab?.plan?.bonusClose||state.combatLab?.plan?.evadeOptions?.length)return reject('CLOSE_ATTACK_DECLARED');
    if(state.diceLab?.pending)return reject('RANGED_ROLL_ALREADY_CAPTURED');
    if(!state.combatLab?.plan)return reject('NO_COMBAT_PLAN_PENDING');
    next.combatLab.plan=null;
    publicEvent={kind:state.combatLab.plan.kind==='CLOSE_PREVIEW'?'SECTION_CLOSE_CANCELLED_LAB':'SECTION_RANGED_CANCELLED_LAB',side};
  }else if(command.type==='END_EXPERIMENTAL_TURN'){
    if(state.combatLab?.plan)return reject('COMBAT_PLAN_PENDING');
    if(state.phase!=='LAB_RESOLUTION_PENDING')return reject('WRONG_PHASE');
    if(pendingWarriorCharges(state).length)return reject('WARRIOR_CHARGE_COMBAT_REQUIRED');
    if(next.diceLab?.counter){
      const c=next.diceLab.counter;c.previous=effectiveSectionCard(state)==='FIRST_STRIKE'?null:effectiveSectionCard(state);c.previousSection=c.previous==='LEADERSHIP_ANY_SECTION'?c.section:null;c.effect=null;c.section=null;
    }
    next.discardPile.push(next.activeCard);
    next.activeCard=null;
    // An initially empty deck must be replenished before drawing. Otherwise
    // replenish immediately after the last card is drawn, as in the rules.
    const beforeDraw=recycleSectionDeck(next,state.revision+1,spartacusBonus(state)===1);
    const replacements=next.diceLab?.firstStrike?.replacements??0,defender=side==='A'?'B':'A';
    let replacementDraws=0,recycled=beforeDraw;
    for(let i=0;i<replacements;i++){
      const before=recycleSectionDeck(next,state.revision+1);recycled=recycled||before;
      if(!next.drawPile.length)break;
      next.hands[defender].push(next.drawPile.pop());replacementDraws++;
      const count=recycleSectionDeck(next,state.revision+1);recycled=recycled||count;
    }
    const drew=next.drawPile.length>0;
    if(drew)next.hands[side].push(next.drawPile.pop());
    const afterDraw=(next.diceLab?.version>=31||!recycled)?recycleSectionDeck(next,state.revision+1):0,recycledCards=recycled||afterDraw;
    next.turn=side==='A'?'B':'A';
    next.phase='AWAIT_CARD';next.handAtPlay=null;next.cardPlay=null;next.orderSnapshot=null;
    if(next.footLab)next.footLab.movedUnitIds=[];
    if(next.combatLab)next.combatLab={movementClosed:false,movement:{},plan:null};
    if(next.diceLab)resetSectionDiceTurn(next);
    if(next.leaderLab){next.leaderLab.movedLeaderIds=[];next.leaderLab.joinedUnitIds=[];}
    publicEvent={kind:state.diceLab?.resolvedUnitIds.length
      ?'LAB_TURN_ENDED_AFTER_RANGED_REVIEW':'LAB_TURN_ENDED_WITHOUT_COMBAT',side,drewCard:drew,
      ...(recycledCards?{deckRecycled:true,recycledCardCount:recycledCards}:{}),...(replacements?{firstStrikeReplacementDraws:replacementDraws}:{})};
  }else return reject('UNSUPPORTED_LAB_COMMAND');
  // Terrain dice are authoritative and part of the same accepted command.
  if(next.diceLab?.version>=32&&['MOVE_SECTION_FOOT_PATH_V2','MOVE_SECTION_MOUNTED_PATH_V1','MOVE_SECTION_LEADER_PATH_V1','CHOOSE_SECTION_MOMENTUM_LAB'].includes(command.type)&&pathHasMarsh(state.footLab.terrain,command.path)){
    const revision=state.revision+1;
    let marshChecks;
    if(command.type==='MOVE_SECTION_LEADER_PATH_V1'){
      marshChecks=applyMarshLeaderPath(next,command.leaderId,command.path,revision);
    }else{
      const id=publicEvent.unitId,unit=state.board.units.find(u=>u.id===id);
      const attached=state.board.leaders.find(l=>l.side===unit.side&&loc(l)===loc(unit));
      marshChecks=applyMarshUnitPath(next,id,attached?.id,command.path,revision);
      if(!next.board.units.some(u=>u.id===id)&&next.diceLab.last?.momentum?.bonusPending)next.diceLab.last.momentum.bonusPending=false;
    }
    publicEvent={...publicEvent,marshChecks};
  }
  next.revision=state.revision+1;
  publicEvent=settleSectionVictory(next,publicEvent,command.type==='END_EXPERIMENTAL_TURN');
  if(next.scenarioRules&&!sectionVictory(next)?.winner){
    const growth=applyScenarioHandGrowth(next,command.type==='END_EXPERIMENTAL_TURN'?side:null,beneficiary=>{
      recycleSectionDeck(next,next.revision);
      if(!next.drawPile.length)return false;
      next.hands[beneficiary].push(next.drawPile.pop());
      recycleSectionDeck(next,next.revision);
      return true;
    });
    if(growth.length)publicEvent={...publicEvent,scenarioHandGrowth:growth};
  }
  // A defensive strike spends no ordered battle unless it stops the original attack.
  const reaction=next.diceLab?.firstStrike;
  if(reaction?.original&&!next.combatLab.plan){
    const original=reaction.original,prior=reaction.prior;
    reaction.original=null;reaction.prior=null;
    const attacker=next.board.units.find(u=>u.id===original.attackerId),defender=next.board.units.find(u=>u.id===original.targetId);
    const retreated=next.diceLab.last?.retreat?.path?.length>0;
    const stopped=sectionVictory(next)?.winner||!attacker||!defender||retreated||geometryOf(next).distance(attacker,defender)!==1;
    const strike=next.diceLab.last;
    if(!stopped){
      if(original.bonusClose)next.diceLab.last=prior;
      const resumed=screenClosePlan(next,original.attackerId,original.targetId,[],false,!!original.bonusClose);
      if(resumed.accepted){next.combatLab.plan=resumed.plan;reaction.suppress=true;}
      else next.diceLab.last=strike;
    }
    if(!reaction.suppress&&!next.diceLab.resolvedUnitIds.includes(original.attackerId))next.diceLab.resolvedUnitIds.push(original.attackerId);
    publicEvent={...publicEvent,firstStrikeOriginalResumed:reaction.suppress};
  }else if(reaction?.suppress&&!next.combatLab.plan)reaction.suppress=false;
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
  if(initialState.revision!==0||!Array.isArray(commands)||commands.length>sectionHistoryCommandLimit(initialState))
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
    ...(state.scenario?{scenario:copy(state.scenario)}:{}),
    ...(state.victoryObjectives?{victoryObjectives:projectScenarioObjectives(state)}:{}),
    ...(state.scenarioRules?.unitExit?{scenarioUnitExit:copy(state.scenarioRules.unitExit),
      scenarioExitCells:geometryOf(state).allCells().filter(c=>exitRule(state,state.scenarioRules.unitExit.rule.side,c))}:{}),
    ...(ambushOptions(state,side)?{scenarioReserveOptions:ambushOptions(state,side)}:{}),
    ...(state.scenarioRules?.reserve?{scenarioReserveMovableIds:state.board.units.filter(u=>u.side===side&&reserveCanContinue(state,u.id)).map(u=>u.id)}:{}),
    ...(state.scenarioRules?.leaderLoss?{scenarioLeaderLoss:copy(state.scenarioRules.leaderLoss)}:{}),
    ...(state.scenarioRules?{scenarioHandGrowth:state.scenarioRules.handGrowth.map(rule=>({...copy(rule),granted:state.scenarioRules.granted.includes(rule.id)}))}:{}),
    ...(state.revision>=sectionHistoryCommandLimit(state)?{historyLimitReached:true}:{}),
    opponentCardCount:state.hands[other].length,
    drawPileCount:state.drawPile.length,
    discardPile:state.discardPile.map(c=>c.definitionId),
    cardInPlay:state.activeCard?.definitionId??null,
    ...(state.diceLab?.version>=30?{effectiveCardInPlay:effectiveSectionCard(state),previousCardEffect:state.diceLab.counter.previous}:{}),
    ordersStaged:state.orderSnapshot!==null,
    ...(state.turn===side&&state.phase==='ASSIGN_ORDERS'&&currentSelectionCard(state,side)?{selectionCard:currentSelectionCard(state,side)}:{}),
    ...(state.footLab?{
      board:state.board.units.map(u=>({
        id:u.id,side:u.side,col:u.col,row:u.row,
        unitType:state.footLab.unitTypes[u.id],
        ...(isSacredBand(state,u.id)?{sacredBand:true}:{}),
        ...(state.diceLab?{blocksRemaining:state.diceLab.blocks[u.id]}:{})
      })),
      movedUnitIds:[...state.footLab.movedUnitIds],
      ...(state.diceLab?{diceLab:projectSectionDiceLab(state,side)}:{}),
      ...(state.combatLab?{
        combatLab:{movementClosed:state.combatLab.movementClosed,
          plan:copy(state.combatLab.plan),
          ...(state.diceLab?.version>=18?{pendingWarriorCharges:pendingWarriorCharges(state)}:{}),
          candidates:state.revision<sectionHistoryCommandLimit(state)&&!sectionVictory(state)?.winner&&state.turn===side&&state.combatLab.movementClosed&&!state.combatLab.plan&&!state.diceLab?.last?.battleBackPending&&!state.diceLab?.last?.momentum?.pending
            ?state.diceLab?.last?.momentum?.bonusPending?bonusCloseCandidates(state):state.orderSnapshot.pieces.filter(p=>p.kind==='UNIT'&&p.side===side)
              .flatMap(p=>combatTargets(state).filter(u=>u.side!==side).flatMap(u=>{
                const ranged=screenRangedPlan(state,p.id,u.id);
                if(ranged.accepted)return [{attackerId:p.id,targetId:u.id,diceCount:ranged.plan.diceCount,...(ranged.plan.loneLeader?{loneLeader:true}:{})}];
                const close=screenClosePlan(state,p.id,u.id);
                return close.accepted?[{kind:'CLOSE_PREVIEW',attackerId:p.id,targetId:u.id,diceCount:close.plan.diceCount,...(close.plan.loneLeader?{loneLeader:true}:{})}]:[];
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
