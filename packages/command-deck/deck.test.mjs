import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommandSession, shuffleCardIds, assertCommandSnapshot,
  projectCommandSession, transitionCommandSession} from './deck.mjs';

const IDS = ['alpha_1', 'bravo_2', 'charlie_3', 'delta_4', 'echo_5', 'foxtrot_6', 'golf_7'];
const rng = () => 0;
const setup = (options = {}) => createCommandSession({cardIds: IDS, handSizes: {A: 2, B: 2}, randomIndex: rng, ...options});
function send(snapshot, actor, type, other = {}) {
  return transitionCommandSession(snapshot, {actor, type, expectedRevision: snapshot.phaseState.revision, ...other});
}
function apply(snapshot, actor, type, other = {}) {
  const result = send(snapshot, actor, type, other);
  assert.equal(result.accepted, true, JSON.stringify(result));
  return result.nextState;
}
function toDraw(snapshot, {defense=false}={}) {
  let s=apply(snapshot,'A','play_synthetic_card',{cardRef:projectCommandSession(snapshot,'A').yourHand[0]});
  s=apply(s,'A','assign_synthetic_orders',{unitIds:['unit_alpha']});
  s=apply(s,'A','finish_synthetic_movement');
  if(defense){
    s=apply(s,'A','ask_synthetic_defense',{targetUnit:'unit_bravo'});
    s=apply(s,'B','answer_synthetic_defense',{choice:'STAND'});
  }
  s=apply(s,'A','finish_synthetic_combat');
  return s;
}

test('deals unique opaque instances, accounting for every card',()=>{
 const s=setup();
 assert.equal(s.drawPile.length,3);
 assert.equal(s.hands.A.length,2);assert.equal(s.hands.B.length,2);
 assert.equal(s.discardPile.length,0);assert.equal(s.activeCard,null);
 assert.equal(new Set([...s.drawPile,...s.hands.A,...s.hands.B]).size,7);
 assert.equal(assertCommandSnapshot(s),true);
});

test('Fisher-Yates uses bounded random indexes and leaves input untouched',()=>{
 const source=[...IDS];const bounds=[];
 const output=shuffleCardIds(source,upper=>(bounds.push(upper),0));
 assert.deepEqual(bounds,[7,6,5,4,3,2]);
 assert.deepEqual(source,IDS);
 assert.deepEqual(new Set(output),new Set(IDS));
});

test('cryptographic default shuffle is usable without injected seed',()=>{
 const shuffled=shuffleCardIds(IDS);assert.deepEqual(new Set(shuffled),new Set(IDS));
 const s=createCommandSession({cardIds:IDS,handSizes:{A:2,B:2}});
 assert.equal(assertCommandSnapshot(s),true);
 assert.equal(JSON.stringify(s).includes('seed'),false);
});

test('bad random generator results are rejected before dealing',()=>{
 for (const result of [-1,1000,1.1,NaN,'0']) {
  assert.throws(()=>shuffleCardIds(IDS,()=>result),/INVALID_RANDOM_RESULT/);
 }
 assert.throws(()=>shuffleCardIds(IDS,3),/INVALID_RANDOM_SOURCE/);
});

test('rejects duplicate, invalid or excessive card instance identifiers',()=>{
 for(const ids of [['same','same'],['bad id'],[],Array(513).fill(0).map((_,i)=>`card_${i}`)]){
  assert.throws(()=>shuffleCardIds(ids),/INVALID_CARD_INSTANCES/);
 }
});

test('scenario-specific hand sizes must be possible and nonzero',()=>{
 for (const handSizes of [{A:5,B:5},{A:0,B:2},{A:2,B:2.3},null]) {
  assert.throws(()=>setup({handSizes}),/INVALID_SETUP/);
 }
 assert.throws(()=>setup({startingSide:'Z'}),/INVALID_STARTING_SIDE/);
});

test('only own hand is projected; opponent hand, future pile and seed remain hidden',()=>{
 const s=setup(), a=projectCommandSession(s,'A'), b=projectCommandSession(s,'B');
 assert.deepEqual(a.yourHand,s.hands.A);
 assert.deepEqual(b.yourHand,s.hands.B);
 assert.equal(a.opponentCardCount,2);
 assert.equal(a.drawPileCount,3);
 assert.equal(projectCommandSession(s,'other'),null);
 for(const name of [...s.hands.B,...s.drawPile]) assert.equal(JSON.stringify(a).includes(name),false);
 for(const name of [...s.hands.A,...s.drawPile]) assert.equal(JSON.stringify(b).includes(name),false);
 assert.equal(Object.hasOwn(a,'drawPile'),false);
 assert.equal(Object.hasOwn(a,'seed'),false);
});

