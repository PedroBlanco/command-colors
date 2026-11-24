/**
 * Section history LAB_ONLY: versioned server-owned dice and restricted direct
 * losses. Replay derives the same digital dice from a private per-game key.
 * No result, key, block count or dice distribution is accepted from the client.
 * Physical faces are declarations, never cryptographically verified.
 */
import {randomBytes,createHmac} from 'node:crypto';
import {captureBaseAncientsRangedDice,interpretBaseAncientsRangedDice} from './battle-dice.mjs';
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
  if(!keyOK(key)||!/^section_(?:ranged|leader)_[1-9][0-9]*$/.test(rollId))fail();
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

export function initializeSectionDiceLab(unitTypes,{casualties=false}={}){
  return {version:casualties?2:1,key:randomBytes(32).toString('hex'),
    blocks:Object.fromEntries(Object.entries(unitTypes).map(([id,type])=>[
      id,BASE_UNIT_STARTING_BLOCKS[type]
    ])),
    resolvedUnitIds:[],pending:null,last:null,
    ...(casualties?{casualties:[],leaderCheck:null}:{})};
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

function unsupported(state,pending){
  const l=pending.loss,d=state.diceLab;
  if(d.version===1){
    if(l.unitWouldBeEliminated)return 'ELIMINATION_PENDING';
    if(l.leaderCasualtyCheck)return 'LEADER_CHECK_PENDING';
  }
  if(l.effectiveFlagsPending>0)return 'RETREAT_PENDING';
  if(d.version===2&&l.leaderCasualtyCheck){
    if(!d.leaderCheck)return 'LEADER_CHECK_PENDING';
    if(d.leaderCheck.outcome.leaderMustEvadeIfApplied)return 'LEADER_EVASION_PENDING';
  }
  return null;
}

function deriveLeaderCheck(state,revision){
  const p=state.diceLab.pending;
  const target=state.board.units.find(u=>u.id===state.combatLab.plan.targetId);
  const leader=state.board.leaders.find(l=>l.side===target.side&&hex(l)===hex(target));
  if(!leader||!p.loss.leaderCasualtyCheck)fail();
  const checklist=planBaseAncientsRangedResolution({blockLoss:p.loss});
  const rollId='section_leader_'+revision;
  const roll=captureBaseAncientsLeaderCasualtyDice({
    rollId,actor:state.turn,diceCount:p.loss.leaderCasualtyCheck.diceCount,
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
  if(!state.combatLab||!record(d)||![1,2].includes(d.version)||!keyOK(d.key)||
     Object.keys(d).length!==(d.version===2?8:6)||!record(d.blocks)||
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
  if(d.version===2){
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
         d.pending.loss.effectiveFlagsPending>0||
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
  return true;
}

export const SECTION_DICE_COMMANDS=Object.freeze([
  'ROLL_SECTION_RANGED_DIGITAL_LAB','DECLARE_SECTION_RANGED_PHYSICAL_LAB',
  'REVIEW_SECTION_RANGED_PHYSICAL_LAB','FINALIZE_SECTION_RANGED_LAB',
  'ARCHIVE_SECTION_RANGED_LAB','ROLL_SECTION_LEADER_CASUALTY_LAB'
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
    if(d.version!==2||!p?.loss.leaderCasualtyCheck||p.loss.effectiveFlagsPending>0)
      return deny('LEADER_CHECK_NOT_AVAILABLE');
    if(!['SERVER_GENERATED','ACCEPTED'].includes(p.review))
      return deny('PHYSICAL_REVIEW_REQUIRED');
    if(d.leaderCheck)return deny('LEADER_CHECK_ALREADY_CAPTURED');
    next.diceLab.leaderCheck=deriveLeaderCheck(state,state.revision+1);
    event={kind:'SECTION_LEADER_CASUALTY_CAPTURED_LAB',side,
      ...next.diceLab.leaderCheck,combatResolved:false};
  }else{
    if(!p)return deny('RANGED_ROLL_REQUIRED');
    if(p.review==='AWAITING_OPPONENT')return deny('PHYSICAL_REVIEW_REQUIRED');
    const blocker=p.review==='DISPUTED'?'PHYSICAL_ROLL_DISPUTED':unsupported(state,p);
    const finalize=command.type==='FINALIZE_SECTION_RANGED_LAB';
    if(finalize&&blocker)return deny(blocker);
    if(!finalize&&!blocker)return deny('DIRECT_HIT_FINALIZATION_REQUIRED');
    if(d.version===2&&!finalize&&blocker==='LEADER_CHECK_PENDING')
      return deny('LEADER_CHECK_REQUIRED');
    if(finalize){
      if(d.version===2)applyDirectLoss(state,next,plan,p);
      else next.diceLab.blocks[plan.targetId]=p.loss.remainingBlocks;
    }
    next.diceLab.resolvedUnitIds.push(plan.attackerId);
    const result={attackerId:plan.attackerId,targetId:plan.targetId,roll:p.roll,
      review:p.review,interpretation:p.interpretation,loss:p.loss,
      outcome:finalize?'DIRECT_HITS_APPLIED':'ARCHIVED_WITHOUT_EFFECTS',
      reason:blocker,blocksApplied:finalize?p.loss.blocksToRemove:0,
      blocksRemaining:next.diceLab.blocks[plan.targetId]??0,
      ...(d.version===2?{leaderCheck:structuredClone(d.leaderCheck),
        unitEliminated:finalize&&p.loss.unitWouldBeEliminated,
        leaderEliminated:finalize&&!!d.leaderCheck?.outcome.leaderWouldBeEliminated,
        banners:banners(next.diceLab)}:{})};
    next.diceLab.last=structuredClone(result);
    next.diceLab.pending=null;
    if(d.version===2)next.diceLab.leaderCheck=null;
    next.combatLab.plan=null;
    event={kind:finalize?'SECTION_RANGED_DIRECT_HITS_APPLIED_LAB':'SECTION_RANGED_ARCHIVED_LAB',
      side,...result,combatResolved:false};
  }
  return {accepted:true,event};
}

export function projectSectionDiceLab(state,side){
  const d=state.diceLab,p=d.pending;
  const blocker=p?(p.review==='DISPUTED'?'PHYSICAL_ROLL_DISPUTED':unsupported(state,p)):null;
  return {blocks:{...d.blocks},resolvedUnitIds:[...d.resolvedUnitIds],
    pending:p?structuredClone(p):null,last:d.last?structuredClone(d.last):null,
    canReview:side!==state.turn&&p?.review==='AWAITING_OPPONENT',
    canFinalize:side===state.turn&&!!p&&!blocker&&p.review!=='AWAITING_OPPONENT',
    canArchive:side===state.turn&&!!p&&!!blocker&&p.review!=='AWAITING_OPPONENT'&&
      !(d.version===2&&blocker==='LEADER_CHECK_PENDING'),
    ...(d.version===2?{banners:banners(d),casualties:structuredClone(d.casualties),
      leaderCheck:structuredClone(d.leaderCheck),
      canRollLeader:side===state.turn&&blocker==='LEADER_CHECK_PENDING'&&
        ['SERVER_GENERATED','ACCEPTED'].includes(p?.review)}:{}),
    blocker};
}

export function resetSectionDiceTurn(next){
  next.diceLab.resolvedUnitIds=[];
  next.diceLab.pending=null;
  next.diceLab.last=null;
  if(next.diceLab.version===2)next.diceLab.leaderCheck=null;
}
