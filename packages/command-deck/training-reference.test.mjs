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

test('new references preserve public scenario identity without a card leak',()=>{
 const board=[{id:'synthetic-a',side:'A',col:3,row:6},
   {id:'synthetic-b',side:'B',col:9,row:2}];
 const ref=createTrainingReference(board);
 const view=projectTrainingReference({board,trainingReference:ref});
 assert.equal(view.scenario.id,'test-synthetic-001');
 assert.equal(view.scenario.official,false);
 assert.equal(view.scenario.victory.implemented,false);
 assert.equal(JSON.stringify(view).includes('PRIVATE_A_1'),false);
 ref.terrain[0].kind='HILL';
 assert.throws(()=>projectTrainingReference({board,trainingReference:ref}),
   /INVALID_TRAINING_REFERENCE/);
});
