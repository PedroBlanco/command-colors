import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeSectionHistoryLab as initialize,
  applySectionHistoryLabCommand as dispatch} from './section-history-journal.mjs';
import {CLEAR_LAB_POLICY,reduceOneHexClearLab as reduce} from './clear-lab-movement-reducer.mjs';

const at=(col,row)=>({col,row});
const action=(id,col,row)=>({kind:'UNIT',id,path:[at(col,row)]});
const context=()=>({unitTypes:{
  unitA:'LIGHT_INFANTRY',reserve:'HEAVY_INFANTRY',enemy:'HEAVY_INFANTRY'
},terrain:[]});
const policy=()=>({scope:CLEAR_LAB_POLICY});
function ready(){
  const init=initialize({
    cardInstances:[
      {instanceId:'card_a_left',definitionId:'ORDER_3_LEFT'},
      {instanceId:'card_b_left',definitionId:'ORDER_2_LEFT'},
      {instanceId:'card_c_left',definitionId:'ORDER_4_LEFT'},
      {instanceId:'card_d_left',definitionId:'ORDER_2_LEFT'}
    ],
    handSizes:{A:2,B:1},startingSide:'A',randomIndex:()=>0,
    board:{units:[
      {id:'unitA',side:'A',col:2,row:4},
      {id:'reserve',side:'A',col:2,row:6},
      {id:'enemy',side:'B',col:10,row:4}
    ],leaders:[]},
    sectorCells:{'2,4':['LEFT'],'2,6':['LEFT'],'10,4':['RIGHT']}
  });
  const card=dispatch(init,{type:'PLAY_SECTION_CARD',actor:'A',
    expectedRevision:0,cardInstanceId:init.hands.A[0].instanceId});
  assert.equal(card.accepted,true);
  const assigned=dispatch(card.nextState,{type:'ASSIGN_SECTION_ORDERS',actor:'A',
    expectedRevision:1,unitIds:['unitA','reserve'],leaderIds:[]});
  assert.equal(assigned.accepted,true);
  return assigned.nextState;
}
const preview=(actions=[action('unitA',3,4)],changes={})=>{
  const state=ready();
  return reduce({state,actor:'A',expectedRevision:state.revision,
    actions,serverContext:context(),policy:policy(),...changes});
};

test('one adjacent clear-ground unit move produces a frozen laboratory board only',()=>{
  const state=ready(),before=structuredClone(state);
  const r=reduce({state,actor:'A',expectedRevision:2,
    actions:[action('unitA',3,4)],serverContext:context(),policy:policy()});
  assert.equal(r.status,'LAB_REDUCTION_CANDIDATE');
  assert.equal(r.moveCount,1);
  assert.equal(r.simulatedBoard.units.find(x=>x.id==='unitA').col,3);
  assert.equal(r.simulatedBoard.units.find(x=>x.id==='reserve').col,2);
  assert.deepEqual(r.moves,[{unitId:'unitA',from:at(2,4),to:at(3,4)}]);
  assert.equal(r.canCommit,false);
  assert.equal(r.officialMovementAuthorized,false);
  assert.equal(r.movementAuthorized,false);
  assert.equal(r.attackAuthorized,false);
  assert.equal(r.stateChanged,false);
  assert.equal(r.needsFullLegalityCheck,true);
  assert.equal(r.labSimulationOnly,true);
  assert.deepEqual(state,before);
  for(const x of [r,r.simulatedBoard,r.simulatedBoard.units,
    r.simulatedBoard.units[0],r.moves,r.moves[0],r.moves[0].to])
    assert.equal(Object.isFrozen(x),true);
});

test('two ordered infantry units move sequentially into empty adjacent hexes',()=>{
  const result=preview([action('unitA',3,4),action('reserve',3,6)]);
  assert.equal(result.status,'LAB_REDUCTION_CANDIDATE');
  assert.equal(result.moveCount,2);
  assert.deepEqual(result.moves.map(x=>x.unitId),['unitA','reserve']);
  assert.deepEqual(result.simulatedBoard.units.map(x=>at(x.col,x.row)),
    [at(3,4),at(3,6),at(10,4)]);
});

