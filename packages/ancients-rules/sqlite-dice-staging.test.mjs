import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openGuardedAncientsReservationLab} from './sqlite-guarded-reservation.mjs';
import {openAncientsReservationLab} from './sqlite-reservation-lab.mjs';

const MATCH='123e4567-e89b-42d3-a456-426614174000';
const turn=()=>({schemaVersion:1,ruleset:'ancients-base-3e-2009',status:'ACTIVE',
  turn:'A',phase:'COMBAT',revision:4,orderedUnitIds:['a1'],
  resolvedBattleUnitIds:[],movedStepsByUnit:{a1:0},pendingCombat:null,pendingDecision:null});
const board=()=>({units:[{id:'a1',side:'A',type:'LIGHT_BOW_INFANTRY',col:2,row:4},
 {id:'b1',side:'B',type:'HEAVY_INFANTRY',col:5,row:4}],leaders:[],terrain:[]});
const declaration=(changes={})=>({matchId:MATCH,sessionUserId:'alice',attackerId:'a1',
 targetId:'b1',expectedRevision:4,idempotencyKey:'reserve_dice_0001',...changes});
const dice=(id,changes={})=>({matchId:MATCH,sessionUserId:'alice',reservationId:id,
 expectedRevision:5,idempotencyKey:'stage_dice_0001',mode:'DIGITAL',...changes});
const cancel=(id,changes={})=>({matchId:MATCH,sessionUserId:'alice',reservationId:id,
 expectedRevision:5,idempotencyKey:'cancel_dice_0001',...changes});
function fixture(fn,{checker}={}) {
 const dir=mkdtempSync(join(tmpdir(),'ccw-dice-stage-'));
 const file=join(dir,'store.sqlite'),opened=[];
 const open=()=>{const s=checker ? openAncientsReservationLab({file,checkDeclaration:checker})
   :openGuardedAncientsReservationLab({file});opened.push(s);return s;};
 try {const s=open();s.seedFixture({matchId:MATCH,ownerId:'alice',guestId:'bob',
   turnState:turn(),board:board()});return fn({store:s,open});}
 finally {for(const s of opened.reverse())try{s.close();}catch{}
 rmSync(dir,{force:true,recursive:true,maxRetries:20,retryDelay:100});}
}

const reserve=s=>{const r=s.reserve(declaration());assert.equal(r.code,'SCREENING_RESERVED');return r;};

test('digital dice stage is non-authoritative and uses the real screened server count',()=>fixture(({store})=>{
 const r=reserve(store),staged=store.stageDice(dice(r.reservationId));
 assert.equal(staged.code,'DICE_STAGED_SYNTHETIC');
 assert.equal(staged.revision,6);
 assert.equal(staged.attackAuthorized,false);assert.equal(staged.combatResolved,false);
 assert.equal(staged.roll.source,'DIGITAL');
 assert.equal(staged.roll.verification,'SERVER_GENERATED');
 assert.equal(staged.roll.diceCount,2);
 assert.equal(staged.roll.results.length,2);
 assert.ok(staged.roll.results.every(f=>['RED','BLUE','FLAG'].includes(f)));
 const view=store.inspectFixture({matchId:MATCH,sessionUserId:'bob'});
 assert.equal(view.turnState.pendingCombat.kind,'RANGED_DICE_STAGED_SYNTHETIC');
 assert.deepEqual(view.turnState.resolvedBattleUnitIds,[]);
 assert.deepEqual(view.events.map(e=>e.type),['RANGED_SCREENING_RESERVED','RANGED_DICE_STAGED_SYNTHETIC']);
}));

test('physical roll is recorded as player declared, with exact server count',()=>fixture(({store})=>{
 const r=reserve(store),out=store.stageDice(dice(r.reservationId,{mode:'PHYSICAL',declaredFaces:['FLAG','RED']}));
 assert.equal(out.code,'DICE_STAGED_SYNTHETIC');
 assert.deepEqual(out.roll.results,['FLAG','RED']);
 assert.equal(out.roll.verification,'PLAYER_DECLARED');
 assert.equal(out.roll.source,'PHYSICAL');
 assert.equal(out.attackAuthorized,false);
}));

