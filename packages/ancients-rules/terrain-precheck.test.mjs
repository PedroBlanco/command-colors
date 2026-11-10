import test from 'node:test';
import assert from 'node:assert/strict';
import {precheckAncientsTerrainMovement as move, assessAncientsTerrainDiceCap as cap} from './terrain-precheck.mjs';

const a = {id:'a',side:'A',type:'LIGHT_INFANTRY',col:4,row:4};
const b = {id:'b',side:'B',type:'MEDIUM_INFANTRY',col:9,row:4};
const at=(col,row)=>({col,row});
const tile=(col,row,kind)=>({col,row,kind});
function check(path,kind,unitType='LIGHT_INFANTRY',extra={}){
  return move({units:[{...a,type:unitType},b],unitId:'a',path,
    terrain:kind ? [tile(path.at(-1).col,path.at(-1).row,kind)] : [], ...extra});
}
const battle=(attackerType,attackerTerrain,targetTerrain,attackKind='CLOSE') =>
  cap({attackerType,attackerTerrain,targetTerrain,attackKind});

test('clear path is only a candidate and never authorized',()=>{
  const r=check([at(5,4)],null);
  assert.equal(r.status,'CANDIDATE');assert.equal(r.entryTerrain,'CLEAR');
  assert.equal(r.battle,'POSSIBLE');assert.equal(r.needsFullLegalityCheck,true);
  assert.equal(Object.isFrozen(r),true);
});

test('forest forces every unit to stop when it enters',()=>{
  for(const type of ['LIGHT_INFANTRY','MEDIUM_INFANTRY','HEAVY_CAVALRY','ELEPHANT','HEAVY_WAR_MACHINE']){
    const r=check([at(5,4),at(6,4)],null,type,{terrain:[tile(5,4,'FOREST')]});
    assert.equal(r.status,'BLOCKED');assert.equal(r.reason,'MUST_STOP_ON_ENTERING_FOREST');
    assert.equal(r.step,0);
  }
});

test('forest arrival allows ordinary combat only for five foot types',()=>{
  for(const type of ['LIGHT_INFANTRY','LIGHT_SLING_INFANTRY','LIGHT_BOW_INFANTRY',
    'AUXILIA_INFANTRY','WARRIOR_INFANTRY']){
    const r=check([at(5,4)],'FOREST',type);
    assert.equal(r.status,'CANDIDATE');assert.equal(r.battle,'POSSIBLE');
  }
  for(const type of ['MEDIUM_INFANTRY','HEAVY_INFANTRY','HEAVY_WAR_MACHINE',
    'LIGHT_CAVALRY','MEDIUM_CAVALRY','HEAVY_CAVALRY','ELEPHANT','HEAVY_CHARIOT']){
    const r=check([at(5,4)],'FOREST',type);
    assert.equal(r.status,'CANDIDATE');assert.equal(r.battle,'UNAVAILABLE');
  }
});

test('forest exception cannot restore battle lost by two-step auxilia movement',()=>{
  const r=check([at(5,4),at(6,4)],'FOREST','AUXILIA_INFANTRY');
  assert.equal(r.status,'CANDIDATE');assert.equal(r.battle,'UNAVAILABLE');
});

test('mounted units must stop after entering broken ground',()=>{
  for(const type of ['LIGHT_CAVALRY','MEDIUM_CAVALRY','HEAVY_CAVALRY','ELEPHANT','HEAVY_CHARIOT']){
    const r=check([at(5,4),at(6,4)],null,type,{terrain:[tile(5,4,'BROKEN_GROUND')]});
    assert.equal(r.status,'BLOCKED');assert.equal(r.reason,'MOUNTED_MUST_STOP_ON_BROKEN_GROUND');
    assert.equal(r.step,0);
  }
});

test('mounted units lose ordinary battle after entering broken ground',()=>{
  for(const type of ['LIGHT_CAVALRY','MEDIUM_CAVALRY','HEAVY_CAVALRY','ELEPHANT','HEAVY_CHARIOT']){
    const r=check([at(5,4)],'BROKEN_GROUND',type);
    assert.equal(r.status,'CANDIDATE');assert.equal(r.battle,'UNAVAILABLE');
  }
});

