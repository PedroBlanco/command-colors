import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openOfficialAncientsRangedPreviewLab,
  openGuardedAncientsReservationLab} from './sqlite-guarded-reservation.mjs';
import {deriveStagedAncientsRangedBlockLoss} from './ranged-block-snapshot.mjs';

const MATCH='123e4567-e89b-42d3-a456-426614174000';
const BAD_MATCH='123e4567-e89b-42d3-a456-426614174005';
const turn=()=>({schemaVersion:1,ruleset:'ancients-base-3e-2009',status:'ACTIVE',
  turn:'A',phase:'COMBAT',revision:4,orderedUnitIds:['a1'],
  resolvedBattleUnitIds:[],movedStepsByUnit:{a1:0},pendingCombat:null,pendingDecision:null});
const board=(blocksRemaining=3,leaders=[])=>({units:[
  {id:'a1',side:'A',type:'LIGHT_BOW_INFANTRY',col:2,row:4},
  {id:'b1',side:'B',type:'HEAVY_INFANTRY',col:5,row:4,blocksRemaining}
],leaders,terrain:[]});
const attached=()=>[{id:'leader_b',side:'B',col:5,row:4}];
const reservation=()=>({matchId:MATCH,sessionUserId:'alice',attackerId:'a1',
  targetId:'b1',expectedRevision:4,idempotencyKey:'snapshot_reserve_01'});
const staging=(reservationId,faces=['HEAVY','FLAG'])=>({matchId:MATCH,sessionUserId:'alice',
  reservationId,expectedRevision:5,idempotencyKey:'snapshot_stage_0001',mode:'PHYSICAL',declaredFaces:faces});
const preview=(reservationId,changes={})=>({matchId:MATCH,sessionUserId:'alice',
  reservationId,expectedRevision:6,...changes});
function fixture(run,{blocksRemaining=3,leaders=[],synthetic=false,customBoard}={}) {
  const dir=mkdtempSync(join(tmpdir(),'ccw-ranged-blocks-'));
  const file=join(dir,'block-snapshot.sqlite'),opened=[];
  const open=(variant=synthetic)=>{
    const instance=variant ? openGuardedAncientsReservationLab({file})
      :openOfficialAncientsRangedPreviewLab({file});
    opened.push(instance);return instance;
  };
  try {
    const store=open();store.seedFixture({matchId:MATCH,ownerId:'alice',guestId:'bob',
      turnState:turn(),board:customBoard??board(blocksRemaining,leaders)});
    return run({store,open});
  } finally {
    for(const s of opened.reverse())try{s.close();}catch{}
    rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});
  }
}
function reserveAndStage(s,faces=['HEAVY','FLAG']) {
  const reservationResponse=s.reserve(reservation());
  assert.equal(reservationResponse.code,'SCREENING_RESERVED');
  const staged=s.stageDice(staging(reservationResponse.reservationId,faces));
  assert.equal(staged.code,'DICE_STAGED_OFFICIAL_PREVIEW');
  return reservationResponse.reservationId;
}
const mutate=(store,{modifyBoard,modifyTurn,attestBoard=false})=>{
  const db=store.unsafeTestDatabase();
  const row=db.prepare('SELECT board_json,turn_json FROM lab_matches WHERE id=?').get(MATCH);
  const boardData=JSON.parse(row.board_json),turnData=JSON.parse(row.turn_json);
  if(modifyBoard)modifyBoard(boardData);
  if(modifyTurn)modifyTurn(turnData);
  const boardJson=JSON.stringify(boardData);
  if(attestBoard)turnData.pendingCombat.boardSnapshotSha256=createHash('sha256').update(boardJson).digest('hex');
  db.prepare('UPDATE lab_matches SET board_json=?,turn_json=? WHERE id=?')
    .run(boardJson,JSON.stringify(turnData),MATCH);
};