test('mutating projected data cannot affect the hidden server state',()=>{
 const s=setup();const a=projectCommandSession(s,'A');
 a.yourHand.push('fake_card');a.discardPile.push('fake_discard');
 assert.equal(s.hands.A.length,2);assert.deepEqual(s.discardPile,[]);
});

test('actor mismatch and stale revision reject without mutating snapshots',()=>{
 const s=setup(), before=JSON.stringify(s);
 assert.deepEqual(send(s,'B','play_synthetic_card',{cardRef:s.hands.A[0]}),{accepted:false,reason:'NOT_ACTING_PLAYER'});
 assert.deepEqual(transitionCommandSession(s,{actor:'A',type:'play_synthetic_card',cardRef:s.hands.A[0],expectedRevision:99}),{accepted:false,reason:'STALE_REVISION'});
 assert.equal(JSON.stringify(s),before);
});

test('a player cannot play opponent or undealt cards, without revealing their location',()=>{
 const s=setup(),before=JSON.stringify(s);
 for(const otherCard of [...s.hands.B,...s.drawPile]){
  const result=send(s,'A','play_synthetic_card',{cardRef:otherCard});
  assert.deepEqual(result,{accepted:false,reason:'CARD_NOT_IN_OWN_HAND'});
  assert.equal(JSON.stringify(result).includes(otherCard),false);
 }
 assert.equal(JSON.stringify(s),before);
});

test('valid card play removes only own card and makes it publicly visible',()=>{
 const s=setup(),played=s.hands.A[0];
 const out=send(s,'A','play_synthetic_card',{cardRef:played});
 assert.equal(out.accepted,true);
 assert.equal(out.nextState.activeCard,played);
 assert.deepEqual(out.events,[{sequence:1,type:'CARD_PLAYED_SIMULATED',side:'A',cardRef:played}]);
 assert.equal(out.nextState.hands.A.includes(played),false);
 assert.equal(s.hands.A.includes(played),true);
 assert.equal(projectCommandSession(out.nextState,'B').cardInPlay,played);
 assert.equal(out.nextState.phaseState.phase,'ASSIGN_ORDERS');
});

test('wrong phase commands are rejected by the real CCW-011 reducer',()=>{
 const s=setup();
 assert.deepEqual(send(s,'A','acknowledge_synthetic_draw'),{accepted:false,reason:'WRONG_PHASE'});
 assert.deepEqual(send(s,'A','finish_synthetic_combat'),{accepted:false,reason:'DECISION_OR_PHASE_PENDING'});
});

test('nonrandom undo restores order assignment only; never redraws or returns played card',()=>{
 const initial=setup(),card=initial.hands.A[0];
 let s=apply(initial,'A','play_synthetic_card',{cardRef:card});
 s=apply(s,'A','assign_synthetic_orders',{unitIds:['unit_alpha']});
 const snapshot=JSON.stringify(s.drawPile);
 s=apply(s,'A','undo_synthetic_orders');
 assert.equal(s.phaseState.phase,'ASSIGN_ORDERS');
 assert.equal(s.activeCard,card);
 assert.equal(s.hands.A.includes(card),false);
 assert.equal(JSON.stringify(s.drawPile),snapshot);
 assert.equal(send(s,'A','undo_synthetic_orders').accepted,false);
});

test('turn end discards public card and draws one secret card from the server pile',()=>{
 const before=setup(),chosen=before.hands.A[0],hiddenTop=before.drawPile.at(-1);
 const ready=toDraw(before);
 const output=send(ready,'A','acknowledge_synthetic_draw');
 assert.equal(output.accepted,true);
 const next=output.nextState;
 assert.equal(next.phaseState.turn,'B');
 assert.equal(next.phaseState.phase,'AWAIT_CARD');
 assert.deepEqual(next.discardPile,[chosen]);
 assert.equal(next.activeCard,null);
 assert.equal(next.hands.A.includes(hiddenTop),true);
 assert.equal(next.hands.A.length,2);
 assert.equal(next.drawPile.length,2);
 assert.equal(JSON.stringify(output.events).includes(hiddenTop),false);
 assert.equal(JSON.stringify(projectCommandSession(next,'B')).includes(hiddenTop),false);
 assert.equal(JSON.stringify(before).includes(hiddenTop),true);
});