test('missing or forged trusted laboratory policy never produces movement',()=>{
  for(const p of [undefined,null,{}, {scope:'REAL_GAME'},
    {scope:CLEAR_LAB_POLICY,authorized:true},
    {scope:CLEAR_LAB_POLICY,scenarioId:'unverified'}]){
    const r=preview(undefined,{policy:p});
    assert.equal(r.status,'BLOCKED');
    assert.equal(r.reason,'NOT_IN_CLEAR_LAB_SCOPE');
    assert.equal(r.simulatedBoard,null);
    assert.equal(r.canCommit,false);
  }
});

test('only trusted empty terrain is supported: forest, hill and missing map blocked',()=>{
  for(const terrain of [undefined,null,
    [{col:3,row:4,kind:'HILL'}],
    [{col:10,row:8,kind:'FOREST'}]]){
    const r=preview(undefined,{serverContext:{...context(),terrain}});
    assert.equal(r.reason,'TERRAIN_NOT_IN_CLEAR_LAB_SCOPE');
    assert.equal(r.moves,null);
  }
});

test('leaders and attached leaders are excluded entirely from safe lab scope',()=>{
  const state=ready();
  state.board.leaders.push({id:'leaderA',side:'A',col:2,row:4});
  const result=preview(undefined,{state});
  assert.equal(result.reason,'LEADERS_NOT_IN_CLEAR_LAB_SCOPE');
  assert.equal(result.simulatedBoard,null);
});

test('server roster must match all units and supported infantry types exactly',()=>{
  for(const map of [
    {unitA:'LIGHT_INFANTRY',reserve:'HEAVY_INFANTRY'},
    {...context().unitTypes,extra:'LIGHT_INFANTRY'},
    {...context().unitTypes,unitA:'ELEPHANT'},
    {...context().unitTypes,unitA:'IMAGINARY'},
    {...context().unitTypes,unitA:null}
  ]){
    const r=preview(undefined,{serverContext:{unitTypes:map,terrain:[]}});
    assert.equal(r.reason,'UNSUPPORTED_CLEAR_LAB_UNIT');
    assert.equal(r.simulatedBoard,null);
  }
});

test('multi-hex, leader, empty and unrecognized actions are blocked',()=>{
  for(const actions of [
    [], [{kind:'LEADER',id:'unitA',path:[at(3,4)]}],
    [{kind:'UNIT',id:'unitA',path:[at(3,4),at(4,4)]}],
    [{...action('unitA',3,4),actor:'B'}]
  ]){
    const r=preview(actions);
    assert.equal(r.reason,'ONLY_ONE_HEX_UNIT_MOVES_SUPPORTED');
  }
});

test('unissued, enemy, repeated or nonadjacent movements are never reduced',()=>{
  for(const actions of [
    [action('enemy',10,5)],
    [action('ghost',3,4)],
    [action('unitA',3,4),action('unitA',4,4)],
    [action('unitA',4,4)]
  ]){
    const r=preview(actions);
    assert.equal(r.status,'BLOCKED');
    assert.equal(r.simulatedBoard,null);
    assert.equal(r.stateChanged,false);
  }
});

test('stale revision, wrong actor or inactive staged order never produce board',()=>{
  const state=ready();
  for(const changes of [
    {expectedRevision:1},
    {actor:'B'},
    {actor:'unknown'}
  ]){
    const r=preview(undefined,{state,...changes});
    assert.equal(r.status,'BLOCKED');
    assert.equal(r.moves,null);
  }
  const ended=dispatch(state,{type:'END_EXPERIMENTAL_TURN',actor:'A',
    expectedRevision:2});
  assert.equal(ended.accepted,true);
  assert.equal(preview(undefined,{state:ended.nextState,
    actor:'B',expectedRevision:3}).status,'BLOCKED');
});

test('denied second action leaves no partially reduced board or step list',()=>{
  const state=ready(),before=structuredClone(state);
  const r=preview([action('unitA',3,4),action('reserve',3,4)],{state});
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.simulatedBoard,null);
  assert.equal(r.moves,null);
  assert.deepEqual(state,before);
});

test('repeated independent simulations are deterministic and no original state is mutated',()=>{
  const state=ready(),before=structuredClone(state);
  const options={state,actor:'A',expectedRevision:2,
    actions:[action('unitA',3,4)],serverContext:context(),policy:policy()};
  const first=reduce(options),second=reduce(options);
  assert.deepEqual(first,second);
  assert.notEqual(first.simulatedBoard,state.board);
  assert.deepEqual(state,before);
  assert.equal(state.revision,2);
});
