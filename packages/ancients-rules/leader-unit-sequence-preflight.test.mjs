import test from 'node:test';
import assert from 'node:assert/strict';
import {precheckAncientsMovementSequence as preview} from './leader-unit-sequence-preflight.mjs';

const cell=(col,row)=>({col,row});
const unit=(id,side,col,row,type='HEAVY_INFANTRY')=>({id,side,col,row,type});
const leader=(id,side,col,row)=>({id,side,col,row});
const setup=()=>({
  units:[unit('front','A',2,4,'LIGHT_INFANTRY'),unit('reserve','A',2,6),
    unit('foe','B',10,4)],
  leaders:[leader('captain','A',2,4),leader('foeLeader','B',10,4)],
  actor:'A',orderedUnitIds:['front','reserve'],orderedLeaderIds:['captain'],
  terrain:[]
});
const act=(kind,id,path)=>({kind,id,path:path.map(p=>cell(...p))});
const lead=(...path)=>act('LEADER','captain',path);
const front=(...path)=>act('UNIT','front',path);
const reserve=(...path)=>act('UNIT','reserve',path);
const screen=(actions,options={})=>preview({...setup(),actions,...options});

test('leader detaches before its original unit moves; neither move is committed',()=>{
  const scenario=setup(),original=structuredClone(scenario);
  const r=screen([lead([2,5]),front([3,4])]);
  assert.equal(r.status,'CANDIDATE_SEQUENCE');
  assert.equal(r.reviewedMoves,2);
  assert.deepEqual(r.steps.map(x=>x.kind),['LEADER','UNIT']);
  assert.equal(r.steps[0].detachedFromUnit,'front');
  assert.equal(r.steps[1].leaderCarried,null);
  assert.equal(r.movementAuthorized,false);
  assert.equal(r.attackAuthorized,false);
  assert.equal(r.stateChanged,false);
  assert.equal(r.needsFullLegalityCheck,true);
  assert.equal(Object.isFrozen(r),true);
  assert.deepEqual(scenario,original);
});

test('unit moving first carries its original leader and prevents later detachment',()=>{
  const only=screen([front([3,4])]);
  assert.equal(only.status,'CANDIDATE_SEQUENCE');
  assert.equal(only.steps[0].leaderCarried,'captain');
  const tooLate=screen([front([3,4]),lead([3,5])]);
  assert.equal(tooLate.status,'BLOCKED');
  assert.equal(tooLate.reason,'LEADER_ALREADY_MOVED');
  assert.equal(tooLate.step,1);
});

test('leader attaching to an ordered unit freezes that unit for later movement',()=>{
  const blocked=screen([lead([2,5],[2,6]),reserve([2,7])]);
  assert.equal(blocked.status,'BLOCKED');
  assert.equal(blocked.reason,'UNIT_LOCKED_AFTER_LEADER_JOIN');
  assert.equal(blocked.step,1);
  const joined=screen([lead([2,5],[2,6])]);
  assert.equal(joined.status,'CANDIDATE_SEQUENCE');
  assert.deepEqual(joined.unitsWithMovementLockedByLeader,['reserve']);
  assert.equal(joined.steps[0].joinedUnit,'reserve');
});

test('unit that moved before the leader joins can receive the leader afterwards',()=>{
  const r=screen([reserve([2,7]),lead([2,5],[2,6],[2,7])]);
  assert.equal(r.status,'CANDIDATE_SEQUENCE');
  assert.equal(r.steps[0].to.row,7);
  assert.equal(r.steps[1].joinedUnit,'reserve');
  assert.deepEqual(r.unitsWithMovementLockedByLeader,['reserve']);
  assert.equal(r.movementAuthorized,false);
});

test('unit that joins a previously lone leader cannot be followed by his separate move',()=>{
  const scenario=setup();
  scenario.leaders[0]=leader('captain','A',3,4);
  const r=screen([front([3,4])],scenario);
  assert.equal(r.status,'CANDIDATE_SEQUENCE');
  assert.equal(r.steps[0].attachedLeader,'captain');
  const again=screen([front([3,4]),lead([3,5])],scenario);
  assert.equal(again.reason,'LEADER_ALREADY_MOVED');
});

test('an ordered unit cannot move twice and an ordered leader cannot move twice',()=>{
  assert.equal(screen([front([3,4]),front([4,4])]).reason,'UNIT_ALREADY_MOVED');
  assert.equal(screen([lead([2,5]),lead([2,6])]).reason,'LEADER_ALREADY_MOVED');
});

test('actions must be ordered for acting side and cannot select adversary',()=>{
  const enemy=screen([act('UNIT','foe',[[10,5]])]);
  assert.equal(enemy.reason,'PIECE_NOT_ORDERED');
  const missing=screen([act('LEADER','ghost',[[2,5]])]);
  assert.equal(missing.reason,'PIECE_NOT_ORDERED');
  assert.equal(enemy.movementAuthorized,false);
  assert.equal(missing.stateChanged,false);
});

test('partial normal rules may reject a path; exceptions are never silently allowed',()=>{
  assert.equal(screen([front([4,4])]).reason,'NON_ADJACENT_HEX');
  assert.equal(screen([lead([2,5],[2,6],[2,7],[2,8])]).reason,'LEADER_RANGE_EXCEEDED');
  assert.equal(screen([lead([2,5],[2,6])],{
    terrain:[{col:2,row:5,kind:'FOREST'}]
  }).reason,'LEADER_MUST_STOP_ON_TERRAIN');
});

test('invalid trusted context and forged action fields fail closed',()=>{
  for(const options of [
    {actor:'B'},
    {orderedUnitIds:['front','front']},
    {orderedUnitIds:['foe']},
    {orderedLeaderIds:['foeLeader']},
    {units:[...setup().units,unit('front','A',4,4)]},
    {terrain:undefined},
    {leaders:[]},
    {orderedLeaderIds:['captain','captain']}
  ]) {
    assert.throws(()=>screen([lead([2,5])],options),/INVALID_SEQUENCE_CONTEXT/);
  }
  for(const actions of [
    [act('UNIT','front',[[3,4]]),{...front([3,4]),actor:'B'}],
    [{kind:'LEADER',id:'captain',path:[{col:2,row:5,owner:'B'}]}],
    [{kind:'LEADER',id:'captain',path:[]}],
    [{kind:'LEADER',id:'captain',path:[{col:-1,row:5}]}]
  ]) {
    assert.throws(()=>screen(actions),/INVALID_SEQUENCE_CONTEXT/);
  }
});

test('sequence never modifies trusted board, terrain, orders or caller action paths',()=>{
  const scenario=setup();
  const actions=[lead([2,5],[2,6]),reserve([2,7])];
  const original=structuredClone({scenario,actions});
  const r=screen(actions,scenario);
  assert.equal(r.status,'BLOCKED');
  assert.deepEqual({scenario,actions},original);
  assert.equal(r.movementAuthorized,false);
});
