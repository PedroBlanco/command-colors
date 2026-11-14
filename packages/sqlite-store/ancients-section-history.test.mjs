/**
 * Full CCWB composition integration. Uses real identity + invitation persistence.
 * These are laboratory operations, with NO HTTP entrypoint for initial setup.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openSqliteComposition} from './sqlite.mjs';

const PASSWORD='test-only-DO-NOT-USE-in-production-00000';
function setup(){
 return {cardInstances:[
   {instanceId:'card_a_left',definitionId:'ORDER_2_LEFT'},
   {instanceId:'card_b_right',definitionId:'ORDER_2_RIGHT'},
   {instanceId:'card_c_left',definitionId:'ORDER_3_LEFT'},
   {instanceId:'card_d_right',definitionId:'ORDER_3_RIGHT'},
   {instanceId:'card_e_left',definitionId:'ORDER_4_LEFT'},
   {instanceId:'card_f_right',definitionId:'ORDER_4_RIGHT'}],
  handSizes:{A:2,B:2},startingSide:'A',randomIndex:()=>0,
  board:{units:[{id:'unitA',side:'A',col:2,row:4},
    {id:'unitB',side:'B',col:10,row:4}],leaders:[]},
  sectorCells:{'2,4':['LEFT'],'10,4':['RIGHT']}
 };
}
async function fixture(fn){
 const dir=mkdtempSync(join(tmpdir(),'ccw-section-composition-'));
 const file=join(dir,'match.sqlite'),opened=[];
 const connect=()=>{const x=openSqliteComposition({file});opened.push(x);return x;};
 try{
  const app=connect();
  for(const handle of ['alice','bob','charlie']){
    const r=await app.identity.provisionAccount({handle,password:PASSWORD});
    assert.equal(r.ok,true);
  }
  const a=await app.identity.logIn({handle:'alice',password:PASSWORD});
  const b=await app.identity.logIn({handle:'bob',password:PASSWORD});
  const c=await app.identity.logIn({handle:'charlie',password:PASSWORD});
  const created=app.invitations.createMatch({sessionToken:a.token});
  const invited=app.invitations.issueInvitation({sessionToken:a.token,matchId:created.matchId,targetHandle:'bob'});
  assert.equal(app.invitations.acceptInvitation({sessionToken:b.token,invitationToken:invited.token}).ok,true);
  return await fn({app,connect,matchId:created.matchId,tokens:{A:a.token,B:b.token,outsider:c.token}});
 }finally{
  for(const x of opened.reverse())try{x.close()}catch{}
  rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});
 }
}

test('CCWB composition: experimental history excludes synthetic commands and views',()=>fixture(async({app,matchId,tokens})=>{
 const store=app.getStore(matchId);
 assert.equal(store.initializeExperimentalSectionHistory({sessionToken:tokens.B,trustedSetup:setup()}).code,'FORBIDDEN');
 assert.equal(store.initializeExperimentalSectionHistory({sessionToken:tokens.A,trustedSetup:setup()}).code,'SECTION_LAB_INITIALIZED');
 assert.equal(store.initializeCommandDeck('A').code,'SECTION_LAB_MODE_ACTIVE');
 const owner=store.view('A'),other=store.view('B');
 assert.equal(owner.status,'LAB_ONLY');assert.equal(other.status,'LAB_ONLY');
 assert.equal(owner.opponentCardCount,2);
 assert.equal(JSON.stringify(owner).includes(other.yourHand[0].instanceId),false);
 assert.equal(JSON.stringify(other).includes(owner.yourHand[0].instanceId),false);
 const pass=await store.dispatch({actor:'A',type:'pass_demo_turn',
   expectedRevision:0,idempotencyKey:'legacy_demo_refused'});
 assert.equal(pass.code,'SECTION_LAB_INTERNAL_ONLY');
 assert.equal(store.dispatchExperimentalSectionHistory({sessionToken:tokens.A,type:'pass_demo_turn',
   expectedRevision:0,idempotencyKey:'lab_rejected_demo'}).code,'INVALID_SECTION_LAB_COMMAND');
 assert.equal(store.view('A').revision,0);
 assert.equal(store.publicEvents('A').length,0);
}));

test('CCWB composition: logged section-card command survives restart and stays private',()=>fixture(async({app,connect,matchId,tokens})=>{
 const store=app.getStore(matchId);
 assert.equal(store.initializeExperimentalSectionHistory({sessionToken:tokens.A,trustedSetup:setup()}).status,201);
 const card=store.view('A').yourHand[0];
 const command={sessionToken:tokens.A,type:'PLAY_SECTION_CARD',expectedRevision:0,
   idempotencyKey:'persist_section_0001',cardInstanceId:card.instanceId};
 const generic=await store.dispatch({...command,actor:'A'});
 assert.equal(generic.code,'SECTION_LAB_INTERNAL_ONLY');
 const recorded=store.dispatchExperimentalSectionHistory(command);
 assert.equal(recorded.code,'SECTION_LAB_APPLIED');
 assert.equal(recorded.view.revision,1);
 assert.equal(store.publicEvents('B').length,1);
 assert.equal(JSON.stringify(store.publicEvents('B')).includes(card.instanceId),false);
 const next=connect().getStore(matchId);
 assert.equal(next.view('B').revision,1);
 assert.equal(next.view('B').opponentCardCount,1);
 assert.equal(next.dispatchExperimentalSectionHistory(command).code,'ALREADY_APPLIED');
 assert.equal(next.view('A').cardPlayAuthorized,false);
 assert.equal(next.view('A').attackAuthorized,false);
}));

test('CCWB composition: untouched demo match retains ordinary demonstration commands',()=>fixture(async({app,matchId,tokens})=>{
 const store=app.getStore(matchId);
 assert.equal(store.view('A').status,'ACTIVE');
 const result=await store.dispatch({actor:'A',type:'pass_demo_turn',
   expectedRevision:0,idempotencyKey:'untouched_demo_0001'});
 assert.equal(result.code,'APPLIED');
 assert.equal(store.view('B').revision,1);
 assert.equal(store.publicEvents('B').length,1);
 assert.equal(store.initializeExperimentalSectionHistory({sessionToken:tokens.A,trustedSetup:setup()}).code,'SECTION_LAB_NOT_AVAILABLE');
}));

test('CCWB composition: only live members may initialize or inspect experimental history',()=>fixture(async({app,matchId,tokens})=>{
 const store=app.getStore(matchId);
 assert.equal(store.initializeExperimentalSectionHistory({sessionToken:'invalid',trustedSetup:setup()}).code,'UNAUTHENTICATED');
 assert.equal(store.initializeExperimentalSectionHistory({sessionToken:tokens.outsider,trustedSetup:setup()}).code,'NOT_FOUND');
 assert.equal(store.initializeExperimentalSectionHistory({sessionToken:tokens.B,trustedSetup:setup()}).code,'FORBIDDEN');
 assert.equal(store.initializeExperimentalSectionHistory({actor:'A',sessionToken:tokens.A,trustedSetup:setup()}).code,'INVALID_SECTION_LAB_REQUEST');
 assert.equal(store.initializeExperimentalSectionHistory({sessionToken:tokens.A,trustedSetup:setup()}).code,'SECTION_LAB_INITIALIZED');
 assert.equal(store.viewExperimentalSectionHistory({sessionToken:'invalid'}).code,'UNAUTHENTICATED');
 assert.equal(store.viewExperimentalSectionHistory({sessionToken:tokens.outsider}).code,'NOT_FOUND');
 assert.equal(store.viewExperimentalSectionHistory({actor:'B',sessionToken:tokens.A}).code,'INVALID_SECTION_LAB_REQUEST');
 const a=store.viewExperimentalSectionHistory({sessionToken:tokens.A});
 const b=store.viewExperimentalSectionHistory({sessionToken:tokens.B});
 assert.equal(a.status,200);assert.equal(a.view.you,'A');
 assert.equal(b.status,200);assert.equal(b.view.you,'B');
 assert.equal(a.view.opponentCardCount,2);
 assert.equal(JSON.stringify(a).includes(b.view.yourHand[0].instanceId),false);
 assert.equal(JSON.stringify(b).includes(a.view.yourHand[0].instanceId),false);
 assert.equal(store.view('A').revision,0);
}));

test('CCWB composition: actor is session-derived and spoofed commands never persist',()=>fixture(async({app,matchId,tokens})=>{
 const store=app.getStore(matchId);
 assert.equal(store.initializeExperimentalSectionHistory({sessionToken:tokens.A,trustedSetup:setup()}).status,201);
 const card=store.viewExperimentalSectionHistory({sessionToken:tokens.A}).view.yourHand[0].instanceId;
 const command={type:'PLAY_SECTION_CARD',expectedRevision:0,idempotencyKey:'auth_section_play_0001',cardInstanceId:card};
 assert.equal(store.dispatchExperimentalSectionHistory({...command,sessionToken:tokens.B}).code,'NOT_YOUR_TURN');
 assert.equal(store.dispatchExperimentalSectionHistory({...command,sessionToken:tokens.outsider}).code,'NOT_FOUND');
 assert.equal(store.dispatchExperimentalSectionHistory({...command,sessionToken:'invalid'}).code,'UNAUTHENTICATED');
 assert.equal(store.dispatchExperimentalSectionHistory({...command,sessionToken:tokens.A,actor:'B'}).code,'INVALID_SECTION_LAB_COMMAND');
 assert.equal(store.dispatchExperimentalSectionHistory({...command,sessionToken:tokens.A,sessionUserId:'forged'}).code,'INVALID_SECTION_LAB_COMMAND');
 assert.equal(store.viewExperimentalSectionHistory({sessionToken:tokens.A}).view.revision,0);
 assert.equal(store.publicEvents('A').length,0);
 const applied=store.dispatchExperimentalSectionHistory({...command,sessionToken:tokens.A});
 assert.equal(applied.code,'SECTION_LAB_APPLIED');
 assert.equal(applied.view.you,'A');
 assert.equal(store.dispatchExperimentalSectionHistory({...command,sessionToken:tokens.A}).code,'ALREADY_APPLIED');
 assert.equal(store.viewExperimentalSectionHistory({sessionToken:tokens.B}).view.opponentCardCount,1);
 app.identity.logOut(tokens.A);
 assert.equal(store.dispatchExperimentalSectionHistory({...command,sessionToken:tokens.A}).code,'UNAUTHENTICATED');
 assert.equal(store.viewExperimentalSectionHistory({sessionToken:tokens.A}).code,'UNAUTHENTICATED');
 assert.equal(store.viewExperimentalSectionHistory({sessionToken:tokens.B}).view.revision,1);
}));

test('CCWB composition: authenticated opponent can play only on their own turn',()=>fixture(async({app,matchId,tokens})=>{
 const store=app.getStore(matchId);
 assert.equal(store.initializeExperimentalSectionHistory({sessionToken:tokens.A,trustedSetup:setup()}).status,201);
 const dispatch=(sessionToken,type,expectedRevision,key,other={})=>
   store.dispatchExperimentalSectionHistory({sessionToken,type,expectedRevision,idempotencyKey:key,...other});
 const first=store.viewExperimentalSectionHistory({sessionToken:tokens.A}).view.yourHand[0].instanceId;
 assert.equal(dispatch(tokens.A,'PLAY_SECTION_CARD',0,'first_turn_play_0001',{cardInstanceId:first}).status,200);
 assert.equal(dispatch(tokens.A,'ASSIGN_SECTION_ORDERS',1,'first_turn_orders_0001',{unitIds:['unitA'],leaderIds:[]}).status,200);
 assert.equal(dispatch(tokens.A,'END_EXPERIMENTAL_TURN',2,'first_turn_end_0001').status,200);
 assert.equal(store.viewExperimentalSectionHistory({sessionToken:tokens.B}).view.turn,'B');
 const second=store.viewExperimentalSectionHistory({sessionToken:tokens.B}).view.yourHand[0].instanceId;
 assert.equal(dispatch(tokens.A,'PLAY_SECTION_CARD',3,'wrong_side_0001',{cardInstanceId:second}).code,'NOT_YOUR_TURN');
 assert.equal(dispatch(tokens.B,'PLAY_SECTION_CARD',3,'second_turn_play_0001',{cardInstanceId:second}).status,200);
 const a=store.viewExperimentalSectionHistory({sessionToken:tokens.A}).view;
 const b=store.viewExperimentalSectionHistory({sessionToken:tokens.B}).view;
 assert.equal(a.revision,4);assert.equal(b.you,'B');
 assert.equal(JSON.stringify(a).includes(second),false);
 assert.equal(a.attackAuthorized,false);
 assert.equal(b.combatResolved,false);
}));

test('CCWB composition: altered laboratory public events are never projected',()=>fixture(async({app,matchId,tokens})=>{
 const store=app.getStore(matchId);
 assert.equal(store.initializeExperimentalSectionHistory({sessionToken:tokens.A,trustedSetup:setup()}).status,201);
 const card=store.viewExperimentalSectionHistory({sessionToken:tokens.A}).view.yourHand[0].instanceId;
 const result=store.dispatchExperimentalSectionHistory({sessionToken:tokens.A,type:'PLAY_SECTION_CARD',
   expectedRevision:0,idempotencyKey:'tamper_event_0001',cardInstanceId:card});
 assert.equal(result.code,'SECTION_LAB_APPLIED');
 assert.equal(store.publicEvents('B').length,1);
 app.unsafeTestDatabase().prepare('UPDATE game_events SET payload=? WHERE match_id=?').run('{}',matchId);
 assert.throws(()=>store.publicEvents('B'),/SECTION_CCWB_HISTORY_TAMPERED/);
 assert.throws(()=>store.viewExperimentalSectionHistory({sessionToken:tokens.A}),/SECTION_CCWB_HISTORY_TAMPERED/);
}));

test('CCWB composition: initialization rechecks owner session within SQLite write transaction',()=>fixture(async({app,matchId,tokens})=>{
 const store=app.getStore(matchId);
 const before=app.unsafeTestDatabase().prepare('SELECT private_state,lobby_revision FROM matches WHERE id=?').get(matchId);
 const original=app.identity.resolveSession;
 let checks=0;
 try {
   app.identity.resolveSession=(token)=>{
     if(token===tokens.A) {
       checks++;
       if(checks===2){
         assert.equal(app.unsafeTestDatabase().isTransaction,true);
         return null; // Model another connection revoking the session before lock.
       }
     }
     return original(token);
   };
   assert.equal(store.initializeExperimentalSectionHistory({
     sessionToken:tokens.A,trustedSetup:setup()
   }).code,'UNAUTHENTICATED');
   assert.equal(checks,2);
 } finally {app.identity.resolveSession=original;}
 const after=app.unsafeTestDatabase().prepare('SELECT private_state,lobby_revision FROM matches WHERE id=?').get(matchId);
 assert.deepEqual(after,before);
 assert.equal(store.initializeExperimentalSectionHistory({
   sessionToken:tokens.A,trustedSetup:setup()
 }).code,'SECTION_LAB_INITIALIZED');
}));

test('CCWB composition: command rechecks live session within write transaction',()=>fixture(async({app,matchId,tokens})=>{
 const store=app.getStore(matchId);
 assert.equal(store.initializeExperimentalSectionHistory({
   sessionToken:tokens.A,trustedSetup:setup()
 }).status,201);
 const card=store.viewExperimentalSectionHistory({sessionToken:tokens.A}).view.yourHand[0].instanceId;
 const command={sessionToken:tokens.A,type:'PLAY_SECTION_CARD',expectedRevision:0,
   idempotencyKey:'revoked_race_0001',cardInstanceId:card};
 const before=app.unsafeTestDatabase().prepare('SELECT private_state,game_revision FROM matches WHERE id=?').get(matchId);
 const original=app.identity.resolveSession;
 let checks=0;
 try {
   app.identity.resolveSession=(token)=>{
     if(token===tokens.A) {
       checks++;
       if(checks===2) {
         assert.equal(app.unsafeTestDatabase().isTransaction,true);
         return null;
       }
     }
     return original(token);
   };
   assert.equal(store.dispatchExperimentalSectionHistory(command).code,'UNAUTHENTICATED');
   assert.equal(checks,2);
 } finally {app.identity.resolveSession=original;}
 assert.deepEqual(app.unsafeTestDatabase().prepare('SELECT private_state,game_revision FROM matches WHERE id=?').get(matchId),before);
 assert.equal(store.publicEvents('A').length,0);
 assert.equal(app.unsafeTestDatabase().prepare('SELECT COUNT(*) AS n FROM game_commands').get().n,0);
 assert.equal(store.dispatchExperimentalSectionHistory(command).code,'SECTION_LAB_APPLIED');
}));

test('CCWB composition: private section view authenticates within a read snapshot',()=>fixture(async({app,matchId,tokens})=>{
 const store=app.getStore(matchId);
 assert.equal(store.initializeExperimentalSectionHistory({
   sessionToken:tokens.A,trustedSetup:setup()
 }).status,201);
 const original=app.identity.resolveSession;
 let checked=0;
 try {
   app.identity.resolveSession=(token)=>{
     if(token===tokens.A) {
       checked++;
       assert.equal(app.unsafeTestDatabase().isTransaction,true);
     }
     return original(token);
   };
   const response=store.viewExperimentalSectionHistory({sessionToken:tokens.A});
   assert.equal(response.status,200);
   assert.equal(response.view.you,'A');
   assert.equal(checked,1);
 } finally {app.identity.resolveSession=original;}
 assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));

test('CCWB composition: private views and public events do not acquire a writer lock',()=>fixture(async({app,connect,matchId,tokens})=>{
 const store=app.getStore(matchId);
 assert.equal(store.initializeExperimentalSectionHistory({
   sessionToken:tokens.A,trustedSetup:setup()
 }).status,201);
 // With WAL, a reader can see the last committed state even while another
 // connection owns BEGIN IMMEDIATE. The former publicEvents implementation
 // also used BEGIN IMMEDIATE and would fail with SQLITE_BUSY here.
 const writer=connect().unsafeTestDatabase();
 writer.exec('BEGIN IMMEDIATE');
 try {
   const viewed=store.viewExperimentalSectionHistory({sessionToken:tokens.A});
   assert.equal(viewed.status,200);
   assert.equal(viewed.view.revision,0);
   assert.deepEqual(store.publicEvents('A'),[]);
   assert.deepEqual(store.publicEvents('B'),[]);
 } finally {writer.exec('ROLLBACK');}
 assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));


/** Private read-only R-04/R-05 preview, using real sessions and the CCWB
 *  database journal. Never authorize a move or leak another hand. */