test('light, medium and heavy infantry can move through broken ground',()=>{
  for(const type of ['LIGHT_INFANTRY','AUXILIA_INFANTRY']){
    const r=check([at(5,4),at(6,4)],null,type,{terrain:[tile(5,4,'BROKEN_GROUND')]});
    assert.equal(r.status,'CANDIDATE');
  }
  for(const type of ['MEDIUM_INFANTRY','HEAVY_INFANTRY']){
    const r=check([at(5,4)],'BROKEN_GROUND',type);
    assert.equal(r.status,'CANDIDATE');assert.equal(r.battle,'POSSIBLE');
  }
});

test('heavy war machine cannot enter broken ground',()=>{
  const r=check([at(5,4)],'BROKEN_GROUND','HEAVY_WAR_MACHINE');
  assert.equal(r.status,'BLOCKED');assert.equal(r.reason,'WAR_MACHINE_CANNOT_ENTER_BROKEN_GROUND');
});

test('hills do not restrict movement or combat on entry',()=>{
  for(const type of ['LIGHT_INFANTRY','LIGHT_CAVALRY','ELEPHANT','HEAVY_CHARIOT']){
    const r=check([at(5,4)],'HILL',type);
    assert.equal(r.status,'CANDIDATE');assert.equal(r.battle,'POSSIBLE');
  }
  const r=check([at(5,4),at(6,4)],null,'LIGHT_CAVALRY',{terrain:[tile(5,4,'HILL')]});
  assert.equal(r.status,'CANDIDATE');
});

test('source forest does not stop the unit from moving out',()=>{
  const r=check([at(5,4)],null,'MEDIUM_INFANTRY',{terrain:[tile(4,4,'FOREST')]});
  assert.equal(r.status,'CANDIDATE');assert.equal(r.battle,'POSSIBLE');
});

test('terrain checker preserves geometric and occupancy blockers',()=>{
  const r=check([at(6,4)],'HILL');
  assert.equal(r.status,'BLOCKED');assert.equal(r.reason,'NON_ADJACENT_HEX');
  const o=check([at(5,4)],'FOREST','LIGHT_INFANTRY',{units:[a,b,
    {id:'x',side:'A',type:'HEAVY_INFANTRY',col:5,row:4}]});
  assert.equal(o.status,'BLOCKED');assert.equal(o.reason,'OCCUPIED_HEX');
});

test('terrain constraints do not grant a card exception to exceeding max steps',()=>{
  const r=check([at(5,4),at(6,4),at(7,4)],'HILL','LIGHT_INFANTRY');
  assert.equal(r.status,'REQUIRES_RULE_EXCEPTION');
  assert.equal(r.battle,'REQUIRES_RULE_EXCEPTION');
  assert.equal(r.needsFullLegalityCheck,true);
});

test('terrain blockers remain blockers even on a profile-exceeding path',()=>{
  const r=check([at(5,4),at(6,4),at(7,4)],null,'LIGHT_INFANTRY',
    {terrain:[tile(5,4,'FOREST')]});
  assert.equal(r.status,'BLOCKED');assert.equal(r.reason,'MUST_STOP_ON_ENTERING_FOREST');
});

test('warrior two-step charge entering forest retains combat requirement',()=>{
  const units=[{...a,type:'WARRIOR_INFANTRY'},b,
    {id:'target',side:'B',type:'HEAVY_INFANTRY',col:7,row:4}];
  const r=check([at(5,4),at(6,4)],'FOREST','WARRIOR_INFANTRY',{units});
  assert.equal(r.status,'CANDIDATE');
  assert.equal(r.battle,'MANDATORY_CLOSE_COMBAT');
  assert.equal(r.requiresMandatoryCloseCombat,true);
});

