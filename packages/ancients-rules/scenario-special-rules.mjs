/** Declarative, versioned scenario exceptions. No scenario names or code hooks.
 * All effects are evaluated on the authoritative, replayable journal.
 */
import {isImpassableTerrain} from './terrain-movement.mjs';
const SIDES=['A','B'];
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,keys)=>record(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const idOK=x=>typeof x==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(x);
const positive=(x,max)=>Number.isSafeInteger(x)&&x>=1&&x<=max;
const optionalRules=['leaderLoss','unitExit','reserve'];
const ruleKeys=(x,keys)=>exact(x,[...keys,...optionalRules.filter(k=>Object.hasOwn(x??{},k))]);
const validLeaderLoss=rules=>Array.isArray(rules)&&rules.length<=20&&new Set(rules.map(r=>r?.leaderId)).size===rules.length&&rules.every(r=>exact(r,['leaderId','winner','mode'])&&idOK(r.leaderId)&&SIDES.includes(r.winner)&&['ELIMINATED','REMOVED'].includes(r.mode));

export const isSacredBand=(state,id)=>state.scenarioRules?.sacredBand.includes(id)??false;

export function initializeScenarioRules(config,state,handSizes){
  if(!ruleKeys(config,['sacredBand','handGrowth'])||!Array.isArray(config.sacredBand)||!Array.isArray(config.handGrowth))throw Error('INVALID_SCENARIO_RULES');
  const rules={sacredBand:structuredClone(config.sacredBand),handGrowth:structuredClone(config.handGrowth),
    turns:{A:0,B:0},granted:[],...(Object.hasOwn(config,'leaderLoss')?{leaderLoss:structuredClone(config.leaderLoss)}:{}),
    ...(Object.hasOwn(config,'unitExit')?{unitExit:{rule:structuredClone(config.unitExit),exited:[]}}:{}),
    ...(Object.hasOwn(config,'reserve')?{reserve:{rule:structuredClone(config.reserve),enteredTurn:null}}:{})};
  if(!validScenarioRules(rules,state)||rules.reserve&&(!validReserveConfig(rules.reserve.rule)||state.board.units.length+state.board.leaders.length+4>Object.keys(state.sectorCells).length||[...rules.reserve.rule.units.map(u=>u.id),rules.reserve.rule.leaderId].some(id=>[...state.board.units,...state.board.leaders].some(p=>p.id===id)))||rules.leaderLoss?.some(r=>!state.board.leaders.some(l=>l.id===r.leaderId&&l.side!==r.winner))||rules.sacredBand.some(id=>state.footLab.unitTypes[id]!=='HEAVY_INFANTRY')||
     SIDES.some(side=>handSizes[side]+rules.handGrowth.filter(r=>r.side===side).reduce((n,r)=>n+r.cards,0)>20)||
     handSizes.A+handSizes.B+rules.handGrowth.reduce((n,r)=>n+r.cards,0)>=state.totalCards)
    throw Error('INVALID_SCENARIO_RULES');
  return rules;
}

export function validScenarioRules(rules,state){
  if(!ruleKeys(rules,['sacredBand','handGrowth','turns','granted'])||(Object.hasOwn(rules??{},'leaderLoss')&&!validLeaderLoss(rules.leaderLoss))||!(state.diceLab?.version>=31)||
     (Object.hasOwn(rules,'unitExit')&&!validUnitExit(rules.unitExit,state))||
     (Object.hasOwn(rules,'reserve')&&!validReserve(rules.reserve,state,rules.turns))||
     !Array.isArray(rules.sacredBand)||rules.sacredBand.length>20||
     new Set(rules.sacredBand).size!==rules.sacredBand.length||
     !rules.sacredBand.every(id=>idOK(id)&&(state.footLab.unitTypes[id]==='HEAVY_INFANTRY'||
       state.diceLab.casualties.some(c=>c.id===id&&c.kind==='UNIT')||rules.unitExit?.exited?.includes(id)))||
     !Array.isArray(rules.handGrowth)||rules.handGrowth.length>20||
     !exact(rules.turns,SIDES)||!SIDES.every(side=>Number.isSafeInteger(rules.turns[side])&&rules.turns[side]>=0&&rules.turns[side]<=state.revision)||
     !Array.isArray(rules.granted)||new Set(rules.granted).size!==rules.granted.length)return false;
  const ids=new Set();
  for(const rule of rules.handGrowth){
    if(!exact(rule,['id','side','trigger','threshold','cards'])||!idOK(rule.id)||ids.has(rule.id)||
       !SIDES.includes(rule.side)||!['OWN_TURN_END','CASUALTY_BANNERS'].includes(rule.trigger)||
       !positive(rule.threshold,117)||!positive(rule.cards,10))return false;
    ids.add(rule.id);
  }
  return rules.granted.every(id=>ids.has(id));
}

// Called only after committed board changes and ordinary end-turn draw.
// A threshold is permanent, and extra draws are private like normal draws.
export function applyScenarioHandGrowth(state,endedSide,draw){
  const rules=state.scenarioRules;
  if(!rules)return [];
  if(endedSide)rules.turns[endedSide]++;
  const awards=[];
  for(const rule of rules.handGrowth){
    if(rules.granted.includes(rule.id))continue;
    const value=rule.trigger==='OWN_TURN_END'?rules.turns[rule.side]:
      state.diceLab.casualties.filter(c=>c.awardedTo===rule.side).length;
    if(value<rule.threshold)continue;
    let cards=0;
    for(let i=0;i<rule.cards;i++){if(!draw(rule.side))throw Error('SCENARIO_HAND_GROWTH_DECK_EXHAUSTED');cards++;}
    rules.granted.push(rule.id);
    awards.push({id:rule.id,side:rule.side,cards});
  }
  return awards;
}

// A designated leader can be a decisive scenario objective. REMOVED also
// includes a successful evasion off the board, without awarding a casualty.
export function decisiveLeaderVictory(state){
  const losses=state.scenarioRules?.leaderLoss??[];
  const winners=new Set(losses.filter(r=>r.mode==='REMOVED'?!state.board.leaders.some(l=>l.id===r.leaderId):
    state.diceLab.casualties.some(c=>c.id===r.leaderId&&c.kind==='LEADER')).map(r=>r.winner));
  return winners.size===2?'DRAW':winners.size===1?[...winners][0]:null;
}

const SECTORS=['LEFT','CENTER','RIGHT'];
const validExitConfig=r=>exact(r,['side','sectors','banners'])&&SIDES.includes(r.side)&&Array.isArray(r.sectors)&&r.sectors.length>0&&r.sectors.length<=3&&new Set(r.sectors).size===r.sectors.length&&r.sectors.every(x=>SECTORS.includes(x))&&positive(r.banners,10);
function validUnitExit(e,state){
  return exact(e,['rule','exited'])&&validExitConfig(e.rule)&&Array.isArray(e.exited)&&e.exited.length<=117&&new Set(e.exited).size===e.exited.length&&e.exited.every(id=>idOK(id)&&!state.board.units.some(u=>u.id===id)&&!state.diceLab.casualties.some(c=>c.id===id));
}
const validReserveConfig=r=>exact(r,['side','units','leaderId'])&&SIDES.includes(r.side)&&idOK(r.leaderId)&&Array.isArray(r.units)&&r.units.length===3&&
  r.units.every(u=>exact(u,['id','type'])&&idOK(u.id)&&['MEDIUM_CAVALRY','WARRIOR_INFANTRY'].includes(u.type))&&
  r.units.filter(u=>u.type==='MEDIUM_CAVALRY').length===1&&new Set([...r.units.map(u=>u.id),r.leaderId]).size===4;
function validReserve(r,state,turns){
  return exact(r,['rule','enteredTurn'])&&validReserveConfig(r.rule)&&
    (r.enteredTurn===null||Number.isSafeInteger(r.enteredTurn)&&r.enteredTurn>=1&&r.enteredTurn<=turns?.[r.rule.side])&&
    (r.enteredTurn!==null||[...r.rule.units.map(u=>u.id),r.rule.leaderId].every(id=>![...state.board.units,...state.board.leaders].some(p=>p.id===id)&&!state.diceLab.casualties.some(c=>c.id===id)));
}
export function scenarioExitBanners(state){
  const e=state.scenarioRules?.unitExit;
  return e?{A:e.rule.side==='A'?e.exited.length*e.rule.banners:0,B:e.rule.side==='B'?e.exited.length*e.rule.banners:0}:{A:0,B:0};
}
export function reserveEntryOptions(state,side,sectors,geometry,leadershipSection){
  const r=state.scenarioRules?.reserve;
  if(!r||r.enteredTurn!==null||r.rule.side!==side||state.turn!==side||state.phase!=='ASSIGN_ORDERS'||state.scenarioRules.turns[side]<1||leadershipSection===undefined)return null;
  const row=side==='A'?0:8,occupied=[...state.board.units,...state.board.leaders];
  const cells=geometry.allCells().filter(c=>c.row===row&&!occupied.some(p=>p.col===c.col&&p.row===c.row)&&!state.footLab.terrain.some(t=>t.col===c.col&&t.row===c.row&&(isImpassableTerrain(t.kind)||t.kind==='BUILDING'||t.kind==='MARSH')));
  const options=SECTORS.filter(s=>leadershipSection===null||s===leadershipSection).map(section=>({section,cells:cells.filter(c=>sectors[c.col+','+c.row]?.includes(section))})).filter(o=>o.cells.length>=3);
  return options.length?{units:structuredClone(r.rule.units),leaderId:r.rule.leaderId,options}:null;
}
export function reserveCanContinue(state,id){
  const r=state.scenarioRules?.reserve;
  return !!(r&&r.enteredTurn!==null&&state.turn===r.rule.side&&state.scenarioRules.turns[state.turn]===r.enteredTurn&&r.rule.units.some(u=>u.id===id)&&state.combatLab.movement[id]?.steps===1&&!state.footLab.terrain.some(t=>['FOREST','FORDABLE_RIVER','MARSH','BUILDING'].includes(t.kind)&&state.board.units.some(u=>u.id===id&&u.col===t.col&&u.row===t.row)));
}
