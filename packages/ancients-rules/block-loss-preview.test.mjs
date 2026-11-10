import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE_UNIT_STARTING_BLOCKS, previewBaseAncientsRangedBlockLoss as preview}
  from './block-loss-preview.mjs';

const input = (change = {}) => ({unitType:'HEAVY_INFANTRY',blocksRemaining:4,
  diceCount:2,matchingColorHits:1,flagsPending:1,leaderAttached:false,...change});

test('base box has exactly 13 supported starting-unit block counts',()=>{
  assert.equal(Object.keys(BASE_UNIT_STARTING_BLOCKS).length,13);
  assert.equal(Object.isFrozen(BASE_UNIT_STARTING_BLOCKS),true);
});

test('all regular infantry types begin with four blocks, except heavy war machine',()=>{
  for(const unitType of ['LIGHT_INFANTRY','LIGHT_SLING_INFANTRY','LIGHT_BOW_INFANTRY',
    'AUXILIA_INFANTRY','WARRIOR_INFANTRY','MEDIUM_INFANTRY','HEAVY_INFANTRY'])
    assert.equal(BASE_UNIT_STARTING_BLOCKS[unitType],4);
  assert.equal(BASE_UNIT_STARTING_BLOCKS.HEAVY_WAR_MACHINE,2);
});

test('cavalry begin with three; elephants and heavy chariots with two',()=>{
  for(const unitType of ['LIGHT_CAVALRY','MEDIUM_CAVALRY','HEAVY_CAVALRY'])
    assert.equal(BASE_UNIT_STARTING_BLOCKS[unitType],3);
  assert.equal(BASE_UNIT_STARTING_BLOCKS.ELEPHANT,2);
  assert.equal(BASE_UNIT_STARTING_BLOCKS.HEAVY_CHARIOT,2);
});

test('one validated hit removes one infantry block without mutating the board',()=>{
  const args=input(),snapshot=structuredClone(args);
  const result=preview(args);
  assert.equal(result.blocksToRemove,1);assert.equal(result.remainingBlocks,3);
  assert.equal(result.unitWouldBeEliminated,false);
  assert.deepEqual(args,snapshot);
  assert.equal('nextBoard' in result,false);
});

test('all hits on the last block are capped; surplus hits have no further effect',()=>{
  const result=preview(input({blocksRemaining:1,diceCount:5,matchingColorHits:4,flagsPending:1}));
  assert.equal(result.blocksToRemove,1);assert.equal(result.excessHits,3);
  assert.equal(result.remainingBlocks,0);
  assert.equal(result.unitWouldBeEliminated,true);
});

test('unit elimination identifies only a possible banner and does not award it',()=>{
  const result=preview(input({blocksRemaining:2,diceCount:2,matchingColorHits:2,flagsPending:0}));
  assert.equal(result.possibleVictoryBanner,1);
  assert.equal(result.bannerAwarded,false);
  assert.equal(result.combatResolved,false);
  assert.equal(result.hitsApplied,false);
});

test('surviving units retain all flags for later morale or retreat resolution',()=>{
  const result=preview(input({diceCount:5,matchingColorHits:1,flagsPending:3}));
  assert.equal(result.effectiveFlagsPending,3);
  assert.equal(result.flagsNoLongerApplicable,0);
  assert.equal(result.flagsResolved,false);
});

test('when unit is eliminated, flags on that unit cannot also force a retreat',()=>{
  const result=preview(input({blocksRemaining:1,diceCount:3,matchingColorHits:1,flagsPending:2}));
  assert.equal(result.effectiveFlagsPending,0);
  assert.equal(result.flagsNoLongerApplicable,2);
  assert.equal(result.unitWouldBeEliminated,true);
});

test('flags without direct hits cannot eliminate units',()=>{
  const result=preview(input({diceCount:2,matchingColorHits:0,flagsPending:2}));
  assert.equal(result.remainingBlocks,4);
  assert.equal(result.blocksToRemove,0);
  assert.equal(result.effectiveFlagsPending,2);
  assert.equal(result.possibleVictoryBanner,0);
});

test('a no-effect roll preserves blocks and creates no leader casualty check',()=>{
  const result=preview(input({diceCount:2,matchingColorHits:0,flagsPending:0,leaderAttached:true}));
  assert.equal(result.blocksToRemove,0);
  assert.equal(result.leaderCasualtyCheck,null);
});

test('attached leader with surviving damaged unit requires two helmets on two dice',()=>{
  const result=preview(input({leaderAttached:true}));
  assert.deepEqual(result.leaderCasualtyCheck,{
    kind:'ATTACHED_LEADER_CASUALTY_CHECK',diceCount:2,
    requiredLeaderSymbols:2,leaderEvasionMayFollow:false,completed:false});
  assert.equal(result.leaderChecksResolved,false);
});