test('SQLite: derive target block losses from the same stored revision and dice',()=>fixture(({store})=>{
  const id=reserveAndStage(store);
  const response=store.previewStagedBlockLoss(preview(id));
  assert.equal(response.status,200);assert.equal(response.code,'BLOCK_LOSS_PREVIEW');
  assert.equal(response.revision,6);
  assert.equal(response.preview.originalBlocks,3);
  assert.equal(response.preview.blocksToRemove,1);
  assert.equal(response.preview.remainingBlocks,2);
  assert.equal(response.preview.effectiveFlagsPending,1);
  assert.equal(response.preview.unitWouldBeEliminated,false);
  for(const flag of ['boardMutated','hitsApplied','combatResolved','bannerAwarded','flagsResolved','attackAuthorized'])
    assert.equal(response.preview[flag],false);
  assert.equal(response.boardMutated,false);assert.equal(response.attackAuthorized,false);
  const db=store.unsafeTestDatabase();
  assert.equal(JSON.parse(db.prepare('SELECT board_json FROM lab_matches').get().board_json).units[1].blocksRemaining,3);
}));

test('SQLite: unit with one block is only provisionally eliminated; flag ignored',()=>fixture(({store})=>{
  const id=reserveAndStage(store);
  const p=store.previewStagedBlockLoss(preview(id)).preview;
  assert.equal(p.originalBlocks,1);assert.equal(p.remainingBlocks,0);
  assert.equal(p.possibleVictoryBanner,1);assert.equal(p.bannerAwarded,false);
  assert.equal(p.flagsNoLongerApplicable,1);assert.equal(p.effectiveFlagsPending,0);
},{blocksRemaining:1}));

test('SQLite: attached defender leader creates two-dice pending casualty check',()=>fixture(({store})=>{
  const id=reserveAndStage(store);
  const p=store.previewStagedBlockLoss(preview(id)).preview;
  assert.equal(p.leaderCasualtyCheck.diceCount,2);
  assert.equal(p.leaderCasualtyCheck.completed,false);
  assert.equal(p.leaderChecksResolved,false);
},{leaders:attached()}));

test('SQLite: attached leader of eliminated unit requires only one die; no automatic casualty',()=>fixture(({store})=>{
  const id=reserveAndStage(store);
  const p=store.previewStagedBlockLoss(preview(id)).preview;
  assert.equal(p.leaderCasualtyCheck.diceCount,1);
  assert.equal(p.leaderCasualtyCheck.completed,false);
  assert.equal(p.possibleVictoryBanner,1);
  assert.equal(p.bannerAwarded,false);
},{blocksRemaining:1,leaders:attached()}));

test('SQLite: a nearby enemy leader is not mistakenly attached to the target unit',()=>fixture(({store})=>{
  const id=reserveAndStage(store);
  const p=store.previewStagedBlockLoss(preview(id)).preview;
  assert.equal(p.leaderCasualtyCheck,null);
},{leaders:[{id:'leader_b',side:'B',col:5,row:5}]}));

test('SQLite: physical no-hit result preserves blocks and leaves only a pending flag',()=>fixture(({store})=>{
  const id=reserveAndStage(store,['FLAG','SWORDS']);
  const p=store.previewStagedBlockLoss(preview(id)).preview;
  assert.equal(p.blocksToRemove,0);assert.equal(p.remainingBlocks,3);
  assert.equal(p.effectiveFlagsPending,1);assert.equal(p.flagsResolved,false);
}));

test('SQLite: read-only result stable after reopening independently and no new events or keys',()=>fixture(({store,open})=>{
  const id=reserveAndStage(store);
  const db=store.unsafeTestDatabase();
  const eventsBefore=db.prepare('SELECT COUNT(*) AS n FROM lab_events').get().n;
  const commandsBefore=db.prepare('SELECT COUNT(*) AS n FROM lab_commands').get().n;
  const before=store.previewStagedBlockLoss(preview(id));
  store.close();const other=open();
  const after=other.previewStagedBlockLoss(preview(id));
  assert.deepEqual(after,before);
  assert.equal(other.unsafeTestDatabase().prepare('SELECT COUNT(*) AS n FROM lab_events').get().n,eventsBefore);
  assert.equal(other.unsafeTestDatabase().prepare('SELECT COUNT(*) AS n FROM lab_commands').get().n,commandsBefore);
  assert.equal(after.revision,6);
}));

