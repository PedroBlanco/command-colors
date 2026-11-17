/**
 * Public annotations of an INTERNAL, synthetic training scenario.
 * Types and terrain originate from server-owned data, never browser commands.
 * Old snapshots without a scenario ID remain readable and unannotated.
 */
import {BASE_MOVEMENT_PROFILES} from '../ancients-rules/movement-profile.mjs';
import {BASE_TERRAIN_TYPES} from '../ancients-rules/terrain-movement.mjs';
import {getTrainingScenario,DEFAULT_TRAINING_SCENARIO_ID} from './training-scenario.mjs';
import {inBounds} from '../hex-grid/hex.mjs';

export const TRAINING_REFERENCE_KIND='SYNTHETIC_ANCIENTS_TRAINING_V1';
const TYPES=new Set(Object.keys(BASE_MOVEMENT_PROFILES));
const TERRAINS=new Set(BASE_TERRAIN_TYPES);
const UNIT_ID=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const coord=x=>x&&Number.isSafeInteger(x.col)&&Number.isSafeInteger(x.row)&&inBounds(x);
const key=x=>x.col+','+x.row;
const fail=()=>{throw new TypeError('INVALID_TRAINING_REFERENCE')};

/** Derive all public annotations from the compiled server fixture. */
export function createTrainingReference(board,scenarioId=DEFAULT_TRAINING_SCENARIO_ID){
  const scenario=getTrainingScenario(scenarioId);
  if(!Array.isArray(board)||board.length!==scenario.units.length)fail();
  const matching=new Map(scenario.units.map(u=>[u.id,u]));
  const seen=new Set(),positions=new Set();
  for(const unit of board){
    const source=matching.get(unit?.id);
    if(!source||unit.side!==source.side||!coord(unit)||
       seen.has(unit.id)||positions.has(key(unit)))fail();
    seen.add(unit.id);positions.add(key(unit));
  }
  return {
    kind:TRAINING_REFERENCE_KIND,
    scenarioId:scenario.id,
    unitTypes:Object.fromEntries(scenario.units.map(u=>[u.id,u.unitType])),
    terrain:scenario.terrain.map(({col,row,kind})=>({col,row,kind}))
  };
}

/**
 * Fail closed if stored public annotations do not match the authenticated
 * board. For newly versioned scenarios, also validate immutable provenance;
 * legacy trainingReference fields without scenarioId are supported as-is.
 */
export function projectTrainingReference(state){
  if(!state||typeof state!=='object'||Array.isArray(state))fail();
  if(!Object.hasOwn(state,'trainingReference'))return null;
  const ref=state.trainingReference,board=state.board;
  if(!ref||ref.kind!==TRAINING_REFERENCE_KIND||
    !Array.isArray(board)||board.length<1||board.length>117||
    !ref.unitTypes||typeof ref.unitTypes!=='object'||Array.isArray(ref.unitTypes)||
    !Array.isArray(ref.terrain)||ref.terrain.length>117)fail();
  const scenario=Object.hasOwn(ref,'scenarioId')?getTrainingScenario(ref.scenarioId):null;
  const sourceUnits=scenario?new Map(scenario.units.map(u=>[u.id,u])):null;
  const types=Object.create(null);
  const ids=new Set();
  for(const unit of board){
    if(!unit||!UNIT_ID.test(unit.id)||!['A','B'].includes(unit.side)||
       !coord(unit)||ids.has(unit.id))fail();
    ids.add(unit.id);
    const t=Object.getOwnPropertyDescriptor(ref.unitTypes,unit.id);
    if(!t||!Object.hasOwn(t,'value')||!TYPES.has(t.value))fail();
    if(scenario&&(!sourceUnits.has(unit.id)||
       sourceUnits.get(unit.id).side!==unit.side||
       sourceUnits.get(unit.id).unitType!==t.value))fail();
    types[unit.id]=t.value;
  }
  const typeIds=Object.keys(ref.unitTypes);
  if(typeIds.length>117)fail();
  for(const id of typeIds){
    if(!UNIT_ID.test(id)||!TYPES.has(ref.unitTypes[id])||
       scenario&&(!sourceUnits.has(id)||sourceUnits.get(id).unitType!==ref.unitTypes[id]))
      fail();
  }
  const terrain=[],cells=new Set();
  const originalTerrain=scenario?new Map(scenario.terrain.map(t=>[key(t),t.kind])):null;
  for(const tile of ref.terrain){
    if(!coord(tile)||!TERRAINS.has(tile.kind)||cells.has(key(tile)))fail();
    if(scenario&&originalTerrain.get(key(tile))!==tile.kind)fail();
    cells.add(key(tile));
    terrain.push({col:tile.col,row:tile.row,kind:tile.kind});
  }
  if(scenario&&(cells.size!==originalTerrain.size||
    typeIds.length!==sourceUnits.size))fail();
  return {
    kind:TRAINING_REFERENCE_KIND,
    ...(scenario?{
      scenario:{
        id:scenario.id,title:scenario.title,kind:scenario.kind,
        rulesetVersion:scenario.rulesetVersion,official:false,
        victory:{...scenario.victory},warning:scenario.warning
      }
    }:{}),
    unitTypes:{...types},terrain
  };
}
