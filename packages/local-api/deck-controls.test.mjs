import test from 'node:test';
import assert from 'node:assert/strict';
import {deckActions, deckCommand, deckSummary} from './deck-controls.mjs';

const KEY='synthetic_request_001';
const baseline=()=>({matchId:'123e4567-e89b-42d3-a456-426614174000',you:'A',turn:'A',actingSide:'A',
  phase:'AWAIT_CARD',revision:0,yourHand:['own_1','own_2'],opponentCardCount:3,drawPileCount:13,
  discardPile:[],cardInPlay:null,pendingDecision:null,board:[]});

test('only acting player receives options in every phase',()=>{
  const base=baseline();
  assert.deepEqual(deckActions(base),['play_synthetic_card']);
  assert.deepEqual(deckActions({...base,phase:'ASSIGN_ORDERS'}),['assign_synthetic_orders']);
  assert.deepEqual(deckActions({...base,phase:'MOVEMENT'}),['undo_synthetic_orders','finish_synthetic_movement']);
  assert.deepEqual(deckActions({...base,phase:'COMBAT'}),['ask_synthetic_defense','finish_synthetic_combat']);
  assert.deepEqual(deckActions({...base,phase:'DRAW_CARD'}),['acknowledge_synthetic_draw']);
  assert.deepEqual(deckActions({...base,you:'B'}),[]);
  assert.deepEqual(deckActions({...base,actingSide:'B'}),[]);
  assert.deepEqual(deckActions({...base,yourHand:[]}),[]);
});

test('defender is allowed only pending decision, not attacker actions',()=>{
  const a=baseline(); const pending={kind:'DEFENSE_CHOICE',actor:'B',targetUnit:'unit_b',options:['STAND','EVADE']};
  assert.deepEqual(deckActions({...a,phase:'COMBAT',actingSide:'B',pendingDecision:pending}),[]);
  assert.deepEqual(deckActions({...a,you:'B',phase:'COMBAT',actingSide:'B',yourHand:['b1'],pendingDecision:pending}),['answer_synthetic_defense']);
  assert.deepEqual(deckActions({...a,phase:'COMBAT',pendingDecision:{...pending,actor:'A'}}),['answer_synthetic_defense']);
});

test('play requests use own card and server revision without actor field',()=>{
  const view=baseline();
  assert.deepEqual(deckCommand(view,'play_synthetic_card',{cardRef:'own_1'},KEY),{
    type:'play_synthetic_card',expectedRevision:0,idempotencyKey:KEY,cardRef:'own_1'
  });
  assert.throws(()=>deckCommand(view,'play_synthetic_card',{cardRef:'secret_b'},KEY),/CARTA_NO_PROPIA/);
  assert.throws(()=>deckCommand(view,'finish_synthetic_combat',{},KEY),/ACCION_NO_DISPONIBLE/);
  assert.throws(()=>deckCommand(view,'play_synthetic_card',{cardRef:'own_1'},'short'),/CLAVE_INVALIDA/);
});

test('orders validate unit identifiers, uniqueness and input immutability',()=>{
  const view={...baseline(),phase:'ASSIGN_ORDERS'};
  const unitIds=['unit_a','unit_b'];
  const request=deckCommand(view,'assign_synthetic_orders',{unitIds},KEY);
  unitIds.push('unit_c');
  assert.deepEqual(request.unitIds,['unit_a','unit_b']);
  for(const invalid of [['bad id'],['twice','twice'],['x/../../a'],Array(118).fill('x')]){
    assert.throws(()=>deckCommand(view,'assign_synthetic_orders',{unitIds:invalid},KEY),/ORDENES_INVALIDAS/);
  }
  assert.deepEqual(deckCommand(view,'assign_synthetic_orders',{unitIds:[]},KEY).unitIds,[]);
});

test('defense answer requires exact allowed choice',()=>{
  const view={...baseline(),you:'B',actingSide:'B',phase:'COMBAT',pendingDecision:{kind:'DEFENSE_CHOICE',actor:'B',targetUnit:'x',options:['STAND','EVADE']}};
  assert.equal(deckCommand(view,'answer_synthetic_defense',{choice:'STAND'},KEY).choice,'STAND');
  assert.throws(()=>deckCommand(view,'answer_synthetic_defense',{choice:'OTHER'},KEY),/RESPUESTA_INVALIDA/);
  assert.throws(()=>deckCommand({...view,pendingDecision:{...view.pendingDecision,options:['STAND']}},'answer_synthetic_defense',{choice:'EVADE'},KEY),/RESPUESTA_INVALIDA/);
});

test('public private summary copies data and does not expose opaque future pile',()=>{
  const s=baseline();const view=deckSummary(s);
  assert.deepEqual(view.tuMano,['own_1','own_2']);
  assert.equal(JSON.stringify(view).includes('enemy_secret'),false);
  assert.equal(Object.hasOwn(view,'drawPile'),false);
  assert.equal(Object.hasOwn(view,'hands'),false);
  view.tuMano.push('forged');assert.equal(s.yourHand.length,2);
  assert.equal(deckSummary({...s,drawPileCount:'bad'}),null);
});

test('invalid and legacy states do not produce deck actions',()=>{
  assert.deepEqual(deckActions(null),[]);
  assert.deepEqual(deckActions({you:'A',turn:'A'}),[]);
  assert.equal(deckSummary({}),null);
});
