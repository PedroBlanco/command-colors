import test from 'node:test';
import assert from 'node:assert/strict';
import {precheckAncientsLeaderPath as screen} from './leader-movement-preflight.mjs';

const at=(col,row)=>({col,row});
const u=(id,side,col,row)=>({id,side,col,row});
const base=()=>({
  units:[u('ownUnit','A',2,4),u('otherOwnUnit','A',2,6),u('enemyUnit','B',10,4)],
  leaders:[u('ownLeader','A',2,4),u('enemyLeader','B',10,4)],
  terrain:[]
});
const check=(options={})=>screen({...base(),leaderId:'ownLeader',path:[at(2,5)],...options});

test('leader ordered to move individually can detach and attach after normal path',()=>{
  const input=base();
  const original=structuredClone(input);
  const result=check({path:[at(2,5),at(2,6)]});
  assert.equal(result.status,'CANDIDATE');
  assert.equal(result.detachesFromUnit,true);
  assert.equal(result.attachesToUnit,true);
  assert.equal(result.steps,2);
  assert.equal(result.movementAuthorized,false);
  assert.equal(result.attackAuthorized,false);
  assert.equal(result.stateChanged,false);
  assert.equal(result.needsFullLegalityCheck,true);
  assert.equal(Object.isFrozen(result),true);
  assert.deepEqual(input,original);
});

test('leader can pass through friendly units and friendly lone leaders without ending there',()=>{
  const board=base();
  board.units.push(u('passableUnit','A',2,5));
  assert.equal(check({...board,path:[at(2,5),at(2,6)]}).status,'CANDIDATE');
  const withLeader=base();
  withLeader.leaders.push(u('friendLeader','A',2,5));
  assert.equal(check({...withLeader,path:[at(2,5),at(2,6)]}).status,'CANDIDATE');
  const stop=check({...withLeader,path:[at(2,5)]});
  assert.equal(stop.status,'BLOCKED');
  assert.equal(stop.reason,'FRIENDLY_LEADER_AT_DESTINATION');
});

test('enemy unit or enemy leader blocks traversing and destination',()=>{
  const withEnemy=base();
  withEnemy.units.push(u('enemyBlock','B',2,5));
  assert.equal(check(withEnemy).reason,'ENEMY_OCCUPIED_HEX');
  const other=base();
  other.leaders.push(u('enemyBlock','B',2,5));
  assert.equal(check(other).reason,'ENEMY_OCCUPIED_HEX');
  assert.equal(check({...other,path:[at(2,5),at(2,6)]}).status,'BLOCKED');
});

test('normal leader movement is limited to three adjacent, unrepeated hexes',()=>{
  assert.equal(check({path:[at(2,5),at(2,6),at(2,7)]}).status,'CANDIDATE');
  assert.equal(check({path:[at(2,5),at(2,6),at(2,7),at(2,8)]}).reason,
    'LEADER_RANGE_EXCEEDED');
  assert.equal(check({path:[at(2,6)]}).reason,'NON_ADJACENT_HEX');
  assert.equal(check({path:[at(2,5),at(2,4)]}).reason,'REPEATED_HEX');
  for(const path of [[],[at(-1,5)],[at(13,5)],Array.from({length:33},()=>at(2,5))])
    assert.throws(()=>check({path}),/INVALID_LEADER_PATH/);
});

test('forest and broken ground stop a leader while hill allows crossing',()=>{
  for(const kind of ['FOREST','BROKEN_GROUND']) {
    assert.equal(check({terrain:[{...at(2,5),kind}],
      path:[at(2,5),at(2,6)]}).reason,'LEADER_MUST_STOP_ON_TERRAIN');
    assert.equal(check({terrain:[{...at(2,5),kind}]}).status,'CANDIDATE');
  }
  assert.equal(check({terrain:[{...at(2,5),kind:'HILL'}],
    path:[at(2,5),at(2,6)]}).status,'CANDIDATE');
});

test('missing, duplicate or unrecognized server terrain cannot create a candidate',()=>{
  for(const terrain of [undefined,null,[{...at(2,5),kind:'MARSH'}],
    [{...at(2,5),kind:'FOREST'},{...at(2,5),kind:'HILL'}],
    Array.from({length:118},(_,i)=>({...at(2,5),kind:'FOREST'}))])
    assert.throws(()=>check({terrain}),/INVALID_LEADER_TERRAIN_MAP/);
});

test('invalid or forged board cannot create a leader candidate',()=>{
  const board=base();
  for(const leaders of [[...board.leaders,u('ownLeader','A',3,3)],
    [...board.leaders,u('sameCell','A',2,4)],
    [...board.leaders,u('enemyInOwnUnit','B',2,4)]])
    assert.throws(()=>check({leaders}),/INVALID_LEADER_BOARD/);
  assert.throws(()=>check({leaderId:'unknownLeader'}),/UNKNOWN_MOVING_LEADER/);
  assert.throws(()=>check({leaderId:'__proto__'}),/INVALID_LEADER_PATH/);
});

test('leader not originally attached remains unattached when moving to empty hex',()=>{
  const input=base();
  input.leaders[0]={...input.leaders[0],col:2,row:3};
  const result=check({...input,path:[at(2,2)]});
  assert.equal(result.status,'CANDIDATE');
  assert.equal(result.detachesFromUnit,false);
  assert.equal(result.attachesToUnit,false);
});
