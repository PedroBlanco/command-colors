import test from 'node:test';
import assert from 'node:assert/strict';
import source from '../../scenarios/demo-synthetic.json' with {type:'json'};
import {getTrainingScenario,compileTrainingScenario} from './training-scenario.mjs';

test('scenario fixture drives the server setup without activating victory',()=>{
 const s=getTrainingScenario();
 assert.deepEqual(s.handSizes,{A:2,B:3});
 assert.equal(s.units.length,2);
 assert.equal(s.official,false);
 assert.equal(s.victory.implemented,false);
 assert.ok(Object.isFrozen(s.units));
 assert.throws(()=>getTrainingScenario('untrusted'),/INVALID_SYNTHETIC_SCENARIO/);
});

test('scenario compiler rejects overlapping deployment and unknown troops',()=>{
 const s=structuredClone(source);
 s.units[1].hex={...s.units[0].hex};
 assert.throws(()=>compileTrainingScenario(s),/INVALID_SYNTHETIC_SCENARIO/);
 s.units[1].hex={col:9,row:2};
 s.units[1].unitType='UNKNOWN_TROOP';
 assert.throws(()=>compileTrainingScenario(s),/INVALID_SYNTHETIC_SCENARIO/);
});
