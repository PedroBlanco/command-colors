import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE_MOVEMENT_PROFILES,ANCIENTS_RULESET}
  from './movement-profile.mjs';
import {ANCIENTS_MOVEMENT_REGIMES,
  assessAncientsMovementRegime as regime,
  assessOpenHexStepGeometry as geometry}
  from './movement-regimes.mjs';
import {CORE_OPEN_FOOT_KIND,CORE_OPEN_FOOT_POLICY,
  reduceCoreOpenFootStep as reduce,replayCoreOpenFootSteps as replay}
  from './core-open-foot-movement.mjs';

const foot=[
  'LIGHT_INFANTRY','LIGHT_SLING_INFANTRY','LIGHT_BOW_INFANTRY',
  'AUXILIA_INFANTRY','MEDIUM_INFANTRY','HEAVY_INFANTRY'
];
const specials=[
  'WARRIOR_INFANTRY','HEAVY_WAR_MACHINE',
  'LIGHT_CAVALRY','MEDIUM_CAVALRY','HEAVY_CAVALRY',
  'ELEPHANT','HEAVY_CHARIOT'
];
const cell=(col,row)=>({col,row});
const occupied=()=>[
  {id:'u',side:'A',col:2,row:4},
  {id:'v',side:'B',col:10,row:4}
];
const geo=(to=cell(3,4),from=cell(2,4),units=occupied())=>
  geometry({from,to,occupiedCells:units});
const board=()=>({
  kind:CORE_OPEN_FOOT_KIND,schemaVersion:1,ruleset:ANCIENTS_RULESET,
  revision:2,turn:'A',phase:'MOVE',
  board:{units:occupied(),leaders:[]},
  orderLedger:{issuedUnitIds:['u'],movedUnitIds:[]}
});
const policy=(type='LIGHT_INFANTRY')=>({
  scope:CORE_OPEN_FOOT_POLICY,ruleset:ANCIENTS_RULESET,
  cardFamily:'ORDINARY_SECTION',terrain:[],scenarioExceptions:[],
  unitTypes:{u:type,v:'HEAVY_INFANTRY'}
});
const action=(to=cell(3,4),expectedRevision=2)=>({
  actor:'A',expectedRevision,unitId:'u',to
});
const step=(type='LIGHT_INFANTRY',to=cell(3,4))=>
  reduce({state:board(),policy:policy(type),action:action(to)});

test('movement regimes: all thirteen base profiles have exactly one named regime',()=>{
  assert.deepEqual(Object.keys(ANCIENTS_MOVEMENT_REGIMES).sort(),
    Object.keys(BASE_MOVEMENT_PROFILES).sort());
  assert.equal(Object.isFrozen(ANCIENTS_MOVEMENT_REGIMES),true);
});

test('movement regimes: all six ordinary foot types share one geometry and policy regime',()=>{
  for(const unitType of foot){
    const result=regime({unitType,steps:1});
    assert.equal(result.status,'SUBSET_ELIGIBLE',unitType);
    assert.equal(result.regime,'ORDINARY_FOOT');
    assert.equal(result.profileStatus,'WITHIN_PROFILE');
    assert.equal(result.ruleset,ANCIENTS_RULESET);
    assert.equal(result.movementAuthorized,false);
    assert.equal(result.canCommit,false);
  }
});

test('movement regimes: type allowances are read from existing base profiles',()=>{
  for(const type of Object.keys(BASE_MOVEMENT_PROFILES)){
    const result=regime({unitType:type,steps:1});
    assert.equal(result.maxSteps,BASE_MOVEMENT_PROFILES[type].maxSteps);
    assert.equal(result.battleAfterSteps,
      BASE_MOVEMENT_PROFILES[type].battleAfterSteps);
    assert.equal(Object.isFrozen(result),true);
  }
});

test('movement regimes: cavalry, elephants, chariot, warriors and machines need distinct rules',()=>{
  const groups=['WARRIOR_CHARGE','WAR_MACHINE','CAVALRY','CAVALRY','CAVALRY',
    'ELEPHANT','CHARIOT'];
  specials.forEach((type,i)=>{
    const result=regime({unitType:type,steps:1});
    assert.equal(result.status,'NEEDS_EXTENDED_RULES',type);
    assert.equal(result.regime,groups[i],type);
    assert.equal(result.reason,'UNIT_REGIME_NOT_IMPLEMENTED');
    assert.equal(result.movementAuthorized,false);
  });
});

