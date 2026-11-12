import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeSectionHistoryLab as init,applySectionHistoryLabCommand as apply,
 replaySectionHistoryLab as replay,projectSectionHistoryLab as project,
 assertSectionHistoryLab as validate} from './section-history-journal.mjs';

const config=()=>({cardInstances:[
 {instanceId:'a_card_left',definitionId:'ORDER_2_LEFT'},
 {instanceId:'b_card_right',definitionId:'ORDER_2_RIGHT'},
 {instanceId:'c_card_center',definitionId:'ORDER_3_CENTER'},
 {instanceId:'d_card_left',definitionId:'ORDER_4_LEFT'},
 {instanceId:'e_card_right',definitionId:'ORDER_4_RIGHT'},
 {instanceId:'f_card_center',definitionId:'ORDER_2_CENTER'}],
 handSizes:{A:2,B:2},startingSide:'A',
 randomIndex:()=>0,
 board:{units:[{id:'a1',side:'A',col:2,row:4},{id:'b1',side:'B',col:10,row:4}],leaders:[{id:'a_leader',side:'A',col:2,row:4}]},
 sectorCells:{'2,4':['LEFT'],'10,4':['RIGHT']}});
const setup=()=>init(config());
const cmd=(type,revision,options={})=>({type,actor:'A',expectedRevision:revision,...options});
const play=state=>apply(state,cmd('PLAY_SECTION_CARD',state.revision,{cardInstanceId:state.hands.A[0].instanceId}));
const assign=state=>apply(state,cmd('ASSIGN_SECTION_ORDERS',state.revision,{unitIds:['a1'],leaderIds:[]}));

