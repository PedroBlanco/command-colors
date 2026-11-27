import test from 'node:test';
import assert from 'node:assert/strict';
import {OFFICIAL_BOARD_GEOMETRY,officialSectorCells} from '../hex-grid/hex.mjs';
import {createAncientsScenarioSetup,listAncientsScenarios,createAncientsBaseDeck,BASE_DECK_COUNTS,createAncientsScenarioCatalog,LAB_SCENARIO_GEOMETRY} from './scenario-catalog.mjs';
import {initializeSectionHistoryLab as init,applySectionHistoryLabCommand as apply,
 replaySectionHistoryLab as replay,projectSectionHistoryLab as project,
 assertSectionHistoryLab as validate,SECTION_HISTORY_MAX_COMMANDS} from './section-history-journal.mjs';

const config=()=>({cardInstances:[
 {instanceId:'a_card_left',definitionId:'ORDER_2_LEFT'},
 {instanceId:'b_card_right',definitionId:'ORDER_2_RIGHT'},
 {instanceId:'c_card_center',definitionId:'ORDER_3_CENTER'},
 {instanceId:'d_card_left',definitionId:'ORDER_4_LEFT'},
 {instanceId:'e_card_right',definitionId:'ORDER_4_RIGHT'},
 {instanceId:'f_card_center',definitionId:'ORDER_2_CENTER'}],
 handSizes:{A:2,B:2},startingSide:'A',
 randomIndex:()=>0,
 board:{units:[{id:'a1',side:'A',col:2,row:4},{id:'b1',side:'B',col:10,row:4}],leaders:[{id:'a_leader',side:'A',col:2,row:4}]},
 sectorCells:{'2,4':['LEFT'],'10,4':['RIGHT']}});
const setup=()=>init(config());
const cmd=(type,revision,options={})=>({type,actor:'A',expectedRevision:revision,...options});
const play=state=>apply(state,cmd('PLAY_SECTION_CARD',state.revision,{cardInstanceId:state.hands.A[0].instanceId}));
const assign=state=>apply(state,cmd('ASSIGN_SECTION_ORDERS',state.revision,{unitIds:['a1'],leaderIds:[]}));

test('setup keeps exactly one copy of each instance across deck and both hands',()=>{
 const s=setup();assert.equal(validate(s),true);assert.equal(s.revision,0);
 assert.equal(s.drawPile.length,2);assert.equal(s.hands.A.length,2);assert.equal(s.hands.B.length,2);
 const ids=[...s.drawPile,...s.hands.A,...s.hands.B].map(x=>x.instanceId);
 assert.equal(new Set(ids).size,6);
});
test('reject repeated instances, invalid hands, corrupt or made-up sector memberships',()=>{
 const x=config();x.cardInstances[1].instanceId=x.cardInstances[0].instanceId;
 assert.throws(()=>init(x),/INVALID_SECTION_HISTORY_SETUP/);
 const y=config();y.sectorCells['2,4']=['LEFT','LEFT'];
 assert.throws(()=>init(y),/INVALID_SECTION_HISTORY_BOARD/);
 const z=config();z.handSizes.A=10;
 assert.throws(()=>init(z),/INVALID_SECTION_HISTORY_SETUP/);
});
test('refuse an out-of-hand instance, and never mutate input snapshot',()=>{
 const s=setup(),original=structuredClone(s);
 const out=apply(s,cmd('PLAY_SECTION_CARD',0,{cardInstanceId:'not_in_hand'}));
 assert.equal(out.code,'CARD_NOT_IN_OWN_HAND');assert.deepEqual(s,original);
});
test('playing an owned card updates hand and reveals only its definition',()=>{
 const state=setup(),original=structuredClone(state),result=play(state);
 assert.equal(result.accepted,true);assert.equal(result.nextState.phase,'ASSIGN_ORDERS');
 assert.equal(result.nextState.hands.A.length,1);
 assert.equal(result.nextState.cardPlay.instanceId,original.hands.A[0].instanceId);
 assert.equal(result.publicEvent.definitionId,original.hands.A[0].definitionId);
 assert.equal(JSON.stringify(result.publicEvent).includes(original.hands.A[0].instanceId),false);
 assert.deepEqual(state,original);
 assert.equal(result.attackAuthorized,false);
});
test('a player cannot play opponent card or act outside their turn',()=>{
 const s=setup();
 assert.equal(apply(s,cmd('PLAY_SECTION_CARD',0,{cardInstanceId:s.hands.B[0].instanceId})).code,'CARD_NOT_IN_OWN_HAND');
 assert.equal(apply(s,{...cmd('PLAY_SECTION_CARD',0,{cardInstanceId:s.hands.B[0].instanceId}),actor:'B'}).code,'NOT_YOUR_TURN');
});
test('revisions and phases are mandatory for every historical command',()=>{
 const s=setup();
 assert.equal(apply(s,cmd('PLAY_SECTION_CARD',1,{cardInstanceId:s.hands.A[0].instanceId})).code,'STALE_REVISION');
 assert.equal(apply(s,cmd('ASSIGN_SECTION_ORDERS',0,{unitIds:['a1'],leaderIds:[]})).code,'WRONG_PHASE');
});
test('server snapshots order positions and cannot be overwritten by client declaration',()=>{
 const state=play(setup()).nextState;
 const result=assign(state);
 assert.equal(result.accepted,true);assert.equal(result.nextState.phase,'LAB_RESOLUTION_PENDING');
 assert.deepEqual(result.nextState.orderSnapshot.pieces,[{id:'a1',kind:'UNIT',side:'A',col:2,row:4}]);
 assert.equal(result.ordersAuthorized,false);
});
test('duplicate, enemy and unknown ordered pieces are refused',()=>{
 const state=play(setup()).nextState;
 for(const opts of [{unitIds:['a1','a1'],leaderIds:[]},
  {unitIds:['b1'],leaderIds:[]},{unitIds:['unknown'],leaderIds:[]},
  {unitIds:['a1'],leaderIds:['a1']}]){
   assert.equal(apply(state,cmd('ASSIGN_SECTION_ORDERS',1,opts)).accepted,false);
 }
});
test('cannot assign a unit outside the section of played card',()=>{
 const s=setup(),played=play(s).nextState;
 const changed=structuredClone(played);changed.sectorCells['2,4']=['RIGHT'];
 assert.equal(assign(changed).code,'ORDERS_NOT_ELIGIBLE');
});
test('leader explicitly ordered consumes one additional order',()=>{
 const s=setup(),played=play(s).nextState;
 const r=apply(played,cmd('ASSIGN_SECTION_ORDERS',1,{unitIds:['a1'],leaderIds:['a_leader']}));
 assert.equal(r.accepted,true);assert.equal(r.publicEvent.leaderCount,1);
});
test('draw/discard/end of turn are exclusively LAB operations, not combat',()=>{
 const s0=setup(),s1=play(s0).nextState,s2=assign(s1).nextState;
 const r=apply(s2,cmd('END_EXPERIMENTAL_TURN',2));
 assert.equal(r.accepted,true);assert.equal(r.nextState.turn,'B');
 assert.equal(r.nextState.phase,'AWAIT_CARD');assert.equal(r.nextState.discardPile.length,1);
 assert.equal(r.nextState.hands.A.length,2);assert.equal(r.nextState.drawPile.length,1);
 assert.equal(r.publicEvent.kind,'LAB_TURN_ENDED_WITHOUT_COMBAT');
 assert.equal(r.combatResolved,false);
});
test('pure replay from bootstrap plus private command history reproduces full state',()=>{
 const s0=setup(),c0=cmd('PLAY_SECTION_CARD',0,{cardInstanceId:s0.hands.A[0].instanceId});
 const s1=apply(s0,c0).nextState,c1=cmd('ASSIGN_SECTION_ORDERS',1,{unitIds:['a1'],leaderIds:[]});
 const s2=apply(s1,c1).nextState,c2=cmd('END_EXPERIMENTAL_TURN',2);
 const s3=apply(s2,c2).nextState;
 assert.deepEqual(replay(s0,[c0,c1,c2]),s3);
 assert.throws(()=>replay(s0,[c0,c0]),/INVALID_SECTION_HISTORY_EVENT_CHAIN/);
});
test('snapshot with duplicated card in hand or pile fails closed',()=>{
 const s=setup();s.hands.B.push(s.hands.A[0]);
 assert.throws(()=>validate(s),/SECTION_CARD_CONSERVATION_FAILED/);
});
test('both side projections hide hidden deck and opponent card instance identifiers',()=>{
 const s=setup();
 for(const side of ['A','B']){
  const p=project(s,side),enemy=side==='A'?'B':'A';
  const encoded=JSON.stringify(p);
  for(const card of [...s.hands[enemy],...s.drawPile])assert.equal(encoded.includes(card.instanceId),false);
  assert.equal(p.opponentCardCount,2);
  assert.equal(p.attackAuthorized,false);assert.equal(p.combatResolved,false);
 }
});
test('client cannot change server state by mutating a projection',()=>{
 const s=setup();const view=project(s,'A');
 view.yourHand.push({instanceId:'fake_card',definitionId:'ORDER_2_LEFT'});
 assert.equal(project(s,'A').yourHand.length,2);
});

const completeFootSetup=()=>{
 const c=config();
 c.board.leaders=[];
 c.sectorCells=Object.fromEntries(Array.from({length:117},(_,i)=>{
  const col=Math.floor(i/9),row=i%9;
  return [col+','+row,[col<4?'LEFT':col>8?'RIGHT':'CENTER']];
 }));
 c.movementUnitTypes={a1:'LIGHT_INFANTRY',b1:'HEAVY_INFANTRY'};
 return c;
};

test('foot lab: two-hex ordered path mutates a detached board and replays deterministically',()=>{
 const initial=init(completeFootSetup()),original=structuredClone(initial);
 const playCmd=cmd('PLAY_SECTION_CARD',0,{cardInstanceId:initial.hands.A[0].instanceId});
 const one=apply(initial,playCmd);
 assert.equal(one.accepted,true);
 const orderCmd=cmd('ASSIGN_SECTION_ORDERS',1,{unitIds:['a1'],leaderIds:[]});
 const two=apply(one.nextState,orderCmd);
 assert.equal(two.accepted,true);
 const moveCmd=cmd('MOVE_SECTION_FOOT_PATH_V2',2,{unitId:'a1',path:[
  {col:3,row:4},{col:4,row:4}
 ]});
 const moved=apply(two.nextState,moveCmd);
 assert.equal(moved.accepted,true);
 assert.equal(moved.movementAppliedInLab,true);
 assert.equal(moved.officialMovementAuthorized,false);
 assert.deepEqual(moved.nextState.board.units.find(u=>u.id==='a1'),
  {id:'a1',side:'A',col:4,row:4});
 assert.deepEqual(moved.nextState.footLab.movedUnitIds,['a1']);
 assert.equal(moved.publicEvent.kind,'SECTION_FOOT_PATH_APPLIED_LAB');
 assert.equal(moved.publicEvent.battleAfterMovement,'POSSIBLE');
 assert.deepEqual(replay(initial,[playCmd,orderCmd,moveCmd]),moved.nextState);
 assert.deepEqual(initial,original);
 const view=project(moved.nextState,'B');
 assert.deepEqual(view.board.find(u=>u.id==='a1'),
  {id:'a1',side:'A',col:4,row:4,unitType:'LIGHT_INFANTRY'});
 assert.equal(JSON.stringify(view).includes(initial.hands.A[0].instanceId),false);
});

test('foot lab: illegal trajectories, double movement and unsupported scope never advance',()=>{
 const initial=init(completeFootSetup());
 const afterCard=apply(initial,cmd('PLAY_SECTION_CARD',0,{
  cardInstanceId:initial.hands.A[0].instanceId
 })).nextState;
 const waiting=apply(afterCard,cmd('ASSIGN_SECTION_ORDERS',1,{
  unitIds:['a1'],leaderIds:[]
 })).nextState;
 const move=(state,id,path)=>apply(state,cmd('MOVE_SECTION_FOOT_PATH_V2',
  state.revision,{unitId:id,path}));
 const snapshot=structuredClone(waiting);
 assert.equal(move(waiting,'b1',[{col:9,row:4}]).accepted,false);
 assert.equal(move(waiting,'a1',[{col:10,row:4}]).accepted,false);
 assert.equal(move(waiting,'a1',[{col:3,row:4},{col:2,row:4}]).accepted,false);
 assert.deepEqual(waiting,snapshot);
 const accepted=move(waiting,'a1',[{col:3,row:4}]);
 assert.equal(accepted.accepted,true);
 assert.equal(move(accepted.nextState,'a1',[{col:4,row:4}]).code,'UNIT_ALREADY_MOVED');
 const done=apply(accepted.nextState,cmd('END_EXPERIMENTAL_TURN',3));
 assert.equal(done.accepted,true);
 assert.deepEqual(done.nextState.footLab.movedUnitIds,[]);
 const old=setup();
 assert.equal(apply(old,cmd('MOVE_SECTION_FOOT_PATH_V2',0,{
  unitId:'a1',path:[{col:3,row:4}]
 })).accepted,false);
 const bad=completeFootSetup();delete bad.sectorCells['3,4'];
 assert.throws(()=>init(bad),/INVALID_FOOT_LAB_SETUP/);
 const leader=completeFootSetup();
 leader.board.leaders=[{id:'a_leader',side:'A',col:2,row:4}];
 assert.throws(()=>init(leader),/INVALID_FOOT_LAB_SETUP/);
 const unknown=completeFootSetup();unknown.movementUnitTypes.a1='UNKNOWN_UNIT';
 assert.throws(()=>init(unknown),/INVALID_FOOT_LAB_SETUP/);
});

test('foot lab: trusted terrain stops a path on forest entry and adjusts combat',()=>{
 const c=completeFootSetup();
 c.movementTerrain=[{col:3,row:4,kind:'FOREST'}];
 const s0=init(c);
 const s1=apply(s0,cmd('PLAY_SECTION_CARD',0,{cardInstanceId:s0.hands.A[0].instanceId})).nextState;
 const s2=apply(s1,cmd('ASSIGN_SECTION_ORDERS',1,{unitIds:['a1'],leaderIds:[]})).nextState;
 const before=structuredClone(s2);
 const longPath=apply(s2,cmd('MOVE_SECTION_FOOT_PATH_V2',2,{
  unitId:'a1',path:[{col:3,row:4},{col:4,row:4}]
 }));
 assert.equal(longPath.accepted,false);
 assert.equal(longPath.code,'MUST_STOP_ON_FOREST_ENTRY');
 assert.deepEqual(s2,before);
 const allowed=apply(s2,cmd('MOVE_SECTION_FOOT_PATH_V2',2,{
  unitId:'a1',path:[{col:3,row:4}]
 }));
 assert.equal(allowed.accepted,true);
 assert.equal(allowed.nextState.board.units[0].col,3);
 assert.equal(allowed.publicEvent.destinationTerrain,'FOREST');
 assert.equal(allowed.publicEvent.battleAfterMovement,'POSSIBLE');
 assert.equal(project(allowed.nextState,'A').terrain[0].kind,'FOREST');
 const heavy=completeFootSetup();
 heavy.movementUnitTypes.a1='MEDIUM_INFANTRY';
 heavy.movementTerrain=[{col:3,row:4,kind:'FOREST'}];
 const h0=init(heavy);
 const h1=apply(h0,cmd('PLAY_SECTION_CARD',0,{cardInstanceId:h0.hands.A[0].instanceId})).nextState;
 const h2=apply(h1,cmd('ASSIGN_SECTION_ORDERS',1,{unitIds:['a1'],leaderIds:[]})).nextState;
 const h3=apply(h2,cmd('MOVE_SECTION_FOOT_PATH_V2',2,{
  unitId:'a1',path:[{col:3,row:4}]
 }));
 assert.equal(h3.accepted,true);
 assert.equal(h3.publicEvent.battleAfterMovement,'UNAVAILABLE');
 const hill=completeFootSetup();hill.movementTerrain=[{col:4,row:4,kind:'HILL'}];
 const i0=init(hill);
 const i1=apply(i0,cmd('PLAY_SECTION_CARD',0,{cardInstanceId:i0.hands.A[0].instanceId})).nextState;
 const i2=apply(i1,cmd('ASSIGN_SECTION_ORDERS',1,{unitIds:['a1'],leaderIds:[]})).nextState;
 assert.equal(apply(i2,cmd('MOVE_SECTION_FOOT_PATH_V2',2,{
  unitId:'a1',path:[{col:3,row:4},{col:4,row:4}]
 })).publicEvent.destinationTerrain,'HILL');
});

test('foot lab: unsupported or tampered terrain is never admitted',()=>{
 for(const terrain of [
  [{col:3,row:4,kind:'UNSUPPORTED'}],
  [{col:3,row:4,kind:'FOREST'},{col:3,row:4,kind:'HILL'}],
  [{col:99,row:4,kind:'FOREST'}]
 ]){
  const c=completeFootSetup();c.movementTerrain=terrain;
  assert.throws(()=>init(c),/INVALID_FOOT_LAB_SETUP/);
 }
 const c=completeFootSetup();c.movementTerrain=[{col:3,row:4,kind:'FOREST'}];
 const s=init(c);s.footLab.terrain=null;
 assert.throws(()=>validate(s),/INVALID_FOOT_LAB_STATE/);
});

test('mounted laboratory: cavalry moves four hexes but cannot move again this turn',()=>{
 const c=completeFootSetup();c.movementUnitTypes.a1='LIGHT_CAVALRY';
 const s0=init(c);
 const playCmd=cmd('PLAY_SECTION_CARD',0,{cardInstanceId:s0.hands.A[0].instanceId});
 const s1=apply(s0,playCmd).nextState;
 const orderCmd=cmd('ASSIGN_SECTION_ORDERS',1,{unitIds:['a1'],leaderIds:[]});
 const s2=apply(s1,orderCmd).nextState;
 const moveCmd=cmd('MOVE_SECTION_MOUNTED_PATH_V1',2,{
  unitId:'a1',path:[{col:3,row:4},{col:4,row:4},{col:5,row:4},{col:6,row:4}]
 });
 const moved=apply(s2,moveCmd);
 assert.equal(moved.accepted,true);
 assert.equal(moved.nextState.board.units[0].col,6);
 assert.deepEqual(moved.nextState.footLab.movedUnitIds,['a1']);
 assert.equal(moved.publicEvent.kind,'SECTION_MOUNTED_PATH_APPLIED_LAB');
 assert.equal(moved.publicEvent.battleAfterMovement,'POSSIBLE');
 assert.equal(moved.officialMovementAuthorized,false);
 assert.deepEqual(replay(s0,[playCmd,orderCmd,moveCmd]),moved.nextState);
 assert.equal(apply(moved.nextState,cmd('MOVE_SECTION_MOUNTED_PATH_V1',3,{
  unitId:'a1',path:[{col:7,row:4}]
 })).code,'UNIT_ALREADY_MOVED');
 assert.equal(apply(s2,cmd('MOVE_SECTION_FOOT_PATH_V2',2,{
  unitId:'a1',path:[{col:3,row:4}]
 })).accepted,false);
});

test('mounted laboratory: mounted ranges and terrain deny without mutating the board',()=>{
 for(const [type,max] of [
  ['MEDIUM_CAVALRY',3],['HEAVY_CAVALRY',2],['ELEPHANT',2],['HEAVY_CHARIOT',2]
 ]){
  const c=completeFootSetup();c.movementUnitTypes.a1=type;
  const s0=init(c);
  const s1=apply(s0,cmd('PLAY_SECTION_CARD',0,{cardInstanceId:s0.hands.A[0].instanceId})).nextState;
  const s2=apply(s1,cmd('ASSIGN_SECTION_ORDERS',1,{unitIds:['a1'],leaderIds:[]})).nextState;
  const path=[{col:3,row:4},{col:4,row:4},{col:5,row:4},{col:6,row:4}].slice(0,max);
  assert.equal(apply(s2,cmd('MOVE_SECTION_MOUNTED_PATH_V1',2,{
   unitId:'a1',path
  })).accepted,true);
  const extra=[...path,{col:7,row:4}];
  const denied=apply(s2,cmd('MOVE_SECTION_MOUNTED_PATH_V1',2,{
   unitId:'a1',path:extra
  }));
  assert.equal(denied.accepted,false);
  assert.deepEqual(s2.board.units[0],s0.board.units[0]);
 }
 const terrainCases=[
  {terrain:[{col:4,row:4,kind:'BROKEN_GROUND'}],
   path:[{col:3,row:4},{col:4,row:4},{col:5,row:4}],
   rejection:'MOUNTED_MUST_STOP_ON_BROKEN_GROUND'},
  {terrain:[{col:3,row:4,kind:'FOREST'}],
   path:[{col:3,row:4},{col:4,row:4}],
   rejection:'MUST_STOP_ON_FOREST_ENTRY'}
 ];
 for(const {terrain,path,rejection} of terrainCases){
  const c=completeFootSetup();c.movementUnitTypes.a1='LIGHT_CAVALRY';c.movementTerrain=terrain;
  const s0=init(c);
  const s1=apply(s0,cmd('PLAY_SECTION_CARD',0,{cardInstanceId:s0.hands.A[0].instanceId})).nextState;
  const s2=apply(s1,cmd('ASSIGN_SECTION_ORDERS',1,{unitIds:['a1'],leaderIds:[]})).nextState;
  const before=structuredClone(s2);
  assert.equal(apply(s2,cmd('MOVE_SECTION_MOUNTED_PATH_V1',2,{
   unitId:'a1',path
  })).code,rejection);
  assert.deepEqual(s2,before);
  const stopped=apply(s2,cmd('MOVE_SECTION_MOUNTED_PATH_V1',2,{
   unitId:'a1',path:rejection==='MUST_STOP_ON_FOREST_ENTRY'
    ?[{col:3,row:4}]:[{col:3,row:4},{col:4,row:4}]
  }));
  assert.equal(stopped.accepted,true);
  assert.equal(stopped.publicEvent.battleAfterMovement,'UNAVAILABLE');
 }
});

test('player-relative sections: B left orders canonical right, not canonical left, with deterministic replay',()=>{
 const setup={
  cardInstances:[
   {instanceId:'reserve_a',definitionId:'ORDER_2_RIGHT'},
   {instanceId:'reserve_b',definitionId:'ORDER_2_CENTER'},
   {instanceId:'card_b_left',definitionId:'ORDER_2_LEFT'},
   {instanceId:'card_a_left',definitionId:'ORDER_2_LEFT'}
  ],handSizes:{A:1,B:1},randomIndex:n=>n-1,startingSide:'A',
  sectorPerspective:'PLAYER_RELATIVE',
  board:{units:[
   {id:'a1',side:'A',col:2,row:4},
   {id:'b1',side:'B',col:10,row:4},
   {id:'b2',side:'B',col:2,row:5}
  ],leaders:[]},
  sectorCells:{'2,4':['LEFT'],'10,4':['RIGHT'],'2,5':['LEFT']}
 };
 const s0=init(setup);
 const commands=[];
 let state=s0;
 const advance=(actor,type,fields={})=>{
  const command={actor,type,expectedRevision:state.revision,...fields};
  const result=apply(state,command);
  assert.equal(result.accepted,true,result.code);
  commands.push(command);
  state=result.nextState;
 };
 advance('A','PLAY_SECTION_CARD',{cardInstanceId:s0.hands.A[0].instanceId});
 advance('A','ASSIGN_SECTION_ORDERS',{unitIds:['a1'],leaderIds:[]});
 advance('A','END_EXPERIMENTAL_TURN');
 assert.equal(state.turn,'B');
 assert.equal(state.hands.B[0].definitionId,'ORDER_2_LEFT');
 advance('B','PLAY_SECTION_CARD',{cardInstanceId:state.hands.B[0].instanceId});
 assert.equal(apply(state,{actor:'B',type:'ASSIGN_SECTION_ORDERS',
  expectedRevision:state.revision,unitIds:['b2'],leaderIds:[]}).code,'ORDERS_NOT_ELIGIBLE');
 advance('B','ASSIGN_SECTION_ORDERS',{unitIds:['b1'],leaderIds:[]});
 assert.deepEqual(state.orderSnapshot.sectorCells['10,4'],['LEFT']);
 assert.deepEqual(state.orderSnapshot.sectorCells['2,5'],['RIGHT']);
 assert.deepEqual(replay(s0,commands),state);
 const legacy=init({...setup,sectorPerspective:'FIXED'});
 assert.equal(Object.hasOwn(legacy,'sectorPerspective'),false);
 assert.throws(()=>init({...setup,sectorPerspective:'UNKNOWN'}),/INVALID_SECTION_HISTORY_SETUP/);
});

test('leader lab: ordered detach, double-move block and replay; legacy foot still refuses leaders',()=>{
 const c=completeFootSetup();
 c.board.leaders=[{id:'a_leader',side:'A',col:2,row:4}];
 assert.throws(()=>init(c),/INVALID_FOOT_LAB_SETUP/);
 c.enableLeaderLab=true;
 const s0=init(c),command0=cmd('PLAY_SECTION_CARD',0,{
  cardInstanceId:s0.hands.A[0].instanceId
 });
 const s1=apply(s0,command0).nextState;
 const command1=cmd('ASSIGN_SECTION_ORDERS',1,{unitIds:['a1'],leaderIds:['a_leader']});
 const s2=apply(s1,command1).nextState;
 const leaderCmd=cmd('MOVE_SECTION_LEADER_PATH_V1',2,{
  leaderId:'a_leader',path:[{col:2,row:3}]
 });
 const moved=apply(s2,leaderCmd);
 assert.equal(moved.accepted,true);
 assert.deepEqual(moved.nextState.board.leaders[0],{
  id:'a_leader',side:'A',col:2,row:3
 });
 assert.deepEqual(moved.nextState.leaderLab.movedLeaderIds,['a_leader']);
 assert.equal(moved.publicEvent.kind,'SECTION_LEADER_PATH_APPLIED_LAB');
 assert.equal(moved.publicEvent.detachedFromUnit,'a1');
 assert.equal(moved.publicEvent.joinedUnit,null);
 assert.equal(moved.officialMovementAuthorized,false);
 assert.equal(apply(moved.nextState,cmd('MOVE_SECTION_LEADER_PATH_V1',3,{
  leaderId:'a_leader',path:[{col:3,row:3}]
 })).code,'LEADER_ALREADY_MOVED');
 assert.equal(apply(moved.nextState,cmd('MOVE_SECTION_FOOT_PATH_V2',3,{
  unitId:'a1',path:[{col:3,row:4}]
 })).accepted,true);
 assert.deepEqual(replay(s0,[command0,command1,leaderCmd]),moved.nextState);
 const enemy=project(moved.nextState,'B');
 assert.deepEqual(enemy.orderedLeaderIds,[]);
 assert.equal(enemy.leaders[0].id,'a_leader');
});

