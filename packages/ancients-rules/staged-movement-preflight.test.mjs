import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeSectionHistoryLab as init,applySectionHistoryLabCommand as apply}
  from './section-history-journal.mjs';
import {precheckStagedAncientsMovement as preview,
  precheckStagedAncientsLeaderMovement as leaderPreview} from './staged-movement-preflight.mjs';

const at=(col,row)=>({col,row});
const setup=()=>init({
  cardInstances:[
    {instanceId:'a_card_left',definitionId:'ORDER_2_LEFT'},
    {instanceId:'b_card_right',definitionId:'ORDER_2_RIGHT'},
    {instanceId:'c_card_left',definitionId:'ORDER_3_LEFT'},
    {instanceId:'d_card_right',definitionId:'ORDER_3_RIGHT'},
    {instanceId:'e_card_left',definitionId:'ORDER_4_LEFT'},
    {instanceId:'f_card_right',definitionId:'ORDER_4_RIGHT'}],
  handSizes:{A:2,B:2},startingSide:'A',randomIndex:()=>0,
  board:{units:[{id:'unitA',side:'A',col:2,row:4},{id:'unitB',side:'B',col:10,row:4}],
    leaders:[]},
  sectorCells:{'2,4':['LEFT'],'10,4':['RIGHT']}
});
const context=()=>({unitTypes:{unitA:'LIGHT_INFANTRY',unitB:'HEAVY_INFANTRY'},terrain:[]});
const command=(type,revision,extra={})=>({type,actor:'A',expectedRevision:revision,...extra});
const ready=()=>{
  const initial=setup();
  const card=initial.hands.A[0].instanceId;
  const played=apply(initial,command('PLAY_SECTION_CARD',0,{cardInstanceId:card}));
  assert.equal(played.accepted,true);
  const ordered=apply(played.nextState,command('ASSIGN_SECTION_ORDERS',1,{
    unitIds:['unitA'],leaderIds:[]
  }));
  assert.equal(ordered.accepted,true);
  return {initial,played:played.nextState,state:ordered.nextState};
};
const check=(state,options={})=>preview({
  state,actor:'A',expectedRevision:state.revision,unitId:'unitA',
  path:[at(3,4)],serverContext:context(),...options
});

test('staged, correctly ordered adjacent movement is only a candidate',()=>{
  const {state}=ready();
  const original=structuredClone(state);
  const result=check(state);
  assert.equal(result.status,'CANDIDATE');
  assert.equal(result.movementAuthorized,false);
  assert.equal(result.attackAuthorized,false);
  assert.equal(result.needsFullLegalityCheck,true);
  assert.equal(result.stateChanged,false);
  assert.deepEqual(state,original);
  assert.equal(Object.isFrozen(result),true);
});

test('must play a card and stage its orders before any movement screening',()=>{
  const {initial,played}=ready();
  assert.equal(check(initial).reason,'ORDERS_NOT_STAGED');
  assert.equal(check(played).reason,'ORDERS_NOT_STAGED');
});

test('do not reveal whether requested unit is enemy, absent or simply unordered',()=>{
  const {state}=ready();
  for(const unitId of ['unitB','missingUnit','__proto__','']) {
    const denied=check(state,{unitId});
    assert.equal(denied.status,'BLOCKED');
    assert.equal(denied.reason,'UNIT_NOT_ORDERED');
    assert.equal(denied.movementAuthorized,false);
  }
});

test('actor, turn and revision are checked before screening',()=>{
  const {state}=ready();
  assert.equal(check(state,{actor:'B'}).reason,'NOT_ACTING_PLAYER');
  assert.equal(check(state,{actor:'invalid'}).reason,'FORBIDDEN');
  assert.equal(check(state,{expectedRevision:state.revision-1}).reason,'STALE_REVISION');
  assert.throws(()=>check(state,{expectedRevision:'2'}),/INVALID_STAGED_MOVEMENT_REVISION/);
});

test('missing or forged server profiles cannot create a movement candidate',()=>{
  const {state}=ready();
  for(const serverContext of [undefined,{}, {unitTypes:{unitA:'LIGHT_INFANTRY'},terrain:[]},
    {unitTypes:{unitA:'TELEPORTER',unitB:'HEAVY_INFANTRY'},terrain:[]},
    {unitTypes:{unitA:'LIGHT_INFANTRY',unitB:'HEAVY_INFANTRY',extra:'LIGHT_CAVALRY'},terrain:[]},
    {unitTypes:{unitA:'LIGHT_INFANTRY',unitB:'HEAVY_INFANTRY'}}])
    assert.throws(()=>check(state,{serverContext}),/INVALID_STAGED_MOVEMENT_CONTEXT/);
});

test('nonadjacent, repeated, occupied and excessive paths are never accepted',()=>{
  const {state}=ready();
  assert.equal(check(state,{path:[at(4,4)]}).reason,'NON_ADJACENT_HEX');
  assert.equal(check(state,{path:[at(3,4),at(2,4)]}).reason,'REPEATED_HEX');
  assert.equal(check(state,{path:[at(3,4),at(4,4),at(5,4)]}).status,'REQUIRES_RULE_EXCEPTION');
  assert.equal(check(state,{path:[at(10,4)]}).status,'BLOCKED');
});

test('server-owned terrain restrictions are applied to ordered movement',()=>{
  const {state}=ready();
  const result=check(state,{serverContext:{
    ...context(),terrain:[{col:3,row:4,kind:'FOREST'}]
  }});
  assert.equal(result.status,'CANDIDATE');
  assert.equal(result.terrain.destinationTerrain,'FOREST');
  assert.equal(result.movementAuthorized,false);
  assert.throws(()=>check(state,{serverContext:{...context(),terrain:[{col:3,row:4,kind:'VOLCANO'}]}}),
    /INVALID_BASE_TERRAIN_MAP/);
});