const movementContext=()=>({unitTypes:{unitA:'LIGHT_INFANTRY',unitB:'HEAVY_INFANTRY'},terrain:[]});
function stageForMovement(store,token,trustedSetup=setup()){
  assert.equal(store.initializeExperimentalSectionHistory({sessionToken:token,trustedSetup}).status,201);
  const card=store.viewExperimentalSectionHistory({sessionToken:token}).view.yourHand[0].instanceId;
  assert.equal(store.dispatchExperimentalSectionHistory({sessionToken:token,type:'PLAY_SECTION_CARD',
    expectedRevision:0,idempotencyKey:'private_preview_card_0001',cardInstanceId:card}).status,200);
  assert.equal(store.dispatchExperimentalSectionHistory({sessionToken:token,type:'ASSIGN_SECTION_ORDERS',
    expectedRevision:1,idempotencyKey:'private_preview_orders_0001',unitIds:['unitA'],leaderIds:[]}).status,200);
}
const movementRequest=(token,opts={})=>({
  sessionToken:token,expectedRevision:2,unitId:'unitA',path:[{col:3,row:4}],...opts
});

test('CCWB composition: authenticated movement preview verifies stored orders, never writes or leaks hands',()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId),trusted=movementContext();
  stageForMovement(store,tokens.A);
  const db=app.unsafeTestDatabase();
  const row= db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
  const events=db.prepare('SELECT * FROM game_events WHERE match_id=? ORDER BY sequence').all(matchId);
  const commands=db.prepare('SELECT * FROM game_commands WHERE match_id=? ORDER BY committed_revision').all(matchId);
  const opponent=store.viewExperimentalSectionHistory({sessionToken:tokens.B}).view.yourHand;
  const r=store.precheckExperimentalSectionMovement(movementRequest(tokens.A),trusted);
  assert.equal(r.status,200);assert.equal(r.code,'SECTION_LAB_MOVEMENT_PREVIEW');
  assert.equal(r.preview.status,'CANDIDATE');
  assert.equal(r.preview.movementAuthorized,false);assert.equal(r.preview.attackAuthorized,false);
  assert.equal(r.preview.stateChanged,false);assert.equal(r.preview.needsFullLegalityCheck,true);
  for(const hidden of opponent) assert.equal(JSON.stringify(r).includes(hidden.instanceId),false);
  assert.equal(JSON.stringify(r).includes('private_preview_orders_0001'),false);
  const next=connect().getStore(matchId);
  assert.equal(next.precheckExperimentalSectionMovement(movementRequest(tokens.A),trusted).preview.status,'CANDIDATE');
  assert.deepEqual(db.prepare('SELECT * FROM matches WHERE id=?').get(matchId),row);
  assert.deepEqual(db.prepare('SELECT * FROM game_events WHERE match_id=? ORDER BY sequence').all(matchId),events);
  assert.deepEqual(db.prepare('SELECT * FROM game_commands WHERE match_id=? ORDER BY committed_revision').all(matchId),commands);
  assert.equal(db.isTransaction,false);
}));

test('CCWB composition: private preview rejects missing session, outsider, impersonation and malformed requests',()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForMovement(store,tokens.A);
  const trusted=movementContext();
  assert.equal(store.precheckExperimentalSectionMovement(movementRequest('invalid'),trusted).code,'UNAUTHENTICATED');
  assert.equal(store.precheckExperimentalSectionMovement(movementRequest(tokens.outsider),trusted).code,'NOT_FOUND');
  assert.equal(store.precheckExperimentalSectionMovement(movementRequest(tokens.B),trusted).preview.reason,'NOT_ACTING_PLAYER');
  for(const extra of [{actor:'A'},{sessionUserId:'forged'},{serverContext:trusted},{trustedContext:trusted},
    {unitTypes:trusted.unitTypes},{idempotencyKey:'request_forge_001'}]){
    assert.equal(store.precheckExperimentalSectionMovement(movementRequest(tokens.A,extra),trusted).code,
      'INVALID_SECTION_LAB_MOVEMENT_REQUEST');
  }
  for(const bad of [null,[],{}, {sessionToken:tokens.A},
    movementRequest(tokens.A,{unitId:'!'}),movementRequest(tokens.A,{path:[]}),
    movementRequest(tokens.A,{path:[{col:-1,row:4}]}),
    movementRequest(tokens.A,{path:[{col:3,row:4,side:'A'}]}),
    movementRequest(tokens.A,{path:[{col:'3',row:4}]}),
    movementRequest(tokens.A,{expectedRevision:'2'})]){
    assert.equal(store.precheckExperimentalSectionMovement(bad,trusted).code,'INVALID_SECTION_LAB_MOVEMENT_REQUEST');
  }
  const rival=store.precheckExperimentalSectionMovement(movementRequest(tokens.A,{unitId:'unitB'}),trusted);
  const absent=store.precheckExperimentalSectionMovement(movementRequest(tokens.A,{unitId:'missingUnit'}),trusted);
  assert.equal(rival.preview.reason,'UNIT_NOT_ORDERED');
  assert.equal(absent.preview.reason,rival.preview.reason);
  assert.equal(store.precheckExperimentalSectionMovement(movementRequest(tokens.A,{expectedRevision:1}),trusted).preview.reason,'STALE_REVISION');
  app.identity.logOut(tokens.A);
  assert.equal(store.precheckExperimentalSectionMovement(movementRequest(tokens.A),trusted).code,'UNAUTHENTICATED');
  assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));

test('CCWB composition: private preview uses a WAL read snapshot and respects committed logout',()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForMovement(store,tokens.A);
  const writer=connect().unsafeTestDatabase();
  writer.exec('BEGIN IMMEDIATE');
  try {
    writer.prepare('DELETE FROM sessions WHERE token_digest=(SELECT token_digest FROM sessions JOIN accounts ON sessions.user_id=accounts.id WHERE accounts.handle=?)').run('alice');
    // WAL readers observe the last committed session, not the uncommitted revocation.
    const preview=store.precheckExperimentalSectionMovement(movementRequest(tokens.A),movementContext());
    assert.equal(preview.status,200);assert.equal(preview.preview.status,'CANDIDATE');
  } finally {writer.exec('COMMIT');}
  assert.equal(store.precheckExperimentalSectionMovement(movementRequest(tokens.A),movementContext()).code,'UNAUTHENTICATED');
  assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));

test('CCWB composition: invalid trusted scenario is never accepted, and preview leaves no open transaction',()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForMovement(store,tokens.A);
  const before=app.unsafeTestDatabase().prepare('SELECT private_state,game_revision FROM matches WHERE id=?').get(matchId);
  for(const bad of [undefined,{}, {unitTypes:{unitA:'LIGHT_INFANTRY'},terrain:[]},
    {unitTypes:{unitA:'LIGHT_INFANTRY',unitB:'TELEPORTER'},terrain:[]}]){
    assert.throws(()=>store.precheckExperimentalSectionMovement(movementRequest(tokens.A),bad),/INVALID_STAGED_MOVEMENT_CONTEXT/);
    assert.equal(app.unsafeTestDatabase().isTransaction,false);
  }
  assert.deepEqual(app.unsafeTestDatabase().prepare('SELECT private_state,game_revision FROM matches WHERE id=?').get(matchId),before);
}));

test('CCWB composition: private movement preview fails closed on a tampered public event',()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForMovement(store,tokens.A);
  app.unsafeTestDatabase().prepare('UPDATE game_events SET payload=? WHERE match_id=? AND sequence=1').run('{}',matchId);
  assert.throws(()=>store.precheckExperimentalSectionMovement(movementRequest(tokens.A),movementContext()),
    /SECTION_CCWB_HISTORY_TAMPERED/);
  assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));

test('CCWB composition: preview cannot authorize movement before orders are staged or after turn ends',()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),trusted=movementContext();
  assert.equal(store.precheckExperimentalSectionMovement(movementRequest(tokens.A,{expectedRevision:0}),trusted).code,
    'SECTION_LAB_NOT_INITIALIZED');
  assert.equal(store.initializeExperimentalSectionHistory({sessionToken:tokens.A,trustedSetup:setup()}).status,201);
  const before=store.precheckExperimentalSectionMovement(movementRequest(tokens.A,{expectedRevision:0}),trusted);
  assert.equal(before.preview.reason,'ORDERS_NOT_STAGED');
  const card=store.viewExperimentalSectionHistory({sessionToken:tokens.A}).view.yourHand[0].instanceId;
  assert.equal(store.dispatchExperimentalSectionHistory({sessionToken:tokens.A,type:'PLAY_SECTION_CARD',
    expectedRevision:0,idempotencyKey:'preview_phase_card_01',cardInstanceId:card}).status,200);
  assert.equal(store.precheckExperimentalSectionMovement(movementRequest(tokens.A,{expectedRevision:1}),trusted).preview.reason,'ORDERS_NOT_STAGED');
  assert.equal(store.dispatchExperimentalSectionHistory({sessionToken:tokens.A,type:'ASSIGN_SECTION_ORDERS',
    expectedRevision:1,idempotencyKey:'preview_phase_order_01',unitIds:['unitA'],leaderIds:[]}).status,200);
  assert.equal(store.dispatchExperimentalSectionHistory({sessionToken:tokens.A,type:'END_EXPERIMENTAL_TURN',
    expectedRevision:2,idempotencyKey:'preview_phase_end_0001'}).status,200);
  assert.equal(store.precheckExperimentalSectionMovement(movementRequest(tokens.A,{expectedRevision:3}),trusted).preview.reason,'NOT_ACTING_PLAYER');
  assert.equal(store.precheckExperimentalSectionMovement(movementRequest(tokens.B,{expectedRevision:3,unitId:'unitB',path:[{col:9,row:4}]}),trusted).preview.reason,'ORDERS_NOT_STAGED');
}));


test('CCWB HTTP boundary: event reads fail closed inside their own WAL snapshot',()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId);
  assert.deepEqual(store.publicEvents('A',{denyExperimentalLab:true}),[]);
  // Emulate the HTTP layer reading an ordinary synthetic view first.
  assert.equal(store.view('A').matchId,matchId);
  const other=connect().getStore(matchId);
  assert.equal(other.initializeExperimentalSectionHistory({
    sessionToken:tokens.A,trustedSetup:setup()
  }).status,201);
  const card=other.viewExperimentalSectionHistory({sessionToken:tokens.A}).view.yourHand[0].instanceId;
  assert.equal(other.dispatchExperimentalSectionHistory({
    sessionToken:tokens.A,type:'PLAY_SECTION_CARD',expectedRevision:0,
    idempotencyKey:'late_http_event_guard_001',cardInstanceId:card
  }).status,200);
  assert.equal(store.publicEvents('A').length,1); // Internal callers only.
  assert.deepEqual(store.publicEvents('A',{denyExperimentalLab:true}),
    {status:409,code:'SECTION_LAB_INTERNAL_ONLY'});
  assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));

test('CCWB HTTP boundary: demo command cannot corrupt lab activated before SQLite write lock',()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  const other=connect().getStore(matchId);
  const original=db.exec;
  let activated=false;
  try {
    // A deterministic two-connection interleaving at the exact boundary
    // between the synthetic preflight and its BEGIN IMMEDIATE.
    db.exec=(sql,...args)=>{
      if(sql==='BEGIN IMMEDIATE'&&!activated){
        activated=true;
        assert.equal(other.initializeExperimentalSectionHistory({
          sessionToken:tokens.A,trustedSetup:setup()
        }).status,201);
      }
      return original.call(db,sql,...args);
    };
    const response=await store.dispatch({
      actor:'A',type:'pass_demo_turn',expectedRevision:0,
      idempotencyKey:'late_demo_recheck_001'
    });
    assert.equal(response.status,409);
    assert.equal(response.code,'SECTION_LAB_INTERNAL_ONLY');
    assert.equal(activated,true);
  } finally {db.exec=original;}
  assert.equal(store.viewExperimentalSectionHistory({sessionToken:tokens.A}).view.revision,0);
  assert.equal(store.publicEvents('A').length,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_commands WHERE match_id=?').get(matchId).n,0);
  assert.equal(db.isTransaction,false);
}));


test('CCWB mode exclusivity: deck initialization rechecks lab inside SQLite write lock',()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId);
  const db=app.unsafeTestDatabase();
  const other=connect().getStore(matchId);
  const original=db.exec;
  let injected=false;
  try {
    // Deterministically place a second connection's lab initialization
    // between the deck's preflight and its BEGIN IMMEDIATE writer lock.
    db.exec=(sql,...args)=>{
      if(sql==='BEGIN IMMEDIATE'&&!injected){
        injected=true;
        const activated=other.initializeExperimentalSectionHistory({
          sessionToken:tokens.A,trustedSetup:setup()
        });
        assert.equal(activated.status,201);
      }
      return original.call(db,sql,...args);
    };
    const response=store.initializeCommandDeck('A');
    assert.deepEqual(response,{status:409,code:'SECTION_LAB_MODE_ACTIVE'});
    assert.equal(injected,true);
  } finally {db.exec=original;}
  const row=db.prepare('SELECT private_state,game_revision FROM matches WHERE id=?').get(matchId);
  const persisted=JSON.parse(row.private_state);
  assert.equal(Object.hasOwn(persisted,'ancientsSectionHistoryLab'),true);
  assert.equal(Object.hasOwn(persisted,'commandSession'),false);
  assert.equal(row.game_revision,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_events WHERE match_id=?').get(matchId).n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_commands WHERE match_id=?').get(matchId).n,0);
  assert.equal(store.viewExperimentalSectionHistory({sessionToken:tokens.A}).status,200);
  assert.equal(store.viewExperimentalSectionHistory({sessionToken:tokens.B}).status,200);
  assert.equal(db.isTransaction,false);
}));

test('CCWB mode exclusivity: deck initialization after active lab remains blocked',()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  assert.equal(store.initializeExperimentalSectionHistory({sessionToken:tokens.A,trustedSetup:setup()}).status,201);
  const before=db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
  assert.equal(store.initializeCommandDeck('A').code,'SECTION_LAB_MODE_ACTIVE');
  assert.equal(store.initializeCommandDeck('B').code,'SECTION_LAB_MODE_ACTIVE');
  assert.deepEqual(db.prepare('SELECT * FROM matches WHERE id=?').get(matchId),before);
  assert.equal(db.isTransaction,false);
}));


/** Leader preview stays in the private authenticated CCWB laboratory. */
function stageForLeader(store,token,{orderUnit=false}={}){
  const lab=setup();
  lab.board.leaders=[
    {id:'leaderA',side:'A',col:2,row:4},
    {id:'leaderB',side:'B',col:10,row:4}
  ];
  assert.equal(store.initializeExperimentalSectionHistory({
    sessionToken:token,trustedSetup:lab
  }).status,201);
  const card=store.viewExperimentalSectionHistory({sessionToken:token})
    .view.yourHand[0].instanceId;
  assert.equal(store.dispatchExperimentalSectionHistory({
    sessionToken:token,type:'PLAY_SECTION_CARD',expectedRevision:0,
    idempotencyKey:'leader_preview_card_01',cardInstanceId:card
  }).status,200);
  assert.equal(store.dispatchExperimentalSectionHistory({
    sessionToken:token,type:'ASSIGN_SECTION_ORDERS',expectedRevision:1,
    idempotencyKey:'leader_preview_orders_01',unitIds:orderUnit?['unitA']:[],leaderIds:['leaderA']
  }).status,200);
}
const leaderRequest=(sessionToken,extra={})=>({
  sessionToken,expectedRevision:2,leaderId:'leaderA',
  path:[{col:3,row:4}],...extra
});

test('CCWB composition: preview of ordered leader is private and never persists a move',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForLeader(store,tokens.A);
  const db=app.unsafeTestDatabase();
  const before={
    match:db.prepare('SELECT * FROM matches WHERE id=?').get(matchId),
    events:db.prepare('SELECT * FROM game_events ORDER BY sequence').all(),
    commands:db.prepare('SELECT * FROM game_commands ORDER BY committed_revision').all()
  };
  const candidate=store.precheckExperimentalSectionLeaderMovement(
    leaderRequest(tokens.A),{terrain:[]});
  assert.equal(candidate.status,200);
  assert.equal(candidate.code,'SECTION_LAB_LEADER_MOVEMENT_PREVIEW');
  assert.equal(candidate.preview.status,'CANDIDATE');
  assert.equal(candidate.preview.detachesFromUnit,true);
  assert.equal(candidate.preview.movementAuthorized,false);
  assert.equal(candidate.preview.attackAuthorized,false);
  assert.equal(candidate.preview.stateChanged,false);
  assert.equal(JSON.stringify(candidate).includes('card_a_left'),false);
  assert.equal(store.precheckExperimentalSectionLeaderMovement(
    leaderRequest(tokens.B),{terrain:[]}).preview.reason,'NOT_ACTING_PLAYER');
  assert.equal(store.precheckExperimentalSectionLeaderMovement(
    leaderRequest(tokens.outsider),{terrain:[]}).code,'NOT_FOUND');
  const after={
    match:db.prepare('SELECT * FROM matches WHERE id=?').get(matchId),
    events:db.prepare('SELECT * FROM game_events ORDER BY sequence').all(),
    commands:db.prepare('SELECT * FROM game_commands ORDER BY committed_revision').all()
  };
  assert.deepEqual(after,before);
  assert.equal(db.isTransaction,false);
}));

