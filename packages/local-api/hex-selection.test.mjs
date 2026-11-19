import test from 'node:test';
import assert from 'node:assert/strict';
import {beginMovementDraft, appendMovementHex, undoMovementHex, movementDraftFields} from './hex-selection.mjs';
import {deckCommand} from './deck-controls.mjs';

const view = () => ({you:'A',turn:'A',actingSide:'A',phase:'MOVEMENT',revision:5,
  yourHand:[],pendingDecision:null,movedUnitIds:[],board:[
    {id:'synthetic-a',side:'A',col:3,row:4},
    {id:'synthetic-a2',side:'A',col:7,row:4},
    {id:'synthetic-b',side:'B',col:5,row:4}
  ]});
const hex = (col,row) => ({col,row});
const starts = (v=view()) => beginMovementDraft(v,'synthetic-a');

const fail = (fn, code) => assert.throws(fn, error => error?.message === code);

test('a player starts an empty draft from their own public unit', () => {
  assert.deepEqual(starts(), {unitId:'synthetic-a',revision:5,origin:hex(3,4),path:[]});
});

test('odd-q route grows on adjacent cells and becomes an actor-free payload', () => {
  const v=view(), original=starts(v);
  const first=appendMovementHex(v,original,hex(4,4));
  const second=appendMovementHex(v,first,hex(4,5));
  assert.deepEqual(original.path,[]);
  assert.deepEqual(first.path,[hex(4,4)]);
  assert.deepEqual(movementDraftFields(v,second),{unitId:'synthetic-a',path:[hex(4,4),hex(4,5)]});
  const command=deckCommand(v,'move_synthetic_unit',movementDraftFields(v,second),'routed_000123');
  assert.deepEqual(command,{type:'move_synthetic_unit',expectedRevision:5,idempotencyKey:'routed_000123',
    unitId:'synthetic-a',path:[hex(4,4),hex(4,5)]});
  assert.equal('actor' in command,false);
});

test('no unit may be selected while opponent acts or outside movement phase', () => {
  for (const change of [{actingSide:'B'},{turn:'B'},{phase:'COMBAT'},{pendingDecision:{actor:'B'}}]) {
    const v={...view(),...change}; fail(()=>starts(v),'MOVIMIENTO_NO_DISPONIBLE');
  }
});

test('enemy, nonexistent and already moved units cannot start or continue a draft', () => {
  const v=view();
  for (const id of ['synthetic-b','unknown','bad id']) fail(()=>beginMovementDraft(v,id),'UNIDAD_NO_PROPIA');
  const d=starts(v); v.movedUnitIds=['synthetic-a'];
  fail(()=>starts(v),'UNIDAD_YA_MOVIDA');
  fail(()=>appendMovementHex(v,d,hex(4,4)),'UNIDAD_YA_MOVIDA');
});

test('stale revision, moved source position and obsolete draft are rejected',()=>{
  const v=view(),d=starts(v); v.revision++;
  fail(()=>appendMovementHex(v,d,hex(4,4)),'BORRADOR_DESACTUALIZADO');
  v.revision--;v.board[0].col++;
  fail(()=>movementDraftFields(v,d),'BORRADOR_DESACTUALIZADO');
});

test('rejects non-neighbors, repeated origin, occupied destinations and cycles',()=>{
  const v=view(),d=starts(v);
  fail(()=>appendMovementHex(v,d,hex(5,5)),'HEX_NO_ADYACENTE');
  fail(()=>appendMovementHex(v,d,hex(3,4)),'HEX_REPETIDO');
  const occupied={...v,board:[...v.board.slice(0,2),{id:'synthetic-b',side:'B',col:4,row:4}]};
  fail(()=>appendMovementHex(occupied,starts(occupied),hex(4,4)),'HEX_OCUPADO');
  const one=appendMovementHex(v,d,hex(4,4));
  fail(()=>appendMovementHex(v,one,hex(3,4)),'HEX_REPETIDO');
});

test('the edge hexes preserve genuine odd-q adjacency',()=>{
  const v=view();v.board[0].col=0;v.board[0].row=0;
  const d=starts(v);
  assert.deepEqual(appendMovementHex(v,d,hex(1,0)).path,[hex(1,0)]);
  fail(()=>appendMovementHex(v,d,hex(1,1)),'HEX_NO_ADYACENTE');
});

test('malformed and out-of-board cells are rejected without a network request',()=>{
  const v=view(),d=starts(v);
  for(const hexagon of [null,{},hex(-1,4),hex(13,4),hex(3.5,4),hex(4,9),'4,4']) {
    fail(()=>appendMovementHex(v,d,hexagon),'HEX_INVALIDO');
  }
});

test('local undo removes last step, does not change server revision or inputs',()=>{
  const v=view(),d=starts(v);
  const one=appendMovementHex(v,d,hex(4,4));
  const two=appendMovementHex(v,one,hex(4,5));
  const undone=undoMovementHex(v,two);
  assert.deepEqual(undone.path,[hex(4,4)]);
  assert.deepEqual(undoMovementHex(v,d).path,[]);
  assert.equal(undone.revision,5);
  assert.deepEqual(two.path,[hex(4,4),hex(4,5)]);
  fail(()=>movementDraftFields(v,d),'RUTA_VACIA');
});

test('a 32-step route is the maximum; duplicate/corrupted view fails closed',()=>{
  const v=view();v.board[0].col=0;v.board[0].row=0;
  let d=starts(v);
  const snake=[];
  for(let col=0;col<4;col++) {
    const rows=col%2 ? [8,7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7,8];
    for(const row of rows) if(col!==0 || row!==0) snake.push(hex(col,row));
  }
  for(const step of snake.slice(0,32)) d=appendMovementHex(v,d,step);
  assert.equal(d.path.length,32);
  fail(()=>appendMovementHex(v,d,snake[32]),'RUTA_DEMASIADO_LARGA');
  const duplicate={...v,board:[...v.board,{id:'synthetic-a',side:'B',col:11,row:2}]};
  fail(()=>starts(duplicate),'VISTA_TABLERO_INVALIDA');
  const collision={...v,board:[...v.board,{id:'another',side:'A',col:0,row:0}]};
  fail(()=>starts(collision),'VISTA_TABLERO_INVALIDA');
});

test('draft serialization strips prototype-adjacent fields and does not alias arrays',()=>{
  const v=view(),d=starts(v);
  const augmented={col:4,row:4,extra:'secret'};
  const next=appendMovementHex(v,d,augmented);
  augmented.col=12;
  const result=movementDraftFields(v,next);
  assert.deepEqual(result,{unitId:'synthetic-a',path:[hex(4,4)]});
  result.path[0].col=0;
  assert.deepEqual(next.path,[hex(4,4)]);
});