test('retries reproduce cryptographic results exactly instead of rerolling',()=>fixture(({store,open})=>{
 const r=reserve(store),request=dice(r.reservationId),first=store.stageDice(request);
 assert.equal(first.code,'DICE_STAGED_SYNTHETIC');
 const retry=open().stageDice(request);
 assert.equal(retry.code,'ALREADY_STAGED');
 assert.deepEqual(retry.roll,first.roll);assert.equal(retry.revision,6);
 const view=store.inspectFixture({matchId:MATCH,sessionUserId:'bob'});
 assert.equal(view.events.length,2);
}));

test('reusing key for a different mode, payload or revision is forbidden',()=>fixture(({store})=>{
 const r=reserve(store),request=dice(r.reservationId);
 assert.equal(store.stageDice(request).status,200);
 assert.equal(store.stageDice({...request,mode:'PHYSICAL',declaredFaces:['RED','RED']}).code,'IDEMPOTENCY_KEY_REUSED');
 assert.equal(store.stageDice({...request,expectedRevision:6}).code,'IDEMPOTENCY_KEY_REUSED');
 assert.equal(store.inspectFixture({matchId:MATCH,sessionUserId:'bob'}).events.length,2);
}));

test('a second key cannot stage more dice in an already staged combat',()=>fixture(({store})=>{
 const r=reserve(store);store.stageDice(dice(r.reservationId));
 assert.equal(store.stageDice(dice(r.reservationId,{idempotencyKey:'other_stage_00001'})).code,'STALE_REVISION');
 assert.equal(store.stageDice(dice(r.reservationId,{expectedRevision:6,idempotencyKey:'other_stage_00001'})).code,'RESERVATION_NOT_STAGEABLE');
}));

test('unknown users and other participant cannot access the original reservation',()=>fixture(({store})=>{
 const r=reserve(store);
 assert.equal(store.stageDice(dice(r.reservationId,{sessionUserId:'mallory'})).code,'NOT_FOUND');
 assert.equal(store.stageDice(dice(r.reservationId,{sessionUserId:'bob'})).code,'RESERVATION_NOT_STAGEABLE');
 assert.equal(store.inspectFixture({matchId:MATCH,sessionUserId:'alice'}).revision,5);
}));

test('cancelled screening cannot stage dice; staged dice cannot be cancelled',()=>fixture(({store})=>{
 const r=reserve(store);
 assert.equal(store.cancel(cancel(r.reservationId)).code,'SCREENING_CANCELLED');
 assert.equal(store.stageDice(dice(r.reservationId,{expectedRevision:6})).code,'RESERVATION_NOT_STAGEABLE');
}));

test('staging irreversible random result forbids subsequent cancellation',()=>fixture(({store})=>{
 const r=reserve(store);store.stageDice(dice(r.reservationId));
 assert.equal(store.cancel(cancel(r.reservationId,{expectedRevision:6})).code,'RESERVATION_NOT_CANCELLABLE');
 assert.equal(store.inspectFixture({matchId:MATCH,sessionUserId:'bob'}).revision,6);
}));

test('client cannot choose number of dice or forged die faces',()=>fixture(({store})=>{
 const r=reserve(store);
 const base=dice(r.reservationId);
 assert.equal(store.stageDice({...base,mode:'PHYSICAL',declaredFaces:['RED']}).code,'INVALID_DICE_DECLARATION');
 assert.equal(store.stageDice({...base,mode:'PHYSICAL',declaredFaces:['RED','RED','RED']}).code,'INVALID_DICE_DECLARATION');
 assert.equal(store.stageDice({...base,mode:'PHYSICAL',declaredFaces:['RED','UNKNOWN']}).code,'INVALID_DICE_DECLARATION');
 assert.equal(store.stageDice({...base,declaredFaces:['RED','RED']}).code,'INVALID_DICE_DECLARATION');
 assert.equal(store.stageDice({...base,mode:'MANUAL'}).code,'INVALID_DICE_DECLARATION');
 assert.equal(store.stageDice({...base,mode:'PHYSICAL',declaredFaces:Array(1000).fill('RED')}).code,'INVALID_DICE_DECLARATION');
 assert.equal(store.inspectFixture({matchId:MATCH,sessionUserId:'bob'}).revision,5);
 assert.equal(store.stageDice({...base,diceCount:32,dieFaces:['HACKED']}).roll.diceCount,2);
}));

