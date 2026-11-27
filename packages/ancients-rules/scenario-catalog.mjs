/**
 * Server-owned scenario data and base-deck multiplicities (2009 rules §18).
 * No official scenario maps, card text or artwork are distributed.
 * Keep IDs immutable: an edited deployment must receive a new versioned ID.
 */
import {createAncientsLoopbackSetup} from './loopback-demo-setup.mjs';
import {initializeSectionHistoryLab} from './section-history-journal.mjs';
import {getBoardGeometry,LAB_BOARD_GEOMETRY,OFFICIAL_BOARD_GEOMETRY} from '../hex-grid/hex.mjs';

export const LAB_SCENARIO_GEOMETRY=LAB_BOARD_GEOMETRY;
export const BASE_DECK_ID='ancients-base-2009';
export const BASE_DECK_COUNTS=Object.freeze({
  ORDER_2_LEFT:3,ORDER_2_CENTER:4,ORDER_2_RIGHT:3,
  ORDER_3_LEFT:3,ORDER_3_CENTER:4,ORDER_3_RIGHT:3,
  ORDER_4_LEFT:1,ORDER_4_CENTER:1,ORDER_4_RIGHT:1,
  COORDINATED_ATTACK:2,OUT_FLANKED:2,
  ORDER_LIGHT_TROOPS:4,ORDER_MEDIUM_TROOPS:3,ORDER_HEAVY_TROOPS:2,ORDER_MOUNTED_TROOPS:1,
  LEADERSHIP_ANY_SECTION:3,INSPIRED_LEFT_LEADERSHIP:1,INSPIRED_CENTER_LEADERSHIP:1,INSPIRED_RIGHT_LEADERSHIP:1,
  CLASH_OF_SHIELDS:1,COUNTER_ATTACK:2,DARKEN_THE_SKY:1,DOUBLE_TIME:2,FIRST_STRIKE:1,I_AM_SPARTACUS:1,
  LINE_COMMAND:4,MOVE_FIRE_MOVE:2,MOUNTED_CHARGE:2,RALLY:1
});
export function createAncientsBaseDeck(){
  return Object.entries(BASE_DECK_COUNTS).flatMap(([definitionId,count])=>
    Array.from({length:count},(_,i)=>({definitionId,instanceId:'base_'+definitionId.toLowerCase()+'_'+(i+1)})));
}

// Original sample, not Akragas or another published historical deployment.
// Each unit tuple: ID, side, column, row, type. Zero-based canonical coordinates.
const OPEN_FIELD={
  id:'open-field-v1',title:'Encuentro en campo abierto',deckId:BASE_DECK_ID,
  startingSide:'B',handSizes:{A:4,B:5},victoryTargets:{A:5,B:5},
  units:[
    ['A1','A',2,6,'LIGHT_INFANTRY'],['A2','A',4,6,'MEDIUM_INFANTRY'],
    ['A3','A',5,6,'HEAVY_INFANTRY'],['A4','A',7,6,'AUXILIA_INFANTRY'],
    ['A5','A',8,6,'LIGHT_BOW_INFANTRY'],['A6','A',10,6,'MEDIUM_CAVALRY'],
    ['B1','B',2,2,'LIGHT_CAVALRY'],['B2','B',4,2,'WARRIOR_INFANTRY'],
    ['B3','B',5,2,'MEDIUM_INFANTRY'],['B4','B',7,2,'HEAVY_INFANTRY'],
    ['B5','B',8,2,'LIGHT_SLING_INFANTRY'],['B6','B',10,2,'AUXILIA_INFANTRY']
  ],
  leaders:[['AL','A',5,6],['BL','B',7,2]],
  terrain:[]
};

// Original objective-based variant; the published scenarios are separate data.
const CROSSROADS={...OPEN_FIELD,id:'crossroads-v1',title:'La encrucijada',
  terrain:[{col:6,row:4,kind:'HILL'},{col:5,row:6,kind:'FORTIFIED_CAMP'},{col:7,row:2,kind:'FORTIFIED_CAMP'}],
  objectives:[
    {id:'hill_a',side:'A',mode:'OCCUPY',cells:[{col:6,row:4}],minUnits:1,banners:1},
    {id:'hill_b',side:'B',mode:'OCCUPY',cells:[{col:6,row:4}],minUnits:1,banners:1},
    {id:'camp_b',side:'A',mode:'CAPTURE',cells:[{col:7,row:2}],minUnits:1,banners:2},
    {id:'camp_a',side:'B',mode:'CAPTURE',cells:[{col:5,row:6}],minUnits:1,banners:2}
  ]
};
const SCENARIOS=[OPEN_FIELD,CROSSROADS];

// Column 4 and 8 are shared in this original scenario. This is an explicit
// scenario mapping, not a claim that the printed board has been audited.
function sharedSectorCells(){
  return Object.fromEntries(Array.from({length:117},(_,i)=>{
    const col=Math.floor(i/9),row=i%9;
    return [col+','+row,col<4?['LEFT']:col===4?['LEFT','CENTER']:col<8?['CENTER']:col===8?['CENTER','RIGHT']:['RIGHT']];
  }));
}

