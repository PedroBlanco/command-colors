import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrainingReference,projectTrainingReference} from './training-reference.mjs';

test('synthetic annotations are public and legacy games remain unannotated',()=>{
 const board=[{id:'synthetic-a',side:'A',col:3,row:6},
   {id:'synthetic-b',side:'B',col:9,row:2}];
 const original={board,trainingReference:createTrainingReference(board)};
 const result=projectTrainingReference(original);
 assert.equal(result.unitTypes['synthetic-a'],'LIGHT_BOW_INFANTRY');
 assert.equal(result.terrain.length,3);
 result.terrain[0].kind='HILL';
 assert.equal(original.trainingReference.terrain[0].kind,'FOREST');
 assert.equal(projectTrainingReference({board}),null);
 original.trainingReference.unitTypes['synthetic-a']='INJECTED';
 assert.throws(()=>projectTrainingReference(original),/INVALID_TRAINING_REFERENCE/);
});