test('lab checker without a verified dice count cannot stage any dice',()=>fixture(({store})=>{
 const r=reserve(store);
 assert.equal(store.stageDice(dice(r.reservationId)).code,'DICE_PLAN_UNAVAILABLE');
 assert.equal(store.inspectFixture({matchId:MATCH,sessionUserId:'bob'}).revision,5);
},{checker:()=>({status:'CANDIDATE',attackAuthorized:false,needsFullLegalityCheck:true})}));

test('a database event failure rolls back digital result, revision and key',()=>fixture(({store})=>{
 const r=reserve(store),db=store.unsafeTestDatabase();
 db.exec("CREATE TRIGGER break_stage BEFORE INSERT ON lab_events BEGIN SELECT RAISE(ABORT,'STAGE_FAILED'); END");
 assert.throws(()=>store.stageDice(dice(r.reservationId)),/STAGE_FAILED/);
 const view=store.inspectFixture({matchId:MATCH,sessionUserId:'alice'});
 assert.equal(view.revision,5);assert.equal(view.turnState.pendingCombat.kind,'RANGED_SCREENING_ONLY');
 assert.equal(db.prepare('SELECT count(*) n FROM lab_commands').get().n,1);
 db.exec('DROP TRIGGER break_stage');
 assert.equal(store.stageDice(dice(r.reservationId)).code,'DICE_STAGED_SYNTHETIC');
}));

test('physical results persist, retry survives restart and provenance is unchanged',()=>fixture(({store,open})=>{
 const r=reserve(store),req=dice(r.reservationId,{mode:'PHYSICAL',declaredFaces:['RED','FLAG']});
 const first=store.stageDice(req);store.close();
 const restarted=open(),second=restarted.stageDice(req);
 assert.equal(second.code,'ALREADY_STAGED');
 assert.deepEqual(second.roll.results,first.roll.results);
 assert.equal(second.roll.verification,'PLAYER_DECLARED');
}));

test('public event contains no results, unit IDs, roll IDs or faces',()=>fixture(({store})=>{
 const r=reserve(store);store.stageDice(dice(r.reservationId,{mode:'PHYSICAL',declaredFaces:['FLAG','RED']}));
 const events=store.inspectFixture({matchId:MATCH,sessionUserId:'bob'}).events;
 assert.equal(events.length,2);
 assert.deepEqual(events[1],{sequence:6,type:'RANGED_DICE_STAGED_SYNTHETIC',side:'A',source:'PHYSICAL',diceCount:2});
 assert.equal(JSON.stringify(events).includes(r.reservationId),false);
}));

test('stage input validation denies missing ids, modes, keys and wrong revisions',()=>fixture(({store})=>{
 const r=reserve(store),base=dice(r.reservationId);
 for(const change of [{reservationId:null},{matchId:null},{sessionUserId:null},{mode:null},
   {idempotencyKey:'bad'},{expectedRevision:-1},{declaredFaces:['RED']},
   {expectedRevision:null}])assert.equal(store.stageDice({...base,...change}).code,'INVALID_DICE_DECLARATION');
 assert.equal(store.stageDice({...base,expectedRevision:6}).code,'STALE_REVISION');
 assert.equal(store.stageDice({...base,reservationId:'123e4567-e89b-42d3-a456-426614174010'}).code,'RESERVATION_NOT_STAGEABLE');
}));
