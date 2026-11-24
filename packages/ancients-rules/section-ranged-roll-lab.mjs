/**
 * Section history LAB_ONLY: versioned server-owned dice and restricted direct
 * losses. Replay derives the same digital dice from a private per-game key.
 * No result, key, block count or dice distribution is accepted from the client.
 * Physical faces are declarations, never cryptographically verified.
 */
import {randomBytes,createHmac} from 'node:crypto';
import {captureBaseAncientsRangedDice,interpretBaseAncientsRangedDice} from './battle-dice.mjs';
import {BASE_UNIT_STARTING_BLOCKS,previewBaseAncientsRangedBlockLoss} from './block-loss-preview.mjs';

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
  if(!keyOK(key)||!/^section_ranged_[1-9][0-9]*$/.test(rollId))fail();
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

export function initializeSectionDiceLab(unitTypes){
  return {version:1,key:randomBytes(32).toString('hex'),
    blocks:Object.fromEntries(Object.entries(unitTypes).map(([id,type])=>[
      id,BASE_UNIT_STARTING_BLOCKS[type]
    ])),
    resolvedUnitIds:[],pending:null,last:null};
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

function unsupported(pending){
  const l=pending.loss;
  if(l.unitWouldBeEliminated)return 'ELIMINATION_PENDING';
  if(l.leaderCasualtyCheck)return 'LEADER_CHECK_PENDING';
  if(l.effectiveFlagsPending>0)return 'RETREAT_PENDING';
  return null;
}

export function assertSectionDiceLab(state){
  const d=state.diceLab;
  if(!state.combatLab||!record(d)||d.version!==1||!keyOK(d.key)||
     Object.keys(d).length!==6||!record(d.blocks)||
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
  'ARCHIVE_SECTION_RANGED_LAB'
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
  }else{
    if(!p)return deny('RANGED_ROLL_REQUIRED');
    if(p.review==='AWAITING_OPPONENT')return deny('PHYSICAL_REVIEW_REQUIRED');
    const blocker=p.review==='DISPUTED'?'PHYSICAL_ROLL_DISPUTED':unsupported(p);
    const finalize=command.type==='FINALIZE_SECTION_RANGED_LAB';
    if(finalize&&blocker)return deny(blocker);
    if(!finalize&&!blocker)return deny('DIRECT_HIT_FINALIZATION_REQUIRED');
    if(finalize)next.diceLab.blocks[plan.targetId]=p.loss.remainingBlocks;
    next.diceLab.resolvedUnitIds.push(plan.attackerId);
    const result={attackerId:plan.attackerId,targetId:plan.targetId,roll:p.roll,
      review:p.review,interpretation:p.interpretation,loss:p.loss,
      outcome:finalize?'DIRECT_HITS_APPLIED':'ARCHIVED_WITHOUT_EFFECTS',
      reason:blocker,blocksApplied:finalize?p.loss.blocksToRemove:0,
      blocksRemaining:next.diceLab.blocks[plan.targetId]};
    next.diceLab.last=structuredClone(result);
    next.diceLab.pending=null;
    next.combatLab.plan=null;
    event={kind:finalize?'SECTION_RANGED_DIRECT_HITS_APPLIED_LAB':'SECTION_RANGED_ARCHIVED_LAB',
      side,...result,combatResolved:false};
  }
  return {accepted:true,event};
}

export function projectSectionDiceLab(state,side){
  const d=state.diceLab,p=d.pending;
  const blocker=p?(p.review==='DISPUTED'?'PHYSICAL_ROLL_DISPUTED':unsupported(p)):null;
  return {blocks:{...d.blocks},resolvedUnitIds:[...d.resolvedUnitIds],
    pending:p?structuredClone(p):null,last:d.last?structuredClone(d.last):null,
    canReview:side!==state.turn&&p?.review==='AWAITING_OPPONENT',
    canFinalize:side===state.turn&&!!p&&!blocker&&p.review!=='AWAITING_OPPONENT',
    canArchive:side===state.turn&&!!p&&!!blocker&&p.review!=='AWAITING_OPPONENT',
    blocker};
}

export function resetSectionDiceTurn(next){
  next.diceLab.resolvedUnitIds=[];
  next.diceLab.pending=null;
  next.diceLab.last=null;
}
