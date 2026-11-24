/**
 * Section history LAB_ONLY: versioned server-owned dice and restricted direct
 * losses. Replay derives the same digital dice from a private per-game key.
 * No result, key, block count or dice distribution is accepted from the client.
 * Physical faces are declarations, never cryptographically verified.
 */
import {randomBytes,createHmac} from 'node:crypto';
import {neighbors} from '../hex-grid/hex.mjs';
import {BASE_MOVEMENT_PROFILES} from './movement-profile.mjs';
import {ANCIENTS_BATTLE_DIE_FACES,captureBaseAncientsRangedDice,interpretBaseAncientsRangedDice} from './battle-dice.mjs';
import {BASE_UNIT_STARTING_BLOCKS,previewBaseAncientsRangedBlockLoss} from './block-loss-preview.mjs';
import {planBaseAncientsRangedResolution,captureBaseAncientsLeaderCasualtyDice,
  previewBaseAncientsLeaderCasualtyCheck} from './ranged-resolution-sequence.mjs';

const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const keyOK=k=>typeof k==='string'&&/^[a-f0-9]{64}$/.test(k);
const fail=()=>{throw new TypeError('INVALID_SECTION_DICE_LAB_STATE');};
const deny=code=>({accepted:false,code});
const hex=p=>p.col+','+p.row;

// HMAC-SHA256 counter stream, rejection sampling (no modulo bias). The key
// is generated once by Node crypto at server setup and never projected.
// Independent domain from the shuffled deck; stable version for old replay.
export function sectionRollIndex(key,rollId){
  if(!keyOK(key)||!/^section_(?:ranged|leader|escape)_[1-9][0-9]*$/.test(rollId))fail();
  let counter=0;
  return n=>{
    if(!Number.isSafeInteger(n)||n<2||n>256)fail();
    const limit=256-256%n;
    for(;;){
      const bytes=createHmac('sha256',Buffer.from(key,'hex'))
        .update('CCW_SECTION_RANGED_V1:'+rollId+':'+counter++).digest();
      for(const byte of bytes)if(byte<limit)return byte%n;
    }
  };
}

export function initializeSectionDiceLab(unitTypes,{casualties=false,morale=false,retreat=false,retreatLeaders=false,leaderEscape=false}={}){
  if((morale&&!casualties)||(retreat&&!morale)||(retreatLeaders&&!retreat)||(leaderEscape&&!retreatLeaders))fail();
  return {version:leaderEscape?6:retreatLeaders?5:retreat?4:morale?3:casualties?2:1,key:randomBytes(32).toString('hex'),
    blocks:Object.fromEntries(Object.entries(unitTypes).map(([id,type])=>[
      id,BASE_UNIT_STARTING_BLOCKS[type]
    ])),
    resolvedUnitIds:[],pending:null,last:null,
    ...(casualties?{casualties:[],leaderCheck:null}:{}),
    ...(morale?{morale:null}:{}),
    ...(retreatLeaders?{retreatPending:null}:{})};
}

function derivePending(state,{revision,mode,faces,review}){
  const plan=state.combatLab.plan,target=state.board.units.find(u=>u.id===plan.targetId);
  const rollId='section_ranged_'+revision;
  const roll=captureBaseAncientsRangedDice({rollId,actor:state.turn,
    diceCount:plan.diceCount,mode,
    ...(mode==='DIGITAL'?{randomIndex:sectionRollIndex(state.diceLab.key,rollId)}:{declaredFaces:faces})});
  const interpretation=interpretBaseAncientsRangedDice({
    roll,targetUnitType:plan.targetUnitType,expectedDiceCount:plan.diceCount
  });
  const loss=previewBaseAncientsRangedBlockLoss({
    unitType:plan.targetUnitType,blocksRemaining:state.diceLab.blocks[target.id],
    diceCount:plan.diceCount,matchingColorHits:interpretation.matchingColorHits,
    flagsPending:interpretation.flagsPending,
    leaderAttached:state.board.leaders.some(l=>l.side===target.side&&hex(l)===hex(target))
  });
  return {revision,review,roll,interpretation,loss};
}

