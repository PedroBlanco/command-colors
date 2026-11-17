/**
 * Server-owned PUBLIC annotations for a synthetic teaching scenario.
 * They are not the official Ancients setup, nor rules that authorize a
 * move or attack. Existing stored matches lack this optional metadata.
 */
import {BASE_MOVEMENT_PROFILES} from '../ancients-rules/movement-profile.mjs';
import {BASE_TERRAIN_TYPES} from '../ancients-rules/terrain-movement.mjs';
import {inBounds} from '../hex-grid/hex.mjs';

export const TRAINING_REFERENCE_KIND='SYNTHETIC_ANCIENTS_TRAINING_V1';
const TYPES=new Set(Object.keys(BASE_MOVEMENT_PROFILES));
const TERRAINS=new Set(BASE_TERRAIN_TYPES);
const UNIT_ID=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const coord=x=>x&&Number.isSafeInteger(x.col)&&Number.isSafeInteger(x.row)&&inBounds(x);
const key=x=>x.col+','+x.row;
const fail=()=>{throw new TypeError('INVALID_TRAINING_REFERENCE')};

/** One fixed exercise, independently of identities and HTTP arguments. */
export function createTrainingReference(board){
  if(!Array.isArray(board)||board.length!==2||
    !board.some(u=>u?.id==='synthetic-a'&&u.side==='A')||
    !board.some(u=>u?.id==='synthetic-b'&&u.side==='B'))fail();
  return {
    kind:TRAINING_REFERENCE_KIND,
    unitTypes:{'synthetic-a':'LIGHT_BOW_INFANTRY','synthetic-b':'MEDIUM_INFANTRY'},
    terrain:[
      {col:5,row:4,kind:'FOREST'},
      {col:7,row:3,kind:'HILL'},
      {col:8,row:4,kind:'BROKEN_GROUND'}
    ]
  };
}

/**
 * Reject corrupt metadata before disclosing it. Only public type/terrain
 * keys are projected. A missing field means a legacy match: no fabricated
 * profiles or implicit clear terrain.
 */
export function projectTrainingReference(state){
  if(!state||typeof state!=='object'||Array.isArray(state))fail();
  if(!Object.hasOwn(state,'trainingReference'))return null;
  const ref=state.trainingReference,board=state.board;
  if(!ref||ref.kind!==TRAINING_REFERENCE_KIND||
    !Array.isArray(board)||board.length<1||board.length>117||
    !ref.unitTypes||typeof ref.unitTypes!=='object'||Array.isArray(ref.unitTypes)||
    !Array.isArray(ref.terrain)||ref.terrain.length>117)fail();
  const types=Object.create(null);
  const ids=new Set();
  for(const unit of board){
    if(!unit||!UNIT_ID.test(unit.id)||!['A','B'].includes(unit.side)||
       !coord(unit)||ids.has(unit.id))fail();
    ids.add(unit.id);
    const t=Object.getOwnPropertyDescriptor(ref.unitTypes,unit.id);
    if(!t||!Object.hasOwn(t,'value')||!TYPES.has(t.value))fail();
    types[unit.id]=t.value;
  }
  // Removed units may leave an inert original annotation; never disclose
  // unknown identifiers or new, unauthorized metadata keys.
  for(const id of Object.keys(ref.unitTypes))
    if(!UNIT_ID.test(id)||!TYPES.has(ref.unitTypes[id]))fail();
  const terrain=[],cells=new Set();
  for(const tile of ref.terrain){
    if(!coord(tile)||!TERRAINS.has(tile.kind)||cells.has(key(tile)))fail();
    cells.add(key(tile));
    terrain.push({col:tile.col,row:tile.row,kind:tile.kind});
  }
  return {kind:TRAINING_REFERENCE_KIND,unitTypes:{...types},terrain};
}