test('CCWB composition: leader preview binds session and membership in read snapshot',
  ()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForLeader(store,tokens.A);
  const other=connect();
  other.identity.logOut(tokens.A);
  assert.equal(store.precheckExperimentalSectionLeaderMovement(
    leaderRequest(tokens.A),{terrain:[]}).code,'UNAUTHENTICATED');
  const resumed=app.identity.logIn({handle:'alice',password:PASSWORD});
  const again=await resumed;
  assert.equal(again.ok,true);
  const second=store.precheckExperimentalSectionLeaderMovement(
    leaderRequest(again.token),{terrain:[]});
  assert.equal(second.status,200);
  assert.equal(second.preview.movementAuthorized,false);
  other.unsafeTestDatabase().prepare('UPDATE matches SET guest_id=NULL WHERE id=?').run(matchId);
  assert.equal(store.precheckExperimentalSectionLeaderMovement(
    leaderRequest(tokens.B),{terrain:[]}).code,'NOT_FOUND');
}));

test('CCWB composition: leader preview rejects injection and missing trusted terrain',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForLeader(store,tokens.A);
  const invalid=[
    leaderRequest(tokens.A,{actor:'B'}),
    leaderRequest(tokens.A,{leaderId:'__proto__'}),
    leaderRequest(tokens.A,{path:[{col:-1,row:4}]}),
    leaderRequest(tokens.A,{expectedRevision:1.5}),
    {...leaderRequest(tokens.A),path:[{col:3,row:4,side:'B'}]}
  ];
  for(const request of invalid)
    assert.equal(store.precheckExperimentalSectionLeaderMovement(
      request,{terrain:[]}).code,'INVALID_SECTION_LAB_LEADER_REQUEST');
  assert.throws(()=>store.precheckExperimentalSectionLeaderMovement(
    leaderRequest(tokens.A),{}),/INVALID_STAGED_LEADER_CONTEXT/);
  const denied=store.precheckExperimentalSectionLeaderMovement(
    leaderRequest(tokens.A,{leaderId:'leaderB'}),{terrain:[]});
  assert.equal(denied.preview.reason,'LEADER_NOT_ORDERED');
}));


const sequenceLeader=()=>({kind:'LEADER',id:'leaderA',path:[{col:2,row:5}]});
const sequenceUnit=()=>({kind:'UNIT',id:'unitA',path:[{col:3,row:4}]});
const sequenceRequest=(sessionToken,actions,extra={})=>({
  sessionToken,expectedRevision:2,actions,...extra
});

test('CCWB composition: authenticated movement sequence enforces leader/unit order without writes',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),trusted=movementContext();
  stageForLeader(store,tokens.A,{orderUnit:true});
  const db=app.unsafeTestDatabase();
  const capture=()=>({
    match:db.prepare('SELECT * FROM matches WHERE id=?').get(matchId),
    events:db.prepare('SELECT * FROM game_events ORDER BY sequence').all(),
    commands:db.prepare('SELECT * FROM game_commands ORDER BY committed_revision').all()
  });
  const before=capture();
  const first=store.precheckExperimentalSectionMovementSequence(
    sequenceRequest(tokens.A,[sequenceLeader(),sequenceUnit()]),trusted);
  assert.equal(first.status,200);
  assert.equal(first.code,'SECTION_LAB_SEQUENCE_PREVIEW');
  assert.equal(first.preview.status,'CANDIDATE_SEQUENCE');
  assert.equal(first.preview.reviewedMoves,2);
  assert.equal(first.preview.movementAuthorized,false);
  assert.equal(first.preview.attackAuthorized,false);
  assert.equal(first.preview.stateChanged,false);
  const reverse=store.precheckExperimentalSectionMovementSequence(
    sequenceRequest(tokens.A,[sequenceUnit(),sequenceLeader()]),trusted);
  assert.equal(reverse.status,200);
  assert.equal(reverse.preview.status,'BLOCKED');
  assert.equal(reverse.preview.reason,'LEADER_ALREADY_MOVED');
  assert.equal(reverse.preview.step,1);
  assert.deepEqual(capture(),before);
  assert.equal(db.isTransaction,false);
  assert.equal(JSON.stringify(first).includes('card_a_left'),false);
  assert.equal(JSON.stringify(first).includes('PRIVATE_'),false);
}));

test('CCWB composition: movement sequence reads session and membership in WAL snapshot',
  ()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId),other=connect();
  stageForLeader(store,tokens.A,{orderUnit:true});
  const request=sequenceRequest(tokens.A,[sequenceLeader()]);
  assert.equal(store.precheckExperimentalSectionMovementSequence(
    request,movementContext()).status,200);
  other.identity.logOut(tokens.A);
  assert.equal(store.precheckExperimentalSectionMovementSequence(
    request,movementContext()).code,'UNAUTHENTICATED');
  const guest=store.precheckExperimentalSectionMovementSequence(
    sequenceRequest(tokens.B,[sequenceLeader()]),movementContext());
  assert.equal(guest.preview.reason,'NOT_ACTING_PLAYER');
  assert.equal(store.precheckExperimentalSectionMovementSequence(
    sequenceRequest(tokens.outsider,[sequenceLeader()]),movementContext()).code,'NOT_FOUND');
  other.unsafeTestDatabase().prepare('UPDATE matches SET guest_id=NULL WHERE id=?').run(matchId);
  assert.equal(store.precheckExperimentalSectionMovementSequence(
    sequenceRequest(tokens.B,[sequenceLeader()]),movementContext()).code,'NOT_FOUND');
  assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));

test('CCWB composition: movement sequence rejects client-controlled actor, path injection and missing context',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForLeader(store,tokens.A,{orderUnit:true});
  const valid=sequenceRequest(tokens.A,[sequenceLeader()]);
  const invalid=[
    {...valid,actor:'B'},
    {...valid,actions:[{...sequenceLeader(),actor:'B'}]},
    {...valid,actions:[{...sequenceLeader(),path:[{col:2,row:5,side:'B'}]}]},
    {...valid,actions:[{...sequenceLeader(),id:'__proto__'}]},
    {...valid,actions:[]},
    {...valid,expectedRevision:2.5}
  ];
  for(const request of invalid)
    assert.equal(store.precheckExperimentalSectionMovementSequence(
      request,movementContext()).code,'INVALID_SECTION_LAB_SEQUENCE_REQUEST');
  assert.throws(()=>store.precheckExperimentalSectionMovementSequence(
    valid,{terrain:[]}),/INVALID_STAGED_MOVEMENT_CONTEXT/);
  assert.equal(store.precheckExperimentalSectionMovementSequence(
    sequenceRequest(tokens.A,[sequenceUnit()],{expectedRevision:1}),
    movementContext()).preview.reason,'STALE_REVISION');
}));


/** Persisted movement DRAFT: never a confirmed legal move or public event. */
const saveDraftRequest=(sessionToken,overrides={})=>({
  sessionToken,expectedRevision:2,expectedDraftRevision:0,
  idempotencyKey:'draft_movement_a01',
  actions:[sequenceLeader(),sequenceUnit()],...overrides
});

test('CCWB draft: private proposal survives SQLite reopen without changing board, game revision or public log',
  ()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForLeader(store,tokens.A,{orderUnit:true});
  const before={
    revision:db.prepare('SELECT game_revision,lobby_revision FROM matches WHERE id=?').get(matchId),
    events:db.prepare('SELECT * FROM game_events ORDER BY sequence').all(),
    commands:db.prepare('SELECT * FROM game_commands ORDER BY committed_revision').all(),
    board:store.viewExperimentalSectionHistory({sessionToken:tokens.A}).view
  };
  const saved=store.saveExperimentalSectionMovementDraft(
    saveDraftRequest(tokens.A),movementContext());
  assert.equal(saved.status,200);assert.equal(saved.code,'SECTION_LAB_DRAFT_SAVED');
  assert.equal(saved.draftRevision,1);assert.equal(saved.boardChanged,false);
  assert.equal(saved.movementAuthorized,false);
  const next=connect().getStore(matchId).viewExperimentalSectionMovementDraft({
    sessionToken:tokens.A});
  assert.equal(next.status,200);assert.equal(next.code,'SECTION_LAB_DRAFT_VIEW');
  assert.equal(next.draft.draftRevision,1);
  assert.equal(next.draft.baseGameRevision,2);
  assert.deepEqual(next.draft.actions,[sequenceLeader(),sequenceUnit()]);
  assert.equal(next.draft.movementAuthorized,false);
  assert.equal('idempotencyKey' in next.draft,false);
  assert.equal('signature' in next.draft,false);
  const after={
    revision:db.prepare('SELECT game_revision,lobby_revision FROM matches WHERE id=?').get(matchId),
    events:db.prepare('SELECT * FROM game_events ORDER BY sequence').all(),
    commands:db.prepare('SELECT * FROM game_commands ORDER BY committed_revision').all(),
    board:store.viewExperimentalSectionHistory({sessionToken:tokens.A}).view
  };
  assert.deepEqual(after,before);
  assert.equal(JSON.stringify(store.view('B')).includes('draft_movement_a01'),false);
  assert.equal(JSON.stringify(store.publicEvents('B')).includes('draft_movement_a01'),false);
  assert.equal(db.isTransaction,false);
}));

test('CCWB draft: same request is idempotent, stale revision and conflicting retry do not write',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForLeader(store,tokens.A,{orderUnit:true});
  const request=saveDraftRequest(tokens.A);
  assert.equal(store.saveExperimentalSectionMovementDraft(request,movementContext()).code,
    'SECTION_LAB_DRAFT_SAVED');
  const state=db.prepare('SELECT private_state FROM matches WHERE id=?').get(matchId);
  const same=store.saveExperimentalSectionMovementDraft(request,movementContext());
  assert.equal(same.code,'ALREADY_APPLIED');assert.equal(same.draftRevision,1);
  const stale=store.saveExperimentalSectionMovementDraft(
    saveDraftRequest(tokens.A,{idempotencyKey:'draft_second_a02'}),movementContext());
  assert.equal(stale.code,'STALE_DRAFT_REVISION');
  const reused=store.saveExperimentalSectionMovementDraft(
    saveDraftRequest(tokens.A,{actions:[sequenceLeader()]}),movementContext());
  assert.equal(reused.code,'IDEMPOTENCY_KEY_REUSED');
  assert.deepEqual(db.prepare('SELECT private_state FROM matches WHERE id=?').get(matchId),state);
  const next=store.saveExperimentalSectionMovementDraft(
    saveDraftRequest(tokens.A,{expectedDraftRevision:1,idempotencyKey:'draft_second_a02',
      actions:[sequenceLeader()]}),movementContext());
  assert.equal(next.code,'SECTION_LAB_DRAFT_SAVED');assert.equal(next.draftRevision,2);
  assert.equal(store.viewExperimentalSectionMovementDraft({
    sessionToken:tokens.A}).draft.actions.length,1);
  assert.equal(db.prepare('SELECT game_revision FROM matches WHERE id=?').get(matchId).game_revision,2);
}));

test('CCWB draft: rejected movement, forged request and missing trusted terrain are never persisted',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForLeader(store,tokens.A,{orderUnit:true});
  const original=db.prepare('SELECT private_state FROM matches WHERE id=?').get(matchId);
  const denied=store.saveExperimentalSectionMovementDraft(
    saveDraftRequest(tokens.A,{actions:[sequenceUnit(),sequenceLeader()]}),
    movementContext());
  assert.equal(denied.status,409);
  assert.equal(denied.code,'SECTION_LAB_DRAFT_NOT_CANDIDATE');
  for(const request of [
    saveDraftRequest(tokens.A,{actor:'B'}),
    saveDraftRequest(tokens.A,{expectedDraftRevision:-1}),
    saveDraftRequest(tokens.A,{idempotencyKey:'bad'}),
    saveDraftRequest(tokens.A,{actions:[]}),
    saveDraftRequest(tokens.A,{actions:[{...sequenceLeader(),actor:'B'}]}),
    saveDraftRequest(tokens.A,{actions:[{...sequenceLeader(),path:[{col:2,row:5,owner:'B'}]}]})
  ])
    assert.equal(store.saveExperimentalSectionMovementDraft(
      request,movementContext()).code,'INVALID_SECTION_LAB_DRAFT_REQUEST');
  assert.throws(()=>store.saveExperimentalSectionMovementDraft(
    saveDraftRequest(tokens.A),{}),/INVALID_STAGED_MOVEMENT_CONTEXT/);
  assert.deepEqual(db.prepare('SELECT private_state FROM matches WHERE id=?').get(matchId),original);
  assert.equal(db.isTransaction,false);
}));

test('CCWB draft: revocation and rival membership cannot view or write owner proposal',
  ()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForLeader(store,tokens.A,{orderUnit:true});
  const first=store.saveExperimentalSectionMovementDraft(
    saveDraftRequest(tokens.A),movementContext());
  assert.equal(first.status,200);
  assert.equal(store.viewExperimentalSectionMovementDraft({
    sessionToken:tokens.B}).draft,null);
  assert.equal(store.viewExperimentalSectionMovementDraft({
    sessionToken:tokens.outsider}).code,'NOT_FOUND');
  const second=connect();
  second.identity.logOut(tokens.A);
  assert.equal(store.viewExperimentalSectionMovementDraft({
    sessionToken:tokens.A}).code,'UNAUTHENTICATED');
  assert.equal(store.saveExperimentalSectionMovementDraft(
    saveDraftRequest(tokens.A,{expectedDraftRevision:1,idempotencyKey:'draft_new_after_logout'}),
    movementContext()).code,'UNAUTHENTICATED');
  assert.equal(db.prepare('SELECT game_revision FROM matches WHERE id=?').get(matchId).game_revision,2);
  const newLogin=await app.identity.logIn({handle:'alice',password:PASSWORD});
  assert.equal(newLogin.ok,true);
  assert.equal(store.viewExperimentalSectionMovementDraft({
    sessionToken:newLogin.token}).draft.draftRevision,1);
  second.unsafeTestDatabase().prepare('UPDATE matches SET guest_id=NULL WHERE id=?').run(matchId);
  assert.equal(store.viewExperimentalSectionMovementDraft({
    sessionToken:tokens.B}).code,'NOT_FOUND');
  assert.equal(db.isTransaction,false);
}));

test('CCWB draft: advancing the journal invalidates old candidate without exposing it to next player',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForLeader(store,tokens.A,{orderUnit:true});
  assert.equal(store.saveExperimentalSectionMovementDraft(
    saveDraftRequest(tokens.A),movementContext()).status,200);
  const db=app.unsafeTestDatabase();
  const readRow=()=>db.prepare('SELECT private_state FROM matches WHERE id=?').get(matchId);
  assert.equal(Object.hasOwn(JSON.parse(readRow().private_state),
    'ancientsSectionMovementDraft'),true);
  const ended=store.dispatchExperimentalSectionHistory({
    sessionToken:tokens.A,type:'END_EXPERIMENTAL_TURN',expectedRevision:2,
    idempotencyKey:'turn_end_after_draft'
  });
  assert.equal(ended.status,200);
  // Cleanup and journal advance happen under the same writer transaction.
  const after=readRow();
  assert.equal(Object.hasOwn(JSON.parse(after.private_state),
    'ancientsSectionMovementDraft'),false);
  assert.equal(store.dispatchExperimentalSectionHistory({
    sessionToken:tokens.A,type:'END_EXPERIMENTAL_TURN',expectedRevision:2,
    idempotencyKey:'turn_end_after_draft'
  }).code,'ALREADY_APPLIED');
  assert.deepEqual(readRow(),after);
  assert.equal(store.viewExperimentalSectionMovementDraft({
    sessionToken:tokens.A}).draft,null);
  assert.equal(store.viewExperimentalSectionMovementDraft({
    sessionToken:tokens.B}).draft,null);
  assert.equal(store.saveExperimentalSectionMovementDraft(
    saveDraftRequest(tokens.A),movementContext()).code,'STALE_REVISION');
}));


test('CCWB draft: session is revalidated under BEGIN IMMEDIATE and a WAL reader does not lock writer',
  ()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForLeader(store,tokens.A,{orderUnit:true});
  const original=app.identity.resolveSession;
  let checks=0;
  try {
    app.identity.resolveSession=token=>{
      if(token===tokens.A){
        checks++;
        assert.equal(db.isTransaction,true,'auth must be inside the draft transaction');
      }
      return original(token);
    };
    assert.equal(store.saveExperimentalSectionMovementDraft(
      saveDraftRequest(tokens.A),movementContext()).code,'SECTION_LAB_DRAFT_SAVED');
    assert.equal(checks,1);
    const writer=connect().unsafeTestDatabase();
    writer.exec('BEGIN IMMEDIATE');
    try {
      const read=store.viewExperimentalSectionMovementDraft({sessionToken:tokens.A});
      assert.equal(read.status,200);
      assert.equal(read.draft.draftRevision,1);
      assert.equal(checks,2);
    } finally {writer.exec('ROLLBACK');}
  } finally {app.identity.resolveSession=original;}
  assert.equal(db.isTransaction,false);
}));


