import test from 'node:test';
import assert from 'node:assert/strict';
import {getTrainingScenario,NEW_MATCH_TRAINING_SCENARIO_ID} from './training-scenario.mjs';
import {createTrainingReference} from './training-reference.mjs';
import {createTrainingMovementLedger} from './training-ranged-ledger.mjs';
import {prepareStagedTrainingRangedDice as prepare,
  projectStagedTrainingRangedDice as project} from './training-ranged-dice.mjs';

test('physical training roll stages only interpreted faces, never battle effects',()=>{
 const cfg=getTrainingScenario(NEW_MATCH_TRAINING_SCENARIO_ID);
 const board=cfg.units.map(({id,side,col,row})=>({id,side,col,row}));
 Object.assign(board[0],{col:2,row:5});Object.assign(board[1],{col:5,row:5});
 const state={board,trainingReference:createTrainingReference(board,cfg.id),
   movedUnitIds:[],commandSession:{phaseState:{revision:3,turn:'A',phase:'COMBAT',
     pendingDecision:null,orderedUnits:['synthetic-a']}}};
 state.trainingMovementLedger=createTrainingMovementLedger(state);
 const args={actor:'A',expectedRevision:3,attackerId:'synthetic-a',
   targetId:'synthetic-b',mode:'PHYSICAL',declaredFaces:['MEDIUM','FLAG']};
 const before=JSON.stringify(state);
 const result=prepare(state,args,{rollId:'training_roll_001'});
 assert.equal(result.accepted,true);
 assert.equal(result.staged.roll.verification,'PLAYER_DECLARED');
 assert.equal(result.staged.interpretation.matchingColorHits,1);
 assert.equal(result.staged.interpretation.flagsPending,1);
 assert.equal(result.staged.interpretation.hitsApplied,false);
 assert.equal(result.event.blocksRemoved,false);
 assert.equal(JSON.stringify(state),before);
 state.trainingStagedRangedDice=result.staged;
 state.commandSession.phaseState.revision=4;
 assert.deepEqual(project(state),result.staged);
 assert.equal(prepare(state,args,{rollId:'training_roll_002'}).reason,
   'TRAINING_DICE_ALREADY_STAGED');
 state.trainingStagedRangedDice.interpretation.matchingColorHits=9;
 assert.throws(()=>project(state),/INVALID_TRAINING_DICE_STATE/);
});

test('training roll refuses unsupported modes, forged faces and missing ledger',()=>{
 const cfg=getTrainingScenario(NEW_MATCH_TRAINING_SCENARIO_ID);
 const board=cfg.units.map(({id,side,col,row})=>({id,side,col,row}));
 Object.assign(board[0],{col:2,row:5});Object.assign(board[1],{col:5,row:5});
 const state={board,trainingReference:createTrainingReference(board,cfg.id),
   movedUnitIds:[],commandSession:{phaseState:{revision:3,turn:'A',phase:'COMBAT',
     pendingDecision:null,orderedUnits:['synthetic-a']}}};
 state.trainingMovementLedger=createTrainingMovementLedger(state);
 const args={actor:'A',expectedRevision:3,attackerId:'synthetic-a',
   targetId:'synthetic-b',mode:'PHYSICAL',declaredFaces:['MEDIUM','FLAG']};
 assert.equal(prepare(state,{...args,mode:'UNKNOWN'},{rollId:'training_roll_003'}).reason,
   'INVALID_TRAINING_DICE_MODE');
 assert.equal(prepare(state,{...args,declaredFaces:['MEDIUM','BAD']},
   {rollId:'training_roll_003'}).reason,'INVALID_TRAINING_DICE_FACES');
 assert.equal(prepare(state,{...args,mode:'DIGITAL'},
   {rollId:'training_roll_003'}).reason,'INVALID_TRAINING_DICE_FACES');
 delete state.trainingMovementLedger;
 assert.equal(prepare(state,args,{rollId:'training_roll_004'}).reason,
   'NO_TRUSTED_MOVEMENT_LEDGER');
});