test('SQLite: no result before dice are staged and no preview for synthetic plan',()=>fixture(({store,open})=>{
  const reserved=store.reserve(reservation());
  assert.equal(reserved.code,'SCREENING_RESERVED');
  assert.equal(store.previewStagedBlockLoss(preview(reserved.reservationId,{expectedRevision:5})).code,'PREVIEW_NOT_AVAILABLE');
  store.cancel({matchId:MATCH,sessionUserId:'alice',reservationId:reserved.reservationId,
    expectedRevision:5,idempotencyKey:'snapshot_cancel_01'});
  assert.equal(store.previewStagedBlockLoss(preview(reserved.reservationId,{expectedRevision:6})).code,'PREVIEW_NOT_AVAILABLE');
}));

test('SQLite: staged synthetic dice remain nonofficial and cannot preview block losses',()=>fixture(({store})=>{
  const r=store.reserve(reservation());assert.equal(r.code,'SCREENING_RESERVED');
  assert.equal(store.stageDice(staging(r.reservationId,['RED','FLAG'])).code,'DICE_STAGED_SYNTHETIC');
  assert.equal(store.previewStagedBlockLoss(preview(r.reservationId)).code,'PREVIEW_NOT_AVAILABLE');
},{synthetic:true}));

test('SQLite: only reserving authenticated participant may see a private preview',()=>fixture(({store})=>{
  const id=reserveAndStage(store);
  assert.equal(store.previewStagedBlockLoss(preview(id,{sessionUserId:'bob'})).code,'PREVIEW_NOT_AVAILABLE');
  assert.equal(store.previewStagedBlockLoss(preview(id,{sessionUserId:'mallory'})).code,'NOT_FOUND');
  assert.equal(store.previewStagedBlockLoss(preview(id,{matchId:BAD_MATCH})).code,'NOT_FOUND');
  assert.equal(store.inspectFixture({matchId:MATCH,sessionUserId:'bob'}).events.length,2);
}));

test('SQLite: stale revision and wrong reservation cannot reveal current state',()=>fixture(({store})=>{
  const id=reserveAndStage(store);
  assert.equal(store.previewStagedBlockLoss(preview(id,{expectedRevision:5})).code,'STALE_REVISION');
  assert.equal(store.previewStagedBlockLoss(preview(id,{expectedRevision:7})).code,'STALE_REVISION');
  assert.equal(store.previewStagedBlockLoss(preview('123e4567-e89b-42d3-a456-426614174007')).code,'PREVIEW_NOT_AVAILABLE');
}));

test('SQLite: client-provided board, blocks and hit totals are rejected, not trusted',()=>fixture(({store})=>{
  const id=reserveAndStage(store);
  for(const injected of [{blocksRemaining:0},{matchingColorHits:32},
    {leaderAttached:true},{board:board(1,attached())},{unitType:'LIGHT_INFANTRY'}])
    assert.equal(store.previewStagedBlockLoss(preview(id,injected)).code,'INVALID_PREVIEW_REQUEST');
  assert.equal(store.previewStagedBlockLoss(preview(id)).status,200);
}));

test('SQLite: malformed preview requests fail closed, including NULL inputs',()=>fixture(({store})=>{
  const id=reserveAndStage(store);
  for(const input of [null,[],{},preview(id,{sessionUserId:null}),
    preview(id,{expectedRevision:undefined}),preview(id,{reservationId:'not-a-uuid'}),
    preview(id,{matchId:undefined}),preview(id,{expectedRevision:1.5})])
    assert.equal(store.previewStagedBlockLoss(input).code,'INVALID_PREVIEW_REQUEST');
}));

test('SQLite: old official captures without board binding cannot be reinterpreted retroactively',()=>fixture(({store})=>{
  const id=reserveAndStage(store);
  mutate(store,{modifyTurn:t=>delete t.pendingCombat.boardSnapshotSha256});
  assert.equal(store.previewStagedBlockLoss(preview(id)).code,'PREVIEW_NOT_AVAILABLE');
}));

test('SQLite: changes to board, including blocks remaining, invalidate snapshot fingerprint',()=>fixture(({store})=>{
  const id=reserveAndStage(store);
  mutate(store,{modifyBoard:b=>b.units[1].blocksRemaining=1});
  assert.equal(store.previewStagedBlockLoss(preview(id)).code,'PREVIEW_NOT_AVAILABLE');
}));