// A flag is optional only up to the server-calculated cumulative capacity.
// Each adjacent hex counts once, even when it contains an attached leader.
// The current terrain whitelist has no morale-granting defensive terrain.
function moralePreview(state){
  const d=state.diceLab,p=d.pending;
  if(d.version<3||!p?.loss.effectiveFlagsPending||
     !['SERVER_GENERATED','ACCEPTED'].includes(p.review)||
     (p.loss.leaderCasualtyCheck&&!d.leaderCheck))return null;
  const target=state.board.units.find(u=>u.id===state.combatLab.plan.targetId);
  const type=state.footLab.unitTypes[target.id];
  const supportHexes=neighbors(target).filter(c=>
    [...state.board.units,...state.board.leaders].some(x=>x.side===target.side&&hex(x)===hex(c)));
  const elephant=type==='ELEPHANT';
  const attachedLeader=!elephant&&p.loss.leaderAttached&&!d.leaderCheck?.outcome.leaderWouldBeEliminated;
  const supported=!elephant&&supportHexes.length>=2;
  // Full strength at the beginning of this combat, not after its direct hits.
  const fullWarrior=type==='WARRIOR_INFANTRY'&&p.loss.originalBlocks===BASE_UNIT_STARTING_BLOCKS[type];
  const capacity=Number(attachedLeader)+Number(supported)+Number(fullWarrior);
  const flags=p.loss.effectiveFlagsPending;
  return {flags,attachedLeader,supported,fullWarrior,supportHexes,
    maxIgnored:Math.min(flags,capacity)};
}

function unsupported(state,pending){
  const l=pending.loss,d=state.diceLab;
  if(d.version===1){
    if(l.unitWouldBeEliminated)return 'ELIMINATION_PENDING';
    if(l.leaderCasualtyCheck)return 'LEADER_CHECK_PENDING';
  }
  if(d.version<3&&l.effectiveFlagsPending>0)return 'RETREAT_PENDING';
  if(d.version>=2&&l.leaderCasualtyCheck){
    if(!d.leaderCheck)return 'LEADER_CHECK_PENDING';
    if(d.leaderCheck.outcome.leaderMustEvadeIfApplied)return 'LEADER_EVASION_PENDING';
  }
  if(d.version>=3&&l.effectiveFlagsPending>0){
    const m=moralePreview(state);
    if(m?.maxIgnored&&!d.morale)return 'MORALE_CHOICE_PENDING';
    if(l.effectiveFlagsPending>(d.morale?.ignored??0))return 'RETREAT_PENDING';
  }
  return null;
}

// Staged retreats do not mutate the board until all leader consequences
// are known. A check already made for direct hits always takes precedence.
function effectiveLeaderCheck(d){return d.leaderCheck??d.retreatPending?.leaderCheck??null;}
function resolutionBlocker(state,p){
  const d=state.diceLab,s=d.retreatPending;
  if(!s)return unsupported(state,p);
  const check=effectiveLeaderCheck(d);
  if(!check)return 'LEADER_CHECK_PENDING';
  return s.choice.blocksLost===p.loss.remainingBlocks&&!check.outcome.leaderWouldBeEliminated
    ?'LEADER_EVASION_PENDING':null;
}

// Base attack dice (unmodified). Keep this separate from terrain, cards,
// and battle-back modifiers so close combat can reuse it.
export function baseCloseAttackDice(unitType,blocks){
  const counts={LIGHT_INFANTRY:2,LIGHT_SLING_INFANTRY:2,LIGHT_BOW_INFANTRY:2,
    AUXILIA_INFANTRY:3,WARRIOR_INFANTRY:blocks===BASE_UNIT_STARTING_BLOCKS.WARRIOR_INFANTRY?4:3,
    MEDIUM_INFANTRY:4,HEAVY_INFANTRY:5,HEAVY_WAR_MACHINE:2,
    LIGHT_CAVALRY:2,MEDIUM_CAVALRY:3,HEAVY_CAVALRY:4,HEAVY_CHARIOT:4};
  // Elephants depend on the target; the only supported target here is a leader.
  if(unitType==='ELEPHANT')return 1;
  if(!Object.hasOwn(counts,unitType))fail();
  return counts[unitType];
}