test('leader lab: carrying on foot and cavalry, joining unit prevents later move',()=>{
 for(const type of ['LIGHT_INFANTRY','LIGHT_CAVALRY']){
  const c=completeFootSetup();
  c.enableLeaderLab=true;
  c.movementUnitTypes.a1=type;
  c.board.leaders=[{id:'a_leader',side:'A',col:2,row:4}];
  const initial=init(c);
  const one=apply(initial,cmd('PLAY_SECTION_CARD',0,{
   cardInstanceId:initial.hands.A[0].instanceId
  })).nextState;
  const two=apply(one,cmd('ASSIGN_SECTION_ORDERS',1,{
   unitIds:['a1'],leaderIds:['a_leader']
  })).nextState;
  const moveType=type==='LIGHT_CAVALRY'?'MOVE_SECTION_MOUNTED_PATH_V1':'MOVE_SECTION_FOOT_PATH_V2';
  const moved=apply(two,cmd(moveType,2,{unitId:'a1',path:[{col:3,row:4}]}));
  assert.equal(moved.accepted,true);
  assert.equal(moved.publicEvent.leaderCarried,'a_leader');
  assert.equal(moved.nextState.board.leaders[0].col,3);
  assert.deepEqual(moved.nextState.leaderLab.movedLeaderIds,['a_leader']);
  assert.equal(apply(moved.nextState,cmd('MOVE_SECTION_LEADER_PATH_V1',3,{
   leaderId:'a_leader',path:[{col:4,row:4}]
  })).code,'LEADER_ALREADY_MOVED');
  const end=apply(moved.nextState,cmd('END_EXPERIMENTAL_TURN',3));
  assert.deepEqual(end.nextState.leaderLab.movedLeaderIds,[]);
 }
 const c=completeFootSetup();
 c.enableLeaderLab=true;
 c.board.units.push({id:'a2',side:'A',col:3,row:4});
 c.movementUnitTypes.a2='LIGHT_INFANTRY';
 c.board.leaders=[{id:'a_leader',side:'A',col:2,row:4}];
 const s0=init(c),s1=apply(s0,cmd('PLAY_SECTION_CARD',0,{
  cardInstanceId:s0.hands.A[0].instanceId
 })).nextState;
 const s2=apply(s1,cmd('ASSIGN_SECTION_ORDERS',1,{
  unitIds:['a2'],leaderIds:['a_leader']
 })).nextState;
 const joined=apply(s2,cmd('MOVE_SECTION_LEADER_PATH_V1',2,{
  leaderId:'a_leader',path:[{col:3,row:4}]
 }));
 assert.equal(joined.accepted,true);
 assert.deepEqual(joined.nextState.leaderLab.joinedUnitIds,['a2']);
 assert.equal(apply(joined.nextState,cmd('MOVE_SECTION_FOOT_PATH_V2',3,{
  unitId:'a2',path:[{col:4,row:4}]
 })).code,'UNIT_LOCKED_BY_LEADER_MOVE');
});

function rangedLabSetup({targetCol=4,terrain=[]}={}){
 const c=completeFootSetup();
 c.enableCombatLab=true;
 c.board.units[1].col=targetCol;
 c.movementTerrain=terrain;
 return c;
}
function rangedLabReady(c){
 const initial=init(c),play=cmd('PLAY_SECTION_CARD',0,{
  cardInstanceId:initial.hands.A[0].instanceId
 });
 const played=apply(initial,play).nextState;
 const order=cmd('ASSIGN_SECTION_ORDERS',1,{unitIds:['a1'],leaderIds:[]});
 const ordered=apply(played,order).nextState;
 return {initial,ordered,commands:[play,order]};
}
test('ranged lab: closes movement, derives two stationary dice, persists plan and cancels safely',()=>{
 const {initial,ordered,commands}=rangedLabReady(rangedLabSetup());
 const attackFields={attackerId:'a1',targetId:'b1'};
 assert.equal(apply(ordered,cmd('PREPARE_SECTION_RANGED_LAB',2,attackFields)).code,
  'COMBAT_PHASE_NOT_AVAILABLE');
 const close=cmd('FINISH_SECTION_MOVEMENT_LAB',2);
 const closed=apply(ordered,close).nextState;
 assert.deepEqual(project(closed,'A').combatLab.candidates,[
  {attackerId:'a1',targetId:'b1',diceCount:2}
 ]);
 assert.deepEqual(project(closed,'B').combatLab.candidates,[]);
 assert.equal(apply(closed,cmd('MOVE_SECTION_FOOT_PATH_V2',3,{
  unitId:'a1',path:[{col:3,row:4}]
 })).code,'MOVEMENT_PHASE_CLOSED');
 const attack=cmd('PREPARE_SECTION_RANGED_LAB',3,attackFields);
 const prepared=apply(closed,attack);
 assert.equal(prepared.accepted,true);
 assert.equal(prepared.combatResolved,false);
 const plan=prepared.nextState.combatLab.plan;
 assert.equal(plan.diceCount,2);
 assert.equal(plan.baseDice,2);
 assert.equal(plan.movedSteps,0);
 assert.equal(plan.distance,2);
 assert.deepEqual(plan.dieFaces,['LIGHT','MEDIUM','HEAVY','LEADER','FLAG','SWORDS']);
 assert.deepEqual(project(prepared.nextState,'B').combatLab.plan,plan);
 assert.deepEqual(prepared.nextState.board,ordered.board);
 assert.deepEqual(replay(initial,[...commands,close,attack]),prepared.nextState);
 assert.equal(apply(prepared.nextState,cmd('END_EXPERIMENTAL_TURN',4)).code,
  'COMBAT_PLAN_PENDING');
 const cancelled=apply(prepared.nextState,cmd('CANCEL_SECTION_RANGED_LAB',4));
 assert.equal(cancelled.accepted,true);
 assert.equal(cancelled.nextState.combatLab.plan,null);
 const finished=apply(cancelled.nextState,cmd('END_EXPERIMENTAL_TURN',5));
 assert.equal(finished.nextState.turn,'B');
 assert.deepEqual(finished.nextState.combatLab,{movementClosed:false,movement:{},plan:null});
});

test('ranged lab: movement record and forest cap limit dice; out of range and adjacent denied',()=>{
 const {ordered}=rangedLabReady(rangedLabSetup({targetCol:5}));
 const moved=apply(ordered,cmd('MOVE_SECTION_FOOT_PATH_V2',2,{
  unitId:'a1',path:[{col:3,row:4}]
 })).nextState;
 assert.deepEqual(moved.combatLab.movement.a1,{steps:1,battle:'POSSIBLE'});
 const closed=apply(moved,cmd('FINISH_SECTION_MOVEMENT_LAB',3)).nextState;
 const plan=apply(closed,cmd('PREPARE_SECTION_RANGED_LAB',4,{
  attackerId:'a1',targetId:'b1'
 })).nextState.combatLab.plan;
 assert.equal(plan.movedSteps,1);
 assert.equal(plan.diceCount,1);
 for(const [options,expected] of [
  [{terrain:[{col:4,row:4,kind:'FOREST'}]},1],
  [{targetCol:7},'TARGET_OUT_OF_RANGE'],
  [{targetCol:3},'RANGED_TARGET_ADJACENT']
 ]){
  const {ordered}=rangedLabReady(rangedLabSetup(options));
  const s=apply(ordered,cmd('FINISH_SECTION_MOVEMENT_LAB',2)).nextState;
  const r=apply(s,cmd('PREPARE_SECTION_RANGED_LAB',3,{
   attackerId:'a1',targetId:'b1'
  }));
  if(typeof expected==='number')assert.equal(r.nextState.combatLab.plan.diceCount,expected);
  else assert.equal(r.code,expected);
 }
});

function diceReady(options={}){
 const setup=rangedLabSetup(options);
 setup.enableDiceLab=true;
 if(options.victoryTargets)options={...options,elephantRetreatLeaders:true};
 if(options.elephantRetreatLeaders)options={...options,rampageLeaders:true};
 if(options.rampageLeaders)options={...options,rampage:true};
 if(options.rampage)options={...options,escape:true,lethal:true};
 if(options.escape)options={...options,retreatLeaders:true};
 setup.enableCasualtyLab=options.casualty===true||options.morale===true||options.retreat===true||options.retreatLeaders===true;
 setup.enableMoraleLab=options.morale===true||options.retreat===true||options.retreatLeaders===true;
 setup.enableRetreatLab=options.retreat===true||options.retreatLeaders===true;
 setup.enableRetreatLeaderLab=options.retreatLeaders===true;
 setup.enableLeaderEscapeLab=options.escape===true;
 setup.enableRampageLab=options.rampage===true;
 setup.enableRampageLeaderLab=options.rampageLeaders===true;
 setup.enableElephantRetreatLeaderLab=options.elephantRetreatLeaders===true;
 if(options.victoryTargets)setup.victoryTargets=options.victoryTargets;
 if(options.rampageLeaders){setup.enableLeaderLab=true;setup.board.leaders=[{id:'lone',side:'A',col:5,row:4}];}
 if(options.escape){
  setup.board.units.push({id:'escape_enemy',side:'A',col:4,row:3});
  setup.movementUnitTypes.escape_enemy='LIGHT_INFANTRY';
 }
 if(options.lethal)setup.movementUnitTypes.b1='ELEPHANT';
 if(options.blockRetreat){
  // Keep the shooter two hexes from the target and every rear blocker.
  // Otherwise an adjacent enemy prevents the ranged attack before retreat.
  setup.board.units[0].row=5;
  for(const [i,c] of [{col:4,row:3},{col:3,row:3},{col:5,row:3}].entries()){
   const id='blocker'+i;setup.board.units.push({id,side:'B',...c});setup.movementUnitTypes[id]='HEAVY_INFANTRY';
  }
 }
 if(options.leader){
  setup.enableLeaderLab=true;
  setup.board.leaders=[{id:'b_leader',side:'B',col:4,row:4}];
 }
 const {initial,ordered,commands}=rangedLabReady(setup);
 const close=cmd('FINISH_SECTION_MOVEMENT_LAB',2);
 const closed=apply(ordered,close).nextState;
 const attack=cmd('PREPARE_SECTION_RANGED_LAB',3,{attackerId:'a1',targetId:'b1'});
 const result=apply(closed,attack);
 assert.equal(result.accepted,true,result.code);
 return {initial,prepared:result.nextState,commands:[...commands,close,attack]};
}

test('dice lab: physical review belongs to adversary, hits apply once and persist through replay/turn',()=>{
 const {initial,prepared,commands}=diceReady();
 assert.equal(apply(prepared,cmd('DECLARE_SECTION_RANGED_PHYSICAL_LAB',4,{
  faces:['HEAVY']
 })).code,'INVALID_PHYSICAL_DECLARATION');
 const declare=cmd('DECLARE_SECTION_RANGED_PHYSICAL_LAB',4,{faces:['HEAVY','HEAVY']});
 const declared=apply(prepared,declare).nextState;
 assert.equal(project(declared,'A').diceLab.canReview,false);
 assert.equal(project(declared,'B').diceLab.canReview,true);
 assert.equal(apply(declared,cmd('FINALIZE_SECTION_RANGED_LAB',5)).code,'PHYSICAL_REVIEW_REQUIRED');
 assert.equal(apply(declared,cmd('REVIEW_SECTION_RANGED_PHYSICAL_LAB',5,{accept:true})).code,
  'PHYSICAL_REVIEW_NOT_AVAILABLE');
 const review=cmd('REVIEW_SECTION_RANGED_PHYSICAL_LAB',5,{actor:'B',accept:true});
 const reviewed=apply(declared,review).nextState;
 assert.equal(apply(reviewed,cmd('CANCEL_SECTION_RANGED_LAB',6)).code,'RANGED_ROLL_ALREADY_CAPTURED');
 assert.equal(apply(reviewed,cmd('ROLL_SECTION_RANGED_DIGITAL_LAB',6)).code,'RANGED_ROLL_ALREADY_CAPTURED');
 const final=cmd('FINALIZE_SECTION_RANGED_LAB',6);
 const result=apply(reviewed,final);
 assert.equal(result.accepted,true);
 assert.equal(result.combatResolved,false);
 assert.equal(result.nextState.diceLab.blocks.b1,2);
 assert.equal(result.publicEvent.blocksApplied,2);
 assert.equal(apply(result.nextState,cmd('PREPARE_SECTION_RANGED_LAB',7,{
  attackerId:'a1',targetId:'b1'
 })).code,'UNIT_ALREADY_BATTLED');
 const end=cmd('END_EXPERIMENTAL_TURN',7);
 const ended=apply(result.nextState,end).nextState;
 assert.equal(project(ended,'B').board.find(u=>u.id==='b1').blocksRemaining,2);
 assert.deepEqual(ended.diceLab.resolvedUnitIds,[]);
 assert.deepEqual(replay(initial,[...commands,declare,review,final,end]),ended);
 for(const side of ['A','B'])assert.equal(JSON.stringify(project(ended,side)).includes(initial.diceLab.key),false);
});

test('dice lab: digital results are reproducible and tamper-evident; no reroll',()=>{
 const {initial,prepared,commands}=diceReady();
 const command=cmd('ROLL_SECTION_RANGED_DIGITAL_LAB',4);
 const captured=apply(prepared,command).nextState;
 assert.equal(captured.diceLab.pending.roll.verification,'SERVER_GENERATED');
 assert.equal(captured.diceLab.pending.roll.results.length,2);
 assert.deepEqual(apply(prepared,command).nextState,captured);
 assert.deepEqual(replay(initial,[...commands,command]),captured);
 assert.equal(apply(captured,cmd('ROLL_SECTION_RANGED_DIGITAL_LAB',5)).code,'RANGED_ROLL_ALREADY_CAPTURED');
 const changed=structuredClone(captured);
 changed.diceLab.pending.roll.results[0]=changed.diceLab.pending.roll.results[0]==='FLAG'?'HEAVY':'FLAG';
 assert.throws(()=>validate(changed),/INVALID_SECTION_DICE_LAB_STATE/);
});

test('dice lab: unsupported retreat, leader checks and disputed physical roll cannot apply effects',()=>{
 for(const [options,faces,accept,code] of [
  [{},['HEAVY','FLAG'],true,'RETREAT_PENDING'],
  [{leader:true},['HEAVY','SWORDS'],true,'LEADER_CHECK_PENDING'],
  [{},['HEAVY','HEAVY'],false,'PHYSICAL_ROLL_DISPUTED']
 ]){
  const {prepared}=diceReady(options);
  const declared=apply(prepared,cmd('DECLARE_SECTION_RANGED_PHYSICAL_LAB',4,{faces})).nextState;
  const reviewed=apply(declared,cmd('REVIEW_SECTION_RANGED_PHYSICAL_LAB',5,{actor:'B',accept})).nextState;
  assert.equal(apply(reviewed,cmd('FINALIZE_SECTION_RANGED_LAB',6)).code,code);
  const archived=apply(reviewed,cmd('ARCHIVE_SECTION_RANGED_LAB',6)).nextState;
  assert.equal(archived.diceLab.blocks.b1,4);
  assert.equal(archived.diceLab.last.outcome,'ARCHIVED_WITHOUT_EFFECTS');
  assert.equal(archived.diceLab.last.reason,code);
 }
});

test('casualty lab: eliminating an unaccompanied unit removes all live indexes and awards one persistent banner',()=>{
 const {initial,prepared,commands}=diceReady({casualty:true,lethal:true});
 const declare=cmd('DECLARE_SECTION_RANGED_PHYSICAL_LAB',4,{faces:['HEAVY','HEAVY']});
 const review=cmd('REVIEW_SECTION_RANGED_PHYSICAL_LAB',5,{actor:'B',accept:true});
 const final=cmd('FINALIZE_SECTION_RANGED_LAB',6);
 const end=cmd('END_EXPERIMENTAL_TURN',7);
 const declared=apply(prepared,declare).nextState;
 const reviewed=apply(declared,review).nextState;
 const result=apply(reviewed,final);
 assert.equal(result.accepted,true);
 assert.equal(result.publicEvent.unitEliminated,true);
 assert.equal(result.publicEvent.blocksRemaining,0);
 assert.equal(result.nextState.board.units.some(u=>u.id==='b1'),false);
 assert.equal(Object.hasOwn(result.nextState.footLab.unitTypes,'b1'),false);
 assert.equal(Object.hasOwn(result.nextState.diceLab.blocks,'b1'),false);
 assert.deepEqual(project(result.nextState,'B').diceLab.banners,{A:1,B:0});
 const ended=apply(result.nextState,end).nextState;
 assert.deepEqual(project(ended,'A').diceLab.banners,{A:1,B:0});
 assert.deepEqual(replay(initial,[...commands,declare,review,final,end]),ended);
});

test('casualty lab: separate digital leader check cannot be skipped or repeated; replay preserves results',()=>{
 for(const [key,lethal,leaderDies] of [
  ['1f'.repeat(32),false,true],['00'.repeat(32),false,false],
  ['1f'.repeat(32),true,true],['00'.repeat(32),true,false]
 ]){
  const {initial,prepared,commands}=diceReady({casualty:true,leader:true,lethal});
  // Explicit deterministic fixture key, never accepted over HTTP.
  initial.diceLab.key=key;prepared.diceLab.key=key;
  const declare=cmd('DECLARE_SECTION_RANGED_PHYSICAL_LAB',4,{faces:['HEAVY','HEAVY']});
  const review=cmd('REVIEW_SECTION_RANGED_PHYSICAL_LAB',5,{actor:'B',accept:true});
  const declared=apply(prepared,declare).nextState;
  const reviewed=apply(declared,review).nextState;
  assert.equal(apply(reviewed,cmd('FINALIZE_SECTION_RANGED_LAB',6)).code,'LEADER_CHECK_PENDING');
  assert.equal(apply(reviewed,cmd('ARCHIVE_SECTION_RANGED_LAB',6)).code,'LEADER_CHECK_REQUIRED');
  assert.equal(project(reviewed,'A').diceLab.canRollLeader,true);
  assert.equal(project(reviewed,'B').diceLab.canRollLeader,false);
  const roll=cmd('ROLL_SECTION_LEADER_CASUALTY_LAB',6);
  const checked=apply(reviewed,roll).nextState;
  assert.equal(checked.diceLab.leaderCheck.roll.diceCount,lethal?1:2);
  assert.equal(checked.diceLab.leaderCheck.outcome.leaderWouldBeEliminated,leaderDies);
  assert.equal(apply(checked,cmd('ROLL_SECTION_LEADER_CASUALTY_LAB',7)).code,'LEADER_CHECK_ALREADY_CAPTURED');
  const final=cmd('FINALIZE_SECTION_RANGED_LAB',7);
  const result=apply(checked,final);
  if(lethal&&!leaderDies){
   assert.equal(result.code,'LEADER_EVASION_PENDING');
   assert.equal(apply(checked,cmd('END_EXPERIMENTAL_TURN',7)).code,'COMBAT_PLAN_PENDING');
   assert.deepEqual(replay(initial,[...commands,declare,review,roll]),checked);
    const own=project(checked,'B').diceLab,other=project(checked,'A').diceLab;
    assert.equal(own.canEvadeLeader,true);
    assert.equal(other.canEvadeLeader,false);
    assert.deepEqual(other.leaderEvasionOptions,[]);
    const option=own.leaderEvasionOptions.find(o=>!o.exit&&o.path.length===1);
    assert.ok(option);
    assert.equal(apply(checked,cmd('EVADE_SECTION_LEADER_LAB',7,option)).code,'LEADER_EVASION_NOT_AVAILABLE');
    assert.equal(apply(checked,cmd('EVADE_SECTION_LEADER_LAB',7,{actor:'B',path:[{col:4,row:5}],exit:false})).code,'INVALID_LEADER_EVASION_PATH');
    const evade=cmd('EVADE_SECTION_LEADER_LAB',7,{actor:'B',...option});
    const resolved=apply(checked,evade);
    assert.equal(resolved.accepted,true);
    assert.equal(resolved.nextState.board.units.some(u=>u.id==='b1'),false);
    assert.deepEqual(resolved.nextState.board.leaders[0],{id:'b_leader',side:'B',...option.path.at(-1)});
    assert.deepEqual(project(resolved.nextState,'A').diceLab.banners,{A:1,B:0});
    assert.equal(resolved.nextState.turn,'A');
    assert.equal(resolved.nextState.combatLab.plan,null);
    assert.deepEqual(replay(initial,[...commands,declare,review,roll,evade]),resolved.nextState);
  }else{
   assert.equal(result.accepted,true);
   assert.equal(result.nextState.board.leaders.length,leaderDies?0:1);
   assert.equal(project(result.nextState,'A').diceLab.banners.A,Number(leaderDies)+Number(lethal));
   assert.deepEqual(replay(initial,[...commands,declare,review,roll,final]),result.nextState);
  }
 }
});

test('morale lab: attached surviving leader can ignore a flag after an accepted hit; choice replays',()=>{
 const {initial,prepared,commands}=diceReady({morale:true,leader:true});
 initial.diceLab.key='00'.repeat(32);prepared.diceLab.key=initial.diceLab.key;
 const declare=cmd('DECLARE_SECTION_RANGED_PHYSICAL_LAB',4,{faces:['HEAVY','FLAG']});
 const review=cmd('REVIEW_SECTION_RANGED_PHYSICAL_LAB',5,{actor:'B',accept:true});
 const roll=cmd('ROLL_SECTION_LEADER_CASUALTY_LAB',6);
 const reviewed=apply(apply(prepared,declare).nextState,review).nextState;
 assert.equal(project(reviewed,'B').diceLab.blocker,'LEADER_CHECK_PENDING');
 const checked=apply(reviewed,roll).nextState;
 assert.equal(checked.diceLab.leaderCheck.outcome.leaderWouldBeEliminated,false);
 assert.equal(project(checked,'B').diceLab.moralePreview.maxIgnored,1);
 assert.equal(project(checked,'A').diceLab.canChooseMorale,false);
 assert.equal(apply(checked,cmd('ARCHIVE_SECTION_RANGED_LAB',7)).code,'MORALE_CHOICE_REQUIRED');
 assert.equal(apply(checked,cmd('CHOOSE_SECTION_MORALE_LAB',7,{actor:'B',ignored:2})).code,'INVALID_MORALE_CHOICE');
 const accept=apply(checked,cmd('CHOOSE_SECTION_MORALE_LAB',7,{actor:'B',ignored:0})).nextState;
 assert.equal(project(accept,'B').diceLab.blocker,'RETREAT_PENDING');
 const choose=cmd('CHOOSE_SECTION_MORALE_LAB',7,{actor:'B',ignored:1});
 const chosen=apply(checked,choose).nextState;
 assert.equal(project(chosen,'A').diceLab.canFinalize,true);
 assert.equal(apply(chosen,cmd('CHOOSE_SECTION_MORALE_LAB',8,{actor:'B',ignored:0})).code,'MORALE_CHOICE_NOT_AVAILABLE');
 const final=cmd('FINALIZE_SECTION_RANGED_LAB',8);
 const done=apply(chosen,final).nextState;
 assert.equal(done.diceLab.blocks.b1,3);
 assert.equal(done.diceLab.last.morale.ignored,1);
 assert.deepEqual(replay(initial,[...commands,declare,review,roll,choose,final]),done);
});

test('retreat lab: defender chooses a loss-free path, applies hits and movement together, and replays',()=>{
 const {initial,prepared,commands}=diceReady({retreat:true});
 const declare=cmd('DECLARE_SECTION_RANGED_PHYSICAL_LAB',4,{faces:['HEAVY','FLAG']});
 const review=cmd('REVIEW_SECTION_RANGED_PHYSICAL_LAB',5,{actor:'B',accept:true});
 const pending=apply(apply(prepared,declare).nextState,review).nextState;
 const own=project(pending,'B').diceLab;
 assert.equal(own.retreat.required,1);
 assert.equal(own.canRetreat,true);
 assert.equal(project(pending,'A').diceLab.canRetreat,false);
 const option=own.retreat.options[0];
 assert.equal(option.blocksLost,0);
 assert.equal(apply(pending,cmd('RETREAT_SECTION_UNIT_LAB',6,{path:option.path})).code,'RETREAT_NOT_AVAILABLE');
 assert.equal(apply(pending,cmd('RETREAT_SECTION_UNIT_LAB',6,{actor:'B',path:[]})).code,'INVALID_RETREAT_PATH');
 assert.equal(apply(pending,cmd('ARCHIVE_SECTION_RANGED_LAB',6)).code,'RETREAT_PENDING');
 const retreat=cmd('RETREAT_SECTION_UNIT_LAB',6,{actor:'B',path:option.path});
 const result=apply(pending,retreat);
 assert.equal(result.accepted,true);
 assert.deepEqual(result.nextState.board.units.find(u=>u.id==='b1'),{id:'b1',side:'B',...option.path.at(-1)});
 assert.equal(result.nextState.diceLab.blocks.b1,3);
 assert.equal(result.nextState.combatLab.plan,null);
 assert.deepEqual(replay(initial,[...commands,declare,review,retreat]),result.nextState);
});