test('SQLite: target with missing remaining blocks never defaults to starting stack',()=>fixture(({store})=>{
  const id=reserveAndStage(store);
  assert.equal(store.previewStagedBlockLoss(preview(id)).code,'PREVIEW_NOT_AVAILABLE');
},{customBoard:(()=>{const b=board();delete b.units[1].blocksRemaining;return b;})()}));

test('SQLite: target with excessive, null or zero blocks fails closed',()=>{
  for(const blocksRemaining of [null,0,5,1.5,'3'])fixture(({store})=>{
    const id=reserveAndStage(store);
    assert.equal(store.previewStagedBlockLoss(preview(id)).code,'PREVIEW_NOT_AVAILABLE');
  },{blocksRemaining});
});

test('SQLite: cached interpretation inconsistent with stored roll is rejected',()=>fixture(({store})=>{
  const id=reserveAndStage(store);
  mutate(store,{modifyTurn:t=>t.pendingCombat.previewInterpretation.matchingColorHits=2});
  assert.equal(store.previewStagedBlockLoss(preview(id)).code,'PREVIEW_NOT_AVAILABLE');
}));

test('SQLite: roll faces altered after staging invalidate original interpretation',()=>fixture(({store})=>{
  const id=reserveAndStage(store);
  mutate(store,{modifyTurn:t=>t.pendingCombat.stagedDice.results=['FLAG','FLAG']});
  assert.equal(store.previewStagedBlockLoss(preview(id)).code,'PREVIEW_NOT_AVAILABLE');
}));

test('SQLite: roll actor and roll ID must match reservation, not a foreign player',()=>fixture(({store})=>{
  const id=reserveAndStage(store);
  mutate(store,{modifyTurn:t=>t.pendingCombat.stagedDice.actor='B'});
  assert.equal(store.previewStagedBlockLoss(preview(id)).code,'PREVIEW_NOT_AVAILABLE');
  mutate(store,{modifyTurn:t=>{t.pendingCombat.stagedDice.actor='A';t.pendingCombat.stagedDice.rollId='roll_other';}});
  assert.equal(store.previewStagedBlockLoss(preview(id)).code,'PREVIEW_NOT_AVAILABLE');
}));

test('SQLite: target switched to a different type without rewriting plan is rejected',()=>fixture(({store})=>{
  const id=reserveAndStage(store);
  mutate(store,{modifyBoard:b=>b.units[1].type='LIGHT_INFANTRY',attestBoard:true});
  assert.equal(store.previewStagedBlockLoss(preview(id)).code,'PREVIEW_NOT_AVAILABLE');
}));

test('SQLite: same-hex wrong-side leader is invalid even with a renewed fingerprint',()=>fixture(({store})=>{
  const id=reserveAndStage(store);
  mutate(store,{modifyBoard:b=>b.leaders[0].side='A',attestBoard:true});
  assert.equal(store.previewStagedBlockLoss(preview(id)).code,'PREVIEW_NOT_AVAILABLE');
},{leaders:attached()}));

test('SQLite: duplicate attacker or duplicated leader on a target hex is rejected',()=>fixture(({store})=>{
  const id=reserveAndStage(store);
  mutate(store,{modifyBoard:b=>b.units.push({...b.units[0]}),attestBoard:true});
  assert.equal(store.previewStagedBlockLoss(preview(id)).code,'PREVIEW_NOT_AVAILABLE');
}));

test('SQLite: forged extra leaders in target hex fail closed',()=>fixture(({store})=>{
  const id=reserveAndStage(store);
  mutate(store,{modifyBoard:b=>b.leaders.push({id:'leader_other',side:'B',col:5,row:4}),attestBoard:true});
  assert.equal(store.previewStagedBlockLoss(preview(id)).code,'PREVIEW_NOT_AVAILABLE');
},{leaders:attached()}));

test('SQLite: explicit resolved attacker in persisted turn refuses preview',()=>fixture(({store})=>{
  const id=reserveAndStage(store);
  mutate(store,{modifyTurn:t=>t.resolvedBattleUnitIds.push('a1')});
  assert.equal(store.previewStagedBlockLoss(preview(id)).code,'PREVIEW_NOT_AVAILABLE');
}));