test('CCWB draft: a denied or stale journal command preserves the private draft bytes',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForLeader(store,tokens.A,{orderUnit:true});
  assert.equal(store.saveExperimentalSectionMovementDraft(
    saveDraftRequest(tokens.A),movementContext()).code,'SECTION_LAB_DRAFT_SAVED');
  const db=app.unsafeTestDatabase();
  const read=()=>db.prepare('SELECT private_state,game_revision FROM matches WHERE id=?')
    .get(matchId);
  const before=read();
  const denied=store.dispatchExperimentalSectionHistory({
    sessionToken:tokens.B,type:'END_EXPERIMENTAL_TURN',expectedRevision:2,
    idempotencyKey:'turn_wrong_actor'
  });
  assert.equal(denied.code,'NOT_YOUR_TURN');
  assert.deepEqual(read(),before);
  const stale=store.dispatchExperimentalSectionHistory({
    sessionToken:tokens.A,type:'END_EXPERIMENTAL_TURN',expectedRevision:1,
    idempotencyKey:'turn_stale_draft'
  });
  assert.equal(stale.code,'STALE_REVISION');
  assert.deepEqual(read(),before);
  assert.equal(store.viewExperimentalSectionMovementDraft({
    sessionToken:tokens.A}).draft.draftRevision,1);
  assert.equal(db.isTransaction,false);
}));


test('CCWB draft write snapshot survives request mutation during writer authentication',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForLeader(store,tokens.A,{orderUnit:true});
  const request=saveDraftRequest(tokens.A),originalActions=structuredClone(request.actions);
  const before=db.prepare('SELECT game_revision,lobby_revision FROM matches WHERE id=?')
    .get(matchId);
  const originalResolver=app.identity.resolveSession;
  let calls=0;
  try {
    app.identity.resolveSession=token=>{
      calls++;
      assert.equal(db.isTransaction,true);
      assert.equal(token,tokens.A);
      // The source object is corrupted after the descriptors were captured.
      // No later authorization, validation or persistence may read it again.
      request.sessionToken='revoked-token';
      request.expectedRevision=1;
      request.expectedDraftRevision=99;
      request.idempotencyKey='corrupted_key_999';
      request.actions[0].id='ghost';
      request.actions[0].path[0].col=12;
      return originalResolver(token);
    };
    const saved=store.saveExperimentalSectionMovementDraft(request,movementContext());
    assert.equal(saved.code,'SECTION_LAB_DRAFT_SAVED');
    assert.equal(saved.draftRevision,1);
    assert.equal(calls,1);
  } finally {
    app.identity.resolveSession=originalResolver;
  }
  const persisted=JSON.parse(db.prepare('SELECT private_state FROM matches WHERE id=?')
    .get(matchId).private_state).ancientsSectionMovementDraft;
  assert.equal(persisted.idempotencyKey,'draft_movement_a01');
  assert.equal(persisted.gameRevision,2);
  assert.equal(persisted.draftRevision,1);
  assert.deepEqual(persisted.actions,originalActions);
  assert.deepEqual(db.prepare('SELECT game_revision,lobby_revision FROM matches WHERE id=?')
    .get(matchId),before);
  assert.equal(db.isTransaction,false);
}));

test('CCWB draft write rejects accessor fields and malformed arrays before any SQLite write',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForLeader(store,tokens.A,{orderUnit:true});
  const before=db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
  let hits=0;
  const idempotencyAccessor=saveDraftRequest(tokens.A);
  Object.defineProperty(idempotencyAccessor,'idempotencyKey',{
    enumerable:true,get(){hits++;throw Error('SHOULD_NOT_CALL_GETTER');}
  });
  const cellAccessor=saveDraftRequest(tokens.A);
  Object.defineProperty(cellAccessor.actions[0].path[0],'row',{
    enumerable:true,get(){hits++;throw Error('SHOULD_NOT_CALL_GETTER');}
  });
  const sparse=saveDraftRequest(tokens.A);
  sparse.actions[0].path=new Array(1);
  for(const request of [idempotencyAccessor,cellAccessor,sparse]){
    assert.deepEqual(store.saveExperimentalSectionMovementDraft(request,movementContext()),
      {status:400,code:'INVALID_SECTION_LAB_DRAFT_REQUEST'});
  }
  assert.equal(hits,0);
  assert.deepEqual(db.prepare('SELECT * FROM matches WHERE id=?').get(matchId),before);
  assert.equal(db.isTransaction,false);
}));

test('CCWB draft writer ignores Proxy getters and persists captured actions only',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForLeader(store,tokens.A,{orderUnit:true});
  const raw=saveDraftRequest(tokens.A),gets=[];
  raw.actions[0].path[0]=new Proxy(raw.actions[0].path[0],{
    get(){gets.push('cell');throw Error('CELL_GET_FORBIDDEN');}
  });
  const request=new Proxy(raw,{
    get(){gets.push('root');throw Error('ROOT_GET_FORBIDDEN');}
  });
  const saved=store.saveExperimentalSectionMovementDraft(request,movementContext());
  assert.equal(saved.code,'SECTION_LAB_DRAFT_SAVED');
  assert.deepEqual(gets,[]);
  const visible=store.viewExperimentalSectionMovementDraft({sessionToken:tokens.A});
  assert.equal(visible.status,200);
  assert.deepEqual(visible.draft.actions,[sequenceLeader(),sequenceUnit()]);
  assert.equal(visible.draft.canCommit,undefined);
  assert.equal(visible.draft.movementAuthorized,false);
}));

const evidenceRequest=(sessionToken,changes={})=>({
  sessionToken,expectedRevision:2,actions:[sequenceLeader(),sequenceUnit()],
  ...changes
});

test('CCWB candidate evidence: bound to session, replay and WAL, leaves all game tables unchanged',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForLeader(store,tokens.A,{orderUnit:true});
  const tableSnapshot=()=>({
    match:db.prepare('SELECT * FROM matches WHERE id=?').get(matchId),
    events:db.prepare('SELECT * FROM game_events WHERE match_id=? ORDER BY sequence').all(matchId),
    commands:db.prepare('SELECT * FROM game_commands WHERE match_id=? ORDER BY committed_revision').all(matchId)
  });
  const before=tableSnapshot();
  const first=store.precheckExperimentalSectionMovementEvidence(
    evidenceRequest(tokens.A),movementContext());
  assert.equal(first.status,200);
  assert.equal(first.code,'SECTION_LAB_CANDIDATE_EVIDENCE');
  assert.equal(first.evidence.status,'CANDIDATE_EVIDENCE');
  assert.equal(first.evidence.journal.matchId,matchId);
  assert.equal(first.evidence.journal.baseRevision,2);
  assert.equal(first.evidence.journal.entries.length,2);
  assert.equal(first.movementAuthorized,false);
  assert.equal(first.boardChanged,false);
  assert.equal(first.evidence.stateChanged,false);
  const second=store.precheckExperimentalSectionMovementEvidence(
    evidenceRequest(tokens.A),movementContext());
  assert.deepEqual(second,first);
  assert.deepEqual(tableSnapshot(),before);
  assert.equal(db.isTransaction,false);
  assert.equal(JSON.stringify(first).includes('card_a_left'),false);
  assert.equal(JSON.stringify(store.publicEvents('B')).includes('captain'),false);
}));

test('CCWB candidate evidence: foreign, outsider and revoked sessions never receive a trace',
  ()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForLeader(store,tokens.A,{orderUnit:true});
  const rival=store.precheckExperimentalSectionMovementEvidence(
    evidenceRequest(tokens.B),movementContext());
  assert.equal(rival.status,200);
  assert.equal(rival.evidence.status,'BLOCKED');
  assert.equal(rival.evidence.journal,null);
  assert.equal(rival.evidence.reason,'NOT_ACTING_PLAYER');
  assert.equal(store.precheckExperimentalSectionMovementEvidence(
    evidenceRequest(tokens.outsider),movementContext()).code,'NOT_FOUND');
  connect().identity.logOut(tokens.A);
  assert.equal(store.precheckExperimentalSectionMovementEvidence(
    evidenceRequest(tokens.A),movementContext()).code,'UNAUTHENTICATED');
}));

test('CCWB candidate evidence: forged client fields, invalid paths or stale revision cannot create trace',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),trusted=movementContext();
  stageForLeader(store,tokens.A,{orderUnit:true});
  for(const request of [
    evidenceRequest(tokens.A,{actor:'B'}),
    evidenceRequest(tokens.A,{matchId}),
    evidenceRequest(tokens.A,{actions:[]}),
    evidenceRequest(tokens.A,{actions:[{...sequenceLeader(),actor:'B'}]}),
    evidenceRequest(tokens.A,{actions:[{...sequenceLeader(),path:[{col:2,row:5,actor:'B'}]}]}),
    evidenceRequest(tokens.A,{expectedRevision:-1}),
    evidenceRequest(tokens.A,{expectedRevision:1.5})
  ])
    assert.equal(store.precheckExperimentalSectionMovementEvidence(
      request,trusted).code,'INVALID_SECTION_LAB_EVIDENCE_REQUEST');
  const stale=store.precheckExperimentalSectionMovementEvidence(
    evidenceRequest(tokens.A,{expectedRevision:1}),trusted);
  assert.equal(stale.evidence.status,'BLOCKED');
  assert.equal(stale.evidence.journal,null);
  assert.equal(stale.evidence.reason,'STALE_REVISION');
  const reversed=store.precheckExperimentalSectionMovementEvidence(
    evidenceRequest(tokens.A,{actions:[sequenceUnit(),sequenceLeader()]}),trusted);
  assert.equal(reversed.evidence.status,'BLOCKED');
  assert.equal(reversed.evidence.journal,null);
  assert.throws(()=>store.precheckExperimentalSectionMovementEvidence(
    evidenceRequest(tokens.A),{}),/INVALID_STAGED_MOVEMENT_CONTEXT/);
}));

test('CCWB candidate evidence: WAL read remains available during another writer lock',
  ()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForLeader(store,tokens.A,{orderUnit:true});
  const writer=connect().unsafeTestDatabase();
  writer.exec('BEGIN IMMEDIATE');
  try{
    const response=store.precheckExperimentalSectionMovementEvidence(
      evidenceRequest(tokens.A),movementContext());
    assert.equal(response.status,200);
    assert.equal(response.evidence.status,'CANDIDATE_EVIDENCE');
    assert.equal(response.evidence.journal.entries.length,2);
  } finally {writer.exec('ROLLBACK');}
  assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));

/** Private LAB-ANC simulation only: real CCWB sessions/WAL/section journal.
 * This API never spends an order, authorizes movement or changes a board. */
const oneHexIntent=(sessionToken,changes={})=>({
  sessionToken,expectedRevision:2,idempotencyKey:'one_hex_internal_0001',
  kind:'UNIT',pieceId:'unitA',path:[{col:3,row:4}],...changes
});
const openHexPolicy=()=>({scope:'SYNTHETIC_OPEN_HEX_V1'});
const oneHexPreview=(store,token,changes={},ctx=movementContext(),policy=openHexPolicy())=>
  store.precheckExperimentalSectionOneHexIntent(oneHexIntent(token,changes),ctx,policy);

test('CCWB one-hex simulation: authenticated replay reads WAL and never writes game state',
  ()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  const before={
    match:db.prepare('SELECT * FROM matches WHERE id=?').get(matchId),
    events:db.prepare('SELECT * FROM game_events WHERE match_id=? ORDER BY sequence').all(matchId),
    commands:db.prepare('SELECT * FROM game_commands WHERE match_id=? ORDER BY committed_revision').all(matchId)
  };
  const response=oneHexPreview(store,tokens.A);
  assert.equal(response.status,200);
  assert.equal(response.code,'SECTION_LAB_ONE_HEX_SIMULATION');
  assert.equal(response.simulation.status,'PRIVATE_LAB_SIMULATION');
  assert.deepEqual(response.simulation.moves,[{
    unitId:'unitA',from:{col:2,row:4},to:{col:3,row:4}
  }]);
  assert.equal(response.simulation.simulatedBoard.units[0].col,3);
  assert.equal(response.simulation.movementAuthorized,false);
  assert.equal(response.simulation.canCommit,false);
  assert.equal(response.movementAuthorized,false);
  assert.equal(response.boardChanged,false);
  assert.equal(response.canCommit,false);
  const contents=JSON.stringify(response);
  assert.equal(contents.includes(tokens.A),false);
  assert.equal(contents.includes('one_hex_internal_0001'),false);
  const otherHand=store.viewExperimentalSectionHistory({sessionToken:tokens.B}).view.yourHand;
  for(const card of otherHand) assert.equal(contents.includes(card.instanceId),false);
  const reopened=connect().getStore(matchId);
  assert.deepEqual(oneHexPreview(reopened,tokens.A),response);
  assert.deepEqual({
    match:db.prepare('SELECT * FROM matches WHERE id=?').get(matchId),
    events:db.prepare('SELECT * FROM game_events WHERE match_id=? ORDER BY sequence').all(matchId),
    commands:db.prepare('SELECT * FROM game_commands WHERE match_id=? ORDER BY committed_revision').all(matchId)
  },before);
  assert.equal(db.isTransaction,false);
}));

test('CCWB one-hex simulation: authentication, membership and actor come from SQLite',
  ()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForMovement(store,tokens.A);
  assert.equal(oneHexPreview(store,'f'.repeat(43)).code,'UNAUTHENTICATED');
  assert.equal(oneHexPreview(store,tokens.outsider).code,'NOT_FOUND');
  const rival=oneHexPreview(store,tokens.B);
  assert.equal(rival.status,200);
  assert.equal(rival.simulation.status,'BLOCKED');
  assert.equal(rival.simulation.reason,'NOT_ACTING_PLAYER');
  assert.equal(rival.simulation.simulatedBoard,null);
  const other=connect();
  assert.equal(other.identity.logOut(tokens.A).ok,true);
  assert.equal(oneHexPreview(store,tokens.A).code,'UNAUTHENTICATED');
  assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));

test('CCWB one-hex simulation: forbidden client metadata and stale revision fail closed',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  const original=db.prepare('SELECT private_state,game_revision FROM matches WHERE id=?').get(matchId);
  for(const changed of [
    {actor:'A'}, {matchId}, {board:{}}, {terrain:[]},
    {policy:openHexPolicy()}, {journal:{}}, {canCommit:true},
    {path:[]}, {path:[{col:3,row:4,side:'A'}]},
    {expectedRevision:'2'}, {idempotencyKey:'x'}
  ]) {
    const response=oneHexPreview(store,tokens.A,changed);
    assert.deepEqual(response,{status:400,code:'INVALID_SECTION_LAB_ONE_HEX_REQUEST'});
  }
  const stale=oneHexPreview(store,tokens.A,{expectedRevision:1});
  assert.equal(stale.simulation.status,'BLOCKED');
  assert.equal(stale.simulation.reason,'STALE_REVISION');
  assert.equal(oneHexPreview(store,tokens.A,{pieceId:'unitB',path:[{col:9,row:4}]}).simulation.status,'BLOCKED');
  assert.equal(oneHexPreview(store,tokens.A,{kind:'LEADER'}).simulation.status,'BLOCKED');
  assert.equal(oneHexPreview(store,tokens.A,{path:[{col:3,row:4},{col:4,row:4}]}).simulation.status,'BLOCKED');
  assert.deepEqual(db.prepare('SELECT private_state,game_revision FROM matches WHERE id=?').get(matchId),original);
  assert.equal(db.isTransaction,false);
}));

test('CCWB one-hex simulation: server policy and terrain restrictions cannot be bypassed',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForMovement(store,tokens.A);
  for(const [ctx,policy] of [
    [movementContext(),null],
    [movementContext(),{scope:'OFFICIAL_GAME'}],
    [{...movementContext(),terrain:[{col:3,row:4,kind:'HILL'}]},openHexPolicy()],
    [null,openHexPolicy()]
  ]) {
    const result=oneHexPreview(store,tokens.A,{},ctx,policy);
    assert.equal(result.simulation.status,'BLOCKED');
    assert.equal(result.simulation.simulatedBoard,null);
    assert.equal(result.simulation.canCommit,false);
  }
  // Passing undefined to the test helper would silently trigger its
  // default context: exercise the STORE method directly instead.
  const withoutContext=store.precheckExperimentalSectionOneHexIntent(
    oneHexIntent(tokens.A),undefined,openHexPolicy());
  assert.equal(withoutContext.simulation.status,'BLOCKED');
  assert.equal(withoutContext.simulation.canCommit,false);
}));

test('CCWB one-hex simulation: reader sees committed WAL state until writer revocation',
  ()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId),reader=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  const writer=connect().unsafeTestDatabase();
  writer.exec('BEGIN IMMEDIATE');
  try{
    writer.prepare(`DELETE FROM sessions WHERE token_digest=(
      SELECT token_digest FROM sessions s JOIN accounts a ON s.user_id=a.id WHERE a.handle=? )`)
      .run('alice');
    const beforeCommit=oneHexPreview(store,tokens.A);
    assert.equal(beforeCommit.simulation.status,'PRIVATE_LAB_SIMULATION');
  }finally{writer.exec('COMMIT');}
  assert.equal(oneHexPreview(store,tokens.A).code,'UNAUTHENTICATED');
  assert.equal(reader.isTransaction,false);
}));

test('CCWB one-hex simulation: tampered replay fails without leaving transaction open',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  db.prepare('UPDATE game_events SET payload=? WHERE match_id=? AND sequence=1')
    .run('{}',matchId);
  assert.throws(()=>oneHexPreview(store,tokens.A),/SECTION_CCWB_HISTORY_TAMPERED/);
  assert.equal(db.isTransaction,false);
}));

