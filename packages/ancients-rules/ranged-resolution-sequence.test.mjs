import test from 'node:test';
import assert from 'node:assert/strict';
import {previewBaseAncientsRangedBlockLoss} from './block-loss-preview.mjs';
import {planBaseAncientsRangedResolution as plan,
  previewBaseAncientsLeaderCasualtyCheck as leaderCheck,
  captureBaseAncientsLeaderCasualtyDice as captureLeader} from './ranged-resolution-sequence.mjs';

const block = (options = {}) => previewBaseAncientsRangedBlockLoss({
  unitType:'HEAVY_INFANTRY',blocksRemaining:3,diceCount:3,
  matchingColorHits:1,flagsPending:1,leaderAttached:false,...options
});
const make = options => plan({blockLoss:block(options)});
const roll = (results, options = {}) => ({
  type:'ANCIENTS_BASE_LEADER_CASUALTY_CAPTURED',purpose:'LEADER_CASUALTY_CHECK',
  ruleset:'ancients-base-3e-2009',
  rollId:'leader_dice_01',actor:'A',source:'DIGITAL',verification:'SERVER_GENERATED',
  diceCount:results.length,results,...options
});
const kinds = p => p.steps.map(x => x.kind);

test('ordinary hit and flag checklist resolves direct hits before defender morale',()=>{
  const p=make();
  assert.deepEqual(kinds(p),[
    'APPLY_DIRECT_HITS','DEFENDER_MORALE_CHOICE',
    'RESOLVE_RETREAT_OR_BLOCK_LOSS','AUTHORITATIVE_FINALIZATION']);
  assert.equal(p.nextRequiredStep,'APPLY_DIRECT_HITS');
  assert.equal(p.combatResolved,false);
});
test('hit with attached leader places exactly one leader check after hits',()=>{
  const p=make({leaderAttached:true});
  assert.deepEqual(kinds(p),[
    'APPLY_DIRECT_HITS','LEADER_CASUALTY_CHECK','DEFENDER_MORALE_CHOICE',
    'RESOLVE_RETREAT_OR_BLOCK_LOSS','AUTHORITATIVE_FINALIZATION']);
  assert.equal(p.steps[1].diceCount,2);
  assert.equal(p.steps[1].requiredLeaderSymbols,2);
  assert.equal(p.steps.filter(x=>x.kind.includes('LEADER_')).length,1);
});
test('eliminated unit with attached leader schedules one-die check then conditional evade',()=>{
  const p=make({blocksRemaining:1,matchingColorHits:1,leaderAttached:true});
  assert.deepEqual(kinds(p),[
    'APPLY_DIRECT_HITS','LEADER_CASUALTY_CHECK',
    'LEADER_EVADE_IF_SURVIVES','AUTHORITATIVE_FINALIZATION']);
  assert.equal(p.steps[1].diceCount,1);
  assert.equal(p.blockLoss.flagsNoLongerApplicable,1);
});
test('eliminated unit without leader never enters morale or evade phases',()=>{
  const p=make({blocksRemaining:1});
  assert.deepEqual(kinds(p),['APPLY_DIRECT_HITS','AUTHORITATIVE_FINALIZATION']);
});
test('flags-only with leader requires morale and retreat, with conditional later leader check',()=>{
  const p=make({matchingColorHits:0,flagsPending:2,leaderAttached:true});
  assert.deepEqual(kinds(p),[
    'DEFENDER_MORALE_CHOICE','RESOLVE_RETREAT_OR_BLOCK_LOSS',
    'LEADER_CHECK_IF_RETREAT_CAUSES_BLOCK_LOSS','AUTHORITATIVE_FINALIZATION']);
  assert.equal(p.steps[2].maximumChecksForThisCombat,1);
});
test('flags-only without leader requires defender decision but no leader check',()=>{
  const p=make({matchingColorHits:0,flagsPending:2});
  assert.deepEqual(kinds(p),[
    'DEFENDER_MORALE_CHOICE','RESOLVE_RETREAT_OR_BLOCK_LOSS',
    'AUTHORITATIVE_FINALIZATION']);
});
test('no hits or flags cannot be marked combat resolved automatically',()=>{
  const p=make({matchingColorHits:0,flagsPending:0});
  assert.deepEqual(kinds(p),['AUTHORITATIVE_FINALIZATION']);
  assert.equal(p.attackAuthorized,false);
  assert.equal(p.bannerAwarded,false);
});
test('morale choice records ignorance of how many flags may be ignored',()=>{
  const p=make({flagsPending:2,matchingColorHits:0,leaderAttached:true});
  const choice=p.steps.find(x=>x.kind==='DEFENDER_MORALE_CHOICE');
  assert.equal(choice.flagsRolled,2);
  assert.equal(choice.flagsThatMayBeIgnored,'NOT_YET_VALIDATED');
  assert.equal(choice.defenderMayChooseToAcceptFlags,true);
});
test('every step is frozen, cannot claim authorization and is not executed',()=>{
  const p=make({leaderAttached:true});
  assert.equal(Object.isFrozen(p),true);
  assert.equal(Object.isFrozen(p.steps),true);
  for(const s of p.steps){assert.equal(Object.isFrozen(s),true);assert.equal(s.executed,false);}
  assert.equal(p.boardMutated,false);assert.equal(p.fullRulesValidated,false);
});
test('different target stack and flag counts do not mutate input board preview',()=>{
  const b=block({blocksRemaining:1,matchingColorHits:2,flagsPending:1});
  const before=structuredClone(b);
  const p=plan({blockLoss:b});
  assert.deepEqual(b,before);
  assert.equal(p.blockLoss.excessHits,1);
  assert.equal(p.blockLoss.possibleVictoryBanner,1);
  assert.equal(p.bannerAwarded,false);
});
test('incomplete block summary is rejected instead of inferred',()=>{
  for(const x of [undefined,null,{},[],{kind:'BASE_RANGED_BLOCK_LOSS_PREVIEW'},
    {...block(),leaderAttached:undefined}])
    assert.throws(()=>plan({blockLoss:x}),/INVALID_BLOCK_LOSS_SEQUENCE_INPUT/);
});
test('forged block totals or claims that flags were resolved are rejected',()=>{
  for(const changed of [{remainingBlocks:0},{blocksToRemove:5},{flagsResolved:true},
    {attackAuthorized:true},{leaderChecksResolved:true},{bannerAwarded:true},
    {excessHits:999},{leaderAttached:true},{unitWouldBeEliminated:true}])
    assert.throws(()=>plan({blockLoss:{...block(),...changed}}),
      /INCONSISTENT_BLOCK_LOSS_SEQUENCE_INPUT/);
});
test('a two-helmet roll on two dice predicts elimination of attached leader',()=>{
  const p=make({leaderAttached:true});
  const result=leaderCheck({checklist:p,roll:roll(['LEADER','LEADER'])});
  assert.equal(result.leaderSymbols,2);
  assert.equal(result.leaderWouldBeEliminated,true);
  assert.equal(result.leaderMustEvadeIfApplied,false);
  assert.equal(result.nextRequiredStep,'DEFENDER_MORALE_CHOICE');
  assert.equal(result.leaderRemoved,false);
});
test('one helmet out of two dice does not eliminate attached leader',()=>{
  const outcome=leaderCheck({checklist:make({leaderAttached:true}),
    roll:roll(['LEADER','FLAG'])});
  assert.equal(outcome.leaderWouldBeEliminated,false);
  assert.equal(outcome.leaderSymbols,1);
});
test('two non-helmet results leave leader alive',()=>{
  const outcome=leaderCheck({checklist:make({leaderAttached:true}),
    roll:roll(['LIGHT','SWORDS'])});
  assert.equal(outcome.leaderWouldBeEliminated,false);
  assert.equal(outcome.leaderSymbols,0);
});
test('unit eliminated and leader survives one-die check: evade required',()=>{
  const p=make({blocksRemaining:1,leaderAttached:true});
  const o=leaderCheck({checklist:p,roll:roll(['FLAG'])});
  assert.equal(o.leaderWouldBeEliminated,false);
  assert.equal(o.leaderMustEvadeIfApplied,true);
  assert.equal(o.nextRequiredStep,'LEADER_EVADE_IF_SURVIVES');
  assert.equal(o.retreatResolved,false);
});
test('unit eliminated and leader hit on one die: no evade decision remains',()=>{
  const p=make({blocksRemaining:1,leaderAttached:true});
  const o=leaderCheck({checklist:p,roll:roll(['LEADER'])});
  assert.equal(o.leaderWouldBeEliminated,true);
  assert.equal(o.leaderMustEvadeIfApplied,false);
  assert.equal(o.nextRequiredStep,'AUTHORITATIVE_FINALIZATION');
});
test('unit surviving and no flags after leader check: awaiting authorized finalization',()=>{
  const p=make({leaderAttached:true,flagsPending:0});
  const o=leaderCheck({checklist:p,roll:roll(['LEADER','SWORDS'])});
  assert.equal(o.nextRequiredStep,'AUTHORITATIVE_FINALIZATION');
  assert.equal(o.combatResolved,false);
});
test('physical leader result retains PLAYER_DECLARED provenance, never verified',()=>{
  const p=make({leaderAttached:true});
  const o=leaderCheck({checklist:p,roll:roll(['LEADER','LEADER'],{
    source:'PHYSICAL',verification:'PLAYER_DECLARED'})});
  assert.equal(o.source,'PHYSICAL');
  assert.equal(o.verification,'PLAYER_DECLARED');
  assert.equal(o.requiresFullAuthorization,true);
});
test('forged physical verification and wrong roll source are invalid',()=>{
  const p=make({leaderAttached:true});
  for(const change of [{source:'PHYSICAL'},{source:'CUSTOM'},{verification:'PLAYER_DECLARED'},
    {actor:'C'},{ruleset:'other'},{type:'DICE_ROLLED_SYNTHETIC'}])
    assert.throws(()=>leaderCheck({checklist:p,roll:roll(['LEADER','LEADER'],change)}),
      /INVALID_LEADER_CASUALTY_ROLL/);
});
test('leader check rejects wrong dice count, unknown faces and forged arrays',()=>{
  const p=make({leaderAttached:true});
  for(const r of [roll(['LEADER']),roll(['LEADER','LEADER','LEADER']),
    roll(['LEADER','RED']),roll(['LEADER','LEADER'],{diceCount:1}),
    roll(['LEADER','LEADER'],{results:'LEADER,LEADER'}),null])
    assert.throws(()=>leaderCheck({checklist:p,roll:r}),/INVALID_LEADER_CASUALTY_ROLL/);
});
test('no check is possible when there is no leader or no initial block loss',()=>{
  for(const p of [make(),make({leaderAttached:true,matchingColorHits:0})])
    assert.throws(()=>leaderCheck({checklist:p,roll:roll(['LEADER','LEADER'])}),
      /LEADER_CASUALTY_CHECK_NOT_REQUIRED/);
});
test('synthetic or missing checklist cannot be treated as a leader casualty sequence',()=>{
  for(const x of [null,{},undefined,{kind:'ANCIENTS_BASE_RANGED_RESOLUTION_CHECKLIST'}])
    assert.throws(()=>leaderCheck({checklist:x,roll:roll(['LEADER','LEADER'])}));
});
test('original checklist and dice cannot be mutated by a casualty preview',()=>{
  const p=make({leaderAttached:true});
  const r=roll(['LEADER','FLAG']);
  const saved=structuredClone({p,r});
  const outcome=leaderCheck({checklist:p,roll:r});
  assert.equal(Object.isFrozen(outcome),true);
  assert.deepEqual({p,r},saved);
  assert.equal(p.leaderCheckAlreadyRolled,false);
});
test('surviving leader does not trigger a second check after later retreat losses',()=>{
  const p=make({leaderAttached:true});
  assert.equal(p.steps.filter(s=>s.kind.includes('LEADER_')).length,1);
  assert.equal(p.steps.find(s=>s.kind==='LEADER_CASUALTY_CHECK').maximumChecksForThisCombat,1);
});
test('with no initial block loss, future retreat losses can trigger a single check',()=>{
  const p=make({leaderAttached:true,matchingColorHits:0,flagsPending:1});
  assert.equal(p.steps.filter(s=>s.kind.includes('LEADER_')).length,1);
  assert.equal(p.steps[2].conditional,true);
});

