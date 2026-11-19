import test from 'node:test';
import assert from 'node:assert/strict';
import {ANCIENTS_BATTLE_DIE_FACES, BASE_UNIT_DIE_SYMBOLS,
  captureBaseAncientsRangedDice as capture,
  interpretBaseAncientsRangedDice as interpret} from './battle-dice.mjs';
import {BASE_MOVEMENT_PROFILES, ANCIENTS_RULESET} from './movement-profile.mjs';

const base = (more={}) => ({rollId:'official_dice_1',actor:'A',diceCount:3,mode:'PHYSICAL',
  declaredFaces:['LIGHT','FLAG','SWORDS'],...more});
const result = (targetUnitType, faces=['LIGHT','MEDIUM','HEAVY','LEADER','FLAG','SWORDS']) =>
  interpret({roll:capture(base({diceCount:faces.length,declaredFaces:faces})),
    targetUnitType,expectedDiceCount:faces.length});

test('six official physical symbols occur exactly once in the authoritative die definition',()=>{
  assert.deepEqual([...ANCIENTS_BATTLE_DIE_FACES],['LIGHT','MEDIUM','HEAVY','LEADER','FLAG','SWORDS']);
  assert.equal(new Set(ANCIENTS_BATTLE_DIE_FACES).size,6);
  assert.equal(Object.isFrozen(ANCIENTS_BATTLE_DIE_FACES),true);
});

test('dice symbols cover all thirteen supported basic unit types without holes',()=>{
  assert.deepEqual(Object.keys(BASE_UNIT_DIE_SYMBOLS).sort(),Object.keys(BASE_MOVEMENT_PROFILES).sort());
  assert.equal(BASE_UNIT_DIE_SYMBOLS.AUXILIA_INFANTRY,'LIGHT');
  assert.equal(BASE_UNIT_DIE_SYMBOLS.WARRIOR_INFANTRY,'MEDIUM');
  assert.equal(BASE_UNIT_DIE_SYMBOLS.HEAVY_WAR_MACHINE,'HEAVY');
  assert.equal(BASE_UNIT_DIE_SYMBOLS.ELEPHANT,'HEAVY');
  assert.equal(BASE_UNIT_DIE_SYMBOLS.HEAVY_CHARIOT,'HEAVY');
});

test('ranged results: matching light, blue, red symbols hit and flags stay pending',()=>{
  for (const [unitType,colour] of [['LIGHT_BOW_INFANTRY','LIGHT'],['MEDIUM_INFANTRY','MEDIUM'],['HEAVY_CAVALRY','HEAVY']]){
    const r=result(unitType);
    assert.equal(r.targetSymbol,colour);assert.equal(r.matchingColorHits,1);
    assert.equal(r.flagsPending,1);assert.equal(r.misses,4);
    assert.equal(r.combatResolved,false);assert.equal(r.hitsApplied,false);
  }
});

test('white-bordered auxilia and warrior hit on their base colours',()=>{
  const aux=result('AUXILIA_INFANTRY',['LIGHT','MEDIUM','FLAG']);
  assert.deepEqual([aux.matchingColorHits,aux.flagsPending,aux.misses],[1,1,1]);
  const warrior=result('WARRIOR_INFANTRY',['LIGHT','MEDIUM','FLAG']);
  assert.deepEqual([warrior.matchingColorHits,warrior.flagsPending,warrior.misses],[1,1,1]);
  assert.equal(aux.dieEffects[0].outcome,'MATCHING_COLOR_HIT');
  assert.equal(warrior.dieEffects[1].outcome,'MATCHING_COLOR_HIT');
});

test('heavy chariot, elephant and heavy war machine match red symbols',()=>{
  for(const type of ['HEAVY_CHARIOT','ELEPHANT','HEAVY_WAR_MACHINE']){
    const r=result(type,['HEAVY','HEAVY','LIGHT']);
    assert.equal(r.matchingColorHits,2);assert.equal(r.misses,1);
  }
});

test('ranged swords and leader symbols cannot score hits on ordinary units',()=>{
  const r=result('HEAVY_INFANTRY',['SWORDS','LEADER','SWORDS','LEADER']);
  assert.equal(r.matchingColorHits,0);assert.equal(r.misses,4);assert.equal(r.flagsPending,0);
  assert.ok(r.dieEffects.every(d=>d.outcome==='NO_RANGED_EFFECT'));
});

test('several colour hits and flags are counted separately, not applied',()=>{
  const r=result('LIGHT_CAVALRY',['LIGHT','LIGHT','FLAG','FLAG','SWORDS','MEDIUM']);
  assert.equal(r.matchingColorHits,2);assert.equal(r.flagsPending,2);assert.equal(r.misses,2);
  assert.equal(r.hitsApplied,false);assert.equal(r.flagsResolved,false);
  assert.equal(r.leaderChecksResolved,false);assert.equal(r.boardMutated,false);
});

test('physical capture retains source and clearly marks declared faces unverified',()=>{
  const roll=capture(base());
  assert.equal(roll.type,'ANCIENTS_BASE_RANGED_DICE_CAPTURED');
  assert.equal(roll.ruleset,ANCIENTS_RULESET);
  assert.equal(roll.source,'PHYSICAL');assert.equal(roll.verification,'PLAYER_DECLARED');
  assert.deepEqual(roll.results,['LIGHT','FLAG','SWORDS']);
  assert.equal(roll.attackAuthorized,false);assert.equal(roll.combatResolved,false);
  assert.equal(Object.isFrozen(roll.results),true);
});