test('retreat leader lab: flags alone cause a separate two-dice check only after route confirmation',()=>{
 const {initial,prepared,commands}=diceReady({retreatLeaders:true,leader:true,blockRetreat:true});
 const declare=cmd('DECLARE_SECTION_RANGED_PHYSICAL_LAB',4,{faces:['FLAG','FLAG']});
 const review=cmd('REVIEW_SECTION_RANGED_PHYSICAL_LAB',5,{actor:'B',accept:true});
 const choose=cmd('CHOOSE_SECTION_MORALE_LAB',6,{actor:'B',ignored:0});
 const decided=apply(apply(apply(prepared,declare).nextState,review).nextState,choose).nextState;
 const route=project(decided,'B').diceLab.retreat.options[0];
 assert.equal(route.blocksLost,2);
 const retreat=cmd('RETREAT_SECTION_UNIT_LAB',7,{actor:'B',path:route.path});
 const staged=apply(decided,retreat).nextState;
 assert.equal(staged.diceLab.blocks.b1,4);
 assert.equal(project(staged,'A').diceLab.canRollLeader,true);
 assert.equal(apply(staged,cmd('FINALIZE_SECTION_RANGED_LAB',8)).code,'LEADER_CHECK_PENDING');
 const roll=cmd('ROLL_SECTION_LEADER_CASUALTY_LAB',8);
 const checked=apply(staged,roll).nextState;
 assert.equal(checked.diceLab.retreatPending.leaderCheck.roll.diceCount,2);
 assert.equal(apply(checked,cmd('ROLL_SECTION_LEADER_CASUALTY_LAB',9)).code,'LEADER_CHECK_ALREADY_CAPTURED');
 const final=cmd('FINALIZE_SECTION_RANGED_LAB',9);
 const done=apply(checked,final).nextState;
 assert.equal(done.diceLab.blocks.b1,2);
 assert.equal(done.diceLab.retreatPending,null);
 assert.deepEqual(replay(initial,[...commands,declare,review,choose,retreat,roll,final]),done);
});

test('leader escape lab: selected risky route uses server dice, resolves once and replays',()=>{
 const {initial,prepared,commands}=diceReady({escape:true,lethal:true,leader:true});
 initial.diceLab.key='00'.repeat(32);prepared.diceLab.key=initial.diceLab.key;
 const declare=cmd('DECLARE_SECTION_RANGED_PHYSICAL_LAB',4,{faces:['HEAVY','HEAVY']});
 const review=cmd('REVIEW_SECTION_RANGED_PHYSICAL_LAB',5,{actor:'B',accept:true});
 const roll=cmd('ROLL_SECTION_LEADER_CASUALTY_LAB',6);
 const checked=apply(apply(apply(prepared,declare).nextState,review).nextState,roll).nextState;
 const option=project(checked,'B').diceLab.leaderEvasionOptions.find(o=>o.risks.length);
 assert.ok(option);
 assert.equal(option.risks[0].diceCount,2);
 const evade=cmd('EVADE_SECTION_LEADER_LAB',7,{actor:'B',path:option.path,exit:option.exit});
 const result=apply(checked,evade);
 assert.equal(result.accepted,true);
 const escaped=result.nextState.diceLab.last.leaderEvasion.escape;
 assert.equal(escaped.rolls[0].results.length,2);
 assert.equal(result.nextState.diceLab.casualties.length,escaped.eliminated?2:1);
 assert.deepEqual(replay(initial,[...commands,declare,review,roll,evade]),result.nextState);
});

test('elephant rampage lab: attacker orders two-dice rolls before defender retreats, replay persists effects',()=>{
 const {initial,prepared,commands}=diceReady({rampage:true});
 const declare=cmd('DECLARE_SECTION_RANGED_PHYSICAL_LAB',4,{faces:['FLAG','SWORDS']});
 const review=cmd('REVIEW_SECTION_RANGED_PHYSICAL_LAB',5,{actor:'B',accept:true});
 const pending=apply(apply(prepared,declare).nextState,review).nextState;
 const view=project(pending,'A').diceLab;
 assert.equal(view.rampage.canRoll,true);
 assert.equal(project(pending,'B').diceLab.canRetreat,false);
 assert.equal(apply(pending,cmd('ARCHIVE_SECTION_RANGED_LAB',6)).code,'ELEPHANT_RAMPAGE_PENDING');
 const roll=cmd('ROLL_SECTION_ELEPHANT_RAMPAGE_LAB',6,{unitId:'escape_enemy'});
 const staged=apply(pending,roll).nextState;
 assert.equal(staged.diceLab.rampage[0].results.length,2);
 assert.equal(staged.diceLab.blocks.escape_enemy,4);
 assert.equal(apply(staged,cmd('ROLL_SECTION_ELEPHANT_RAMPAGE_LAB',7,{unitId:'escape_enemy'})).code,'INVALID_RAMPAGE_TARGET');
 const option=project(staged,'B').diceLab.retreat.options[0];
 const retreat=cmd('RETREAT_SECTION_UNIT_LAB',7,{actor:'B',path:option.path});
 const done=apply(staged,retreat).nextState;
 assert.equal(done.diceLab.blocks.escape_enemy,4-staged.diceLab.rampage[0].blocksLost);
 assert.equal(done.diceLab.last.rampage.length,1);
 assert.deepEqual(replay(initial,[...commands,declare,review,roll,retreat]),done);
});

test('rampage leader lab: lone adjacent leader rolls and if surviving must evade before further rolls',()=>{
 const {initial,prepared,commands}=diceReady({rampageLeaders:true});
 const declare=cmd('DECLARE_SECTION_RANGED_PHYSICAL_LAB',4,{faces:['FLAG','SWORDS']});
 const review=cmd('REVIEW_SECTION_RANGED_PHYSICAL_LAB',5,{actor:'B',accept:true});
 const pending=apply(apply(prepared,declare).nextState,review).nextState;
 const roll=cmd('ROLL_SECTION_ELEPHANT_RAMPAGE_LAB',6,{unitId:'lone'});
 const staged=apply(pending,roll).nextState;
 assert.equal(staged.diceLab.rampage[0].leaderId,'lone');
 const commandsAfter=[roll];
 let current=staged;
 if(staged.diceLab.rampage[0].needsEvasion){
  const evasion=project(staged,'A').diceLab.rampage.evasion;
  assert.ok(evasion.options.length);
  assert.equal(project(staged,'B').diceLab.rampage.evasion.options.length,0);
  assert.equal(apply(staged,cmd('ROLL_SECTION_ELEPHANT_RAMPAGE_LAB',7,{unitId:'escape_enemy'})).code,'RAMPAGE_LEADER_EVASION_PENDING');
  const o=evasion.options[0],evade=cmd('EVADE_SECTION_RAMPAGE_LEADER_LAB',7,{path:o.path,exit:o.exit});
  current=apply(staged,evade).nextState;commandsAfter.push(evade);
 }
 assert.equal(project(current,'A').diceLab.rampage.canRoll,true);
 assert.deepEqual(replay(initial,[...commands,declare,review,...commandsAfter]),current);
});

test('elephant retreat leader lab: attached leader can accompany elephant after rampage',()=>{
 const {initial,prepared,commands}=diceReady({elephantRetreatLeaders:true,leader:true});
 const declare=cmd('DECLARE_SECTION_RANGED_PHYSICAL_LAB',4,{faces:['FLAG','SWORDS']});
 const review=cmd('REVIEW_SECTION_RANGED_PHYSICAL_LAB',5,{actor:'B',accept:true});
 const pending=apply(apply(prepared,declare).nextState,review).nextState;
 const roll=cmd('ROLL_SECTION_ELEPHANT_RAMPAGE_LAB',6,{unitId:'escape_enemy'});
 const staged=apply(pending,roll).nextState;
 const o=project(staged,'B').diceLab.retreat.options.find(o=>o.path.length===1);
 assert.ok(o);
 const retreat=cmd('RETREAT_SECTION_UNIT_LAB',7,{actor:'B',path:o.path});
 const done=apply(staged,retreat).nextState;
 const elephant=done.board.units.find(u=>u.id==='b1'),leader=done.board.leaders.find(l=>l.id==='b_leader');
 assert.deepEqual([leader.col,leader.row],[elephant.col,elephant.row]);
 assert.deepEqual(replay(initial,[...commands,declare,review,roll,retreat]),done);
});

test('victory lab: accepted lethal roll wins immediately, freezes commands and replays',()=>{
 const {initial,prepared,commands}=diceReady({victoryTargets:{A:1,B:2}});
 const declare=cmd('DECLARE_SECTION_RANGED_PHYSICAL_LAB',4,{faces:['HEAVY','HEAVY']});
 const review=cmd('REVIEW_SECTION_RANGED_PHYSICAL_LAB',5,{actor:'B',accept:true});
 const declared=apply(prepared,declare).nextState;
 assert.equal(project(declared,'A').diceLab.victory.winner,null);
 const result=apply(declared,review),done=result.nextState;
 assert.equal(result.publicEvent.victory.winner,'A');
 assert.equal(done.combatLab.plan,null);
 assert.equal(project(done,'B').diceLab.victory.winner,'A');
 assert.equal(apply(done,cmd('END_EXPERIMENTAL_TURN',6)).code,'MATCH_FINISHED');
 assert.deepEqual(replay(initial,[...commands,declare,review]),done);
});

test('section history limit: final valid revision remains readable and replayable; no next command',()=>{
 const {initial,prepared,commands}=diceReady();
 let current=prepared;const log=[...commands];
 while(current.revision<SECTION_HISTORY_MAX_COMMANDS){
  const command=current.combatLab.plan
   ?cmd('CANCEL_SECTION_RANGED_LAB',current.revision)
   :cmd('PREPARE_SECTION_RANGED_LAB',current.revision,{attackerId:'a1',targetId:'b1'});
  const result=apply(current,command);assert.equal(result.accepted,true,result.code);
  current=result.nextState;log.push(command);
 }
 assert.equal(current.revision,SECTION_HISTORY_MAX_COMMANDS);
 assert.equal(project(current,'A').historyLimitReached,true);
 assert.deepEqual(replay(initial,log),current);
 assert.equal(apply(current,cmd('CANCEL_SECTION_RANGED_LAB',current.revision)).code,'SECTION_HISTORY_LIMIT_REACHED');
 assert.throws(()=>replay(initial,[...log,cmd('CANCEL_SECTION_RANGED_LAB',current.revision)]),/INVALID_SECTION_HISTORY_REPLAY/);
});

test('V11 close: server derives dice, applies swords and helmets, requires defender decision, replays',()=>{
 const c=rangedLabSetup({targetCol:3});
 Object.assign(c,{enableLeaderLab:true,enableDiceLab:true,enableCasualtyLab:true,enableMoraleLab:true,
   enableRetreatLab:true,enableRetreatLeaderLab:true,enableLeaderEscapeLab:true,enableRampageLab:true,
   enableRampageLeaderLab:true,enableElephantRetreatLeaderLab:true,enableCloseCombatLab:true,victoryTargets:{A:3,B:3}});
 c.movementUnitTypes.a1='HEAVY_INFANTRY';
 c.board.leaders=[{id:'a_leader',side:'A',col:2,row:4}];
 const {initial,ordered,commands}=rangedLabReady(c);
 const close=cmd('FINISH_SECTION_MOVEMENT_LAB',2);
 const closed=apply(ordered,close).nextState;
 const prepare=cmd('PREPARE_SECTION_CLOSE_LAB',3,{attackerId:'a1',targetId:'b1'});
 assert.equal(project(closed,'A').combatLab.candidates[0].diceCount,5);
 assert.deepEqual(project(closed,'B').combatLab.candidates,[]);
 const p=apply(closed,prepare);
 assert.equal(p.accepted,true,p.code);assert.equal(p.nextState.combatLab.plan.leaderHit,true);
 const declare=cmd('DECLARE_SECTION_RANGED_PHYSICAL_LAB',4,{faces:['SWORDS','LEADER','LIGHT','MEDIUM','LIGHT']});
 const declared=apply(p.nextState,declare).nextState;
 assert.equal(declared.diceLab.pending.interpretation.hits,2);
 const review=cmd('REVIEW_SECTION_RANGED_PHYSICAL_LAB',5,{actor:'B',accept:true});
 const reviewed=apply(declared,review).nextState;
 const final=cmd('FINALIZE_SECTION_RANGED_LAB',6);
 const resolved=apply(reviewed,final).nextState;
 assert.equal(resolved.diceLab.blocks.b1,2);
 assert.equal(project(resolved,'B').diceLab.canDeclineBattleBack,true);
 assert.equal(apply(resolved,cmd('END_EXPERIMENTAL_TURN',7)).code,'BATTLE_BACK_PENDING');
 assert.equal(apply(resolved,cmd('DECLINE_SECTION_BATTLE_BACK_LAB',7)).code,'BATTLE_BACK_NOT_AVAILABLE');
 const decline=cmd('DECLINE_SECTION_BATTLE_BACK_LAB',7,{actor:'B'});
 const done=apply(resolved,decline).nextState;
 assert.equal(done.diceLab.last.battleBackPending,false);
 assert.deepEqual(replay(initial,[...commands,close,prepare,declare,review,final,decline]),done);
 c.enableCloseCombatLab=false;
 const old=rangedLabReady(c);
 assert.equal(apply(apply(old.ordered,close).nextState,prepare).code,'CLOSE_COMBAT_NOT_AVAILABLE');
});

test('V12 unit evade: decision precedes dice, only color hits, survives and moves, no battle back',()=>{
 const c=rangedLabSetup({targetCol:3});
 Object.assign(c,{enableDiceLab:true,enableCasualtyLab:true,enableMoraleLab:true,enableRetreatLab:true,
   enableRetreatLeaderLab:true,enableLeaderEscapeLab:true,enableRampageLab:true,enableRampageLeaderLab:true,
   enableElephantRetreatLeaderLab:true,enableCloseCombatLab:true,enableUnitEvadeLab:true,victoryTargets:{A:3,B:3}});
 c.movementUnitTypes.a1='HEAVY_INFANTRY';c.movementUnitTypes.b1='LIGHT_INFANTRY';
 const {initial,ordered,commands}=rangedLabReady(c);
 const close=cmd('FINISH_SECTION_MOVEMENT_LAB',2);
 const closed=apply(ordered,close).nextState;
 const prepare=cmd('PREPARE_SECTION_CLOSE_LAB',3,{attackerId:'a1',targetId:'b1'});
 const prepared=apply(closed,prepare).nextState;
 const plan=prepared.combatLab.plan,path=plan.evadeOptions[0];
 assert.equal(path.length,2);
 assert.equal(project(prepared,'B').diceLab.canChooseUnitEvade,true);
 assert.equal(apply(prepared,cmd('ROLL_SECTION_RANGED_DIGITAL_LAB',4)).code,'UNIT_EVADE_CHOICE_PENDING');
 assert.equal(apply(prepared,cmd('CHOOSE_SECTION_UNIT_EVADE_LAB',4,{path})).code,'UNIT_EVADE_NOT_AVAILABLE');
 assert.equal(apply(prepared,cmd('CHOOSE_SECTION_UNIT_EVADE_LAB',4,{actor:'B',path:[{col:12,row:8}]})).code,'INVALID_UNIT_EVADE_PATH');
 const choose=cmd('CHOOSE_SECTION_UNIT_EVADE_LAB',4,{actor:'B',path});
 const chosen=apply(prepared,choose).nextState;
 const declare=cmd('DECLARE_SECTION_RANGED_PHYSICAL_LAB',5,{faces:['LIGHT','SWORDS','LEADER','FLAG','HEAVY']});
 const declared=apply(chosen,declare).nextState;
 assert.equal(declared.diceLab.pending.interpretation.hits,1);
 assert.equal(declared.diceLab.pending.interpretation.flagsPending,0);
 const review=cmd('REVIEW_SECTION_RANGED_PHYSICAL_LAB',6,{actor:'B',accept:true});
 const reviewed=apply(declared,review).nextState;
 const final=cmd('FINALIZE_SECTION_RANGED_LAB',7);
 const done=apply(reviewed,final).nextState;
 assert.equal(done.diceLab.blocks.b1,3);
 assert.deepEqual(done.board.units.find(u=>u.id==='b1'),{id:'b1',side:'B',...path.at(-1)});
 assert.equal(done.diceLab.last.battleBackPending,false);
 assert.deepEqual(replay(initial,[...commands,close,prepare,choose,declare,review,final]),done);
 const stand=apply(prepared,cmd('CHOOSE_SECTION_UNIT_EVADE_LAB',4,{actor:'B',path:[]})).nextState;
 assert.deepEqual(stand.combatLab.plan.evadePath,[]);
});

test('V13 battle back: reversed combat roles, no extra orders or recursion, replay and victory',()=>{
 for(const outcome of ['HIT','WIN','RETREAT']){
  const winning=outcome==='WIN';
  const c=rangedLabSetup({targetCol:3});
  Object.assign(c,{enableDiceLab:true,enableCasualtyLab:true,enableMoraleLab:true,
    enableRetreatLab:true,enableRetreatLeaderLab:true,enableLeaderEscapeLab:true,enableRampageLab:true,
    enableRampageLeaderLab:true,enableElephantRetreatLeaderLab:true,enableCloseCombatLab:true,
    enableUnitEvadeLab:true,enableBattleBackLab:true,victoryTargets:{A:3,B:winning?1:3}});
  c.movementUnitTypes.a1='HEAVY_INFANTRY';
  const {initial,ordered,commands}=rangedLabReady(c);
  const log=[...commands];let s=ordered;
  const run=(type,fields={})=>{const command=cmd(type,s.revision,fields),result=apply(s,command);
    assert.equal(result.accepted,true,result.code);log.push(command);s=result.nextState;};
  run('FINISH_SECTION_MOVEMENT_LAB');
  run('PREPARE_SECTION_CLOSE_LAB',{attackerId:'a1',targetId:'b1'});
  run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{faces:['LIGHT','LIGHT','LIGHT','LIGHT','LIGHT']});
  run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{actor:'B',accept:true});
  run('FINALIZE_SECTION_RANGED_LAB');
  assert.equal(project(s,'B').diceLab.canAcceptBattleBack,true);
  assert.equal(apply(s,cmd('ACCEPT_SECTION_BATTLE_BACK_LAB',s.revision)).code,'BATTLE_BACK_NOT_AVAILABLE');
  run('ACCEPT_SECTION_BATTLE_BACK_LAB',{actor:'B'});
  assert.equal(s.turn,'A');assert.equal(s.combatLab.plan.battleBack,true);
  assert.equal(s.combatLab.plan.attackerId,'b1');assert.equal(s.combatLab.plan.diceCount,5);
  assert.equal(project(s,'B').diceLab.combatSide,'B');
  assert.equal(apply(s,cmd('ROLL_SECTION_RANGED_DIGITAL_LAB',s.revision)).code,'NOT_YOUR_TURN');
  assert.equal(apply(s,cmd('CANCEL_SECTION_RANGED_LAB',s.revision)).code,'CLOSE_ATTACK_DECLARED');
  assert.equal(apply(s,cmd('END_EXPERIMENTAL_TURN',s.revision)).code,'COMBAT_PLAN_PENDING');
  run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{actor:'B',faces:winning?['HEAVY','HEAVY','HEAVY','HEAVY','LIGHT']:outcome==='RETREAT'?['HEAVY','FLAG','LIGHT','LIGHT','LIGHT']:['HEAVY','LIGHT','LIGHT','LIGHT','LIGHT']});
  assert.equal(project(s,'A').diceLab.canReview,true);
  assert.equal(project(s,'B').diceLab.canReview,false);
  run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{accept:true});
  if(outcome==='RETREAT'){
    assert.equal(project(s,'A').diceLab.canRetreat,true);
    assert.equal(project(s,'B').diceLab.canRetreat,false);
    const option=project(s,'A').diceLab.retreat.options.find(o=>o.blocksLost===0);
    assert.ok(option);
    assert.equal(apply(s,cmd('RETREAT_SECTION_UNIT_LAB',s.revision,{actor:'B',path:option.path})).code,'RETREAT_NOT_AVAILABLE');
    run('RETREAT_SECTION_UNIT_LAB',{path:option.path});
    assert.deepEqual(s.board.units.find(u=>u.id==='a1'),{id:'a1',side:'A',...option.path.at(-1)});
  }else if(!winning)run('FINALIZE_SECTION_RANGED_LAB',{actor:'B'});
  assert.equal(s.diceLab.blocks.a1,winning?undefined:3);
  assert.deepEqual(s.diceLab.resolvedUnitIds,['a1']);
  assert.equal(s.diceLab.last.attackKind,'BATTLE_BACK');
  assert.equal(s.diceLab.last.battleBackPending,false);
  assert.equal(s.combatLab.plan,null);
  assert.equal(project(s,'A').diceLab.victory.winner,winning?'B':null);
  assert.equal(s.turn,'A');
  assert.deepEqual(replay(initial,log),s);
 }
});

test('V14 momentum: advance, decline, cavalry extra step, terrain stop, evade and replay',()=>{
 for(const mode of ['FOOT','LEADER','DECLINE','CAVALRY','FOREST','BROKEN','EVADE','WIN','BATTLE_BACK']){
  const c=rangedLabSetup({targetCol:3,terrain:['FOREST','BROKEN'].includes(mode)?[{col:3,row:4,kind:mode==='FOREST'?'FOREST':'BROKEN_GROUND'}]:[]});
  Object.assign(c,{enableDiceLab:true,enableCasualtyLab:true,enableMoraleLab:true,enableRetreatLab:true,
    enableRetreatLeaderLab:true,enableLeaderEscapeLab:true,enableRampageLab:true,enableRampageLeaderLab:true,
    enableElephantRetreatLeaderLab:true,enableCloseCombatLab:true,enableUnitEvadeLab:true,enableBattleBackLab:true,
    enableMomentumLab:true,victoryTargets:{A:mode==='WIN'?1:3,B:3}});
  c.movementUnitTypes.a1=['CAVALRY','FOREST','BROKEN'].includes(mode)?'HEAVY_CAVALRY':'HEAVY_INFANTRY';
  if(mode==='LEADER'){c.enableLeaderLab=true;c.board.leaders=[{id:'a_leader',side:'A',col:2,row:4}];}
  if(mode==='EVADE')c.movementUnitTypes.b1='LIGHT_INFANTRY';
  const {initial,ordered,commands}=rangedLabReady(c);let s=ordered;const log=[...commands];
  const run=(type,fields={})=>{const command=cmd(type,s.revision,fields),result=apply(s,command);
    assert.equal(result.accepted,true,result.code);log.push(command);s=result.nextState;};
  run('FINISH_SECTION_MOVEMENT_LAB');run('PREPARE_SECTION_CLOSE_LAB',{attackerId:'a1',targetId:'b1'});
  if(mode==='EVADE')run('CHOOSE_SECTION_UNIT_EVADE_LAB',{actor:'B',path:s.combatLab.plan.evadeOptions[0]});
  const n=s.combatLab.plan.diceCount;
  run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{faces:Array(n).fill(mode==='EVADE'||mode==='BATTLE_BACK'?'LIGHT':['FOREST','BROKEN'].includes(mode)?'FLAG':'HEAVY')});
  run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{actor:'B',accept:true});
  if(['FOREST','BROKEN'].includes(mode)){
    const opt=project(s,'B').diceLab.retreat.options.find(o=>o.blocksLost===0);
    assert.ok(opt);run('RETREAT_SECTION_UNIT_LAB',{actor:'B',path:opt.path});
  }else if(mode!=='WIN')run('FINALIZE_SECTION_RANGED_LAB');
  if(mode==='BATTLE_BACK'){
    run('ACCEPT_SECTION_BATTLE_BACK_LAB',{actor:'B'});
    run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{actor:'B',faces:['FLAG','LIGHT','LIGHT','LIGHT','LIGHT']});
    run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{accept:true});
    const opt=project(s,'A').diceLab.retreat.options.find(o=>o.blocksLost===0);
    assert.ok(opt);run('RETREAT_SECTION_UNIT_LAB',{path:opt.path});
  }
  if(['EVADE','WIN','BATTLE_BACK'].includes(mode)){
    assert.equal(project(s,'A').diceLab.momentumPending,false);
  }else{
    const p=project(s,'A').diceLab;
    assert.equal(p.canChooseMomentum,true);assert.deepEqual(project(s,'B').diceLab.momentumOptions,[]);
    assert.equal(apply(s,cmd('END_EXPERIMENTAL_TURN',s.revision)).code,'MOMENTUM_DECISION_PENDING');
    assert.equal(apply(s,cmd('CHOOSE_SECTION_MOMENTUM_LAB',s.revision,{path:[{col:12,row:8}]})).code,'INVALID_MOMENTUM_PATH');
    assert.equal(apply(s,cmd('CHOOSE_SECTION_MOMENTUM_LAB',s.revision,{actor:'B',path:[]})).code,'NOT_YOUR_TURN');
    assert.equal(p.momentumOptions.some(o=>o.path.length===2),mode==='CAVALRY');
    const chosen=mode==='DECLINE'?[]:mode==='CAVALRY'?p.momentumOptions.find(o=>o.path.length===2&&o.path[1].col===2&&o.path[1].row===4).path:p.momentumOptions[0].path;
    if(['FOREST','BROKEN'].includes(mode))assert.equal(p.momentumOptions[0].bonusEligible,false);
    if(mode==='LEADER')assert.equal(p.momentumOptions[0].bonusEligible,true);
    run('CHOOSE_SECTION_MOMENTUM_LAB',{path:chosen});
    assert.equal(project(s,'A').diceLab.momentumPending,false);
    const end=chosen.at(-1)??{col:2,row:4};assert.deepEqual(s.board.units.find(u=>u.id==='a1'),{id:'a1',side:'A',...end});
    if(mode==='LEADER')assert.deepEqual(s.board.leaders.find(l=>l.id==='a_leader'),{id:'a_leader',side:'A',...end});
    assert.deepEqual(s.diceLab.resolvedUnitIds,['a1']);
    assert.equal(apply(s,cmd('CHOOSE_SECTION_MOMENTUM_LAB',s.revision,{path:chosen})).code,'MOMENTUM_NOT_AVAILABLE');
  }
  assert.deepEqual(replay(initial,log),s);
 }
});

