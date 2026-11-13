import test from 'node:test';
import {projectStagedAncientsBoard} from './staged-board-projection.mjs';
import assert from 'node:assert/strict';
import {initializeSectionHistoryLab as init,applySectionHistoryLabCommand as apply}
  from './section-history-journal.mjs';
import {precheckStagedAncientsMovement as preview,
  precheckStagedAncientsLeaderMovement as leaderPreview,
  precheckStagedAncientsMovementSequence as sequencePreview,
  precheckStagedAncientsMovementEvidence as evidencePreview} from './staged-movement-preflight.mjs';
import {verifyAncientsCandidateJournal} from './movement-candidate-journal.mjs';

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


function readyLeader({includeUnit=false}={}) {
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
    expectedRevision:1,unitIds:includeUnit?['unitA']:[],leaderIds:['leaderA']});
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


const action=(kind,id,cells)=>({kind,id,path:cells.map(([col,row])=>at(col,row))});
const leaderMove=()=>action('LEADER','leaderA',[[2,5]]);
const unitMove=()=>action('UNIT','unitA',[[3,4]]);
const checkSequence=(state,actions,opts={})=>sequencePreview({
  state,actor:'A',expectedRevision:state.revision,actions,
  serverContext:context(),...opts
});

test('staged sequence keeps leader-first detach and subsequent unit move as provisional',()=>{
  const {state}=readyLeader({includeUnit:true}),copy=structuredClone(state);
  const result=checkSequence(state,[leaderMove(),unitMove()]);
  assert.equal(result.status,'CANDIDATE_SEQUENCE');
  assert.equal(result.steps.length,2);
  assert.equal(result.steps[0].detachedFromUnit,'unitA');
  assert.equal(result.steps[1].leaderCarried,null);
  assert.equal(result.movementAuthorized,false);
  assert.equal(result.stateChanged,false);
  assert.deepEqual(state,copy);
});

test('staged sequence blocks late detach after the same ordered unit carried leader',()=>{
  const {state}=readyLeader({includeUnit:true});
  const result=checkSequence(state,[unitMove(),leaderMove()]);
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.reason,'LEADER_ALREADY_MOVED');
  assert.equal(result.step,1);
});

test('staged sequence cannot use unissued unit order, false side or stale revision',()=>{
  const {state,initial,played}=readyLeader();
  assert.equal(checkSequence(state,[unitMove()]).reason,'PIECE_NOT_ORDERED');
  assert.equal(checkSequence(initial,[leaderMove()]).reason,'ORDERS_NOT_STAGED');
  assert.equal(checkSequence(played,[leaderMove()]).reason,'ORDERS_NOT_STAGED');
  assert.equal(checkSequence(state,[leaderMove()],{actor:'B'}).reason,'NOT_ACTING_PLAYER');
  assert.equal(checkSequence(state,[leaderMove()],{expectedRevision:1}).reason,'STALE_REVISION');
  assert.throws(()=>checkSequence(state,[leaderMove()],{expectedRevision:'2'}),
    /INVALID_STAGED_SEQUENCE_REVISION/);
});

test('staged sequence detects changed order snapshots before examining paths',()=>{
  const {state}=readyLeader({includeUnit:true}),forged=structuredClone(state);
  forged.orderSnapshot.pieces[0].col=5;
  assert.equal(checkSequence(forged,[unitMove()]).reason,'ORDER_LEDGER_MISMATCH');
  const repeated=structuredClone(state);
  repeated.orderSnapshot.pieces.push({...repeated.orderSnapshot.pieces[0]});
  assert.equal(checkSequence(repeated,[unitMove()]).reason,'ORDER_LEDGER_MISMATCH');
});

test('staged sequence requires complete trusted profiles and does not accept extra commands',()=>{
  const {state}=readyLeader({includeUnit:true});
  assert.throws(()=>checkSequence(state,[leaderMove()],{serverContext:{terrain:[]}}),
    /INVALID_STAGED_MOVEMENT_CONTEXT/);
  assert.throws(()=>checkSequence(state,[{...leaderMove(),actor:'B'}]),
    /INVALID_SEQUENCE_CONTEXT/);
});


const evidenceMatch='123e4567-e89b-42d3-a456-426614174000';
const evidenceActions=()=>[leaderMove(),unitMove()];
const checkEvidence=(state,overrides={})=>evidencePreview({
  matchId:evidenceMatch,state,actor:'A',expectedRevision:state.revision,
  actions:evidenceActions(),serverContext:context(),...overrides
});