test('defender makes a pending decision without changing attacker turn or private hands',()=>{
 let s=setup();s=apply(s,'A','play_synthetic_card',{cardRef:s.hands.A[0]});
 s=apply(s,'A','assign_synthetic_orders',{unitIds:[]});
 s=apply(s,'A','finish_synthetic_movement');
 s=apply(s,'A','ask_synthetic_defense',{targetUnit:'unit_bravo'});
 const json=JSON.stringify(s);const restored=JSON.parse(json);
 assert.equal(assertCommandSnapshot(restored),true);
 assert.equal(projectCommandSession(restored,'B').actingSide,'B');
 assert.equal(restored.phaseState.turn,'A');
 assert.equal(send(restored,'A','finish_synthetic_combat').reason,'NOT_ACTING_PLAYER');
 const answered=apply(restored,'B','answer_synthetic_defense',{choice:'EVADE'});
 assert.equal(answered.phaseState.turn,'A');
 assert.equal(answered.phaseState.pendingDecision,null);
 assert.deepEqual(answered.hands,s.hands);
 assert.deepEqual(answered.drawPile,s.drawPile);
});

test('cannot skip pending defense or draw while combat unfinished',()=>{
 let s=setup();s=apply(s,'A','play_synthetic_card',{cardRef:s.hands.A[0]});
 s=apply(s,'A','assign_synthetic_orders',{unitIds:[]});
 s=apply(s,'A','finish_synthetic_movement');
 s=apply(s,'A','ask_synthetic_defense',{targetUnit:'unit_bravo'});
 assert.equal(send(s,'A','acknowledge_synthetic_draw').accepted,false);
 assert.equal(send(s,'B','finish_synthetic_combat').reason,'DECISION_OR_PHASE_PENDING');
});

test('a full second turn uses B hand and preserves all card instances',()=>{
 let s=setup();s=apply(toDraw(s),'A','acknowledge_synthetic_draw');
 const chosenB=s.hands.B[0];
 s=apply(s,'B','play_synthetic_card',{cardRef:chosenB});
 s=apply(s,'B','assign_synthetic_orders',{unitIds:['unit_bravo']});
 s=apply(s,'B','finish_synthetic_movement');
 s=apply(s,'B','finish_synthetic_combat');
 s=apply(s,'B','acknowledge_synthetic_draw');
 assert.equal(s.phaseState.turn,'A');
 assert.equal(s.phaseState.revision,10);
 assert.equal(s.discardPile.includes(chosenB),true);
 assert.equal(assertCommandSnapshot(s),true);
});

test('restore from JSON keeps private order, revision and all cards',()=>{
 let s=toDraw(setup(),{defense:true});
 s=apply(s,'A','acknowledge_synthetic_draw');
 const restored=JSON.parse(JSON.stringify(s));
 assert.equal(assertCommandSnapshot(restored),true);
 assert.deepEqual(projectCommandSession(restored,'A'),projectCommandSession(s,'A'));
 assert.deepEqual(projectCommandSession(restored,'B'),projectCommandSession(s,'B'));
 const next=apply(restored,'B','play_synthetic_card',{cardRef:restored.hands.B[0]});
 assert.equal(next.phaseState.phase,'ASSIGN_ORDERS');
});

test('snapshot tampering detects duplicate, lost card and changed ruleset',()=>{
 const original=setup();
 const copy=()=>JSON.parse(JSON.stringify(original));
 let state=copy();state.hands.B[0]=state.hands.A[0];
 assert.throws(()=>assertCommandSnapshot(state),/CARD_CONSERVATION_FAILED/);
 state=copy();state.drawPile.pop();assert.throws(()=>assertCommandSnapshot(state),/CARD_CONSERVATION_FAILED/);
 state=copy();state.phaseState.ruleset='wrong-version';
 assert.throws(()=>assertCommandSnapshot(state),/COMMAND_PHASE_INVALID/);
 state=copy();state.phaseState.playedCard=state.hands.A[0];
 assert.throws(()=>assertCommandSnapshot(state),/PHASE_CARD_MISMATCH/);
});

test('deck exhaustion does not silently reshuffle the discard pile',()=>{
 let s=createCommandSession({cardIds:['alpha','bravo'],handSizes:{A:1,B:1},randomIndex:rng});
 s=apply(toDraw(s),'A','acknowledge_synthetic_draw');
 assert.equal(s.drawPile.length,0);
 assert.equal(s.discardPile.length,1);
 assert.equal(s.hands.A.length,0);
 assert.equal(assertCommandSnapshot(s),true);
});

test('full state and selected card never appear in public update event except played card',()=>{
 const s=setup(),otherHand=s.hands.B,hidden=s.drawPile;
 const out=send(s,'A','play_synthetic_card',{cardRef:s.hands.A[0]});
 assert.equal(out.accepted,true);
 const serialized=JSON.stringify(out.events);
 for(const secret of [...otherHand,...hidden])assert.equal(serialized.includes(secret),false);
 assert.equal(Object.hasOwn(out,'seed'),false);
});