test('V15 bonus close: same ordered unit, new adjacent target, second advance, defense, decline and replay',()=>{
 for(const mode of ['SECOND_ADVANCE','DECLINE','BATTLE_BACK','EVADE','NO_TARGET','FOOT','LEADER','WIN']){
  const c=rangedLabSetup({targetCol:3});
  Object.assign(c,{enableDiceLab:true,enableCasualtyLab:true,enableMoraleLab:true,enableRetreatLab:true,
    enableRetreatLeaderLab:true,enableLeaderEscapeLab:true,enableRampageLab:true,enableRampageLeaderLab:true,
    enableElephantRetreatLeaderLab:true,enableCloseCombatLab:true,enableUnitEvadeLab:true,enableBattleBackLab:true,
    enableMomentumLab:true,enableBonusCloseLab:true,victoryTargets:{A:mode==='WIN'?2:3,B:3}});
  c.movementUnitTypes.a1=['FOOT','LEADER'].includes(mode)?'HEAVY_INFANTRY':'HEAVY_CAVALRY';
  if(mode==='LEADER'){c.enableLeaderLab=true;c.board.leaders=[{id:'a_leader',side:'A',col:2,row:4}];}
  if(mode!=='NO_TARGET'){
    c.board.units.push({id:'b2',side:'B',col:4,row:4});c.movementUnitTypes.b2=mode==='EVADE'?'LIGHT_INFANTRY':'HEAVY_INFANTRY';
  }
  const {initial,ordered,commands}=rangedLabReady(c);let s=ordered;const log=[...commands];
  const run=(type,fields={})=>{const command=cmd(type,s.revision,fields),result=apply(s,command);
    assert.equal(result.accepted,true,result.code);log.push(command);s=result.nextState;};
  run('FINISH_SECTION_MOVEMENT_LAB');run('PREPARE_SECTION_CLOSE_LAB',{attackerId:'a1',targetId:'b1'});
  run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{faces:Array(s.combatLab.plan.diceCount).fill('HEAVY')});
  run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{actor:'B',accept:true});run('FINALIZE_SECTION_RANGED_LAB');
  run('CHOOSE_SECTION_MOMENTUM_LAB',{path:[{col:3,row:4}]});
  if(['NO_TARGET','FOOT'].includes(mode)){
    assert.equal(project(s,'A').diceLab.bonusClosePending,false);
    assert.equal(project(s,'A').combatLab.candidates.length,0);
  }else{
    assert.equal(project(s,'A').diceLab.bonusClosePending,true);
    assert.equal(project(s,'A').combatLab.candidates.length,1);
    assert.equal(project(s,'A').combatLab.candidates[0].bonusClose,true);
    assert.deepEqual(project(s,'B').combatLab.candidates,[]);
    assert.equal(apply(s,cmd('END_EXPERIMENTAL_TURN',s.revision)).code,'BONUS_CLOSE_DECISION_PENDING');
    assert.equal(apply(s,cmd('PREPARE_SECTION_CLOSE_LAB',s.revision,{attackerId:'other',targetId:'b2'})).code,'BONUS_CLOSE_NOT_AVAILABLE');
    if(mode==='DECLINE')run('DECLINE_SECTION_BONUS_CLOSE_LAB');
    else {
      run('PREPARE_SECTION_CLOSE_LAB',{attackerId:'a1',targetId:'b2'});
      assert.equal(s.combatLab.plan.bonusClose,true);
      assert.equal(apply(s,cmd('CANCEL_SECTION_RANGED_LAB',s.revision)).code,'CLOSE_ATTACK_DECLARED');
      if(mode==='EVADE')run('CHOOSE_SECTION_UNIT_EVADE_LAB',{actor:'B',path:s.combatLab.plan.evadeOptions[0]});
      run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{faces:Array(s.combatLab.plan.diceCount).fill(mode==='BATTLE_BACK'?'LIGHT':'HEAVY')});
      run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{actor:'B',accept:true});
      if(mode!=='WIN')run('FINALIZE_SECTION_RANGED_LAB');
      assert.equal(s.diceLab.last.attackKind,'BONUS_CLOSE');
      if(mode==='BATTLE_BACK'){
        run('ACCEPT_SECTION_BATTLE_BACK_LAB',{actor:'B'});
        run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{actor:'B',faces:Array(s.combatLab.plan.diceCount).fill('LIGHT')});
        run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{accept:true});run('FINALIZE_SECTION_RANGED_LAB',{actor:'B'});
        assert.equal(s.diceLab.last.attackKind,'BATTLE_BACK');
      }else if(['SECOND_ADVANCE','LEADER'].includes(mode)){
        const p=project(s,'A').diceLab;
        assert.equal(p.momentumPending,true);assert.equal(p.momentumOptions.length,1);
        assert.deepEqual(p.momentumOptions[0],{path:[{col:4,row:4}],bonusEligible:false});
        assert.equal(apply(s,cmd('CHOOSE_SECTION_MOMENTUM_LAB',s.revision,{path:[{col:4,row:4},{col:5,row:4}]})).code,'INVALID_MOMENTUM_PATH');
        run('CHOOSE_SECTION_MOMENTUM_LAB',{path:p.momentumOptions[0].path});
        if(mode==='LEADER')assert.deepEqual(s.board.leaders[0],{id:'a_leader',side:'A',col:4,row:4});
      }else assert.equal(project(s,'A').diceLab.momentumPending,false);
    }
    assert.equal(project(s,'A').diceLab.bonusClosePending,false);
  }
  assert.deepEqual(s.diceLab.resolvedUnitIds,['a1']);
  assert.deepEqual(replay(initial,log),s);
 }
});

test('V16 elephant close: dice by target, sword chain, immunities, defense choice and replay',()=>{
 for(const mode of ['CHAIN','LONG_CHAIN','MIRROR','EVADE','WARRIOR','CAVALRY_IGNORE','CAVALRY_ACCEPT','HORSE_RETREAT','BATTLE_BACK']){
  const c=rangedLabSetup({targetCol:3});
  Object.assign(c,{enableDiceLab:true,enableCasualtyLab:true,enableMoraleLab:true,enableRetreatLab:true,
    enableRetreatLeaderLab:true,enableLeaderEscapeLab:true,enableRampageLab:true,enableRampageLeaderLab:true,
    enableElephantRetreatLeaderLab:true,enableCloseCombatLab:true,enableUnitEvadeLab:true,enableBattleBackLab:true,
    enableMomentumLab:true,enableBonusCloseLab:true,enableElephantCloseLab:true,victoryTargets:{A:3,B:3}});
  const cavalry=mode.startsWith('CAVALRY');
  c.movementUnitTypes.a1=cavalry?'HEAVY_CAVALRY':mode==='BATTLE_BACK'?'HEAVY_INFANTRY':'ELEPHANT';
  c.movementUnitTypes.b1=cavalry||['MIRROR','BATTLE_BACK'].includes(mode)?'ELEPHANT':mode==='WARRIOR'?'WARRIOR_INFANTRY':mode==='EVADE'?'LIGHT_INFANTRY':mode==='HORSE_RETREAT'?'HEAVY_CAVALRY':'HEAVY_INFANTRY';
  const {initial,ordered,commands}=rangedLabReady(c);let s=ordered;const log=[...commands];
  const run=(type,fields={})=>{const command=cmd(type,s.revision,fields),result=apply(s,command);
    assert.equal(result.accepted,true,result.code);log.push(command);s=result.nextState;};
  run('FINISH_SECTION_MOVEMENT_LAB');run('PREPARE_SECTION_CLOSE_LAB',{attackerId:'a1',targetId:'b1'});
  assert.equal(s.combatLab.plan.diceCount,cavalry||mode==='HORSE_RETREAT'?4:mode==='EVADE'?2:['MIRROR','WARRIOR'].includes(mode)?3:5);
  if(mode==='HORSE_RETREAT')run('CHOOSE_SECTION_UNIT_EVADE_LAB',{actor:'B',path:[]});
  if(mode==='EVADE')run('CHOOSE_SECTION_UNIT_EVADE_LAB',{actor:'B',path:s.combatLab.plan.evadeOptions[0]});
  let faces=Array(s.combatLab.plan.diceCount).fill('LIGHT');
  if(mode==='CHAIN'){
    faces=['SWORDS','SWORDS','LEADER','LIGHT','MEDIUM','SWORDS','HEAVY','LIGHT'];
    assert.equal(apply(s,cmd('DECLARE_SECTION_RANGED_PHYSICAL_LAB',s.revision,{faces:faces.slice(0,6)})).code,'INVALID_PHYSICAL_DECLARATION');
  }else if(mode==='LONG_CHAIN')faces=['SWORDS','LIGHT','LIGHT','LIGHT','LIGHT',...Array(35).fill('SWORDS'),'LIGHT'];
  else if(mode==='HORSE_RETREAT')faces=['FLAG','LIGHT','LIGHT','LIGHT'];
  else if(mode==='MIRROR')faces=['SWORDS','SWORDS','LEADER'];
  else if(mode==='EVADE')faces=['SWORDS','LIGHT'];
  else if(cavalry)faces=['HEAVY','FLAG','SWORDS','LIGHT'];
  run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{faces});
  if(mode==='CHAIN')assert.deepEqual(s.diceLab.pending.interpretation.rerolls,['SWORDS','HEAVY','LIGHT']);
  if(mode==='MIRROR')assert.equal(s.diceLab.pending.interpretation.hits,0);
  if(mode==='LONG_CHAIN'){assert.equal(s.diceLab.pending.loss.extendedDice,true);assert.equal(s.diceLab.pending.interpretation.hits,36);}
  run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{actor:'B',accept:true});
  if(cavalry){
    assert.equal(project(s,'B').diceLab.canChooseElephantRed,true);
    assert.equal(apply(s,cmd('FINALIZE_SECTION_RANGED_LAB',s.revision)).code,'ELEPHANT_RED_CHOICE_PENDING');
    run('CHOOSE_SECTION_ELEPHANT_RED_LAB',{actor:'B',ignore:mode==='CAVALRY_IGNORE'});
    assert.equal(project(s,'B').diceLab.moralePreview.maxIgnored,1);
    run('CHOOSE_SECTION_MORALE_LAB',{actor:'B',ignored:1});
  }
  if(mode==='HORSE_RETREAT'){
    const p=project(s,'B').diceLab.retreat;
    assert.equal(p.required,3);const route=p.options.find(o=>o.blocksLost===0);assert.ok(route);
    run('RETREAT_SECTION_UNIT_LAB',{actor:'B',path:route.path});
    const m=project(s,'A').diceLab;assert.equal(m.momentumPending,true);
    assert.deepEqual(m.momentumOptions,[{path:[{col:3,row:4}],bonusEligible:true}]);
    run('CHOOSE_SECTION_MOMENTUM_LAB',{path:m.momentumOptions[0].path});
  }else run('FINALIZE_SECTION_RANGED_LAB');
  if(['CHAIN','LONG_CHAIN'].includes(mode)){assert.equal(s.diceLab.blocks.b1,undefined);assert.equal(project(s,'A').diceLab.momentumPending,true);}
  else if(mode==='EVADE'){assert.equal(s.diceLab.blocks.b1,3);assert.equal(project(s,'A').diceLab.momentumPending,false);}
  else if(cavalry){assert.equal(s.diceLab.blocks.b1,mode==='CAVALRY_IGNORE'?2:1);}
  else if(mode==='BATTLE_BACK'){
    run('ACCEPT_SECTION_BATTLE_BACK_LAB',{actor:'B'});
    assert.equal(s.combatLab.plan.diceCount,5);
    run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{actor:'B',faces:['SWORDS','LIGHT','LIGHT','LIGHT','LIGHT','HEAVY']});
    run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{accept:true});
    run('FINALIZE_SECTION_RANGED_LAB',{actor:'B'});assert.equal(s.diceLab.blocks.a1,2);
  }
  assert.deepEqual(replay(initial,log),s);
 }
});

test('V17 chariots and war machines: defense, sword repeat, evade without banner, advance and replay',()=>{
 for(const mode of ['CHARIOT_ATTACK','CHARIOT_BACK','CHARIOT_EVADE','ELEPHANT_CHAIN','CHARIOT_ELEPHANT','MACHINE_ESCAPE','MACHINE_KILLED','MACHINE_ATTACK','MACHINE_STAND','MACHINE_BLOCKED','CAVALRY_CHARIOT']){
  const c=rangedLabSetup({targetCol:3});
  Object.assign(c,{enableDiceLab:true,enableCasualtyLab:true,enableMoraleLab:true,enableRetreatLab:true,
    enableRetreatLeaderLab:true,enableLeaderEscapeLab:true,enableRampageLab:true,enableRampageLeaderLab:true,
    enableElephantRetreatLeaderLab:true,enableCloseCombatLab:true,enableUnitEvadeLab:true,enableBattleBackLab:true,
    enableMomentumLab:true,enableBonusCloseLab:true,enableElephantCloseLab:true,enableSpecialCloseLab:true,victoryTargets:{A:3,B:3}});
  c.movementUnitTypes.a1=mode.startsWith('CHARIOT_ATTACK')||mode==='CHARIOT_ELEPHANT'?'HEAVY_CHARIOT':mode==='CAVALRY_CHARIOT'?'HEAVY_CAVALRY':
    mode==='ELEPHANT_CHAIN'?'ELEPHANT':mode==='MACHINE_ATTACK'?'HEAVY_WAR_MACHINE':'HEAVY_INFANTRY';
  c.movementUnitTypes.b1=['CHARIOT_BACK','CHARIOT_EVADE','ELEPHANT_CHAIN','CAVALRY_CHARIOT'].includes(mode)?'HEAVY_CHARIOT':
    mode==='CHARIOT_ELEPHANT'?'ELEPHANT':['MACHINE_ESCAPE','MACHINE_KILLED','MACHINE_STAND','MACHINE_BLOCKED'].includes(mode)?'HEAVY_WAR_MACHINE':'HEAVY_INFANTRY';
  if(mode==='MACHINE_BLOCKED'){Object.assign(c.board.units[0],{col:3,row:1});Object.assign(c.board.units[1],{col:3,row:0});}
  const {initial,ordered,commands}=rangedLabReady(c);let s=ordered;const log=[...commands];
  const run=(type,fields={})=>{const command=cmd(type,s.revision,fields),result=apply(s,command);
    assert.equal(result.accepted,true,result.code);log.push(command);s=result.nextState;};
  run('FINISH_SECTION_MOVEMENT_LAB');run('PREPARE_SECTION_CLOSE_LAB',{attackerId:'a1',targetId:'b1'});
  const plan=s.combatLab.plan;
  if(['MACHINE_BLOCKED','CAVALRY_CHARIOT'].includes(mode))assert.deepEqual(plan.evadeOptions,[]);
  if(plan.evadeOptions.length)run('CHOOSE_SECTION_UNIT_EVADE_LAB',{actor:'B',path:['CHARIOT_EVADE','MACHINE_ESCAPE','MACHINE_KILLED'].includes(mode)?plan.evadeOptions[0]:[]});
  const faces=mode==='CHARIOT_ATTACK'?['HEAVY','HEAVY','HEAVY','HEAVY']:
    mode==='CHARIOT_BACK'?['SWORDS','LIGHT','LIGHT','LIGHT','LIGHT']:
    mode==='ELEPHANT_CHAIN'?['SWORDS','SWORDS','LIGHT','HEAVY']:
    mode==='CHARIOT_ELEPHANT'?['HEAVY','FLAG','LIGHT','LIGHT']:
    mode==='MACHINE_ATTACK'?['SWORDS','HEAVY']:
    mode==='MACHINE_KILLED'?['HEAVY','HEAVY','LIGHT','LIGHT','LIGHT']:
    ['MACHINE_STAND','MACHINE_BLOCKED'].includes(mode)?['HEAVY','LIGHT','LIGHT','LIGHT','LIGHT']:
    mode==='CAVALRY_CHARIOT'?['SWORDS','LIGHT','LIGHT','LIGHT']:
    ['SWORDS','HEAVY','LIGHT','LIGHT','LIGHT'];
  run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{faces});
  if(mode==='ELEPHANT_CHAIN'){
    assert.equal(s.diceLab.pending.interpretation.chariotSwordIgnored,true);
    assert.deepEqual(s.diceLab.pending.interpretation.rerolls,['HEAVY']);
    assert.equal(s.diceLab.pending.interpretation.hits,2);
  }
  if(mode==='CHARIOT_BACK')assert.equal(s.diceLab.pending.interpretation.hits,0);
  if(mode==='MACHINE_ATTACK')assert.equal(s.diceLab.pending.interpretation.hits,1);
  run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{actor:'B',accept:true});
  if(mode==='CHARIOT_ELEPHANT'){
    run('CHOOSE_SECTION_ELEPHANT_RED_LAB',{actor:'B',ignore:true});
    run('CHOOSE_SECTION_MORALE_LAB',{actor:'B',ignored:1});
  }
  run('FINALIZE_SECTION_RANGED_LAB');
  if(mode==='CHARIOT_ATTACK'){
    const m=project(s,'A').diceLab.momentumOptions;assert.deepEqual(m,[{path:[{col:3,row:4}],bonusEligible:true}]);
    run('CHOOSE_SECTION_MOMENTUM_LAB',{path:m[0].path});
  }
  if(mode==='CHARIOT_BACK'||mode==='MACHINE_STAND'||mode==='MACHINE_BLOCKED'||mode==='CAVALRY_CHARIOT'){
    run('ACCEPT_SECTION_BATTLE_BACK_LAB',{actor:'B'});
    assert.equal(s.combatLab.plan.diceCount,['CHARIOT_BACK','CAVALRY_CHARIOT'].includes(mode)?3:2);
    run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{actor:'B',faces:Array(s.combatLab.plan.diceCount).fill('LIGHT')});
    run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{accept:true});run('FINALIZE_SECTION_RANGED_LAB',{actor:'B'});
  }
  if(mode==='MACHINE_ESCAPE'||mode==='MACHINE_KILLED'){
    assert.equal(s.board.units.some(u=>u.id==='b1'),false);
    assert.equal(project(s,'A').diceLab.banners.A,mode==='MACHINE_KILLED'?1:0);
    assert.equal(!!s.diceLab.last.unitEvasion.crewEscaped,mode==='MACHINE_ESCAPE');
    assert.equal(project(s,'A').diceLab.momentumPending,false);
  }
  if(mode==='CHARIOT_EVADE'){assert.equal(s.diceLab.blocks.b1,1);assert.equal(s.diceLab.last.battleBackPending,false);}
  if(mode==='CHARIOT_ELEPHANT')assert.equal(s.diceLab.blocks.b1,2);
  assert.deepEqual(replay(initial,log),s);
 }
});


test('V18 warrior charge and war machine movement: geometry, obligatory attack, disputed roll and replay',()=>{
 for(const mode of ['WARRIOR_ONE','CHARGE','NO_TARGET','BLOCKED','FOREST_STOP','FOREST_ENTRY','DISPUTE','MACHINE','MACHINE_TWO','MACHINE_BROKEN','MACHINE_STATIONARY','LEADER_CARRIED','TARGET_REMOVED']){
  const machine=mode.startsWith('MACHINE');
  const c=rangedLabSetup({targetCol:mode==='NO_TARGET'?7:5,terrain:mode==='FOREST_STOP'?[{col:3,row:4,kind:'FOREST'}]:mode==='FOREST_ENTRY'?[{col:4,row:4,kind:'FOREST'}]:mode==='MACHINE_BROKEN'?[{col:3,row:4,kind:'BROKEN_GROUND'}]:[]});
  Object.assign(c,{enableDiceLab:true,enableCasualtyLab:true,enableMoraleLab:true,enableRetreatLab:true,
    enableRetreatLeaderLab:true,enableLeaderEscapeLab:true,enableRampageLab:true,enableRampageLeaderLab:true,
    enableElephantRetreatLeaderLab:true,enableCloseCombatLab:true,enableUnitEvadeLab:true,enableBattleBackLab:true,
    enableMomentumLab:true,enableBonusCloseLab:true,enableElephantCloseLab:true,enableSpecialCloseLab:true,enableSpecialFootLab:true,victoryTargets:{A:3,B:3}});
  c.movementUnitTypes.a1=machine?'HEAVY_WAR_MACHINE':'WARRIOR_INFANTRY';
  if(mode==='BLOCKED'){c.board.units.push({id:'b2',side:'B',col:3,row:4});c.movementUnitTypes.b2='HEAVY_INFANTRY';}
  if(mode==='LEADER_CARRIED'){c.enableLeaderLab=true;c.board.leaders=[{id:'a_leader',side:'A',col:2,row:4}];}
  if(mode==='TARGET_REMOVED'){c.board.units.push({id:'a2',side:'A',col:5,row:3});c.movementUnitTypes.a2='HEAVY_INFANTRY';c.sectorCells['5,3']=['LEFT'];}
  const ready=mode==='TARGET_REMOVED'?(()=>{
    const initial=init(c),play=cmd('PLAY_SECTION_CARD',0,{cardInstanceId:initial.hands.A[0].instanceId});
    const played=apply(initial,play).nextState;
    const order=cmd('ASSIGN_SECTION_ORDERS',1,{unitIds:['a1','a2'],leaderIds:[]});
    const result=apply(played,order);assert.equal(result.accepted,true,result.code);
    return {initial,ordered:result.nextState,commands:[play,order]};
  })():rangedLabReady(c);
  const {initial,ordered,commands}=ready;let s=ordered;const log=[...commands];
  const run=(type,fields={})=>{const command=cmd(type,s.revision,fields),result=apply(s,command);
    assert.equal(result.accepted,true,mode+': '+result.code);log.push(command);s=result.nextState;};
  const path=['WARRIOR_ONE','MACHINE','MACHINE_BROKEN'].includes(mode)?[{col:3,row:4}]:[{col:3,row:4},{col:4,row:4}];
  const denied={NO_TARGET:'WARRIOR_CHARGE_TARGET_REQUIRED',BLOCKED:'OCCUPIED_DESTINATION',FOREST_STOP:'MUST_STOP_ON_FOREST_ENTRY',MACHINE_TWO:'STANDARD_FOOT_MOVEMENT_EXCEEDED',MACHINE_BROKEN:'WAR_MACHINE_CANNOT_ENTER_BROKEN_GROUND'};
  if(denied[mode]){
    const result=apply(s,cmd('MOVE_SECTION_FOOT_PATH_V2',s.revision,{unitId:'a1',path}));
    assert.equal(result.code,denied[mode],mode);assert.deepEqual(s,ordered);continue;
  }
  if(mode!=='MACHINE_STATIONARY'){
    run('MOVE_SECTION_FOOT_PATH_V2',{unitId:'a1',path});
    assert.equal(apply(s,cmd('MOVE_SECTION_FOOT_PATH_V2',s.revision,{unitId:'a1',path})).code,'UNIT_ALREADY_MOVED');
    assert.equal(s.combatLab.movement.a1.battle,machine?'UNAVAILABLE':path.length===2?'MANDATORY_CLOSE_COMBAT':'POSSIBLE');
    if(mode==='LEADER_CARRIED')assert.deepEqual(s.board.leaders[0],{id:'a_leader',side:'A',col:4,row:4});
  }
  run('FINISH_SECTION_MOVEMENT_LAB');
  if(['CHARGE','DISPUTE','FOREST_ENTRY','LEADER_CARRIED'].includes(mode)){
    assert.deepEqual(project(s,'A').combatLab.pendingWarriorCharges,['a1']);
    assert.equal(apply(s,cmd('END_EXPERIMENTAL_TURN',s.revision)).code,'WARRIOR_CHARGE_COMBAT_REQUIRED');
    run('PREPARE_SECTION_CLOSE_LAB',{attackerId:'a1',targetId:'b1'});
    assert.equal(s.combatLab.plan.diceCount,mode==='FOREST_ENTRY'?2:4);
    const faces=Array(s.combatLab.plan.diceCount).fill('LIGHT');
    run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{faces});
    if(mode==='DISPUTE'){
      run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{actor:'B',accept:false});
      run('ARCHIVE_SECTION_RANGED_LAB');assert.equal(s.diceLab.pending,null);
      assert.deepEqual(s.diceLab.resolvedUnitIds,[]);
      run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{faces});
    }
    run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{actor:'B',accept:true});
    run('FINALIZE_SECTION_RANGED_LAB');run('DECLINE_SECTION_BATTLE_BACK_LAB',{actor:'B'});
    assert.deepEqual(project(s,'A').combatLab.pendingWarriorCharges,[]);
  }else if(mode==='TARGET_REMOVED'){
    assert.deepEqual(project(s,'A').combatLab.pendingWarriorCharges,['a1']);
    run('PREPARE_SECTION_CLOSE_LAB',{attackerId:'a2',targetId:'b1'});
    run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{faces:['HEAVY','HEAVY','HEAVY','HEAVY','LIGHT']});
    run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{actor:'B',accept:true});run('FINALIZE_SECTION_RANGED_LAB');
    if(project(s,'A').diceLab.momentumPending)run('CHOOSE_SECTION_MOMENTUM_LAB',{path:[]});
    assert.deepEqual(project(s,'A').combatLab.pendingWarriorCharges,[]);
    assert.deepEqual(s.diceLab.resolvedUnitIds,['a2']);
  }else if(mode==='MACHINE'){
    assert.equal(apply(s,cmd('PREPARE_SECTION_RANGED_LAB',s.revision,{attackerId:'a1',targetId:'b1'})).code,'BATTLE_AFTER_MOVEMENT_UNAVAILABLE');
    assert.equal(project(s,'A').combatLab.candidates.length,0);
  }else if(mode==='MACHINE_STATIONARY'){
    assert.ok(project(s,'A').combatLab.candidates.some(o=>o.targetId==='b1'));
  }
  run('END_EXPERIMENTAL_TURN');
  assert.deepEqual(replay(initial,log),s);
 }
});

