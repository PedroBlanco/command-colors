/**
 * Section history LAB_ONLY: versioned server-owned dice and restricted direct
 * losses. Replay derives the same digital dice from a private per-game key.
 * No result, key, block count or dice distribution is accepted from the client.
 * Physical faces are declarations, never cryptographically verified.
 */
import {randomBytes,createHmac} from 'node:crypto';
import {neighbors,distance,inBounds} from '../hex-grid/hex.mjs';
import {assessAncientsTerrainMovement} from './terrain-movement.mjs';
import {BASE_MOVEMENT_PROFILES} from './movement-profile.mjs';
import {ANCIENTS_BATTLE_DIE_FACES,BASE_UNIT_DIE_SYMBOLS,captureBaseAncientsRangedDice,interpretBaseAncientsRangedDice,interpretBaseAncientsCloseDice} from './battle-dice.mjs';
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
  if(!keyOK(key)||!/^section_(?:ranged|close|leader|escape|rampage|blocker)_[1-9][0-9]*$/.test(rollId))fail();
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

export function initializeSectionDiceLab(unitTypes,{casualties=false,morale=false,retreat=false,retreatLeaders=false,leaderEscape=false,rampage=false,rampageLeaders=false,elephantRetreatLeaders=false,victoryTargets=null,closeCombat=false,unitEvade=false,battleBack=false,momentum=false,bonusClose=false,elephantClose=false,specialClose=false}={}){
  if((morale&&!casualties)||(retreat&&!morale)||(retreatLeaders&&!retreat)||(leaderEscape&&!retreatLeaders)||(rampage&&!leaderEscape)||(rampageLeaders&&!rampage)||(elephantRetreatLeaders&&!rampageLeaders))fail();
  if(victoryTargets!==null&&(!elephantRetreatLeaders||!validVictoryTargets(victoryTargets)))fail();
  if(typeof closeCombat!=='boolean'||(closeCombat&&victoryTargets===null))fail();
  if(typeof unitEvade!=='boolean'||(unitEvade&&!closeCombat))fail();
  if(typeof battleBack!=='boolean'||(battleBack&&!unitEvade))fail();
  if(typeof momentum!=='boolean'||(momentum&&!battleBack))fail();
  if(typeof bonusClose!=='boolean'||(bonusClose&&!momentum))fail();
  if(typeof elephantClose!=='boolean'||(elephantClose&&!bonusClose))fail();
  if(typeof specialClose!=='boolean'||(specialClose&&!elephantClose))fail();
  return {version:specialClose?17:elephantClose?16:bonusClose?15:momentum?14:battleBack?13:unitEvade?12:closeCombat?11:victoryTargets!==null?10:elephantRetreatLeaders?9:rampageLeaders?8:rampage?7:leaderEscape?6:retreatLeaders?5:retreat?4:morale?3:casualties?2:1,key:randomBytes(32).toString('hex'),
    blocks:Object.fromEntries(Object.entries(unitTypes).map(([id,type])=>[
      id,BASE_UNIT_STARTING_BLOCKS[type]
    ])),
    resolvedUnitIds:[],pending:null,last:null,
    ...(casualties?{casualties:[],leaderCheck:null}:{}),
    ...(morale?{morale:null}:{}),
    ...(retreatLeaders?{retreatPending:null}:{}),
    ...(rampage?{rampage:[]}:{}),
    ...(elephantRetreatLeaders?{elephantRetreatPending:null}:{}),
    ...(victoryTargets!==null?{victoryTargets:{...victoryTargets}}:{})};
}

// The card turn never changes during a defensive response.
export function sectionCombatSide(state){
  return state.combatLab?.plan?.battleBack?(state.turn==='A'?'B':'A'):state.turn;
}

// After a successful ordered close attack, choose a path beginning with
// the former defender's hex. This is not a second ordered movement.
const momentumCavalry=new Set(['LIGHT_CAVALRY','MEDIUM_CAVALRY','HEAVY_CAVALRY']);
export function sectionMomentumOptions(state){
  const d=state.diceLab,last=d?.last,m=last?.momentum;
  if(!(d?.version>=14)||!m?.pending||!['CLOSE',...(d.version>=15?['BONUS_CLOSE']:[])].includes(last.attackKind)||
    last.outcome!=='DIRECT_HITS_APPLIED'||last.battleBackPending||last.unitEvasion||
    state.combatLab.plan||sectionVictory(state)?.winner)return [];
  const unit=state.board.units.find(u=>u.id===last.attackerId&&u.side===state.turn);
  const target=state.board.units.find(u=>u.id===last.targetId);
  if(!unit||!record(m.hex)||!inBounds(m.hex)||distance(unit,m.hex)!==1||
    (target&&hex(target)===hex(m.hex)))return [];
  const unitType=state.footLab.unitTypes[unit.id],terrain=state.footLab.terrain??[];
  if(unitType==='HEAVY_WAR_MACHINE')return [];
  const attached=state.board.leaders.find(l=>l.side===unit.side&&hex(l)===hex(unit));
  const terrainAt=c=>terrain.find(t=>hex(t)===hex(c))?.kind??'CLEAR';
  const available=c=>!state.board.units.some(u=>u.id!==unit.id&&hex(u)===hex(c))&&
    !state.board.leaders.some(l=>l.id!==attached?.id&&hex(l)===hex(c)&&
      (l.side!==unit.side||!!attached));
  // A normal move that entered forest must end there for this turn.
  if((state.combatLab.movement[unit.id]?.steps||last.attackKind==='BONUS_CLOSE'&&last.forestEntered)&&terrainAt(unit)==='FOREST')return [];
  const first={col:m.hex.col,row:m.hex.row};
  if(!available(first))return [];
  const options=[];
  const add=(path,origin)=>{
    const check=assessAncientsTerrainMovement({unitType,origin,path:[path.at(-1)],terrain});
    if(check.status!=='CANDIDATE')return;
    const joined=state.board.leaders.some(l=>l.side===unit.side&&l.id!==attached?.id&&hex(l)===hex(path.at(-1)));
    const bonusEligible=last.attackKind!=='BONUS_CLOSE'&&check.battleOnEntry!=='UNAVAILABLE'&&
      (momentumCavalry.has(unitType)||d.version>=16&&unitType==='ELEPHANT'||d.version>=17&&unitType==='HEAVY_CHARIOT'||unitType==='WARRIOR_INFANTRY'||!!attached||joined);
    options.push({path,bonusEligible});
  };
  add([first],unit);
  if(last.attackKind!=='BONUS_CLOSE'&&options.length&&momentumCavalry.has(unitType)&&!['FOREST','BROKEN_GROUND'].includes(terrainAt(first))&&
    !state.board.leaders.some(l=>l.id!==attached?.id&&hex(l)===hex(first))){
    for(const cell of neighbors(first))if(available(cell))add([first,{col:cell.col,row:cell.row}],first);
  }
  return options;
}