// LAB odd-q board: A's rear edge is row 8, B's is row 0.
// V6 adds risky routes through enemy hexes to the historical safe options.
function leaderEvasionOptions(state){
  const d=state.diceLab,p=d.pending;
  if(d.version<2||!p||!['SERVER_GENERATED','ACCEPTED'].includes(p.review)||
     resolutionBlocker(state,p)!=='LEADER_EVASION_PENDING')return [];
  const leader=state.board.leaders.find(l=>l.id===effectiveLeaderCheck(d).leaderId);
  if(!leader)return [];
  const origin=d.retreatPending?.choice.path.at(-1)??leader;
  const options=[],rear=leader.side==='A'?8:0,sign=leader.side==='A'?1:-1;
  // Physical vertical coordinate of the existing flat-top board.
  const depth=c=>2*c.row+(c.col&1);
  function visit(cell,path,risks=[]){
    const occupiedLeader=state.board.leaders.some(l=>l.id!==leader.id&&hex(l)===hex(cell));
    const enemyUnit=state.board.units.some(u=>u.side!==leader.side&&hex(u)===hex(cell));
    const extra=d.version>=6?{risks}:{};
    if(path.length&&!occupiedLeader&&!enemyUnit)options.push({path,exit:false,...extra});
    if(path.length<3&&cell.row===rear)options.push({path,exit:true,...extra});
    if(path.length===3||(d.version>=6&&cell.row===rear))return;
    for(const dest of neighbors(cell)){
      if(sign*(depth(dest)-depth(cell))<=0)continue;
      const enemy=state.board.units.find(u=>u.side!==leader.side&&hex(u)===hex(dest));
      const enemyLeader=state.board.leaders.find(l=>l.side!==leader.side&&hex(l)===hex(dest));
      if(d.version<6&&(enemy||enemyLeader))continue;
      // Enemy leaders alone can be crossed without rolling; no hostile endpoint.
      const risk=enemy?{step:path.length+1,unitId:enemy.id,
        diceCount:baseCloseAttackDice(state.footLab.unitTypes[enemy.id],d.blocks[enemy.id])}:null;
      visit(dest,[...path,{col:dest.col,row:dest.row}],risk?[...risks,risk]:risks);
    }
  }
  visit(origin,[]);
  // When no survival endpoint exists, the defender confirms unavoidable loss.
  // Do not roll dice for an escape whose outcome is already certain.
  if(d.version>=6&&!options.length)options.push({path:[],exit:false,risks:[],trapped:true});
  return options;
}

function resolveLeaderEscape(state,option){
  const rollId='section_escape_'+(state.revision+1),draw=sectionRollIndex(state.diceLab.key,rollId);
  const rolls=[];
  let eliminated=!!option.trapped;
  for(const risk of option.risks){
    const results=Array.from({length:risk.diceCount},()=>ANCIENTS_BATTLE_DIE_FACES[draw(6)]);
    eliminated=results.includes('LEADER');
    rolls.push({...risk,results,eliminated});
    if(eliminated)break;
  }
  return {rollId,rolls,eliminated};
}

// Ordinary retreats: no elephant rampage, no impassable terrain in this
// server-owned terrain whitelist. The existing board's rearward axis is used.
// A deterministic representative per cell and step count bounds projection size.
function retreatPreview(state){
  const d=state.diceLab,p=d.pending;
  if(d.version<4||!p||!['SERVER_GENERATED','ACCEPTED'].includes(p.review)||
     unsupported(state,p)!=='RETREAT_PENDING')return null;
  const target=state.board.units.find(u=>u.id===state.combatLab.plan.targetId);
  const type=state.footLab.unitTypes[target.id];
  const attackerType=state.footLab.unitTypes[state.combatLab.plan.attackerId];
  const flags=p.loss.effectiveFlagsPending-(d.morale?.ignored??0);
  const perFlag=['AUXILIA_INFANTRY','ELEPHANT'].includes(type)?1:BASE_MOVEMENT_PROFILES[type].maxSteps;
  const required=flags*(perFlag+Number(attackerType==='ELEPHANT'&&
    ['LIGHT_CAVALRY','MEDIUM_CAVALRY','HEAVY_CAVALRY','HEAVY_CHARIOT'].includes(type)));
  if(type==='ELEPHANT')return {flags,required,options:[],reason:'ELEPHANT_RAMPAGE_PENDING'};
  const attached=state.board.leaders.find(l=>l.side===target.side&&hex(l)===hex(target)&&
    !d.leaderCheck?.outcome.leaderWouldBeEliminated);
  const occupied=new Set(state.board.units.map(hex));
  const leaders=new Map(state.board.leaders.filter(l=>l.id!==d.leaderCheck?.leaderId||
    !d.leaderCheck.outcome.leaderWouldBeEliminated).map(l=>[hex(l),l]));
  const depth=c=>2*c.row+(c.col&1),sign=target.side==='A'?1:-1,rear=target.side==='A'?8:0;
  const terminals=[];
  let frontier=new Map([[hex(target),{cell:target,path:[]}]]);
  for(let steps=0;steps<=required&&frontier.size;steps++){
    const next=new Map();
    for(const {cell,path} of frontier.values()){
      const joined=path.length&&!attached?leaders.get(hex(cell)):null;
      const legal=steps===required||joined||cell.row===rear?[]:neighbors(cell).filter(c=>
        sign*(depth(c)-depth(cell))>0&&!occupied.has(hex(c))&&
        (!leaders.has(hex(c))||(!attached&&leaders.get(hex(c)).side===target.side)));
      if(!legal.length){
        const missing=joined?0:required-steps;
        const blocksLost=Math.min(p.loss.remainingBlocks,missing);
        terminals.push({path,missing,blocksLost,joinedLeaderId:joined?.id??null,
          needsLeaderResolution:!!attached&&blocksLost>0&&(!d.leaderCheck||blocksLost===p.loss.remainingBlocks)});
      }
      for(const dest of legal)if(!next.has(hex(dest)))next.set(hex(dest),{cell:dest,path:[...path,dest]});
    }
    frontier=next;
  }
  // A loss-free retreat is mandatory when one exists. Never allow a player
  // to stop early, skip a reachable cell, or choose an incomplete alternative.
  const legal=terminals.some(o=>o.missing===0)?terminals.filter(o=>o.missing===0):terminals;
  const options=d.version>=5?legal:legal.filter(o=>!o.needsLeaderResolution);
  return {flags,required,options,reason:options.length?null:'RETREAT_LEADER_RESOLUTION_PENDING'};
}

