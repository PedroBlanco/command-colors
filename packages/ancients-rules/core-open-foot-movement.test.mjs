import test from 'node:test';
import assert from 'node:assert/strict';
import {ANCIENTS_RULESET} from './movement-profile.mjs';
import {snapshotFootTransactionProbeRequest}
  from './staged-sequence-request-snapshot.mjs';
import {initializeSectionHistoryLab,applySectionHistoryLabCommand}
  from './section-history-journal.mjs';
import {previewVerifiedSectionFootCore} from './verified-foot-core-preview.mjs';
import {
  CORE_OPEN_FOOT_KIND,CORE_OPEN_FOOT_POLICY,
  reduceCoreOpenFootStep as reduce,replayCoreOpenFootSteps as replay
} from './core-open-foot-movement.mjs';

const cell=(col,row)=>({col,row});
const state=()=>({
  kind:CORE_OPEN_FOOT_KIND,schemaVersion:1,ruleset:ANCIENTS_RULESET,
  revision:2,turn:'A',phase:'MOVE',
  board:{units:[
    {id:'unitA',side:'A',col:2,row:4},
    {id:'reserve',side:'A',col:2,row:6},
    {id:'enemy',side:'B',col:10,row:4}
  ],leaders:[]},
  orderLedger:{issuedUnitIds:['unitA','reserve'],movedUnitIds:[]}
});
const policy=()=>({
  scope:CORE_OPEN_FOOT_POLICY,ruleset:ANCIENTS_RULESET,
  cardFamily:'ORDINARY_SECTION',terrain:[],scenarioExceptions:[],
  unitTypes:{unitA:'LIGHT_INFANTRY',reserve:'MEDIUM_INFANTRY',
    enemy:'HEAVY_INFANTRY'}
});
const action=(unitId='unitA',to=cell(3,4),overrides={})=>({
  actor:'A',expectedRevision:2,unitId,to,...overrides
});
const step=(changes={})=>{
  const {state:core=state(),policy:rules=policy(),action:cmd=action()}=changes;
  return reduce({state:core,policy:rules,action:cmd});
};
const blocked=r=>{
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.nextState,null);
  assert.equal(r.transition,null);
  assert.equal(r.canCommit,false);
  assert.equal(r.movementAuthorized,false);
  assert.equal(r.officialMovementAuthorized,false);
  assert.equal(r.dbChanged,false);
};

test('one open-ground foot step proposes a new state and marks only that unit moved',()=>{
  const original=state(),before=structuredClone(original);
  const r=step({state:original});
  assert.equal(r.status,'RULE_TRANSITION_CANDIDATE');
  assert.equal(r.reason,null);
  assert.equal(r.nextState.revision,3);
  assert.equal(r.nextState.board.units.find(u=>u.id==='unitA').col,3);
  assert.deepEqual(r.nextState.orderLedger.issuedUnitIds,['unitA','reserve']);
  assert.deepEqual(r.nextState.orderLedger.movedUnitIds,['unitA']);
  assert.deepEqual(r.transition,{
    kind:'BASE_FOOT_OPEN_STEP_PROPOSAL_V1',side:'A',revision:3,
    unitId:'unitA',from:cell(2,4),to:cell(3,4)
  });
  assert.equal(r.officialMovementAuthorized,false);
  assert.equal(r.movementAuthorized,false);
  assert.equal(r.canCommit,false);
  assert.equal(r.dbChanged,false);
  assert.equal(r.needsServerTransaction,true);
  assert.deepEqual(original,before);
});

test('all six ordinary infantry types can move one empty adjacent hex',()=>{
  for(const unitType of [
    'LIGHT_INFANTRY','LIGHT_SLING_INFANTRY','LIGHT_BOW_INFANTRY',
    'AUXILIA_INFANTRY','MEDIUM_INFANTRY','HEAVY_INFANTRY'
  ]){
    const rules=policy();rules.unitTypes.unitA=unitType;
    const r=step({policy:rules});
    assert.equal(r.status,'RULE_TRANSITION_CANDIDATE',unitType);
  }
});