test('CCWB one-hex simulation: inactive laboratory cannot be used to bypass deck mode',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId);
  assert.equal(oneHexPreview(store,tokens.A).code,'SECTION_LAB_NOT_INITIALIZED');
  assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));

test('CCWB one-hex simulation: private fixture metadata cannot leak through board projection',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  const privateSetup=setup();
  privateSetup.board.privateDeckMarker='NEVER_SHOW_PRIVATE_DECK';
  privateSetup.board.units[0].serverToken='NEVER_SHOW_OWNER_TOKEN';
  privateSetup.board.units[1].privateEnemyInfo='NEVER_SHOW_OPPONENT_SECRET';
  stageForMovement(store,tokens.A,privateSetup);
  const before=db.prepare('SELECT private_state,game_revision FROM matches WHERE id=?').get(matchId);
  const response=oneHexPreview(store,tokens.A);
  assert.equal(response.status,200);
  assert.equal(response.simulation.status,'PRIVATE_LAB_SIMULATION');
  const json=JSON.stringify(response);
  for(const secret of ['NEVER_SHOW_PRIVATE_DECK',
    'NEVER_SHOW_OWNER_TOKEN','NEVER_SHOW_OPPONENT_SECRET'])
    assert.equal(json.includes(secret),false);
  assert.deepEqual(Object.keys(response.simulation.simulatedBoard).sort(),['leaders','units']);
  for(const unit of response.simulation.simulatedBoard.units)
    assert.deepEqual(Object.keys(unit).sort(),['col','id','row','side']);
  assert.deepEqual(db.prepare('SELECT private_state,game_revision FROM matches WHERE id=?').get(matchId),before);
  assert.equal(db.isTransaction,false);
}));


test('CCWB one-hex simulation: mutation after shape check cannot retarget session, unit or revision',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  const request=oneHexIntent(tokens.A);
  const before=db.prepare('SELECT private_state,game_revision FROM matches WHERE id=?').get(matchId);
  const resolve=app.identity.resolveSession;
  let calls=0;
  try {
    app.identity.resolveSession=token=>{
      if(token===tokens.A) {
        calls++;
        // Simulate a mutable internal caller changing the original object
        // between the first shape check and the replay-verified preview.
        request.sessionToken=tokens.B;
        request.expectedRevision=0;
        request.pieceId='unitB';
        request.path=[{col:9,row:4}];
        request.idempotencyKey='mutated_request_0001';
      }
      return resolve(token);
    };
    const response=store.precheckExperimentalSectionOneHexIntent(
      request,movementContext(),openHexPolicy());
    assert.equal(calls,1);
    assert.equal(response.status,200);
    assert.equal(response.simulation.status,'PRIVATE_LAB_SIMULATION');
    assert.deepEqual(response.simulation.moves,[{
      unitId:'unitA',from:{col:2,row:4},to:{col:3,row:4}
    }]);
    assert.equal(response.simulation.simulatedBoard.units[0].col,3);
    assert.equal(response.simulation.canCommit,false);
    assert.equal(response.boardChanged,false);
    assert.equal(JSON.stringify(response).includes(tokens.A),false);
    assert.equal(JSON.stringify(response).includes(tokens.B),false);
    assert.deepEqual(db.prepare('SELECT private_state,game_revision FROM matches WHERE id=?').get(matchId),before);
    assert.equal(db.isTransaction,false);
  } finally {app.identity.resolveSession=resolve;}
}));


test('SEC-001: revocation after session preflight cannot reveal private lab mode through commands',()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  const writer=connect();
  const before={
    match:db.prepare('SELECT * FROM matches WHERE id=?').get(matchId),
    events:db.prepare('SELECT * FROM game_events WHERE match_id=? ORDER BY sequence').all(matchId),
    commands:db.prepare('SELECT * FROM game_commands WHERE match_id=? ORDER BY committed_revision').all(matchId)
  };
  // Force the exact race: return an initially valid actor to the
  // preflight, but revoke that same session on another WAL connection
  // before store.dispatch can enter its authorizing write transaction.
  const resolve=app.identity.resolveSession;
  let first=true;
  try {
    app.identity.resolveSession=token=>{
      const identity=resolve(token);
      if(first&&token===tokens.A&&identity){
        first=false;
        assert.equal(writer.identity.logOut(token).ok,true);
      }
      return identity;
    };
    const response=await store.dispatchForSession({
      sessionToken:tokens.A,type:'pass_demo_turn',
      expectedRevision:2,idempotencyKey:'revoked_lab_command_001'
    });
    assert.deepEqual(response,{status:401,code:'UNAUTHENTICATED'});
    assert.equal(first,false);
    // An unauthenticated caller must never learn whether the
    // internal laboratory was initialized (409 vs 401).
    assert.equal(JSON.stringify(response).includes('SECTION_LAB'),false);
    assert.deepEqual({
      match:db.prepare('SELECT * FROM matches WHERE id=?').get(matchId),
      events:db.prepare('SELECT * FROM game_events WHERE match_id=? ORDER BY sequence').all(matchId),
      commands:db.prepare('SELECT * FROM game_commands WHERE match_id=? ORDER BY committed_revision').all(matchId)
    },before);
    assert.equal(db.isTransaction,false);
  } finally {app.identity.resolveSession=resolve;}
}));

test('CCWB generic public read: ordinary view stays usable when denying private lab',()=>fixture(async({app,matchId})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  const regular=store.view('A',{denyExperimentalLab:true});
  assert.equal(regular.matchId,matchId);
  assert.equal(regular.status,'ACTIVE');
  assert.equal(Object.hasOwn(regular,'ancientsSectionHistoryLab'),false);
  assert.equal(db.isTransaction,false);
  // A public snapshot does not acquire a writer lock or mutate the DB.
  const row=db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
  assert.deepEqual(store.view('A',{denyExperimentalLab:true}),regular);
  assert.deepEqual(db.prepare('SELECT * FROM matches WHERE id=?').get(matchId),row);
}));

test('CCWB generic public read: private laboratory is denied before any hand projection',()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  assert.equal(store.initializeExperimentalSectionHistory({
    sessionToken:tokens.A,trustedSetup:setup()
  }).status,201);
  const before=db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
  const internal=store.view('A');
  assert.equal(internal.status,'LAB_ONLY');
  assert.ok(internal.yourHand.length>0);
  for(const actor of ['A','B']) {
    const safe=store.view(actor,{denyExperimentalLab:true});
    assert.deepEqual(safe,{status:409,code:'SECTION_LAB_INTERNAL_ONLY'});
    assert.equal(JSON.stringify(safe).includes('yourHand'),false);
    assert.equal(JSON.stringify(safe).includes('card_a_left'),false);
  }
  assert.deepEqual(db.prepare('SELECT * FROM matches WHERE id=?').get(matchId),before);
  assert.equal(db.isTransaction,false);
}));

test('CCWB generic public read: second SQLite connection activates lab before next snapshot',()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId),other=connect().getStore(matchId);
  assert.equal(store.view('A',{denyExperimentalLab:true}).status,'ACTIVE');
  assert.equal(other.initializeExperimentalSectionHistory({
    sessionToken:tokens.A,trustedSetup:setup()
  }).status,201);
  // A new snapshot must observe the committed mode and never publish a hand.
  assert.deepEqual(store.view('A',{denyExperimentalLab:true}),
    {status:409,code:'SECTION_LAB_INTERNAL_ONLY'});
  assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));

test('SEC-001: session-bound ordinary reads authorize a live side and reject outsiders',()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  const a=store.viewForSession({sessionToken:tokens.A});
  const b=store.viewForSession({sessionToken:tokens.B});
  assert.equal(a.you,'A');assert.equal(b.you,'B');
  assert.equal(a.matchId,matchId);assert.equal(b.matchId,matchId);
  assert.deepEqual(a.yourHand,['PRIVATE_A_1','PRIVATE_A_2']);
  assert.equal(JSON.stringify(b).includes('PRIVATE_A_1'),false);
  assert.deepEqual(store.publicEventsForSession({sessionToken:tokens.A}),[]);
  assert.deepEqual(store.viewForSession({sessionToken:tokens.outsider}),
    {status:404,code:'NOT_FOUND'});
  assert.deepEqual(store.publicEventsForSession({sessionToken:tokens.outsider}),
    {status:404,code:'NOT_FOUND'});
  assert.deepEqual(store.viewForSession({sessionToken:'invalid'}),
    {status:401,code:'UNAUTHENTICATED'});
  assert.deepEqual(store.publicEventsForSession({sessionToken:'invalid'}),
    {status:401,code:'UNAUTHENTICATED'});
  assert.equal(db.isTransaction,false);
}));

test('SEC-001: committed logout on another WAL connection denies next public view and events',()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId),other=connect();
  assert.equal(store.viewForSession({sessionToken:tokens.A}).you,'A');
  assert.deepEqual(store.publicEventsForSession({sessionToken:tokens.A}),[]);
  other.identity.logOut(tokens.A);
  assert.deepEqual(store.viewForSession({sessionToken:tokens.A}),
    {status:401,code:'UNAUTHENTICATED'});
  assert.deepEqual(store.publicEventsForSession({sessionToken:tokens.A}),
    {status:401,code:'UNAUTHENTICATED'});
  assert.equal(store.viewForSession({sessionToken:tokens.B}).you,'B');
  assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));

test('SEC-001: same-snapshot membership change revokes session-bound guest projection',()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId);
  assert.equal(store.viewForSession({sessionToken:tokens.B}).you,'B');
  const writer=connect().unsafeTestDatabase();
  writer.prepare('UPDATE matches SET guest_id=NULL,lobby_revision=lobby_revision+1 WHERE id=?')
    .run(matchId);
  assert.deepEqual(store.viewForSession({sessionToken:tokens.B}),
    {status:404,code:'NOT_FOUND'});
  assert.deepEqual(store.publicEventsForSession({sessionToken:tokens.B}),
    {status:404,code:'NOT_FOUND'});
  assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));

test('SEC-001: session-bound public APIs never project a laboratory hand',()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId);
  assert.equal(store.initializeExperimentalSectionHistory({
    sessionToken:tokens.A,trustedSetup:setup()
  }).status,201);
  for(const sessionToken of [tokens.A,tokens.B]){
    const state=store.viewForSession({sessionToken});
    assert.deepEqual(state,{status:409,code:'SECTION_LAB_INTERNAL_ONLY'});
    assert.deepEqual(store.publicEventsForSession({sessionToken}),
      {status:409,code:'SECTION_LAB_INTERNAL_ONLY'});
    assert.equal(JSON.stringify(state).includes('yourHand'),false);
  }
  assert.equal(store.viewExperimentalSectionHistory({sessionToken:tokens.A}).status,200);
  assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));

test('SEC-001: public demo command rechecks authorization while holding writer lock',()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  const before=db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
  let checked=0;
  const result=await store.dispatch({
    actor:'A',type:'pass_demo_turn',expectedRevision:0,
    idempotencyKey:'guard_demo_command_001'
  },()=>{
    checked++;
    assert.equal(db.isTransaction,true);
    return {status:401,code:'UNAUTHENTICATED'};
  });
  assert.equal(checked,1);
  assert.deepEqual(result,{status:401,code:'UNAUTHENTICATED'});
  assert.deepEqual(db.prepare('SELECT * FROM matches WHERE id=?').get(matchId),before);
  assert.equal(db.prepare('SELECT count(*) n FROM game_commands WHERE match_id=?').get(matchId).n,0);
  assert.deepEqual(await store.dispatchForSession({
    sessionToken:tokens.outsider,actor:'A',type:'pass_demo_turn',
    expectedRevision:0,idempotencyKey:'forged_outsider_command_001'
  }),{status:404,code:'NOT_FOUND'});
  assert.equal(db.isTransaction,false);
}));

test('SEC-001: command deck writer rechecks session inside BEGIN IMMEDIATE',()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  assert.equal(store.initializeCommandDeckForSession({sessionToken:tokens.B}).code,'FORBIDDEN');
  assert.equal(store.initializeCommandDeckForSession({sessionToken:tokens.A}).status,201);
  const before=db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
  let checked=0;
  const attempt=await store.dispatch({
    actor:'A',type:'play_synthetic_card',cardRef:'synthetic_card_01',
    expectedRevision:0,idempotencyKey:'guard_deck_command_001'
  },()=>{
    checked++;
    assert.equal(db.isTransaction,true);
    return {status:401,code:'UNAUTHENTICATED'};
  });
  assert.equal(checked,1);
  assert.deepEqual(attempt,{status:401,code:'UNAUTHENTICATED'});
  assert.deepEqual(db.prepare('SELECT * FROM matches WHERE id=?').get(matchId),before);
  assert.equal(db.prepare('SELECT count(*) n FROM game_commands WHERE match_id=?').get(matchId).n,0);
  app.identity.logOut(tokens.A);
  assert.deepEqual(await store.dispatchForSession({
    sessionToken:tokens.A,type:'play_synthetic_card',cardRef:'synthetic_card_01',
    expectedRevision:0,idempotencyKey:'revoked_deck_command_001'
  }),{status:401,code:'UNAUTHENTICATED'});
  assert.deepEqual(store.initializeCommandDeckForSession({sessionToken:tokens.A}),
    {status:401,code:'UNAUTHENTICATED'});
  assert.equal(db.isTransaction,false);
}));

/** Internal board projection is separate from HTTP and committed movements. */
const boardSequence=(sessionToken,actions=[sequenceLeader(),sequenceUnit()],extra={})=>({
  sessionToken,expectedRevision:2,actions,...extra
});
test('CCWB staged board projection: live session, verified replay and WAL are read-only',
  ()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForLeader(store,tokens.A,{orderUnit:true});
  const before={
    match:db.prepare('SELECT * FROM matches WHERE id=?').get(matchId),
    events:db.prepare('SELECT * FROM game_events WHERE match_id=? ORDER BY sequence').all(matchId),
    commands:db.prepare('SELECT * FROM game_commands WHERE match_id=? ORDER BY committed_revision').all(matchId)
  };
  const request=boardSequence(tokens.A);
  const r=store.precheckExperimentalSectionBoardProjection(request,movementContext());
  assert.equal(r.status,200);
  assert.equal(r.code,'SECTION_LAB_BOARD_PROJECTION');
  assert.equal(r.projection.status,'PRIVATE_BOARD_CANDIDATE');
  assert.equal(r.projection.moveCount,2);
  assert.deepEqual(r.projection.projectedBoard.units.find(x=>x.id==='unitA'),
    {id:'unitA',side:'A',col:3,row:4});
  assert.deepEqual(r.projection.projectedBoard.leaders.find(x=>x.id==='leaderA'),
    {id:'leaderA',side:'A',col:2,row:5});
  for(const flag of ['canCommit','movementAuthorized','attackAuthorized','boardChanged'])
    assert.equal(r[flag],false);
  assert.equal(r.projection.officialMovementAuthorized,false);
  assert.equal(r.projection.stateChanged,false);
  const json=JSON.stringify(r);
  assert.equal(json.includes(tokens.A),false);
  for(const field of ['yourHand','drawPile','handAtPlay','cardInstances'])
    assert.equal(json.includes(field),false);
  assert.equal(Object.isFrozen(r.projection.projectedBoard.units[0]),true);
  assert.deepEqual(connect().getStore(matchId)
    .precheckExperimentalSectionBoardProjection(request,movementContext()),r);
  assert.deepEqual({
    match:db.prepare('SELECT * FROM matches WHERE id=?').get(matchId),
    events:db.prepare('SELECT * FROM game_events WHERE match_id=? ORDER BY sequence').all(matchId),
    commands:db.prepare('SELECT * FROM game_commands WHERE match_id=? ORDER BY committed_revision').all(matchId)
  },before);
  assert.equal(db.isTransaction,false);
}));
test('CCWB staged board projection: revocation and membership denial prevent even a preview',
  ()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForLeader(store,tokens.A,{orderUnit:true});
  assert.deepEqual(store.precheckExperimentalSectionBoardProjection(
    boardSequence('untrusted'.repeat(8)),movementContext()),
    {status:401,code:'UNAUTHENTICATED'});
  assert.deepEqual(store.precheckExperimentalSectionBoardProjection(
    boardSequence(tokens.outsider),movementContext()),
    {status:404,code:'NOT_FOUND'});
  const other=store.precheckExperimentalSectionBoardProjection(
    boardSequence(tokens.B),movementContext());
  assert.equal(other.status,200);
  assert.equal(other.projection.status,'BLOCKED');
  assert.equal(other.projection.projectedBoard,null);
  assert.equal(other.projection.canCommit,false);
  const connection=connect();
  connection.identity.logOut(tokens.A);
  assert.deepEqual(store.precheckExperimentalSectionBoardProjection(
    boardSequence(tokens.A),movementContext()),
    {status:401,code:'UNAUTHENTICATED'});
  connection.unsafeTestDatabase().prepare('UPDATE matches SET guest_id=NULL WHERE id=?').run(matchId);
  assert.deepEqual(store.precheckExperimentalSectionBoardProjection(
    boardSequence(tokens.B),movementContext()),
    {status:404,code:'NOT_FOUND'});
  assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));