function deriveLeaderCheck(state,revision,retreatChoice=null){
  const p=state.diceLab.pending;
  const loss=retreatChoice?previewBaseAncientsRangedBlockLoss({
    unitType:p.loss.unitType,blocksRemaining:p.loss.remainingBlocks,
    diceCount:retreatChoice.blocksLost,matchingColorHits:retreatChoice.blocksLost,
    flagsPending:0,leaderAttached:true
  }):p.loss;
  const target=state.board.units.find(u=>u.id===state.combatLab.plan.targetId);
  const leader=state.board.leaders.find(l=>l.side===target.side&&hex(l)===hex(target));
  if(!leader||!loss.leaderCasualtyCheck)fail();
  const checklist=planBaseAncientsRangedResolution({blockLoss:loss});
  const rollId='section_leader_'+revision;
  const roll=captureBaseAncientsLeaderCasualtyDice({
    rollId,actor:state.turn,diceCount:loss.leaderCasualtyCheck.diceCount,
    mode:'DIGITAL',randomIndex:sectionRollIndex(state.diceLab.key,rollId)
  });
  return {revision,leaderId:leader.id,roll,
    outcome:previewBaseAncientsLeaderCasualtyCheck({checklist,roll})};
}

function awardCasualty(next,piece,kind,side,revision){
  next.diceLab.casualties.push({id:piece.id,kind,side:piece.side,
    awardedTo:side,revision});
}

function applyDirectLoss(state,next,plan,p){
  const target=state.board.units.find(u=>u.id===plan.targetId);
  const leaderCheck=state.diceLab.leaderCheck;
  if(p.loss.unitWouldBeEliminated){
    next.board.units=next.board.units.filter(u=>u.id!==target.id);
    delete next.footLab.unitTypes[target.id];
    delete next.diceLab.blocks[target.id];
    awardCasualty(next,target,'UNIT',state.turn,state.revision+1);
  }else next.diceLab.blocks[target.id]=p.loss.remainingBlocks;
  if(leaderCheck?.outcome.leaderWouldBeEliminated){
    const leader=state.board.leaders.find(l=>l.id===leaderCheck.leaderId);
    next.board.leaders=next.board.leaders.filter(l=>l.id!==leader.id);
    awardCasualty(next,leader,'LEADER',state.turn,state.revision+1);
  }
}
function banners(d){
  return {A:d.casualties.filter(c=>c.awardedTo==='A').length,
    B:d.casualties.filter(c=>c.awardedTo==='B').length};
}