test('a unit ordered but not moved remains unchanged and eligible',()=>{
  const r=step();
  assert.deepEqual(r.nextState.orderLedger.issuedUnitIds,['unitA','reserve']);
  assert.deepEqual(r.nextState.orderLedger.movedUnitIds,['unitA']);
  assert.deepEqual(r.nextState.board.units.find(u=>u.id==='reserve'),
    state().board.units.find(u=>u.id==='reserve'));
  assert.equal(r.nextState.phase,'MOVE');
  assert.equal(r.nextState.turn,'A');
});

test('replay of two different ordered units is deterministic and preserves the input',()=>{
  const initial=state(),before=structuredClone(initial);
  const actions=[action(),action('reserve',cell(3,6),{expectedRevision:3})];
  const first=replay({initialState:initial,actions,policy:policy()});
  const second=replay({initialState:initial,actions,policy:policy()});
  assert.equal(first.status,'RULE_REPLAY_CANDIDATE');
  assert.equal(first.nextState.revision,4);
  assert.deepEqual(first.nextState.orderLedger.movedUnitIds,['unitA','reserve']);
  assert.deepEqual(first.nextState.board.units.map(u=>cell(u.col,u.row)),
    [cell(3,4),cell(3,6),cell(10,4)]);
  assert.deepEqual(first.transitions.map(t=>t.revision),[3,4]);
  assert.equal(first.officialMovementAuthorized,false);
  assert.equal(first.canCommit,false);
  assert.deepEqual(first,second);
  assert.deepEqual(initial,before);
});

test('duplicate movement is denied even with a fresh revision',()=>{
  const first=step();
  const again=reduce({state:first.nextState,policy:policy(),
    action:action('unitA',cell(4,4),{expectedRevision:3})});
  blocked(again);
  assert.equal(again.reason,'UNIT_ALREADY_MOVED');
});

test('replay of valid first step followed by repeated unit fails with no partial state',()=>{
  const original=state(),before=structuredClone(original);
  const r=replay({initialState:original,policy:policy(),actions:[
    action(),action('unitA',cell(4,4),{expectedRevision:3})
  ]});
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.reason,'UNIT_ALREADY_MOVED');
  assert.equal(r.step,1);
  assert.equal(r.nextState,null);
  assert.equal(r.transitions,null);
  assert.equal(r.dbChanged,false);
  assert.deepEqual(original,before);
});

test('unissued unit, foreign unit and invented identity are not movable',()=>{
  const core=state();
  core.orderLedger.issuedUnitIds=['unitA'];
  for(const unitId of ['reserve','enemy','ghost']){
    const r=step({state:core,action:action(unitId,cell(3,6))});
    blocked(r);
    assert.equal(r.reason,'UNIT_NOT_ORDERED');
  }
});

test('stale revision, wrong side, invalid command shape and spoofed client authority are rejected',()=>{
  assert.equal(step({action:action('unitA',cell(3,4),{expectedRevision:1})}).reason,
    'STALE_REVISION');
  assert.equal(step({action:action('unitA',cell(3,4),{actor:'B'})}).reason,
    'NOT_ACTING_PLAYER');
  for(const actionOverride of [
    {...action(),actor:'C'}, {...action(),sessionToken:'opaque'},
    {...action(),board:{}},{...action(),movementAuthorized:true},
    {...action(),candidateEvidence:{}},
    {...action(),to:{col:3,row:4,owner:'A'}},
    {...action(),unitId:'__proto__'},
    {...action(),expectedRevision:'2'}
  ]){
    blocked(step({action:actionOverride}));
  }
});

test('occupied friendly or enemy destinations cannot be entered',()=>{
  const core=state();
  core.board.units[1].col=3;core.board.units[1].row=4;
  assert.equal(step({state:core}).reason,'OCCUPIED_DESTINATION');
  core.board.units[1].col=2;core.board.units[1].row=6;
  core.board.units[2].col=3;core.board.units[2].row=4;
  assert.equal(step({state:core}).reason,'OCCUPIED_DESTINATION');
});

