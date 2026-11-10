import test from 'node:test';
import assert from 'node:assert/strict';
import {createRangedDicePlan as build, classifyRangedDicePlan as classify,
  OFFICIAL_PREVIEW_DICE_PLAN, SYNTHETIC_DICE_PLAN, LAB_DIE_FACES} from './dice-plan.mjs';
import {ANCIENTS_BATTLE_DIE_FACES} from './battle-dice.mjs';

const input=(mode='OFFICIAL_PREVIEW',count=2)=>({mode,
  screening:{ranged:{diceAfterTerrain:count}},targetId:'target',
  board:{units:[{id:'target',type:'MEDIUM_INFANTRY',side:'B'}]}});

test('official plan uses exact six faces and gets its target type from trusted board',()=>{
  const x=build(input());assert.equal(x.schemaVersion,1);
  assert.equal(x.kind,OFFICIAL_PREVIEW_DICE_PLAN);
  assert.equal(x.targetUnitType,'MEDIUM_INFANTRY');
  assert.deepEqual(x.dieFaces,[...ANCIENTS_BATTLE_DIE_FACES]);
  assert.equal(classify(x),'OFFICIAL_PREVIEW');
  assert.equal(Object.isFrozen(x),true);assert.equal(Object.isFrozen(x.dieFaces),true);
});

test('versioned synthetic plan remains a distinct kind and distribution',()=>{
  const x=build(input('SYNTHETIC'));
  assert.equal(x.kind,SYNTHETIC_DICE_PLAN);
  assert.equal(classify(x),'SYNTHETIC');
  assert.deepEqual(x.dieFaces,[...LAB_DIE_FACES]);
  assert.notDeepEqual(x.dieFaces,[...ANCIENTS_BATTLE_DIE_FACES]);
});

test('unversioned legacy synthetic plan is recognized without upgrading it',()=>{
  const old={diceCount:2,dieFaces:[...LAB_DIE_FACES]};
  assert.equal(classify(old),'SYNTHETIC_LEGACY');
  assert.equal(classify({...old,schemaVersion:0}),null);
  assert.equal(classify({...old,kind:OFFICIAL_PREVIEW_DICE_PLAN}),null);
});

test('unknown plan versions and untrusted extra fields fail closed',()=>{
  const original=build(input());
  for(const altered of [
    {...original,schemaVersion:2},
    {...original,kind:'SYNTHETIC_RANGED_V1'},
    {...original,userSelected:true},
    {...original,ruleset:'synthetic-phases-v1'},
    {...original,dieFaces:['RED','BLUE','FLAG','RED']}
  ]) assert.equal(classify(altered),null);
});

test('official plan rejects forged/unsupported unit types and absent target',()=>{
  for(const type of ['UNSUPPORTED','LEADER',undefined])
    assert.equal(build({...input(),board:{units:[{id:'target',type}]}}),null);
  assert.equal(build({...input(),targetId:'missing'}),null);
  assert.equal(build({...input(),board:null}),null);
});

test('no eligible dice means no plan, rather than implicit zero-dice authorization',()=>{
  for(const count of [undefined,null,0,-1,33,1.5,NaN,Infinity]) {
    for(const mode of ['OFFICIAL_PREVIEW','SYNTHETIC']) {
      const request=input(mode);request.screening.ranged.diceAfterTerrain=count;
      assert.equal(build(request),null);
    }
  }
});

test('different target colour cannot be set by a fabricated screening result',()=>{
  const x=build({...input(),screening:{ranged:{diceAfterTerrain:1,targetUnitType:'HEAVY_INFANTRY'}}});
  assert.equal(x.targetUnitType,'MEDIUM_INFANTRY');assert.equal(x.diceCount,1);
});

test('classification rejects arrays, null and mismatched counts without throwing',()=>{
  for(const plan of [null,[],{},'OFFICIAL_PREVIEW',
    {diceCount:0,dieFaces:[...LAB_DIE_FACES]},
    {diceCount:2.2,dieFaces:[...LAB_DIE_FACES]},
    {diceCount:2,dieFaces:[...ANCIENTS_BATTLE_DIE_FACES]}])
    assert.equal(classify(plan),null);
});

test('invalid server-only mode cannot be coerced from arbitrary strings',()=>{
  for(const mode of [null,'OFFICIAL','official_preview','DIGITAL','PHYSICAL','SYNTHETIC_V0'])
    assert.throws(()=>build(input(mode)),/INVALID_LAB_DICE_MODE/);
});
