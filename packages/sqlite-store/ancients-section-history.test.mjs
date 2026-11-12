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
function stageForMovement(store,token){
  assert.equal(store.initializeExperimentalSectionHistory({sessionToken:token,trustedSetup:setup()}).status,201);
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
