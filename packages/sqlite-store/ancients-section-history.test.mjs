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
  for(const handle of ['alice','bob']){
    const r=await app.identity.provisionAccount({handle,password:PASSWORD});
    assert.equal(r.ok,true);
  }
  const a=await app.identity.logIn({handle:'alice',password:PASSWORD});
  const b=await app.identity.logIn({handle:'bob',password:PASSWORD});
  const created=app.invitations.createMatch({sessionToken:a.token});
  const invited=app.invitations.issueInvitation({sessionToken:a.token,matchId:created.matchId,targetHandle:'bob'});
  assert.equal(app.invitations.acceptInvitation({sessionToken:b.token,invitationToken:invited.token}).ok,true);
  return await fn({app,connect,matchId:created.matchId});
 }finally{
  for(const x of opened.reverse())try{x.close()}catch{}
  rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});
 }
}

test('CCWB composition: experimental history excludes synthetic commands and views',()=>fixture(async({app,matchId})=>{
 const store=app.getStore(matchId);
 assert.equal(store.initializeExperimentalSectionHistory('B',setup()).code,'FORBIDDEN');
 assert.equal(store.initializeExperimentalSectionHistory('A',setup()).code,'SECTION_LAB_INITIALIZED');
 assert.equal(store.initializeCommandDeck('A').code,'SECTION_LAB_MODE_ACTIVE');
 const owner=store.view('A'),other=store.view('B');
 assert.equal(owner.status,'LAB_ONLY');assert.equal(other.status,'LAB_ONLY');
 assert.equal(owner.opponentCardCount,2);
 assert.equal(JSON.stringify(owner).includes(other.yourHand[0].instanceId),false);
 assert.equal(JSON.stringify(other).includes(owner.yourHand[0].instanceId),false);
 const pass=await store.dispatch({actor:'A',type:'pass_demo_turn',
   expectedRevision:0,idempotencyKey:'legacy_demo_refused'});
 assert.equal(pass.code,'INVALID_SECTION_LAB_COMMAND');
 assert.equal(store.view('A').revision,0);
 assert.equal(store.publicEvents('A').length,0);
}));

test('CCWB composition: logged section-card command survives restart and stays private',()=>fixture(async({app,connect,matchId})=>{
 const store=app.getStore(matchId);
 assert.equal(store.initializeExperimentalSectionHistory('A',setup()).status,201);
 const card=store.view('A').yourHand[0];
 const command={actor:'A',type:'PLAY_SECTION_CARD',expectedRevision:0,
   idempotencyKey:'persist_section_0001',cardInstanceId:card.instanceId};
 const recorded=await store.dispatch(command);
 assert.equal(recorded.code,'SECTION_LAB_APPLIED');
 assert.equal(recorded.view.revision,1);
 assert.equal(store.publicEvents('B').length,1);
 assert.equal(JSON.stringify(store.publicEvents('B')).includes(card.instanceId),false);
 const next=connect().getStore(matchId);
 assert.equal(next.view('B').revision,1);
 assert.equal(next.view('B').opponentCardCount,1);
 assert.equal((await next.dispatch(command)).code,'ALREADY_APPLIED');
 assert.equal(next.view('A').cardPlayAuthorized,false);
 assert.equal(next.view('A').attackAuthorized,false);
}));

test('CCWB composition: untouched demo match retains ordinary demonstration commands',()=>fixture(async({app,matchId})=>{
 const store=app.getStore(matchId);
 assert.equal(store.view('A').status,'ACTIVE');
 const result=await store.dispatch({actor:'A',type:'pass_demo_turn',
   expectedRevision:0,idempotencyKey:'untouched_demo_0001'});
 assert.equal(result.code,'APPLIED');
 assert.equal(store.view('B').revision,1);
 assert.equal(store.initializeExperimentalSectionHistory('A',setup()).code,'SECTION_LAB_NOT_AVAILABLE');
}));
