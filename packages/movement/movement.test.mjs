import test from 'node:test';
import assert from 'node:assert/strict';
import {transitionSyntheticMovement as move} from './movement.mjs';

const source = () => ({
  board: [
    {id: 'unit_a',side:'A',col:3,row:4},
    {id: 'unit_a2',side:'A',col:7,row:4},
    {id: 'unit_b',side:'B',col:5,row:4}
  ],
  movedUnitIds: [],
  phaseState: {phase:'MOVEMENT',turn:'A',revision:3,orderedUnits:['unit_a','unit_a2'],pendingDecision:null}
});
const policy = () => ({maxStepsByUnit: {unit_a: 3, unit_a2: 1, unit_b: 1},blockedCells:[]});
const command = (unitId, path, other={}) => ({type:'move_synthetic_unit',actor:'A',expectedRevision:3,unitId,path,...other});
const dest = (col,row) => ({col,row});
const refusal=(c,reason,state=source(),rules=policy())=>assert.deepEqual(move(state,c,rules),{accepted:false,reason});

test('adjacent movement updates only the selected unit and increments revision',()=>{
 const initial=source(); const result=move(initial,command('unit_a',[dest(4,4)]),policy());
 assert.equal(result.accepted,true);
 assert.equal(result.nextState.phaseState.revision,4);
 assert.equal(result.nextState.phaseState.phase,'MOVEMENT');
 assert.deepEqual(result.nextState.board[0],{id:'unit_a',side:'A',col:4,row:4});
 assert.deepEqual(result.nextState.board.slice(1),initial.board.slice(1));
 assert.deepEqual(result.nextState.movedUnitIds,['unit_a']);
 assert.deepEqual(result.events,[{type:'UNIT_MOVED_SIMULATED',sequence:4,side:'A',unitId:'unit_a',
  from:dest(3,4),to:dest(4,4),path:[dest(4,4)]}]);
});

test('multiple adjacent steps are valid if all cells clear and within max steps',()=>{
 const steps=[dest(4,4),dest(4,5),dest(5,5)];
 const r=move(source(),command('unit_a',steps),policy());
 assert.equal(r.accepted,true);assert.deepEqual(r.nextState.board[0],{id:'unit_a',side:'A',col:5,row:5});
});

test('rejects jumping non-adjacent hexes even when destination is close enough',()=>{
 refusal(command('unit_a',[dest(5,5)]),'NON_ADJACENT_STEP');
});

test('rejects occupied intermediate and final cells, regardless of side',()=>{
 refusal(command('unit_a',[dest(4,4),dest(5,4)]),'MOVEMENT_BLOCKED');
 const s=source();s.board[2]={id:'unit_b',side:'B',col:4,row:4};
 refusal(command('unit_a',[dest(4,4)]),'MOVEMENT_BLOCKED',s);
});

test('rejects blocked terrain as both a waypoint and a destination',()=>{
 const p=policy();p.blockedCells=[dest(4,4)];
 refusal(command('unit_a',[dest(4,4)]),'MOVEMENT_BLOCKED',source(),p);
 refusal(command('unit_a',[dest(4,4),dest(4,5)]),'MOVEMENT_BLOCKED',source(),p);
});

test('rejects unit-specific movement limits and unconfigured units',()=>{
 refusal(command('unit_a2',[dest(8,4),dest(8,5)]),'MOVEMENT_LIMIT_EXCEEDED');
 const p=policy();delete p.maxStepsByUnit.unit_a;
 refusal(command('unit_a',[dest(4,4)]),'MOVEMENT_POLICY_UNAVAILABLE',source(),p);
});

test('rejects enemy, unordered, missing and previously moved units without leaks',()=>{
 for(const id of ['unit_b','unit_missing'])
   refusal(command(id,[dest(4,4)]),'UNIT_NOT_ELIGIBLE');
 const s=source();s.phaseState.orderedUnits=['unit_a2'];
 refusal(command('unit_a',[dest(4,4)]),'UNIT_NOT_ELIGIBLE',s);
 s.phaseState.orderedUnits=['unit_a','unit_a2'];s.movedUnitIds=['unit_a'];
 refusal(command('unit_a',[dest(4,4)]),'UNIT_NOT_ELIGIBLE',s);
});

test('rejects path cycles, including return to start',()=>{
 refusal(command('unit_a',[dest(4,4),dest(3,4)]),'REPEATED_HEX');
});

test('rejects out-of-board path cells and fractional or malformed coordinates',()=>{
 for(const path of [[dest(13,1)],[dest(4,-1)],[dest(3.5,4)],[{col:4}],null,[],[null]])
  refusal(command('unit_a',path),'INVALID_MOVE_COMMAND');
});