test('V19 lone leader: ranged and close, hits, compulsory escape, no momentum, victory and replay',()=>{
 for(const mode of ['CLOSE_HIT','RANGED_HIT','CLOSE_EVADE','RANGED_EVADE','EXIT','ELEPHANT','ATTACHED','CHARGE','WIN']){
  const ranged=mode.startsWith('RANGED'),charge=mode==='CHARGE';
  const c=rangedLabSetup({targetCol:ranged?4:charge?5:3});
  Object.assign(c,{enableLeaderLab:true,enableDiceLab:true,enableCasualtyLab:true,enableMoraleLab:true,enableRetreatLab:true,
    enableRetreatLeaderLab:true,enableLeaderEscapeLab:true,enableRampageLab:true,enableRampageLeaderLab:true,
    enableElephantRetreatLeaderLab:true,enableCloseCombatLab:true,enableUnitEvadeLab:true,enableBattleBackLab:true,
    enableMomentumLab:true,enableBonusCloseLab:true,enableElephantCloseLab:true,enableSpecialCloseLab:true,enableSpecialFootLab:true,
    enableLoneLeaderCombatLab:true,victoryTargets:{A:mode==='WIN'?1:3,B:3}});
  c.movementUnitTypes.a1=mode==='ELEPHANT'?'ELEPHANT':charge?'WARRIOR_INFANTRY':ranged?'LIGHT_INFANTRY':'HEAVY_INFANTRY';
  const target=c.board.units[1];c.board.leaders=[{id:'b_leader',side:'B',col:target.col,row:target.row}];
  if(mode!=='ATTACHED'){c.board.units.splice(1,1);delete c.movementUnitTypes.b1;}
  if(mode==='EXIT'){Object.assign(c.board.units[0],{col:3,row:1});Object.assign(c.board.leaders[0],{col:3,row:0});}
  const {initial,ordered,commands}=rangedLabReady(c);let s=ordered;const log=[...commands];
  const run=(type,fields={})=>{const command=cmd(type,s.revision,fields),result=apply(s,command);
    assert.equal(result.accepted,true,mode+': '+result.code);log.push(command);s=result.nextState;};
  if(charge)run('MOVE_SECTION_FOOT_PATH_V2',{unitId:'a1',path:[{col:3,row:4},{col:4,row:4}]});
  run('FINISH_SECTION_MOVEMENT_LAB');
  const fields={attackerId:'a1',targetId:'b_leader'},prepare=ranged?'PREPARE_SECTION_RANGED_LAB':'PREPARE_SECTION_CLOSE_LAB';
  if(mode==='ATTACHED'){assert.equal(apply(s,cmd(prepare,s.revision,fields)).code,'INVALID_CLOSE_TARGET');continue;}
  assert.ok(project(s,'A').combatLab.candidates.some(o=>o.targetId==='b_leader'&&o.loneLeader));
  run(prepare,fields);
  assert.equal(s.combatLab.plan.diceCount,mode==='ELEPHANT'?1:charge?4:ranged?2:5);
  const hit=['CLOSE_HIT','RANGED_HIT','ELEPHANT','CHARGE','WIN'].includes(mode);
  const faces=Array(s.combatLab.plan.diceCount).fill('FLAG');if(hit)faces[0]='LEADER';
  run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{faces});
  run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{actor:'B',accept:true});
  if(mode!=='WIN'){
    if(hit)run('FINALIZE_SECTION_RANGED_LAB');
    else{
      assert.equal(project(s,'B').diceLab.blocker,'LEADER_EVASION_PENDING');
      assert.equal(apply(s,cmd('FINALIZE_SECTION_RANGED_LAB',s.revision)).code,'LEADER_EVASION_PENDING');
      const option=project(s,'B').diceLab.leaderEvasionOptions.find(o=>mode==='EXIT'?o.exit:!o.exit&&o.path.length===1&&!o.risks.length);
      assert.ok(option);
      run('EVADE_SECTION_LEADER_LAB',{actor:'B',path:option.path,exit:option.exit});
      if(mode!=='EXIT')assert.deepEqual({col:s.board.leaders[0].col,row:s.board.leaders[0].row},option.path[0]);
    }
  }
  assert.equal(s.board.leaders.length,hit||mode==='EXIT'?0:1);
  assert.equal(project(s,'A').diceLab.banners.A,hit?1:0);
  assert.equal(project(s,'A').diceLab.momentumPending,false);
  assert.equal(project(s,'A').diceLab.battleBackPending,false);
  assert.deepEqual(s.diceLab.resolvedUnitIds,['a1']);
  assert.deepEqual(replay(initial,log),s);
 }
});

test('V20 deck recycling: replenish immediately, initially empty, conservation, privacy, deterministic replay and old version',()=>{
 for(const mode of ['RECYCLE','EMPTY','LEGACY']){
  const c=rangedLabSetup({targetCol:5});
  Object.assign(c,{enableDiceLab:true,enableCasualtyLab:true,enableMoraleLab:true,enableRetreatLab:true,
    enableRetreatLeaderLab:true,enableLeaderEscapeLab:true,enableRampageLab:true,enableRampageLeaderLab:true,
    enableElephantRetreatLeaderLab:true,enableCloseCombatLab:true,enableUnitEvadeLab:true,enableBattleBackLab:true,
    enableMomentumLab:true,enableBonusCloseLab:true,enableElephantCloseLab:true,enableSpecialCloseLab:true,
    enableSpecialFootLab:true,enableLoneLeaderCombatLab:true,enableDeckRecycleLab:mode!=='LEGACY',victoryTargets:{A:3,B:3}});
  if(mode==='EMPTY')c.cardInstances=c.cardInstances.slice(0,4);
  const initial=init(c),ids=c.cardInstances.map(x=>x.instanceId).sort();
  let s=initial;const log=[];
  const run=(type,fields={})=>{
    const command=cmd(type,s.revision,{actor:s.turn,...fields}),result=apply(s,command);
    assert.equal(result.accepted,true,result.code);log.push(command);s=result.nextState;
    assert.deepEqual([...s.hands.A,...s.hands.B,...s.drawPile,...s.discardPile,...(s.activeCard?[s.activeCard]:[])].map(x=>x.instanceId).sort(),ids);
    return result.publicEvent;
  };
  let recycles=0;
  for(let turn=0;turn<(mode==='LEGACY'?3:12);turn++){
    const actor=s.turn,other=actor==='A'?'B':'A';
    const handBefore=s.hands[actor].length,opponent=structuredClone(s.hands[other]);
    run('PLAY_SECTION_CARD',{cardInstanceId:s.hands[actor][0].instanceId});
    run('ASSIGN_SECTION_ORDERS',{unitIds:[],leaderIds:[]});
    const before=s,remaining=before.drawPile.length,discarded=before.discardPile.length+1;
    const event=run('END_EXPERIMENTAL_TURN');
    assert.deepEqual(s.hands[other],opponent);
    if(mode!=='LEGACY'){
      assert.equal(event.drewCard,true);assert.equal(s.hands[actor].length,handBefore);
      if(remaining<=1){
        recycles++;
        assert.equal(event.deckRecycled,true);
        assert.equal(event.recycledCardCount,discarded);
        assert.equal(s.discardPile.length,0);
        assert.equal(s.drawPile.length,discarded-Number(remaining===0));
      }else{
        assert.equal(event.deckRecycled,undefined);
        assert.equal(s.drawPile.length,remaining-1);
      }
    }else{
      assert.equal(event.deckRecycled,undefined);
      assert.equal(event.drewCard,remaining>0);
      assert.equal(s.hands[actor].length,handBefore-Number(remaining===0));
      assert.equal(s.drawPile.length,Math.max(0,remaining-1));
    }
    const publicJSON=JSON.stringify(event);
    for(const id of ids)assert.equal(publicJSON.includes(id),false);
    for(const side of ['A','B']){
      const view=JSON.stringify(project(s,side));
      for(const hidden of [...s.drawPile,...s.hands[side==='A'?'B':'A']])assert.equal(view.includes(hidden.instanceId),false);
      assert.equal(view.includes(s.diceLab.key),false);
    }
    const replayed=replay(initial,log);
    assert.deepEqual(replayed,s);
    assert.deepEqual(apply(before,log.at(-1)).nextState,s);
  }
  if(mode!=='LEGACY')assert.ok(recycles>1);
 }
});

test('V21 long history: cross 256 with repeated deck cycles, combat candidates and replay',()=>{
  const c=rangedLabSetup({targetCol:4});
  Object.assign(c,{enableDiceLab:true,enableCasualtyLab:true,enableMoraleLab:true,enableRetreatLab:true,
    enableRetreatLeaderLab:true,enableLeaderEscapeLab:true,enableRampageLab:true,enableRampageLeaderLab:true,
    enableElephantRetreatLeaderLab:true,enableCloseCombatLab:true,enableUnitEvadeLab:true,enableBattleBackLab:true,
    enableMomentumLab:true,enableBonusCloseLab:true,enableElephantCloseLab:true,enableSpecialCloseLab:true,
    enableSpecialFootLab:true,enableLoneLeaderCombatLab:true,enableDeckRecycleLab:true,enableLongHistoryLab:true,victoryTargets:{A:3,B:3}});
  // Exactly one card per hand, initially empty draw pile: recycle each turn.
  c.cardInstances=c.cardInstances.slice(0,2);c.handSizes={A:1,B:1};
  const initial=init(c);let s=initial;const log=[];
  const run=(type,fields={})=>{
    const command=cmd(type,s.revision,{actor:s.turn,...fields}),result=apply(s,command);
    assert.equal(result.accepted,true,result.code);log.push(command);s=result.nextState;
    return result.publicEvent;
  };
  for(let i=0;i<100;i++){
    run('PLAY_SECTION_CARD',{cardInstanceId:s.hands[s.turn][0].instanceId});
    run('ASSIGN_SECTION_ORDERS',{unitIds:[],leaderIds:[]});
    const e=run('END_EXPERIMENTAL_TURN');
    assert.equal(e.deckRecycled,true);assert.equal(e.drewCard,true);
    assert.equal(project(s,s.turn).historyLimitReached,undefined);
  }
  assert.equal(s.revision,300);
  run('PLAY_SECTION_CARD',{cardInstanceId:s.hands.A[0].instanceId});
  run('ASSIGN_SECTION_ORDERS',{unitIds:['a1'],leaderIds:[]});
  run('FINISH_SECTION_MOVEMENT_LAB');
  assert.ok(project(s,'A').combatLab.candidates.some(x=>x.attackerId==='a1'&&x.targetId==='b1'));
  run('PREPARE_SECTION_RANGED_LAB',{attackerId:'a1',targetId:'b1'});
  run('CANCEL_SECTION_RANGED_LAB');
  run('END_EXPERIMENTAL_TURN');
  assert.equal(s.revision,306);
  assert.deepEqual(replay(initial,log),s);
  assert.equal(apply(s,log.at(-1)).code,'STALE_REVISION');
  const corrupt=structuredClone(log);corrupt[256].expectedRevision=0;
  assert.throws(()=>replay(initial,corrupt),/INVALID_SECTION_HISTORY_EVENT_CHAIN/);
  const legacy=structuredClone(initial);legacy.diceLab.version=20;
  assert.throws(()=>replay(legacy,log),/INVALID_SECTION_HISTORY_REPLAY/);
  const max=structuredClone(s);max.revision=Number.MAX_SAFE_INTEGER;
  assert.equal(project(max,max.turn).historyLimitReached,true);
  assert.equal(apply(max,cmd('PLAY_SECTION_CARD',max.revision,{actor:max.turn,cardInstanceId:max.hands[max.turn][0].instanceId})).code,'SECTION_HISTORY_LIMIT_REACHED');
});

test('V22 selection cards: troop classes, Command, fallback, mounted leaders, sector boundaries, transit and replay',()=>{
 for(const mode of ['LIGHT','MEDIUM','HEAVY','MOUNTED','FALLBACK','COORDINATED','FLANKS','TRANSIT','BLOCKED_TRANSIT','FOREST_TRANSIT','COMMAND_LIMIT','MOUNTED_FALLBACK','FLANKS_BLOCKED','LEGACY']){
  const def={LIGHT:'ORDER_LIGHT_TROOPS',MEDIUM:'ORDER_MEDIUM_TROOPS',HEAVY:'ORDER_HEAVY_TROOPS',MOUNTED:'ORDER_MOUNTED_TROOPS',FALLBACK:'ORDER_HEAVY_TROOPS',COORDINATED:'COORDINATED_ATTACK',FLANKS:'OUT_FLANKED',TRANSIT:'ORDER_LIGHT_TROOPS',BLOCKED_TRANSIT:'ORDER_LIGHT_TROOPS',FOREST_TRANSIT:'ORDER_LIGHT_TROOPS',COMMAND_LIMIT:'ORDER_LIGHT_TROOPS',MOUNTED_FALLBACK:'ORDER_MOUNTED_TROOPS',FLANKS_BLOCKED:'OUT_FLANKED',LEGACY:'ORDER_LIGHT_TROOPS'}[mode];
  const c=rangedLabSetup({targetCol:10,terrain:mode==='FOREST_TRANSIT'?[{col:3,row:4,kind:'FOREST'}]:[]});
  Object.assign(c,{enableLeaderLab:true,enableDiceLab:true,enableCasualtyLab:true,enableMoraleLab:true,enableRetreatLab:true,
    enableRetreatLeaderLab:true,enableLeaderEscapeLab:true,enableRampageLab:true,enableRampageLeaderLab:true,
    enableElephantRetreatLeaderLab:true,enableCloseCombatLab:true,enableUnitEvadeLab:true,enableBattleBackLab:true,
    enableMomentumLab:true,enableBonusCloseLab:true,enableElephantCloseLab:true,enableSpecialCloseLab:true,
    enableSpecialFootLab:true,enableLoneLeaderCombatLab:true,enableDeckRecycleLab:true,enableLongHistoryLab:true,enableSelectionCardsLab:mode!=='LEGACY',victoryTargets:{A:3,B:3}});
  c.cardInstances[0].definitionId=def;
  c.board.units.push({id:'a2',side:'A',col:3,row:4},{id:'a3',side:'A',col:8,row:4},{id:'a4',side:'A',col:9,row:4});
  c.board.leaders=[{id:'a_leader',side:'A',col:8,row:4}];
  Object.assign(c.movementUnitTypes,{a1:'LIGHT_INFANTRY',a2:'AUXILIA_INFANTRY',a3:'MEDIUM_CAVALRY',a4:mode==='FALLBACK'?'WARRIOR_INFANTRY':'HEAVY_WAR_MACHINE'});
  c.sectorCells['3,4']=['LEFT','CENTER'];c.sectorCells['8,4']=['CENTER','RIGHT'];
  if(mode==='COMMAND_LIMIT')c.movementUnitTypes.a3='LIGHT_CAVALRY';
  if(mode==='MOUNTED_FALLBACK')c.movementUnitTypes.a3='MEDIUM_INFANTRY';
  if(mode==='FLANKS_BLOCKED')c.sectorCells['8,4']=['LEFT'];
  if(mode==='BLOCKED_TRANSIT')c.board.units[2].side='B';
  if(mode==='LEGACY'){assert.throws(()=>init(c),/INVALID_SECTION_HISTORY_SETUP/);continue;}
  const initial=init(c);let s=initial;const log=[];
  const run=(type,fields={})=>{const command=cmd(type,s.revision,fields),result=apply(s,command);
    assert.equal(result.accepted,true,mode+': '+result.code);log.push(command);s=result.nextState;};
  const card=s.hands.A.find(x=>x.definitionId===def);assert.ok(card,mode);
  run('PLAY_SECTION_CARD',{cardInstanceId:card.instanceId});
  const options=project(s,'A').selectionCard;assert.ok(options);assert.equal(project(s,'B').selectionCard,undefined);
  const check=(unitIds,leaderIds=[])=>apply(s,cmd('ASSIGN_SECTION_ORDERS',s.revision,{unitIds,leaderIds})).code;
  let ids,leaders=[];
  if(mode==='MEDIUM'){assert.equal(check(['a1']),'ORDERS_NOT_ELIGIBLE');ids=['a3'];}
  else if(mode==='HEAVY'){assert.equal(check(['a3']),'ORDERS_NOT_ELIGIBLE');ids=['a4'];}
  else if(mode==='MOUNTED'){assert.equal(check(['a4']),'ORDERS_NOT_ELIGIBLE');ids=['a3'];leaders=['a_leader'];}
  else if(mode==='COMMAND_LIMIT'){assert.equal(options.maximumOrders,2);assert.equal(check(['a1','a2','a3']),'ORDERS_NOT_ELIGIBLE');ids=['a1','a3'];}
  else if(mode==='MOUNTED_FALLBACK'){assert.equal(options.fallback,true);assert.equal(check(['a1','a2']),'ORDERS_NOT_ELIGIBLE');assert.equal(check(['a1'],['a_leader']),'ORDERS_NOT_ELIGIBLE');ids=['a1'];}
  else if(mode==='FLANKS_BLOCKED'){assert.equal(check(['a1','a2','a3','a4']),'ORDERS_NOT_ELIGIBLE');ids=['a1','a2','a4'];}
  else if(mode==='FALLBACK'){assert.equal(options.fallback,true);assert.equal(check(['a1','a2']),'ORDERS_NOT_ELIGIBLE');ids=['a1'];}
  else if(mode==='COORDINATED'){ids=['a1','a2','a3'];assert.equal(check(['a1','a2','a3','a4']),'ORDERS_NOT_ELIGIBLE');}
  else if(mode==='FLANKS'){ids=['a1','a2','a3','a4'];assert.equal(check(ids,['a_leader']),'ORDERS_NOT_ELIGIBLE');}
  else {ids=['a1'];assert.equal(check(['a3']),'ORDERS_NOT_ELIGIBLE');assert.equal(check(['a1'],['a_leader']),'ORDERS_NOT_ELIGIBLE');}
  run('ASSIGN_SECTION_ORDERS',{unitIds:ids,leaderIds:leaders});
  if(['TRANSIT','BLOCKED_TRANSIT','FOREST_TRANSIT'].includes(mode)){
    const path=[{col:3,row:4},{col:4,row:4}];
    assert.equal(apply(s,cmd('MOVE_SECTION_FOOT_PATH_V2',s.revision,{unitId:'a1',path:path.slice(0,1)})).code,'OCCUPIED_DESTINATION');
    if(mode!=='TRANSIT')assert.equal(apply(s,cmd('MOVE_SECTION_FOOT_PATH_V2',s.revision,{unitId:'a1',path})).code,mode==='BLOCKED_TRANSIT'?'OCCUPIED_DESTINATION':'MUST_STOP_ON_FOREST_ENTRY');
    else{run('MOVE_SECTION_FOOT_PATH_V2',{unitId:'a1',path});assert.equal(s.board.units.find(u=>u.id==='a1').col,4);}
  }
  run('END_EXPERIMENTAL_TURN');
  assert.deepEqual(replay(initial,log),s);
 }
});

test('V23 group cards: connected foot orders, line movement, double time charge and combat, terrain and fallback',()=>{
 for(const mode of ['LINE','DISCONNECTED','LINE_RANGED','DOUBLE_MEDIUM','DOUBLE_HEAVY','DOUBLE_AUXILIA','DOUBLE_WARRIOR','NO_CHARGE_TARGET','DOUBLE_RANGED','DOUBLE_MACHINE','DOUBLE_LIMIT','TERRAIN','FALLBACK','LINE_SPLIT','DOUBLE_CROSS','DOUBLE_THREE_SECTIONS','DOUBLE_WARRIOR_TWO','DOUBLE_MACHINE_RANGED','LEGACY']){
  const line=mode.startsWith('LINE')||mode==='DISCONNECTED',def=line?'LINE_COMMAND':'DOUBLE_TIME';
  const c=rangedLabSetup({targetCol:['LINE_SPLIT','DOUBLE_CROSS','DOUBLE_THREE_SECTIONS'].includes(mode)?10:mode==='NO_CHARGE_TARGET'?7:mode==='DOUBLE_WARRIOR'?6:['LINE_RANGED','DOUBLE_RANGED','FALLBACK'].includes(mode)?4:mode==='LINE'?4:5,terrain:mode==='TERRAIN'?[{col:3,row:4,kind:'FOREST'}]:[]});
  Object.assign(c,{enableLeaderLab:true,enableDiceLab:true,enableCasualtyLab:true,enableMoraleLab:true,enableRetreatLab:true,
    enableRetreatLeaderLab:true,enableLeaderEscapeLab:true,enableRampageLab:true,enableRampageLeaderLab:true,
    enableElephantRetreatLeaderLab:true,enableCloseCombatLab:true,enableUnitEvadeLab:true,enableBattleBackLab:true,
    enableMomentumLab:true,enableBonusCloseLab:true,enableElephantCloseLab:true,enableSpecialCloseLab:true,
    enableSpecialFootLab:true,enableLoneLeaderCombatLab:true,enableDeckRecycleLab:true,enableLongHistoryLab:true,enableSelectionCardsLab:true,enableGroupCardsLab:mode!=='LEGACY',victoryTargets:{A:3,B:3}});
  c.cardInstances[0].definitionId=def;
  c.movementUnitTypes.a1=({DOUBLE_MEDIUM:'MEDIUM_INFANTRY',DOUBLE_HEAVY:'HEAVY_INFANTRY',DOUBLE_AUXILIA:'AUXILIA_INFANTRY',DOUBLE_WARRIOR:'WARRIOR_INFANTRY',DOUBLE_WARRIOR_TWO:'WARRIOR_INFANTRY',DOUBLE_MACHINE_RANGED:'HEAVY_WAR_MACHINE',NO_CHARGE_TARGET:'WARRIOR_INFANTRY',DOUBLE_MACHINE:'HEAVY_WAR_MACHINE',TERRAIN:'MEDIUM_INFANTRY',FALLBACK:'LIGHT_CAVALRY'})[mode]??'LIGHT_INFANTRY';
  if(['LINE','DISCONNECTED','DOUBLE_LIMIT'].includes(mode)){
    for(let i=0;i<4;i++){const id='a'+(i+2);c.board.units.push({id,side:'A',col:2,row:i+5>8?3:i+5});c.movementUnitTypes[id]='MEDIUM_INFANTRY';}
  }
  if(['LINE_SPLIT','DOUBLE_CROSS','DOUBLE_THREE_SECTIONS'].includes(mode)){
    c.board.units.push({id:'a2',side:'A',col:3,row:4},{id:'a3',side:'A',col:4,row:4});
    Object.assign(c.movementUnitTypes,{a2:'MEDIUM_INFANTRY',a3:'HEAVY_INFANTRY'});
    if(mode==='DOUBLE_THREE_SECTIONS'){c.sectorCells['3,4']=['CENTER'];c.sectorCells['4,4']=['RIGHT'];}
  }
  if(mode==='LEGACY'){assert.throws(()=>init(c),/INVALID_SECTION_HISTORY_SETUP/);continue;}
  const initial=init(c);let s=initial;const log=[];
  const run=(type,fields={})=>{const command=cmd(type,s.revision,fields),result=apply(s,command);assert.equal(result.accepted,true,mode+': '+result.code);log.push(command);s=result.nextState;};
  const card=s.hands.A.find(x=>x.definitionId===def);assert.ok(card);
  run('PLAY_SECTION_CARD',{cardInstanceId:card.instanceId});
  const options=project(s,'A').selectionCard;assert.ok(options);
  const check=(unitIds,leaderIds=[])=>apply(s,cmd('ASSIGN_SECTION_ORDERS',s.revision,{unitIds,leaderIds})).code;
  let ids=['a1'];
  if(mode==='LINE'){ids=['a1','a2','a3','a4','a5'];assert.equal(options.maximumOrders,5);}
  if(mode==='DISCONNECTED'){assert.equal(check(['a1','a3']),'ORDERS_NOT_ELIGIBLE');ids=['a1','a2'];}
  if(mode==='DOUBLE_LIMIT'){assert.equal(check(['a1','a2','a3','a4','a5']),'ORDERS_NOT_ELIGIBLE');ids=['a1','a2','a3','a4'];}
  if(mode==='FALLBACK'){assert.equal(options.fallback,true);assert.equal(options.maximumOrders,1);}
  if(['LINE_SPLIT','DOUBLE_CROSS'].includes(mode))ids=['a1','a2','a3'];
  if(mode==='DOUBLE_THREE_SECTIONS'){assert.equal(check(['a1','a2','a3']),'ORDERS_NOT_ELIGIBLE');ids=['a1','a2'];}
  run('ASSIGN_SECTION_ORDERS',{unitIds:ids,leaderIds:[]});
  const path=[{col:3,row:4},{col:4,row:4}],move=p=>({unitId:'a1',path:p});
  const deny=(p,code)=>assert.equal(apply(s,cmd('MOVE_SECTION_FOOT_PATH_V2',s.revision,move(p))).code,code,mode);
  if(mode==='LINE'){deny(path,'LINE_COMMAND_MOVEMENT_EXCEEDED');run('MOVE_SECTION_FOOT_PATH_V2',move(path.slice(0,1)));}
  if(['DOUBLE_MEDIUM','DOUBLE_HEAVY','DOUBLE_AUXILIA'].includes(mode)){
    deny([...path,{col:5,row:4}],'DOUBLE_TIME_MOVEMENT_EXCEEDED');run('MOVE_SECTION_FOOT_PATH_V2',move(path));assert.equal(s.combatLab.movement.a1.battle,'POSSIBLE');
  }
  if(mode==='DOUBLE_WARRIOR'){run('MOVE_SECTION_FOOT_PATH_V2',move([...path,{col:5,row:4}]));assert.equal(s.combatLab.movement.a1.battle,'MANDATORY_CLOSE_COMBAT');}
  if(mode==='LINE_SPLIT'||mode==='DOUBLE_CROSS'){
    run('MOVE_SECTION_FOOT_PATH_V2',{unitId:'a1',path:mode==='LINE_SPLIT'?[{col:2,row:3}]:[{col:1,row:4},{col:0,row:4}]});
    run('MOVE_SECTION_FOOT_PATH_V2',{unitId:'a3',path:[{col:5,row:4}]});
  }
  if(mode==='DOUBLE_WARRIOR_TWO'){run('MOVE_SECTION_FOOT_PATH_V2',move(path));assert.equal(s.combatLab.movement.a1.battle,'MANDATORY_CLOSE_COMBAT');}
  if(mode==='NO_CHARGE_TARGET')deny([...path,{col:5,row:4}],'WARRIOR_CHARGE_TARGET_REQUIRED');
  if(mode==='DOUBLE_MACHINE'){deny(path,'STANDARD_FOOT_MOVEMENT_EXCEEDED');run('MOVE_SECTION_FOOT_PATH_V2',move(path.slice(0,1)));assert.equal(s.combatLab.movement.a1.battle,'UNAVAILABLE');}
  if(mode==='TERRAIN')deny(path,'MUST_STOP_ON_FOREST_ENTRY');
  run('FINISH_SECTION_MOVEMENT_LAB');
  if(mode==='LINE_RANGED'||mode==='FALLBACK')assert.ok(project(s,'A').combatLab.candidates.some(o=>o.attackerId==='a1'&&o.kind!=='CLOSE_PREVIEW'));
  if(['DOUBLE_RANGED','DOUBLE_MACHINE_RANGED'].includes(mode))assert.equal(apply(s,cmd('PREPARE_SECTION_RANGED_LAB',s.revision,{attackerId:'a1',targetId:'b1'})).code,'DOUBLE_TIME_RANGED_FORBIDDEN');
  if(['LINE','DOUBLE_MEDIUM','DOUBLE_HEAVY','DOUBLE_AUXILIA','DOUBLE_WARRIOR','DOUBLE_WARRIOR_TWO'].includes(mode)){
    run('PREPARE_SECTION_CLOSE_LAB',{attackerId:'a1',targetId:'b1'});
    if(['DOUBLE_WARRIOR','DOUBLE_WARRIOR_TWO'].includes(mode)){
      assert.equal(apply(s,cmd('CANCEL_SECTION_RANGED_LAB',s.revision)).accepted,true);
      run('CANCEL_SECTION_RANGED_LAB');
      assert.equal(apply(s,cmd('END_EXPERIMENTAL_TURN',s.revision)).code,'WARRIOR_CHARGE_COMBAT_REQUIRED');
      run('PREPARE_SECTION_CLOSE_LAB',{attackerId:'a1',targetId:'b1'});
      run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{faces:['HEAVY','HEAVY','HEAVY','HEAVY']});
      run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{actor:'B',accept:true});
      run('FINALIZE_SECTION_RANGED_LAB');
      if(project(s,'A').diceLab.momentumPending)run('CHOOSE_SECTION_MOMENTUM_LAB',{path:[]});
    }else run('CANCEL_SECTION_RANGED_LAB');
  }
  run('END_EXPERIMENTAL_TURN');assert.deepEqual(replay(initial,log),s);
 }
});