function derivePending(state,{revision,mode,faces,review,redIgnored=undefined}){
  const plan=state.combatLab.plan,target=state.board.units.find(u=>u.id===plan.targetId);
  const close=plan.kind==='CLOSE_PREVIEW';
  const rollId=(close?'section_close_':'section_ranged_')+revision;
  const repeats=!!plan.elephantAttack&&plan.swordsHit&&!plan.evadePath?.length;
  const draw=mode==='DIGITAL'?sectionRollIndex(state.diceLab.key,rollId):null;
  const roll=captureBaseAncientsRangedDice({rollId,actor:sectionCombatSide(state),
    diceCount:plan.diceCount,mode,
    ...(mode==='DIGITAL'?{randomIndex:draw}:{declaredFaces:repeats&&Array.isArray(faces)?faces.slice(0,plan.diceCount):faces})});
  let interpretation=close?interpretBaseAncientsCloseDice({
    roll,targetUnitType:plan.targetUnitType,expectedDiceCount:plan.diceCount,
    swordsHit:plan.swordsHit,leaderHit:plan.leaderHit,evading:!!plan.evadePath?.length
  }):interpretBaseAncientsRangedDice({
    roll,targetUnitType:plan.targetUnitType,expectedDiceCount:plan.diceCount
  });
  // A chariot cancels its first sword hit, before any elephant repetitions.
  if(plan.chariotDefense&&interpretation.swordHits>0){
    let ignored=false;
    interpretation={...interpretation,swordHits:interpretation.swordHits-1,hits:interpretation.hits-1,
      misses:interpretation.misses+1,dieEffects:interpretation.dieEffects.map(e=>{
        if(!ignored&&e.outcome==='SWORD_HIT'){ignored=true;return {...e,outcome:'CHARIOT_SWORD_IGNORED'};}
        return e;
      }),chariotSwordIgnored:true};
  }
  // Each effective sword creates exactly one further die. A flat, ordered
  // transcript makes physical review and deterministic replay unambiguous.
  let rerolls=[];
  if(repeats){
    let remaining=interpretation.swordHits;
    let extraHits=0,extraMatching=0,extraSwords=0,extraFlags=0,extraMisses=0;
    const dieEffects=[...interpretation.dieEffects];
    while(remaining>0){
      const index=plan.diceCount+rerolls.length;
      if(index>=256)throw new TypeError('ELEPHANT_ROLL_LIMIT_REACHED');
      const face=mode==='DIGITAL'?ANCIENTS_BATTLE_DIE_FACES[draw(6)]:faces?.[index];
      if(!ANCIENTS_BATTLE_DIE_FACES.includes(face))throw new TypeError('INVALID_PHYSICAL_DECLARATION');
      rerolls.push(face);remaining--;
      let outcome='NO_CLOSE_EFFECT';
      if(face===interpretation.targetSymbol){extraMatching++;extraHits++;outcome='MATCHING_COLOR_HIT';}
      else if(face==='SWORDS'){extraSwords++;extraHits++;remaining++;outcome='SWORD_HIT';}
      else if(face==='FLAG'){extraFlags++;outcome='FLAG_PENDING';}
      else extraMisses++;
      dieEffects.push({face,outcome});
    }
    if(mode==='PHYSICAL'&&faces.length!==plan.diceCount+rerolls.length)throw new TypeError('INVALID_PHYSICAL_DECLARATION');
    interpretation={...interpretation,diceCount:plan.diceCount+rerolls.length,
      matchingColorHits:interpretation.matchingColorHits+extraMatching,swordHits:interpretation.swordHits+extraSwords,
      hits:interpretation.hits+extraHits,flagsPending:interpretation.flagsPending+extraFlags,
      misses:interpretation.misses+extraMisses,dieEffects,rerolls};
  }
  const redChoice=!!plan.elephantMountedDefense&&interpretation.matchingColorHits>0;
  if(redChoice){
    if(redIgnored===undefined)redIgnored=null;
    if(redIgnored!==null&&typeof redIgnored!=='boolean')fail();
    if(redIgnored){
      let ignored=false;
      interpretation={...interpretation,matchingColorHits:interpretation.matchingColorHits-1,hits:interpretation.hits-1,
        misses:interpretation.misses+1,dieEffects:interpretation.dieEffects.map(e=>{
          if(!ignored&&e.outcome==='MATCHING_COLOR_HIT'){ignored=true;return {...e,outcome:'ELEPHANT_RED_IGNORED'};}
          return e;
        })};
    }
    interpretation={...interpretation,redIgnored};
  }else if(redIgnored!==undefined)fail();
  const loss=previewBaseAncientsRangedBlockLoss({
    unitType:plan.targetUnitType,blocksRemaining:state.diceLab.blocks[target.id],
    diceCount:interpretation.diceCount,matchingColorHits:close?interpretation.hits:interpretation.matchingColorHits,
    ...(interpretation.diceCount>32?{extendedDice:true}:{}),
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
  if(d.version<3||p?.interpretation.redIgnored===null||!p?.loss.effectiveFlagsPending||
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
  const capacity=Number(attachedLeader)+Number(supported)+Number(fullWarrior)+Number(!!state.combatLab.plan.elephantMountedDefense);
  const flags=p.loss.effectiveFlagsPending;
  return {flags,attachedLeader,supported,fullWarrior,supportHexes,
    maxIgnored:Math.min(flags,capacity)};
}

function unsupported(state,pending){
  const l=pending.loss,d=state.diceLab;
  if(pending.interpretation.redIgnored===null)return 'ELEPHANT_RED_CHOICE_PENDING';
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
  if(d.elephantRetreatPending)return elephantStageShadow(state).pending?'ELEPHANT_RETREAT_EVASION_PENDING':null;
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
  return escapeRoutes(state,leader,origin);
}

function escapeRoutes(state,leader,origin=leader){
  const d=state.diceLab;
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

function resolveLeaderEscape(state,option,revision=state.revision+1){
  const rollId='section_escape_'+revision,draw=sectionRollIndex(state.diceLab.key,rollId);
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

// V7: one digital roll per adjacent unit, in the order chosen by the
// player causing the rampage. Keep the original board until finalization.
// Leader consequences are deliberately excluded before any dice are drawn.
function elephantContext(state){
  const d=state.diceLab,p=d.pending;
  if(d.version<7||!p||!['SERVER_GENERATED','ACCEPTED'].includes(p.review)||
     p.loss.unitType!=='ELEPHANT'||unsupported(state,p)!=='RETREAT_PENDING')return null;
  const target=state.board.units.find(u=>u.id===state.combatLab.plan.targetId);
  const required=p.loss.effectiveFlagsPending-(d.morale?.ignored??0);
  const adjacent=neighbors(target),keys=new Set(adjacent.map(hex));
  const units=state.board.units.filter(u=>keys.has(hex(u)));
  if(d.version>=8)units.push(...state.board.leaders.filter(l=>keys.has(hex(l))&&!state.board.units.some(u=>hex(u)===hex(l))).map(l=>({...l,loneLeader:true})));
  const sign=target.side==='A'?1:-1,rear=target.side==='A'?8:0,depth=c=>2*c.row+(c.col&1);
  const rearward=c=>c.row===rear?[]:neighbors(c).filter(n=>sign*(depth(n)-depth(c))>0);
  // Include every possible retreat/blocker hex, even if rampage opens a path.
  const affected=new Set([hex(target),...keys]);
  let frontier=[target];
  for(let i=0;i<required&&frontier.length;i++){
    const next=new Map();
    for(const cell of frontier)for(const n of rearward(cell)){affected.add(hex(n));next.set(hex(n),n);}
    frontier=[...next.values()];
  }
  const leaderPending=d.version<9&&state.board.leaders.some(l=>(d.version>=8?hex(l)===hex(target):affected.has(hex(l)))&&
    !(l.id===d.leaderCheck?.leaderId&&d.leaderCheck.outcome.leaderWouldBeEliminated));
  return {target,required,units,rearward,leaderPending};
}
function deriveRampageRoll(state,unit,revision){
  const rollId='section_rampage_'+revision,draw=sectionRollIndex(state.diceLab.key,rollId);
  const results=Array.from({length:2},()=>ANCIENTS_BATTLE_DIE_FACES[draw(6)]);
  const symbol=BASE_UNIT_DIE_SYMBOLS[state.footLab.unitTypes[unit.id]];
  return {revision,rollId,unitId:unit.id,side:unit.side,results,
    blocksLost:Math.min(state.diceLab.blocks[unit.id],results.filter(f=>f===symbol).length)};
}
// Replay the ordered effects on a detached board. The original pending
// ranged plan remains valid until the entire resolution is committed.
function rampageLeaderLoss(next,leader,revision){
  next.board.leaders=next.board.leaders.filter(l=>l.id!==leader.id);
  awardCasualty(next,leader,'LEADER',leader.side==='A'?'B':'A',revision);
}
function deriveRampageWithLeader(state,piece,revision){
  const d=state.diceLab,unit=state.board.units.find(u=>u.id===piece.id);
  const leader=unit?state.board.leaders.find(l=>hex(l)===hex(unit)&&l.side===unit.side):state.board.leaders.find(l=>l.id===piece.id);
  if(!unit&&!leader)fail();
  const rollId='section_rampage_'+revision,draw=sectionRollIndex(d.key,rollId);
  const dice=n=>Array.from({length:n},()=>ANCIENTS_BATTLE_DIE_FACES[draw(6)]);
  const results=dice(2),blocksLost=unit?Math.min(d.blocks[unit.id],results.filter(f=>f===BASE_UNIT_DIE_SYMBOLS[state.footLab.unitTypes[unit.id]]).length):0;
  const eliminated=!!unit&&blocksLost===d.blocks[unit.id];
  const winsOnUnit=!!d.victoryTargets&&eliminated&&banners(d)[unit.side==='A'?'B':'A']+1>=d.victoryTargets[unit.side==='A'?'B':'A'];
  const leaderFaces=leader&&!winsOnUnit?(unit?(blocksLost?dice(eliminated?1:2):[]):results):[];
  const leaderEliminated=leaderFaces.length>0&&(unit?leaderFaces.every(f=>f==='LEADER'):leaderFaces.includes('LEADER'));
  return {revision,rollId,unitId:piece.id,side:piece.side,results,blocksLost,
    leaderId:leader?.id??null,leaderFaces,leaderEliminated,
    needsEvasion:!!leader&&!winsOnUnit&&!leaderEliminated&&(!unit||eliminated),evasion:null};
}
function applyRampageRecord(next,roll,revision){
  applyRampageUnitLoss(next,roll.unitId,roll.blocksLost,revision);
  const leader=next.board.leaders.find(l=>l.id===roll.leaderId);
  if(roll.leaderEliminated)rampageLeaderLoss(next,leader,revision);
  if(roll.evasion){
    if(roll.evasion.escape.eliminated)rampageLeaderLoss(next,leader,revision);
    else if(roll.evasion.exit)next.board.leaders=next.board.leaders.filter(l=>l.id!==leader.id);
    else Object.assign(leader,roll.evasion.path.at(-1));
  }
}
function rampageShadow(state,ctx){
  const shadow=structuredClone(state),seen=new Set();
  let revision=state.diceLab.leaderCheck?.revision??state.diceLab.pending.revision,pending=null;
  if(state.diceLab.version>=9)applyDirectLoss(state,shadow,state.combatLab.plan,state.diceLab.pending,state.diceLab.version>=10?state.revision:state.revision+1);
  else if(state.diceLab.leaderCheck?.outcome.leaderWouldBeEliminated)
    shadow.board.leaders=shadow.board.leaders.filter(l=>l.id!==state.diceLab.leaderCheck.leaderId);
  for(const roll of state.diceLab.rampage){
    const piece=ctx.units.find(u=>u.id===roll?.unitId);
    if(!piece||pending||seen.has(piece.id)||!Number.isSafeInteger(roll.revision)||
       roll.revision<=revision||roll.revision>state.revision)fail();
    const canonical=deriveRampageWithLeader(shadow,piece,roll.revision);
    if(!same(canonical,{...roll,evasion:null}))fail();
    applyRampageRecord(shadow,canonical,roll.revision);
    revision=roll.revision;seen.add(piece.id);
    if(canonical.needsEvasion){
      const leader=shadow.board.leaders.find(l=>l.id===canonical.leaderId);
      const options=escapeRoutes(shadow,leader);
      if(roll.evasion){
        const e=roll.evasion,o=options.find(x=>x.exit===e.exit&&same(x.path,e.path));
        if(!o||!Number.isSafeInteger(e.revision)||e.revision<=revision||e.revision>state.revision||
           !same(e,{revision:e.revision,...o,escape:resolveLeaderEscape(shadow,o,e.revision)}))fail();
        applyRampageRecord(shadow,{unitId:roll.unitId,blocksLost:0,leaderId:roll.leaderId,evasion:e},e.revision);
        revision=e.revision;
      }else pending={leaderId:leader.id,side:leader.side,options};
    }else if(roll.evasion!==null)fail();
  }
  return {shadow,pending,seen};
}
function elephantRetreat(state,ctx){
  const d=state.diceLab,flags=ctx.required;
  const base={flags,required:flags,options:[]};
  if(ctx.leaderPending)return {...base,reason:'ELEPHANT_LEADER_EFFECTS_PENDING'};
  const replayed=d.version>=8?rampageShadow(state,ctx):null;
  if(replayed?.pending)return {...base,reason:'RAMPAGE_LEADER_EVASION_PENDING'};
  if(d.rampage.length<ctx.units.length)return {...base,reason:'ELEPHANT_RAMPAGE_PENDING'};
  const remaining={...(replayed?.shadow.diceLab.blocks??d.blocks)};
  if(!replayed)for(const roll of d.rampage)remaining[roll.unitId]-=roll.blocksLost;
  const board=replayed?.shadow.board??state.board;
  const occupied=new Map(board.units.filter(u=>remaining[u.id]>0).map(u=>[hex(u),u]));
  const leaders=new Map(replayed?board.leaders.map(l=>[hex(l),l]):[]);
  // A friendly leader may have evaded onto the elephant during the rampage.
  // Do not admit a second leader or lose the attached leader without a check.
  const attached=leaders.get(hex(ctx.target));
  const terminals=[];
  let frontier=new Map([[hex(ctx.target),{cell:ctx.target,path:[]}]]);
  for(let i=0;i<=flags&&frontier.size;i++){
    const next=new Map();
    for(const {cell,path} of frontier.values()){
      const joined=path.length&&leaders.get(hex(cell))?.side===ctx.target.side?leaders.get(hex(cell)):null;
      const rear=i===flags||joined?[]:ctx.rearward(cell);
      const open=rear.filter(c=>!occupied.has(hex(c))&&(!leaders.has(hex(c))||(!attached&&leaders.get(hex(c)).side===ctx.target.side)));
      if(!open.length){
        const missing=joined?0:flags-i;
        // When units block every rearward hex, each takes all missing steps.
        // At the board edge (no hex to enter), ordinary block loss applies.
        const blockingLosses=rear.map(c=>occupied.get(hex(c))).filter(Boolean)
          .map(u=>({unitId:u.id,blocksLost:Math.min(remaining[u.id],missing)}));
        if(replayed)for(const c of rear){const l=leaders.get(hex(c));if(l&&!occupied.has(hex(c))&&l.side!==ctx.target.side)blockingLosses.push({leaderId:l.id,blocksLost:1});}
        const attachedFriendBlock=!!attached&&rear.some(c=>!occupied.has(hex(c))&&leaders.get(hex(c))?.side===ctx.target.side);
        const needsBlockerLeader=!!replayed&&(blockingLosses.some(loss=>loss.unitId&&board.leaders.some(l=>hex(l)===hex(board.units.find(u=>u.id===loss.unitId))))||!!attached&&missing>0&&!blockingLosses.length||attachedFriendBlock);
        terminals.push({path,missing,blocksLost:blockingLosses.length?0:Math.min(state.diceLab.pending.loss.remainingBlocks,missing),
          joinedLeaderId:joined?.id??null,needsLeaderResolution:false,blockingLosses,...(replayed?{needsBlockerLeader}:{}),...(d.version>=9?{attachedFriendBlock}:{})});
      }
      for(const dest of open)if(!next.has(hex(dest)))next.set(hex(dest),{cell:dest,path:[...path,dest]});
    }
    frontier=next;
  }
  const legal=terminals.some(o=>o.missing===0)?terminals.filter(o=>o.missing===0):terminals;
  const options=legal.filter(o=>d.version>=9?!o.attachedFriendBlock:!o.needsBlockerLeader);
  return {...base,options,reason:options.length?null:'ELEPHANT_BLOCKER_LEADERS_PENDING'};
}

// V9: all blocker losses are applied together before leader checks or
// escape choices. Only the original combat's check may be reused for its
// own target; a separate rampage roll is a different source of losses.
function elephantLossBoard(state,choice,revision){
  const ctx=elephantContext(state),{shadow,pending}=rampageShadow(state,ctx);
  if(pending)fail();
  const target=shadow.board.units.find(u=>u.id===ctx.target.id);
  const attached=shadow.board.leaders.find(l=>hex(l)===hex(target)&&l.side===target.side);
  const destination=choice.path.at(-1);
  if(destination){Object.assign(target,destination);if(attached)Object.assign(attached,destination);}
  const affected=[];
  const losses=[...choice.blockingLosses,...(choice.blocksLost?[{unitId:target.id,blocksLost:choice.blocksLost}]:[])];
  for(const loss of losses){
    if(loss.leaderId){rampageLeaderLoss(shadow,shadow.board.leaders.find(l=>l.id===loss.leaderId),revision);continue;}
    const unit=shadow.board.units.find(u=>u.id===loss.unitId);
    const leader=shadow.board.leaders.find(l=>l.side===unit.side&&hex(l)===hex(unit));
    const eliminated=shadow.diceLab.blocks[unit.id]===loss.blocksLost;
    if(leader)affected.push({leaderId:leader.id,unitId:unit.id,eliminated,
      reused:unit.id===target.id&&state.diceLab.leaderCheck?.leaderId===leader.id});
    applyRampageUnitLoss(shadow,unit.id,loss.blocksLost,revision);
  }
  if(sectionVictory(shadow)?.winner)return {shadow,checks:[]};
  const rollId='section_blocker_'+revision,draw=sectionRollIndex(state.diceLab.key,rollId);
  const checks=[];
  for(const a of affected){
    const faces=a.reused?[]:Array.from({length:a.eliminated?1:2},()=>ANCIENTS_BATTLE_DIE_FACES[draw(6)]);
    const leaderEliminated=faces.length>0&&faces.every(f=>f==='LEADER');
    if(leaderEliminated)rampageLeaderLoss(shadow,shadow.board.leaders.find(l=>l.id===a.leaderId),revision);
    checks.push({...a,faces,leaderEliminated,needsEvasion:a.eliminated&&!leaderEliminated});
    if(sectionVictory(shadow)?.winner)break;
  }
  return {shadow,checks};
}
function elephantStageShadow(state){
  const stage=state.diceLab.elephantRetreatPending,ctx=elephantContext(state);
  if(!stage||!ctx||!record(stage)||Object.keys(stage).length!==5||
     !Number.isSafeInteger(stage.revision)||stage.revision>state.revision||
     stage.revision<=(state.diceLab.rampage.at(-1)?.evasion?.revision??state.diceLab.rampage.at(-1)?.revision??state.diceLab.leaderCheck?.revision??state.diceLab.pending.revision)||
     !Array.isArray(stage.evasions))fail();
  const preview=elephantRetreat(state,ctx);
  if(stage.required!==preview.required||!preview.options.some(o=>same(o,stage.choice)))fail();
  const {shadow,checks}=elephantLossBoard(state,stage.choice,stage.revision);
  if(!same(checks,stage.checks))fail();
  let index=0,previous=stage.revision,pending=null;
  for(const check of checks.filter(c=>c.needsEvasion)){
    const leader=shadow.board.leaders.find(l=>l.id===check.leaderId);
    const options=escapeRoutes(shadow,leader);
    const e=stage.evasions[index];
    if(!e){pending={leaderId:leader.id,side:leader.side,options};break;}
    const option=options.find(o=>o.exit===e.exit&&same(o.path,e.path));
    if(!option||e.leaderId!==leader.id||!Number.isSafeInteger(e.revision)||e.revision<=previous||
       e.revision>state.revision||!same(e,{leaderId:leader.id,revision:e.revision,...option,escape:resolveLeaderEscape(shadow,option,e.revision)}))fail();
    applyRampageRecord(shadow,{unitId:null,blocksLost:0,leaderId:leader.id,evasion:e},e.revision);
    previous=e.revision;index++;
  }
  if(index!==stage.evasions.length)fail();
  return {shadow,pending};
}

// Ordinary retreats: no impassable terrain in this
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
  if(type==='ELEPHANT')return d.version>=7?elephantRetreat(state,elephantContext(state)):{flags,required,options:[],reason:'ELEPHANT_RAMPAGE_PENDING'};
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
    rollId,actor:sectionCombatSide(state),diceCount:loss.leaderCasualtyCheck.diceCount,
    mode:'DIGITAL',randomIndex:sectionRollIndex(state.diceLab.key,rollId)
  });
  return {revision,leaderId:leader.id,roll,
    outcome:previewBaseAncientsLeaderCasualtyCheck({checklist,roll})};
}

function awardCasualty(next,piece,kind,side,revision){
  next.diceLab.casualties.push({id:piece.id,kind,side:piece.side,
    awardedTo:side,revision});
}

function applyRampageUnitLoss(next,id,amount,revision){
  if(!amount)return;
  const unit=next.board.units.find(u=>u.id===id);
  if(!unit||!Number.isSafeInteger(amount)||amount<1||amount>next.diceLab.blocks[id])fail();
  if(amount<next.diceLab.blocks[id])next.diceLab.blocks[id]-=amount;
  else{
    next.board.units=next.board.units.filter(u=>u.id!==id);
    delete next.footLab.unitTypes[id];delete next.diceLab.blocks[id];
    awardCasualty(next,unit,'UNIT',unit.side==='A'?'B':'A',revision);
  }
}

function applyDirectLoss(state,next,plan,p,revision=state.revision+1){
  const target=state.board.units.find(u=>u.id===plan.targetId);
  const leaderCheck=state.diceLab.leaderCheck;
  if(p.loss.unitWouldBeEliminated){
    next.board.units=next.board.units.filter(u=>u.id!==target.id);
    delete next.footLab.unitTypes[target.id];
    delete next.diceLab.blocks[target.id];
    awardCasualty(next,target,'UNIT',sectionCombatSide(state),revision);
  }else next.diceLab.blocks[target.id]=p.loss.remainingBlocks;
  if(leaderCheck?.outcome.leaderWouldBeEliminated){
    const leader=state.board.leaders.find(l=>l.id===leaderCheck.leaderId);
    next.board.leaders=next.board.leaders.filter(l=>l.id!==leader.id);
    awardCasualty(next,leader,'LEADER',sectionCombatSide(state),revision);
  }
}
function banners(d){
  return {A:d.casualties.filter(c=>c.awardedTo==='A').length,
    B:d.casualties.filter(c=>c.awardedTo==='B').length};
}

function validVictoryTargets(t){
  return record(t)&&Object.keys(t).length===2&&['A','B'].every(s=>Number.isSafeInteger(t[s])&&t[s]>=1&&t[s]<=117);
}
export function sectionVictory(state){
  const d=state.diceLab;
  if(d?.version<10||!d?.victoryTargets)return null;
  const score=banners(d),targets={...d.victoryTargets};
  const a=score.A>=targets.A,b=score.B>=targets.B;
  return {targets,banners:score,winner:a&&b?'DRAW':a?'A':b?'B':null};
}

// Called once by the authoritative journal after each accepted command.
// A pending combat is still on its original board; commit only a winning
// prefix, never resolve later dice or require another player to confirm it.
export function settleSectionVictory(next,event){
  const d=next.diceLab;
  if(!(d?.version>=10))return event;
  let result=sectionVictory(next),source=next;
  const p=d.pending,plan=next.combatLab.plan;
  if(!result.winner&&p&&plan&&p.interpretation.redIgnored!==null&&['ACCEPTED','SERVER_GENERATED'].includes(p.review)){
    let shadow=structuredClone(next);
    applyDirectLoss(next,shadow,plan,p,next.revision);
    if(!sectionVictory(shadow).winner){
      if(d.elephantRetreatPending)shadow=elephantStageShadow(next).shadow;
      else if(d.rampage.length)shadow=rampageShadow(next,elephantContext(next)).shadow;
      else if(d.retreatPending){
        const choice=d.retreatPending.choice,target=shadow.board.units.find(u=>u.id===plan.targetId);
        const leader=shadow.board.leaders.find(l=>l.side===target.side&&hex(l)===hex(target));
        const dest=choice.path.at(-1);
        if(dest){Object.assign(target,dest);if(leader)Object.assign(leader,dest);}
        applyRampageUnitLoss(shadow,target.id,choice.blocksLost,next.revision);
        if(leader&&d.retreatPending.leaderCheck?.outcome.leaderWouldBeEliminated&&!sectionVictory(shadow).winner)
          rampageLeaderLoss(shadow,leader,next.revision);
      }
    }
    const staged=sectionVictory(shadow);
    if(staged.winner){source=shadow;result=staged;}
  }
  if(result.winner){
    if(source!==next){
      next.board=source.board;next.footLab.unitTypes=source.footLab.unitTypes;
      d.blocks=source.diceLab.blocks;d.casualties=source.diceLab.casualties;
      if(!plan.battleBack&&!plan.bonusClose)d.resolvedUnitIds.push(plan.attackerId);
      d.last={attackerId:plan.attackerId,targetId:plan.targetId,roll:p.roll,review:p.review,
        interpretation:p.interpretation,loss:p.loss,outcome:'DIRECT_HITS_APPLIED',reason:null,
        blocksApplied:p.loss.originalBlocks-(d.blocks[plan.targetId]??0),blocksRemaining:d.blocks[plan.targetId]??0,
        unitEliminated:!Object.hasOwn(d.blocks,plan.targetId),banners:result.banners,
        ...(plan.battleBack?{attackKind:'BATTLE_BACK',battleBackPending:false}:plan.bonusClose?{attackKind:'BONUS_CLOSE',battleBackPending:false}:{}),
        leaderCheck:structuredClone(effectiveLeaderCheck(d)),morale:structuredClone(d.morale),
        ...(d.rampage.length?{rampage:structuredClone(d.rampage)}:{}),
        ...(d.elephantRetreatPending?{retreat:d.elephantRetreatPending.choice,elephantChecks:d.elephantRetreatPending.checks,elephantEvasions:d.elephantRetreatPending.evasions}:
          d.retreatPending?{retreat:d.retreatPending.choice}:{})};
      d.pending=null;d.leaderCheck=null;d.morale=null;d.retreatPending=null;
      d.rampage=[];d.elephantRetreatPending=null;next.combatLab.plan=null;
    }
    if(d.last){d.last.victory=result;if(d.last.battleBackPending)d.last.battleBackPending=false;
      if(d.last.momentum?.pending)d.last.momentum.pending=false;
      if(d.last.momentum?.bonusPending)d.last.momentum.bonusPending=false;}
  }
  // Rampage may eliminate an ordered friendly unit or a moved leader.
  if(next.leaderLab){
    next.leaderLab.movedLeaderIds=next.leaderLab.movedLeaderIds.filter(id=>next.board.leaders.some(l=>l.id===id));
    next.leaderLab.joinedUnitIds=next.leaderLab.joinedUnitIds.filter(id=>next.board.units.some(u=>u.id===id));
  }
  return result.winner?{...event,victory:result}:event;
}

export function assertSectionDiceLab(state){
  const d=state.diceLab;
  if(!state.combatLab||!record(d)||![1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17].includes(d.version)||!keyOK(d.key)||
     Object.keys(d).length!==(d.version>=10?13:d.version>=9?12:d.version>=7?11:d.version>=5?10:d.version>=3?9:d.version===2?8:6)||!record(d.blocks)||
     Object.keys(d.blocks).length!==state.board.units.length||
     state.board.units.some(u=>!Object.hasOwn(d.blocks,u.id)||
       !Number.isSafeInteger(d.blocks[u.id])||d.blocks[u.id]<1||
       d.blocks[u.id]>BASE_UNIT_STARTING_BLOCKS[state.footLab.unitTypes[u.id]])||
     !Array.isArray(d.resolvedUnitIds)||new Set(d.resolvedUnitIds).size!==d.resolvedUnitIds.length||
     d.resolvedUnitIds.some(id=>!state.orderSnapshot?.pieces.some(p=>p.kind==='UNIT'&&
       p.id===id&&p.side===state.turn))||
     (!state.combatLab.movementClosed&&(d.pending!==null||d.resolvedUnitIds.length>0||d.last!==null))||
     !(d.last===null||(record(d.last)&&['DIRECT_HITS_APPLIED','ARCHIVED_WITHOUT_EFFECTS'].includes(d.last.outcome)&&
       (d.version>=13&&d.last.attackKind==='BATTLE_BACK'?d.resolvedUnitIds.includes(d.last.targetId):d.resolvedUnitIds.includes(d.last.attackerId))))||
     !(d.pending===null||record(d.pending)))fail();
  if(d.last?.momentum?.pending&&!sectionMomentumOptions(state).length)fail();
  if(d.last?.battleBackPending&&(d.version<11||!['CLOSE',...(d.version>=15?['BONUS_CLOSE']:[])].includes(d.last.attackKind)||state.combatLab.plan||
      !state.board.units.some(u=>u.id===d.last.targetId&&u.side!==state.turn)))fail();
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
    if(!state.combatLab.plan||state.combatLab.plan.evadePath===null||!Number.isSafeInteger(p.revision)||p.revision<1||
       p.revision>state.revision||!record(p.roll)||
       !['DIGITAL','PHYSICAL'].includes(p.roll.source)||
       !(p.roll.source==='DIGITAL'?p.review==='SERVER_GENERATED':
         ['AWAITING_OPPONENT','ACCEPTED','DISPUTED'].includes(p.review)))fail();
    const expected=derivePending(state,{revision:p.revision,mode:p.roll.source,
      faces:[...p.roll.results,...(p.interpretation.rerolls??[])],review:p.review,redIgnored:p.interpretation.redIgnored});
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
  if(d.version>=7){
    if(!Array.isArray(d.rampage)||d.rampage.length>6)fail();
    if(d.rampage.length){
      const ctx=elephantContext(state),seen=new Set();
      if(!ctx||ctx.leaderPending||d.retreatPending)fail();
      if(d.version>=8)rampageShadow(state,ctx);
      else {
      let revision=d.leaderCheck?.revision??d.pending.revision;
      for(const roll of d.rampage){
        const unit=ctx.units.find(u=>u.id===roll?.unitId);
        if(!unit||seen.has(unit.id)||!Number.isSafeInteger(roll.revision)||
           roll.revision<=revision||roll.revision>state.revision||
           !same(roll,deriveRampageRoll(state,unit,roll.revision)))fail();
        seen.add(unit.id);revision=roll.revision;
      }
      }
    }
  }
  if(d.version>=9&&d.elephantRetreatPending!==null)elephantStageShadow(state);
  if(d.version>=10&&(!validVictoryTargets(d.victoryTargets)||sectionVictory(state).winner&&
     (d.pending!==null||state.combatLab.plan!==null||!same(d.last?.victory,sectionVictory(state)))))fail();
  return true;
}

export const SECTION_DICE_COMMANDS=Object.freeze([
  'ROLL_SECTION_RANGED_DIGITAL_LAB','DECLARE_SECTION_RANGED_PHYSICAL_LAB',
  'REVIEW_SECTION_RANGED_PHYSICAL_LAB','FINALIZE_SECTION_RANGED_LAB',
  'ARCHIVE_SECTION_RANGED_LAB','ROLL_SECTION_LEADER_CASUALTY_LAB',
  'EVADE_SECTION_LEADER_LAB','CHOOSE_SECTION_ELEPHANT_RED_LAB','CHOOSE_SECTION_MORALE_LAB','RETREAT_SECTION_UNIT_LAB','ROLL_SECTION_ELEPHANT_RAMPAGE_LAB','EVADE_SECTION_RAMPAGE_LEADER_LAB'
]);

export function applySectionDiceCommand(state,next,command){
  const d=state.diceLab,plan=state.combatLab?.plan;
  if(sectionVictory(state)?.winner)return deny('MATCH_FINISHED');
  if(!d||!plan)return deny('NO_COMBAT_PLAN_PENDING');
  const p=d.pending,side=command.actor;
  let event;
  if(command.type==='ROLL_SECTION_RANGED_DIGITAL_LAB'||command.type==='DECLARE_SECTION_RANGED_PHYSICAL_LAB'){
    if(p)return deny('RANGED_ROLL_ALREADY_CAPTURED');
    if(plan.evadePath===null)return deny('UNIT_EVADE_CHOICE_PENDING');
    const mode=command.type==='ROLL_SECTION_RANGED_DIGITAL_LAB'?'DIGITAL':'PHYSICAL';
    try{
      next.diceLab.pending=derivePending(state,{revision:state.revision+1,mode,
        faces:command.faces,review:mode==='DIGITAL'?'SERVER_GENERATED':'AWAITING_OPPONENT'});
    }catch(e){
      if(mode==='PHYSICAL'&&e.message==='INVALID_PHYSICAL_DECLARATION')return deny('INVALID_PHYSICAL_DECLARATION');
      if(e.message==='ELEPHANT_ROLL_LIMIT_REACHED')return deny(e.message);
      throw e;
    }
    const captured=next.diceLab.pending;
    event={kind:plan.battleBack?'SECTION_BATTLE_BACK_ROLL_CAPTURED_LAB':plan.bonusClose?'SECTION_BONUS_CLOSE_ROLL_CAPTURED_LAB':plan.kind==='CLOSE_PREVIEW'?'SECTION_CLOSE_ROLL_CAPTURED_LAB':'SECTION_RANGED_ROLL_CAPTURED_LAB',side,attackerId:plan.attackerId,
      targetId:plan.targetId,roll:captured.roll,review:captured.review};
  }else if(command.type==='REVIEW_SECTION_RANGED_PHYSICAL_LAB'){
    if(side===sectionCombatSide(state)||p?.review!=='AWAITING_OPPONENT')return deny('PHYSICAL_REVIEW_NOT_AVAILABLE');
    if(typeof command.accept!=='boolean')return deny('INVALID_PHYSICAL_REVIEW');
    next.diceLab.pending.review=command.accept?'ACCEPTED':'DISPUTED';
    event={kind:'SECTION_PHYSICAL_ROLL_REVIEWED_LAB',side,rollId:p.roll.rollId,
      review:next.diceLab.pending.review};
  }else if(command.type==='CHOOSE_SECTION_ELEPHANT_RED_LAB'){
    if(side===sectionCombatSide(state)||p?.interpretation.redIgnored!==null||
      !['SERVER_GENERATED','ACCEPTED'].includes(p.review))return deny('ELEPHANT_RED_CHOICE_NOT_AVAILABLE');
    if(typeof command.ignore!=='boolean')return deny('INVALID_ELEPHANT_RED_CHOICE');
    next.diceLab.pending=derivePending(state,{revision:p.revision,mode:p.roll.source,
      faces:p.roll.results,review:p.review,redIgnored:command.ignore});
    event={kind:'SECTION_ELEPHANT_RED_CHOSEN_LAB',side,targetId:plan.targetId,ignored:command.ignore};
  }else if(command.type==='ROLL_SECTION_LEADER_CASUALTY_LAB'){
    if(p?.interpretation.redIgnored===null)return deny('ELEPHANT_RED_CHOICE_PENDING');
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
  }else if(command.type==='ROLL_SECTION_ELEPHANT_RAMPAGE_LAB'){
    const ctx=elephantContext(state);
    if(side!==sectionCombatSide(state)||!ctx||d.elephantRetreatPending)return deny('ELEPHANT_RAMPAGE_NOT_AVAILABLE');
    if(ctx.leaderPending)return deny('ELEPHANT_LEADER_EFFECTS_PENDING');
    const unit=ctx.units.find(u=>u.id===command.unitId&&!d.rampage.some(r=>r.unitId===u.id));
    if(!unit)return deny('INVALID_RAMPAGE_TARGET');
    const replayed=d.version>=8?rampageShadow(state,ctx):null;
    if(replayed?.pending)return deny('RAMPAGE_LEADER_EVASION_PENDING');
    const roll=replayed?deriveRampageWithLeader(replayed.shadow,unit,state.revision+1):deriveRampageRoll(state,unit,state.revision+1);
    next.diceLab.rampage.push(roll);
    event={kind:'SECTION_ELEPHANT_RAMPAGE_ROLL_LAB',side,...roll,combatResolved:false};
  }else if(command.type==='EVADE_SECTION_RAMPAGE_LEADER_LAB'){
    const ctx=elephantContext(state);
    if(d.version<8||!ctx||ctx.leaderPending)return deny('LEADER_EVASION_NOT_AVAILABLE');
    const {shadow,pending}=d.elephantRetreatPending?elephantStageShadow(state):rampageShadow(state,ctx);
    if(!pending||side!==pending.side)return deny('LEADER_EVASION_NOT_AVAILABLE');
    if(typeof command.exit!=='boolean'||!Array.isArray(command.path)||command.path.length>3||
       !command.path.every(c=>record(c)&&Object.keys(c).length===2&&Number.isSafeInteger(c.col)&&Number.isSafeInteger(c.row)))return deny('INVALID_LEADER_EVASION_PATH');
    const path=command.path.map(c=>({col:c.col,row:c.row}));
    const option=pending.options.find(o=>o.exit===command.exit&&same(o.path,path));
    if(!option)return deny('INVALID_LEADER_EVASION_PATH');
    const revision=state.revision+1,evasion={revision,...option,escape:resolveLeaderEscape(shadow,option,revision)};
    if(d.elephantRetreatPending)next.diceLab.elephantRetreatPending.evasions.push({leaderId:pending.leaderId,...evasion});
    else next.diceLab.rampage.at(-1).evasion=evasion;
    event={kind:'SECTION_RAMPAGE_LEADER_EVADED_LAB',side,leaderId:pending.leaderId,...evasion,combatResolved:false};
  }else if(command.type==='CHOOSE_SECTION_MORALE_LAB'){
    const m=moralePreview(state);
    if(side===sectionCombatSide(state)||!m?.maxIgnored||d.morale)return deny('MORALE_CHOICE_NOT_AVAILABLE');
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
      if(side===sectionCombatSide(state)||blocker!=='LEADER_EVASION_PENDING')
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
    let retreatChoice=d.elephantRetreatPending?.choice??d.retreatPending?.choice,retreatRequired=d.elephantRetreatPending?.required??d.retreatPending?.required;
    if(retreat){
      if(side===sectionCombatSide(state)||blocker!=='RETREAT_PENDING'||d.version<4||d.retreatPending||d.elephantRetreatPending)
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
      if(d.version>=9&&retreatChoice.blockingLosses){
        const revision=state.revision+1,{checks}=elephantLossBoard(state,retreatChoice,revision);
        if(checks.some(c=>c.needsEvasion)){
          next.diceLab.elephantRetreatPending={revision,choice:structuredClone(retreatChoice),required:retreatRequired,checks,evasions:[]};
          return {accepted:true,event:{kind:'SECTION_ELEPHANT_RETREAT_STAGED_LAB',side,targetId:plan.targetId,...retreatChoice,checks,combatResolved:false}};
        }
      }
      if(d.version>=5&&retreatChoice.needsLeaderResolution){
        next.diceLab.retreatPending={revision:state.revision+1,choice:structuredClone(retreatChoice),
          required:retreatRequired,leaderCheck:null};
        return {accepted:true,event:{kind:'SECTION_RETREAT_STAGED_LAB',side,targetId:plan.targetId,
          ...retreatChoice,required:retreatRequired,combatResolved:false}};
      }
    }
    const finalize=command.type==='FINALIZE_SECTION_RANGED_LAB'||evade||retreat;
    if(finalize&&blocker&&!evade&&!retreat)return deny(blocker);
    if(!finalize&&blocker==='ELEPHANT_RED_CHOICE_PENDING')return deny(blocker);
    if(!finalize&&!blocker)return deny('DIRECT_HIT_FINALIZATION_REQUIRED');
    if(!finalize&&(d.retreatPending||d.elephantRetreatPending))return deny(blocker??'DIRECT_HIT_FINALIZATION_REQUIRED');
    if(d.version>=2&&!finalize&&blocker==='LEADER_CHECK_PENDING')
      return deny('LEADER_CHECK_REQUIRED');
    if(d.version>=3&&!finalize&&blocker==='MORALE_CHOICE_PENDING')return deny('MORALE_CHOICE_REQUIRED');
    if(d.version>=3&&!finalize&&blocker==='LEADER_EVASION_PENDING'&&leaderEvasionOptions(state).length)
      return deny('LEADER_EVASION_PENDING');
    if(d.version>=4&&!finalize&&blocker==='RETREAT_PENDING'&&retreatPreview(state)?.options.length)
      return deny('RETREAT_PENDING');
    if(d.version>=7&&!finalize&&blocker==='RETREAT_PENDING'){
      const ctx=elephantContext(state);
      if(ctx&&!ctx.leaderPending&&!(d.version>=8&&retreatPreview(state)?.reason==='ELEPHANT_BLOCKER_LEADERS_PENDING'))return deny('ELEPHANT_RAMPAGE_PENDING');
    }
    let elephantChecks;
    if(finalize&&d.version>=9&&retreatChoice?.blockingLosses){
      const applied=d.elephantRetreatPending?elephantStageShadow(state):elephantLossBoard(state,retreatChoice,state.revision+1);
      if(applied.pending)fail();
      next.board=applied.shadow.board;next.footLab.unitTypes=applied.shadow.footLab.unitTypes;
      next.diceLab.blocks=applied.shadow.diceLab.blocks;next.diceLab.casualties=applied.shadow.diceLab.casualties;
      elephantChecks=d.elephantRetreatPending?.checks??applied.checks;
    }else if(finalize){
      if(d.version>=2)applyDirectLoss(state,next,plan,p);
      else next.diceLab.blocks[plan.targetId]=p.loss.remainingBlocks;
      if(plan.evadePath?.length&&!p.loss.unitWouldBeEliminated){
        const target=next.board.units.find(u=>u.id===plan.targetId);
        const leader=next.board.leaders.find(l=>l.side===target.side&&hex(l)===hex(target));
        const destination=plan.evadePath.at(-1);
        if(leader)Object.assign(leader,destination);
        Object.assign(target,destination);
        // The crew escapes after a legal evade; no victory banner is awarded.
        if(d.version>=17&&plan.targetUnitType==='HEAVY_WAR_MACHINE'){
          next.board.units=next.board.units.filter(u=>u.id!==target.id);
          delete next.footLab.unitTypes[target.id];delete next.diceLab.blocks[target.id];
        }
      }
      if(retreatChoice?.blockingLosses){
        for(const roll of d.rampage){
          if(d.version>=8)applyRampageRecord(next,roll,state.revision+1);
          else applyRampageUnitLoss(next,roll.unitId,roll.blocksLost,state.revision+1);
        }
        for(const loss of retreatChoice.blockingLosses){
          if(loss.leaderId)rampageLeaderLoss(next,next.board.leaders.find(l=>l.id===loss.leaderId),state.revision+1);
          else applyRampageUnitLoss(next,loss.unitId,loss.blocksLost,state.revision+1);
        }
      }
      if(retreatChoice){
        const target=next.board.units.find(u=>u.id===plan.targetId);
        const leader=next.board.leaders.find(l=>l.side===target.side&&hex(l)===hex(target));
        const destination=retreatChoice.path.at(-1);
        const remaining=next.diceLab.blocks[target.id]-retreatChoice.blocksLost;
        if(d.retreatPending?.leaderCheck?.outcome.leaderWouldBeEliminated){
          next.board.leaders=next.board.leaders.filter(l=>l.id!==leader.id);
          awardCasualty(next,leader,'LEADER',sectionCombatSide(state),state.revision+1);
        }else if(leader&&destination){Object.assign(leader,destination);}
        if(remaining===0){
          next.board.units=next.board.units.filter(u=>u.id!==target.id);
          delete next.footLab.unitTypes[target.id];delete next.diceLab.blocks[target.id];
          awardCasualty(next,target,'UNIT',sectionCombatSide(state),state.revision+1);
        }else{
          next.diceLab.blocks[target.id]=remaining;
          if(destination)Object.assign(target,destination);
        }
      }
      if(evasion){
        const leader=next.board.leaders.find(l=>l.id===effectiveLeaderCheck(d).leaderId);
        if(escape?.eliminated){
          next.board.leaders=next.board.leaders.filter(l=>l.id!==leader.id);
          awardCasualty(next,leader,'LEADER',sectionCombatSide(state),state.revision+1);
        }else if(evasion.exit)next.board.leaders=next.board.leaders.filter(l=>l.id!==leader.id);
        else Object.assign(leader,evasion.path.at(-1));
      }
    }
    if(!plan.battleBack&&!plan.bonusClose)next.diceLab.resolvedUnitIds.push(plan.attackerId);
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
      ...(retreatChoice?{retreat:{...retreatChoice,required:retreatRequired}}:{}),
      ...(retreatChoice?.blockingLosses||d.version>=8&&d.rampage.length?{rampage:structuredClone(d.rampage)}:{}),
      ...(elephantChecks?{elephantChecks,elephantEvasions:structuredClone(d.elephantRetreatPending?.evasions??[])}:{})};
    if(plan.kind==='CLOSE_PREVIEW'){
      const defender=next.board.units.find(u=>u.id===plan.targetId);
      const original=state.board.units.find(u=>u.id===plan.targetId);
      result.attackKind=plan.battleBack?'BATTLE_BACK':plan.bonusClose?'BONUS_CLOSE':'CLOSE';
      if(plan.bonusClose){
        const origin=state.board.units.find(u=>u.id===plan.attackerId);
        result.forestEntered=!!d.last?.momentum?.path?.some(c=>hex(c)===hex(origin)&&
          state.footLab.terrain?.some(t=>hex(t)===hex(c)&&t.kind==='FOREST'));
      }
      // The response ends the exchange: no recursive Battle Back or evasion.
      result.battleBackPending=!!(!plan.battleBack&&finalize&&!plan.evadePath?.length&&defender&&hex(defender)===hex(original)&&
        (d.version<16||next.board.units.some(u=>u.id===plan.attackerId&&distance(u,defender)===1)));
      if(d.version>=12&&plan.evadePath?.length){
        const escaped=d.version>=17&&plan.targetUnitType==='HEAVY_WAR_MACHINE'&&finalize&&!p.loss.unitWouldBeEliminated;
        result.unitEvasion={path:structuredClone(plan.evadePath),applied:finalize&&(!!defender||escaped),...(escaped?{crewEscaped:true}:{})};
      }
    }
    next.diceLab.last=structuredClone(result);
    next.diceLab.pending=null;
    if(d.version>=2)next.diceLab.leaderCheck=null;
    if(d.version>=3)next.diceLab.morale=null;
    if(d.version>=5)next.diceLab.retreatPending=null;
    if(d.version>=7)next.diceLab.rampage=[];
    if(d.version>=9)next.diceLab.elephantRetreatPending=null;
    next.combatLab.plan=null;
    if(d.version>=14&&plan.kind==='CLOSE_PREVIEW'&&!plan.battleBack&&finalize&&!plan.evadePath?.length){
      const original=state.board.units.find(u=>u.id===plan.targetId);
      const surviving=next.board.units.find(u=>u.id===plan.targetId);
      if(!surviving||hex(surviving)!==hex(original)){
        result.momentum={hex:{col:original.col,row:original.row},pending:true};
        next.diceLab.last.momentum=structuredClone(result.momentum);
        if(!sectionMomentumOptions(next).length){delete result.momentum;delete next.diceLab.last.momentum;}
      }
    }
    event={kind:plan.battleBack?(finalize?'SECTION_BATTLE_BACK_RESOLVED_LAB':'SECTION_BATTLE_BACK_ARCHIVED_LAB'):plan.bonusClose?(finalize?'SECTION_BONUS_CLOSE_RESOLVED_LAB':'SECTION_BONUS_CLOSE_ARCHIVED_LAB'):retreatChoice?'SECTION_RETREAT_APPLIED_LAB':plan.kind==='CLOSE_PREVIEW'?(finalize?'SECTION_CLOSE_DIRECT_HITS_APPLIED_LAB':'SECTION_CLOSE_ARCHIVED_LAB'):finalize?'SECTION_RANGED_DIRECT_HITS_APPLIED_LAB':'SECTION_RANGED_ARCHIVED_LAB',
      side,...result,combatResolved:false};
  }
  return {accepted:true,event};
}

export function projectSectionDiceLab(state,side){
  const d=state.diceLab,p=d.pending;
  const blocker=p?(p.review==='DISPUTED'?'PHYSICAL_ROLL_DISPUTED':resolutionBlocker(state,p)):null;
  const evasionOptions=blocker==='LEADER_EVASION_PENDING'?leaderEvasionOptions(state):[];
  const retreat=blocker==='RETREAT_PENDING'?retreatPreview(state):null;
  const elephant=blocker==='RETREAT_PENDING'||d.elephantRetreatPending?elephantContext(state):null;
  const rampageReplay=d.elephantRetreatPending?elephantStageShadow(state):d.version>=8&&elephant&&!elephant.leaderPending?rampageShadow(state,elephant):null;
  const remaining=elephant&&!elephant.leaderPending&&!rampageReplay?.pending?elephant.units.filter(u=>!d.rampage.some(r=>r.unitId===u.id)):[];
  return {blocks:{...d.blocks},resolvedUnitIds:[...d.resolvedUnitIds],
    pending:p?structuredClone(p):null,last:d.last?structuredClone(d.last):null,
    canReview:side!==sectionCombatSide(state)&&p?.review==='AWAITING_OPPONENT',
    canFinalize:side===sectionCombatSide(state)&&!!p&&!blocker&&p.review!=='AWAITING_OPPONENT',
    canArchive:side===sectionCombatSide(state)&&!!p&&!!blocker&&blocker!=='ELEPHANT_RED_CHOICE_PENDING'&&p.review!=='AWAITING_OPPONENT'&&
      !(d.version>=2&&blocker==='LEADER_CHECK_PENDING')&&
      !(d.version>=3&&(blocker==='MORALE_CHOICE_PENDING'||evasionOptions.length>0))&&
      !retreat?.options.length&&!d.retreatPending&&!d.elephantRetreatPending&&!(elephant&&!elephant.leaderPending&&!(d.version>=8&&retreat?.reason==='ELEPHANT_BLOCKER_LEADERS_PENDING')),
    ...(d.version>=2?{banners:banners(d),casualties:structuredClone(d.casualties),
      leaderCheck:structuredClone(effectiveLeaderCheck(d)),
      leaderEvasionOptions:side!==sectionCombatSide(state)?evasionOptions:[],
      canEvadeLeader:side!==sectionCombatSide(state)&&evasionOptions.length>0,
      leaderEvasionAvailable:evasionOptions.length>0,
      canRollLeader:side===sectionCombatSide(state)&&blocker==='LEADER_CHECK_PENDING'&&
        ['SERVER_GENERATED','ACCEPTED'].includes(p?.review)}:{}),
    ...(d.version>=3?{moralePreview:moralePreview(state),morale:structuredClone(d.morale),
      canChooseMorale:side!==sectionCombatSide(state)&&blocker==='MORALE_CHOICE_PENDING'}:{}),
    ...(d.version>=4?{retreat:retreat?{...retreat,options:side!==sectionCombatSide(state)?retreat.options:[]}:null,
      canRetreat:side!==sectionCombatSide(state)&&!!retreat?.options.length}:{}),
    ...(d.version>=5?{retreatPending:structuredClone(d.retreatPending)}:{}),
    ...(d.version>=7?{rampage:elephant?{rolls:structuredClone(d.rampage),
      remaining:remaining.map(u=>({unitId:u.id,side:u.side})),
      canRoll:side===sectionCombatSide(state)&&remaining.length>0,...(d.version>=8?{evasion:rampageReplay?.pending?{leaderId:rampageReplay.pending.leaderId,side:rampageReplay.pending.side,options:side===rampageReplay.pending.side?rampageReplay.pending.options:[]}:null}:{})}:null}:{}),
    ...(d.version>=9?{elephantRetreatPending:structuredClone(d.elephantRetreatPending)}:{}),
    ...(d.version>=10?{victory:sectionVictory(state)}:{}),
    ...(d.version>=12?{unitEvadePending:state.combatLab.plan?.evadePath===null,
      canChooseUnitEvade:side!==state.turn&&state.combatLab.plan?.evadePath===null}:{}),
    ...(d.version>=16?{elephantRedPending:p?.interpretation.redIgnored===null,
      canChooseElephantRed:side!==sectionCombatSide(state)&&p?.interpretation.redIgnored===null&&['ACCEPTED','SERVER_GENERATED'].includes(p.review)}:{}),
    ...(d.version>=15?{bonusClosePending:!!d.last?.momentum?.bonusPending,
      canDeclineBonusClose:side===state.turn&&!!d.last?.momentum?.bonusPending}:{}),
    ...(d.version>=14?{momentumPending:!!d.last?.momentum?.pending,
      canChooseMomentum:side===state.turn&&!!d.last?.momentum?.pending,
      momentumOptions:side===state.turn?sectionMomentumOptions(state):[]}:{}),
    ...(d.version>=13?{combatSide:sectionCombatSide(state),canAcceptBattleBack:side!==state.turn&&!!d.last?.battleBackPending}:{}),
    ...(d.version>=11?{battleBackPending:!!d.last?.battleBackPending,canDeclineBattleBack:side!==state.turn&&!!d.last?.battleBackPending}:{}),
    blocker};
}

export function resetSectionDiceTurn(next){
  next.diceLab.resolvedUnitIds=[];
  next.diceLab.pending=null;
  next.diceLab.last=null;
  if(next.diceLab.version>=2)next.diceLab.leaderCheck=null;
  if(next.diceLab.version>=3)next.diceLab.morale=null;
  if(next.diceLab.version>=5)next.diceLab.retreatPending=null;
  if(next.diceLab.version>=7)next.diceLab.rampage=[];
  if(next.diceLab.version>=9)next.diceLab.elephantRetreatPending=null;
}
