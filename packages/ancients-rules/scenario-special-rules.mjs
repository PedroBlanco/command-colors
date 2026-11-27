/** Declarative, versioned scenario exceptions. No scenario names or code hooks.
 * All effects are evaluated on the authoritative, replayable journal.
 */
const SIDES=['A','B'];
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,keys)=>record(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const idOK=x=>typeof x==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(x);
const positive=(x,max)=>Number.isSafeInteger(x)&&x>=1&&x<=max;

export const isSacredBand=(state,id)=>state.scenarioRules?.sacredBand.includes(id)??false;

export function initializeScenarioRules(config,state,handSizes){
  if(!exact(config,['sacredBand','handGrowth'])||!Array.isArray(config.sacredBand)||!Array.isArray(config.handGrowth))throw Error('INVALID_SCENARIO_RULES');
  const rules={sacredBand:structuredClone(config.sacredBand),handGrowth:structuredClone(config.handGrowth),
    turns:{A:0,B:0},granted:[]};
  if(!validScenarioRules(rules,state)||rules.sacredBand.some(id=>state.footLab.unitTypes[id]!=='HEAVY_INFANTRY')||
     SIDES.some(side=>handSizes[side]+rules.handGrowth.filter(r=>r.side===side).reduce((n,r)=>n+r.cards,0)>20))
    throw Error('INVALID_SCENARIO_RULES');
  return rules;
}

export function validScenarioRules(rules,state){
  if(!exact(rules,['sacredBand','handGrowth','turns','granted'])||!(state.diceLab?.version>=31)||
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
    for(let i=0;i<rule.cards;i++){if(!draw(rule.side))break;cards++;}
    rules.granted.push(rule.id);
    awards.push({id:rule.id,side:rule.side,cards});
  }
  return awards;
}
