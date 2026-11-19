import test from 'node:test';
import assert from 'node:assert/strict';
import {deckActions,deckCommand,parseSyntheticMovementPath} from './deck-controls.mjs';
const KEY='moving_client_request_01';
const view=()=>({you:'A',turn:'A',actingSide:'A',phase:'MOVEMENT',revision:4,
  yourHand:['card_a'],board:[{id:'synthetic-a',side:'A',col:3,row:4},
    {id:'synthetic-b',side:'B',col:9,row:4}],pendingDecision:null});

test('manual route parser accepts a single step or a sequence and normalizes spaces',()=>{
 assert.deepEqual(parseSyntheticMovementPath('4,4'),[{col:4,row:4}]);
 assert.deepEqual(parseSyntheticMovementPath(' 4,4 ; 5,4 ; 5,5 '),[
   {col:4,row:4},{col:5,row:4},{col:5,row:5}]);
});
test('malformed coordinate input, out-of-bounds routes and excessive paths are rejected',()=>{
 for(const input of ['',null,'4;4','4,4;', ';4,4','4,9','13,0','-1,4',
   '4,4;3.2,4','not a cell',Array(33).fill('4,4').join(';')]) {
  assert.throws(()=>parseSyntheticMovementPath(input),/RUTA_INVALIDA/);
 }
});
test('only the active player in movement phase sees the movement action',()=>{
 assert.equal(deckActions(view()).includes('move_synthetic_unit'),true);
 assert.equal(deckActions({...view(),phase:'COMBAT'}).includes('move_synthetic_unit'),false);
 assert.equal(deckActions({...view(),actingSide:'B'}).includes('move_synthetic_unit'),false);
 assert.equal(deckActions({...view(),you:'B'}).includes('move_synthetic_unit'),false);
});
test('request is sanitized, includes revision but never actor or forged movement policy',()=>{
 const path=[{col:4,row:4,ignore:'secret'}];
 const c=deckCommand(view(),'move_synthetic_unit',{
  unitId:'synthetic-a',path,actor:'B',maxStepsByUnit:{'synthetic-a':99},board:[]},KEY);
 assert.deepEqual(c,{type:'move_synthetic_unit',expectedRevision:4,idempotencyKey:KEY,
  unitId:'synthetic-a',path:[{col:4,row:4}]});
 c.path[0].col=11;assert.equal(path[0].col,4);
});
test('clients cannot select enemy or absent units or malformed paths',()=>{
 for(const unitId of ['synthetic-b','invented','../oops']) {
  assert.throws(()=>deckCommand(view(),'move_synthetic_unit',{unitId,path:[{col:4,row:4}]},KEY),/UNIDAD_NO_PROPIA/);
 }
 for(const path of [[],[{col:13,row:0}],[{col:4,row:9}],null,'4,4',Array(33).fill({col:4,row:4})]){
  assert.throws(()=>deckCommand(view(),'move_synthetic_unit',{unitId:'synthetic-a',path},KEY),/RUTA_INVALIDA/);
 }
});

test('after a move the public movement tracker disables undo and rejects moving the same unit locally',()=>{
 const state={...view(),movedUnitIds:['synthetic-a']};
 assert.deepEqual(deckActions(state),['move_synthetic_unit','finish_synthetic_movement']);
 assert.throws(()=>deckCommand(state,'move_synthetic_unit',{unitId:'synthetic-a',path:[{col:4,row:4}]},KEY),/UNIDAD_YA_MOVIDA/);
 assert.deepEqual(deckCommand({...state,movedUnitIds:[]},'move_synthetic_unit',{unitId:'synthetic-a',path:[{col:4,row:4}]},KEY).path,[{col:4,row:4}]);
});