export function assertSectionDiceLab(state){
  const d=state.diceLab;
  if(!state.combatLab||!record(d)||![1,2,3,4,5,6].includes(d.version)||!keyOK(d.key)||
     Object.keys(d).length!==(d.version>=5?10:d.version>=3?9:d.version===2?8:6)||!record(d.blocks)||
     Object.keys(d.blocks).length!==state.board.units.length||
     state.board.units.some(u=>!Object.hasOwn(d.blocks,u.id)||
       !Number.isSafeInteger(d.blocks[u.id])||d.blocks[u.id]<1||
       d.blocks[u.id]>BASE_UNIT_STARTING_BLOCKS[state.footLab.unitTypes[u.id]])||
     !Array.isArray(d.resolvedUnitIds)||new Set(d.resolvedUnitIds).size!==d.resolvedUnitIds.length||
     d.resolvedUnitIds.some(id=>!state.orderSnapshot?.pieces.some(p=>p.kind==='UNIT'&&
       p.id===id&&p.side===state.turn))||
     (!state.combatLab.movementClosed&&(d.pending!==null||d.resolvedUnitIds.length>0||d.last!==null))||
     !(d.last===null||(record(d.last)&&['DIRECT_HITS_APPLIED','ARCHIVED_WITHOUT_EFFECTS'].includes(d.last.outcome)&&
       d.resolvedUnitIds.includes(d.last.attackerId)))||
     !(d.pending===null||record(d.pending)))fail();
  if(d.version>=2){
    const live=new Set([...state.board.units,...state.board.leaders].map(p=>p.id));
    if(!Array.isArray(d.casualties)||d.casualties.length+live.size>117||
       new Set(d.casualties.map(c=>c?.id)).size!==d.casualties.length||
       d.casualties.some(c=>!record(c)||Object.keys(c).length!==5||
         typeof c.id!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(c.id)||
         live.has(c.id)||!['UNIT','LEADER'].includes(c.kind)||
         !['A','B'].includes(c.side)||c.awardedTo!==(c.side==='A'?'B':'A')||
         !Number.isSafeInteger(c.revision)||c.revision<1||c.revision>state.revision)||
       !(d.leaderCheck===null||record(d.leaderCheck)))fail();
    if(d.leaderCheck){
      if(!d.pending||!d.pending.loss.leaderCasualtyCheck||
         !['SERVER_GENERATED','ACCEPTED'].includes(d.pending.review)||
         (d.version===2&&d.pending.loss.effectiveFlagsPending>0)||
         !Number.isSafeInteger(d.leaderCheck.revision)||
         d.leaderCheck.revision<=d.pending.revision||
         d.leaderCheck.revision>state.revision||
         !same(deriveLeaderCheck(state,d.leaderCheck.revision),d.leaderCheck))fail();
    }
  }
  if(d.pending){
    const p=d.pending;
    if(!state.combatLab.plan||!Number.isSafeInteger(p.revision)||p.revision<1||
       p.revision>state.revision||!record(p.roll)||
       !['DIGITAL','PHYSICAL'].includes(p.roll.source)||
       !(p.roll.source==='DIGITAL'?p.review==='SERVER_GENERATED':
         ['AWAITING_OPPONENT','ACCEPTED','DISPUTED'].includes(p.review)))fail();
    const expected=derivePending(state,{revision:p.revision,mode:p.roll.source,
      faces:p.roll.results,review:p.review});
    if(!same(expected,p))fail();
  }
  if(d.version>=3&&d.morale!==null){
    const m=moralePreview(state),choice=d.morale;
    if(!m||!record(choice)||Object.keys(choice).length!==3||
       !Number.isSafeInteger(choice.revision)||choice.revision<=(d.leaderCheck?.revision??d.pending.revision)||
       choice.revision>state.revision||!Number.isSafeInteger(choice.ignored)||
       choice.ignored<0||choice.ignored>m.maxIgnored||m.maxIgnored===0||
       choice.remaining!==m.flags-choice.ignored)fail();
  }
  if(d.version>=5&&d.retreatPending!==null){
    const s=d.retreatPending,preview=retreatPreview(state);
    if(!record(s)||Object.keys(s).length!==4||!preview||
       !Number.isSafeInteger(s.revision)||s.revision<=(d.morale?.revision??d.leaderCheck?.revision??d.pending.revision)||
       s.revision>state.revision||s.required!==preview.required||
       !preview.options.some(o=>o.needsLeaderResolution&&same(o,s.choice))||
       !(s.leaderCheck===null||record(s.leaderCheck)))fail();
    if(s.leaderCheck&&(d.leaderCheck||!Number.isSafeInteger(s.leaderCheck.revision)||
       s.leaderCheck.revision<=s.revision||s.leaderCheck.revision>state.revision||
       !same(s.leaderCheck,deriveLeaderCheck(state,s.leaderCheck.revision,s.choice))))fail();
  }
  return true;
}

export const SECTION_DICE_COMMANDS=Object.freeze([
  'ROLL_SECTION_RANGED_DIGITAL_LAB','DECLARE_SECTION_RANGED_PHYSICAL_LAB',
  'REVIEW_SECTION_RANGED_PHYSICAL_LAB','FINALIZE_SECTION_RANGED_LAB',
  'ARCHIVE_SECTION_RANGED_LAB','ROLL_SECTION_LEADER_CASUALTY_LAB',
  'EVADE_SECTION_LEADER_LAB','CHOOSE_SECTION_MORALE_LAB','RETREAT_SECTION_UNIT_LAB'
]);