test('CCWB staged board projection: invalid request and failed action never leak partial board',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForLeader(store,tokens.A,{orderUnit:true});
  for(const patch of [{actor:'A'},{board:{}},{expectedRevision:'2'},
    {actions:[]},{actions:[{...sequenceUnit(),owner:'B'}]},
    {actions:[{kind:'UNIT',id:'unitA',path:[{col:13,row:4}]}]}]){
    assert.deepEqual(store.precheckExperimentalSectionBoardProjection(
      boardSequence(tokens.A,[sequenceLeader()],patch),movementContext()),
      {status:400,code:'INVALID_SECTION_LAB_BOARD_REQUEST'});
  }
  const reversed=store.precheckExperimentalSectionBoardProjection(
    boardSequence(tokens.A,[sequenceUnit(),sequenceLeader()]),movementContext());
  assert.equal(reversed.status,200);
  assert.equal(reversed.projection.status,'BLOCKED');
  assert.equal(reversed.projection.reason,'LEADER_ALREADY_MOVED');
  assert.equal(reversed.projection.projectedBoard,null);
  assert.equal(reversed.projection.moves,null);
  assert.equal(reversed.projection.moveCount,0);
  assert.equal(reversed.boardChanged,false);
  assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));
test('CCWB staged board projection: descriptor snapshot resists mutation during session resolution',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForLeader(store,tokens.A,{orderUnit:true});
  const original=boardSequence(tokens.A);
  const reads=[];
  const input=new Proxy(original,{get(target,key){
    reads.push(String(key));
    if(key==='actions'||key==='sessionToken')throw Error('GET_MUST_NOT_RUN');
    return Reflect.get(target,key);
  }});
  const r=store.precheckExperimentalSectionBoardProjection(input,movementContext());
  assert.equal(r.status,200);
  assert.equal(r.projection.status,'PRIVATE_BOARD_CANDIDATE');
  assert.deepEqual(reads,[]);
  const cell=boardSequence(tokens.A);
  let calls=0;
  Object.defineProperty(cell.actions[0].path[0],'col',{enumerable:true,
    get(){calls++;throw Error('NOT_READ');}});
  assert.deepEqual(store.precheckExperimentalSectionBoardProjection(cell,movementContext()),
    {status:400,code:'INVALID_SECTION_LAB_BOARD_REQUEST'});
  assert.equal(calls,0);
  assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));

test('CCWB sequence previews: immutable snapshot is shared by sequence and evidence reads',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForLeader(store,tokens.A,{orderUnit:true});
  const input=()=>sequenceRequest(tokens.A,[sequenceLeader(),sequenceUnit()]);
  for(const [method,expectedCode,expectedInner] of [
    ['precheckExperimentalSectionMovementSequence',
      'SECTION_LAB_SEQUENCE_PREVIEW','CANDIDATE_SEQUENCE'],
    ['precheckExperimentalSectionMovementEvidence',
      'SECTION_LAB_CANDIDATE_EVIDENCE','CANDIDATE_EVIDENCE']
  ]){
    const source=input(),getCalls=[];
    const proxy=new Proxy(source,{
      get(){getCalls.push('forbidden');throw Error('ROOT_GET_MUST_NOT_RUN');},
      getOwnPropertyDescriptor(target,key){
        const desc=Reflect.getOwnPropertyDescriptor(target,key);
        if(key==='actions'){
          // Simulate a hostile producer mutating a previously captured field.
          target.expectedRevision=999;
        }
        return desc;
      }
    });
    const r=store[method](proxy,movementContext());
    assert.equal(r.status,200);
    assert.equal(r.code,expectedCode);
    const nested=method==='precheckExperimentalSectionMovementSequence'?
      r.preview:r.evidence;
    assert.equal(nested.status,expectedInner);
    assert.deepEqual(getCalls,[]);
    assert.equal(source.expectedRevision,999);
    assert.equal(JSON.stringify(r).includes(tokens.A),false);
  }
  assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));
test('CCWB sequence previews: accessor request is rejected before acquiring WAL snapshot',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForLeader(store,tokens.A,{orderUnit:true});
  for(const [method,code] of [
    ['precheckExperimentalSectionMovementSequence','INVALID_SECTION_LAB_SEQUENCE_REQUEST'],
    ['precheckExperimentalSectionMovementEvidence','INVALID_SECTION_LAB_EVIDENCE_REQUEST']
  ]){
    let hits=0;
    const request=sequenceRequest(tokens.A,[sequenceLeader()]);
    Object.defineProperty(request.actions[0].path[0],'col',{
      enumerable:true,get(){hits++;throw Error('UNTRUSTED_GET');}
    });
    assert.deepEqual(store[method](request,movementContext()),{status:400,code});
    assert.equal(hits,0);
  }
  assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));

test('CCWB order budget: verified WAL replay plans orders without SQLite writes',
  ()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForLeader(store,tokens.A,{orderUnit:true});
  const tables=()=>({
    match:db.prepare('SELECT * FROM matches WHERE id=?').get(matchId),
    events:db.prepare('SELECT * FROM game_events WHERE match_id=? ORDER BY sequence').all(matchId),
    commands:db.prepare('SELECT * FROM game_commands WHERE match_id=? ORDER BY committed_revision').all(matchId)
  });
  const before=tables();
  const query=boardSequence(tokens.A);
  const result=store.precheckExperimentalSectionOrderBudget(query,movementContext());
  assert.equal(result.status,200);
  assert.equal(result.code,'SECTION_LAB_ORDER_BUDGET_PREVIEW');
  assert.equal(result.budget.status,'PRIVATE_ORDER_BUDGET_CANDIDATE');
  assert.deepEqual([result.budget.totalOrders,result.budget.wouldUseCount,
    result.budget.lockedCount,result.budget.availableCount],[2,2,0,0]);
  assert.equal(result.budget.orders.find(x=>x.id==='leaderA').status,'USED');
  assert.equal(result.budget.orders.find(x=>x.id==='unitA').status,'USED');
  assert.equal(result.budget.projectedBoard.units.find(x=>x.id==='unitA').col,3);
  for(const key of ['movementAuthorized','attackAuthorized','boardChanged','canCommit'])
    assert.equal(result[key],false);
  assert.equal(result.budget.officialMovementAuthorized,false);
  assert.equal(result.budget.stateChanged,false);
  const json=JSON.stringify(result);
  for(const secret of [tokens.A,'yourHand','drawPile','handAtPlay',
    'cardInstanceId','idempotencyKey'])
    assert.equal(json.includes(secret),false);
  assert.deepEqual(connect().getStore(matchId)
    .precheckExperimentalSectionOrderBudget(query,movementContext()),result);
  assert.deepEqual(tables(),before);
  assert.equal(db.isTransaction,false);
}));

test('CCWB order budget: unit carries ordered leader, locking its extra order',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForLeader(store,tokens.A,{orderUnit:true});
  const result=store.precheckExperimentalSectionOrderBudget(
    boardSequence(tokens.A,[sequenceUnit()]),movementContext());
  assert.equal(result.status,200);
  assert.equal(result.budget.status,'PRIVATE_ORDER_BUDGET_CANDIDATE');
  assert.deepEqual([result.budget.wouldUseCount,result.budget.lockedCount,
    result.budget.availableCount],[1,1,0]);
  assert.equal(result.budget.orders.find(x=>x.kind==='UNIT').status,'USED');
  assert.equal(result.budget.orders.find(x=>x.kind==='LEADER').status,'LOCKED');
  assert.equal(result.budget.moves[0].leaderCarried,'leaderA');
  assert.equal(result.budget.canCommit,false);
  assert.equal(Object.isFrozen(result.budget.orders[0]),true);
}));

test('CCWB order budget: leader detaches, unit remains AVAILABLE but never authorized',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForLeader(store,tokens.A,{orderUnit:true});
  const r=store.precheckExperimentalSectionOrderBudget(
    boardSequence(tokens.A,[sequenceLeader()]),movementContext());
  assert.equal(r.status,200);
  assert.equal(r.budget.status,'PRIVATE_ORDER_BUDGET_CANDIDATE');
  assert.deepEqual([r.budget.totalOrders,r.budget.wouldUseCount,
    r.budget.lockedCount,r.budget.availableCount],[2,1,0,1]);
  assert.equal(r.budget.orders.find(x=>x.id==='leaderA').status,'USED');
  assert.equal(r.budget.orders.find(x=>x.id==='unitA').status,'AVAILABLE');
  assert.equal(r.budget.movementAuthorized,false);
  assert.equal(r.boardChanged,false);
}));

test('CCWB order budget: session revocation, missing membership and rival cannot see budget',
  ()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForLeader(store,tokens.A,{orderUnit:true});
  assert.deepEqual(store.precheckExperimentalSectionOrderBudget(
    boardSequence('revoked-secret'.repeat(5)),movementContext()),
    {status:401,code:'UNAUTHENTICATED'});
  assert.deepEqual(store.precheckExperimentalSectionOrderBudget(
    boardSequence(tokens.outsider),movementContext()),
    {status:404,code:'NOT_FOUND'});
  const rival=store.precheckExperimentalSectionOrderBudget(
    boardSequence(tokens.B),movementContext());
  assert.equal(rival.status,200);
  assert.equal(rival.budget.status,'BLOCKED');
  assert.equal(rival.budget.orders,null);
  assert.equal(rival.budget.projectedBoard,null);
  const second=connect();
  second.identity.logOut(tokens.A);
  assert.deepEqual(store.precheckExperimentalSectionOrderBudget(
    boardSequence(tokens.A),movementContext()),
    {status:401,code:'UNAUTHENTICATED'});
  second.unsafeTestDatabase().prepare('UPDATE matches SET guest_id=NULL WHERE id=?').run(matchId);
  assert.deepEqual(store.precheckExperimentalSectionOrderBudget(
    boardSequence(tokens.B),movementContext()),
    {status:404,code:'NOT_FOUND'});
  assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));

test('CCWB order budget: invalid inputs and illegal second move expose no partial plan',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForLeader(store,tokens.A,{orderUnit:true});
  for(const patch of [{actor:'B'},{board:{}},{expectedRevision:'2'},
    {actions:[]},{actions:[{...sequenceUnit(),owner:'B'}]},
    {actions:[{kind:'UNIT',id:'unitA',path:[{col:13,row:4}]}]}]){
    assert.deepEqual(store.precheckExperimentalSectionOrderBudget(
      boardSequence(tokens.A,[sequenceLeader()],patch),movementContext()),
      {status:400,code:'INVALID_SECTION_LAB_ORDER_BUDGET_REQUEST'});
  }
  const reversed=store.precheckExperimentalSectionOrderBudget(
    boardSequence(tokens.A,[sequenceUnit(),sequenceLeader()]),movementContext());
  assert.equal(reversed.status,200);
  assert.equal(reversed.budget.status,'BLOCKED');
  assert.equal(reversed.budget.reason,'LEADER_ALREADY_MOVED');
  assert.equal(reversed.budget.orders,null);
  assert.equal(reversed.budget.projectedBoard,null);
  const stale=store.precheckExperimentalSectionOrderBudget(
    boardSequence(tokens.A,[sequenceLeader()],{expectedRevision:1}),movementContext());
  assert.equal(stale.budget.status,'BLOCKED');
  assert.equal(stale.budget.orders,null);
  assert.equal(stale.budget.reason,'STALE_REVISION');
  assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));

test('CCWB order budget: untrusted Proxy never changes captured request after session lookup',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),original=app.identity.resolveSession;
  stageForLeader(store,tokens.A,{orderUnit:true});
  const source=boardSequence(tokens.A),gets=[];
  const proxy=new Proxy(source,{
    get(){gets.push('GET');throw Error('GET_NOT_ALLOWED');}
  });
  let resolved=0;
  try {
    app.identity.resolveSession=token=>{
      if(token===tokens.A){
        resolved++;
        source.sessionToken='not-the-session';
        source.expectedRevision=999;
        source.actions[0].id='forged';
        source.actions[0].path[0].col=10;
      }
      return original(token);
    };
    const result=store.precheckExperimentalSectionOrderBudget(proxy,movementContext());
    assert.equal(result.status,200);
    assert.equal(result.budget.status,'PRIVATE_ORDER_BUDGET_CANDIDATE');
    assert.equal(result.budget.wouldUseCount,2);
    assert.equal(resolved,1);
  } finally {
    app.identity.resolveSession=original;
  }
  assert.deepEqual(gets,[]);
  const getter=boardSequence(tokens.A);
  let hits=0;
  Object.defineProperty(getter.actions[0].path[0],'col',{
    enumerable:true,get(){hits++;throw Error('UNTRUSTED_GETTER');}
  });
  assert.deepEqual(store.precheckExperimentalSectionOrderBudget(getter,movementContext()),
    {status:400,code:'INVALID_SECTION_LAB_ORDER_BUDGET_REQUEST'});
  assert.equal(hits,0);
}));

test('CCWB order budget: WAL read survives concurrent writer without exposing draft',
  ()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForLeader(store,tokens.A,{orderUnit:true});
  const writer=connect().unsafeTestDatabase();
  writer.exec('BEGIN IMMEDIATE');
  try {
    const result=store.precheckExperimentalSectionOrderBudget(
      boardSequence(tokens.A,[sequenceUnit()]),movementContext());
    assert.equal(result.status,200);
    assert.equal(result.budget.status,'PRIVATE_ORDER_BUDGET_CANDIDATE');
    assert.equal(result.budget.wouldUseCount,1);
    assert.equal(result.budget.lockedCount,1);
  } finally {
    writer.exec('ROLLBACK');
  }
  assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));

const trustedOpenFootScenario=()=>({
  scope:'SYNTHETIC_OPEN_HEX_V1',
  ruleset:'ancients-base-3e-2009',
  unitTypes:{unitA:'LIGHT_INFANTRY',unitB:'HEAVY_INFANTRY'},
  terrain:[],scenarioExceptions:[]
});
const verifiedFootRequest=(token,changes={})=>sequenceRequest(token,[sequenceUnit()],changes);

test('CCWB verified foot core: first step from authenticated replay is read-only',()=>fixture(async({
  app,connect,matchId,tokens
})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  const read=()=>({
    match:db.prepare('SELECT * FROM matches WHERE id=?').get(matchId),
    events:db.prepare('SELECT * FROM game_events WHERE match_id=? ORDER BY sequence').all(matchId),
    commands:db.prepare('SELECT * FROM game_commands WHERE match_id=? ORDER BY committed_revision').all(matchId)
  });
  const before=read(),query=verifiedFootRequest(tokens.A);
  const first=store.precheckExperimentalSectionVerifiedFootCore(
    query,trustedOpenFootScenario());
  assert.equal(first.status,200);
  assert.equal(first.code,'SECTION_LAB_VERIFIED_FOOT_CORE_PREVIEW');
  assert.equal(first.preview.status,'PRIVATE_CORE_FOOT_PROPOSAL');
  assert.equal(first.preview.proposal.status,'RULE_TRANSITION_CANDIDATE');
  assert.equal(first.preview.proposal.nextState.revision,3);
  assert.deepEqual(first.preview.proposal.nextState.orderLedger,{
    issuedUnitIds:['unitA'],movedUnitIds:['unitA']
  });
  assert.equal(first.preview.proposal.nextState.board.units[0].col,3);
  for(const key of ['movementAuthorized','officialMovementAuthorized',
    'attackAuthorized','boardChanged','canCommit'])
    assert.equal(first[key],false);
  assert.equal(first.preview.proposal.canCommit,false);
  assert.equal(first.preview.proposal.dbChanged,false);
  assert.equal(JSON.stringify(first).includes(tokens.A),false);
  for(const secret of ['handAtPlay','cardInstanceId','drawPile',
    'idempotencyKey','ANCIENTS_MOVEMENT_COMMITTED_V1'])
    assert.equal(JSON.stringify(first).includes(secret),false);
  assert.deepEqual(connect().getStore(matchId)
    .precheckExperimentalSectionVerifiedFootCore(query,trustedOpenFootScenario()),first);
  assert.deepEqual(read(),before);
  assert.equal(db.isTransaction,false);
}));

test('CCWB verified foot core: rival, outsider, logout and lost membership never get a proposal',
  ()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForMovement(store,tokens.A);
  const scenario=trustedOpenFootScenario();
  const rival=store.precheckExperimentalSectionVerifiedFootCore(
    verifiedFootRequest(tokens.B),scenario);
  assert.equal(rival.status,200);
  assert.equal(rival.preview.status,'BLOCKED');
  assert.equal(rival.preview.proposal,null);
  assert.equal(rival.preview.reason,'NOT_ACTING_PLAYER');
  assert.deepEqual(store.precheckExperimentalSectionVerifiedFootCore(
    verifiedFootRequest(tokens.outsider),scenario),{status:404,code:'NOT_FOUND'});
  const second=connect();
  second.identity.logOut(tokens.A);
  assert.deepEqual(store.precheckExperimentalSectionVerifiedFootCore(
    verifiedFootRequest(tokens.A),scenario),{status:401,code:'UNAUTHENTICATED'});
  second.unsafeTestDatabase().prepare('UPDATE matches SET guest_id=NULL WHERE id=?')
    .run(matchId);
  assert.deepEqual(store.precheckExperimentalSectionVerifiedFootCore(
    verifiedFootRequest(tokens.B),scenario),{status:404,code:'NOT_FOUND'});
}));

test('CCWB verified foot core: forged request fields and multiple actions rejected before read',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForMovement(store,tokens.A);
  for(const patch of [
    {actor:'A'},{board:{}},{trustedScenario:{}},{expectedRevision:'2'},
    {idempotencyKey:'fake_request_1'},{actions:[]},
    {actions:[{...sequenceUnit(),actor:'A'}]},
    {actions:[{kind:'UNIT',id:'unitA',path:[{col:3,row:4,side:'A'}]}]}
  ]){
    assert.deepEqual(store.precheckExperimentalSectionVerifiedFootCore(
      verifiedFootRequest(tokens.A,patch),trustedOpenFootScenario()),
      {status:400,code:'INVALID_SECTION_LAB_FOOT_CORE_REQUEST'});
  }
  const two=store.precheckExperimentalSectionVerifiedFootCore(
    sequenceRequest(tokens.A,[sequenceUnit(),sequenceUnit()]),trustedOpenFootScenario());
  assert.equal(two.status,200);
  assert.equal(two.preview.status,'BLOCKED');
  assert.equal(two.preview.reason,'ONLY_ONE_FOOT_STEP_SUPPORTED');
  assert.equal(two.preview.proposal,null);
  assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));

