/**
 * Optional server-owned territorial objectives. Each objective has one
 * beneficiary, a group of hexes and a minimum number of friendly units.
 * Leaders alone do not count. CAPTURE is permanent; OCCUPY is temporary;
 * START_TURN_CAPTURE is permanent, checked when the beneficiary begins a turn.
 * No removal of terrain or scenario-specific card effects is implied.
 */
import {inBounds} from '../hex-grid/hex.mjs';
import {isImpassableHex} from './terrain-movement.mjs';

const key=c=>c.col+','+c.row;
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const idOK=x=>typeof x==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(x);
const cellOK=c=>record(c)&&Object.keys(c).length===2&&Number.isSafeInteger(c.col)&&Number.isSafeInteger(c.row)&&inBounds(c);
const modes=['CAPTURE','OCCUPY','START_TURN_CAPTURE'];
export function validScenarioObjectives(value,terrain){
  if(!record(value)||Object.keys(value).length!==2||!Array.isArray(value.rules)||value.rules.length<1||value.rules.length>117||
     !Array.isArray(value.claimed)||new Set(value.claimed).size!==value.claimed.length)return false;
  const ids=new Set();
  for(const o of value.rules){
    if(!record(o)||Object.keys(o).length!==6||!idOK(o.id)||ids.has(o.id)||!['A','B'].includes(o.side)||!modes.includes(o.mode)||
       !Number.isSafeInteger(o.banners)||o.banners<1||o.banners>117||
       !Array.isArray(o.cells)||!o.cells.length||o.cells.length>117||!o.cells.every(c=>cellOK(c)&&!isImpassableHex(terrain,c))||
       new Set(o.cells.map(key)).size!==o.cells.length||!Number.isSafeInteger(o.minUnits)||o.minUnits<1||o.minUnits>o.cells.length)return false;
    ids.add(o.id);
  }
  return value.claimed.every(id=>value.rules.some(o=>o.id===id&&o.mode!=='OCCUPY'));
}
function occupied(state,o){
  const cells=new Set(o.cells.map(key));
  return state.board.units.filter(u=>u.side===o.side&&cells.has(key(u))).length;
}
export function projectScenarioObjectives(state){
  const config=state.victoryObjectives;
  if(!config)return [];
  return config.rules.map(o=>{
    const count=occupied(state,o),claimed=config.claimed.includes(o.id);
    return {...structuredClone(o),occupied:count,claimed,
      // Immediate captures count on hypothetical winning combat prefixes too.
      active:claimed||(o.mode!=='START_TURN_CAPTURE'&&count>=o.minUnits)};
  });
}
export function scenarioObjectiveBanners(state){
  const banners={A:0,B:0};
  const config=state.victoryObjectives;
  if(config)for(const o of config.rules){
    if(config.claimed.includes(o.id)||(o.mode!=='START_TURN_CAPTURE'&&occupied(state,o)>=o.minUnits))banners[o.side]+=o.banners;
  }
  return banners;
}
export function claimScenarioObjectives(state,startTurn=false){
  if(!state.victoryObjectives)return [];
  const captured=[];
  for(const o of state.victoryObjectives.rules){
    if(o.mode==='OCCUPY'||state.victoryObjectives.claimed.includes(o.id))continue;
    if(o.mode==='START_TURN_CAPTURE'&&(!startTurn||state.turn!==o.side))continue;
    if(occupied(state,o)<o.minUnits)continue;
    state.victoryObjectives.claimed.push(o.id);captured.push(o.id);
  }
  return captured;
}
