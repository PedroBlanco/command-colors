import test from 'node:test';
import assert from 'node:assert/strict';
import {preflightStagedAncientsRangedHits as preflight} from './ranged-hit-commit-preflight.mjs';
import {precheckAncientsRangedDeclaration} from './ranged-turn-precheck.mjs';
import {createRangedDicePlan} from './dice-plan.mjs';
import {interpretBaseAncientsRangedDice} from './battle-dice.mjs';

const RESERVATION='123e4567-e89b-42d3-a456-426614174022';
function staged() {
  const board={
    units:[
      {id:'a1',side:'A',type:'LIGHT_BOW_INFANTRY',col:2,row:4},
      {id:'b1',side:'B',type:'HEAVY_INFANTRY',col:5,row:4,blocksRemaining:3}
    ], leaders:[],terrain:[]
  };
  const turnState={schemaVersion:1,ruleset:'ancients-base-3e-2009',
    status:'ACTIVE',turn:'A',phase:'COMBAT',revision:6,
    orderedUnitIds:['a1'],resolvedBattleUnitIds:[],
    movedStepsByUnit:{a1:0},pendingCombat:null,pendingDecision:null};
  const screened=precheckAncientsRangedDeclaration({
    turnState,board,sessionSide:'A',attackerId:'a1',targetId:'b1',expectedRevision:6
  });
  assert.equal(screened.status,'CANDIDATE');
  const dicePlan=createRangedDicePlan({
    mode:'OFFICIAL_PREVIEW',screening:screened,board,targetId:'b1'
  });
  const roll={
    type:'ANCIENTS_BASE_RANGED_DICE_CAPTURED',ruleset:turnState.ruleset,
    rollId:'roll_'+RESERVATION.replaceAll('-',''),actor:'A',source:'PHYSICAL',
    verification:'PLAYER_DECLARED',diceCount:2,results:['HEAVY','FLAG'],
    attackAuthorized:false,combatResolved:false,needsFullLegalityCheck:true
  };
  turnState.pendingCombat={
    kind:'RANGED_DICE_STAGED_OFFICIAL_PREVIEW',actor:'A',
    reservationId:RESERVATION,attackerId:'a1',targetId:'b1',
    fullValidationRequired:true,dicePlan,stagedDice:roll,
    previewInterpretation:interpretBaseAncientsRangedDice({
      roll,targetUnitType:'HEAVY_INFANTRY',expectedDiceCount:2
    })
  };
  return {turnState,board,sessionSide:'A',reservationId:RESERVATION,expectedRevision:6};
}
const rejected=change=>{
  const state=staged();
  change(state);
  assert.throws(()=>preflight(state),/INVALID_RANGED_HIT_PREFLIGHT/);
};

test('pure preflight: legal-looking persisted attack is rescreened but not authorized',()=>{
  const state=staged(),original=structuredClone(state);
  const r=preflight(state);
  assert.equal(r.screeningRechecked,true);
  assert.equal(r.recheckedDiceCount,2);
  assert.equal(r.proposedBlocksRemoved,1);
  assert.equal(r.proposedBlocksAfterHits,2);
  assert.equal(r.proposedNextRevision,7);
  assert.equal(r.commitPermitted,false);
  assert.equal(r.attackAuthorized,false);
  assert.equal(r.fullRulesValidated,false);
  assert.equal(r.commandCardValidated,false);
  assert.equal(r.scenarioExceptionsChecked,false);
  assert.equal(r.boardMutated,false);
  assert.equal(Object.isFrozen(r),true);
  assert.deepEqual(state,original);
});

test('pure preflight: moved target is now out of firing range',()=>{
  rejected(({board})=>{board.units[1].col=11;});
});

test('pure preflight: newly adjacent enemy prevents ranged attack',()=>{
  rejected(({board})=>board.units.push({
    id:'enemy_adjacent',side:'B',type:'LIGHT_INFANTRY',
    col:3,row:4,blocksRemaining:4
  }));
});

test('pure preflight: forest on target limits original two-die roll to one',()=>{
  rejected(({board})=>board.terrain.push({col:5,row:4,kind:'FOREST'}));
});

test('pure preflight: changed saved movement record invalidates ranged profile',()=>{
  rejected(({turnState})=>{turnState.movedStepsByUnit.a1=3;});
});

test('pure preflight: invalid server terrain is rejected',()=>{
  rejected(({board})=>board.terrain.push({col:5,row:4,kind:'UNKNOWN'}));
});

test('pure preflight: target changed to friendly is rejected',()=>{
  rejected(({board})=>{board.units[1].side='A';});
});

test('pure preflight: repeated computation is deterministic and read-only',()=>{
  const state=staged(),before=structuredClone(state);
  const first=preflight(state);
  const second=preflight(state);
  assert.deepEqual(first,second);
  assert.deepEqual(state,before);
  assert.equal(first.victoryBannerAwarded,false);
  assert.equal(first.unitRemoved,false);
});
