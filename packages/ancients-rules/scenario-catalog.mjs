/**
 * Server-owned scenario data and base-deck multiplicities (2009 rules §18).
 * No official scenario maps, card text or artwork are distributed.
 * Keep IDs immutable: an edited deployment must receive a new versioned ID.
 */
import {createAncientsLoopbackSetup} from './loopback-demo-setup.mjs';

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

export function listAncientsScenarios(){
  return [
    {id:'demo-v1',title:'Demostración original (38 cartas)',deckId:'demo-38'},
    ...SCENARIOS.map(s=>({id:s.id,title:s.title+' (60 cartas)',deckId:s.deckId}))
  ];
}

// Only an opaque ID selects a trusted deployment. No caller-supplied board,
// hand sizes, deck or rules are merged into this object.
export function createAncientsScenarioSetup(id='demo-v1'){
  if(id==='demo-v1')return createAncientsLoopbackSetup();
  const s=SCENARIOS.find(x=>x.id===id);
  if(!s)return null;
  const piece=([id,side,col,row])=>({id,side,col,row});
  return {
    ...createAncientsLoopbackSetup(),
    scenario:{id:s.id,title:s.title,deckId:s.deckId},
    cardInstances:createAncientsBaseDeck(),startingSide:s.startingSide,
    handSizes:{...s.handSizes},victoryTargets:{...s.victoryTargets},
    board:{units:s.units.map(piece),leaders:s.leaders.map(piece)},
    movementUnitTypes:Object.fromEntries(s.units.map(([id,,,,type])=>[id,type])),
    movementTerrain:structuredClone(s.terrain),sectorCells:sharedSectorCells(),
    ...(s.objectives?{scenarioObjectives:structuredClone(s.objectives)}:{})
  };
}