test('nonadjacent, identical and out-of-bounds cells do not produce a state',()=>{
  for(const to of [cell(4,4),cell(2,4),cell(13,4),cell(3,-1)]){
    const r=step({action:action('unitA',to)});
    blocked(r);
    assert.equal(r.reason,
      to.col===13||to.row===-1?'INVALID_CORE_MOVEMENT_ACTION':'NOT_ONE_ADJACENT_HEX');
  }
});

test('cavalry, elephants, warriors and war machines require separate rule engines',()=>{
  for(const type of ['LIGHT_CAVALRY','MEDIUM_CAVALRY','HEAVY_CAVALRY',
    'ELEPHANT','HEAVY_CHARIOT','WARRIOR_INFANTRY','HEAVY_WAR_MACHINE']){
    const p=policy();p.unitTypes.unitA=type;
    const r=step({policy:p});
    blocked(r);
    assert.equal(r.reason,'UNSUPPORTED_FOOT_UNIT',type);
  }
});

test('leaders anywhere, terrain anywhere or scenario/card exceptions fail closed',()=>{
  const core=state();core.board.leaders=[{id:'leaderA',side:'A',col:2,row:4}];
  assert.equal(step({state:core}).reason,'INVALID_CORE_MOVEMENT_STATE');
  for(const mutate of [
    p=>p.terrain.push({col:3,row:4,kind:'FOREST'}),
    p=>p.terrain.push({col:10,row:8,kind:'HILL'}),
    p=>p.scenarioExceptions.push('SPECIAL_MOVEMENT'),
    p=>p.cardFamily='ORDER_LIGHT_TROOPS',
    p=>p.ruleset='ancients-expansion',
    p=>p.scope='UNVERIFIED',
    p=>p.arbitraryPolicyOverride=true
  ]){
    const p=policy();mutate(p);
    assert.equal(step({policy:p}).reason,'UNSUPPORTED_CORE_MOVEMENT_SCOPE');
  }
});

test('trusted roster must match every unit exactly and use known profiles',()=>{
  for(const modify of [
    x=>delete x.unitTypes.enemy,
    x=>x.unitTypes.ghost='LIGHT_INFANTRY',
    x=>x.unitTypes.unitA='FANTASY_UNIT',
    x=>x.unitTypes.reserve=null
  ]){
    const p=policy();modify(p);
    assert.equal(step({policy:p}).reason,'UNSUPPORTED_CORE_MOVEMENT_SCOPE');
  }
});

test('tampered board and corrupt issued/moved order ledger are refused',()=>{
  const edits=[
    s=>s.board.units[1].id='unitA',
    s=>{s.board.units[1].col=2;s.board.units[1].row=4},
    s=>s.board.units[0].col=13,
    s=>s.orderLedger.issuedUnitIds=['unitA','unitA'],
    s=>s.orderLedger.issuedUnitIds=['enemy'],
    s=>s.orderLedger.movedUnitIds=['enemy'],
    s=>s.orderLedger.movedUnitIds=['ghost'],
    s=>s.board.secretHand='HIDDEN',
    s=>s.orderLedger.extraPermission=true,
    s=>s.ruleset='ancients-other',
    s=>s.phase='BATTLE'
  ];
  for(const modify of edits){
    const core=state();modify(core);
    const r=step({state:core});
    blocked(r);
    assert.equal(r.reason,'INVALID_CORE_MOVEMENT_STATE');
  }
});

test('revision overflow is refused without rounding or state mutation',()=>{
  const core=state();core.revision=Number.MAX_SAFE_INTEGER;
  const r=step({state:core,action:action('unitA',cell(3,4),{
    expectedRevision:Number.MAX_SAFE_INTEGER
  })});
  assert.equal(r.reason,'REVISION_EXHAUSTED');
  blocked(r);
  assert.equal(core.revision,Number.MAX_SAFE_INTEGER);
});

