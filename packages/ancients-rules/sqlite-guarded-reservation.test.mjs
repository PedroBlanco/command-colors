import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openGuardedAncientsReservationLab} from './sqlite-guarded-reservation.mjs';

const MATCH='123e4567-e89b-42d3-a456-426614174000';
const turn=(changes={})=>({
  schemaVersion:1,ruleset:'ancients-base-3e-2009',status:'ACTIVE',
  turn:'A',phase:'COMBAT',revision:4,orderedUnitIds:['a1'],
  resolvedBattleUnitIds:[],movedStepsByUnit:{a1:0},
  pendingCombat:null,pendingDecision:null,...changes
});
const board=(changes={})=>({
  units:[{id:'a1',side:'A',type:'LIGHT_BOW_INFANTRY',col:2,row:4},
    {id:'b1',side:'B',type:'HEAVY_INFANTRY',col:5,row:4}],
  leaders:[],terrain:[],...changes
});
const request=(changes={})=>({matchId:MATCH,sessionUserId:'alice',
  attackerId:'a1',targetId:'b1',expectedRevision:4,
  idempotencyKey:'actual_checker_01',...changes});
function fixture(fn,{turnState=turn(),gameBoard=board()}={}) {
  const dir=mkdtempSync(join(tmpdir(),'ccw-guarded-reservation-'));
  const file=join(dir,'guarded.sqlite'),instances=[];
  const open=()=>{const s=openGuardedAncientsReservationLab({file});instances.push(s);return s;};
  try {
    const store=open();
    store.seedFixture({matchId:MATCH,ownerId:'alice',guestId:'bob',turnState,board:gameBoard});
    return fn({store,open});
  } finally {
    for(const s of instances.reverse())try{s.close();}catch{}
    rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});
  }
}

test('real Ancients checker and SQLite reserve the same allowed ranged candidate',()=>fixture(({store})=>{
  const r=store.reserve(request());
  assert.equal(r.code,'SCREENING_RESERVED');
  assert.equal(r.attackAuthorized,false);
  assert.equal(r.fullValidationRequired,true);
  assert.equal(store.inspectFixture({matchId:MATCH,sessionUserId:'bob'}).turnState.pendingCombat.kind,
    'RANGED_SCREENING_ONLY');
}));

test('the second reservation is rejected by the real guard while an attack is pending',()=>fixture(({store})=>{
  const first=store.reserve(request());
  assert.equal(first.code,'SCREENING_RESERVED');
  assert.equal(store.reserve(request({expectedRevision:5,idempotencyKey:'actual_checker_02'})).code,
    'DECLARATION_REJECTED');
  assert.equal(store.reserve(request()).code,'ALREADY_RESERVED');
}));

test('real guard denies a non-acting player even when they are a match participant',()=>fixture(({store})=>{
  assert.equal(store.reserve(request({sessionUserId:'bob'})).code,'DECLARATION_REJECTED');
  assert.equal(store.reserve(request({sessionUserId:'unknown'})).code,'NOT_FOUND');
  assert.equal(store.inspectFixture({matchId:MATCH,sessionUserId:'alice'}).revision,4);
}));

test('real guard rejects wrong phase and units that were not ordered',()=>{
  fixture(({store})=>assert.equal(store.reserve(request()).code,'DECLARATION_REJECTED'),{
    turnState:turn({phase:'MOVEMENT'})
  });
  fixture(({store})=>assert.equal(store.reserve(request()).code,'DECLARATION_REJECTED'),{
    turnState:turn({orderedUnitIds:[],movedStepsByUnit:{}})
  });
});

test('real line of sight rejects an intervening forest from trusted board',()=>fixture(({store})=>{
  assert.equal(store.reserve(request()).code,'DECLARATION_REJECTED');
  assert.equal(store.inspectFixture({matchId:MATCH,sessionUserId:'alice'}).revision,4);
},{
  gameBoard:board({terrain:[{col:4,row:4,kind:'FOREST'}]})
}));

test('real adjacent-enemy restriction blocks an otherwise ranged candidate',()=>fixture(({store})=>{
  assert.equal(store.reserve(request()).code,'DECLARATION_REJECTED');
},{
  gameBoard:board({units:[...board().units,
    {id:'b2',side:'B',type:'MEDIUM_INFANTRY',col:3,row:4}]})
}));

test('real guard cannot treat a synthetic turn as official rules; rollback persists',()=>fixture(({store})=>{
  assert.throws(()=>store.reserve(request()),/INVALID_ANCIENTS_TURN_STATE/);
  assert.equal(store.inspectFixture({matchId:MATCH,sessionUserId:'alice'}).revision,4);
  assert.equal(store.unsafeTestDatabase().prepare('SELECT count(*) n FROM lab_commands').get().n,0);
},{
  turnState:turn({ruleset:'synthetic-phases-v1'})
}));

test('real candidate cancellation allows a fresh check at the new revision',()=>fixture(({store,open})=>{
  const first=store.reserve(request());
  assert.equal(first.code,'SCREENING_RESERVED');
  const cancelled=store.cancel({matchId:MATCH,sessionUserId:'alice',
    reservationId:first.reservationId,expectedRevision:5,
    idempotencyKey:'actual_cancel_0001'});
  assert.equal(cancelled.code,'SCREENING_CANCELLED');
  const second=open().reserve(request({expectedRevision:6,idempotencyKey:'actual_checker_03'}));
  assert.equal(second.code,'SCREENING_RESERVED');
  assert.notEqual(first.reservationId,second.reservationId);
  assert.equal(store.inspectFixture({matchId:MATCH,sessionUserId:'bob'}).events.length,3);
}));

test('real checker cannot approve malformed board; no partially committed state',()=>fixture(({store})=>{
  assert.throws(()=>store.reserve(request()),/INVALID_RANGED_BOARD|INVALID_SERVER_RANGED_BOARD/);
  assert.equal(store.inspectFixture({matchId:MATCH,sessionUserId:'alice'}).revision,4);
},{
  gameBoard:board({terrain:[{col:4,row:4,kind:'MYSTERY'}]})
}));

test('privacy of real-rule diagnostics: responses and events never reveal unit IDs or hidden data',()=>fixture(({store})=>{
  const response=store.reserve(request());
  const events=store.inspectFixture({matchId:MATCH,sessionUserId:'bob'}).events;
  for(const text of ['\"attackerId\":\"a1\"','\"targetId\":\"b1\"','LIGHT_BOW_INFANTRY','PRIVATE_SECRET','FOREST']) {
    assert.equal(JSON.stringify(response).includes(text),false);
    assert.equal(JSON.stringify(events).includes(text),false);
  }
},{
  gameBoard:{...board(),extraPrivate:'PRIVATE_SECRET'}
}));