test('movement regimes: warrior charge is conditional and not auto-authorized',()=>{
  const result=regime({unitType:'WARRIOR_INFANTRY',steps:2});
  assert.equal(result.regime,'WARRIOR_CHARGE');
  assert.equal(result.status,'NEEDS_EXTENDED_RULES');
  assert.equal(result.profileStatus,'CONDITIONAL_CHARGE');
  assert.equal(result.battle,'MANDATORY_CLOSE_COMBAT');
  assert.equal(result.canCommit,false);
});

test('movement regimes: two-step light infantry still requires full path rules',()=>{
  const result=regime({unitType:'LIGHT_INFANTRY',steps:2});
  assert.equal(result.maxSteps,2);
  assert.equal(result.profileStatus,'WITHIN_PROFILE');
  assert.equal(result.status,'NEEDS_EXTENDED_RULES');
  assert.equal(result.reason,'MULTI_HEX_RULES_NOT_IMPLEMENTED');
});

test('movement regimes: profiles reject excess base distance independently',()=>{
  const result=regime({unitType:'HEAVY_INFANTRY',steps:2});
  assert.equal(result.maxSteps,1);
  assert.equal(result.profileStatus,'EXCEEDS_STANDARD_PROFILE');
  assert.equal(result.status,'NEEDS_EXTENDED_RULES');
  assert.equal(result.battle,'UNAVAILABLE');
});

test('movement regimes: missing, unknown and prototype-like unit types fail closed',()=>{
  for(const unitType of [undefined,null,'FANTASY_UNIT','__proto__',{},'']){
    const result=regime({unitType,steps:1});
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.reason,'UNKNOWN_BASE_UNIT_TYPE');
    assert.equal(result.movementAuthorized,false);
  }
});

test('movement regimes: unsupported step counts cannot pass as profiles',()=>{
  for(const steps of [0,-1,1.5,33,NaN,Infinity,'1',null]){
    const result=regime({unitType:'LIGHT_INFANTRY',steps});
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.reason,'INVALID_MOVEMENT_STEP_COUNT');
  }
  assert.equal(regime({unitType:'LIGHT_INFANTRY'}).status,'SUBSET_ELIGIBLE');
});

test('movement regimes: no extra actor, authority or scenario input enters selector',()=>{
  for(const extra of [{actor:'A'}, {canCommit:true}, {ruleset:'napoleonics'},
    {policy:{}}, {board:{}}, {steps:1.5}]){
    const result=regime({unitType:'LIGHT_INFANTRY',steps:1,...extra});
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.canCommit,false);
  }
});

test('movement regimes: selector reads descriptors without calling root getters',()=>{
  const x={unitType:'LIGHT_INFANTRY',steps:1},calls=[];
  Object.defineProperty(x,'unitType',{enumerable:true,get(){
    calls.push('GET');throw Error('UNTRUSTED_GETTER');
  }});
  assert.equal(regime(x).status,'BLOCKED');
  assert.deepEqual(calls,[]);
  const proxy=new Proxy({unitType:'LIGHT_INFANTRY',steps:1},{
    get(){throw Error('PROXY_GET')}
  });
  assert.equal(regime(proxy).status,'SUBSET_ELIGIBLE');
});

test('shared geometry: adjacent free hex is a candidate but not authorization',()=>{
  const result=geo();
  assert.equal(result.status,'CANDIDATE_GEOMETRY');
  assert.equal(result.reason,null);
  assert.equal(result.movementAuthorized,false);
  assert.equal(result.canCommit,false);
  assert.equal(result.needsFullLegalityCheck,true);
  assert.equal(Object.isFrozen(result),true);
});