test('outputs are deeply immutable, detached, minimal and contain no secret material',()=>{
  const core=state(),p=policy(),r=step({state:core,policy:p});
  assert.equal(r.status,'RULE_TRANSITION_CANDIDATE');
  for(const part of [r,r.nextState,r.nextState.board,r.nextState.board.units,
    r.nextState.board.units[0],r.nextState.orderLedger,
    r.nextState.orderLedger.movedUnitIds,r.transition,r.transition.to])
    assert.equal(Object.isFrozen(part),true);
  assert.deepEqual(Object.keys(r.nextState).sort(),
    ['board','kind','orderLedger','phase','revision','ruleset','schemaVersion','turn']);
  assert.equal(JSON.stringify(r).includes('sessionToken'),false);
  assert.equal(JSON.stringify(r).includes('cardInstanceId'),false);
  assert.equal(JSON.stringify(r).includes('ANCIENTS_MOVEMENT_COMMITTED_V1'),false);
  assert.throws(()=>{r.nextState.orderLedger.movedUnitIds.push('ghost')},TypeError);
  core.board.units[0].col=8;
  p.unitTypes.unitA='ELEPHANT';
  assert.equal(r.nextState.board.units[0].col,3);
});

test('empty replay returns a detached frozen proposal with no transitions',()=>{
  const original=state();
  const r=replay({initialState:original,actions:[],policy:policy()});
  assert.equal(r.status,'RULE_REPLAY_CANDIDATE');
  assert.deepEqual(r.nextState,original);
  assert.deepEqual(r.transitions,[]);
  assert.notEqual(r.nextState,original);
  assert.equal(Object.isFrozen(r.nextState),true);
  assert.equal(r.canCommit,false);
});

test('replay refuses mismatched intermediate revisions and malformed command lists',()=>{
  const original=state();
  const stale=replay({initialState:original,actions:[
    action(),action('reserve',cell(3,6),{expectedRevision:2})
  ],policy:policy()});
  assert.equal(stale.status,'BLOCKED');
  assert.equal(stale.step,1);
  assert.equal(stale.reason,'STALE_REVISION');
  assert.equal(stale.nextState,null);
  for(const list of [null,{},new Array(118)]){
    const r=replay({initialState:original,actions:list,policy:policy()});
    assert.equal(r.status,'BLOCKED');
    assert.equal(r.reason,'INVALID_CORE_REPLAY');
  }
});

test('hostile input getters do not escape as an authorized state',()=>{
  const a=action();
  Object.defineProperty(a.to,'col',{enumerable:true,get(){
    throw new Error('MALICIOUS_GETTER');
  }});
  blocked(step({action:a}));
  const core=state();
  Object.defineProperty(core.board.units[0],'col',{enumerable:true,get(){
    throw new Error('MALICIOUS_GETTER');
  }});
  blocked(step({state:core}));
});

test('proposed movement cannot be forged by passing a candidate trace as a parameter',()=>{
  const r=step({action:{...action(),journal:{
    status:'CANDIDATE_EVIDENCE',signature:'fake'
  }}});
  blocked(r);
  assert.equal(r.reason,'INVALID_CORE_MOVEMENT_ACTION');
});