test('attached leader after unit elimination requires one helmet on one die',()=>{
  const result=preview(input({blocksRemaining:1,diceCount:2,matchingColorHits:1,
    flagsPending:1,leaderAttached:true}));
  assert.equal(result.leaderCasualtyCheck.diceCount,1);
  assert.equal(result.leaderCasualtyCheck.requiredLeaderSymbols,1);
  assert.equal(result.leaderCasualtyCheck.leaderEvasionMayFollow,true);
});

test('no attached leader means no casualty dice, even when unit is eliminated',()=>{
  const result=preview(input({blocksRemaining:1,matchingColorHits:1,leaderAttached:false}));
  assert.equal(result.leaderCasualtyCheck,null);
});

test('the preview never causes a second leader check for flags that are not resolved',()=>{
  const result=preview(input({leaderAttached:true,diceCount:4,matchingColorHits:1,flagsPending:3}));
  assert.equal(result.leaderCasualtyCheck.diceCount,2);
  assert.equal(result.flagsResolved,false);
  assert.equal('secondLeaderCasualtyCheck' in result,false);
});

test('all base-box types accept current blocks within their respective bounds',()=>{
  for(const [unitType,maxBlocks] of Object.entries(BASE_UNIT_STARTING_BLOCKS)) {
    for(let n=1;n<=maxBlocks;n++) {
      const result=preview(input({unitType,blocksRemaining:n,diceCount:1,matchingColorHits:1,flagsPending:0}));
      assert.equal(result.remainingBlocks,n-1);
      assert.equal(result.maxBlocks,maxBlocks);
    }
  }
});

test('reject absent or invented remaining blocks; never infer starting stack size',()=>{
  for(const blocksRemaining of [undefined,null,0,-1,2.5,'4',5,Infinity,NaN])
    assert.throws(()=>preview(input({blocksRemaining})),/INVALID_SERVER_UNIT_BLOCKS/);
});

test('smaller maximum of elephants, chariots and war machines is enforced',()=>{
  for(const unitType of ['ELEPHANT','HEAVY_CHARIOT','HEAVY_WAR_MACHINE'])
    assert.throws(()=>preview(input({unitType,blocksRemaining:3})),/INVALID_SERVER_UNIT_BLOCKS/);
  assert.throws(()=>preview(input({unitType:'LIGHT_CAVALRY',blocksRemaining:4})),/INVALID_SERVER_UNIT_BLOCKS/);
});

test('unknown, unsupported, or misleading unit types fail closed',()=>{
  for(const unitType of [undefined,null,'LEADER','LIGHT_BOW_CAVALRY','HEAVY_INFANTRY ',
    '__proto__','toString','heavy_infantry'])
    assert.throws(()=>preview(input({unitType})),/UNSUPPORTED_BASE_UNIT_TYPE/);
});

test('reject negative, fractional, nonnumeric or unbounded hit and flag counts',()=>{
  for(const bad of [undefined,null,-1,1.25,'1',33,Infinity,NaN]) {
    assert.throws(()=>preview(input({matchingColorHits:bad})),/INVALID_VALIDATED_DICE_COUNTS/);
    assert.throws(()=>preview(input({flagsPending:bad})),/INVALID_VALIDATED_DICE_COUNTS/);
  }
});

test('cannot consume more hits and flags combined than dice rolled',()=>{
  assert.throws(()=>preview(input({diceCount:2,matchingColorHits:2,flagsPending:1})),
    /INVALID_VALIDATED_DICE_COUNTS/);
});

test('the dice count is mandatory and within the supported secure roller limit',()=>{
  for(const diceCount of [undefined,0,33,-1,'2',1.5])
    assert.throws(()=>preview(input({diceCount})),/INVALID_VALIDATED_DICE_COUNTS/);
});

test('attachment must be a verified boolean; missing attachment cannot default to false',()=>{
  for(const leaderAttached of [undefined,null,0,1,'false',{},[]])
    assert.throws(()=>preview(input({leaderAttached})),/LEADER_ATTACHMENT_NOT_VERIFIED/);
});

test('returned preview and pending leader check are immutable',()=>{
  const output=preview(input({leaderAttached:true}));
  assert.equal(Object.isFrozen(output),true);
  assert.equal(Object.isFrozen(output.leaderCasualtyCheck),true);
  assert.equal(output.attackAuthorized,false);
  assert.equal(output.boardMutated,false);
});

test('zero hits with one flag still preserves ability to decide later',()=>{
  const result=preview(input({diceCount:1,matchingColorHits:0,flagsPending:1,leaderAttached:true}));
  assert.equal(result.effectiveFlagsPending,1);
  assert.equal(result.leaderCasualtyCheck,null);
});