test('V24 attack cards: mandatory adjacency orders, mounted charge, terrain dice, bonus and battle back',()=>{
 for(const mode of ['CLASH','CLASH_TERRAIN','CLASH_ALL','CLASH_EMPTY','CLASH_BONUS','CLASH_BACK','MOUNTED_HEAVY','MOUNTED_CHARIOT','MOUNTED_ELEPHANT','MOUNTED_LIGHT','MOUNTED_MEDIUM','MOUNTED_TERRAIN','MOUNTED_BROKEN','MOUNTED_BONUS','MOUNTED_BACK','MOUNTED_RANGED','FALLBACK','LEGACY']){
  const clash=mode.startsWith('CLASH'),def=clash?'CLASH_OF_SHIELDS':'MOUNTED_CHARGE';
  const moved=['MOUNTED_HEAVY','MOUNTED_CHARIOT','MOUNTED_ELEPHANT','MOUNTED_MEDIUM','MOUNTED_BROKEN'].includes(mode);
  const c=rangedLabSetup({targetCol:mode==='CLASH_EMPTY'?10:moved?6:['MOUNTED_RANGED','FALLBACK'].includes(mode)?4:3,
    terrain:mode==='CLASH_TERRAIN'||mode==='MOUNTED_TERRAIN'?[{col:3,row:4,kind:'FOREST'}]:mode==='MOUNTED_BROKEN'?[{col:4,row:4,kind:'BROKEN_GROUND'}]:[]});
  Object.assign(c,{enableLeaderLab:true,enableDiceLab:true,enableCasualtyLab:true,enableMoraleLab:true,enableRetreatLab:true,
    enableRetreatLeaderLab:true,enableLeaderEscapeLab:true,enableRampageLab:true,enableRampageLeaderLab:true,
    enableElephantRetreatLeaderLab:true,enableCloseCombatLab:true,enableUnitEvadeLab:true,enableBattleBackLab:true,
    enableMomentumLab:true,enableBonusCloseLab:true,enableElephantCloseLab:true,enableSpecialCloseLab:true,
    enableSpecialFootLab:true,enableLoneLeaderCombatLab:true,enableDeckRecycleLab:true,enableLongHistoryLab:true,enableSelectionCardsLab:true,
    enableGroupCardsLab:true,enableAttackCardsLab:mode!=='LEGACY',victoryTargets:{A:3,B:3}});
  c.cardInstances[0].definitionId=def;
  c.movementUnitTypes.a1=clash?(mode==='CLASH_BONUS'?'HEAVY_CAVALRY':'HEAVY_INFANTRY'):
    ({MOUNTED_CHARIOT:'HEAVY_CHARIOT',MOUNTED_ELEPHANT:'ELEPHANT',MOUNTED_LIGHT:'LIGHT_CAVALRY',MOUNTED_MEDIUM:'MEDIUM_CAVALRY',MOUNTED_RANGED:'LIGHT_CAVALRY',FALLBACK:'LIGHT_INFANTRY'})[mode]??'HEAVY_CAVALRY';
  if(mode==='CLASH_ALL'){
    c.board.units.push({id:'a2',side:'A',col:3,row:3},{id:'a3',side:'A',col:0,row:0});
    Object.assign(c.movementUnitTypes,{a2:'MEDIUM_INFANTRY',a3:'HEAVY_INFANTRY'});
  }
  if(mode.endsWith('_BONUS')){c.board.units.push({id:'b2',side:'B',col:4,row:4});c.movementUnitTypes.b2='HEAVY_INFANTRY';}
  if(mode.endsWith('_BACK'))c.movementUnitTypes.b1='ELEPHANT';
  if(mode==='LEGACY'){assert.throws(()=>init(c),/INVALID_SECTION_HISTORY_SETUP/);continue;}
  const initial=init(c);let s=initial;const log=[];
  const run=(type,fields={})=>{const command=cmd(type,s.revision,fields),result=apply(s,command);assert.equal(result.accepted,true,mode+': '+result.code);log.push(command);s=result.nextState;return result;};
  const card=s.hands.A.find(x=>x.definitionId===def);assert.ok(card);
  run('PLAY_SECTION_CARD',{cardInstanceId:card.instanceId});
  const options=project(s,'A').selectionCard;assert.ok(options);
  let ids=mode==='CLASH_ALL'?['a1','a2']:mode==='CLASH_EMPTY'?[]:['a1'];
  if(clash){assert.equal(options.allRequired,true);assert.deepEqual(options.unitIds,ids);}
  if(mode==='CLASH_ALL')assert.equal(apply(s,cmd('ASSIGN_SECTION_ORDERS',s.revision,{unitIds:['a1'],leaderIds:[]})).code,'ORDERS_NOT_ELIGIBLE');
  if(mode==='FALLBACK'){assert.equal(options.fallback,true);assert.equal(options.maximumOrders,1);}
  run('ASSIGN_SECTION_ORDERS',{unitIds:ids,leaderIds:[]});
  const path=[{col:3,row:4},{col:4,row:4},{col:5,row:4}];
  if(clash&&ids.length)assert.equal(apply(s,cmd('MOVE_SECTION_FOOT_PATH_V2',s.revision,{unitId:'a1',path:path.slice(0,1)})).code,'CLASH_MOVEMENT_FORBIDDEN');
  if(moved){
    if(mode==='MOUNTED_BROKEN'){
      assert.equal(apply(s,cmd('MOVE_SECTION_MOUNTED_PATH_V1',s.revision,{unitId:'a1',path})).code,'MOUNTED_MUST_STOP_ON_BROKEN_GROUND');
      run('MOVE_SECTION_MOUNTED_PATH_V1',{unitId:'a1',path:path.slice(0,2)});
      assert.equal(s.combatLab.movement.a1.battle,'UNAVAILABLE');
    }else{
      run('MOVE_SECTION_MOUNTED_PATH_V1',{unitId:'a1',path});
      assert.equal(s.combatLab.movement.a1.battle,'POSSIBLE');
    }
  }
  run('FINISH_SECTION_MOVEMENT_LAB');
  if(mode==='MOUNTED_RANGED')assert.equal(apply(s,cmd('PREPARE_SECTION_RANGED_LAB',s.revision,{attackerId:'a1',targetId:'b1'})).code,'ATTACK_CARD_RANGED_FORBIDDEN');
  else if(mode==='FALLBACK')assert.ok(project(s,'A').combatLab.candidates.some(o=>o.attackerId==='a1'&&o.kind!=='CLOSE_PREVIEW'));
  else if(mode==='CLASH_EMPTY'||mode==='MOUNTED_BROKEN')assert.equal(project(s,'A').combatLab.candidates.length,0);
  else{
    run('PREPARE_SECTION_CLOSE_LAB',{attackerId:'a1',targetId:'b1'});
    const plan=s.combatLab.plan,expected=({CLASH:7,CLASH_TERRAIN:4,CLASH_ALL:7,CLASH_BONUS:6,CLASH_BACK:7,MOUNTED_HEAVY:5,MOUNTED_CHARIOT:5,MOUNTED_ELEPHANT:6,MOUNTED_LIGHT:3,MOUNTED_MEDIUM:4,MOUNTED_TERRAIN:3,MOUNTED_BONUS:5,MOUNTED_BACK:5})[mode];
    assert.equal(plan.diceCount,expected,mode);
    assert.equal(plan.cardBonusDice,clash?2:1);
    if(plan.evadeOptions?.length)run('CHOOSE_SECTION_UNIT_EVADE_LAB',{actor:'B',path:[]});
    if(mode.endsWith('_BONUS')||mode.endsWith('_BACK')||mode==='CLASH'){
      const faces=Array(plan.diceCount).fill(mode.endsWith('_BACK')?'LIGHT':'HEAVY');
      run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{faces});
      run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{actor:'B',accept:true});
      run('FINALIZE_SECTION_RANGED_LAB');
      if(mode.endsWith('_BACK')){
        run('ACCEPT_SECTION_BATTLE_BACK_LAB',{actor:'B'});
        assert.equal(s.combatLab.plan.diceCount,clash?5:4);
        assert.equal(s.combatLab.plan.cardBonusDice,undefined);
        run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{actor:'B',faces:Array(s.combatLab.plan.diceCount).fill('LIGHT')});
        run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{accept:true});
        run('FINALIZE_SECTION_RANGED_LAB',{actor:'B'});
      }else if(mode.endsWith('_BONUS')){
        run('CHOOSE_SECTION_MOMENTUM_LAB',{path:[{col:3,row:4}]});
        run('PREPARE_SECTION_CLOSE_LAB',{attackerId:'a1',targetId:'b2'});
        assert.equal(s.combatLab.plan.diceCount,clash?4:5);
        assert.equal(s.combatLab.plan.cardBonusDice,clash?undefined:1);
        run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{faces:Array(s.combatLab.plan.diceCount).fill('HEAVY')});
        run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{actor:'B',accept:true});
        run('FINALIZE_SECTION_RANGED_LAB');
        if(s.diceLab.last.momentum?.pending)run('CHOOSE_SECTION_MOMENTUM_LAB',{path:[]});
      }else if(s.diceLab.last.momentum?.pending)run('CHOOSE_SECTION_MOMENTUM_LAB',{path:[]});
    }else run('CANCEL_SECTION_RANGED_LAB');
  }
  run('END_EXPERIMENTAL_TURN');assert.deepEqual(replay(initial,log),s);
 }
});

function tacticalCardSetup(definitionId,fire=false,targetCol=4){
 const c=rangedLabSetup({targetCol});
 Object.assign(c,{enableLeaderLab:true,enableDiceLab:true,enableCasualtyLab:true,enableMoraleLab:true,enableRetreatLab:true,enableRetreatLeaderLab:true,enableLeaderEscapeLab:true,enableRampageLab:true,enableRampageLeaderLab:true,enableElephantRetreatLeaderLab:true,enableCloseCombatLab:true,enableUnitEvadeLab:true,enableBattleBackLab:true,enableMomentumLab:true,enableBonusCloseLab:true,enableElephantCloseLab:true,enableSpecialCloseLab:true,enableSpecialFootLab:true,enableLoneLeaderCombatLab:true,enableDeckRecycleLab:true,enableLongHistoryLab:true,enableSelectionCardsLab:true,enableGroupCardsLab:true,enableAttackCardsLab:true,enableLeadershipCardsLab:true,enableFireCardsLab:fire,victoryTargets:{A:3,B:3}});
 c.cardInstances[0].definitionId=definitionId;return c;
}
test('V25 leadership: connected orders across sections, alternative and replay',()=>{
 const c=tacticalCardSetup('INSPIRED_LEFT_LEADERSHIP',false,10);
 c.board.leaders=[{id:'a_leader',side:'A',col:2,row:4}];
 for(const [id,col] of [['a2',3],['a3',4]]){c.board.units.push({id,side:'A',col,row:4});c.movementUnitTypes[id]='MEDIUM_INFANTRY';}
 const initial=init(c),card=initial.hands.A.find(x=>x.definitionId==='INSPIRED_LEFT_LEADERSHIP');
 const p=cmd('PLAY_SECTION_CARD',0,{cardInstanceId:card.instanceId}),played=apply(initial,p).nextState;
 const orders=ids=>cmd('ASSIGN_SECTION_ORDERS',1,{unitIds:ids,leaderIds:[]});
 assert.equal(apply(played,orders(['a1','a3'])).code,'ORDERS_NOT_ELIGIBLE');
 assert.equal(apply(played,orders(['a3'])).accepted,true);
 const order=orders(['a1','a2','a3']),result=apply(played,order);
 assert.equal(result.accepted,true,result.code);
 assert.deepEqual(replay(initial,[p,order]),result.nextState);
});

test('V26 Darken the Sky: two separately resolved shots, mandatory eligible orders and ordinary fallback',()=>{
 for(const fallback of [false,true]){
  const c=tacticalCardSetup('DARKEN_THE_SKY',true);
  if(fallback)c.movementUnitTypes.a1='MEDIUM_INFANTRY';
  else {c.board.units.push({id:'a2',side:'A',col:0,row:0});c.movementUnitTypes.a2='LIGHT_BOW_INFANTRY';}
  const initial=init(c);let s=initial;const log=[];
  const run=(type,fields={})=>{const command=cmd(type,s.revision,fields),result=apply(s,command);assert.equal(result.accepted,true,result.code);log.push(command);s=result.nextState;};
  const reject=(type,fields,code)=>assert.equal(apply(s,cmd(type,s.revision,fields)).code,code);
  run('PLAY_SECTION_CARD',{cardInstanceId:s.hands.A.find(x=>x.definitionId==='DARKEN_THE_SKY').instanceId});
  assert.equal(project(s,'A').selectionCard.fallback,fallback);
  if(!fallback)reject('ASSIGN_SECTION_ORDERS',{unitIds:['a1'],leaderIds:[]},'ORDERS_NOT_ELIGIBLE');
  run('ASSIGN_SECTION_ORDERS',{unitIds:fallback?['a1']:['a1','a2'],leaderIds:[]});
  const move={unitId:'a1',path:[{col:3,row:4}]};
  if(fallback)run('MOVE_SECTION_FOOT_PATH_V2',move);
  else reject('MOVE_SECTION_FOOT_PATH_V2',move,'DARKEN_MOVEMENT_FORBIDDEN');
  run('FINISH_SECTION_MOVEMENT_LAB');
  const target={attackerId:'a1',targetId:'b1'};
  if(fallback)run('PREPARE_SECTION_CLOSE_LAB',target);
  else {
   reject('PREPARE_SECTION_CLOSE_LAB',target,'DARKEN_CLOSE_FORBIDDEN');
   for(let i=0;i<2;i++){
    assert.ok(project(s,'A').combatLab.candidates.some(x=>x.attackerId==='a1'&&x.targetId==='b1'));
    run('PREPARE_SECTION_RANGED_LAB',target);
    run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{faces:['HEAVY','LIGHT']});
    run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{actor:'B',accept:true});
    run('FINALIZE_SECTION_RANGED_LAB');
    assert.equal(s.diceLab.blocks.b1,3-i);
   }
   reject('PREPARE_SECTION_RANGED_LAB',target,'UNIT_ALREADY_BATTLED');
   assert.deepEqual(s.diceLab.resolvedUnitIds,['a1']);assert.deepEqual(s.diceLab.darken.twice,['a1']);
   run('END_EXPERIMENTAL_TURN');assert.equal(s.diceLab.darken,null);
  }
  assert.deepEqual(replay(initial,log),s);
 }
});

test('V27 Move-Fire-Move: two independent moves with optional fire, leader and replay',()=>{
 for(const fire of [true,false,'BUILDING_IN','BUILDING_OUT']){
  const building=typeof fire==='string';
  const c=tacticalCardSetup('MOVE_FIRE_MOVE',true,5);c.enableMoveFireMoveLab=true;
  if(building)c.movementTerrain=[{col:fire==='BUILDING_IN'?3:2,row:4,kind:'BUILDING'}];
  else if(fire)c.movementTerrain=[{col:3,row:4,kind:'FORDABLE_RIVER'}];
  c.board.leaders=[{id:'a_leader',side:'A',col:2,row:4}];
  const initial=init(c);let s=initial;const log=[];
  const run=(type,fields={})=>{const command=cmd(type,s.revision,fields),result=apply(s,command);assert.equal(result.accepted,true,result.code);log.push(command);s=result.nextState;};
  const reject=(type,fields,code)=>assert.equal(apply(s,cmd(type,s.revision,fields)).code,code);
  run('PLAY_SECTION_CARD',{cardInstanceId:s.hands.A.find(x=>x.definitionId==='MOVE_FIRE_MOVE').instanceId});
  run('ASSIGN_SECTION_ORDERS',{unitIds:['a1'],leaderIds:[]});
  const move=col=>({unitId:'a1',path:[{col,row:4}]});
  const target={attackerId:'a1',targetId:'b1'};
  run('MOVE_SECTION_FOOT_PATH_V2',move(3));
  reject('MOVE_SECTION_FOOT_PATH_V2',move(2),'UNIT_ALREADY_MOVED');
  run('FINISH_SECTION_MOVEMENT_LAB');
  reject('PREPARE_SECTION_CLOSE_LAB',target,'MFM_CLOSE_FORBIDDEN');
  reject('MOVE_SECTION_FOOT_PATH_V2',move(2),'MOVEMENT_PHASE_CLOSED');
  if(fire==='BUILDING_IN')reject('PREPARE_SECTION_RANGED_LAB',target,'BUILDING_RANGED_FORBIDDEN');
  if(fire===true){
   run('PREPARE_SECTION_RANGED_LAB',target);assert.equal(s.combatLab.plan.diceCount,1);
   reject('FINISH_SECTION_MOVEMENT_LAB',{},'COMBAT_PLAN_PENDING');
   run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{faces:['HEAVY']});
   run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{actor:'B',accept:true});
   run('FINALIZE_SECTION_RANGED_LAB');assert.equal(s.diceLab.blocks.b1,3);
  }
  run('FINISH_SECTION_MOVEMENT_LAB');
  assert.equal(project(s,'A').diceLab.moveFireMove,'SECOND');
  assert.deepEqual(project(s,'A').combatLab.candidates,[]);
  if(building){
   assert.equal(s.combatLab.movement.a1.buildingMove,true);
   reject('MOVE_SECTION_FOOT_PATH_V2',move(2),'UNIT_ALREADY_MOVED');
   assert.equal(s.board.leaders[0].col,3);
  }else{
   run('MOVE_SECTION_FOOT_PATH_V2',move(2));
   assert.equal(s.board.leaders[0].col,2);
   reject('MOVE_SECTION_FOOT_PATH_V2',move(3),'UNIT_ALREADY_MOVED');
  }
  reject('PREPARE_SECTION_RANGED_LAB',target,'MFM_FIRE_CLOSED');
  run('END_EXPERIMENTAL_TURN');assert.equal(s.diceLab.moveFireMove,null);
  assert.deepEqual(replay(initial,log),s);
 }
});

test('V28 Rally: deterministic roll, allocation by face, capacity, orders and replay',()=>{
 const c=tacticalCardSetup('RALLY',true,10);c.enableMoveFireMoveLab=true;c.enableRallyLab=true;
 c.board.leaders=[{id:'a_leader',side:'A',col:2,row:4}];
 c.board.units.push({id:'a2',side:'A',col:3,row:4},{id:'a3',side:'A',col:0,row:0});
 Object.assign(c.movementUnitTypes,{a2:'MEDIUM_INFANTRY',a3:'LIGHT_INFANTRY'});
 const initial=init(c);initial.diceLab.blocks.a1=2;initial.diceLab.blocks.a2=3;initial.diceLab.blocks.a3=2;
 const card=initial.hands.A.find(x=>x.definitionId==='RALLY'),play=cmd('PLAY_SECTION_CARD',0,{cardInstanceId:card.instanceId});
 let played;
 for(let n=0;n<100;n++){
  initial.diceLab.key=n.toString(16).padStart(64,'0');
  const result=apply(initial,play);assert.equal(result.accepted,true,result.code);
  played=result.nextState;
  if(played.diceLab.rallyFaces.every(f=>['LIGHT','LEADER'].includes(f)))break;
 }
 assert.ok(played.diceLab.rallyFaces.every(f=>['LIGHT','LEADER'].includes(f)));
 const options=project(played,'A').selectionCard.rallyOptions;
 assert.equal(options.length,2);assert.ok(options.every(o=>o.unitIds.includes('a1')&&!o.unitIds.includes('a3')));
 const command=allocations=>cmd('ASSIGN_SECTION_RALLY_LAB',1,{allocations});
 assert.equal(apply(played,cmd('ASSIGN_SECTION_ORDERS',1,{unitIds:['a1'],leaderIds:[]})).code,'RALLY_ASSIGNMENT_REQUIRED');
 assert.equal(apply(played,command([{dieIndex:0,unitId:'a1'},{dieIndex:0,unitId:'a1'}])).code,'INVALID_RALLY_ALLOCATION');
 assert.equal(apply(played,command([{dieIndex:0,unitId:'a3'}])).code,'INVALID_RALLY_ALLOCATION');
 const assign=command(options.map(o=>({dieIndex:o.dieIndex,unitId:'a1'}))),result=apply(played,assign);
 assert.equal(result.accepted,true,result.code);assert.equal(result.nextState.diceLab.blocks.a1,4);
 assert.deepEqual(project(result.nextState,'A').orderedUnitIds,['a1']);
 assert.equal(result.nextState.diceLab.rallyFaces,null);assert.deepEqual(replay(initial,[play,assign]),result.nextState);
 const fallback=tacticalCardSetup('RALLY',true);fallback.enableMoveFireMoveLab=true;fallback.enableRallyLab=true;
 const {ordered}=rangedLabReady(fallback);assert.equal(ordered.orderSnapshot.pieces[0].id,'a1');
});

test('V29 Spartacus: restricted and wild orders, extra fire/close die, shuffle and replay',()=>{
 for(const close of [false,true]){
  const c=tacticalCardSetup('I_AM_SPARTACUS',true,close?3:4);
  Object.assign(c,{enableMoveFireMoveLab:true,enableRallyLab:true,enableSpartacusLab:true});
  c.board.units.push({id:'a2',side:'A',col:0,row:0},{id:'a3',side:'A',col:1,row:0});
  c.board.leaders=[{id:'a_leader',side:'A',col:0,row:0}];
  Object.assign(c.movementUnitTypes,{a2:'HEAVY_INFANTRY',a3:'HEAVY_INFANTRY'});
  const initial=init(c),card=initial.hands.A.find(x=>x.definitionId==='I_AM_SPARTACUS');
  const play=cmd('PLAY_SECTION_CARD',0,{cardInstanceId:card.instanceId});let s;
  for(let n=0;n<200;n++){
   initial.diceLab.key=n.toString(16).padStart(64,'0');
   const p=apply(initial,play);assert.equal(p.accepted,true,p.code);s=p.nextState;
   if(s.diceLab.spartacusFaces.includes('LIGHT')&&s.diceLab.spartacusFaces.includes('LEADER'))break;
  }
  assert.ok(s.diceLab.spartacusFaces.includes('LIGHT')&&s.diceLab.spartacusFaces.includes('LEADER'));
  const log=[play],run=(type,fields={})=>{const command=cmd(type,s.revision,fields),result=apply(s,command);assert.equal(result.accepted,true,result.code);log.push(command);s=result.nextState;return result;};
  const order=(unitIds,leaderIds=[])=>cmd('ASSIGN_SECTION_ORDERS',s.revision,{unitIds,leaderIds});
  assert.equal(apply(s,order(['a2','a3'])).code,'ORDERS_NOT_ELIGIBLE');
  assert.equal(apply(s,order(['a1'],['a_leader'])).accepted,true);
  run('ASSIGN_SECTION_ORDERS',{unitIds:['a2','a1'],leaderIds:[]});
  run('FINISH_SECTION_MOVEMENT_LAB');
  run(close?'PREPARE_SECTION_CLOSE_LAB':'PREPARE_SECTION_RANGED_LAB',{attackerId:'a1',targetId:'b1'});
  assert.equal(s.combatLab.plan.cardBonusDice,1);assert.equal(s.combatLab.plan.diceCount,3);
  run('CANCEL_SECTION_RANGED_LAB');
  const other=structuredClone(s.hands.B),pool=s.drawPile.length+s.discardPile.length+1;
  const ended=run('END_EXPERIMENTAL_TURN');assert.equal(ended.publicEvent.recycledCardCount,pool);
  assert.deepEqual(s.hands.B,other);assert.equal(s.drawPile.length,pool-1);
  assert.equal(s.discardPile.length,0);assert.deepEqual(replay(initial,log),s);
 }
});

