import test from 'node:test';
import assert from 'node:assert/strict';
import {createServerSyntheticMovementPolicy as policy} from './server-policy.mjs';
import {transitionSyntheticMovement as move} from './movement.mjs';

const board = () => [
  {id:'synthetic-a',side:'A',col:3,row:4},
  {id:'synthetic-b',side:'B',col:9,row:4}
];

test('builds trusted synthetic movement ranges from persisted board alone', () => {
  const b=board(), copy=structuredClone(b);
  const p=policy(b);
  assert.deepEqual({...p.maxStepsByUnit},{'synthetic-a':2,'synthetic-b':2});
  assert.deepEqual(p.blockedCells,[]);
  assert.deepEqual(b,copy);
});
test('policy produces a usable movement transition on a real odd-q board', () => {
  const state={board:board(),movedUnitIds:[],phaseState:{turn:'A',phase:'MOVEMENT',revision:3,orderedUnits:['synthetic-a'],pendingDecision:null}};
  const r=move(state,{type:'move_synthetic_unit',actor:'A',expectedRevision:3,unitId:'synthetic-a',path:[{col:4,row:4}]},policy(state.board));
  assert.equal(r.accepted,true);
  assert.equal(r.nextState.board[0].col,4);
  assert.equal(r.nextState.phaseState.revision,4);
});
test('rejects forged maximum range from client by re-deriving from board',()=>{
  const state={board:board(),movedUnitIds:[],phaseState:{turn:'A',phase:'MOVEMENT',revision:3,orderedUnits:['synthetic-a'],pendingDecision:null}};
  const c={type:'move_synthetic_unit',actor:'A',expectedRevision:3,unitId:'synthetic-a',path:[{col:4,row:4},{col:4,row:5},{col:5,row:5}],maxStepsByUnit:{'synthetic-a':100}};
  assert.deepEqual(move(state,c,policy(state.board)),{accepted:false,reason:'MOVEMENT_LIMIT_EXCEEDED'});
});
test('rejects unknown units, duplicate occupancy, invalid cells and data types',()=>{
  const inputs=[
    [{id:'synthetic-a',side:'A',col:3,row:4},{id:'synthetic-a',side:'B',col:9,row:4}],
    [{id:'synthetic-a',side:'A',col:3,row:4},{id:'synthetic-b',side:'B',col:3,row:4}],
    [{id:'invalid id',side:'A',col:3,row:4}],
    [{id:'a',side:'B',col:13,row:4}],
    [{id:'a',side:'Z',col:3,row:4}],
    [{id:'a',side:'A',col:3,row:4,orderable:'yes'}],
    null
  ];
  for(const b of inputs) assert.throws(()=>policy(b),/INVALID_SERVER_BOARD/);
});
test('returned policy does not retain references to input board or permit prototype-based names',()=>{
  const b=board();const p=policy(b);
  b[0].id='new';
  assert.equal(p.maxStepsByUnit['synthetic-a'],2);
  assert.equal(Object.getPrototypeOf(p.maxStepsByUnit),null);
  assert.equal(Object.hasOwn(p.maxStepsByUnit,'toString'),false);
});