export function applySectionDiceCommand(state,next,command){
  const d=state.diceLab,plan=state.combatLab?.plan;
  if(!d||!plan)return deny('NO_COMBAT_PLAN_PENDING');
  const p=d.pending,side=command.actor;
  let event;
  if(command.type==='ROLL_SECTION_RANGED_DIGITAL_LAB'||command.type==='DECLARE_SECTION_RANGED_PHYSICAL_LAB'){
    if(p)return deny('RANGED_ROLL_ALREADY_CAPTURED');
    const mode=command.type==='ROLL_SECTION_RANGED_DIGITAL_LAB'?'DIGITAL':'PHYSICAL';
    try{
      next.diceLab.pending=derivePending(state,{revision:state.revision+1,mode,
        faces:command.faces,review:mode==='DIGITAL'?'SERVER_GENERATED':'AWAITING_OPPONENT'});
    }catch(e){
      if(mode==='PHYSICAL'&&e.message==='INVALID_PHYSICAL_DECLARATION')return deny('INVALID_PHYSICAL_DECLARATION');
      throw e;
    }
    const captured=next.diceLab.pending;
    event={kind:'SECTION_RANGED_ROLL_CAPTURED_LAB',side,attackerId:plan.attackerId,
      targetId:plan.targetId,roll:captured.roll,review:captured.review};
  }else if(command.type==='REVIEW_SECTION_RANGED_PHYSICAL_LAB'){
    if(side===state.turn||p?.review!=='AWAITING_OPPONENT')return deny('PHYSICAL_REVIEW_NOT_AVAILABLE');
    if(typeof command.accept!=='boolean')return deny('INVALID_PHYSICAL_REVIEW');
    next.diceLab.pending.review=command.accept?'ACCEPTED':'DISPUTED';
    event={kind:'SECTION_PHYSICAL_ROLL_REVIEWED_LAB',side,rollId:p.roll.rollId,
      review:next.diceLab.pending.review};
  }else if(command.type==='ROLL_SECTION_LEADER_CASUALTY_LAB'){
    if(d.retreatPending){
      if(effectiveLeaderCheck(d))return deny('LEADER_CHECK_ALREADY_CAPTURED');
      next.diceLab.retreatPending.leaderCheck=deriveLeaderCheck(state,state.revision+1,d.retreatPending.choice);
      return {accepted:true,event:{kind:'SECTION_RETREAT_LEADER_CASUALTY_CAPTURED_LAB',side,
        ...next.diceLab.retreatPending.leaderCheck,combatResolved:false}};
    }
    if(d.version<2||!p?.loss.leaderCasualtyCheck||(d.version===2&&p.loss.effectiveFlagsPending>0))
      return deny('LEADER_CHECK_NOT_AVAILABLE');
    if(!['SERVER_GENERATED','ACCEPTED'].includes(p.review))
      return deny('PHYSICAL_REVIEW_REQUIRED');
    if(d.leaderCheck)return deny('LEADER_CHECK_ALREADY_CAPTURED');
    next.diceLab.leaderCheck=deriveLeaderCheck(state,state.revision+1);
    event={kind:'SECTION_LEADER_CASUALTY_CAPTURED_LAB',side,
      ...next.diceLab.leaderCheck,combatResolved:false};
  }else if(command.type==='CHOOSE_SECTION_MORALE_LAB'){
    const m=moralePreview(state);
    if(side===state.turn||!m?.maxIgnored||d.morale)return deny('MORALE_CHOICE_NOT_AVAILABLE');
    if(!Number.isSafeInteger(command.ignored)||command.ignored<0||command.ignored>m.maxIgnored)
      return deny('INVALID_MORALE_CHOICE');
    next.diceLab.morale={revision:state.revision+1,ignored:command.ignored,remaining:m.flags-command.ignored};
    event={kind:'SECTION_MORALE_CHOSEN_LAB',side,targetId:plan.targetId,
      ...next.diceLab.morale,combatResolved:false};
  }else{
    if(!p)return deny('RANGED_ROLL_REQUIRED');
    if(p.review==='AWAITING_OPPONENT')return deny('PHYSICAL_REVIEW_REQUIRED');
    const blocker=p.review==='DISPUTED'?'PHYSICAL_ROLL_DISPUTED':resolutionBlocker(state,p);
    const evade=command.type==='EVADE_SECTION_LEADER_LAB';
    let evasion,escape;
    if(evade){
      if(side===state.turn||blocker!=='LEADER_EVASION_PENDING')
        return deny('LEADER_EVASION_NOT_AVAILABLE');
      if(typeof command.exit!=='boolean'||!Array.isArray(command.path)||
         command.path.length>3||!command.path.every(c=>record(c)&&
         Object.keys(c).length===2&&Number.isSafeInteger(c.col)&&Number.isSafeInteger(c.row)))
        return deny('INVALID_LEADER_EVASION_PATH');
      const path=command.path.map(c=>({col:c.col,row:c.row}));
      evasion=leaderEvasionOptions(state).find(o=>o.exit===command.exit&&same(o.path,path));
      if(!evasion)return deny('INVALID_LEADER_EVASION_PATH');
      if(d.version>=6)escape=resolveLeaderEscape(state,evasion);
    }
    const retreat=command.type==='RETREAT_SECTION_UNIT_LAB';
    let retreatChoice=d.retreatPending?.choice,retreatRequired=d.retreatPending?.required;
    if(retreat){
      if(side===state.turn||blocker!=='RETREAT_PENDING'||d.version<4||d.retreatPending)
        return deny('RETREAT_NOT_AVAILABLE');
      const preview=retreatPreview(state);
      if(!preview?.options.length)return deny(preview?.reason??'RETREAT_NOT_AVAILABLE');
      if(!Array.isArray(command.path)||command.path.length>10||!command.path.every(c=>
         record(c)&&Object.keys(c).length===2&&Number.isSafeInteger(c.col)&&Number.isSafeInteger(c.row)))
        return deny('INVALID_RETREAT_PATH');
      const path=command.path.map(c=>({col:c.col,row:c.row}));
      retreatChoice=preview.options.find(o=>same(o.path,path));
      if(!retreatChoice)return deny('INVALID_RETREAT_PATH');
      retreatRequired=preview.required;
      if(d.version>=5&&retreatChoice.needsLeaderResolution){
        next.diceLab.retreatPending={revision:state.revision+1,choice:structuredClone(retreatChoice),
          required:retreatRequired,leaderCheck:null};
        return {accepted:true,event:{kind:'SECTION_RETREAT_STAGED_LAB',side,targetId:plan.targetId,
          ...retreatChoice,required:retreatRequired,combatResolved:false}};
      }
    }
    const finalize=command.type==='FINALIZE_SECTION_RANGED_LAB'||evade||retreat;
    if(finalize&&blocker&&!evade&&!retreat)return deny(blocker);
    if(!finalize&&!blocker)return deny('DIRECT_HIT_FINALIZATION_REQUIRED');
    if(!finalize&&d.retreatPending)return deny(blocker??'DIRECT_HIT_FINALIZATION_REQUIRED');
    if(d.version>=2&&!finalize&&blocker==='LEADER_CHECK_PENDING')
      return deny('LEADER_CHECK_REQUIRED');
    if(d.version>=3&&!finalize&&blocker==='MORALE_CHOICE_PENDING')return deny('MORALE_CHOICE_REQUIRED');
    if(d.version>=3&&!finalize&&blocker==='LEADER_EVASION_PENDING'&&leaderEvasionOptions(state).length)
      return deny('LEADER_EVASION_PENDING');
    if(d.version>=4&&!finalize&&blocker==='RETREAT_PENDING'&&retreatPreview(state)?.options.length)
      return deny('RETREAT_PENDING');
    if(finalize){
      if(d.version>=2)applyDirectLoss(state,next,plan,p);
      else next.diceLab.blocks[plan.targetId]=p.loss.remainingBlocks;
      if(retreatChoice){
        const target=next.board.units.find(u=>u.id===plan.targetId);
        const leader=next.board.leaders.find(l=>l.side===target.side&&hex(l)===hex(target));
        const destination=retreatChoice.path.at(-1);
        const remaining=next.diceLab.blocks[target.id]-retreatChoice.blocksLost;
        if(d.retreatPending?.leaderCheck?.outcome.leaderWouldBeEliminated){
          next.board.leaders=next.board.leaders.filter(l=>l.id!==leader.id);
          awardCasualty(next,leader,'LEADER',state.turn,state.revision+1);
        }else if(leader&&destination){Object.assign(leader,destination);}
        if(remaining===0){
          next.board.units=next.board.units.filter(u=>u.id!==target.id);
          delete next.footLab.unitTypes[target.id];delete next.diceLab.blocks[target.id];
          awardCasualty(next,target,'UNIT',state.turn,state.revision+1);
        }else{
          next.diceLab.blocks[target.id]=remaining;
          if(destination)Object.assign(target,destination);
        }
      }
      if(evasion){
        const leader=next.board.leaders.find(l=>l.id===effectiveLeaderCheck(d).leaderId);
        if(escape?.eliminated){
          next.board.leaders=next.board.leaders.filter(l=>l.id!==leader.id);
          awardCasualty(next,leader,'LEADER',state.turn,state.revision+1);
        }else if(evasion.exit)next.board.leaders=next.board.leaders.filter(l=>l.id!==leader.id);
        else Object.assign(leader,evasion.path.at(-1));
      }
    }
    next.diceLab.resolvedUnitIds.push(plan.attackerId);
    const result={attackerId:plan.attackerId,targetId:plan.targetId,roll:p.roll,
      review:p.review,interpretation:p.interpretation,loss:p.loss,
      outcome:finalize?'DIRECT_HITS_APPLIED':'ARCHIVED_WITHOUT_EFFECTS',
      reason:evade||retreat?null:blocker,blocksApplied:finalize?p.loss.blocksToRemove+(retreatChoice?.blocksLost??0):0,
      blocksRemaining:next.diceLab.blocks[plan.targetId]??0,
      ...(d.version>=2?{leaderCheck:structuredClone(effectiveLeaderCheck(d)),
        unitEliminated:finalize&&(p.loss.unitWouldBeEliminated||!!retreatChoice&&retreatChoice.blocksLost===p.loss.remainingBlocks),
        leaderEliminated:finalize&&(!!effectiveLeaderCheck(d)?.outcome.leaderWouldBeEliminated||!!escape?.eliminated),
        banners:banners(next.diceLab)}:{}),
      ...(evasion?{leaderEvasion:{leaderId:effectiveLeaderCheck(d).leaderId,...evasion,...(escape?{escape}:{})}}:{}),
      ...(d.version>=3?{morale:structuredClone(d.morale)}:{}),
      ...(retreatChoice?{retreat:{...retreatChoice,required:retreatRequired}}:{})};
    next.diceLab.last=structuredClone(result);
    next.diceLab.pending=null;
    if(d.version>=2)next.diceLab.leaderCheck=null;
    if(d.version>=3)next.diceLab.morale=null;
    if(d.version>=5)next.diceLab.retreatPending=null;
    next.combatLab.plan=null;
    event={kind:retreatChoice?'SECTION_RETREAT_APPLIED_LAB':finalize?'SECTION_RANGED_DIRECT_HITS_APPLIED_LAB':'SECTION_RANGED_ARCHIVED_LAB',
      side,...result,combatResolved:false};
  }
  return {accepted:true,event};
}