test('candidate evidence uses verified staged identities and a read-only sequence',()=>{
  const {state}=readyLeader({includeUnit:true}),before=structuredClone(state);
  const r=checkEvidence(state);
  assert.equal(r.status,'CANDIDATE_EVIDENCE');
  assert.equal(r.journal.entries.length,2);
  assert.equal(r.journal.baseRevision,2);
  assert.equal(r.journal.actor,'A');
  assert.equal(r.journal.entries[0].detachedFromUnit,'unitA');
  assert.equal(r.journal.movementAuthorized,false);
  assert.equal(r.journal.stateChanged,false);
  assert.equal(r.movementAuthorized,false);
  const units=state.board.units.map(u=>({...u,type:context().unitTypes[u.id]}));
  assert.equal(verifyAncientsCandidateJournal({
    journal:r.journal,matchId:evidenceMatch,actor:'A',baseRevision:state.revision,
    units,leaders:state.board.leaders,terrain:context().terrain,
    orderedUnitIds:['unitA'],orderedLeaderIds:['leaderA'],
    actions:evidenceActions()
  }),true);
  assert.deepEqual(state,before);
});

test('evidence rejects wrong actor, stale revision and missing staged orders without trace',()=>{
  const {initial,played,state}=readyLeader({includeUnit:true});
  for(const r of [
    checkEvidence(initial),checkEvidence(played),
    checkEvidence(state,{actor:'B'}),
    checkEvidence(state,{actor:'invalid'}),
    checkEvidence(state,{expectedRevision:1})
  ]){
    assert.equal(r.status,'BLOCKED');
    assert.equal(r.journal,null);
    assert.equal(r.movementAuthorized,false);
    assert.equal(r.stateChanged,false);
  }
});

test('evidence rejects unstaged units, invalid order snapshot and reversed leader move',()=>{
  const {state}=readyLeader({includeUnit:true});
  const onlyLeader=readyLeader().state;
  for(const r of [
    checkEvidence(onlyLeader),
    checkEvidence(state,{actions:[unitMove(),leaderMove()]})
  ]){
    assert.equal(r.status,'BLOCKED');
    assert.equal(r.journal,null);
  }
  const forged=structuredClone(state);
  forged.orderSnapshot.pieces[0].row=0;
  assert.equal(checkEvidence(forged).reason,'ORDER_LEDGER_MISMATCH');
  assert.equal(checkEvidence(forged).journal,null);
});

test('evidence binds terrain and match revision, not caller-provided card or actor',()=>{
  const {state}=readyLeader({includeUnit:true});
  const one=checkEvidence(state);
  const other=checkEvidence(state,{serverContext:{
    ...context(),terrain:[{col:9,row:8,kind:'HILL'}]
  }});
  assert.equal(other.status,'CANDIDATE_EVIDENCE');
  assert.notEqual(one.journal.contextDigest,other.journal.contextDigest);
  assert.throws(()=>checkEvidence(state,{matchId:'bad'}),/INVALID_CANDIDATE_JOURNAL_SCOPE/);
  assert.throws(()=>checkEvidence(state,{actions:[{...leaderMove(),actor:'B'}]}),
    /INVALID_SEQUENCE_CONTEXT/);
});


test('single-unit preview rejects an unrelated forged leader order',()=>{
  const {state}=readyLeader({includeUnit:true});
  const forged=structuredClone(state);
  const sibling=forged.orderSnapshot.pieces.find(p=>p.kind==='LEADER');
  sibling.col+=1;
  const before=structuredClone(forged);
  const result=check(forged);
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.reason,'ORDER_LEDGER_MISMATCH');
  assert.equal(result.movementAuthorized,false);
  assert.equal(result.stateChanged,false);
  assert.deepEqual(forged,before);
});

test('single-leader preview rejects a separately forged unit order',()=>{
  const {state}=readyLeader({includeUnit:true}),forged=structuredClone(state);
  forged.orderSnapshot.pieces.find(p=>p.kind==='UNIT').row=8;
  const result=checkLeader(forged);
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.reason,'ORDER_LEDGER_MISMATCH');
  assert.equal(result.movementAuthorized,false);
  assert.equal(result.stateChanged,false);
});

test('all previews reject duplicate, extra-field and mismatched sector ledgers',()=>{
  const {state}=readyLeader({includeUnit:true});
  for(const corrupt of [
    s=>s.orderSnapshot.pieces.push({...s.orderSnapshot.pieces[0]}),
    s=>{s.orderSnapshot.pieces[0].permission='ALLOWED';},
    s=>{s.orderSnapshot.sectorCells['2,4']=['RIGHT'];},
    s=>s.orderSnapshot.pieces.push({id:'ghost',kind:'UNIT',side:'A',col:5,row:5})
  ]) {
    const forged=structuredClone(state);corrupt(forged);
    const original=structuredClone(forged);
    for(const result of [
      check(forged),checkLeader(forged),
      checkSequence(forged,[leaderMove()])
    ]) {
      assert.equal(result.status,'BLOCKED');
      assert.equal(result.reason,'ORDER_LEDGER_MISMATCH');
      assert.equal(result.movementAuthorized,false);
      assert.equal(result.stateChanged,false);
    }
    assert.deepEqual(forged,original);
  }
});

