import test from 'node:test';
import assert from 'node:assert/strict';
import {getTrainingScenario,NEW_MATCH_TRAINING_SCENARIO_ID} from './training-scenario.mjs';
import {createTrainingReference} from './training-reference.mjs';
import {createTrainingMovementLedger,readTrainingMovementLedger,
  recordTrainingMovementLedger,resetTrainingMovementLedger,
  projectTrainingRangedHints} from './training-ranged-ledger.mjs';

const setup=()=>{
 const scenario=getTrainingScenario(NEW_MATCH_TRAINING_SCENARIO_ID);
 const board=scenario.units.map(({id,side,col,row})=>({id,side,col,row}));
 board.find(u=>u.id==='synthetic-a').col=2;
 board.find(u=>u.id==='synthetic-a').row=5;
 board.find(u=>u.id==='synthetic-b').col=5;
 board.find(u=>u.id==='synthetic-b').row=5;
 const state={board,trainingReference:createTrainingReference(board,scenario.id),
   movedUnitIds:[],commandSession:{phaseState:{turn:'A',phase:'COMBAT',
     orderedUnits:['synthetic-a'],pendingDecision:null}}};
 state.trainingMovementLedger=createTrainingMovementLedger(state);
 return state;
};

test('stationary and moved shooter derive distinct dice from trusted steps',()=>{
 const s=setup();
 const zero=projectTrainingRangedHints(s,'A');
 assert.equal(zero.status,'REFERENCE_ONLY');
 assert.equal(zero.attackAuthorized,false);
 assert.equal(zero.canCommit,false);
 assert.equal(zero.candidates.some(c=>c.attackerId==='synthetic-a'&&
   c.targetId==='synthetic-b'&&c.diceAfterTerrain===2),true);
 const updated=recordTrainingMovementLedger(s,'synthetic-a',1);
 s.trainingMovementLedger=updated;
 s.movedUnitIds=['synthetic-a'];
 s.board.find(u=>u.id==='synthetic-a').col=3;
 const one=projectTrainingRangedHints(s,'A');
 assert.equal(one.candidates.some(c=>c.attackerId==='synthetic-a'&&
   c.targetId==='synthetic-b'&&c.diceAfterTerrain===1),true);
 assert.equal(projectTrainingRangedHints(s,'B').candidates.length,0);
 s.commandSession.phaseState.phase='DRAW_CARD';
 assert.equal(projectTrainingRangedHints(s,'A').candidates.length,0);
 const reset=resetTrainingMovementLedger(s,'B');
 s.trainingMovementLedger=reset;s.movedUnitIds=[];
 s.commandSession.phaseState.turn='B';
 assert.equal(readTrainingMovementLedger(s).stepsByUnit['synthetic-a'],0);
});

test('missing, corrupted and forged movement history never becomes a shot',()=>{
 const s=setup();
 delete s.trainingMovementLedger;
 assert.equal(projectTrainingRangedHints(s,'A'),null);
 s.trainingMovementLedger=createTrainingMovementLedger(s);
 s.trainingMovementLedger.stepsByUnit['synthetic-a']=5;
 assert.throws(()=>projectTrainingRangedHints(s,'A'),/INVALID_TRAINING_MOVEMENT_LEDGER/);
});