test('setup keeps exactly one copy of each instance across deck and both hands',()=>{
 const s=setup();assert.equal(validate(s),true);assert.equal(s.revision,0);
 assert.equal(s.drawPile.length,2);assert.equal(s.hands.A.length,2);assert.equal(s.hands.B.length,2);
 const ids=[...s.drawPile,...s.hands.A,...s.hands.B].map(x=>x.instanceId);
 assert.equal(new Set(ids).size,6);
});
test('reject repeated instances, invalid hands, corrupt or made-up sector memberships',()=>{
 const x=config();x.cardInstances[1].instanceId=x.cardInstances[0].instanceId;
 assert.throws(()=>init(x),/INVALID_SECTION_HISTORY_SETUP/);
 const y=config();y.sectorCells['2,4']=['LEFT','LEFT'];
 assert.throws(()=>init(y),/INVALID_SECTION_HISTORY_BOARD/);
 const z=config();z.handSizes.A=10;
 assert.throws(()=>init(z),/INVALID_SECTION_HISTORY_SETUP/);
});
test('refuse an out-of-hand instance, and never mutate input snapshot',()=>{
 const s=setup(),original=structuredClone(s);
 const out=apply(s,cmd('PLAY_SECTION_CARD',0,{cardInstanceId:'not_in_hand'}));
 assert.equal(out.code,'CARD_NOT_IN_OWN_HAND');assert.deepEqual(s,original);
});
test('playing an owned card updates hand and reveals only its definition',()=>{
 const state=setup(),original=structuredClone(state),result=play(state);
 assert.equal(result.accepted,true);assert.equal(result.nextState.phase,'ASSIGN_ORDERS');
 assert.equal(result.nextState.hands.A.length,1);
 assert.equal(result.nextState.cardPlay.instanceId,original.hands.A[0].instanceId);
 assert.equal(result.publicEvent.definitionId,original.hands.A[0].definitionId);
 assert.equal(JSON.stringify(result.publicEvent).includes(original.hands.A[0].instanceId),false);
 assert.deepEqual(state,original);
 assert.equal(result.attackAuthorized,false);
});
test('a player cannot play opponent card or act outside their turn',()=>{
 const s=setup();
 assert.equal(apply(s,cmd('PLAY_SECTION_CARD',0,{cardInstanceId:s.hands.B[0].instanceId})).code,'CARD_NOT_IN_OWN_HAND');
 assert.equal(apply(s,{...cmd('PLAY_SECTION_CARD',0,{cardInstanceId:s.hands.B[0].instanceId}),actor:'B'}).code,'NOT_YOUR_TURN');
});
test('revisions and phases are mandatory for every historical command',()=>{
 const s=setup();
 assert.equal(apply(s,cmd('PLAY_SECTION_CARD',1,{cardInstanceId:s.hands.A[0].instanceId})).code,'STALE_REVISION');
 assert.equal(apply(s,cmd('ASSIGN_SECTION_ORDERS',0,{unitIds:['a1'],leaderIds:[]})).code,'WRONG_PHASE');
});
test('server snapshots order positions and cannot be overwritten by client declaration',()=>{
 const state=play(setup()).nextState;
 const result=assign(state);
 assert.equal(result.accepted,true);assert.equal(result.nextState.phase,'LAB_RESOLUTION_PENDING');
 assert.deepEqual(result.nextState.orderSnapshot.pieces,[{id:'a1',kind:'UNIT',side:'A',col:2,row:4}]);
 assert.equal(result.ordersAuthorized,false);
});
test('duplicate, enemy and unknown ordered pieces are refused',()=>{
 const state=play(setup()).nextState;
 for(const opts of [{unitIds:['a1','a1'],leaderIds:[]},
  {unitIds:['b1'],leaderIds:[]},{unitIds:['unknown'],leaderIds:[]},
  {unitIds:['a1'],leaderIds:['a1']}]){
   assert.equal(apply(state,cmd('ASSIGN_SECTION_ORDERS',1,opts)).accepted,false);
 }
});
test('cannot assign a unit outside the section of played card',()=>{
 const s=setup(),played=play(s).nextState;
 const changed=structuredClone(played);changed.sectorCells['2,4']=['RIGHT'];
 assert.equal(assign(changed).code,'ORDERS_NOT_ELIGIBLE');
});
test('leader explicitly ordered consumes one additional order',()=>{
 const s=setup(),played=play(s).nextState;
 const r=apply(played,cmd('ASSIGN_SECTION_ORDERS',1,{unitIds:['a1'],leaderIds:['a_leader']}));
 assert.equal(r.accepted,true);assert.equal(r.publicEvent.leaderCount,1);
});
test('draw/discard/end of turn are exclusively LAB operations, not combat',()=>{
 const s0=setup(),s1=play(s0).nextState,s2=assign(s1).nextState;
 const r=apply(s2,cmd('END_EXPERIMENTAL_TURN',2));
 assert.equal(r.accepted,true);assert.equal(r.nextState.turn,'B');
 assert.equal(r.nextState.phase,'AWAIT_CARD');assert.equal(r.nextState.discardPile.length,1);
 assert.equal(r.nextState.hands.A.length,2);assert.equal(r.nextState.drawPile.length,1);
 assert.equal(r.publicEvent.kind,'LAB_TURN_ENDED_WITHOUT_COMBAT');
 assert.equal(r.combatResolved,false);
});
test('pure replay from bootstrap plus private command history reproduces full state',()=>{
 const s0=setup(),c0=cmd('PLAY_SECTION_CARD',0,{cardInstanceId:s0.hands.A[0].instanceId});
 const s1=apply(s0,c0).nextState,c1=cmd('ASSIGN_SECTION_ORDERS',1,{unitIds:['a1'],leaderIds:[]});
 const s2=apply(s1,c1).nextState,c2=cmd('END_EXPERIMENTAL_TURN',2);
 const s3=apply(s2,c2).nextState;
 assert.deepEqual(replay(s0,[c0,c1,c2]),s3);
 assert.throws(()=>replay(s0,[c0,c0]),/INVALID_SECTION_HISTORY_EVENT_CHAIN/);
});
test('snapshot with duplicated card in hand or pile fails closed',()=>{
 const s=setup();s.hands.B.push(s.hands.A[0]);
 assert.throws(()=>validate(s),/SECTION_CARD_CONSERVATION_FAILED/);
});
test('both side projections hide hidden deck and opponent card instance identifiers',()=>{
 const s=setup();
 for(const side of ['A','B']){
  const p=project(s,side),enemy=side==='A'?'B':'A';
  const encoded=JSON.stringify(p);
  for(const card of [...s.hands[enemy],...s.drawPile])assert.equal(encoded.includes(card.instanceId),false);
  assert.equal(p.opponentCardCount,2);
  assert.equal(p.attackAuthorized,false);assert.equal(p.combatResolved,false);
 }
});
test('client cannot change server state by mutating a projection',()=>{
 const s=setup();const view=project(s,'A');
 view.yourHand.push({instanceId:'fake_card',definitionId:'ORDER_2_LEFT'});
 assert.equal(project(s,'A').yourHand.length,2);
});
