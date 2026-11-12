import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeSectionHistoryLab as initialize,
  applySectionHistoryLabCommand as apply} from './section-history-journal.mjs';
import {CLEAR_LAB_POLICY} from './clear-lab-movement-reducer.mjs';
import {previewPrivateOneHexAncientsIntent as preview} from './private-one-hex-intent-preview.mjs';

const at=(col,row)=>({col,row});
const request=(changes={})=>({
  sessionToken:'session'.repeat(12),expectedRevision:2,
  idempotencyKey:'sim-onehex-01',kind:'UNIT',pieceId:'unitA',
  path:[at(3,4)],...changes
});
const context=()=>({unitTypes:{
  unitA:'LIGHT_INFANTRY',reserve:'HEAVY_INFANTRY',enemy:'HEAVY_INFANTRY'
},terrain:[]});
const policy=()=>({scope:CLEAR_LAB_POLICY});
function ready() {
  const initial=initialize({
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
  const played=apply(initial,{type:'PLAY_SECTION_CARD',actor:'A',
    expectedRevision:0,cardInstanceId:initial.hands.A[0].instanceId});
  assert.equal(played.accepted,true);
  const ordered=apply(played.nextState,{type:'ASSIGN_SECTION_ORDERS',
    actor:'A',expectedRevision:1,unitIds:['unitA','reserve'],leaderIds:[]});
  assert.equal(ordered.accepted,true);
  return ordered.nextState;
}
const run=(changes={})=>preview({
  request:request(),verifiedSectionState:ready(),
  authenticatedActor:'A',serverContext:context(),policy:policy(),...changes
});
const blocked=r=>{
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.simulatedBoard,null);
  assert.equal(r.moves,null);
  assert.equal(r.movementAuthorized,false);
  assert.equal(r.officialMovementAuthorized,false);
  assert.equal(r.canCommit,false);
  assert.equal(r.stateChanged,false);
};

test('private one-hex intent produces only a non-committable hypothetical board',()=>{
  const state=ready(),original=structuredClone(state);
  const r=run({verifiedSectionState:state});
  assert.equal(r.status,'PRIVATE_LAB_SIMULATION');
  assert.equal(r.moveCount,1);
  assert.deepEqual(r.moves,[{unitId:'unitA',from:at(2,4),to:at(3,4)}]);
  assert.equal(r.simulatedBoard.units.find(x=>x.id==='unitA').col,3);
  assert.equal(r.movementAuthorized,false);
  assert.equal(r.officialMovementAuthorized,false);
  assert.equal(r.attackAuthorized,false);
  assert.equal(r.canCommit,false);
  assert.equal(r.stateChanged,false);
  assert.equal(r.labSimulationOnly,true);
  assert.equal(r.needsFullLegalityCheck,true);
  assert.deepEqual(state,original);
  for(const value of [r,r.moves,r.moves[0],r.simulatedBoard,
    r.simulatedBoard.units,r.simulatedBoard.units[0]])
    assert.equal(Object.isFrozen(value),true);
});

test('raw client-supplied actor, board, policy or authorization is never accepted',()=>{
  for(const extra of [
    {actor:'A'}, {matchId:'any'}, {board:{}},
    {policy:policy()}, {terrain:[]}, {movementAuthorized:true},
    {journal:{status:'CANDIDATE_EVIDENCE'}}
  ]) blocked(run({request:request(extra)}));
});

test('invalid request fields block before private board is inspected',()=>{
  const proxy=new Proxy({}, {get(){throw Error('private board accessed')}});
  blocked(run({request:request({sessionToken:'short'}),
    verifiedSectionState:proxy}));
});

test('a valid-shaped token cannot authenticate itself',()=>{
  blocked(run({authenticatedActor:undefined}));
  blocked(run({authenticatedActor:'admin'}));
  // A valid-looking token still requires external authentication; the helper
  // explicitly does NOT verify the credential or claim that it has done so.
  const shapeOnly=run({request:request({sessionToken:'z'.repeat(64)})});
  assert.equal(shapeOnly.status,'PRIVATE_LAB_SIMULATION');
  assert.equal(shapeOnly.movementAuthorized,false);
});

test('only a single UNIT step is in the synthetic clear-ground scope',()=>{
  blocked(run({request:request({kind:'LEADER',pieceId:'captain'})}));
  blocked(run({request:request({path:[at(3,4),at(4,4)]})}));
  blocked(run({request:request({path:[]})}));
});

test('same-shaped request never overrides trusted actor, revision or orders',()=>{
  blocked(run({authenticatedActor:'B'}));
  blocked(run({request:request({expectedRevision:1})}));
  blocked(run({request:request({pieceId:'enemy',path:[at(10,5)]})}));
  blocked(run({request:request({pieceId:'ghost'})}));
  blocked(run({request:request({path:[at(4,4)]})}));
});

test('clear terrain and policy must be furnished by trusted caller, not request',()=>{
  blocked(run({serverContext:undefined}));
  blocked(run({serverContext:{...context(),terrain:[{col:3,row:4,kind:'HILL'}]}}));
  blocked(run({policy:null}));
  blocked(run({policy:{scope:'OFFICIAL_GAME'}}));
});

test('presence of a leader prevents synthetic-board simulation',()=>{
  const state=ready();
  state.board.leaders.push({id:'captain',side:'A',col:2,row:4});
  blocked(run({verifiedSectionState:state}));
});

test('no private card hand, session token or idempotency key appears in response',()=>{
  const r=run(),serialized=JSON.stringify(r);
  assert.equal(r.status,'PRIVATE_LAB_SIMULATION');
  assert.equal(serialized.includes('session'.repeat(12)),false);
  assert.equal(serialized.includes('sim-onehex-01'),false);
  assert.equal(serialized.includes('card_a_left'),false);
  assert.equal(serialized.includes('hands'),false);
  assert.equal(Object.hasOwn(r,'actor'),false);
});

test('a simulated board cannot be promoted to authoritative results by mutation',()=>{
  const r=run();
  assert.throws(()=>{r.movementAuthorized=true},TypeError);
  assert.throws(()=>{r.canCommit=true},TypeError);
  assert.throws(()=>{r.simulatedBoard.units[0].col=7},TypeError);
});

test('repeated previews are deterministic, and neither input can be mutated',()=>{
  const state=ready(),req=request();
  const previous=structuredClone({state,req});
  const a=preview({request:req,verifiedSectionState:state,authenticatedActor:'A',
    serverContext:context(),policy:policy()});
  const b=preview({request:structuredClone(req),verifiedSectionState:state,
    authenticatedActor:'A',serverContext:context(),policy:policy()});
  assert.deepEqual(a,b);
  assert.deepEqual({state,req},previous);
});

test('private simulation response strips unknown board and unit metadata',()=>{
  const state=ready();
  state.board.secretScenario='HIDDEN_SCENARIO_NOT_FOR_OPPONENT';
  state.board.units[0].secretOrder='HIDDEN_ORDERS';
  state.board.units[2].privateOwnerData='HIDDEN_PLAYER_DATA';
  const previous=structuredClone(state);
  const r=run({verifiedSectionState:state});
  assert.equal(r.status,'PRIVATE_LAB_SIMULATION');
  const json=JSON.stringify(r);
  for(const s of ['HIDDEN_SCENARIO_NOT_FOR_OPPONENT','HIDDEN_ORDERS',
    'HIDDEN_PLAYER_DATA'])assert.equal(json.includes(s),false);
  assert.deepEqual(Object.keys(r.simulatedBoard).sort(),['leaders','units']);
  for(const u of r.simulatedBoard.units)
    assert.deepEqual(Object.keys(u).sort(),['col','id','row','side']);
  assert.deepEqual(state,previous);
  assert.equal(r.canCommit,false);
});
