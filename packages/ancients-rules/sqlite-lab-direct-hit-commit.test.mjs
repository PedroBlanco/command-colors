import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {openLabOnlyDirectHitCommit as open} from './sqlite-lab-direct-hit-commit.mjs';
import {previewBaseAncientsRangedBlockLoss as canonical} from './block-loss-preview.mjs';
const MATCH='123e4567-e89b-42d3-a456-426614174000';
const RESERVE='123e4567-e89b-42d3-a456-426614174001';
const digest=x=>createHash('sha256').update(x).digest('hex');
const req=(change={})=>({matchId:MATCH,sessionUserId:'alice',reservationId:RESERVE,
 expectedRevision:6,idempotencyKey:'fixture_hit_command_01',...change});
const board=(blocks=3,leader=false)=>({units:[
 {id:'a1',side:'A',type:'LIGHT_BOW_INFANTRY',col:2,row:4},
 {id:'b1',side:'B',type:'HEAVY_INFANTRY',col:5,row:4,blocksRemaining:blocks}],
 leaders:leader?[{id:'leader_b',side:'B',col:5,row:4}]:[],terrain:[]});
const trusted=({turnState,board,sessionSide,reservationId,expectedRevision})=>{
 if(sessionSide!=='A'||reservationId!==RESERVE||expectedRevision!==6)throw new Error('NOT_TRUSTED');
 const unit=board.units.find(u=>u.id===turnState.pendingCombat.targetId);
 const faces=turnState.pendingCombat.stagedDice.results;
 if(!unit||!Array.isArray(faces))throw new Error('NOT_TRUSTED');
 const hits=faces.filter(x=>x==='HEAVY').length,flags=faces.filter(x=>x==='FLAG').length;
 const n=Math.min(hits,unit.blocksRemaining),rem=unit.blocksRemaining-n;
 const leader=board.leaders.some(l=>l.side==='B'&&l.col===unit.col&&l.row===unit.row);
 return canonical({unitType:unit.type,blocksRemaining:unit.blocksRemaining,
   diceCount:faces.length,matchingColorHits:hits,flagsPending:flags,leaderAttached:leader});
};
function fixture(fn,{blocks=3,leader=false,faces=['HEAVY','FLAG'],fixtureOnly=true,
  stageKind='RANGED_DICE_STAGED_OFFICIAL_PREVIEW',derive=trusted}={}){
 const dir=mkdtempSync(join(tmpdir(),'ccw-fixture-hit-'));
 const file=join(dir,'ccrl.sqlite');const db=new DatabaseSync(file),connections=[];
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE lab_matches (
   id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, guest_id TEXT NOT NULL,
   revision INTEGER NOT NULL CHECK(revision>=0), turn_json TEXT NOT NULL,
   board_json TEXT NOT NULL, CHECK(owner_id<>guest_id)
 );
 CREATE TABLE lab_events (
   match_id TEXT NOT NULL REFERENCES lab_matches(id), sequence INTEGER NOT NULL,
   payload TEXT NOT NULL, PRIMARY KEY(match_id,sequence)
 );
 CREATE TABLE lab_commands (
   match_id TEXT NOT NULL REFERENCES lab_matches(id), actor TEXT NOT NULL,
   idem_key TEXT NOT NULL, signature TEXT NOT NULL, reservation_id TEXT NOT NULL,
   committed_revision INTEGER NOT NULL,
   PRIMARY KEY(match_id,actor,idem_key)
 );
 PRAGMA application_id=1128485452; PRAGMA user_version=1;`);
 const initial=board(blocks,leader),boardJson=JSON.stringify(initial);
 const marker={kind:stageKind,actor:'A',reservationId:RESERVE,attackerId:'a1',targetId:'b1',
  fullValidationRequired:true,boardSnapshotSha256:digest(boardJson),stagedDice:{results:faces}};
 const state={schemaVersion:1,ruleset:'ancients-base-3e-2009',status:'ACTIVE',
  labFixtureOnly:fixtureOnly,turn:'A',phase:'COMBAT',revision:6,pendingCombat:marker};
 db.prepare('INSERT INTO lab_matches VALUES(?,?,?,?,?,?)').run(MATCH,'alice','bob',6,JSON.stringify(state),boardJson);
 const connect=()=>{const s=open({file,allowTestFixtureMutation:true,deriveTrustedPreview:derive});connections.push(s);return s;};
 try{return fn({store:connect(),db,connect,file});}
 finally{for(const s of connections.reverse())try{s.close()}catch{}db.close();rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:10});}
}
const state=db=>db.prepare('SELECT revision,board_json,turn_json FROM lab_matches').get();
const events=db=>db.prepare('SELECT payload FROM lab_events ORDER BY sequence').all().map(x=>JSON.parse(x.payload));
const commands=db=>db.prepare('SELECT * FROM lab_commands').all();

test('atomic direct hits update board and revision in a CCRL lab fixture',()=>fixture(({store,db})=>{
 const out=store.apply(req());assert.equal(out.code,'LAB_DIRECT_HITS_APPLIED_FIXTURE');
 assert.equal(out.revision,7);assert.equal(out.summary.blocksRemoved,1);
 assert.equal(JSON.parse(state(db).board_json).units[1].blocksRemaining,2);
 assert.equal(state(db).revision,7);assert.equal(JSON.parse(state(db).turn_json).revision,7);
 assert.equal(JSON.parse(state(db).turn_json).pendingCombat.kind,'LAB_DIRECT_HITS_APPLIED_FIXTURE');
 assert.deepEqual(events(db),[{sequence:7,type:'LAB_DIRECT_HITS_APPLIED',side:'A',blocksRemoved:1}]);
 assert.equal(commands(db).length,1);
}));
test('the original dice are kept private and battle is not finalized',()=>fixture(({store,db})=>{
 const out=store.apply(req()),marker=JSON.parse(state(db).turn_json).pendingCombat;
 assert.equal(out.attackAuthorized,false);assert.equal(out.combatResolved,false);
 assert.equal(marker.stagedDice.results[0],'HEAVY');
 assert.equal(marker.appliedFixture.unverifiedFullRules,true);
 assert.equal(JSON.stringify(events(db)).includes('b1'),false);
}));
test('eliminating last block removes target unit but not any associated leader',()=>fixture(({store,db})=>{
 const out=store.apply(req());assert.equal(out.summary.unitEliminated,true);
 const b=JSON.parse(state(db).board_json);
 assert.deepEqual(b.units.map(u=>u.id),['a1']);assert.equal(b.leaders.length,1);
 assert.equal(out.summary.nextRequiredStep,'LEADER_CASUALTY_CHECK');
 assert.equal(out.summary.leaderCheckRequired,true);
},{blocks:1,leader:true}));
test('surviving leader keeps pending check before flags',()=>fixture(({store})=>{
 const out=store.apply(req());assert.equal(out.summary.nextRequiredStep,'LEADER_CASUALTY_CHECK');
 assert.equal(out.summary.flagsPending,1);
},{leader:true}));
test('zero-hit result advances fixture sequence without removing blocks',()=>fixture(({store,db})=>{
 const out=store.apply(req());assert.equal(out.summary.blocksRemoved,0);
 assert.equal(out.summary.nextRequiredStep,'DEFENDER_MORALE_CHOICE');
 assert.equal(JSON.parse(state(db).board_json).units[1].blocksRemaining,3);
 assert.equal(events(db)[0].type,'LAB_DIRECT_HITS_SKIPPED');
},{faces:['FLAG','SWORDS']}));
test('the same idempotency key replays exactly and never removes a second block',()=>fixture(({store,db,connect})=>{
 const first=store.apply(req()),replay=connect().apply(req());
 assert.equal(replay.code,'ALREADY_APPLIED_FIXTURE');
 assert.deepEqual(replay.summary,first.summary);
 assert.equal(JSON.parse(state(db).board_json).units[1].blocksRemaining,2);
 assert.equal(events(db).length,1);assert.equal(commands(db).length,1);
}));
test('changed key or revision cannot execute twice',()=>fixture(({store,db})=>{
 assert.equal(store.apply(req()).status,200);
 assert.equal(store.apply(req({idempotencyKey:'fixture_hit_command_02'})).code,'STALE_REVISION');
 assert.equal(store.apply(req({idempotencyKey:'fixture_hit_command_02',expectedRevision:7})).code,'LAB_HITS_NOT_APPLICABLE');
 assert.equal(store.apply(req({expectedRevision:7})).code,'IDEMPOTENCY_KEY_REUSED');
 assert.equal(events(db).length,1);
}));
test('stale revision fails before any write',()=>fixture(({store,db})=>{
 assert.equal(store.apply(req({expectedRevision:5})).code,'STALE_REVISION');
 assert.equal(events(db).length,0);assert.equal(commands(db).length,0);
}));
test('other participant and stranger cannot mutate the target blocks',()=>fixture(({store,db})=>{
 assert.equal(store.apply(req({sessionUserId:'bob'})).code,'LAB_HITS_NOT_APPLICABLE');
 assert.equal(store.apply(req({sessionUserId:'mallory'})).code,'NOT_FOUND');
 assert.equal(JSON.parse(state(db).board_json).units[1].blocksRemaining,3);
}));
test('production-shaped turn without fixture opt-in cannot modify blocks',()=>fixture(({store,db})=>{
 assert.equal(store.apply(req()).code,'LAB_HITS_NOT_APPLICABLE');
 assert.equal(events(db).length,0);
},{fixtureOnly:false}));
test('synthetic staged dice cannot enter the direct-hit fixture commit',()=>fixture(({store,db})=>{
 assert.equal(store.apply(req()).code,'LAB_HITS_NOT_APPLICABLE');
 assert.equal(events(db).length,0);
},{stageKind:'RANGED_DICE_STAGED_SYNTHETIC'}));
test('board changes after staging invalidate digest',()=>fixture(({store,db})=>{
 const b=JSON.parse(state(db).board_json);b.units[1].blocksRemaining=1;
 db.prepare('UPDATE lab_matches SET board_json=?').run(JSON.stringify(b));
 assert.equal(store.apply(req()).code,'LAB_HITS_NOT_APPLICABLE');
 assert.equal(events(db).length,0);
}));
test('client-supplied hit, board or leader claims are rejected',()=>fixture(({store,db})=>{
 for(const extra of [{blocksToRemove:99},{board:board(1)},{leaderAttached:true},
 {matchingColorHits:32},{targetId:'a1'},{approved:true}])
 assert.equal(store.apply(req(extra)).code,'INVALID_LAB_HIT_REQUEST');
 assert.equal(commands(db).length,0);
}));
test('rollback after an event insert fails leaves board and key unchanged',()=>fixture(({store,db})=>{
 const before=state(db);db.exec("CREATE TRIGGER abort_lab_hit BEFORE INSERT ON lab_events BEGIN SELECT RAISE(ABORT,'FAIL_EVENT'); END");
 assert.throws(()=>store.apply(req()),/FAIL_EVENT/);
 assert.deepEqual(state(db),before);assert.equal(commands(db).length,0);
 db.exec('DROP TRIGGER abort_lab_hit');assert.equal(store.apply(req()).status,200);
}));
test('rollback after command insert fails leaves board and event unchanged',()=>fixture(({store,db})=>{
 const before=state(db);db.exec("CREATE TRIGGER abort_lab_command BEFORE INSERT ON lab_commands BEGIN SELECT RAISE(ABORT,'FAIL_COMMAND'); END");
 assert.throws(()=>store.apply(req()),/FAIL_COMMAND/);
 assert.deepEqual(state(db),before);assert.equal(events(db).length,0);
 db.exec('DROP TRIGGER abort_lab_command');assert.equal(store.apply(req()).status,200);
}));
test('preview callback errors and invalid results fail without mutating SQLite',()=>fixture(({store,db})=>{
 assert.equal(store.apply(req()).code,'LAB_HITS_NOT_APPLICABLE');
 assert.equal(events(db).length,0);
},{derive:()=>({kind:'FORGED'})}));
test('safe constructors refuse mutation without opt-in or trusted derivation',()=>{
 assert.throws(()=>open({file:'/tmp/x'}),/UNSAFE_LAB_HIT_COMMIT_DISABLED/);
 assert.throws(()=>open({file:'/tmp/x',allowTestFixtureMutation:true}),/UNSAFE_LAB_HIT_COMMIT_DISABLED/);
});
test('wrong schema version is rejected at open, before mutation',()=>fixture(({db,file})=>{
 db.exec('PRAGMA user_version=2');
 assert.throws(()=>open({file,deriveTrustedPreview:trusted,allowTestFixtureMutation:true}),/NOT_CCRL_LAB/);
}));
test('null, arrays, IDs and bad keys are rejected before a transaction',()=>fixture(({store,db})=>{
 for(const bad of [null,[],req({matchId:'bad'}),req({idempotencyKey:'x'}),
   req({reservationId:'not-uuid'}),req({expectedRevision:1.5}),req({sessionUserId:null})])
   assert.equal(store.apply(bad).code,'INVALID_LAB_HIT_REQUEST');
 assert.equal(events(db).length,0);
}));
test('an extra trigger or unexpected schema change is rejected at open',()=>fixture(({db,file})=>{
 db.exec("CREATE TRIGGER unexpected AFTER INSERT ON lab_events BEGIN SELECT 1; END");
 assert.throws(()=>open({file,deriveTrustedPreview:trusted,allowTestFixtureMutation:true}),/LAB_SCHEMA_MISMATCH/);
}));
test('two open connections cannot apply different idempotency keys to the same stage',()=>fixture(({store,connect,db})=>{
 const second=connect();
 assert.equal(store.apply(req()).code,'LAB_DIRECT_HITS_APPLIED_FIXTURE');
 assert.equal(second.apply(req({idempotencyKey:'fixture_hit_command_02'})).code,'STALE_REVISION');
 assert.equal(events(db).length,1);assert.equal(commands(db).length,1);
}));
test('a forged snapshot revision or already-applied state is never accepted',()=>fixture(({store,db})=>{
 db.prepare('UPDATE lab_matches SET revision=7').run();
 assert.throws(()=>store.apply(req()),/LAB_REVISION_MISMATCH/);
 assert.equal(events(db).length,0);
}));