test('forged checklist cannot inject a leader check or skip required steps',()=>{
  const p=make({leaderAttached:true});
  const r=roll(['LEADER','LEADER']);
  assert.throws(()=>leaderCheck({checklist:{...p,steps:[p.steps[1]]},roll:r}),
    /INCONSISTENT_LEADER_CASUALTY_CHECKLIST/);
  assert.throws(()=>leaderCheck({checklist:{...p,blockLoss:{...p.blockLoss,remainingBlocks:0}},roll:r}),
    /INCONSISTENT_LEADER_CASUALTY_CHECKLIST/);
});

test('dedicated digital leader check uses six canonical faces with injected test RNG',()=>{
  let calls=0;
  const event=captureLeader({rollId:'leader_check_01',actor:'A',diceCount:2,mode:'DIGITAL',
    randomIndex:limit=>{assert.equal(limit,6);return [3,0][calls++];}});
  assert.equal(calls,2);
  assert.deepEqual(event.results,['LEADER','LIGHT']);
  assert.equal(event.type,'ANCIENTS_BASE_LEADER_CASUALTY_CAPTURED');
  assert.equal(event.purpose,'LEADER_CASUALTY_CHECK');
  assert.equal(event.verification,'SERVER_GENERATED');
  assert.equal(leaderCheck({checklist:make({leaderAttached:true}),roll:event}).leaderSymbols,1);
});
test('dedicated physical check preserves provenance and official faces',()=>{
  const event=captureLeader({rollId:'leader_check_02',actor:'B',diceCount:1,mode:'PHYSICAL',
    declaredFaces:['LEADER']});
  assert.equal(event.verification,'PLAYER_DECLARED');
  assert.equal(event.source,'PHYSICAL');
  assert.deepEqual(event.results,['LEADER']);
  assert.equal(leaderCheck({checklist:make({blocksRemaining:1,leaderAttached:true}),roll:event}).leaderWouldBeEliminated,true);
});
test('original ranged attack roll cannot masquerade as a leader check',()=>{
  const checklist=make({leaderAttached:true});
  for(const changed of [{type:'ANCIENTS_BASE_RANGED_DICE_CAPTURED'},
    {purpose:'RANGED_ATTACK'},{purpose:undefined}])
    assert.throws(()=>leaderCheck({checklist,roll:roll(['LEADER','LEADER'],changed)}),
      /INVALID_LEADER_CASUALTY_ROLL/);
});
test('dedicated leader dice reject invalid count, mode and undeclared physical symbols',()=>{
  for(const diceCount of [0,3,4,-1,1.5,undefined])
    assert.throws(()=>captureLeader({rollId:'leader_check_03',actor:'A',mode:'DIGITAL',diceCount}),
      /INVALID_LEADER_CASUALTY_DICE_COUNT/);
  assert.throws(()=>captureLeader({rollId:'leader_check_03',actor:'A',mode:'FORGED',diceCount:2}),
    /INVALID_LEADER_CASUALTY_MODE/);
  assert.throws(()=>captureLeader({rollId:'leader_check_03',actor:'A',mode:'PHYSICAL',
    diceCount:1,declaredFaces:['RED']}),/INVALID_PHYSICAL_DECLARATION/);
});
test('original attack dice cannot be injected into capture of leader result',()=>{
  assert.throws(()=>captureLeader({rollId:'leader_check_04',actor:'A',mode:'DIGITAL',
    diceCount:2,declaredFaces:['LEADER','LEADER']}),/DIGITAL_LEADER_DICE_CANNOT_BE_DECLARED/);
  assert.throws(()=>captureLeader({rollId:'leader_check_04',actor:'A',mode:'PHYSICAL',
    diceCount:2,declaredFaces:['LEADER','LEADER'],randomIndex:()=>3}),/PHYSICAL_LEADER_DICE_CANNOT_INJECT_RANDOMNESS/);
});
