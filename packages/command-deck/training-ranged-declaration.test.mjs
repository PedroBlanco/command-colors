import test from 'node:test';
import assert from 'node:assert/strict';
import {getTrainingScenario,NEW_MATCH_TRAINING_SCENARIO_ID} from './training-scenario.mjs';
import {createTrainingReference} from './training-reference.mjs';
import {createTrainingMovementLedger} from './training-ranged-ledger.mjs';
import {checkTrainingRangedDeclaration as check} from './training-ranged-declaration.mjs';

test('server precheck uses trusted scenario and steps, never authorizes combat',()=>{
 const fixture=getTrainingScenario(NEW_MATCH_TRAINING_SCENARIO_ID);
 const board=fixture.units.map(({id,side,col,row})=>({id,side,col,row}));
 Object.assign(board[0],{col:2,row:5});
 Object.assign(board[1],{col:5,row:5});
 const s={board,trainingReference:createTrainingReference(board,fixture.id),
   movedUnitIds:[],commandSession:{phaseState:{revision:7,turn:'A',
     phase:'COMBAT',pendingDecision:null,orderedUnits:['synthetic-a']}}};
 s.trainingMovementLedger=createTrainingMovementLedger(s);
 const before=JSON.stringify(s);
 const args={actor:'A',attackerId:'synthetic-a',targetId:'synthetic-b',expectedRevision:7};
 const hit=check(s,args);
 assert.equal(hit.status,'CANDIDATE');
 assert.equal(hit.diceAfterTerrain,2);
 assert.equal(hit.attackAuthorized,false);
 assert.equal(hit.canCommit,false);
 assert.equal(hit.combatRecorded,false);
 assert.equal(check(s,{...args,targetId:'synthetic-cavalry-a'}).reason,'TARGET_NOT_ELIGIBLE');
 assert.equal(check(s,{...args,actor:'B'}).reason,'NOT_ACTING_PLAYER');
 assert.equal(check(s,{...args,expectedRevision:6}).reason,'STALE_REVISION');
 assert.equal(check(s,{...args,attackerId:'synthetic-cavalry-a'}).reason,'UNIT_NOT_ELIGIBLE');
 assert.equal(JSON.stringify(s),before);
 delete s.trainingMovementLedger;
 assert.equal(check(s,args).reason,'NO_TRUSTED_MOVEMENT_LEDGER');
});