test('a forged order snapshot whose location differs from board cannot allow screening',()=>{
  const {state}=ready(),modified=structuredClone(state);
  modified.orderSnapshot.pieces[0].col+=1;
  assert.equal(check(modified).reason,'UNIT_NOT_ORDERED');
});

test('ended experimental turn clears staged authority to screen movement',()=>{
  const {state}=ready();
  const ended=apply(state,command('END_EXPERIMENTAL_TURN',2));
  assert.equal(ended.accepted,true);
  assert.equal(check(ended.nextState,{actor:'A'}).reason,'NOT_ACTING_PLAYER');
  assert.equal(check(ended.nextState,{actor:'B'}).reason,'ORDERS_NOT_STAGED');
});

test('invalid geometry returns a validation error but never modifies state',()=>{
  const {state}=ready(),before=structuredClone(state);
  assert.throws(()=>check(state,{path:[at(-1,4)]}),/INVALID_BASE_PATH/);
  assert.deepEqual(state,before);
});


function readyLeader() {
  const initial=init({
    cardInstances:[
      {instanceId:'a_left',definitionId:'ORDER_2_LEFT'},
      {instanceId:'b_left',definitionId:'ORDER_3_LEFT'},
      {instanceId:'c_left',definitionId:'ORDER_4_LEFT'},
      {instanceId:'d_left',definitionId:'ORDER_2_LEFT'}],
    handSizes:{A:2,B:1},startingSide:'A',randomIndex:()=>0,
    board:{
      units:[{id:'unitA',side:'A',col:2,row:4},
        {id:'unitB',side:'B',col:10,row:4}],
      leaders:[{id:'leaderA',side:'A',col:2,row:4},
        {id:'leaderB',side:'B',col:10,row:4}]
    },
    sectorCells:{'2,4':['LEFT'],'10,4':['RIGHT']}
  });
  const played=apply(initial,{actor:'A',type:'PLAY_SECTION_CARD',
    expectedRevision:0,cardInstanceId:initial.hands.A[0].instanceId});
  assert.equal(played.accepted,true);
  const ordered=apply(played.nextState,{actor:'A',type:'ASSIGN_SECTION_ORDERS',
    expectedRevision:1,unitIds:[],leaderIds:['leaderA']});
  assert.equal(ordered.accepted,true);
  return {initial,played:played.nextState,state:ordered.nextState};
}
const checkLeader=(state,options={})=>leaderPreview({
  state,actor:'A',expectedRevision:state.revision,leaderId:'leaderA',
  path:[at(2,5)],serverContext:{terrain:[]},...options
});

test('ordered leader path is only a private, read-only candidate',()=>{
  const {state}=readyLeader(),before=structuredClone(state);
  const result=checkLeader(state);
  assert.equal(result.status,'CANDIDATE');
  assert.equal(result.detachesFromUnit,true);
  assert.equal(result.movementAuthorized,false);
  assert.equal(result.attackAuthorized,false);
  assert.equal(result.stateChanged,false);
  assert.equal(result.needsFullLegalityCheck,true);
  assert.deepEqual(state,before);
});

test('leader without a staged order, incorrect turn or revision is denied',()=>{
  const {initial,played,state}=readyLeader();
  assert.equal(checkLeader(initial).reason,'ORDERS_NOT_STAGED');
  assert.equal(checkLeader(played).reason,'ORDERS_NOT_STAGED');
  assert.equal(checkLeader(state,{actor:'B'}).reason,'NOT_ACTING_PLAYER');
  assert.equal(checkLeader(state,{actor:'unknown'}).reason,'FORBIDDEN');
  assert.equal(checkLeader(state,{expectedRevision:1}).reason,'STALE_REVISION');
  assert.throws(()=>checkLeader(state,{expectedRevision:'2'}),/INVALID_STAGED_LEADER_REVISION/);
});

test('foreign, fabricated and unstaged leader IDs return the same denial',()=>{
  const {state}=readyLeader();
  for(const leaderId of ['leaderB','ghost','__proto__',''])
    assert.equal(checkLeader(state,{leaderId}).reason,'LEADER_NOT_ORDERED');
  const forged=structuredClone(state);
  forged.orderSnapshot.pieces[0].col=3;
  assert.equal(checkLeader(forged).reason,'LEADER_NOT_ORDERED');
});

test('trusted terrain cannot be omitted; leader preview does not mutate board',()=>{
  const {state}=readyLeader(),before=structuredClone(state);
  for(const serverContext of [undefined,{}, {terrain:[{col:2,row:5,kind:'MARSH'}]}])
    assert.throws(()=>checkLeader(state,{serverContext}),/INVALID_STAGED_LEADER_CONTEXT|INVALID_LEADER_TERRAIN_MAP/);
  assert.equal(checkLeader(state,{path:[at(2,6)]}).reason,'NON_ADJACENT_HEX');
  assert.equal(checkLeader(state,{path:[at(2,5),at(2,6),at(2,7),at(2,8)]})
    .reason,'LEADER_RANGE_EXCEEDED');
  assert.deepEqual(state,before);
});

test('end of experimental turn removes authority for prior leader order',()=>{
  const {state}=readyLeader();
  const ended=apply(state,{actor:'A',type:'END_EXPERIMENTAL_TURN',expectedRevision:2});
  assert.equal(ended.accepted,true);
  assert.equal(checkLeader(ended.nextState,{actor:'B'}).reason,'ORDERS_NOT_STAGED');
});