const projectBoard=(state,actions,overrides={})=>projectStagedAncientsBoard({
  state,actor:'A',expectedRevision:state.revision,actions,
  serverContext:context(),...overrides
});
test('private staged board: leader detaches before unit and both positions are projected',()=>{
  const {state}=readyLeader({includeUnit:true}),before=structuredClone(state);
  const r=projectBoard(state,[leaderMove(),unitMove()]);
  assert.equal(r.status,'PRIVATE_BOARD_CANDIDATE');
  assert.equal(r.kind,'PRIVATE_STAGED_BOARD_PREVIEW_V1');
  assert.equal(r.moveCount,2);
  assert.deepEqual(r.projectedBoard.units.find(x=>x.id==='unitA'),{
    id:'unitA',side:'A',col:3,row:4
  });
  assert.deepEqual(r.projectedBoard.leaders.find(x=>x.id==='leaderA'),{
    id:'leaderA',side:'A',col:2,row:5
  });
  assert.equal(r.moves[0].detachedFromUnit,'unitA');
  assert.equal(r.moves[1].leaderCarried,null);
  for(const name of ['movementAuthorized','officialMovementAuthorized',
    'attackAuthorized','stateChanged','canCommit'])
    assert.equal(r[name],false);
  assert.equal(r.needsFullLegalityCheck,true);
  assert.equal(r.labSimulationOnly,true);
  assert.deepEqual(state,before);
});
test('private staged board: unit carries attached leader without a second action',()=>{
  const {state}=readyLeader({includeUnit:true});
  const r=projectBoard(state,[unitMove()]);
  assert.equal(r.status,'PRIVATE_BOARD_CANDIDATE');
  const u=r.projectedBoard.units.find(x=>x.id==='unitA');
  const l=r.projectedBoard.leaders.find(x=>x.id==='leaderA');
  assert.deepEqual(at(u.col,u.row),at(3,4));
  assert.deepEqual(at(l.col,l.row),at(3,4));
  assert.equal(r.moves[0].leaderCarried,'leaderA');
  assert.equal(r.moves[0].attachedLeader,'leaderA');
  assert.equal(r.canCommit,false);
});
test('private staged board: invalid second move exposes no partial result',()=>{
  const {state}=readyLeader({includeUnit:true}),before=structuredClone(state);
  const r=projectBoard(state,[unitMove(),leaderMove()]);
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.reason,'LEADER_ALREADY_MOVED');
  assert.equal(r.projectedBoard,null);
  assert.equal(r.moves,null);
  assert.equal(r.moveCount,0);
  assert.equal(r.stateChanged,false);
  assert.deepEqual(state,before);
});
test('private staged board: forged sibling order, actor and revision cannot project',()=>{
  const {state}=readyLeader({includeUnit:true});
  const forged=structuredClone(state);
  forged.orderSnapshot.pieces.find(p=>p.kind==='LEADER').col=9;
  const failures=[
    projectBoard(forged,[unitMove()]),
    projectBoard(state,[unitMove()],{actor:'B'}),
    projectBoard(state,[unitMove()],{expectedRevision:0})
  ];
  for(const r of failures){
    assert.equal(r.status,'BLOCKED');
    assert.equal(r.projectedBoard,null);
    assert.equal(r.moves,null);
    assert.equal(r.canCommit,false);
  }
  assert.equal(failures[0].reason,'ORDER_LEDGER_MISMATCH');
});
test('private staged board: result is deeply frozen and secrets are stripped',()=>{
  const {state}=readyLeader({includeUnit:true});
  state.board.hiddenScenario='SCENARIO_SECRET_123';
  state.board.units[0].secretMarker='UNIT_SECRET_123';
  state.board.leaders[0].privateOrders='LEADER_SECRET_123';
  const before=structuredClone(state);
  const r=projectBoard(state,[unitMove()]);
  assert.equal(r.status,'PRIVATE_BOARD_CANDIDATE');
  const output=JSON.stringify(r);
  for(const secret of ['SCENARIO_SECRET_123','UNIT_SECRET_123',
    'LEADER_SECRET_123','hands','drawPile','cardInstanceId'])
    assert.equal(output.includes(secret),false);
  assert.deepEqual(Object.keys(r.projectedBoard).sort(),['leaders','units']);
  for(const p of [...r.projectedBoard.units,...r.projectedBoard.leaders])
    assert.deepEqual(Object.keys(p).sort(),['col','id','row','side']);
  for(const frozen of [r,r.projectedBoard,r.projectedBoard.units,
    r.projectedBoard.units[0],r.projectedBoard.leaders[0],r.moves,r.moves[0],r.moves[0].to])
    assert.equal(Object.isFrozen(frozen),true);
  assert.throws(()=>{r.projectedBoard.units[0].col=8},TypeError);
  assert.deepEqual(state,before);
});
test('private staged board: repeated previews are deterministic, never persist',()=>{
  const {state}=readyLeader({includeUnit:true});
  const one=projectBoard(state,[leaderMove(),unitMove()]);
  const two=projectBoard(state,[leaderMove(),unitMove()]);
  assert.deepEqual(one,two);
  assert.notEqual(one.projectedBoard,state.board);
  assert.equal(state.revision,2);
  assert.equal(state.board.units.find(x=>x.id==='unitA').col,2);
  assert.equal(state.board.leaders.find(x=>x.id==='leaderA').row,4);
});