function stagedFootHistory(){
  const initial=initializeSectionHistoryLab({
    cardInstances:[
      {instanceId:'a_left',definitionId:'ORDER_2_LEFT'},
      {instanceId:'b_left',definitionId:'ORDER_2_LEFT'},
      {instanceId:'c_left',definitionId:'ORDER_2_LEFT'},
      {instanceId:'d_left',definitionId:'ORDER_2_LEFT'}],
    handSizes:{A:2,B:1},startingSide:'A',randomIndex:()=>0,
    board:{units:[
      {id:'unitA',side:'A',col:2,row:4},
      {id:'enemy',side:'B',col:10,row:4}
    ],leaders:[]},
    sectorCells:{'2,4':['LEFT'],'10,4':['RIGHT']}
  });
  const played=applySectionHistoryLabCommand(initial,{
    actor:'A',type:'PLAY_SECTION_CARD',expectedRevision:0,
    cardInstanceId:initial.hands.A[0].instanceId
  });
  assert.equal(played.accepted,true);
  const staged=applySectionHistoryLabCommand(played.nextState,{
    actor:'A',type:'ASSIGN_SECTION_ORDERS',expectedRevision:1,
    unitIds:['unitA'],leaderIds:[]
  });
  assert.equal(staged.accepted,true);
  return staged.nextState;
}
const footScenario=()=>({
  scope:'SYNTHETIC_OPEN_HEX_V1',ruleset:ANCIENTS_RULESET,
  terrain:[],scenarioExceptions:[],
  unitTypes:{unitA:'LIGHT_INFANTRY',enemy:'HEAVY_INFANTRY'}
});
const footMove=()=>({kind:'UNIT',id:'unitA',path:[cell(3,4)]});
const footPreview=(changes={})=>previewVerifiedSectionFootCore({
  verifiedState:stagedFootHistory(),actor:'A',expectedRevision:2,
  actions:[footMove()],trustedScenario:footScenario(),...changes
});
const deniedPreview=(value,reason)=>{
  assert.equal(value.status,'BLOCKED');
  assert.equal(value.reason,reason);
  assert.equal(value.proposal,null);
  assert.equal(value.movementAuthorized,false);
  assert.equal(value.canCommit,false);
  assert.equal(value.dbChanged,false);
};

test('verified section adapter proposes one core step with own orders but no authority',()=>{
  const verifiedState=stagedFootHistory(),before=structuredClone(verifiedState);
  const preview=footPreview({verifiedState});
  assert.equal(preview.status,'PRIVATE_CORE_FOOT_PROPOSAL');
  assert.equal(preview.kind,'PRIVATE_VERIFIED_FOOT_CORE_PREVIEW_V1');
  assert.equal(preview.proposal.status,'RULE_TRANSITION_CANDIDATE');
  assert.equal(preview.proposal.nextState.revision,3);
  assert.deepEqual(preview.proposal.nextState.orderLedger,{
    issuedUnitIds:['unitA'],movedUnitIds:['unitA']
  });
  assert.equal(preview.proposal.nextState.board.units.find(x=>x.id==='unitA').col,3);
  assert.equal(preview.movementAuthorized,false);
  assert.equal(preview.officialMovementAuthorized,false);
  assert.equal(preview.canCommit,false);
  assert.equal(preview.boardChanged,false);
  assert.deepEqual(verifiedState,before);
});

test('verified section adapter rejects stale revision, rival actor and non-staged turn',()=>{
  deniedPreview(footPreview({expectedRevision:1}),'STALE_REVISION');
  deniedPreview(footPreview({actor:'B'}),'NOT_ACTING_PLAYER');
  const s=stagedFootHistory();s.phase='AWAIT_CARD';
  deniedPreview(footPreview({verifiedState:s}),'ORDERS_NOT_STAGED');
});

test('verified section adapter requires an eligible witnessed ordinary section card',()=>{
  const s=stagedFootHistory();s.cardPlay.definitionId='ORDER_2_RIGHT';
  deniedPreview(footPreview({verifiedState:s}),'UNSUPPORTED_VERIFIED_ORDERS');
  const out=stagedFootHistory();
  out.orderSnapshot.pieces[0].col=9;
  deniedPreview(footPreview({verifiedState:out}),'UNSUPPORTED_VERIFIED_ORDERS');
});

test('verified section adapter detects tampered sector membership without key order assumptions',()=>{
  const s=stagedFootHistory();
  s.orderSnapshot.sectorCells['2,4']=['RIGHT'];
  deniedPreview(footPreview({verifiedState:s}),'UNSUPPORTED_VERIFIED_BOARD');
  const copy=stagedFootHistory();
  copy.orderSnapshot.sectorCells=Object.fromEntries(
    Object.entries(copy.orderSnapshot.sectorCells).reverse());
  assert.equal(footPreview({verifiedState:copy}).status,'PRIVATE_CORE_FOOT_PROPOSAL');
});

