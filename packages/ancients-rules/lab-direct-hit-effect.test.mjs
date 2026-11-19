import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareLabDirectHitEffect as apply} from './lab-direct-hit-effect.mjs';
import {previewBaseAncientsRangedBlockLoss as canonical} from './block-loss-preview.mjs';
const board=(blocks=3,withLeader=false)=>({units:[
 {id:'a1',side:'A',type:'LIGHT_BOW_INFANTRY',col:2,row:4},
 {id:'b1',side:'B',type:'HEAVY_INFANTRY',col:5,row:4,blocksRemaining:blocks}],
 leaders:withLeader?[{id:'lead_b',side:'B',col:5,row:4}]:[],terrain:[]});
const preview=(blocks=3,hits=1,flags=1,leader=false)=>canonical({
 unitType:'HEAVY_INFANTRY',blocksRemaining:blocks,diceCount:Math.max(1,hits+flags),
 matchingColorHits:hits,flagsPending:flags,leaderAttached:leader
});
const request=(b=board(),p=preview())=>({board:b,targetId:'b1',preview:p});
const error=x=>assert.throws(()=>apply(x),/INVALID_LAB_DIRECT_HIT_EFFECT/);

test('one hit changes only the cloned target block count',()=>{
 const original=board(),out=apply(request(original));
 assert.equal(out.board.units[1].blocksRemaining,2);
 assert.equal(original.units[1].blocksRemaining,3);
 assert.deepEqual(out.board.units[0],original.units[0]);
 assert.equal(out.summary.blocksRemoved,1);
 assert.equal(out.summary.nextRequiredStep,'DEFENDER_MORALE_CHOICE');
});
test('last block removes unit while preserving the terrain and unrelated units',()=>{
 const original=board(1),out=apply(request(original,preview(1,1,1)));
 assert.deepEqual(out.board.units.map(u=>u.id),['a1']);
 assert.equal(original.units.length,2);
 assert.equal(out.summary.unitEliminated,true);
 assert.equal(out.summary.flagsPending,0);
 assert.equal(out.summary.nextRequiredStep,'AUTHORITATIVE_FINALIZATION');
});
test('unit eliminated with leader keeps leader in original hex for later check',()=>{
 const original=board(1,true),out=apply(request(original,preview(1,1,1,true)));
 assert.equal(out.board.units.length,1);
 assert.deepEqual(out.board.leaders,original.leaders);
 assert.equal(out.summary.leaderCheckRequired,true);
 assert.equal(out.summary.nextRequiredStep,'LEADER_CASUALTY_CHECK');
});
test('leader on surviving damaged target calls casualty check before morale',()=>{
 const out=apply(request(board(3,true),preview(3,1,1,true)));
 assert.equal(out.board.units[1].blocksRemaining,2);
 assert.equal(out.summary.nextRequiredStep,'LEADER_CASUALTY_CHECK');
});
test('zero-hit flag-only result preserves board and goes to morale',()=>{
 const original=board(),out=apply(request(original,preview(3,0,1)));
 assert.deepEqual(out.board,original);assert.equal(out.summary.blocksRemoved,0);
 assert.equal(out.summary.nextRequiredStep,'DEFENDER_MORALE_CHOICE');
});
test('no hits or flags routes only to non-authorized finalization',()=>{
 const out=apply(request(board(),preview(3,0,0)));
 assert.equal(out.summary.nextRequiredStep,'AUTHORITATIVE_FINALIZATION');
 assert.equal(out.attackAuthorized,false);assert.equal(out.combatResolved,false);
});
test('surplus hits do not remove more blocks or alter other unit',()=>{
 const out=apply(request(board(1),preview(1,2,0)));
 assert.equal(out.summary.blocksRemoved,1);assert.equal(out.board.units.length,1);
});
test('reject target blocks changed since dice were staged',()=>{
 error(request(board(2),preview(3,1,1)));
});
test('reject fabricated preview totals and staged effects already applied',()=>{
 const p=preview();for(const bad of [{blocksToRemove:2},{remainingBlocks:0},
 {unitWouldBeEliminated:true},{flagsResolved:true},{attackAuthorized:true},
 {bannerAwarded:true},{hitsApplied:true},{combatResolved:true},
 {leaderChecksResolved:true},{effectiveFlagsPending:0},{excessHits:3}])
 error(request(board(),{...p,...bad}));
});
test('reject optional or forged leader attachment',()=>{
 error(request(board(),preview(3,1,1,true)));
 error(request(board(3,true),preview(3,1,1,false)));
});
test('reject incomplete leader casualty check when attached unit is damaged',()=>{
 const p=preview(3,1,1,true);
 error(request(board(3,true),{...p,leaderCasualtyCheck:null}));
 error(request(board(3,true),{...p,leaderCasualtyCheck:{diceCount:1,completed:false}}));
});
test('reject duplicate units, overlapping hexes, duplicate leaders',()=>{
 const b=board();b.units.push({...b.units[0]});error(request(b));
 const c=board();c.units[0].col=5;c.units[0].row=4;error(request(c));
 const d=board(3,true);d.leaders.push({...d.leaders[0]});
 error(request(d,preview(3,1,1,true)));
});
test('reject same-hex enemy leader and inconsistent leader side',()=>{
 const b=board(3,true);b.leaders[0].side='A';error(request(b,preview(3,1,1,true)));
});
test('reject absent and unsupported target or malformed board',()=>{
 error({...request(),targetId:'missing'});error({...request(),targetId:'../../'});
 error({board:{units:[],leaders:[]},targetId:'b1',preview:preview()});
 error({...request(),board:null});
});
test('outcome is never an authorization and never awards a victory banner',()=>{
 const out=apply(request(board(1),preview(1,1,1)));
 for(const k of ['attackAuthorized','combatResolved','bannerAwarded','flagsResolved','leaderChecksResolved'])
 assert.equal(out[k],false);
 assert.equal(out.labOnly,true);assert.equal(Object.isFrozen(out.summary),true);
});
test('reject forged flags, max blocks and missing canonical post-dice fields',()=>{
 const p=preview();
 for(const change of [{maxBlocks:32},{possibleVictoryBanner:1},
 {flagsNoLongerApplicable:1},{leaderCasualtyCheck:{diceCount:2}},
 {needsFullLegalityCheck:false},{diceCount:1},{matchingColorHits:2}])
 error(request(board(),{...p,...change}));
});
test('pure effect rejects unsupported type even if the preview claims a valid loss',()=>{
 const b=board();b.units[1].type='FAKE_TYPE';
 error(request(b));
});