test('rejects wrong phase, active side and stale revision before movement decisions',()=>{
 refusal(command('unit_a',[dest(4,4)],{expectedRevision:2}),'STALE_REVISION');
 refusal(command('unit_a',[dest(4,4)],{actor:'B'}),'NOT_ACTING_PLAYER');
 const s=source();s.phaseState.phase='COMBAT';
 refusal(command('unit_a',[dest(4,4)]),'WRONG_PHASE',s);
 s.phaseState.phase='MOVEMENT';s.phaseState.pendingDecision={actor:'B'};
 refusal(command('unit_a',[dest(4,4)]),'WRONG_PHASE',s);
});

test('rejects invalid command types, bogus actors, excessive paths and IDs',()=>{
 refusal(command('unit_a',[dest(4,4)],{type:'invent'}),'INVALID_MOVE_COMMAND');
 refusal(command('unit_a',[dest(4,4)],{actor:'X'}),'INVALID_MOVE_COMMAND');
 refusal(command('bad id',[dest(4,4)]),'INVALID_MOVE_COMMAND');
 refusal(command('unit_a',Array(33).fill(dest(4,4))),'INVALID_MOVE_COMMAND');
 refusal(null,'INVALID_MOVE_COMMAND');
});

test('rejects corrupt server-owned state rather than silently permitting movement',()=>{
 for(const malformed of [
   {...source(),board:[{...source().board[0],col:13}]},
   {...source(),board:[source().board[0],source().board[0]]},
   {...source(),board:[source().board[0],{...source().board[1],col:3,row:4}]},
   {...source(),movedUnitIds:['unit_ghost']},
   {...source(),phaseState:{...source().phaseState,orderedUnits:['unit_a','unit_a']}}
 ]) assert.throws(()=>move(malformed,command('unit_a',[dest(4,4)]),policy()),/INVALID_SERVER_MOVEMENT_/);
});

test('rejects invalid server policies and ambiguous blocked cells',()=>{
 for(const corrupt of [
   {...policy(),blockedCells:[dest(4,4),dest(4,4)]},
   {...policy(),blockedCells:[dest(13,4)]},
   {...policy(),maxStepsByUnit:{...policy().maxStepsByUnit,unknown:2}},
   {...policy(),maxStepsByUnit:{...policy().maxStepsByUnit,unit_a:-1}},
   {...policy(),blockedCells:null}
 ]) assert.throws(()=>move(source(),command('unit_a',[dest(4,4)]),corrupt),/INVALID_SERVER_MOVEMENT_POLICY/);
});

test('rejected movement has no side effects; accepted output is independent',()=>{
 const s=source(),p=policy(),c=command('unit_a',[dest(4,4)]);
 const copy=structuredClone([s,p,c]);
 refusal(command('unit_a',[dest(4,4),dest(5,4)]),'MOVEMENT_BLOCKED',s,p);
 const r=move(s,c,p);
 r.nextState.board[0].col=12;r.events[0].path[0].col=12;
 assert.deepEqual([s,p,c],copy);
});

test('a second unit can move in the updated state without moving the first twice',()=>{
 const one=move(source(),command('unit_a',[dest(4,4)]),policy());
 const two=move(one.nextState,command('unit_a2',[dest(8,4)],{expectedRevision:4}),policy());
 assert.equal(two.accepted,true);
 assert.deepEqual(two.nextState.movedUnitIds,['unit_a','unit_a2']);
 assert.equal(two.nextState.phaseState.revision,5);
 refusal(command('unit_a',[dest(5,5)],{expectedRevision:5}),'UNIT_NOT_ELIGIBLE',two.nextState);
});


test('odd-q edge geometry: movement at board edge follows genuine hex neighbors',()=>{
 const s=source();s.board[0].col=0;s.board[0].row=0;
 const p=policy();p.blockedCells=[];
 const ok=move(s,command('unit_a',[dest(1,0)]),p);
 assert.equal(ok.accepted,true);
 refusal(command('unit_a',[dest(1,1)]),'NON_ADJACENT_STEP',s,p);
});

test('policy must own the unit movement range and revision must not overflow',()=>{
 const p=policy();p.maxStepsByUnit=Object.create({unit_a:3});
 p.maxStepsByUnit.unit_a2=1;p.maxStepsByUnit.unit_b=1;
 refusal(command('unit_a',[dest(4,4)]),'MOVEMENT_POLICY_UNAVAILABLE',source(),p);
 const s=source();s.phaseState.revision=Number.MAX_SAFE_INTEGER;
 assert.throws(()=>move(s,command('unit_a',[dest(4,4)]),policy()),/INVALID_SERVER_MOVEMENT_STATE/);
});