test('CCWB verified foot core: unsupported scenario or non-foot movement denies all state',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForMovement(store,tokens.A);
  for(const change of [
    p=>p.scope='UNKNOWN',
    p=>p.terrain.push({col:10,row:8,kind:'FOREST'}),
    p=>p.scenarioExceptions.push('SPECIAL'),
    p=>p.unitTypes.unitA='ELEPHANT',
    p=>delete p.unitTypes.unitB
  ]){
    const scenario=trustedOpenFootScenario();change(scenario);
    const r=store.precheckExperimentalSectionVerifiedFootCore(
      verifiedFootRequest(tokens.A),scenario);
    assert.equal(r.status,200);
    assert.equal(r.preview.status,'BLOCKED');
    assert.equal(r.preview.proposal,null);
    assert.equal(r.preview.canCommit,false);
  }
  const enemy=store.precheckExperimentalSectionVerifiedFootCore(
    sequenceRequest(tokens.A,[{kind:'UNIT',id:'unitB',path:[{col:9,row:4}]}]),
    trustedOpenFootScenario());
  assert.equal(enemy.preview.status,'BLOCKED');
  assert.equal(enemy.preview.proposal,null);
  assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));

test('CCWB verified foot core: descriptor-captured request survives session-time mutation',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),raw=verifiedFootRequest(tokens.A),gets=[];
  stageForMovement(store,tokens.A);
  const original=app.identity.resolveSession;
  let calls=0;
  const proxy=new Proxy(raw,{get(){gets.push('GET');throw Error('GET_FORBIDDEN')}});
  try{
    app.identity.resolveSession=token=>{
      if(token===tokens.A){
        calls++;
        raw.sessionToken='forged';
        raw.expectedRevision=77;
        raw.actions[0].id='unitB';
        raw.actions[0].path[0].col=12;
      }
      return original(token);
    };
    const r=store.precheckExperimentalSectionVerifiedFootCore(
      proxy,trustedOpenFootScenario());
    assert.equal(r.status,200);
    assert.equal(r.preview.status,'PRIVATE_CORE_FOOT_PROPOSAL');
    assert.equal(r.preview.proposal.transition.unitId,'unitA');
    assert.equal(r.preview.proposal.transition.to.col,3);
    assert.equal(calls,1);
  } finally{
    app.identity.resolveSession=original;
  }
  assert.deepEqual(gets,[]);
  const accessor=verifiedFootRequest(tokens.A);
  let hits=0;
  Object.defineProperty(accessor.actions[0].path[0],'col',{
    enumerable:true,get(){hits++;throw Error('GETTER_FORBIDDEN')}
  });
  assert.deepEqual(store.precheckExperimentalSectionVerifiedFootCore(
    accessor,trustedOpenFootScenario()),{
      status:400,code:'INVALID_SECTION_LAB_FOOT_CORE_REQUEST'
    });
  assert.equal(hits,0);
}));

test('CCWB verified foot core: WAL snapshot allows concurrent writer without producing writes',
  ()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForMovement(store,tokens.A);
  const writer=connect().unsafeTestDatabase();
  writer.exec('BEGIN IMMEDIATE');
  try{
    const r=store.precheckExperimentalSectionVerifiedFootCore(
      verifiedFootRequest(tokens.A),trustedOpenFootScenario());
    assert.equal(r.status,200);
    assert.equal(r.preview.status,'PRIVATE_CORE_FOOT_PROPOSAL');
    assert.equal(r.preview.canCommit,false);
  } finally {writer.exec('ROLLBACK');}
  assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));

test('CCWB verified foot core: tampered persisted journal is detected before proposal',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  const row=db.prepare('SELECT private_state FROM matches WHERE id=?').get(matchId);
  const state=JSON.parse(row.private_state);
  state.ancientsSectionHistoryLab.state.board.units[0].col=8;
  db.prepare('UPDATE matches SET private_state=? WHERE id=?')
    .run(JSON.stringify(state),matchId);
  assert.throws(()=>store.precheckExperimentalSectionVerifiedFootCore(
    verifiedFootRequest(tokens.A),trustedOpenFootScenario()),
    /SECTION_CCWB_SNAPSHOT_DRIFT/);
  assert.equal(db.isTransaction,false);
}));

const footCommitProbe=(sessionToken,changes={})=>({
  sessionToken,expectedRevision:2,idempotencyKey:'foot_probe_new_0001',
  actions:[sequenceUnit()],...changes
});

test('CCWB foot transaction gate: valid first step is DISABLED under writer lock, never written',
  ()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  const capture=()=>({
    match:db.prepare('SELECT * FROM matches WHERE id=?').get(matchId),
    events:db.prepare('SELECT * FROM game_events WHERE match_id=? ORDER BY sequence').all(matchId),
    commands:db.prepare('SELECT * FROM game_commands WHERE match_id=? ORDER BY committed_revision').all(matchId)
  });
  const before=capture(),request=footCommitProbe(tokens.A);
  const result=store.probeExperimentalSectionFootCommit(request,trustedOpenFootScenario());
  assert.deepEqual(result,{
    status:409,code:'SECTION_LAB_FOOT_COMMIT_DISABLED',
    checkedRevision:2,ruleSubset:'BASE_FOOT_OPEN_ONE_HEX_V1',
    movementAuthorized:false,officialMovementAuthorized:false,
    canCommit:false,boardChanged:false,dbChanged:false
  });
  assert.equal(Object.isFrozen(result),true);
  assert.deepEqual(capture(),before);
  assert.deepEqual(connect().getStore(matchId)
    .probeExperimentalSectionFootCommit(request,trustedOpenFootScenario()),result);
  assert.deepEqual(capture(),before);
  assert.equal(db.isTransaction,false);
  const serialized=JSON.stringify(result);
  for(const secret of [tokens.A,request.idempotencyKey,'unitA',
    'private_state','handAtPlay','ANCIENTS_MOVEMENT_COMMITTED_V1'])
    assert.equal(serialized.includes(secret),false);
}));

test('CCWB foot transaction gate: existing card/order idempotency keys never imply applied move',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForMovement(store,tokens.A);
  for(const key of ['private_preview_card_0001','private_preview_orders_0001']){
    const result=store.probeExperimentalSectionFootCommit(
      footCommitProbe(tokens.A,{idempotencyKey:key}),trustedOpenFootScenario());
    assert.deepEqual(result,{
      status:409,code:'SECTION_LAB_FOOT_IDEMPOTENCY_KEY_IN_USE'
    });
  }
  assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));

test('CCWB foot transaction gate: forged input, malformed key and second action are rejected before BEGIN',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  let calls=0;
  const original=app.identity.resolveSession;
  try{
    app.identity.resolveSession=token=>{calls++;return original(token);};
    for(const patch of [
      {actor:'A'},{board:{}},{terrain:[]},{trustedScenario:{}},
      {candidateEvidence:{}},{expectedRevision:'2'},{idempotencyKey:'tiny'},
      {idempotencyKey:'bad key'},{actions:[]},
      {actions:[sequenceUnit(),sequenceUnit()]},
      {actions:[{kind:'LEADER',id:'leaderA',path:[{col:2,row:5}]}]},
      {actions:[{kind:'UNIT',id:'unitA',path:[{col:3,row:4},{col:4,row:4}]}]}
    ]){
      assert.deepEqual(store.probeExperimentalSectionFootCommit(
        footCommitProbe(tokens.A,patch),trustedOpenFootScenario()),{
          status:400,code:'INVALID_SECTION_LAB_FOOT_PROBE_REQUEST'
        });
    }
    const getter=footCommitProbe(tokens.A);
    Object.defineProperty(getter,'idempotencyKey',{
      enumerable:true,get(){throw Error('UNTRUSTED_GETTER');}
    });
    assert.deepEqual(store.probeExperimentalSectionFootCommit(
      getter,trustedOpenFootScenario()),{
        status:400,code:'INVALID_SECTION_LAB_FOOT_PROBE_REQUEST'
      });
    assert.equal(calls,0);
  }finally{app.identity.resolveSession=original;}
  assert.equal(db.isTransaction,false);
}));

test('CCWB foot transaction gate: stale revision and nonacting player denied under write transaction',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForMovement(store,tokens.A);
  const stale=store.probeExperimentalSectionFootCommit(
    footCommitProbe(tokens.A,{expectedRevision:1}),trustedOpenFootScenario());
  assert.deepEqual(stale,{status:409,code:'STALE_REVISION'});
  const rival=store.probeExperimentalSectionFootCommit(
    footCommitProbe(tokens.B),trustedOpenFootScenario());
  assert.deepEqual(rival,{
    status:409,code:'SECTION_LAB_FOOT_PROBE_REJECTED',
    reason:'NOT_ACTING_PLAYER'
  });
  assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));

test('CCWB foot transaction gate: revoked session and lost membership block before replay',
  ()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId);
  stageForMovement(store,tokens.A);
  assert.deepEqual(store.probeExperimentalSectionFootCommit(
    footCommitProbe(tokens.outsider),trustedOpenFootScenario()),
    {status:404,code:'NOT_FOUND'});
  assert.deepEqual(store.probeExperimentalSectionFootCommit(
    footCommitProbe('absent_token'),trustedOpenFootScenario()),
    {status:401,code:'UNAUTHENTICATED'});
  const second=connect();
  second.identity.logOut(tokens.A);
  assert.deepEqual(store.probeExperimentalSectionFootCommit(
    footCommitProbe(tokens.A),trustedOpenFootScenario()),
    {status:401,code:'UNAUTHENTICATED'});
  second.unsafeTestDatabase().prepare('UPDATE matches SET guest_id=NULL WHERE id=?')
    .run(matchId);
  assert.deepEqual(store.probeExperimentalSectionFootCommit(
    footCommitProbe(tokens.B),trustedOpenFootScenario()),
    {status:404,code:'NOT_FOUND'});
  assert.equal(app.unsafeTestDatabase().isTransaction,false);
}));

test('CCWB foot transaction gate: exception or unsupported scenario does not allocate a key',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  const before=db.prepare('SELECT * FROM game_commands WHERE match_id=? ORDER BY committed_revision')
    .all(matchId);
  for(const change of [
    p=>p.scope='OFFICIAL_SCENARIO_NOT_VERIFIED',
    p=>p.terrain.push({col:10,row:8,kind:'HILL'}),
    p=>p.scenarioExceptions.push('SPECIAL_MOVEMENT'),
    p=>p.unitTypes.unitA='ELEPHANT'
  ]){
    const scenario=trustedOpenFootScenario();change(scenario);
    const result=store.probeExperimentalSectionFootCommit(
      footCommitProbe(tokens.A),scenario);
    assert.equal(result.status,409);
    assert.equal(result.code,'SECTION_LAB_FOOT_PROBE_REJECTED');
    assert.equal(typeof result.reason,'string');
  }
  assert.deepEqual(db.prepare(
    'SELECT * FROM game_commands WHERE match_id=? ORDER BY committed_revision'
  ).all(matchId),before);
  assert.equal(db.isTransaction,false);
}));

test('CCWB foot transaction gate: original request mutation during session lookup changes nothing',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  const original=app.identity.resolveSession;
  const raw=footCommitProbe(tokens.A),getCalls=[];
  const wrapped=new Proxy(raw,{get(){getCalls.push('GET');throw Error('GET_NOT_ALLOWED')}});
  let lookups=0;
  try{
    app.identity.resolveSession=token=>{
      if(token===tokens.A){
        lookups++;
        assert.equal(db.isTransaction,true);
        raw.sessionToken='tampered';
        raw.expectedRevision=99;
        raw.idempotencyKey='private_preview_card_0001';
        raw.actions[0].id='unitB';
        raw.actions[0].path[0].col=10;
      }
      return original(token);
    };
    const result=store.probeExperimentalSectionFootCommit(
      wrapped,trustedOpenFootScenario());
    assert.equal(result.code,'SECTION_LAB_FOOT_COMMIT_DISABLED');
    assert.equal(result.checkedRevision,2);
    assert.equal(lookups,1);
    assert.deepEqual(getCalls,[]);
  } finally {app.identity.resolveSession=original;}
  assert.equal(db.isTransaction,false);
  assert.equal(db.prepare(
    'SELECT COUNT(*) AS n FROM game_commands WHERE match_id=? AND idem_key=?'
  ).get(matchId,'foot_probe_new_0001').n,0);
}));

test('CCWB foot transaction gate: BEGIN IMMEDIATE prevents concurrent revocation writer',
  ()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  const other=connect(),otherDb=other.unsafeTestDatabase();
  otherDb.exec('PRAGMA busy_timeout=25');
  const original=app.identity.resolveSession;
  let blocked=0;
  try{
    app.identity.resolveSession=token=>{
      assert.equal(db.isTransaction,true);
      assert.throws(()=>otherDb.exec('BEGIN IMMEDIATE'),/SQLITE_BUSY|database is locked/i);
      blocked++;
      return original(token);
    };
    const result=store.probeExperimentalSectionFootCommit(
      footCommitProbe(tokens.A),trustedOpenFootScenario());
    assert.equal(result.code,'SECTION_LAB_FOOT_COMMIT_DISABLED');
  }finally{app.identity.resolveSession=original;}
  assert.equal(blocked,1);
  assert.equal(db.isTransaction,false);
  // A writer can acquire a lock after the read-only gate releases it.
  otherDb.exec('BEGIN IMMEDIATE');
  otherDb.exec('ROLLBACK');
}));

test('CCWB foot transaction gate: corrupted CCWB replay rolls back and never returns admission',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  const row=db.prepare('SELECT private_state FROM matches WHERE id=?').get(matchId);
  const changed=JSON.parse(row.private_state);
  changed.ancientsSectionHistoryLab.state.board.units[0].col=8;
  db.prepare('UPDATE matches SET private_state=? WHERE id=?')
    .run(JSON.stringify(changed),matchId);
  const before=db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
  assert.throws(()=>store.probeExperimentalSectionFootCommit(
    footCommitProbe(tokens.A),trustedOpenFootScenario()),
    /SECTION_CCWB_SNAPSHOT_DRIFT/);
  assert.deepEqual(db.prepare('SELECT * FROM matches WHERE id=?').get(matchId),before);
  assert.equal(db.isTransaction,false);
}));

const footStageRequest=(sessionToken,extra={})=>({
  sessionToken,expectedRevision:2,
  idempotencyKey:'private_foot_stage_001',actions:[sequenceUnit()],...extra
});
const footStageSnapshot=(db,matchId)=>({
  match:db.prepare('SELECT * FROM matches WHERE id=?').get(matchId),
  events:db.prepare('SELECT * FROM game_events WHERE match_id=? ORDER BY sequence').all(matchId),
  commands:db.prepare('SELECT * FROM game_commands WHERE match_id=? ORDER BY committed_revision').all(matchId)
});

test('CCWB private foot stage: one proposed movement is durable but never changes game revision',
  ()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  const before=footStageSnapshot(db,matchId);
  const playerA=store.view('A'),playerB=store.view('B');
  const save=store.stageExperimentalSectionFootJournal(
    footStageRequest(tokens.A),trustedOpenFootScenario());
  assert.deepEqual(save,{
    status:200,code:'SECTION_LAB_FOOT_STAGE_SAVED',
    provisionalRevision:3,privateDraftChanged:true,gameRevisionChanged:false,
    boardChanged:false,movementAuthorized:false,
    officialMovementAuthorized:false,canCommit:false
  });
  assert.equal(db.isTransaction,false);
  const after=footStageSnapshot(db,matchId);
  assert.equal(after.match.game_revision,before.match.game_revision);
  assert.equal(after.match.lobby_revision,before.match.lobby_revision);
  assert.notEqual(after.match.private_state,before.match.private_state);
  assert.deepEqual(after.events,before.events);
  assert.deepEqual(after.commands,before.commands);
  const persisted=JSON.parse(after.match.private_state);
  const journal=persisted.ancientsFootMovementJournalLab;
  assert.equal(journal.matchId,matchId);
  assert.equal(journal.entries.length,1);
  assert.equal(journal.entries[0].idempotencyKey,'private_foot_stage_001');
  assert.equal(journal.entries[0].command.actor,'A');
  assert.equal(journal.state.revision,3);
  assert.equal(journal.state.board.units[0].col,3);
  assert.equal(persisted.ancientsSectionHistoryLab.state.board.units[0].col,2);
  assert.deepEqual(store.view('A'),playerA);
  assert.deepEqual(store.view('B'),playerB);
  assert.equal(JSON.stringify(store.view('B')).includes('ancientsFootMovementJournalLab'),false);
  assert.equal(JSON.stringify(store.publicEvents('A')).includes('FOOT_STEP_PUBLIC_EVENT_PROPOSAL'),false);
  assert.equal(JSON.stringify(connect().getStore(matchId).view('A')).includes(
    'private_foot_stage_001'),false);
}));