test('V30 Counter Attack: physical identity, reversed sections, chaining and replay',()=>{
 const c=tacticalCardSetup('ORDER_2_LEFT',true,3);
 Object.assign(c,{enableMoveFireMoveLab:true,enableRallyLab:true,enableSpartacusLab:true,enableCounterAttackLab:true,sectorPerspective:'PLAYER_RELATIVE'});
 for(const i of [3,4,5])c.cardInstances[i].definitionId='COUNTER_ATTACK';
 c.board.units.push({id:'b2',side:'B',col:10,row:4});c.movementUnitTypes.b2='HEAVY_INFANTRY';
 const initial=init(c);let s=initial;const log=[];
 const run=(type,fields={})=>{const command=cmd(type,s.revision,{actor:s.turn,...fields}),result=apply(s,command);assert.equal(result.accepted,true,result.code);log.push(command);s=result.nextState;return result;};
 const play=id=>({cardInstanceId:s.hands[s.turn].find(x=>x.definitionId===id).instanceId});
 const order=id=>({unitIds:[id],leaderIds:[]});
 assert.equal(apply(s,cmd('PLAY_SECTION_CARD',0,play('COUNTER_ATTACK'))).code,'COUNTER_ATTACK_NO_PREVIOUS_CARD');
 run('PLAY_SECTION_CARD',play('ORDER_2_LEFT'));run('ASSIGN_SECTION_ORDERS',order('a1'));run('END_EXPERIMENTAL_TURN');
 run('PLAY_SECTION_CARD',play('COUNTER_ATTACK'));
 assert.equal(s.activeCard.definitionId,'COUNTER_ATTACK');assert.equal(project(s,'B').effectiveCardInPlay,'ORDER_2_RIGHT');
 assert.equal(apply(s,cmd('ASSIGN_SECTION_ORDERS',s.revision,{actor:'B',...order('b2')})).code,'ORDERS_NOT_ELIGIBLE');
 run('ASSIGN_SECTION_ORDERS',order('b1'));run('END_EXPERIMENTAL_TURN');
 run('PLAY_SECTION_CARD',play('COUNTER_ATTACK'));assert.equal(project(s,'A').effectiveCardInPlay,'ORDER_2_LEFT');
 run('ASSIGN_SECTION_ORDERS',order('a1'));run('END_EXPERIMENTAL_TURN');
 assert.equal(s.diceLab.counter.previous,'ORDER_2_LEFT');
 assert.equal([...s.drawPile,...s.discardPile,...s.hands.A,...s.hands.B].filter(x=>x.definitionId==='COUNTER_ATTACK').length,3);
 assert.deepEqual(replay(initial,log),s);
});
test('V30 Counter Attack recalculates troop fallback against own army',()=>{
 const c=tacticalCardSetup('ORDER_HEAVY_TROOPS',true,10);
 Object.assign(c,{enableMoveFireMoveLab:true,enableRallyLab:true,enableSpartacusLab:true,enableCounterAttackLab:true});
 c.cardInstances[4].definitionId='COUNTER_ATTACK';
 const initial=init(c);let s=initial;const log=[];
 const run=(type,fields={})=>{const command=cmd(type,s.revision,{actor:s.turn,...fields}),result=apply(s,command);assert.equal(result.accepted,true,result.code);log.push(command);s=result.nextState;};
 const play=id=>({cardInstanceId:s.hands[s.turn].find(x=>x.definitionId===id).instanceId});
 run('PLAY_SECTION_CARD',play('ORDER_HEAVY_TROOPS'));assert.equal(project(s,'A').selectionCard.fallback,true);
 run('ASSIGN_SECTION_ORDERS',{unitIds:['a1'],leaderIds:[]});run('END_EXPERIMENTAL_TURN');
 run('PLAY_SECTION_CARD',play('COUNTER_ATTACK'));const options=project(s,'B').selectionCard;
 assert.equal(options.fallback,false);assert.equal(options.maximumOrders,2);assert.deepEqual(options.unitIds,['b1']);
 run('ASSIGN_SECTION_ORDERS',{unitIds:['b1'],leaderIds:[]});assert.deepEqual(replay(initial,log),s);
});

test('V30 Counter Attack retains Spartacus effect after shuffle and rolls again with own Command',()=>{
 const c=tacticalCardSetup('I_AM_SPARTACUS',true,4);
 Object.assign(c,{enableMoveFireMoveLab:true,enableRallyLab:true,enableSpartacusLab:true,enableCounterAttackLab:true});
 c.cardInstances[4].definitionId='COUNTER_ATTACK';
 c.handSizes={A:2,B:3};
 const initial=init(c);let s=initial;const log=[];
 const run=(type,fields={})=>{const command=cmd(type,s.revision,{actor:s.turn,...fields}),result=apply(s,command);assert.equal(result.accepted,true,result.code);log.push(command);s=result.nextState;return result;};
 const play=id=>({cardInstanceId:s.hands[s.turn].find(x=>x.definitionId===id).instanceId});
 run('PLAY_SECTION_CARD',play('I_AM_SPARTACUS'));assert.equal(s.diceLab.spartacusFaces.length,2);
 run('ASSIGN_SECTION_ORDERS',{unitIds:[],leaderIds:[]});run('END_EXPERIMENTAL_TURN');
 assert.equal(s.discardPile.length,0);assert.equal(s.diceLab.counter.previous,'I_AM_SPARTACUS');
 run('PLAY_SECTION_CARD',play('COUNTER_ATTACK'));assert.equal(s.diceLab.spartacusFaces.length,3);
 assert.equal(project(s,'B').effectiveCardInPlay,'I_AM_SPARTACUS');
 run('ASSIGN_SECTION_ORDERS',{unitIds:[],leaderIds:[]});run('END_EXPERIMENTAL_TURN');
 assert.deepEqual(replay(initial,log),s);
});

test('V31 First Strike: private decision, defensive roll, resumption or elimination, replacement and replay',()=>{
 for(const mode of ['DECLINE','NO_CARD','HIT','ELIMINATE','RETREAT']){
  const c=tacticalCardSetup('ORDER_2_LEFT',true,3);
  Object.assign(c,{enableMoveFireMoveLab:true,enableRallyLab:true,enableSpartacusLab:true,enableCounterAttackLab:true,enableFirstStrikeLab:true});
  if(mode!=='NO_CARD')c.cardInstances[4].definitionId='FIRST_STRIKE';
  const initial=init(c);let s=initial;const log=[];
  const run=(type,fields={},actor=s.turn)=>{const command=cmd(type,s.revision,{actor,...fields}),result=apply(s,command);assert.equal(result.accepted,true,mode+': '+result.code);log.push(command);s=result.nextState;return result;};
  const reject=(type,fields,code,actor=s.turn)=>assert.equal(apply(s,cmd(type,s.revision,{actor,...fields})).code,code);
  run('PLAY_SECTION_CARD',{cardInstanceId:s.hands.A.find(x=>x.definitionId==='ORDER_2_LEFT').instanceId});
  run('ASSIGN_SECTION_ORDERS',{unitIds:['a1'],leaderIds:[]});run('FINISH_SECTION_MOVEMENT_LAB');
  run('PREPARE_SECTION_CLOSE_LAB',{attackerId:'a1',targetId:'b1'});
  assert.equal(project(s,'A').diceLab.firstStrikePending,true);
  assert.equal(project(s,'A').diceLab.canAcceptFirstStrike,false);
  assert.equal(project(s,'B').diceLab.canAcceptFirstStrike,mode!=='NO_CARD');
  reject('ROLL_SECTION_RANGED_DIGITAL_LAB',{},'FIRST_STRIKE_DECISION_PENDING');
  reject('ACCEPT_SECTION_FIRST_STRIKE_LAB',{},'FIRST_STRIKE_NOT_AVAILABLE');
  if(mode==='DECLINE'||mode==='NO_CARD'){
   if(mode==='NO_CARD')reject('ACCEPT_SECTION_FIRST_STRIKE_LAB',{},'FIRST_STRIKE_CARD_REQUIRED','B');
   run('DECLINE_SECTION_FIRST_STRIKE_LAB',{},'B');
   assert.equal(s.combatLab.plan.attackerId,'a1');assert.equal(s.hands.B.length,2);
  }else{
   run('ACCEPT_SECTION_FIRST_STRIKE_LAB',{},'B');
   assert.equal(s.turn,'A');assert.equal(s.combatLab.plan.attackerId,'b1');assert.equal(s.combatLab.plan.firstStrike,true);
   assert.equal(s.hands.B.length,1);assert.equal(project(s,'B').diceLab.combatSide,'B');
   const faces=Array(s.combatLab.plan.diceCount).fill('LIGHT');
   if(mode==='HIT')faces.fill('HEAVY',1);
   if(mode==='RETREAT'){faces.fill('HEAVY');faces[0]='FLAG';}
   run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{faces},'B');run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{accept:true});
   if(mode==='RETREAT'){
    const route=project(s,'A').diceLab.retreat.options.find(o=>o.path.length>0&&o.blocksLost===0);assert.ok(route);
    run('RETREAT_SECTION_UNIT_LAB',{path:route.path},'A');
   }else run('FINALIZE_SECTION_RANGED_LAB',{},'B');
   assert.equal(s.diceLab.blocks.a1,mode==='HIT'?3:mode==='RETREAT'?4:undefined);
   if(mode==='HIT'){
    assert.equal(s.combatLab.plan.attackerId,'a1');assert.equal(s.diceLab.firstStrike.suppress,true);
    run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{faces:Array(s.combatLab.plan.diceCount).fill('LIGHT')});
    run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{accept:true},'B');run('FINALIZE_SECTION_RANGED_LAB');
    assert.equal(s.diceLab.last.battleBackPending,false);
   }else assert.equal(s.combatLab.plan,null);
   assert.deepEqual(s.diceLab.resolvedUnitIds,['a1']);
   const expected=s.drawPile.at(-1);
   run('END_EXPERIMENTAL_TURN');assert.ok(s.hands.B.some(c=>c.instanceId===expected.instanceId));
   assert.equal(s.hands.B.length,2);
  }
  assert.deepEqual(replay(initial,log),s);
 }
});

test('water terrain in journal: ford fire cap, bridge morale, impassable retreat and replay',()=>{
 const c=rangedLabSetup({targetCol:4,terrain:[{col:2,row:4,kind:'FORDABLE_RIVER'},{col:4,row:4,kind:'BRIDGE'},{col:4,row:3,kind:'RIVER'}]});
 c.enableDiceLab=true;c.enableCasualtyLab=true;c.enableMoraleLab=true;c.enableRetreatLab=true;
 const {initial,ordered,commands}=rangedLabReady(c);let s=ordered;const log=[...commands];
 const run=(type,fields={},actor='A')=>{const command=cmd(type,s.revision,{actor,...fields}),result=apply(s,command);assert.equal(result.accepted,true,result.code);log.push(command);s=result.nextState;};
 run('FINISH_SECTION_MOVEMENT_LAB');run('PREPARE_SECTION_RANGED_LAB',{attackerId:'a1',targetId:'b1'});
 assert.equal(s.combatLab.plan.diceCount,1);
 run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{faces:['FLAG']});run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{accept:true},'B');
 assert.equal(project(s,'B').diceLab.blocker,'MORALE_CHOICE_PENDING');
 run('CHOOSE_SECTION_MORALE_LAB',{ignored:0},'B');
 const options=project(s,'B').diceLab.retreat.options;assert.ok(options.length);assert.ok(options.every(o=>o.path.every(p=>p.col!==4||p.row!==3)));
 run('RETREAT_SECTION_UNIT_LAB',{path:options[0].path},'B');assert.deepEqual(replay(initial,log),s);
});

test('fortifications: camp outgoing penalty, directional rampart protection and replay',()=>{
 for(const kind of ['FORTIFIED_CAMP','FRONT','REAR','MOUNTED','ELEPHANT']){
  const c=tacticalCardSetup('ORDER_2_LEFT',true,3);
  c.movementUnitTypes.a1=kind==='ELEPHANT'?'ELEPHANT':'HEAVY_INFANTRY';
  if(kind==='MOUNTED')c.movementUnitTypes.b1='HEAVY_CAVALRY';
  c.movementTerrain=[kind==='FORTIFIED_CAMP'?{col:3,row:4,kind}:{col:3,row:4,kind:'RAMPART',sides:kind==='REAR'?[0,1]:[3,4]}];
  const {initial,ordered,commands}=rangedLabReady(c);let s=ordered;const log=[...commands];
  const run=(type,fields={},actor='A')=>{const command=cmd(type,s.revision,{actor,...fields}),result=apply(s,command);assert.equal(result.accepted,true,kind+': '+result.code);log.push(command);s=result.nextState;};
  run('FINISH_SECTION_MOVEMENT_LAB');run('PREPARE_SECTION_CLOSE_LAB',{attackerId:'a1',targetId:'b1'});
  if(s.combatLab.plan.evadePath===null)run('CHOOSE_SECTION_UNIT_EVADE_LAB',{path:[]},'B');
  const protectedTarget=!['REAR','MOUNTED'].includes(kind);
  assert.equal(!!s.combatLab.plan.fortificationDefense,protectedTarget);
  const faces=Array(s.combatLab.plan.diceCount).fill('FLAG');faces[0]='SWORDS';
  run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{faces});run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{accept:true},'B');
  assert.equal(!!s.diceLab.pending.interpretation.fortificationSwordIgnored,protectedTarget);
  assert.equal(s.diceLab.pending.interpretation.hits,protectedTarget?0:1);
  assert.equal(!!project(s,'B').diceLab.moralePreview.fortificationDefense,protectedTarget);
  if(kind==='ELEPHANT')assert.deepEqual(s.diceLab.pending.interpretation.rerolls,[]);
  assert.deepEqual(replay(initial,log),s);
 }
 const c=rangedLabSetup({terrain:[{col:2,row:4,kind:'FORTIFIED_CAMP'}]});
 c.enableDiceLab=true;const {ordered}=rangedLabReady(c);const closed=apply(ordered,cmd('FINISH_SECTION_MOVEMENT_LAB',2)).nextState;
 assert.equal(apply(closed,cmd('PREPARE_SECTION_RANGED_LAB',3,{attackerId:'a1',targetId:'b1'})).nextState.combatLab.plan.diceCount,1);
});

test('marsh terrain: ordered mounted move, deterministic loss and leader checks, replay',()=>{
 for(const mode of ['UNIT','ATTACHED','LEADER']){
  const c=tacticalCardSetup('ORDER_2_LEFT',true,10);
  Object.assign(c,{enableMoveFireMoveLab:true,enableRallyLab:true,enableSpartacusLab:true,enableCounterAttackLab:true,enableFirstStrikeLab:true});
  c.movementTerrain=[{col:3,row:4,kind:'MARSH'}];
  c.movementUnitTypes.a1='LIGHT_CAVALRY';
  if(mode!=='UNIT')c.board.leaders=[{id:'a_leader',side:'A',col:2,row:4}];
  const initial=init(c);assert.equal(initial.diceLab.version,32);
  if(mode==='ATTACHED')initial.diceLab.blocks.a1=1;
  const play=cmd('PLAY_SECTION_CARD',0,{cardInstanceId:initial.hands.A[0].instanceId});
  const order=cmd('ASSIGN_SECTION_ORDERS',1,{unitIds:mode==='LEADER'?[]:['a1'],leaderIds:mode==='LEADER'?['a_leader']:[]});
  const move=mode==='LEADER'?cmd('MOVE_SECTION_LEADER_PATH_V1',2,{leaderId:'a_leader',path:[{col:3,row:4}]}):cmd('MOVE_SECTION_MOUNTED_PATH_V1',2,{unitId:'a1',path:[{col:3,row:4}]});
  let result,s;
  for(let n=0;n<500;n++){
    initial.diceLab.key=n.toString(16).padStart(64,'0');
    s=apply(apply(initial,play).nextState,order).nextState;result=apply(s,move);
    assert.equal(result.accepted,true,result.code);
    const check=result.publicEvent.marshChecks[0];
    if(mode==='LEADER'?check.leaderEliminated:check.blocksLost===1&&(mode!=='ATTACHED'||!check.leaderEliminated))break;
  }
  const check=result.publicEvent.marshChecks[0];s=result.nextState;
  assert.equal(mode==='LEADER'?check.leaderEliminated:check.blocksLost===1,true);
  const log=[play,order,move];
  if(mode==='UNIT')assert.equal(s.diceLab.blocks.a1,2);
  if(mode==='ATTACHED'){
    assert.equal(s.diceLab.blocks.a1,undefined);assert.equal(s.diceLab.marshPending.leaderId,'a_leader');
    assert.equal(apply(s,cmd('FINISH_SECTION_MOVEMENT_LAB',s.revision)).code,'MARSH_LEADER_EVASION_PENDING');
    const view=project(s,'A').diceLab,option=view.leaderEvasionOptions.find(o=>!o.trapped&&!o.risks.length);
    assert.ok(view.canEvadeLeader&&option);
    const evade=cmd('EVADE_SECTION_LEADER_LAB',s.revision,{path:option.path,exit:option.exit});
    const escaped=apply(s,evade);assert.equal(escaped.accepted,true,escaped.code);log.push(evade);s=escaped.nextState;
    assert.equal(s.diceLab.marshPending,null);
  }
  if(mode==='LEADER')assert.equal(s.board.leaders.length,0);
  assert.deepEqual(replay(initial,log),s);
 }
});

test('marsh terrain: ordinary retreat and unit evade roll per entered marsh hex',()=>{
 for(const mode of ['RETREAT','EVADE']){
  const c=tacticalCardSetup('ORDER_2_LEFT',true,mode==='RETREAT'?4:3);
  Object.assign(c,{enableMoveFireMoveLab:true,enableRallyLab:true,enableSpartacusLab:true,enableCounterAttackLab:true,enableFirstStrikeLab:true});
  c.movementUnitTypes.a1=mode==='RETREAT'?'LIGHT_INFANTRY':'HEAVY_INFANTRY';
  c.movementUnitTypes.b1=mode==='RETREAT'?'LIGHT_CAVALRY':'LIGHT_INFANTRY';
  c.movementTerrain=Array.from({length:39},(_,i)=>({col:Math.floor(i/3),row:i%3+1,kind:'MARSH'}));
  const {initial,ordered,commands}=rangedLabReady(c);let s=ordered;const log=[...commands];
  const run=(type,fields={},actor='A')=>{const command=cmd(type,s.revision,{actor,...fields}),result=apply(s,command);assert.equal(result.accepted,true,mode+': '+result.code);log.push(command);s=result.nextState;return result;};
  run('FINISH_SECTION_MOVEMENT_LAB');run(mode==='RETREAT'?'PREPARE_SECTION_RANGED_LAB':'PREPARE_SECTION_CLOSE_LAB',{attackerId:'a1',targetId:'b1'});
  let path;
  if(mode==='EVADE'){
   run('DECLINE_SECTION_FIRST_STRIKE_LAB',{},'B');
   path=s.combatLab.plan.evadeOptions.find(p=>p.every(h=>h.row>=1&&h.row<=3));assert.ok(path);
   run('CHOOSE_SECTION_UNIT_EVADE_LAB',{path},'B');
  }
  const original=s.diceLab.blocks.b1,faces=Array(s.combatLab.plan.diceCount).fill('HEAVY');
  if(mode==='RETREAT')faces[0]='FLAG';
  run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{faces});run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{accept:true},'B');
  if(mode==='RETREAT'){
   path=project(s,'B').diceLab.retreat.options.find(o=>o.blocksLost===0&&o.path.filter(h=>h.row>=1&&h.row<=3).length>=2)?.path;assert.ok(path);
   run('RETREAT_SECTION_UNIT_LAB',{path},'B');
  }else run('FINALIZE_SECTION_RANGED_LAB');
  const checks=s.diceLab.last.marshChecks;assert.ok(checks.length>=2);
  assert.equal(s.diceLab.blocks.b1??0,original-checks.reduce((n,x)=>n+x.blocksLost,0));
  assert.deepEqual(project(s,'B').diceLab.marshLast,checks);
  assert.deepEqual(replay(initial,log),s);
 }
});

test('marsh retreat: shortfall after terrain, elephant retreat and immediate victory',()=>{
 for(const mode of ['ATTACHED','VICTORY','ELEPHANT']){
  const c=tacticalCardSetup('ORDER_2_LEFT',true,4);
  Object.assign(c,{enableMoveFireMoveLab:true,enableRallyLab:true,enableSpartacusLab:true,enableCounterAttackLab:true,enableFirstStrikeLab:true});
  c.board.units[0].row=1;c.board.units[1].row=1;
  c.board.leaders=[{id:'b_leader',side:'B',col:4,row:1}];
  c.movementUnitTypes.b1=mode==='ELEPHANT'?'ELEPHANT':'LIGHT_CAVALRY';
  c.movementTerrain=Array.from({length:13},(_,col)=>({col,row:0,kind:'MARSH'}));
  if(mode==='VICTORY')c.victoryTargets={A:1,B:3};
  let initial,s,log,route,check;
  for(let n=0;n<500;n++){
   initial=init(c);initial.diceLab.key=n.toString(16).padStart(64,'0');
   s=initial;log=[];
   const run=(type,fields={},actor='A')=>{const command=cmd(type,s.revision,{actor,...fields}),result=apply(s,command);assert.equal(result.accepted,true,mode+': '+result.code);log.push(command);s=result.nextState;return result;};
   run('PLAY_SECTION_CARD',{cardInstanceId:s.hands.A[0].instanceId});
   run('ASSIGN_SECTION_ORDERS',{unitIds:['a1'],leaderIds:[]});
   run('FINISH_SECTION_MOVEMENT_LAB');run('PREPARE_SECTION_RANGED_LAB',{attackerId:'a1',targetId:'b1'});
   run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{faces:['FLAG','SWORDS']});run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{accept:true},'B');
   if(mode!=='ELEPHANT')run('CHOOSE_SECTION_MORALE_LAB',{ignored:0},'B');
   for(const u of project(s,'A').diceLab.rampage?.remaining??[])run('ROLL_SECTION_ELEPHANT_RAMPAGE_LAB',{unitId:u.unitId});
   route=project(s,'B').diceLab.retreat.options.find(o=>o.path.length&&o.path.at(-1).row===0&&(mode==='ELEPHANT'||o.blocksLost>0));
   assert.ok(route);
   run('RETREAT_SECTION_UNIT_LAB',{path:route.path},'B');
   check=s.diceLab.last?.marshChecks?.[0];
   if(check?.blocksLost===1&&(mode!=='ATTACHED'||s.diceLab.marshPending))break;
  }
  assert.equal(check?.blocksLost,1);
  if(mode==='ELEPHANT')assert.ok(s.diceLab.blocks.b1>0);
  else{
   assert.equal(s.diceLab.blocks.b1,undefined);
   if(mode==='VICTORY'){assert.equal(s.diceLab.last.victory.winner,'A');assert.equal(s.diceLab.marshPending,null);}
   else{
    assert.equal(s.diceLab.marshPending.leaderId,'b_leader');
    const option=project(s,'B').diceLab.leaderEvasionOptions.find(o=>o.exit||!o.trapped);assert.ok(option);
    const command=cmd('EVADE_SECTION_LEADER_LAB',s.revision,{actor:'B',path:option.path,exit:option.exit});
    const result=apply(s,command);assert.equal(result.accepted,true,result.code);log.push(command);s=result.nextState;
    assert.equal(s.diceLab.marshPending,null);
   }
  }
  assert.deepEqual(replay(initial,log),s);
 }
});

test('server scenario catalog: base deck, asymmetric command, shared sectors, private hands and replay',()=>{
 const deck=createAncientsBaseDeck();
 assert.equal(deck.length,60);assert.equal(new Set(deck.map(c=>c.instanceId)).size,60);
 assert.deepEqual(Object.fromEntries(Object.keys(BASE_DECK_COUNTS).map(id=>[id,deck.filter(c=>c.definitionId===id).length])),BASE_DECK_COUNTS);
 assert.equal(createAncientsScenarioSetup('__proto__'),null);
 assert.deepEqual(listAncientsScenarios().map(s=>s.id),['demo-v1','open-field-v1','crossroads-v1']);
 const setup=createAncientsScenarioSetup('open-field-v1');
 const other=createAncientsScenarioSetup('open-field-v1');setup.movementTerrain.push({col:0,row:0,kind:'HILL'});
 assert.deepEqual(other.movementTerrain,[]);
 const i=other.cardInstances.findIndex(c=>c.definitionId==='ORDER_2_LEFT'),k=other.cardInstances.length-5;
 [other.cardInstances[i],other.cardInstances[k]]=[other.cardInstances[k],other.cardInstances[i]];
 const initial=init({...other,randomIndex:n=>n-1});
 assert.equal(initial.turn,'B');assert.equal(initial.hands.A.length,4);assert.equal(initial.hands.B.length,5);
 assert.equal(initial.drawPile.length,51);assert.equal(initial.board.units.length,12);
 assert.deepEqual(project(initial,'A').scenario,other.scenario);
 assert.equal(JSON.stringify(project(initial,'A')).includes(initial.hands.B[0].instanceId),false);
 const play=cmd('PLAY_SECTION_CARD',0,{actor:'B',cardInstanceId:initial.hands.B[0].instanceId});
 const p=apply(initial,play);assert.equal(p.accepted,true,p.code);
 const order=cmd('ASSIGN_SECTION_ORDERS',1,{actor:'B',unitIds:['B5','B6'],leaderIds:[]});
 const o=apply(p.nextState,order);assert.equal(o.accepted,true,o.code);
 assert.deepEqual(replay(initial,[play,order]),o.nextState);
 assert.throws(()=>init({...other,scenario:{...other.scenario,privateKey:'x'}}),/INVALID_SECTION_SCENARIO_METADATA/);
});

