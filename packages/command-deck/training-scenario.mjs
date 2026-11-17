/**
 * Canonical SERVER-ONLY source for the non-official Ancients teaching setup.
 * This parser reads the versioned fixture: no HTTP-provided scenario IDs,
 * unit types, deck sizes or terrain can change a live match.
 * Compilation does not grant movement, combat or victory authorization.
 */
import source from '../../scenarios/demo-synthetic.json' with {type:'json'};
import cavalrySource from '../../scenarios/training-cavalry-synthetic.json' with {type:'json'};
import {BOARD_COLUMNS,BOARD_ROWS,inBounds} from '../hex-grid/hex.mjs';
import {ANCIENTS_RULESET,BASE_MOVEMENT_PROFILES} from '../ancients-rules/movement-profile.mjs';
import {BASE_TERRAIN_TYPES} from '../ancients-rules/terrain-movement.mjs';

export const DEFAULT_TRAINING_SCENARIO_ID='test-synthetic-001';
export const NEW_MATCH_TRAINING_SCENARIO_ID='test-synthetic-cavalry-002';
// Keep the old default lookup for callers and persisted fixtures. Only newly
// created SQLite matches explicitly select the new, independently versioned
// exercise; this avoids silently rewriting older scenario definitions.
const FAIL=()=>{throw new TypeError('INVALID_SYNTHETIC_SCENARIO')};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,fields)=>plain(x)&&Reflect.ownKeys(x).length===fields.length&&
  fields.every(name=>{
    const field=Object.getOwnPropertyDescriptor(x,name);
    return field?.enumerable===true&&Object.hasOwn(field,'value');
  });
const sequence=(xs,min,max)=>Array.isArray(xs)&&
  Object.getPrototypeOf(xs)===Array.prototype&&
  xs.length>=min&&xs.length<=max&&Reflect.ownKeys(xs).length===xs.length+1;
const validCell=x=>exact(x,['col','row'])&&
  Number.isSafeInteger(x.col)&&Number.isSafeInteger(x.row)&&inBounds(x);
const key=({col,row})=>col+','+row;
const validId=x=>typeof x==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(x);

/**
 * Validate an arbitrary *synthetic* JSON specification into detached values.
 * It is a reusable schema for later internal fixtures, not an API for
 * uploading or selecting untrusted third-party scenarios.
 */
export function compileTrainingScenario(spec){
  if(!exact(spec,['schemaVersion','id','game','kind','title','rulesetVersion',
      'board','startingSide','handSizes','units','terrain','victory','warning'])||
      spec.schemaVersion!==1||
      typeof spec.id!=='string'||!/^[a-z][a-z0-9-]{2,63}$/.test(spec.id)||
      spec.game!=='ancients'||spec.kind!=='synthetic-training-only'||
      typeof spec.title!=='string'||spec.title.length<3||spec.title.length>120||
      spec.rulesetVersion!==ANCIENTS_RULESET||
      !exact(spec.board,['columns','rows'])||
      spec.board.columns!==BOARD_COLUMNS||spec.board.rows!==BOARD_ROWS||
      !['A','B'].includes(spec.startingSide)||
      !exact(spec.handSizes,['A','B'])||
      !Number.isSafeInteger(spec.handSizes.A)||
      !Number.isSafeInteger(spec.handSizes.B)||
      spec.handSizes.A<1||spec.handSizes.B<1||
      spec.handSizes.A+spec.handSizes.B>18||
      !sequence(spec.units,2,117)||!sequence(spec.terrain,0,117)||
      !exact(spec.victory,['kind','banners'])||
      spec.victory.kind!=='illustrative-only'||
      !Number.isSafeInteger(spec.victory.banners)||
      spec.victory.banners<1||spec.victory.banners>20||
      typeof spec.warning!=='string'||spec.warning.length<20||
      spec.warning.length>300)FAIL();
  const ids=new Set(),positions=new Set(),sides=new Set(),units=[];
  for(const u of spec.units){
    if(!exact(u,['id','side','unitType','hex'])||
        !validId(u.id)||!['A','B'].includes(u.side)||
        !Object.hasOwn(BASE_MOVEMENT_PROFILES,u.unitType)||
        !validCell(u.hex)||ids.has(u.id)||positions.has(key(u.hex)))FAIL();
    ids.add(u.id);sides.add(u.side);positions.add(key(u.hex));
    units.push(Object.freeze({
      id:u.id,side:u.side,unitType:u.unitType,col:u.hex.col,row:u.hex.row
    }));
  }
  if(sides.size!==2)FAIL();
  const terrain=[],terrainCells=new Set();
  for(const tile of spec.terrain){
    if(!exact(tile,['col','row','kind'])||
        !Number.isSafeInteger(tile.col)||!Number.isSafeInteger(tile.row)||
        !inBounds(tile)||!BASE_TERRAIN_TYPES.includes(tile.kind)||
        terrainCells.has(key(tile)))FAIL();
    terrainCells.add(key(tile));
    terrain.push(Object.freeze({col:tile.col,row:tile.row,kind:tile.kind}));
  }
  return Object.freeze({
    id:spec.id,kind:spec.kind,title:spec.title,
    rulesetVersion:spec.rulesetVersion,official:false,
    startingSide:spec.startingSide,
    handSizes:Object.freeze({...spec.handSizes}),
    board:Object.freeze({columns:BOARD_COLUMNS,rows:BOARD_ROWS}),
    units:Object.freeze(units),terrain:Object.freeze(terrain),
    victory:Object.freeze({kind:'illustrative-only',
      banners:spec.victory.banners,implemented:false}),
    warning:spec.warning
  });
}

/** Fixed server allowlist, never a client-specified scenario pathname. */
export function getTrainingScenario(id=DEFAULT_TRAINING_SCENARIO_ID){
  const fixture=id===DEFAULT_TRAINING_SCENARIO_ID?source:
    id===NEW_MATCH_TRAINING_SCENARIO_ID?cavalrySource:null;
  if(fixture===null)FAIL();
  const scenario=compileTrainingScenario(fixture);
  if(scenario.id!==id)FAIL(); // reject catalog-to-file ID drift
  return scenario;
}
