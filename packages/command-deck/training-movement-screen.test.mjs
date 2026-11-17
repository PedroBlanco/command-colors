import test from 'node:test';
import assert from 'node:assert/strict';
import {getTrainingScenario,NEW_MATCH_TRAINING_SCENARIO_ID} from './training-scenario.mjs';
import {createTrainingReference} from './training-reference.mjs';
import {screenVersionedTrainingMove as check,createServerTrainingMovementPolicy} from './training-movement-screen.mjs';

test('versioned training checks troop range and terrain, legacy skips',()=>{
 const board=getTrainingScenario().units.map(({id,side,col,row})=>({id,side,col,row}));
 const state={board,trainingReference:createTrainingReference(board)};
 assert.equal(check(state,{unitId:'synthetic-a',path:[{col:4,row:6}]}).accepted,true);
 assert.equal(check(state,{unitId:'synthetic-b',path:[{col:8,row:2},{col:7,row:2}]}).reason,'TRAINING_TROOP_RANGE_EXCEEDED');
 assert.equal(check({...state,board:[{...board[0],col:4,row:4},board[1]]},{
   unitId:'synthetic-a',path:[{col:5,row:4},{col:6,row:4}]
 }).reason,'TRAINING_TERRAIN_RESTRICTED');
 assert.equal(check({board},{unitId:'synthetic-b',path:[]}).status,'SKIPPED_LEGACY');
});

test('server uses 4/3 cavalry steps and keeps legacy 2-step limit',()=>{
 const s=getTrainingScenario(NEW_MATCH_TRAINING_SCENARIO_ID);
 const board=s.units.map(({id,side,col,row})=>({id,side,col,row}));
 const state={board,trainingReference:createTrainingReference(board,s.id)};
 const limits=createServerTrainingMovementPolicy(state).maxStepsByUnit;
 assert.equal(limits['synthetic-cavalry-a'],4);
 assert.equal(limits['synthetic-cavalry-b'],3);
 assert.equal(createServerTrainingMovementPolicy({board}).maxStepsByUnit['synthetic-cavalry-a'],2);
 assert.equal(check(state,{unitId:'synthetic-cavalry-b',path:[
   {col:10,row:1},{col:9,row:1},{col:8,row:1},{col:7,row:1}
 ]}).reason,'TRAINING_TROOP_RANGE_EXCEEDED');
});
