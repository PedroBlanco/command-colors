import test from 'node:test';
import assert from 'node:assert/strict';
import {getTrainingScenario,compileTrainingScenario} from './training-scenario.mjs';

test('server fixture compiles into a detached, immutable playable laboratory setup',()=>{
 const s=getTrainingScenario();
 assert.equal(s.id,'test-synthetic-001');
 assert.equal(s.official,false);
 assert.equal(s.units.length,2);
 assert.deepEqual(s.handSizes,{A:2,B:3});
 assert.equal(s.victory.implemented,false);
 assert.equal(s.units[0].id,'synthetic-a');
 assert.equal(s.terrain.length,3);
 assert.ok(Object.isFrozen(s.units));
 assert.throws(()=>getTrainingScenario('unknown'),/INVALID_SYNTHETIC_SCENARIO/);
});

test('synthetic scenario compiler refuses overlapping and unsupported deployments',()=>{
 const source={
  schemaVersion:1,id:'synthetic-example',game:'ancients',kind:'synthetic-training-only',
  title:'Minimal synthetic example',rulesetVersion:'ancients-base-3e-2009',
  board:{columns:13,rows:9},startingSide:'A',handSizes:{A:2,B:3},
  units:[{id:'a',side:'A',unitType:'LIGHT_INFANTRY',hex:{col:1,row:1}},
   {id:'b',side:'B',unitType:'HEAVY_INFANTRY',hex:{col:2,row:2}}],
  terrain:[],victory:{kind:'illustrative-only',banners:1},
  warning:'Training exercise only; no official rules are enforced.'
 };
 assert.equal(compileTrainingScenario(source).units.length,2);
 source.units[1].hex={col:1,row:1};
 assert.throws(()=>compileTrainingScenario(source),/INVALID_SYNTHETIC_SCENARIO/);
 source.units[1].hex={col:2,row:2};
 source.units[1].unitType='FAKE_EXPANSION';
 assert.throws(()=>compileTrainingScenario(source),/INVALID_SYNTHETIC_SCENARIO/);
});
