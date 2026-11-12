import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE_SECTION_CARD_LIMITS,screenBaseAncientsSectionCardOrders as screen} from './section-card-order-screen.mjs';

const snapshot=()=>({
  turnState:{schemaVersion:1,ruleset:'ancients-base-3e-2009',status:'ACTIVE',phase:'COMBAT',
    turn:'A',revision:6,orderedUnitIds:['a1'],orderedLeaderIds:[]},
  sessionSide:'A',expectedRevision:6,
  handAtPlay:{side:'A',revision:3,cards:[{instanceId:'card_01',definitionId:'ORDER_2_LEFT'},
    {instanceId:'card_02',definitionId:'ORDER_3_RIGHT'}]},
  cardPlay:{side:'A',revision:4,instanceId:'card_01',definitionId:'ORDER_2_LEFT'},
  orderSnapshot:{side:'A',revision:5,pieces:[{id:'a1',kind:'UNIT',side:'A',col:2,row:4}],
    sectorCells:{'2,4':['LEFT']}}
});
const block=(edit,reason)=>{const x=snapshot();edit(x);assert.equal(screen(x).reason,reason)};
test('catalog has nine standard sector/count combinations',()=>{
  assert.equal(Object.keys(BASE_SECTION_CARD_LIMITS).length,9);
  assert.deepEqual(BASE_SECTION_CARD_LIMITS.ORDER_4_CENTER,{section:'CENTER',maxOrders:4});
  assert.equal(Object.isFrozen(BASE_SECTION_CARD_LIMITS.ORDER_4_CENTER),true);
});
test('owned left card and one ordered unit screen as a candidate only',()=>{
  const x=snapshot(),original=structuredClone(x),r=screen(x);
  assert.equal(r.status,'CANDIDATE');assert.equal(r.maximumOrders,2);
  assert.equal(r.ordersInSnapshot,1);assert.equal(r.handSnapshotMatched,true);
  assert.equal(r.cardHandEventVerified,false);assert.equal(r.sectionGeometryVerified,false);
  assert.equal(r.cardPlayAuthorized,false);assert.equal(r.ordersAuthorized,false);
  assert.equal(r.attackAuthorized,false);assert.equal(Object.isFrozen(r),true);
  assert.deepEqual(x,original);
});
test('all nine catalog entries obey their own count and section',()=>{
  for(const [definitionId,rule] of Object.entries(BASE_SECTION_CARD_LIMITS)){
    const x=snapshot();x.handAtPlay.cards[0].definitionId=definitionId;
    x.cardPlay.definitionId=definitionId;
    x.orderSnapshot.sectorCells['2,4']=[rule.section];
    const r=screen(x);
    assert.equal(r.status,'CANDIDATE');assert.equal(r.maximumOrders,rule.maxOrders);
  }
});
test('zero eligible orders are possible but do not authorize a play',()=>{
  const x=snapshot();x.turnState.orderedUnitIds=[];x.orderSnapshot.pieces=[];
  const r=screen(x);assert.equal(r.status,'CANDIDATE');assert.equal(r.ordersInSnapshot,0);
  assert.equal(r.cardPlayAuthorized,false);
});
test('reject card instance absent from the pre-play hand',()=>block(x=>{
  x.cardPlay.instanceId='card_missing';},'CARD_NOT_IN_ACTOR_HAND_AT_PLAY'));
test('reject changed definition despite matching card instance',()=>block(x=>{
  x.cardPlay.definitionId='ORDER_4_CENTER';},'CARD_NOT_IN_ACTOR_HAND_AT_PLAY'));
test('unsupported special and synthetic card families are not accepted',()=>block(x=>{
  x.handAtPlay.cards[0].definitionId='DARKEN_THE_SKY';x.cardPlay.definitionId='DARKEN_THE_SKY';
},'UNSUPPORTED_CARD_FAMILY'));
test('reject cards from other hand or wrong player',()=>{
  block(x=>{x.handAtPlay.side='B';},'WRONG_CARD_OWNER');
  block(x=>{x.cardPlay.side='B';},'WRONG_CARD_OWNER');
  block(x=>{x.sessionSide='B';},'NOT_ACTING_PLAYER');
});
test('reject stale revision and inconsistent card history ordering',()=>{
  block(x=>{x.expectedRevision=5;},'STALE_REVISION');
  block(x=>{x.orderSnapshot.revision=3;},'INVALID_ORDER_HISTORY');
  block(x=>{x.handAtPlay.revision=5;},'INVALID_ORDER_HISTORY');
});
test('reject a unit placed outside the declared section',()=>block(x=>{
  x.orderSnapshot.sectorCells['2,4']=['RIGHT'];},'PIECE_OUT_OF_CARD_SECTION'));