test('invalid or unsupported terrain does not silently become clear',()=>{
  for (const terrain of [undefined,null,[tile(5,4,'MARSH')],[tile(13,4,'FOREST')],
    [tile(5,4,'FOREST'),tile(5,4,'HILL')],{},new Array(118).fill(tile(5,4,'CLEAR'))]){
    assert.throws(()=>check([at(5,4)],null,'LIGHT_INFANTRY',{terrain}),
      /INVALID_TERRAIN_BOARD|UNSUPPORTED_OR_INVALID_TERRAIN|DUPLICATE_TERRAIN_HEX/);
  }
});

test('valid explicit clear tile does not restrict entry',()=>{
  const r=check([at(5,4)],null,'HEAVY_CAVALRY',{terrain:[tile(5,4,'CLEAR')]});
  assert.equal(r.status,'CANDIDATE');assert.equal(r.battle,'POSSIBLE');
});

test('forest or broken ground caps close-combat dice to two from either side',()=>{
  for(const t of ['FOREST','BROKEN_GROUND']){
    assert.equal(battle('HEAVY_INFANTRY','CLEAR',t).maxDice,2);
    assert.equal(battle('HEAVY_INFANTRY',t,'CLEAR').maxDice,2);
  }
});

test('forest target caps ranged fire to one but forest attacker alone does not',()=>{
  assert.equal(battle('LIGHT_BOW_INFANTRY','CLEAR','FOREST','RANGED').maxDice,1);
  assert.equal(battle('LIGHT_BOW_INFANTRY','FOREST','CLEAR','RANGED').maxDice,null);
  assert.equal(battle('LIGHT_BOW_INFANTRY','BROKEN_GROUND','BROKEN_GROUND','RANGED').maxDice,null);
});

test('uphill close combat caps all units at two dice',()=>{
  for(const type of ['LIGHT_INFANTRY','HEAVY_WAR_MACHINE','LIGHT_CAVALRY','ELEPHANT']){
    assert.equal(battle(type,'CLEAR','HILL').maxDice,2);
  }
});

test('downhill and hill-to-hill close combat caps foot at three, mounted at two',()=>{
  for(const target of ['CLEAR','HILL']){
    assert.equal(battle('HEAVY_INFANTRY','HILL',target).maxDice,3);
    assert.equal(battle('LIGHT_CAVALRY','HILL',target).maxDice,2);
    assert.equal(battle('ELEPHANT','HILL',target).maxDice,2);
  }
});

test('combined rough/wood and hill effects keep tighter combat cap',()=>{
  assert.equal(battle('HEAVY_INFANTRY','HILL','FOREST').maxDice,2);
  assert.equal(battle('HEAVY_INFANTRY','BROKEN_GROUND','HILL').maxDice,2);
  assert.equal(battle('HEAVY_INFANTRY','HILL','BROKEN_GROUND').maxDice,2);
});

test('no relevant terrain yields no imposed dice cap',()=>{
  assert.equal(battle('LIGHT_CAVALRY','CLEAR','CLEAR').maxDice,null);
  assert.equal(battle('LIGHT_CAVALRY','HILL','CLEAR','RANGED').maxDice,null);
});

test('dice limits remain advisory without LOS or card validation',()=>{
  const r=battle('LIGHT_BOW_INFANTRY','CLEAR','FOREST','RANGED');
  assert.equal(r.needsFullLegalityCheck,true);
  assert.equal(r.lineOfSightChecked,false);
  assert.equal(r.cardModifiersApplied,false);
  assert.equal(Object.isFrozen(r),true);
});

test('battle cap rejects unknown types and unsupported attack/terrain values',()=>{
  for(const attackerType of ['CAMEL','__proto__',null])
    assert.throws(()=>battle(attackerType,'CLEAR','CLEAR'),/UNSUPPORTED_BASE_UNIT_TYPE/);
  for(const [attackerTerrain,targetTerrain,attackKind] of [
    [null,'CLEAR','CLOSE'], ['CLEAR','MARSH','CLOSE'], ['CLEAR','CLEAR','MAGIC'],
    [undefined,'CLEAR','CLOSE'], ['HILL',undefined,'RANGED']])
    assert.throws(()=>battle('HEAVY_INFANTRY',attackerTerrain,targetTerrain,attackKind),/INVALID_TERRAIN_BATTLE/);
});