test('CCWB private foot stage: identical key and action survive restart with zero additional writes',
  ()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  const request=footStageRequest(tokens.A);
  assert.equal(store.stageExperimentalSectionFootJournal(
    request,trustedOpenFootScenario()).code,'SECTION_LAB_FOOT_STAGE_SAVED');
  const before=footStageSnapshot(db,matchId);
  const repeated=connect().getStore(matchId)
    .stageExperimentalSectionFootJournal(request,trustedOpenFootScenario());
  assert.deepEqual(repeated,{
    status:200,code:'SECTION_LAB_FOOT_STAGE_ALREADY_RECORDED',
    provisionalRevision:3,privateDraftChanged:false,gameRevisionChanged:false,
    boardChanged:false,movementAuthorized:false,
    officialMovementAuthorized:false,canCommit:false
  });
  assert.deepEqual(footStageSnapshot(db,matchId),before);
}));

test('CCWB private foot stage: collision and second key never add another provisional move',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  const request=footStageRequest(tokens.A);
  assert.equal(store.stageExperimentalSectionFootJournal(
    request,trustedOpenFootScenario()).code,'SECTION_LAB_FOOT_STAGE_SAVED');
  const before=footStageSnapshot(db,matchId);
  const conflict=store.stageExperimentalSectionFootJournal(
    footStageRequest(tokens.A,{actions:[
      {kind:'UNIT',id:'unitA',path:[{col:2,row:5}]}
    ]}),trustedOpenFootScenario());
  assert.deepEqual(conflict,{
    status:409,code:'SECTION_LAB_FOOT_STAGE_REJECTED',
    reason:'FOOT_LAB_IDEMPOTENCY_CONFLICT'
  });
  const second=store.stageExperimentalSectionFootJournal(
    footStageRequest(tokens.A,{idempotencyKey:'private_foot_stage_002'}),
    trustedOpenFootScenario());
  assert.deepEqual(second,{
    status:409,code:'SECTION_LAB_FOOT_STAGE_REJECTED',
    reason:'FOOT_LAB_ONE_STEP_ONLY'
  });
  assert.deepEqual(footStageSnapshot(db,matchId),before);
}));

test('CCWB private foot stage: section commands own their keys, never register a foot retry',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  const before=footStageSnapshot(db,matchId);
  for(const key of ['private_preview_card_0001','private_preview_orders_0001']){
    const collision=store.stageExperimentalSectionFootJournal(
      footStageRequest(tokens.A,{idempotencyKey:key}),trustedOpenFootScenario());
    assert.deepEqual(collision,{
      status:409,code:'SECTION_LAB_FOOT_IDEMPOTENCY_KEY_IN_USE'
    });
  }
  assert.deepEqual(footStageSnapshot(db,matchId),before);
}));

test('CCWB private foot stage: malformed request rejects before acquiring writer lock',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  const before=footStageSnapshot(db,matchId);
  let lookups=0;const original=app.identity.resolveSession;
  try{
    app.identity.resolveSession=token=>{lookups++;return original(token);};
    for(const extra of [
      {actor:'A'},{board:{}},{candidateEvidence:{}},
      {expectedRevision:'2'},{idempotencyKey:'short'},{actions:[]},
      {actions:[sequenceUnit(),sequenceUnit()]},
      {actions:[{kind:'LEADER',id:'captain',path:[{col:2,row:5}]}]},
      {actions:[{kind:'UNIT',id:'unitA',path:[{col:3,row:4},{col:4,row:4}]}]}
    ]){
      assert.deepEqual(store.stageExperimentalSectionFootJournal(
        footStageRequest(tokens.A,extra),trustedOpenFootScenario()),{
          status:400,code:'INVALID_SECTION_LAB_FOOT_STAGE_REQUEST'
        });
    }
    const accessor=footStageRequest(tokens.A);
    Object.defineProperty(accessor.actions[0].path[0],'col',{
      enumerable:true,get(){throw Error('MALICIOUS_GETTER');}
    });
    assert.deepEqual(store.stageExperimentalSectionFootJournal(
      accessor,trustedOpenFootScenario()),{
        status:400,code:'INVALID_SECTION_LAB_FOOT_STAGE_REQUEST'
      });
    assert.equal(lookups,0);
  }finally{app.identity.resolveSession=original;}
  assert.deepEqual(footStageSnapshot(db,matchId),before);
}));

test('CCWB private foot stage: revoked session, outsider and rival cannot stage',
  ()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  const before=footStageSnapshot(db,matchId);
  assert.deepEqual(store.stageExperimentalSectionFootJournal(
    footStageRequest('expired'),trustedOpenFootScenario()),{
      status:401,code:'UNAUTHENTICATED'
    });
  assert.deepEqual(store.stageExperimentalSectionFootJournal(
    footStageRequest(tokens.outsider),trustedOpenFootScenario()),{
      status:404,code:'NOT_FOUND'
    });
  const rival=store.stageExperimentalSectionFootJournal(
    footStageRequest(tokens.B),trustedOpenFootScenario());
  assert.deepEqual(rival,{
    status:409,code:'SECTION_LAB_FOOT_STAGE_REJECTED',
    reason:'NOT_ACTING_PLAYER'
  });
  assert.deepEqual(footStageSnapshot(db,matchId),before);
  const other=connect();
  other.identity.logOut(tokens.A);
  assert.deepEqual(store.stageExperimentalSectionFootJournal(
    footStageRequest(tokens.A),trustedOpenFootScenario()),{
      status:401,code:'UNAUTHENTICATED'
    });
  assert.equal(db.isTransaction,false);
}));

test('CCWB private foot stage: session-time mutation cannot change captured intent or key',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  const request=footStageRequest(tokens.A),seen=[];
  const proxy=new Proxy(request,{
    get(){seen.push('GET');throw Error('FORBIDDEN_GET');}
  });
  const original=app.identity.resolveSession;
  let count=0;
  try{
    app.identity.resolveSession=token=>{
      assert.equal(db.isTransaction,true);
      if(token===tokens.A){
        count++;
        request.sessionToken='revoked';
        request.expectedRevision=55;
        request.idempotencyKey='private_preview_card_0001';
        request.actions[0].id='unitB';
        request.actions[0].path[0].col=11;
      }
      return original(token);
    };
    const result=store.stageExperimentalSectionFootJournal(
      proxy,trustedOpenFootScenario());
    assert.equal(result.code,'SECTION_LAB_FOOT_STAGE_SAVED');
  }finally{app.identity.resolveSession=original;}
  assert.equal(count,1);
  assert.deepEqual(seen,[]);
  const stored=JSON.parse(db.prepare(
    'SELECT private_state FROM matches WHERE id=?'
  ).get(matchId).private_state).ancientsFootMovementJournalLab;
  assert.equal(stored.entries[0].idempotencyKey,'private_foot_stage_001');
  assert.equal(stored.entries[0].command.unitId,'unitA');
  assert.equal(stored.entries[0].command.to.col,3);
  assert.equal(db.isTransaction,false);
}));

test('CCWB private foot stage: writer lock blocks a simultaneous writer then releases it',
  ()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  const other=connect().unsafeTestDatabase();
  other.exec('PRAGMA busy_timeout=25');
  const original=app.identity.resolveSession;
  let blocked=0;
  try{
    app.identity.resolveSession=token=>{
      assert.equal(db.isTransaction,true);
      assert.throws(()=>other.exec('BEGIN IMMEDIATE'),/SQLITE_BUSY|database is locked/i);
      blocked++;
      return original(token);
    };
    assert.equal(store.stageExperimentalSectionFootJournal(
      footStageRequest(tokens.A),trustedOpenFootScenario()).code,
      'SECTION_LAB_FOOT_STAGE_SAVED');
  }finally{app.identity.resolveSession=original;}
  assert.equal(blocked,1);
  assert.equal(db.isTransaction,false);
  other.exec('BEGIN IMMEDIATE');other.exec('ROLLBACK');
}));

test('CCWB private foot stage: tampered persisted foot journal cannot be retried or overwritten',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  assert.equal(store.stageExperimentalSectionFootJournal(
    footStageRequest(tokens.A),trustedOpenFootScenario()).code,
    'SECTION_LAB_FOOT_STAGE_SAVED');
  const saved=db.prepare('SELECT private_state FROM matches WHERE id=?').get(matchId);
  const persisted=JSON.parse(saved.private_state);
  persisted.ancientsFootMovementJournalLab.entries[0].signature='TAMPERED';
  db.prepare('UPDATE matches SET private_state=? WHERE id=?')
    .run(JSON.stringify(persisted),matchId);
  const before=footStageSnapshot(db,matchId);
  const retry=store.stageExperimentalSectionFootJournal(
    footStageRequest(tokens.A),trustedOpenFootScenario());
  assert.deepEqual(retry,{
    status:409,code:'SECTION_LAB_FOOT_STAGE_REJECTED',
    reason:'FOOT_LAB_PERSISTED_JOURNAL_DRIFT'
  });
  assert.deepEqual(footStageSnapshot(db,matchId),before);
  assert.equal(db.isTransaction,false);
}));

test('CCWB private foot stage: scenario drift and changed revision reject without partial write',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  const before=footStageSnapshot(db,matchId);
  const terrain=trustedOpenFootScenario();terrain.terrain=[{
    col:10,row:8,kind:'HILL'
  }];
  const incompatible=store.stageExperimentalSectionFootJournal(
    footStageRequest(tokens.A),terrain);
  assert.equal(incompatible.code,'SECTION_LAB_FOOT_STAGE_REJECTED');
  assert.deepEqual(store.stageExperimentalSectionFootJournal(
    footStageRequest(tokens.A,{expectedRevision:1}),trustedOpenFootScenario()),{
      status:409,code:'STALE_REVISION'
    });
  assert.deepEqual(footStageSnapshot(db,matchId),before);
}));

test('CCWB private foot stage: null or malformed stored record cannot be silently overwritten',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  assert.equal(store.stageExperimentalSectionFootJournal(
    footStageRequest(tokens.A),trustedOpenFootScenario()).code,
    'SECTION_LAB_FOOT_STAGE_SAVED');
  const base=JSON.parse(db.prepare(
    'SELECT private_state FROM matches WHERE id=?'
  ).get(matchId).private_state);
  for(const invalid of [null,'damaged',[]]){
    const altered=structuredClone(base);
    altered.ancientsFootMovementJournalLab=invalid;
    db.prepare('UPDATE matches SET private_state=? WHERE id=?')
      .run(JSON.stringify(altered),matchId);
    const before=footStageSnapshot(db,matchId);
    const response=store.stageExperimentalSectionFootJournal(
      footStageRequest(tokens.A),trustedOpenFootScenario());
    assert.deepEqual(response,{
      status:409,code:'SECTION_LAB_FOOT_STAGE_REJECTED',
      reason:'FOOT_LAB_PERSISTED_JOURNAL_DRIFT'
    });
    assert.deepEqual(footStageSnapshot(db,matchId),before);
  }
  assert.equal(db.isTransaction,false);
}));

const endLabSectionTurn=(token,key='finish_after_foot_001',revision=2)=>({
  sessionToken:token,type:'END_EXPERIMENTAL_TURN',
  expectedRevision:revision,idempotencyKey:key
});

test('CCWB foot stage lifecycle: advancing the section turn expires only the private foot journal',
  ()=>fixture(async({app,connect,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  assert.equal(store.stageExperimentalSectionFootJournal(
    footStageRequest(tokens.A),trustedOpenFootScenario()).code,
    'SECTION_LAB_FOOT_STAGE_SAVED');
  const staged=footStageSnapshot(db,matchId);
  assert.equal(JSON.parse(staged.match.private_state)
    .ancientsFootMovementJournalLab.entries.length,1);
  const beforeView=store.view('B');
  const accepted=store.dispatchExperimentalSectionHistory(
    endLabSectionTurn(tokens.A));
  assert.equal(accepted.code,'SECTION_LAB_APPLIED');
  assert.equal(accepted.revision,3);
  const after=footStageSnapshot(db,matchId);
  assert.equal(after.match.game_revision,3);
  assert.equal(after.match.lobby_revision,staged.match.lobby_revision);
  assert.equal(after.events.length,staged.events.length+1);
  assert.equal(after.commands.length,staged.commands.length+1);
  const state=JSON.parse(after.match.private_state);
  assert.equal(Object.hasOwn(state,'ancientsFootMovementJournalLab'),false);
  assert.equal(state.ancientsSectionHistoryLab.state.revision,3);
  assert.equal(state.ancientsSectionHistoryLab.state.turn,'B');
  assert.equal(store.view('B').revision,beforeView.revision+1);
  assert.equal(JSON.stringify(store.view('B')).includes('private_foot_stage_001'),false);
  assert.equal(JSON.stringify(store.publicEvents('B')).includes(
    'FOOT_STEP_PUBLIC_EVENT_PROPOSAL_V1'),false);
  assert.equal(connect().getStore(matchId).view('A').revision,3);
  assert.equal(db.isTransaction,false);
}));

test('CCWB foot stage lifecycle: staged key cannot be reused as a committed section command',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  assert.equal(store.stageExperimentalSectionFootJournal(
    footStageRequest(tokens.A),trustedOpenFootScenario()).code,
    'SECTION_LAB_FOOT_STAGE_SAVED');
  const before=footStageSnapshot(db,matchId);
  assert.deepEqual(store.dispatchExperimentalSectionHistory(
    endLabSectionTurn(tokens.A,'private_foot_stage_001')),{
      status:409,code:'SECTION_LAB_FOOT_STAGE_KEY_IN_USE'
    });
  assert.deepEqual(footStageSnapshot(db,matchId),before);
  assert.equal(store.stageExperimentalSectionFootJournal(
    footStageRequest(tokens.A),trustedOpenFootScenario()).code,
    'SECTION_LAB_FOOT_STAGE_ALREADY_RECORDED');
  assert.equal(store.dispatchExperimentalSectionHistory(
    endLabSectionTurn(tokens.A,'finish_with_fresh_key_001')).code,
    'SECTION_LAB_APPLIED');
  assert.equal(Object.hasOwn(JSON.parse(db.prepare(
    'SELECT private_state FROM matches WHERE id=?').get(matchId).private_state),
    'ancientsFootMovementJournalLab'),false);
}));

test('CCWB foot stage lifecycle: rejected and stale section commands preserve the staged journal',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  assert.equal(store.stageExperimentalSectionFootJournal(
    footStageRequest(tokens.A),trustedOpenFootScenario()).code,
    'SECTION_LAB_FOOT_STAGE_SAVED');
  const before=footStageSnapshot(db,matchId);
  assert.deepEqual(store.dispatchExperimentalSectionHistory(
    endLabSectionTurn(tokens.A,'stale_end_foot_001',1)),{
      status:409,code:'STALE_REVISION'
    });
  const wrongPhase=store.dispatchExperimentalSectionHistory({
    sessionToken:tokens.A,type:'PLAY_SECTION_CARD',
    expectedRevision:2,idempotencyKey:'wrong_phase_foot_001',
    cardInstanceId:'card_a_left'
  });
  assert.equal(wrongPhase.status,409);
  assert.equal(wrongPhase.code,'WRONG_PHASE_OR_CARD');
  assert.deepEqual(footStageSnapshot(db,matchId),before);
  assert.equal(db.isTransaction,false);
}));

test('CCWB foot stage lifecycle: tampered private foot journal blocks section advancement',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  assert.equal(store.stageExperimentalSectionFootJournal(
    footStageRequest(tokens.A),trustedOpenFootScenario()).code,
    'SECTION_LAB_FOOT_STAGE_SAVED');
  const raw=db.prepare('SELECT private_state FROM matches WHERE id=?')
    .get(matchId).private_state,changed=JSON.parse(raw);
  changed.ancientsFootMovementJournalLab.entries[0].signature='NOT_VALID';
  db.prepare('UPDATE matches SET private_state=? WHERE id=?')
    .run(JSON.stringify(changed),matchId);
  const before=footStageSnapshot(db,matchId);
  assert.deepEqual(store.dispatchExperimentalSectionHistory(
    endLabSectionTurn(tokens.A)),{
      status:409,code:'SECTION_LAB_FOOT_STAGE_INTEGRITY_FAILED'
    });
  assert.deepEqual(footStageSnapshot(db,matchId),before);
  assert.equal(db.isTransaction,false);
}));

test('CCWB foot stage lifecycle: event insert failure rolls back section and retains staged foot',
  ()=>fixture(async({app,matchId,tokens})=>{
  const store=app.getStore(matchId),db=app.unsafeTestDatabase();
  stageForMovement(store,tokens.A);
  assert.equal(store.stageExperimentalSectionFootJournal(
    footStageRequest(tokens.A),trustedOpenFootScenario()).code,
    'SECTION_LAB_FOOT_STAGE_SAVED');
  const before=footStageSnapshot(db,matchId);
  db.exec(`CREATE TEMP TRIGGER foot_stage_forced_event_failure
    BEFORE INSERT ON main.game_events
    BEGIN SELECT RAISE(ABORT, 'FOOT_STAGE_FORCED_EVENT_FAILURE'); END;`);
  try {
    assert.throws(()=>store.dispatchExperimentalSectionHistory(
      endLabSectionTurn(tokens.A)),/FOOT_STAGE_FORCED_EVENT_FAILURE/);
  } finally {
    db.exec('DROP TRIGGER IF EXISTS temp.foot_stage_forced_event_failure');
  }
  assert.equal(db.isTransaction,false);
  assert.deepEqual(footStageSnapshot(db,matchId),before);
  const applied=store.dispatchExperimentalSectionHistory(
    endLabSectionTurn(tokens.A));
  assert.equal(applied.code,'SECTION_LAB_APPLIED');
  assert.equal(Object.hasOwn(JSON.parse(db.prepare(
    'SELECT private_state FROM matches WHERE id=?').get(matchId).private_state),
    'ancientsFootMovementJournalLab'),false);
}));