test('accept a boundary hex in either adjacent section with server membership',()=>{
  const x=snapshot();x.orderSnapshot.sectorCells['2,4']=['LEFT','CENTER'];
  assert.equal(screen(x).status,'CANDIDATE');
  x.handAtPlay.cards[0].definitionId='ORDER_2_CENTER';
  x.cardPlay.definitionId='ORDER_2_CENTER';
  assert.equal(screen(x).status,'CANDIDATE');
});
test('missing and incoherent section membership blocks without guessing geometry',()=>{
  block(x=>{delete x.orderSnapshot.sectorCells['2,4'];},'SECTOR_MEMBERSHIP_UNAVAILABLE');
  block(x=>{x.orderSnapshot.sectorCells['2,4']=['LEFT','RIGHT'];},'SECTOR_MEMBERSHIP_UNAVAILABLE');
  block(x=>{x.orderSnapshot.sectorCells['2,4']=['LEFT','LEFT'];},'SECTOR_MEMBERSHIP_UNAVAILABLE');
});
test('cap counts units and separately detached leaders, but not attached passengers',()=>{
  const x=snapshot();x.orderSnapshot.pieces.push({id:'leader_b',kind:'LEADER',side:'A',col:2,row:4});
  x.turnState.orderedLeaderIds=['leader_b'];
  assert.equal(screen(x).ordersInSnapshot,2);
  x.orderSnapshot.pieces.push({id:'a2',kind:'UNIT',side:'A',col:1,row:4});
  x.turnState.orderedUnitIds.push('a2');x.orderSnapshot.sectorCells['1,4']=['LEFT'];
  assert.equal(screen(x).reason,'TOO_MANY_ORDERS');
});
test('a unit with its associated leader not separately ordered costs one order',()=>{
  const x=snapshot();assert.equal(screen(x).unitOrders,1);assert.equal(screen(x).leaderOrders,0);
});
test('reject ordered enemy pieces, duplicated identities and impossible stacks',()=>{
  block(x=>{x.orderSnapshot.pieces[0].side='B';},'FOREIGN_PIECE_ORDER');
  block(x=>{x.orderSnapshot.pieces.push({...x.orderSnapshot.pieces[0]});},'DUPLICATE_ORDER');
  block(x=>{x.orderSnapshot.pieces.push({id:'a2',kind:'UNIT',side:'A',col:2,row:4});},'IMPOSSIBLE_ORDER_POSITION');
});
test('order ledger must match unit and leader ids from turn state',()=>{
  block(x=>{x.turnState.orderedUnitIds=['a2'];},'ORDER_LEDGER_MISMATCH');
  block(x=>{x.turnState.orderedLeaderIds=['l1'];},'ORDER_LEDGER_MISMATCH');
});
test('reject invalid snapshot data rather than inferring missing authoritative facts',()=>{
  for(const modify of [
    x=>{delete x.turnState.orderedLeaderIds;},x=>{x.turnState.ruleset='synthetic-phases-v1';},
    x=>{x.handAtPlay.cards.push({...x.handAtPlay.cards[0]});},
    x=>{x.orderSnapshot.pieces[0].col=13;},
    x=>{x.orderSnapshot.pieces[0].kind='ANY';},
    x=>{x.orderSnapshot.sectorCells=Object.create({__proto__:['LEFT']});}
  ]) {const x=snapshot();modify(x);assert.throws(()=>screen(x));}
});
test('no private hand, card instance or unit IDs appear in a successful public screen',()=>{
  const r=screen(snapshot()),json=JSON.stringify(r);
  for(const secret of ['card_01','card_02','a1'])assert.equal(json.includes(secret),false);
});
test('screening is deterministic without mutating original card or order snapshots',()=>{
  const x=snapshot(),clone=structuredClone(x),r=screen(x);
  assert.deepEqual(screen(x),r);assert.deepEqual(x,clone);
});