test('shared geometry: coordinates are independent of unit class or ID',()=>{
  assert.equal(geo(cell(3,4),cell(2,4),[
    {id:'a',side:'B',type:'ELEPHANT',col:2,row:4}
  ]).status,'CANDIDATE_GEOMETRY');
  assert.equal(geo(cell(3,4),cell(2,4),[
    {id:'a',side:'A',type:'HEAVY_INFANTRY',col:2,row:4}
  ]).status,'CANDIDATE_GEOMETRY');
});

test('shared geometry: friendly and enemy occupied destinations are blocked identically',()=>{
  for(const side of ['A','B']){
    const result=geo(cell(3,4),cell(2,4),[
      {col:2,row:4,side:'A'},
      {col:3,row:4,side}
    ]);
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.reason,'OCCUPIED_DESTINATION');
  }
});

test('shared geometry: origin, nonadjacent cells and edge jumps fail',()=>{
  for(const destination of [cell(2,4),cell(4,4),cell(12,8)]){
    const result=geo(destination);
    assert.equal(result.reason,'NOT_ONE_ADJACENT_HEX');
  }
});

test('shared geometry: invalid board coordinates fail without exposing positions',()=>{
  for(const invalid of [cell(-1,4),cell(13,4),cell(2,-1),
    cell(3,9),{col:'3',row:4},{col:3,row:4,token:'X'}]){
    const outcome=geo(invalid);
    if(invalid.token==='X')
      assert.equal(outcome.status,'CANDIDATE_GEOMETRY');
    else assert.equal(outcome.reason,'INVALID_GEOMETRY_INPUT');
    assert.equal(JSON.stringify(outcome).includes('token'),false);
  }
});

test('shared geometry: malformed occupancy, sparse arrays and extras are rejected',()=>{
  const sparse=new Array(1);
  for(const units of [sparse,[{col:13,row:0}],[{col:2,row:4},null],
    new Array(118).fill(cell(1,1))]){
    const result=geo(cell(3,4),cell(2,4),units);
    assert.equal(result.reason,'INVALID_GEOMETRY_INPUT');
  }
});

test('shared geometry: getter in occupied coordinate cannot execute',()=>{
  const hits=[],unit={col:2,row:4};
  Object.defineProperty(unit,'col',{enumerable:true,get(){
    hits.push('GET');throw Error('HOSTILE_GETTER');
  }});
  const result=geo(cell(3,4),cell(2,4),[unit]);
  assert.equal(result.reason,'INVALID_GEOMETRY_INPUT');
  assert.deepEqual(hits,[]);
});

test('shared geometry: root and occupied-array Proxy reads are descriptor-only',()=>{
  const hits=[],base={from:cell(2,4),to:cell(3,4),
    occupiedCells:occupied()};
  const proxy=new Proxy(base,{get(){hits.push('GET');throw Error('ROOT_GET')}});
  assert.equal(geometry(proxy).status,'CANDIDATE_GEOMETRY');
  const list=new Proxy(occupied(),{
    get(){hits.push('GET');throw Error('ARRAY_GET')}
  });
  assert.equal(geometry({...base,occupiedCells:list}).status,
    'CANDIDATE_GEOMETRY');
  assert.deepEqual(hits,[]);
});

test('restricted foot reducer: old transition and denial reasons remain unchanged',()=>{
  for(const type of foot){
    assert.equal(step(type).status,'RULE_TRANSITION_CANDIDATE',type);
  }
  for(const type of specials){
    const result=step(type);
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.reason,'UNSUPPORTED_FOOT_UNIT',type);
  }
  assert.equal(step('LIGHT_INFANTRY',cell(4,4)).reason,
    'NOT_ONE_ADJACENT_HEX');
  assert.equal(step('LIGHT_INFANTRY',cell(10,4)).reason,
    'NOT_ONE_ADJACENT_HEX');
});

test('restricted foot reducer: movement replay still rejects moving one unit twice',()=>{
  const source=board(),rules=policy();
  const sequence=[
    action(cell(3,4),2),
    action(cell(4,4),3)
  ];
  const result=replay({initialState:source,policy:rules,actions:sequence});
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.reason,'UNIT_ALREADY_MOVED');
  assert.equal(result.step,1);
  assert.equal(result.nextState,null);
  assert.equal(source.board.units[0].col,2);
});