test('verified section adapter excludes leaders and independently ordered leaders',()=>{
  const withLeader=stagedFootHistory();
  withLeader.board.leaders.push({id:'captain',side:'A',col:2,row:4});
  deniedPreview(footPreview({verifiedState:withLeader}),'UNSUPPORTED_VERIFIED_BOARD');
  const forged=stagedFootHistory();
  forged.orderSnapshot.pieces[0].kind='LEADER';
  deniedPreview(footPreview({verifiedState:forged}),'UNSUPPORTED_VERIFIED_ORDERS');
});

test('verified section adapter rejects missing or modified scenario provenance',()=>{
  for(const change of [
    s=>s.scope='UNKNOWN',
    s=>s.ruleset='napoleonics',
    s=>s.terrain.push({col:10,row:8,kind:'HILL'}),
    s=>s.scenarioExceptions.push('SPECIAL'),
    s=>delete s.unitTypes.enemy,
    s=>s.unitTypes.extra='LIGHT_INFANTRY',
    s=>s.extraPermission=true
  ]){
    const scenario=footScenario();change(scenario);
    deniedPreview(footPreview({trustedScenario:scenario}),
      'UNSUPPORTED_VERIFIED_SCENARIO');
  }
  deniedPreview(footPreview({trustedScenario:undefined}),
    'UNSUPPORTED_VERIFIED_SCENARIO');
});

test('verified section adapter never turns staged candidates into multi-step authority',()=>{
  deniedPreview(footPreview({actions:[footMove(),footMove()]}),
    'ONLY_ONE_FOOT_STEP_SUPPORTED');
  deniedPreview(footPreview({actions:[{kind:'LEADER',id:'captain',path:[cell(3,4)]}]}),
    'ONLY_ONE_FOOT_STEP_SUPPORTED');
  deniedPreview(footPreview({actions:[{...footMove(),actor:'A'}]}),
    'ONLY_ONE_FOOT_STEP_SUPPORTED');
  deniedPreview(footPreview({actions:[{...footMove(),path:[cell(3,4),cell(4,4)]}]}),
    'ONLY_ONE_FOOT_STEP_SUPPORTED');
});

test('verified section adapter rejects enemy and unissued moves, collisions and range',()=>{
  deniedPreview(footPreview({actions:[{kind:'UNIT',id:'enemy',path:[cell(9,4)]}]}),
    'UNIT_NOT_ORDERED');
  deniedPreview(footPreview({actions:[{kind:'UNIT',id:'unitA',path:[cell(4,4)]}]}),
    'NOT_ONE_ADJACENT_HEX');
  const s=stagedFootHistory();
  s.board.units[1].col=3;s.board.units[1].row=4;
  deniedPreview(footPreview({verifiedState:s}),'OCCUPIED_DESTINATION');
});

test('verified section adapter independently enforces restricted foot profiles',()=>{
  const scenario=footScenario();scenario.unitTypes.unitA='ELEPHANT';
  deniedPreview(footPreview({trustedScenario:scenario}),'UNSUPPORTED_FOOT_UNIT');
});

test('verified section adapter strips lab hands, token, hidden metadata and replay keys',()=>{
  const s=stagedFootHistory();
  s.board.secretMeta='DO_NOT_LEAK_BOARD';
  s.board.units[0].secretMeta='DO_NOT_LEAK_UNIT';
  const preview=footPreview({verifiedState:s});
  assert.equal(preview.status,'PRIVATE_CORE_FOOT_PROPOSAL');
  const output=JSON.stringify(preview);
  for(const secret of ['DO_NOT_LEAK_BOARD','DO_NOT_LEAK_UNIT',
    'handAtPlay','cardPlay','drawPile','idempotencyKey','sessionToken',
    'instanceId','ANCIENTS_MOVEMENT_COMMITTED_V1'])
    assert.equal(output.includes(secret),false);
  for(const part of [preview,preview.proposal,preview.proposal.nextState,
    preview.proposal.nextState.board,preview.proposal.transition])
    assert.equal(Object.isFrozen(part),true);
});

