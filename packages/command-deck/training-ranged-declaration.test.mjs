import test from 'node:test';
import assert from 'node:assert/strict';
import {getTrainingScenario,NEW_MATCH_TRAINING_SCENARIO_ID} from './training-scenario.mjs';
import {createTrainingReference} from './training-reference.mjs';
import {createTrainingMovementLedger} from './training-ranged-ledger.mjs';
import {checkTrainingRangedDeclaration as check} from './training-ranged-declaration.mjs';

test('declared ranged precheck stays read-only and enforces actor, orders and revision',()=>{
 const cfg=getTrainingScenario(NEW_MATCH_TRAINING_SCENARIO_ID),
   board=cfg.units.map(({id,side,col,row})=>({id,side,col,row}));
 Object.assign(board[0],{col:2,row:5});Object.assign(board[1],{col:5,row:5});
 const state={board,trainingReference:createTrainingReference(board,cfg.id),
   movedUnitIds:[],commandSession:{phaseState:{revision:7,turn:'A',
     phase:'COMBAT',pendingDecision:null,orderedUnits:['synthetic-a']}}};
 state.trainingMovementLedger=createTrainingMovementLedger(state);
 const arg={actor:'A',attackerId:'synthetic-a',targetId:'synthetic-b',expectedRevision:7},
   before=JSON.stringify(state),r=check(state,arg);
 assert.equal(r.status,'CANDIDATE');assert.equal(r.diceAfterTerrain,2);
 assert.equal(r.attackAuthorized,false);
 assert.equal(check(state,{...arg,actor:'B'}).reason,'NOT_ACTING_PLAYER');
 assert.equal(check(state,{...arg,expectedRevision:6}).reason,'STALE_REVISION');
 assert.equal(check(state,{...arg,attackerId:'synthetic-cavalry-a'}).reason,'UNIT_NOT_ELIGIBLE');
 assert.equal(JSON.stringify(state),before);
 delete state.trainingMovementLedger;
 assert.equal(check(state,arg).reason,'NO_TRUSTED_MOVEMENT_LEDGER');
});
