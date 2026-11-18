/**
 * Versioned laboratory ranged dice staging, not an official attack executor.
 * The authenticated server chooses the actor, roll ID, target type and dice
 * count. Physical faces are an unverified player declaration; digital faces
 * are generated using the server's cryptographic RNG.
 *
 * One training roll per turn, no replay of an already staged attempt. Neither
 * this record nor its interpretation applies hits/flags, blocks, or banners.
 */
import {checkTrainingRangedDeclaration} from './training-ranged-declaration.mjs';
import {projectTrainingReference} from './training-reference.mjs';
import {readTrainingMovementLedger} from './training-ranged-ledger.mjs';
import {precheckAncientsRangedAttack} from '../ancients-rules/ranged-precheck.mjs';
import {captureBaseAncientsRangedDice,interpretBaseAncientsRangedDice} from '../ancients-rules/battle-dice.mjs';

const fail=code=>{throw new TypeError(code);};
const id=x=>typeof x==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(x);
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(o,ks)=>plain(o)&&Object.keys(o).length===ks.length&&
  ks.every(k=>Object.hasOwn(o,k));

/** Validate every read, including records from older or damaged databases. */
export function projectStagedTrainingRangedDice(state){
  if(!state||typeof state!=='object'||Array.isArray(state))
    fail('INVALID_TRAINING_DICE_STATE');
  if(!Object.hasOwn(state,'trainingStagedRangedDice'))return null;
  const s=state.trainingStagedRangedDice,phase=state.commandSession?.phaseState;
  const ref=projectTrainingReference(state);
  if(!exact(s,['schemaVersion','scenarioId','turn','revision','attackerId',
       'targetId','roll','interpretation'])||s.schemaVersion!==1||
      !ref?.scenario||s.scenarioId!==ref.scenario.id||
      !['A','B'].includes(s.turn)||s.turn!==phase?.turn||
      !Number.isSafeInteger(s.revision)||s.revision<1||
      !Number.isSafeInteger(phase?.revision)||s.revision>phase.revision||
      !id(s.attackerId)||!id(s.targetId)||
      !state.board.some(u=>u.id===s.attackerId&&u.side===s.turn)||
      !state.board.some(u=>u.id===s.targetId&&u.side!==s.turn)||
      s.roll?.actor!==s.turn||
      !id(s.roll?.rollId)||!s.roll.rollId.startsWith('training_'))
    fail('INVALID_TRAINING_DICE_STATE');
  // The historic roll is validated against the same persisted unit types,
  // movement steps, terrain and attacker order used at its creation. A roll
  // with a forged count or target cannot be treated as an audit record.
  const history=readTrainingMovementLedger(state);
  if(!history||!['COMBAT','DRAW_CARD'].includes(phase.phase)||
      !Array.isArray(phase.orderedUnits)||
      !phase.orderedUnits.includes(s.attackerId))
    fail('INVALID_TRAINING_DICE_STATE');
  const verified=precheckAncientsRangedAttack({
    units:state.board.map(u=>({...u,type:ref.unitTypes[u.id]})),
    leaders:[],terrain:ref.terrain,
    attackerId:s.attackerId,targetId:s.targetId,
    movedSteps:history.stepsByUnit[s.attackerId]
  });
  if(verified.status!=='CANDIDATE'||verified.diceAfterTerrain!==s.roll?.diceCount)
    fail('INVALID_TRAINING_DICE_STATE');
  const type=ref.unitTypes[s.targetId];
  let recomputed;
  try {
    recomputed=interpretBaseAncientsRangedDice({
      roll:s.roll,targetUnitType:type,expectedDiceCount:s.roll.diceCount
    });
  }catch{fail('INVALID_TRAINING_DICE_STATE');}
  if(JSON.stringify(recomputed)!==JSON.stringify(s.interpretation))
    fail('INVALID_TRAINING_DICE_STATE');
  return structuredClone(s);
}

/**
 * Pure input gate + roll capture; caller must be inside the authenticated
 * SQLite transaction and must persist the event and record together.
 * randomIndex is intentionally NOT accepted (test doubles inject upstream).
 */
export function prepareStagedTrainingRangedDice(state,request,{rollId}={}){
  if(projectStagedTrainingRangedDice(state)!==null)
    return {accepted:false,reason:'TRAINING_DICE_ALREADY_STAGED'};
  const reference=checkTrainingRangedDeclaration(state,request);
  if(reference.status!=='CANDIDATE')
    return {accepted:false,reason:reference.reason};
  if(!Number.isSafeInteger(reference.diceAfterTerrain)||
      reference.diceAfterTerrain<1||reference.diceAfterTerrain>32)
    return {accepted:false,reason:'TRAINING_NO_RANGED_DICE'};
  const {actor,mode,declaredFaces}=request;
  if(mode!=='DIGITAL'&&mode!=='PHYSICAL')
    return {accepted:false,reason:'INVALID_TRAINING_DICE_MODE'};
  if((mode==='DIGITAL'&&declaredFaces!==undefined)||
      (mode==='PHYSICAL'&&(!Array.isArray(declaredFaces)||
        declaredFaces.length!==reference.diceAfterTerrain||
        declaredFaces.length>32)))
    return {accepted:false,reason:'INVALID_TRAINING_DICE_FACES'};
  // Physical values are validated by the existing official-face contract.
  // This never treats physical results as verified or as an authorization.
  let roll,interpretation;
  try{
    roll=captureBaseAncientsRangedDice({
      rollId,actor,diceCount:reference.diceAfterTerrain,mode,declaredFaces
    });
    const type=projectTrainingReference(state).unitTypes[request.targetId];
    interpretation=interpretBaseAncientsRangedDice({
      roll,targetUnitType:type,expectedDiceCount:reference.diceAfterTerrain
    });
  }catch(error){
    if(error instanceof TypeError)
      return {accepted:false,reason:'INVALID_TRAINING_DICE_FACES'};
    throw error;
  }
  const staged={
    schemaVersion:1,scenarioId:state.trainingReference.scenarioId,
    turn:actor,revision:reference.revision+1,
    attackerId:request.attackerId,targetId:request.targetId,
    roll,interpretation
  };
  return {accepted:true,staged,event:{
    type:'TRAINING_RANGED_DICE_STAGED',
    side:actor,attackerId:request.attackerId,targetId:request.targetId,
    rollId:roll.rollId,source:roll.source,verification:roll.verification,
    results:[...roll.results],diceCount:roll.diceCount,
    matchingColorHits:interpretation.matchingColorHits,
    flagsPending:interpretation.flagsPending,
    attackAuthorized:false,combatResolved:false,blocksRemoved:false
  }};
}