export function projectSectionDiceLab(state,side){
  const d=state.diceLab,p=d.pending;
  const blocker=p?(p.review==='DISPUTED'?'PHYSICAL_ROLL_DISPUTED':resolutionBlocker(state,p)):null;
  const evasionOptions=blocker==='LEADER_EVASION_PENDING'?leaderEvasionOptions(state):[];
  const retreat=blocker==='RETREAT_PENDING'?retreatPreview(state):null;
  return {blocks:{...d.blocks},resolvedUnitIds:[...d.resolvedUnitIds],
    pending:p?structuredClone(p):null,last:d.last?structuredClone(d.last):null,
    canReview:side!==state.turn&&p?.review==='AWAITING_OPPONENT',
    canFinalize:side===state.turn&&!!p&&!blocker&&p.review!=='AWAITING_OPPONENT',
    canArchive:side===state.turn&&!!p&&!!blocker&&p.review!=='AWAITING_OPPONENT'&&
      !(d.version>=2&&blocker==='LEADER_CHECK_PENDING')&&
      !(d.version>=3&&(blocker==='MORALE_CHOICE_PENDING'||evasionOptions.length>0))&&
      !retreat?.options.length&&!d.retreatPending,
    ...(d.version>=2?{banners:banners(d),casualties:structuredClone(d.casualties),
      leaderCheck:structuredClone(effectiveLeaderCheck(d)),
      leaderEvasionOptions:side!==state.turn?evasionOptions:[],
      canEvadeLeader:side!==state.turn&&evasionOptions.length>0,
      leaderEvasionAvailable:evasionOptions.length>0,
      canRollLeader:side===state.turn&&blocker==='LEADER_CHECK_PENDING'&&
        ['SERVER_GENERATED','ACCEPTED'].includes(p?.review)}:{}),
    ...(d.version>=3?{moralePreview:moralePreview(state),morale:structuredClone(d.morale),
      canChooseMorale:side!==state.turn&&blocker==='MORALE_CHOICE_PENDING'}:{}),
    ...(d.version>=4?{retreat:retreat?{...retreat,options:side!==state.turn?retreat.options:[]}:null,
      canRetreat:side!==state.turn&&!!retreat?.options.length}:{}),
    ...(d.version>=5?{retreatPending:structuredClone(d.retreatPending)}:{}),
    blocker};
}

export function resetSectionDiceTurn(next){
  next.diceLab.resolvedUnitIds=[];
  next.diceLab.pending=null;
  next.diceLab.last=null;
  if(next.diceLab.version>=2)next.diceLab.leaderCheck=null;
  if(next.diceLab.version>=3)next.diceLab.morale=null;
  if(next.diceLab.version>=5)next.diceLab.retreatPending=null;
}
