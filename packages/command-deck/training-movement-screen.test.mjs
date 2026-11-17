import test from 'node:test';
import assert from 'node:assert/strict';
import {getTrainingScenario} from './training-scenario.mjs';
import {createTrainingReference} from './training-reference.mjs';
import {screenVersionedTrainingMove} from './training-movement-screen.mjs';

test('server training screen blocks troop overreach, forest transit and preserves legacy',()=>{
 const scenario=getTrainingScenario();
 const board=scenario.units.map(({id,side,col,row})=>({id,side,col,row}));
 const state={board,trainingReference:createTrainingReference(board)};
 assert.equal(screenVersionedTrainingMove(state,{unitId:'synthetic-a',path:[{col:4,row:6}]}).accepted,true);
 assert.equal(screenVersionedTrainingMove(state,{unitId:'synthetic-b',path:[{col:8,row:2},{col:7,row:2}]}).reason,
   'TRAINING_TROOP_RANGE_EXCEEDED');
 const nearForest={...state,board:[{...board[0],col:4,row:4},board[1]]};
 assert.equal(screenVersionedTrainingMove(nearForest,{unitId:'synthetic-a',
   path:[{col:5,row:4},{col:6,row:4}]}).reason,'TRAINING_TERRAIN_RESTRICTED');
 assert.equal(screenVersionedTrainingMove({board},{unitId:'synthetic-b',path:[{col:8,row:2},{col:7,row:2}]}).status,
   'SKIPPED_LEGACY');
 const legacy={...state,trainingReference:{...state.trainingReference}};
 delete legacy.trainingReference.scenarioId;
 assert.equal(screenVersionedTrainingMove(legacy,{unitId:'synthetic-b',path:[{col:8,row:2},{col:7,row:2}]}).status,
   'SKIPPED_LEGACY');
});