test('verified section adapter rejects invalid trusted state without partial projection',()=>{
  deniedPreview(footPreview({verifiedState:null}),'INVALID_VERIFIED_CONTEXT');
  const state=stagedFootHistory();state.orderSnapshot.pieces.push(
    {...state.orderSnapshot.pieces[0]});
  deniedPreview(footPreview({verifiedState:state}),'UNSUPPORTED_VERIFIED_ORDERS');
});

const probeRequest=()=>({
  sessionToken:'opaque-probe-token',expectedRevision:2,
  idempotencyKey:'probe_foot_idem_001',
  actions:[{kind:'UNIT',id:'unitA',path:[cell(3,4)]}]
});
test('foot transactional probe snapshot retains one fully immutable intent',()=>{
  const raw=probeRequest(),before=structuredClone(raw);
  const captured=snapshotFootTransactionProbeRequest(raw);
  assert.deepEqual(captured,before);
  for(const value of [captured,captured.actions,captured.actions[0],
    captured.actions[0].path,captured.actions[0].path[0]])
    assert.equal(Object.isFrozen(value),true);
  raw.sessionToken='changed';
  raw.expectedRevision=900;
  raw.idempotencyKey='another_probe_idem';
  raw.actions[0].id='enemy';
  raw.actions[0].path[0].col=8;
  assert.deepEqual(captured,before);
});
test('foot transactional probe snapshot rejects forged authority or invalid key',()=>{
  const inputs=[
    {...probeRequest(),actor:'A'},
    {...probeRequest(),board:{}},
    {...probeRequest(),candidateEvidence:{}},
    {...probeRequest(),trustedScenario:{}},
    {...probeRequest(),idempotencyKey:'short'},
    {...probeRequest(),idempotencyKey:'!invalid'},
    {...probeRequest(),idempotencyKey:'a'.repeat(81)},
    {...probeRequest(),expectedRevision:-1},
    {...probeRequest(),expectedRevision:'2'},
    {...probeRequest(),actions:[]},
    {...probeRequest(),actions:[...probeRequest().actions,...probeRequest().actions]},
    {...probeRequest(),actions:[{kind:'LEADER',id:'unitA',path:[cell(3,4)]}]},
    {...probeRequest(),actions:[{kind:'UNIT',id:'unitA',path:[cell(3,4),cell(4,4)]}]},
    {...probeRequest(),actions:[{kind:'UNIT',id:'unitA',path:[{col:3,row:4,actor:'A'}]}]}
  ];
  for(const input of inputs)
    assert.equal(snapshotFootTransactionProbeRequest(input),null);
  const missing=Object.create(probeRequest());
  assert.equal(snapshotFootTransactionProbeRequest(missing),null);
  const sparse=probeRequest();
  sparse.actions=new Array(1);
  assert.equal(snapshotFootTransactionProbeRequest(sparse),null);
});
test('foot transactional probe snapshot rejects accessors without executing getters',()=>{
  const attempts=[
    request=>{
      Object.defineProperty(request,'idempotencyKey',{
        enumerable:true,get(){throw Error('UNTRUSTED_GETTER');}
      });
    },
    request=>{
      Object.defineProperty(request.actions[0].path[0],'col',{
        enumerable:true,get(){throw Error('UNTRUSTED_GETTER');}
      });
    }
  ];
  for(const change of attempts){
    const request=probeRequest();change(request);
    assert.equal(snapshotFootTransactionProbeRequest(request),null);
  }
});
test('foot transactional probe snapshot uses descriptors, never Proxy property reads',()=>{
  const raw=probeRequest(),calls=[];
  const input=new Proxy(raw,{get(){calls.push('GET');throw Error('PROXY_GET');}});
  const captured=snapshotFootTransactionProbeRequest(input);
  assert.deepEqual(captured,raw);
  assert.deepEqual(calls,[]);
});
