import test from 'node:test';
import assert from 'node:assert/strict';
import {privateProjectionMatches as valid} from './private-projection.mjs';

const matchId = '123e4567-e89b-42d3-a456-426614174000';
const players = () => [{handle:'alice',side:'A'},{handle:'bob',side:'B'}];
const ready = () => ({matchId,status:'READY',players:players(),state:{
  matchId,you:'A',board:[{id:'unit_a',side:'A',col:3,row:4}],yourHand:['secret_a'],opponentCardCount:3
}});
const waiting = () => ({matchId,status:'INVITING',players:[players()[0]]});

test('accepts only the authorized side in a complete ready lobby',()=>{
 const a=ready();
 assert.equal(valid(a,'alice',matchId),true);
 a.state.you='B';
 assert.equal(valid(a,'bob',matchId),true);
});

test('accepts waiting lobby only without a private state',()=>{
 assert.equal(valid(waiting(),'alice',matchId),true);
 assert.equal(valid(waiting(),'bob',matchId),false);
 assert.equal(valid({...waiting(),state:{yourHand:['secret']}},'alice',matchId),false);
});

test('rejects a mismatched actor after a same-origin account switch',()=>{
 const a=ready();
 assert.equal(valid(a,'bob',matchId),false);
 assert.equal(valid(a,'carol',matchId),false);
});

test('never accepts a view from a different match even if both players match',()=>{
 const a=ready();a.state.matchId='123e4567-e89b-42d3-a456-426614174001';
 assert.equal(valid(a,'alice',matchId),false);
 const b=ready();b.matchId='123e4567-e89b-42d3-a456-426614174001';
 assert.equal(valid(b,'alice',matchId),false);
});

test('rejects duplicate handles or sides, missing players and three-party lobbies',()=>{
 for(const altered of [
   [{handle:'alice',side:'A'},{handle:'alice',side:'B'}],
   [{handle:'alice',side:'A'},{handle:'bob',side:'A'}],
   [{handle:'alice',side:'A'},{handle:'bob',side:'B'},{handle:'carol',side:'A'}],
   [],
   [null]
 ]) assert.equal(valid({...ready(),players:altered},'alice',matchId),false);
});

test('ready lobbies must contain two participants and a private view',()=>{
 assert.equal(valid({...ready(),players:[players()[0]]},'alice',matchId),false);
 assert.equal(valid({...ready(),state:null},'alice',matchId),false);
 assert.equal(valid({...ready(),state:undefined},'alice',matchId),false);
});

test('rejects malformed identity, match IDs, status and projections',()=>{
 for(const bad of [null,undefined,'',4,' '.repeat(81)])assert.equal(valid(ready(),bad,matchId),false);
 for(const bad of ['../bad','x'.repeat(35),undefined,null])assert.equal(valid(ready(),'alice',bad),false);
 for(const bad of ['ACTIVE','ready',null])assert.equal(valid({...ready(),status:bad},'alice',matchId),false);
 for(const bad of [undefined,null,[],42])assert.equal(valid(bad,'alice',matchId),false);
});

test('rejects invalid or incomplete board, hidden hand and rival card count',()=>{
 for(const changed of [
   {board:null},{board:Array(118).fill({})},{yourHand:'not-a-hand'},
   {opponentCardCount:-1},{opponentCardCount:1.1},{opponentCardCount:'3'}
 ]) assert.equal(valid({...ready(),state:{...ready().state,...changed}},'alice',matchId),false);
});

test('does not mutate server-provided projections',()=>{
 const lobby=ready(),before=structuredClone(lobby);
 assert.equal(valid(lobby,'alice',matchId),true);
 assert.deepEqual(lobby,before);
});

test('invalid incoming player structures fail closed without throwing',()=>{
 for(const entry of [null,[],{handle:'alice',side:'X'},{handle:null,side:'A'}]){
   assert.equal(valid({...ready(),players:[entry,players()[1]]},'alice',matchId),false);
 }
});
