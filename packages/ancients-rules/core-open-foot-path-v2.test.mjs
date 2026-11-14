import test from 'node:test';
import assert from 'node:assert/strict';
import {ANCIENTS_RULESET} from './movement-profile.mjs';
import {
  CORE_OPEN_FOOT_KIND,CORE_OPEN_FOOT_POLICY,
  reduceCoreOpenFootStep
} from './core-open-foot-movement.mjs';
import {
  OPEN_FOOT_PATH_CORE_KIND,OPEN_FOOT_PATH_CORE_POLICY,
  OPEN_FOOT_PATH_TRANSITION_KIND,
  reduceCoreOpenFootPath as reduce,
  replayCoreOpenFootPaths as replay
} from './core-open-foot-path-v2.mjs';

const cell=(col,row)=>({col,row});
const state=()=>({
  kind:OPEN_FOOT_PATH_CORE_KIND,schemaVersion:2,ruleset:ANCIENTS_RULESET,
  revision:2,turn:'A',phase:'MOVE',
  board:{units:[
    {id:'unitA',side:'A',col:2,row:4},
    {id:'reserve',side:'A',col:2,row:6},
    {id:'enemy',side:'B',col:10,row:4}
  ],leaders:[]},
  orderLedger:{issuedUnitIds:['unitA','reserve'],movedUnitIds:[]}
});
const policy=()=>({
  scope:OPEN_FOOT_PATH_CORE_POLICY,ruleset:ANCIENTS_RULESET,
  cardFamily:'ORDINARY_SECTION',terrain:[],scenarioExceptions:[],
  unitTypes:{unitA:'LIGHT_INFANTRY',reserve:'MEDIUM_INFANTRY',
    enemy:'HEAVY_INFANTRY'}
});
const path1=()=>[cell(3,4)];
const path2=()=>[cell(3,4),cell(4,4)];
const action=(unitId='unitA',path=path2(),override={})=>({
  actor:'A',expectedRevision:2,unitId,path,...override
});
const result=(override={})=>{
  const {state:starting=state(),policy:rules=policy(),action:command=action()}=override;
  return reduce({state:starting,policy:rules,action:command});
};
const fail=(r,reason,step=null)=>{
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.reason,reason);
  assert.equal(r.step,step);
  assert.equal(r.nextState,null);
  assert.equal(r.transition,null);
  assert.equal(r.canCommit,false);
  assert.equal(r.officialMovementAuthorized,false);
  assert.equal(r.dbChanged,false);
};
const success=r=>{
  assert.equal(r.status,'RULE_PATH_TRANSITION_CANDIDATE',r.reason);
  assert.equal(r.officialMovementAuthorized,false);
  assert.equal(r.movementAuthorized,false);
  assert.equal(r.canCommit,false);
  assert.equal(r.dbChanged,false);
  assert.equal(r.needsServerTransaction,true);
  assert.equal(r.attackAuthorized,false);
};
test('V2 path: two connected light infantry hexes increment exactly one revision',()=>{
  const original=state(),before=structuredClone(original);
  const r=reduce({state:original,policy:policy(),action:action()});
  success(r);
  assert.equal(r.nextState.kind,OPEN_FOOT_PATH_CORE_KIND);
  assert.equal(r.nextState.schemaVersion,2);
  assert.equal(r.nextState.revision,3);
  assert.deepEqual(r.nextState.board.units[0],{
    id:'unitA',side:'A',col:4,row:4
  });
  assert.deepEqual(r.nextState.orderLedger.issuedUnitIds,['unitA','reserve']);
  assert.deepEqual(r.nextState.orderLedger.movedUnitIds,['unitA']);
  assert.deepEqual(r.transition,{
    kind:OPEN_FOOT_PATH_TRANSITION_KIND,side:'A',revision:3,
    unitId:'unitA',from:cell(2,4),to:cell(4,4),
    path:path2(),steps:2,battleAfterMovement:'POSSIBLE'
  });
  assert.deepEqual(original,before);
});
test('V2 path: all ordinary infantry types retain one-step support',()=>{
  for(const type of ['LIGHT_INFANTRY','LIGHT_SLING_INFANTRY',
    'LIGHT_BOW_INFANTRY','AUXILIA_INFANTRY',
    'MEDIUM_INFANTRY','HEAVY_INFANTRY']){
    const rules=policy();rules.unitTypes.unitA=type;
    const r=result({policy:rules,action:action('unitA',path1())});
    success(r);
    assert.equal(r.transition.steps,1);
    assert.equal(r.transition.battleAfterMovement,'POSSIBLE');
    assert.deepEqual(r.transition.to,cell(3,4));
  }
});
test('V2 path: lightweight archers and slingers move two steps without losing profile battle',()=>{
  for(const type of ['LIGHT_INFANTRY','LIGHT_SLING_INFANTRY',
    'LIGHT_BOW_INFANTRY']){
    const rules=policy();rules.unitTypes.unitA=type;
    const r=result({policy:rules});
    success(r);
    assert.equal(r.transition.battleAfterMovement,'POSSIBLE');
    assert.equal(r.nextState.revision,3);
  }
});
test('V2 path: auxilia can move two hexes but cannot battle afterwards',()=>{
  const rules=policy();rules.unitTypes.unitA='AUXILIA_INFANTRY';
  const a=result({policy:rules,action:action('unitA',path1())});
  const b=result({policy:rules});
  success(a);success(b);
  assert.equal(a.transition.battleAfterMovement,'POSSIBLE');
  assert.equal(b.transition.battleAfterMovement,'UNAVAILABLE');
  assert.equal(b.nextState.revision,3);
});
test('V2 path: medium and heavy infantry cannot exceed one step',()=>{
  for(const type of ['MEDIUM_INFANTRY','HEAVY_INFANTRY']){
    const rules=policy();rules.unitTypes.unitA=type;
    success(result({policy:rules,action:action('unitA',path1())}));
    fail(result({policy:rules}),'STANDARD_FOOT_MOVEMENT_EXCEEDED');
  }
});
test('V2 path: profiles reject a three-hex detour even if endpoint is nearby',()=>{
  const route=[cell(3,4),cell(4,4),cell(3,5)];
  fail(result({action:action('unitA',route)}),'STANDARD_FOOT_MOVEMENT_EXCEEDED');
});
test('V2 path: destination may turn; intermediate cells are checked',()=>{
  const route=[cell(3,4),cell(2,5)];
  const r=result({action:action('unitA',route)});
  success(r);
  assert.deepEqual(r.transition.path,route);
  assert.deepEqual(r.transition.to,cell(2,5));
});
test('V2 path: obstacle on first hex fails without partial state',()=>{
  const starting=state();
  starting.board.units[2].col=3;starting.board.units[2].row=4;
  fail(result({state:starting}),'OCCUPIED_DESTINATION');
  assert.equal(starting.board.units[0].col,2);
});
test('V2 path: obstacle on second hex reports the failing path index',()=>{
  const starting=state();
  starting.board.units[2].col=4;starting.board.units[2].row=4;
  fail(result({state:starting}),'OCCUPIED_DESTINATION',1);
});
test('V2 path: nonadjacent second edge is a total failure',()=>{
  fail(result({action:action('unitA',[cell(3,4),cell(7,4)])}),
    'NOT_ONE_ADJACENT_HEX',1);
});
test('V2 path: return to origin and later revisits cannot be proposed',()=>{
  fail(result({action:action('unitA',[cell(3,4),cell(2,4)])}),
    'REPEATED_HEX',1);
  fail(result({action:action('unitA',[cell(3,4),cell(4,4),cell(3,4)])}),
    'REPEATED_HEX',2);
});
test('V2 path: unit not in issued orders cannot move',()=>{
  const starting=state();starting.orderLedger.issuedUnitIds=['reserve'];
  fail(result({state:starting}),'UNIT_NOT_ORDERED');
  fail(result({action:action('enemy',[cell(9,4)])}),'UNIT_NOT_ORDERED');
  fail(result({action:action('ghost',path1())}),'UNIT_NOT_ORDERED');
});
test('V2 path: wrong actor and stale revision are rejected before path evaluation',()=>{
  fail(result({action:action('unitA',path2(),{actor:'B'})}),'NOT_ACTING_PLAYER');
  fail(result({action:action('unitA',path2(),{expectedRevision:1})}),
    'STALE_REVISION');
});
test('V2 path: only one movement per unit despite multihex trajectory',()=>{
  const first=result();success(first);
  fail(reduce({
    state:first.nextState,policy:policy(),
    action:action('unitA',path1(),{expectedRevision:3})
  }),'UNIT_ALREADY_MOVED');
});
test('V2 path: a different ordered unit can move at the next revision',()=>{
  const first=result();success(first);
  const second=reduce({
    state:first.nextState,policy:policy(),
    action:action('reserve',[cell(3,6)],{expectedRevision:3})
  });
  success(second);
  assert.equal(second.nextState.revision,4);
  assert.deepEqual(second.nextState.orderLedger.movedUnitIds,['unitA','reserve']);
  assert.deepEqual(second.nextState.board.units.map(u=>cell(u.col,u.row)),
    [cell(4,4),cell(3,6),cell(10,4)]);
});
test('V2 replay: two different ordered units give deterministic complete results',()=>{
  const original=state(),before=structuredClone(original);
  const sequence=[action(),action('reserve',[cell(3,6)],{expectedRevision:3})];
  const a=replay({initialState:original,policy:policy(),actions:sequence});
  const b=replay({initialState:original,policy:policy(),actions:sequence});
  assert.equal(a.status,'RULE_PATH_REPLAY_CANDIDATE');
  assert.equal(a.nextState.revision,4);
  assert.deepEqual(a.transitions.map(t=>t.steps),[2,1]);
  assert.deepEqual(a.transitions.map(t=>t.revision),[3,4]);
  assert.deepEqual(a.nextState.orderLedger.movedUnitIds,['unitA','reserve']);
  assert.equal(Object.isFrozen(a),true);
  assert.equal(Object.isFrozen(a.transitions),true);
  assert.equal(Object.isFrozen(a.nextState),true);
  assert.deepEqual(a,b);
  assert.deepEqual(original,before);
});
test('V2 replay: a second move by the same unit rejects entire replay',()=>{
  const actions=[action(),action('unitA',[cell(5,4)],{expectedRevision:3})];
  const r=replay({initialState:state(),policy:policy(),actions});
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.reason,'UNIT_ALREADY_MOVED');
  assert.equal(r.step,1);
  assert.equal(r.nextState,null);
  assert.equal(r.transitions,null);
});
test('V2 replay: failure in later edge exposes action and path step but not partial moves',()=>{
  const actions=[action('reserve',[cell(3,6)]),
    action('unitA',[cell(3,4),cell(7,4)],{expectedRevision:3})];
  const r=replay({initialState:state(),policy:policy(),actions});
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.reason,'NOT_ONE_ADJACENT_HEX');
  assert.equal(r.step,1);
  assert.equal(r.pathStep,1);
  assert.equal(r.nextState,null);
  assert.equal(r.transitions,null);
});
test('V2 replay: empty sequence validates scope but does not advance revision',()=>{
  const r=replay({initialState:state(),policy:policy(),actions:[]});
  assert.equal(r.status,'RULE_PATH_REPLAY_CANDIDATE');
  assert.equal(r.nextState.revision,2);
  assert.deepEqual(r.transitions,[]);
  assert.equal(r.canCommit,false);
});
test('V2 reducer: one step yields same board revision and ledger as V1',()=>{
  const oldState=state();oldState.kind=CORE_OPEN_FOOT_KIND;oldState.schemaVersion=1;
  const oldPolicy=policy();oldPolicy.scope=CORE_OPEN_FOOT_POLICY;
  const a=reduceCoreOpenFootStep({
    state:oldState,policy:oldPolicy,
    action:{actor:'A',expectedRevision:2,unitId:'unitA',to:cell(3,4)}
  });
  const b=result({action:action('unitA',path1())});
  assert.equal(a.status,'RULE_TRANSITION_CANDIDATE');
  success(b);
  const translated=structuredClone(b.nextState);
  translated.kind=CORE_OPEN_FOOT_KIND;translated.schemaVersion=1;
  assert.deepEqual(translated,a.nextState);
});
test('V2 reducer: V1 and V2 kinds, schema versions and policy scopes never mix',()=>{
  const old=state();old.kind=CORE_OPEN_FOOT_KIND;old.schemaVersion=1;
  fail(result({state:old}),'INVALID_PATH_CORE_SCOPE');
  const rule=policy();rule.scope=CORE_OPEN_FOOT_POLICY;
  fail(result({policy:rule}),'INVALID_PATH_CORE_SCOPE');
  const wrong=state();wrong.schemaVersion=3;
  fail(result({state:wrong}),'INVALID_PATH_CORE_SCOPE');
});
test('V2 reducer: terrain, leaders, special cards and exceptions are blocked',()=>{
  for(const update of [
    p=>p.terrain.push({kind:'HILL',col:8,row:8}),
    p=>p.scenarioExceptions.push('SPECIAL'),
    p=>p.cardFamily='FIRST_STRIKE',
    p=>p.unitTypes.unitA='ELEPHANT'
  ]){
    const rules=policy();update(rules);
    const r=result({policy:rules});
    assert.equal(r.status,'BLOCKED');
    assert.equal(r.canCommit,false);
  }
  const starting=state();
  starting.board.leaders.push({id:'leader',side:'A',col:2,row:4});
  fail(result({state:starting}),'INVALID_CORE_MOVEMENT_STATE');
});
test('V2 reducer: unknown player, unauthorized client proofs or extra action props rejected',()=>{
  for(const mutator of [
    a=>a.actor='C',
    a=>a.idempotencyKey='client-key',
    a=>a.movementAuthorized=true,
    a=>a.candidateEvidence={},
    a=>a.to=cell(4,4),
    a=>a.path[0].card='secret',
    a=>a.expectedRevision='2'
  ]){
    const candidate=action();mutator(candidate);
    fail(result({action:candidate}),'INVALID_PATH_CORE_ACTION');
  }
});
test('V2 reducer: malformed board and unissued/moved ledgers rejected before changes',()=>{
  const invalid=[
    s=>s.board.units[0].col=20,
    s=>s.board.units[0].side='C',
    s=>s.board.units[1].id='unitA',
    s=>s.orderLedger.issuedUnitIds=['enemy'],
    s=>s.orderLedger.movedUnitIds=['unitA','unitA']
  ];
  for(const mutate of invalid){
    const starting=state();mutate(starting);
    fail(result({state:starting}),'INVALID_CORE_MOVEMENT_STATE');
  }
});
test('V2 reducer: oversized, sparse and non-array paths never advance',()=>{
  const long=new Array(33).fill(cell(3,4)),sparse=new Array(2);
  for(const path of [[],long,sparse,{0:cell(3,4),length:1},null]){
    fail(result({action:action('unitA',path)}),
      path===null?'INVALID_PATH_CORE_ACTION':
        path===undefined?'INVALID_PATH_CORE_ACTION':
          path===long||path===sparse?'INVALID_PATH_CORE_INPUT':
            'INVALID_PATH_CORE_ACTION');
  }
});
test('V2 reducer: accessors and Proxy property reads are never executed',()=>{
  const hits=[],candidate=action();
  Object.defineProperty(candidate.path[1],'col',{
    enumerable:true,get(){hits.push('GET');throw Error('malicious getter')}
  });
  fail(result({action:candidate}),'INVALID_PATH_CORE_INPUT');
  const wrapped=new Proxy(action(),{
    get(){hits.push('PROXY_GET');throw Error('get trap')}
  });
  success(result({action:wrapped}));
  assert.deepEqual(hits,[]);
});
test('V2 reducer: a client-supplied actor at root cannot spoof trusted action',()=>{
  const r=reduce({state:state(),policy:policy(),action:action(),actor:'B'});
  fail(r,'INVALID_PATH_CORE_REQUEST');
});
test('V2 reducer: source changes do not mutate frozen output or its path',()=>{
  const starting=state(),command=action(),rules=policy();
  const r=reduce({state:starting,action:command,policy:rules});
  success(r);
  assert.equal(Object.isFrozen(r.nextState.board.units[0]),true);
  assert.equal(Object.isFrozen(r.transition.path),true);
  assert.equal(Object.isFrozen(r.transition.path[0]),true);
  command.path[1].col=9;
  rules.unitTypes.unitA='ELEPHANT';
  starting.board.units[0].col=6;
  assert.deepEqual(r.transition.path,path2());
  assert.equal(r.nextState.board.units[0].col,4);
  assert.equal(r.nextState.revision,3);
});
test('V2 reducer: maximum safe revision never wraps when accepting a complete path',()=>{
  const starting=state();starting.revision=Number.MAX_SAFE_INTEGER;
  const cmd=action('unitA',path2(),{
    expectedRevision:Number.MAX_SAFE_INTEGER
  });
  fail(result({state:starting,action:cmd}),'REVISION_EXHAUSTED');
});
test('V2 replay: malicious extra authority in replay root is rejected before applying actions',()=>{
  const r=replay({
    initialState:state(),policy:policy(),actions:[action()],
    canCommit:true
  });
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.reason,'INVALID_PATH_CORE_REPLAY');
  assert.equal(r.nextState,null);
});
test('V2 replay: no partial state after invalid policy or malformed second action',()=>{
  const bad=action('reserve',[cell(3,6)],{expectedRevision:3});
  bad.sessionToken='spoof';
  const r=replay({
    initialState:state(),policy:policy(),actions:[action(),bad]
  });
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.reason,'INVALID_PATH_CORE_ACTION');
  assert.equal(r.step,1);
  assert.equal(r.nextState,null);
  assert.equal(r.transitions,null);
});