test('digital capture uses six equally probable slots and test injection reproduces results',()=>{
  const indices=[0,4,2,5,1,3];let n=0;
  const roll=capture({rollId:'official_dice_2',actor:'B',diceCount:6,mode:'DIGITAL',
    randomIndex:(limit)=>{assert.equal(limit,6);return indices[n++];}});
  assert.equal(n,6);assert.equal(roll.source,'DIGITAL');
  assert.equal(roll.verification,'SERVER_GENERATED');
  assert.deepEqual(roll.results,['LIGHT','FLAG','HEAVY','SWORDS','MEDIUM','LEADER']);
  const r=interpret({roll,targetUnitType:'HEAVY_INFANTRY',expectedDiceCount:6});
  assert.equal(r.matchingColorHits,1);assert.equal(r.flagsPending,1);
  assert.equal(r.rollSource,'DIGITAL');assert.equal(r.combatResolved,false);
});

test('default cryptographic source only returns official die faces',()=>{
  const roll=capture({rollId:'official_dice_3',actor:'A',diceCount:32,mode:'DIGITAL'});
  assert.equal(roll.results.length,32);
  assert.ok(roll.results.every(x=>ANCIENTS_BATTLE_DIE_FACES.includes(x)));
  assert.equal('seed' in roll,false);
});

test('invalid dice count, roll id, actor and unknown input symbols fail closed',()=>{
  for(const diceCount of [0,-1,1.3,33,undefined,Infinity])
    assert.throws(()=>capture(base({diceCount})),/INVALID_DICE_COUNT/);
  assert.throws(()=>capture(base({rollId:'../foo'})),/INVALID_ROLL_ID/);
  assert.throws(()=>capture(base({actor:'C'})),/INVALID_ROLL_ACTOR/);
  assert.throws(()=>capture(base({declaredFaces:['LIGHT','SWORDS','RED']})),/INVALID_PHYSICAL_DECLARATION/);
  assert.throws(()=>capture(base({declaredFaces:['LIGHT','FLAG']})),/INVALID_PHYSICAL_DECLARATION/);
  assert.throws(()=>capture(base({declaredFaces:'LIGHT,FLAG,SWORDS'})),/INVALID_PHYSICAL_DECLARATION/);
});

test('physical cannot inject randomness and digital cannot override outcomes',()=>{
  assert.throws(()=>capture(base({randomIndex:()=>0})),/PHYSICAL_CANNOT_INJECT_RANDOMNESS/);
  assert.throws(()=>capture(base({mode:'DIGITAL',randomIndex:()=>0})),/DIGITAL_CANNOT_DECLARE_FACES/);
  assert.throws(()=>capture(base({mode:'UNKNOWN'})),/INVALID_ANCIENTS_DICE_MODE/);
});

test('interpretation enforces expected server dice count and target unit taxonomy',()=>{
  const roll=capture(base());
  assert.throws(()=>interpret({roll,targetUnitType:'LEADER',expectedDiceCount:3}),/UNSUPPORTED_ANCIENTS_DICE_TARGET/);
  assert.throws(()=>interpret({roll,targetUnitType:'UNKNOWN',expectedDiceCount:3}),/UNSUPPORTED_ANCIENTS_DICE_TARGET/);
  assert.throws(()=>interpret({roll,targetUnitType:'LIGHT_INFANTRY',expectedDiceCount:2}),/INVALID_ANCIENTS_CAPTURED_ROLL/);
  assert.throws(()=>interpret({roll,targetUnitType:'LIGHT_INFANTRY',expectedDiceCount:0}),/INVALID_EXPECTED_DICE_COUNT/);
});

test('synthetic PR #65 rolls cannot be passed off as official results',()=>{
  const roll=capture(base());
  assert.throws(()=>interpret({roll:{...roll,type:'DICE_ROLLED_SYNTHETIC'},targetUnitType:'LIGHT_INFANTRY',expectedDiceCount:3}),/INVALID_ANCIENTS_CAPTURED_ROLL/);
  assert.throws(()=>interpret({roll:{...roll,results:['RED','BLUE','FLAG']},targetUnitType:'LIGHT_INFANTRY',expectedDiceCount:3}),/INVALID_ANCIENTS_CAPTURED_ROLL/);
  assert.throws(()=>interpret({roll:{...roll,verification:'SERVER_GENERATED'},targetUnitType:'LIGHT_INFANTRY',expectedDiceCount:3}),/INVALID_ANCIENTS_CAPTURED_ROLL/);
});

test('interpretation does not mutate caller inputs, board or the captured result',()=>{
  const roll=capture(base());const before=structuredClone(roll);
  const x=interpret({roll,targetUnitType:'LIGHT_INFANTRY',expectedDiceCount:3});
  assert.deepEqual(roll,before);assert.equal(Object.isFrozen(x),true);
  assert.equal(Object.isFrozen(x.dieEffects),true);assert.ok(x.dieEffects.every(Object.isFrozen));
  assert.equal('nextBoard' in x,false);assert.equal('events' in x,false);
});

test('all white-bordered and base-box target symbols preserve uniform interpretation',()=>{
  for(const type of Object.keys(BASE_UNIT_DIE_SYMBOLS)){
    const symbol=BASE_UNIT_DIE_SYMBOLS[type];
    const r=result(type,[symbol,'FLAG']);
    assert.equal(r.targetSymbol,symbol);assert.equal(r.matchingColorHits,1);
    assert.equal(r.flagsPending,1);assert.equal(r.combatResolved,false);
  }
});
