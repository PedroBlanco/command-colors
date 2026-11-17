import test from 'node:test';
import assert from 'node:assert/strict';
import {getTrainingScenario,NEW_MATCH_TRAINING_SCENARIO_ID} from './training-scenario.mjs';
import {createTrainingReference} from './training-reference.mjs';
import {createTrainingMovementLedger,recordTrainingMovementLedger,
  resetTrainingMovementLedger,readTrainingMovementLedger,
  projectTrainingRangedHints} from './training-ranged-ledger.mjs';

test('trusted steps change ranged preview; missing or corrupted history does not',()=>{
 const cfg=getTrainingScenario(NEW_MATCH_TRAINING_SCENARIO_ID);
 const board=cfg.units.map(({id,side,col,row})=>({id,side,col,row}));
 Object.assign(board[0],{col:2,row:5});
 Object.assign(board[1],{col:5,row:5});
 const s={board,trainingReference:createTrainingReference(board,cfg.id),
   movedUnitIds:[],commandSession:{phaseState:{turn:'A',phase:'COMBAT',
     orderedUnits:['synthetic-a'],pendingDecision:null}}};
 assert.equal(projectTrainingRangedHints(s,'A'),null);
 s.trainingMovementLedger=createTrainingMovementLedger(s);
 assert.equal(projectTrainingRangedHints(s,'A').candidates[0].diceAfterTerrain,2);
 s.trainingMovementLedger=recordTrainingMovementLedger(s,'synthetic-a',1);
 s.movedUnitIds=['synthetic-a'];board[0].col=3;
 const preview=projectTrainingRangedHints(s,'A');
 assert.equal(preview.candidates[0].diceAfterTerrain,1);
 assert.equal(preview.attackAuthorized,false);
 assert.equal(projectTrainingRangedHints(s,'B').candidates.length,0);
 s.trainingMovementLedger=resetTrainingMovementLedger(s,'B');
 s.movedUnitIds=[];s.commandSession.phaseState.turn='B';
 assert.equal(readTrainingMovementLedger(s).stepsByUnit['synthetic-a'],0);
 s.trainingMovementLedger.stepsByUnit['synthetic-a']=5;
 assert.throws(()=>projectTrainingRangedHints(s,'B'),/INVALID_TRAINING_MOVEMENT_LEDGER/);
});