const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,required,optional=[])=>record(x)&&required.every(k=>Object.hasOwn(x,k))&&Object.keys(x).every(k=>required.includes(k)||optional.includes(k));
const short=(x,max)=>typeof x==='string'&&x.length>0&&x.length<=max&&x.trim()===x;
const validId=x=>typeof x==='string'&&/^[a-z][a-z0-9-]{0,62}-v[1-9][0-9]*$/.test(x)&&x.length<=64;
const pair=x=>exact(x,['A','B']);
const unitKeys=['id','side','col','row'];
const fail=()=>{throw new Error('INVALID_SCENARIO_DOCUMENT');};

function scenarioSetup(s){
  const piece=([id,side,col,row])=>({id,side,col,row});
  return {
    ...createAncientsLoopbackSetup(),
    scenario:{id:s.id,title:s.title,deckId:s.deckId,
      ...(s.provenance?{geometry:s.geometry,provenance:structuredClone(s.provenance),factions:structuredClone(s.factions)}:{})},
    cardInstances:createAncientsBaseDeck(),startingSide:s.startingSide,
    handSizes:{...s.handSizes},victoryTargets:{...s.victoryTargets},
    board:{units:s.units.map(piece),leaders:s.leaders.map(piece)},
    movementUnitTypes:Object.fromEntries(s.units.map(([id,,,,type])=>[id,type])),
    movementTerrain:structuredClone(s.terrain),sectorCells:s.sectorCells?structuredClone(s.sectorCells):sharedSectorCells(),
    ...(s.objectives?{scenarioObjectives:structuredClone(s.objectives)}:{})
  };
}

// A portable, versioned data format, not a way of injecting arbitrary setup
// options. The engine is the final authority for geometry and supported rules.
export function importAncientsScenario(doc){
  if(!exact(doc,['schemaVersion','geometry','id','title','deckId','provenance','factions','startingSide','handSizes','victoryTargets','units','leaders','terrain','sectorCells'],['objectives'])||
     doc.schemaVersion!==1||!validId(doc.id)||!short(doc.title,120)||doc.deckId!==BASE_DECK_ID||
     !exact(doc.provenance,['kind','source'])||!['OFFICIAL','COMMUNITY','ORIGINAL'].includes(doc.provenance.kind)||!short(doc.provenance.source,500)||
     !pair(doc.factions)||!['A','B'].every(side=>short(doc.factions[side],80))||!['A','B'].includes(doc.startingSide)||
     !pair(doc.handSizes)||!pair(doc.victoryTargets)||!Array.isArray(doc.units)||doc.units.length<2||doc.units.length>117||
     !Array.isArray(doc.leaders)||doc.leaders.length>117||!Array.isArray(doc.terrain)||doc.terrain.length>117||
     !record(doc.sectorCells)||
     (Object.hasOwn(doc,'objectives')&&(!Array.isArray(doc.objectives)||doc.objectives.length<1||doc.objectives.length>117))||
     !doc.units.every(u=>exact(u,[...unitKeys,'type'])&&typeof u.type==='string')||
     !doc.leaders.every(l=>exact(l,unitKeys))||
     !['A','B'].every(side=>doc.units.some(u=>u.side===side)))fail();
  if(![LAB_BOARD_GEOMETRY,OFFICIAL_BOARD_GEOMETRY].includes(doc.geometry))throw Error('UNSUPPORTED_SCENARIO_GEOMETRY');
  const geometry=getBoardGeometry(doc.geometry);
  if(Object.keys(doc.sectorCells).length!==geometry.cellCount)fail();
  if(doc.provenance.kind==='OFFICIAL'&&doc.geometry!==OFFICIAL_BOARD_GEOMETRY)throw Error('OFFICIAL_SCENARIO_REQUIRES_OFFICIAL_GEOMETRY');
  const normalized={...structuredClone(doc),units:doc.units.map(u=>[u.id,u.side,u.col,u.row,u.type]),
    leaders:doc.leaders.map(l=>[l.id,l.side,l.col,l.row])};
  // Validate exactly the same setup accepted by live initialization; no
  // imported randomness, card definitions, flags or executable special rules.
  initializeSectionHistoryLab({...scenarioSetup(normalized),randomIndex:n=>n-1});
  return normalized;
}

export function createAncientsScenarioCatalog(documents=[]){
  if(!Array.isArray(documents)||documents.length>500)fail();
  const scenarios=new Map(SCENARIOS.map(s=>[s.id,s]));
  for(const doc of documents){
    const s=importAncientsScenario(doc);
    if(s.id==='demo-v1'||scenarios.has(s.id))throw Error('DUPLICATE_SCENARIO_ID: '+s.id);
    scenarios.set(s.id,s);
  }
  return Object.freeze({
    list:()=>[
      {id:'demo-v1',title:'Demostración original (38 cartas)',deckId:'demo-38'},
      ...Array.from(scenarios.values(),s=>({id:s.id,title:s.title+' (60 cartas)',deckId:s.deckId,
        ...(s.provenance?{geometry:s.geometry,provenance:structuredClone(s.provenance),factions:structuredClone(s.factions)}:{})}))
    ],
    setup:(id='demo-v1')=>id==='demo-v1'?createAncientsLoopbackSetup():
      scenarios.has(id)?scenarioSetup(scenarios.get(id)):null
  });
}
const defaults=createAncientsScenarioCatalog();
export function listAncientsScenarios(){return defaults.list();}
export function createAncientsScenarioSetup(id){return defaults.setup(id);}