test('territorial objectives: temporary occupancy, permanent capture, victory and replay',()=>{
 for(const mode of ['OCCUPY','CAPTURE','START_TURN_CAPTURE']){
  for(const win of [false,true]){
   const c=tacticalCardSetup('MOVE_FIRE_MOVE',true,10);c.enableMoveFireMoveLab=true;
   c.victoryTargets={A:win?1:3,B:3};
   c.scenarioObjectives=[{id:'objective',side:'A',mode,cells:[{col:3,row:4}],minUnits:1,banners:1}];
   const initial=init(c);let s=initial;const log=[];
   const run=(type,fields={},actor=s.turn)=>{const command=cmd(type,s.revision,{actor,...fields}),r=apply(s,command);assert.equal(r.accepted,true,r.code);log.push(command);s=r.nextState;return r.publicEvent;};
   const score=()=>project(s,'A').diceLab.banners.A;
   const move=col=>({unitId:'a1',path:[{col,row:4}]});
   run('PLAY_SECTION_CARD',{cardInstanceId:s.hands.A.find(x=>x.definitionId==='MOVE_FIRE_MOVE').instanceId});
   run('ASSIGN_SECTION_ORDERS',{unitIds:['a1'],leaderIds:[]});
   const arrival=run('MOVE_SECTION_FOOT_PATH_V2',move(3));
   assert.equal(score(),mode==='START_TURN_CAPTURE'?0:1);
   assert.equal(project(s,'B').victoryObjectives[0].occupied,1);
   if(mode==='CAPTURE')assert.deepEqual(arrival.objectivesCaptured,['objective']);
   if(win&&mode!=='START_TURN_CAPTURE'){
    assert.equal(arrival.victory.winner,'A');
    assert.equal(apply(s,cmd('FINISH_SECTION_MOVEMENT_LAB',s.revision)).code,'MATCH_FINISHED');
   }else{
    run('FINISH_SECTION_MOVEMENT_LAB');run('FINISH_SECTION_MOVEMENT_LAB');
    if(mode!=='START_TURN_CAPTURE'){
     run('MOVE_SECTION_FOOT_PATH_V2',move(2));
     assert.equal(score(),mode==='CAPTURE'?1:0);
     assert.equal(project(s,'A').victoryObjectives[0].claimed,mode==='CAPTURE');
    }
    run('END_EXPERIMENTAL_TURN');
    if(mode==='START_TURN_CAPTURE'){
     assert.equal(score(),0);
     const card=s.hands.B.find(x=>x.definitionId.startsWith('ORDER_'));
     assert.ok(card);
     run('PLAY_SECTION_CARD',{cardInstanceId:card.instanceId});
     run('ASSIGN_SECTION_ORDERS',{unitIds:card.definitionId.endsWith('_RIGHT')?['b1']:[],leaderIds:[]});
     const end=run('END_EXPERIMENTAL_TURN');
     assert.equal(score(),1);assert.deepEqual(end.objectivesCaptured,['objective']);
     assert.equal(project(s,'B').diceLab.victory.winner,win?'A':null);
    }
   }
   assert.deepEqual(replay(initial,log),s);
  }
 }
 const bad=tacticalCardSetup('MOVE_FIRE_MOVE',true,10);bad.enableMoveFireMoveLab=true;
 bad.scenarioObjectives=[{id:'bad',side:'A',mode:'CAPTURE',cells:[{col:13,row:0}],minUnits:1,banners:1}];
 assert.throws(()=>init(bad),/INVALID_SECTION_SCENARIO_OBJECTIVES/);
});

test('external scenario import: schema, provenance, authority, isolation and replay',()=>{
 const setup=createAncientsScenarioSetup('crossroads-v1');
 const doc={schemaVersion:1,geometry:LAB_SCENARIO_GEOMETRY,id:'external-v1',title:'Imported example',
  deckId:'ancients-base-2009',provenance:{kind:'COMMUNITY',source:'Original test fixture'},
  factions:{A:'South',B:'North'},startingSide:setup.startingSide,handSizes:setup.handSizes,victoryTargets:setup.victoryTargets,
  units:setup.board.units.map(u=>({...u,type:setup.movementUnitTypes[u.id]})),leaders:setup.board.leaders,
  terrain:setup.movementTerrain,sectorCells:setup.sectorCells,objectives:setup.scenarioObjectives};
 const catalog=createAncientsScenarioCatalog([doc]);
 assert.equal(catalog.list().length,4);
 assert.deepEqual(catalog.list().at(-1).provenance,doc.provenance);
 const imported=catalog.setup(doc.id);
 const initial=init({...imported,randomIndex:n=>n-1});
 assert.deepEqual(project(initial,'A').scenario.provenance,doc.provenance);
 assert.deepEqual(project(initial,'B').scenario.factions,doc.factions);
 assert.deepEqual(project(initial,'A').victoryObjectives.map(x=>x.id),doc.objectives.map(x=>x.id));
 assert.equal(initial.totalCards,60);assert.equal(initial.turn,'B');
 assert.deepEqual(replay(initial,[]),initial);
 doc.units[0].col=12;doc.provenance.kind='OFFICIAL';
 imported.board.units[0].col=0;
 assert.equal(catalog.setup(doc.id).board.units[0].col,2);
 assert.equal(catalog.setup(doc.id).scenario.provenance.kind,'COMMUNITY');
 doc.provenance.kind='COMMUNITY';
 const invalid=[
  {...doc,enableDiceLab:false},{...doc,deckId:'unknown'},{...doc,schemaVersion:2},
  {...doc,objectives:null},{...doc,units:[...doc.units,{...doc.units[0]}]},
  {...doc,sectorCells:{}},{...doc,id:'open-field-v1'},{...doc,id:'demo-v1'}
 ];
 for(const bad of invalid)assert.throws(()=>createAncientsScenarioCatalog([bad]));
 assert.throws(()=>createAncientsScenarioCatalog([{...doc,geometry:'UNKNOWN'}]),/UNSUPPORTED_SCENARIO_GEOMETRY/);
 assert.throws(()=>createAncientsScenarioCatalog([{...doc,geometry:OFFICIAL_BOARD_GEOMETRY}]));
 assert.throws(()=>createAncientsScenarioCatalog([doc,doc]),/DUPLICATE_SCENARIO_ID/);
 assert.equal(catalog.setup('__proto__'),null);
});

test('official geometry journal: legal diagonal, forbidden short-row cell, close combat and replay',()=>{
 const setup=createAncientsScenarioSetup('open-field-v1');
 setup.scenario={id:'geometry-test-v1',title:'Original geometry fixture',deckId:'ancients-base-2009',
  geometry:OFFICIAL_BOARD_GEOMETRY,provenance:{kind:'ORIGINAL',source:'test'},factions:{A:'South',B:'North'}};
 setup.sectorCells=officialSectorCells();setup.startingSide='A';
 setup.board={units:[{id:'a1',side:'A',col:4,row:4},{id:'a2',side:'A',col:8,row:4},{id:'b1',side:'B',col:4,row:2}],
  leaders:[]};
 setup.movementUnitTypes={a1:'LIGHT_INFANTRY',a2:'LIGHT_CAVALRY',b1:'HEAVY_INFANTRY'};
 const selected=setup.cardInstances.findIndex(c=>c.definitionId==='ORDER_2_CENTER');
 const end=setup.cardInstances.length-1;
 [setup.cardInstances[selected],setup.cardInstances[end]]=[setup.cardInstances[end],setup.cardInstances[selected]];
 const doc={schemaVersion:1,...setup.scenario,startingSide:setup.startingSide,handSizes:setup.handSizes,victoryTargets:setup.victoryTargets,
  units:setup.board.units.map(u=>({...u,type:setup.movementUnitTypes[u.id]})),leaders:setup.board.leaders,terrain:[],sectorCells:setup.sectorCells};
 const imported=createAncientsScenarioCatalog([doc]).setup(doc.id);
 const initial=init({...imported,cardInstances:setup.cardInstances,randomIndex:n=>n-1});let s=initial;const log=[];
 const run=(type,fields={},actor=s.turn)=>{const c=cmd(type,s.revision,{actor,...fields}),r=apply(s,c);assert.equal(r.accepted,true,r.code);log.push(c);s=r.nextState;return r.publicEvent;};
 assert.equal(project(s,'A').scenario.geometry,OFFICIAL_BOARD_GEOMETRY);
 run('PLAY_SECTION_CARD',{cardInstanceId:s.hands.A[0].instanceId});
 run('ASSIGN_SECTION_ORDERS',{unitIds:['a1','a2'],leaderIds:[]});
 assert.equal(apply(s,cmd('MOVE_SECTION_FOOT_PATH_V2',s.revision,{unitId:'a1',path:[{col:5,row:3}]})).accepted,false);
 assert.equal(apply(s,cmd('MOVE_SECTION_FOOT_PATH_V2',s.revision,{unitId:'a2',path:[{col:8,row:3}]})).accepted,false);
 run('MOVE_SECTION_FOOT_PATH_V2',{unitId:'a1',path:[{col:3,row:3}]});
 run('MOVE_SECTION_MOUNTED_PATH_V1',{unitId:'a2',path:[{col:7,row:3}]});
 run('FINISH_SECTION_MOVEMENT_LAB');
 run('PREPARE_SECTION_CLOSE_LAB',{attackerId:'a1',targetId:'b1'});
 if(s.diceLab.firstStrike.window)run('DECLINE_SECTION_FIRST_STRIKE_LAB',{},'B');
 assert.equal(s.combatLab.plan.distance,1);
 run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{faces:Array(s.combatLab.plan.diceCount).fill('FLAG')});
 run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{accept:true},'B');
 if(project(s,'B').diceLab.blocker==='MORALE_CHOICE_PENDING')run('CHOOSE_SECTION_MORALE_LAB',{ignored:0},'B');
 const route=project(s,'B').diceLab.retreat.options.find(o=>o.blocksLost===0);
 assert.ok(route);assert.ok(route.path.every((p,i)=>p.row===(i?route.path[i-1].row:2)-1));
 run('RETREAT_SECTION_UNIT_LAB',{path:route.path},'B');
 assert.deepEqual(s.board.units.find(u=>u.id==='b1'),{id:'b1',side:'B',...route.path.at(-1)});
 assert.deepEqual(replay(initial,log),s);
 const bad=structuredClone(setup);bad.board.units[0].col=12;bad.board.units[0].row=3;
 assert.throws(()=>init({...bad,randomIndex:n=>n-1}),/INVALID_SECTION_HISTORY_BOARD/);
});

test('scenario special rules: Sacred Band, immediate casualty reward, progressive hands and replay',()=>{
 const setup=createAncientsScenarioSetup('open-field-v1');
 setup.startingSide='A';setup.board={units:[{id:'a1',side:'A',col:5,row:4},{id:'b1',side:'B',col:5,row:3},{id:'b2',side:'B',col:10,row:1}],leaders:[]};
 setup.movementUnitTypes={a1:'HEAVY_INFANTRY',b1:'HEAVY_INFANTRY',b2:'LIGHT_INFANTRY'};
 setup.movementTerrain=[];
 setup.cardInstances.sort((a,b)=>Number(/^ORDER_[234]_/.test(a.definitionId))-Number(/^ORDER_[234]_/.test(b.definitionId)));
 const selected=setup.cardInstances.findIndex(c=>c.definitionId==='ORDER_2_CENTER'),end=setup.cardInstances.length-1;
 [setup.cardInstances[selected],setup.cardInstances[end]]=[setup.cardInstances[end],setup.cardInstances[selected]];
 const doc={schemaVersion:1,...setup.scenario,id:'special-rule-test-v1',geometry:LAB_SCENARIO_GEOMETRY,provenance:{kind:'ORIGINAL',source:'test'},factions:{A:'South',B:'North'},startingSide:'A',handSizes:setup.handSizes,victoryTargets:setup.victoryTargets,
  units:setup.board.units.map(u=>({...u,type:setup.movementUnitTypes[u.id]})),leaders:[],terrain:[],sectorCells:setup.sectorCells,
  specialRules:{sacredBand:['a1','b1'],handGrowth:[
    {id:'reward',side:'A',trigger:'CASUALTY_BANNERS',threshold:1,cards:2},
    {id:'turn1',side:'A',trigger:'OWN_TURN_END',threshold:1,cards:1},
    {id:'turn2',side:'A',trigger:'OWN_TURN_END',threshold:2,cards:1}
  ]}};
 const imported=createAncientsScenarioCatalog([doc]).setup(doc.id);
 for(const kill of [false,true]){
  const initial=init({...imported,cardInstances:setup.cardInstances,randomIndex:n=>n-1});let s=initial;const log=[];
  const run=(type,fields={},actor=s.turn)=>{const c=cmd(type,s.revision,{actor,...fields}),r=apply(s,c);assert.equal(r.accepted,true,type+': '+r.code);log.push(c);s=r.nextState;return r.publicEvent;};
  assert.equal(project(s,'B').board.find(u=>u.id==='a1').sacredBand,true);
  run('PLAY_SECTION_CARD',{cardInstanceId:s.hands.A[0].instanceId});
  run('ASSIGN_SECTION_ORDERS',{unitIds:['a1'],leaderIds:[]});
  run('FINISH_SECTION_MOVEMENT_LAB');run('PREPARE_SECTION_CLOSE_LAB',{attackerId:'a1',targetId:'b1'});
  if(s.diceLab.firstStrike.window)run('DECLINE_SECTION_FIRST_STRIKE_LAB',{},'B');
  assert.equal(s.combatLab.plan.leaderHit,true);
  const faces=Array(s.combatLab.plan.diceCount).fill(kill?'LEADER':'LIGHT');
  if(!kill)faces[0]='FLAG';
  run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{faces});run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{accept:true},'B');
  if(!kill){const m=project(s,'B').diceLab.moralePreview;assert.equal(m.sacredBand,true);assert.equal(m.maxIgnored,1);run('CHOOSE_SECTION_MORALE_LAB',{ignored:1},'B');}
  const before=s.hands.A.length;
  const event=run('FINALIZE_SECTION_RANGED_LAB');
  if(kill){assert.equal(s.board.units.some(u=>u.id==='b1'),false);assert.equal(s.hands.A.length,before+2);assert.deepEqual(event.scenarioHandGrowth,[{id:'reward',side:'A',cards:2}]);assert.equal(JSON.stringify(project(s,'B')).includes(s.hands.A.at(-1).instanceId),false);}
  else {assert.equal(s.hands.A.length,before);assert.equal(event.scenarioHandGrowth,undefined);}
  if(s.diceLab.last?.battleBackPending)run('DECLINE_SECTION_BATTLE_BACK_LAB',{},'B');
  if(s.diceLab.last?.momentum?.pending)run('CHOOSE_SECTION_MOMENTUM_LAB',{path:[]});
  const first=run('END_EXPERIMENTAL_TURN');assert.deepEqual(first.scenarioHandGrowth,[{id:'turn1',side:'A',cards:1}]);assert.equal(s.hands.A.length,kill?7:5);
  for(const side of ['B','A']){
   const card=s.hands[side].find(c=>/^ORDER_[234]_/.test(c.definitionId));assert.ok(card);
   run('PLAY_SECTION_CARD',{cardInstanceId:card.instanceId});run('ASSIGN_SECTION_ORDERS',{unitIds:[],leaderIds:[]});
   const e=run('END_EXPERIMENTAL_TURN');
   if(side==='A')assert.deepEqual(e.scenarioHandGrowth,[{id:'turn2',side:'A',cards:1}]);
  }
  assert.equal(s.hands.A.length,kill?8:6);assert.deepEqual(replay(initial,log),s);
 }
 assert.throws(()=>createAncientsScenarioCatalog([{...doc,specialRules:{...doc.specialRules,sacredBand:['b2']}}]),/INVALID_SCENARIO_RULES/);
});

test('scenario decisive leader: elimination, evacuation, distinct score and replay',()=>{
 for(const mode of ['ELIMINATED','REMOVED']){
  for(const hit of [true,false]){
   const c=createAncientsScenarioSetup('open-field-v1');
   c.startingSide='A';c.board={units:[{id:'a1',side:'A',col:5,row:1},{id:'b1',side:'B',col:10,row:2}],
    leaders:[{id:'decisive',side:'B',col:5,row:0}]};c.movementUnitTypes={a1:'HEAVY_INFANTRY',b1:'LIGHT_INFANTRY'};
   c.victoryTargets={A:5,B:5};c.scenarioRules={sacredBand:[],handGrowth:[],leaderLoss:[{leaderId:'decisive',winner:'A',mode}]};
   const idx=c.cardInstances.findIndex(x=>x.definitionId==='ORDER_2_CENTER'),last=c.cardInstances.length-1;
   [c.cardInstances[idx],c.cardInstances[last]]=[c.cardInstances[last],c.cardInstances[idx]];
   const initial=init({...c,randomIndex:n=>n-1});let s=initial;const log=[];
   const run=(type,fields={},actor=s.turn)=>{const command=cmd(type,s.revision,{actor,...fields}),r=apply(s,command);assert.equal(r.accepted,true,type+': '+r.code);log.push(command);s=r.nextState;return r.publicEvent;};
   assert.equal(project(s,'B').scenarioLeaderLoss[0].leaderId,'decisive');
   run('PLAY_SECTION_CARD',{cardInstanceId:s.hands.A[0].instanceId});
   run('ASSIGN_SECTION_ORDERS',{unitIds:['a1'],leaderIds:[]});
   run('FINISH_SECTION_MOVEMENT_LAB');run('PREPARE_SECTION_CLOSE_LAB',{attackerId:'a1',targetId:'decisive'});
   run('DECLARE_SECTION_RANGED_PHYSICAL_LAB',{faces:Array(s.combatLab.plan.diceCount).fill(hit?'LEADER':'FLAG')});
   run('REVIEW_SECTION_RANGED_PHYSICAL_LAB',{accept:true},'B');
   if(!hit){
    const option=project(s,'B').diceLab.leaderEvasionOptions.find(o=>o.exit);assert.ok(option);
    run('EVADE_SECTION_LEADER_LAB',{path:option.path,exit:true},'B');
   }
   const victory=project(s,'A').diceLab.victory;
   assert.equal(victory.winner,hit||mode==='REMOVED'?'A':null);
   assert.equal(victory.banners.A,hit?1:0);
   if(victory.winner){assert.equal(victory.reason,'DESIGNATED_LEADER_LOST');assert.equal(apply(s,cmd('END_EXPERIMENTAL_TURN',s.revision)).code,'MATCH_FINISHED');}
   assert.deepEqual(replay(initial,log),s);
   assert.throws(()=>init({...c,scenarioRules:{...c.scenarioRules,leaderLoss:[{leaderId:'unknown',winner:'A',mode}]} }),/INVALID_SCENARIO_RULES/);
  }
 }
});

test('scenario exit and ambush: authenticated orders, movement budget, victory and replay',()=>{
 const setup=()=>{const c=createAncientsScenarioSetup('open-field-v1');
  c.scenario={id:'final-scenarios-test-v1',title:'Fixture',deckId:'ancients-base-2009',geometry:OFFICIAL_BOARD_GEOMETRY,provenance:{kind:'ORIGINAL',source:'test'},factions:{A:'South',B:'North'}};
  c.sectorCells=officialSectorCells();c.startingSide='A';c.handSizes={A:4,B:5};
  c.board={units:[{id:'a1',side:'A',col:5,row:1},{id:'a2',side:'A',col:1,row:0},{id:'b1',side:'B',col:10,row:2}],leaders:[]};
  c.movementUnitTypes={a1:'MEDIUM_CAVALRY',a2:'HEAVY_INFANTRY',b1:'HEAVY_INFANTRY'};c.movementTerrain=[];
  return c;};
 const pick=(c,definition,index)=>{const i=c.cardInstances.findIndex(x=>x.definitionId===definition);[c.cardInstances[i],c.cardInstances[index]]=[c.cardInstances[index],c.cardInstances[i]];};
 const exercise=(initial,fn)=>{let s=initial;const log=[];
  const run=(type,fields={},actor=s.turn)=>{const command=cmd(type,s.revision,{actor,...fields}),r=apply(s,command);assert.equal(r.accepted,true,type+': '+r.code);log.push(command);s=r.nextState;return r.publicEvent;};
  const get=()=>s;const deny=(type,fields,code,actor=s.turn)=>assert.equal(apply(s,cmd(type,s.revision,{actor,...fields})).code,code);
  fn(run,get,deny);assert.deepEqual(replay(initial,log),s);
 };
 const x=setup();x.victoryTargets={A:1,B:5};x.scenarioRules={sacredBand:[],handGrowth:[],unitExit:{side:'A',sectors:['CENTER','RIGHT'],banners:1}};
 pick(x,'OUT_FLANKED',59);
 // A2 is on the left; order both via separate sections using a broad card instead.
 pick(x,'ORDER_MOUNTED_TROOPS',59);
 exercise(init({...x,randomIndex:n=>n-1}),(run,get,deny)=>{
  run('PLAY_SECTION_CARD',{cardInstanceId:get().hands.A[0].instanceId});run('ASSIGN_SECTION_ORDERS',{unitIds:['a1'],leaderIds:[]});
  const exitCells=project(get(),'A').scenarioExitCells;
  assert.ok(exitCells.some(c=>c.col===5&&c.row===0));
  assert.ok(!exitCells.some(c=>c.col===1&&c.row===0));
  assert.deepEqual(project(get(),'B').scenarioExitCells,exitCells);
  for(const path of [null,{},'5,0',42])
   deny('MOVE_SECTION_MOUNTED_PATH_V1',{unitId:'a1',path},'INVALID_MOUNTED_PATH');
  deny('EXIT_SCENARIO_UNIT',{unitId:'a2',path:[]},'INVALID_SCENARIO_EXIT');
  deny('EXIT_SCENARIO_UNIT',{unitId:'a1',path:[]},'INVALID_SCENARIO_EXIT');
  deny('EXIT_SCENARIO_UNIT',{unitId:'a1',path:[{col:12,row:0}]},'INVALID_SCENARIO_EXIT');
  run('EXIT_SCENARIO_UNIT',{unitId:'a1',path:[{col:5,row:0}]});
  assert.equal(get().diceLab.casualties.length,0);assert.equal(project(get(),'B').diceLab.banners.A,1);assert.equal(project(get(),'B').diceLab.victory.winner,'A');
 });
 const y=setup();y.scenarioRules={sacredBand:[],handGrowth:[],reserve:{side:'B',units:[{id:'reserve_c',type:'MEDIUM_CAVALRY'},{id:'reserve_w1',type:'WARRIOR_INFANTRY'},{id:'reserve_w2',type:'WARRIOR_INFANTRY'}],leaderId:'reserve_l'}};
 y.cardInstances.sort((a,b)=>Number(/^ORDER_[234]_/.test(a.definitionId))-Number(/^ORDER_[234]_/.test(b.definitionId)));
 pick(y,'ORDER_2_CENTER',59);pick(y,'INSPIRED_LEFT_LEADERSHIP',55);pick(y,'LEADERSHIP_ANY_SECTION',54);
 for(const standard of [false,true]){
 const z=structuredClone(y);
 if(standard){
  z.scenarioRules.reserve.entryTerrainPolicy='STANDARD_V1';
  z.movementTerrain=[{col:4,row:8,kind:'BROKEN_GROUND'},{col:5,row:8,kind:'FOREST'},{col:6,row:7,kind:'BUILDING'}];
 }
 exercise(init({...z,randomIndex:n=>n-1}),(run,get,deny)=>{
  const pass=()=>{const s=get(),card=s.hands[s.turn].find(c=>/^ORDER_[234]_/.test(c.definitionId));assert.ok(card);
   run('PLAY_SECTION_CARD',{cardInstanceId:card.instanceId});run('ASSIGN_SECTION_ORDERS',{unitIds:[],leaderIds:[]});run('END_EXPERIMENTAL_TURN');};
  pass();
  run('PLAY_SECTION_CARD',{cardInstanceId:get().hands.B.find(c=>c.definitionId==='INSPIRED_LEFT_LEADERSHIP').instanceId});
  assert.equal(project(get(),'B').scenarioReserveOptions,undefined);
  run('ASSIGN_SECTION_ORDERS',{unitIds:[],leaderIds:[]});run('END_EXPERIMENTAL_TURN');pass();
  run('PLAY_SECTION_CARD',{cardInstanceId:get().hands.B.find(c=>c.definitionId==='LEADERSHIP_ANY_SECTION').instanceId});
  const options=project(get(),'B').scenarioReserveOptions;assert.ok(options);
  const option=options.options.find(o=>o.section==='CENTER'),placements=options.units.map((u,i)=>({unitId:u.id,col:option.cells[i].col}));
  const fields={section:'CENTER',placements,leaderUnitId:'reserve_c'};
  deny('DEPLOY_SCENARIO_RESERVE',{...fields,placements:placements.map(p=>({...p,col:placements[0].col}))},'INVALID_SCENARIO_RESERVE');
  run('DEPLOY_SCENARIO_RESERVE',fields);
  assert.equal(get().board.units.length,6);assert.equal(get().combatLab.movement.reserve_c.steps,1);
  assert.equal(get().scenarioRules.reserve.enteredTurn,1);
  const col=placements[0].col;
  if(standard){
   assert.equal(col,4);
   assert.equal(get().combatLab.movement.reserve_c.battle,'UNAVAILABLE');
   assert.equal(get().combatLab.movement.reserve_w1.battle,'POSSIBLE');
   assert.equal(project(get(),'B').scenarioReserveMovableIds.includes('reserve_c'),false);
   assert.equal(project(get(),'B').scenarioReserveMovableIds.includes('reserve_w1'),false);
   assert.equal(project(get(),'B').scenarioReserveMovableIds.includes('reserve_w2'),true);
   deny('MOVE_SECTION_MOUNTED_PATH_V1',{unitId:'reserve_c',path:[{col,row:7}]},'UNIT_ALREADY_MOVED');
   deny('MOVE_SECTION_FOOT_PATH_V2',{unitId:'reserve_w2',path:[{col:6,row:7}]},'INVALID_RESERVE_CONTINUATION');
   run('FINISH_SECTION_MOVEMENT_LAB');assert.deepEqual(project(get(),'B').scenarioReserveMovableIds,[]);
   run('END_EXPERIMENTAL_TURN');return;
  }
  deny('MOVE_SECTION_MOUNTED_PATH_V1',{unitId:'reserve_c',path:[{col,row:7},{col,row:6},{col,row:5}]},'INVALID_RESERVE_CONTINUATION');
  run('MOVE_SECTION_MOUNTED_PATH_V1',{unitId:'reserve_c',path:[{col,row:7},{col,row:6}]});
  assert.equal(get().combatLab.movement.reserve_c.steps,3);assert.equal(get().board.leaders.find(l=>l.id==='reserve_l').row,6);
  assert.equal(project(get(),'B').scenarioReserveMovableIds.includes('reserve_c'),false);
  deny('MOVE_SECTION_MOUNTED_PATH_V1',{unitId:'reserve_c',path:[{col,row:5}]},'UNIT_ALREADY_MOVED');
  run('FINISH_SECTION_MOVEMENT_LAB');run('END_EXPERIMENTAL_TURN');
 });
 }
});
