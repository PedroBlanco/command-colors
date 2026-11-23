import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeSectionHistoryLab as init,applySectionHistoryLabCommand as apply,
 replaySectionHistoryLab as replay,projectSectionHistoryLab as project,
 assertSectionHistoryLab as validate} from './section-history-journal.mjs';

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
 const mounted=completeFootSetup();mounted.movementUnitTypes.a1='LIGHT_CAVALRY';
 assert.throws(()=>init(mounted),/INVALID_FOOT_LAB_SETUP/);
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
