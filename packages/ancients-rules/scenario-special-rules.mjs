/** Declarative, versioned scenario exceptions. No scenario names or code hooks.
 * All effects are evaluated on the authoritative, replayable journal.
 */
const SIDES=['A','B'];
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,keys)=>record(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const idOK=x=>typeof x==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(x);
const positive=(x,max)=>Number.isSafeInteger(x)&&x>=1&&x<=max;
const ruleKeys=(x,keys)=>exact(x,Object.hasOwn(x??{},'leaderLoss')?[...keys,'leaderLoss']:keys);
const validLeaderLoss=rules=>Array.isArray(rules)&&rules.length<=20&&new Set(rules.map(r=>r?.leaderId)).size===rules.length&&rules.every(r=>exact(r,['leaderId','winner','mode'])&&idOK(r.leaderId)&&SIDES.includes(r.winner)&&['ELIMINATED','REMOVED'].includes(r.mode));

export const isSacredBand=(state,id)=>state.scenarioRules?.sacredBand.includes(id)??false;

export function initializeScenarioRules(config,state,handSizes){
  if(!ruleKeys(config,['sacredBand','handGrowth'])||!Array.isArray(config.sacredBand)||!Array.isArray(config.handGrowth))throw Error('INVALID_SCENARIO_RULES');
  const rules={sacredBand:structuredClone(config.sacredBand),handGrowth:structuredClone(config.handGrowth),
    turns:{A:0,B:0},granted:[],...(Object.hasOwn(config,'leaderLoss')?{leaderLoss:structuredClone(config.leaderLoss)}:{})};
  if(!validScenarioRules(rules,state)||rules.leaderLoss?.some(r=>!state.board.leaders.some(l=>l.id===r.leaderId&&l.side!==r.winner))||rules.sacredBand.some(id=>state.footLab.unitTypes[id]!=='HEAVY_INFANTRY')||
     SIDES.some(side=>handSizes[side]+rules.handGrowth.filter(r=>r.side===side).reduce((n,r)=>n+r.cards,0)>20)||
     handSizes.A+handSizes.B+rules.handGrowth.reduce((n,r)=>n+r.cards,0)>=state.totalCards)
    throw Error('INVALID_SCENARIO_RULES');
  return rules;
}

export function validScenarioRules(rules,state){
  if(!ruleKeys(rules,['sacredBand','handGrowth','turns','granted'])||(Object.hasOwn(rules??{},'leaderLoss')&&!validLeaderLoss(rules.leaderLoss))||!(state.diceLab?.version>=31)||
     !Array.isArray(rules.sacredBand)||rules.sacredBand.length>20||
     new Set(rules.sacredBand).size!==rules.sacredBand.length||
     !rules.sacredBand.every(id=>idOK(id)&&(state.footLab.unitTypes[id]==='HEAVY_INFANTRY'||
       state.diceLab.casualties.some(c=>c.id===id&&c.kind==='UNIT')))||
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