test('pure derivation independently rejects a forged session and uses original saved facts',()=>fixture(({store})=>{
  const id=reserveAndStage(store);
  const db=store.unsafeTestDatabase();
  const row=db.prepare('SELECT board_json, turn_json FROM lab_matches WHERE id=?').get(MATCH);
  const facts={turnState:JSON.parse(row.turn_json),board:JSON.parse(row.board_json),
    reservationId:id,expectedRevision:6,sessionSide:'A'};
  assert.equal(deriveStagedAncientsRangedBlockLoss(facts).remainingBlocks,2);
  assert.throws(()=>deriveStagedAncientsRangedBlockLoss({...facts,sessionSide:'B'}),/INVALID_STAGED_BLOCK_SNAPSHOT/);
  assert.throws(()=>deriveStagedAncientsRangedBlockLoss({...facts,expectedRevision:5}),/INVALID_STAGED_BLOCK_SNAPSHOT/);
  assert.throws(()=>deriveStagedAncientsRangedBlockLoss({...facts,board:{...facts.board,leaders:undefined}}),/INVALID_STAGED_BLOCK_SNAPSHOT/);
}));

test('SQLite: preview has no side effects and cannot record or authorize dice itself',()=>fixture(({store})=>{
  const id=reserveAndStage(store);
  const db=store.unsafeTestDatabase();
  const eventCount=db.prepare('SELECT COUNT(*) AS n FROM lab_events').get().n;
  const state=db.prepare('SELECT turn_json,board_json,revision FROM lab_matches').get();
  const p=store.previewStagedBlockLoss(preview(id));
  assert.equal(p.status,200);assert.equal(Object.isFrozen(p),true);
  assert.equal(Object.isFrozen(p.preview),true);
  assert.deepEqual(db.prepare('SELECT turn_json,board_json,revision FROM lab_matches').get(),state);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lab_events').get().n,eventCount);
  assert.equal(p.combatResolved,false);
}));

test('SQLite: digital six-face dice are read from the persisted roll without rerolling',()=>fixture(({store,open})=>{
  const r=store.reserve(reservation());assert.equal(r.code,'SCREENING_RESERVED');
  const staged=store.stageDice({...staging(r.reservationId),mode:'DIGITAL',declaredFaces:undefined});
  assert.equal(staged.code,'DICE_STAGED_OFFICIAL_PREVIEW');
  const before=store.previewStagedBlockLoss(preview(r.reservationId));
  assert.equal(before.status,200);
  assert.equal(before.preview.matchingColorHits,staged.interpretation.matchingColorHits);
  assert.equal(before.preview.flagsRolled,staged.interpretation.flagsPending);
  store.close();
  const other=open();
  assert.deepEqual(other.previewStagedBlockLoss(preview(r.reservationId)),before);
}));

test('SQLite: surplus colour hits cannot remove more than the last enemy block',()=>fixture(({store})=>{
  const id=reserveAndStage(store,['HEAVY','HEAVY']);
  const p=store.previewStagedBlockLoss(preview(id)).preview;
  assert.equal(p.matchingColorHits,2);
  assert.equal(p.blocksToRemove,1);
  assert.equal(p.excessHits,1);
  assert.equal(p.remainingBlocks,0);
  assert.equal(p.bannerAwarded,false);
},{blocksRemaining:1}));

test('SQLite: staged official dice carry a board digest without changing the schema',()=>fixture(({store})=>{
  const id=reserveAndStage(store);
  const db=store.unsafeTestDatabase();
  const entry=db.prepare('SELECT board_json,turn_json FROM lab_matches').get();
  const marker=JSON.parse(entry.turn_json).pendingCombat;
  assert.equal(marker.boardSnapshotSha256,createHash('sha256').update(entry.board_json).digest('hex'));
  assert.equal(marker.boardSnapshotSha256.length,64);
  assert.equal(marker.reservationId,id);
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
    .all().map(x=>x.name),['lab_commands','lab_events','lab_matches']);
}));
