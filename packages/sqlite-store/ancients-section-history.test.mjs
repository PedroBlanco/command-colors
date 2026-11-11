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
