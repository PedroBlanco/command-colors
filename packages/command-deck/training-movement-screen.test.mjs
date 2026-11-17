import test from 'node:test';
import assert from 'node:assert/strict';
import {getTrainingScenario} from './training-scenario.mjs';
import {createTrainingReference} from './training-reference.mjs';
import {screenVersionedTrainingMove as check} from './training-movement-screen.mjs';

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
