/**
 * Original, unlicensed loopback demonstration. Not an official scenario,
 * command-card deck or battle setup. Never accept player-provided parameters.
 */
export function createAncientsLoopbackSetup(){
  const cardInstances=[];
  for(const section of ['LEFT','CENTER','RIGHT']){
    for(const orders of [2,3,4]){
      for(let i=1;i<=2;i++)cardInstances.push({
        instanceId:`demo_${section.toLowerCase()}_${orders}_${i}`,
        definitionId:`ORDER_${orders}_${section}`
      });
    }
  }
  const sectorCells={};
  for(let col=0;col<13;col++){
    for(let row=0;row<9;row++){
      sectorCells[`${col},${row}`]=[
        col<4?'LEFT':col>8?'RIGHT':'CENTER'
      ];
    }
  }
  return {
    cardInstances,handSizes:{A:3,B:3},startingSide:'A',
    sectorPerspective:'PLAYER_RELATIVE',enableLeaderLab:true,enableCombatLab:true,enableDiceLab:true,enableCasualtyLab:true,enableMoraleLab:true,enableRetreatLab:true,enableRetreatLeaderLab:true,enableLeaderEscapeLab:true,enableRampageLab:true,enableRampageLeaderLab:true,enableElephantRetreatLeaderLab:true,enableCloseCombatLab:true,victoryTargets:{A:3,B:3},
    board:{units:[
      {id:'A_light',side:'A',col:2,row:7},
      {id:'A_medium',side:'A',col:6,row:7},
      {id:'A_cavalry',side:'A',col:10,row:7},
      {id:'B_heavy',side:'B',col:2,row:1},
      {id:'B_auxilia',side:'B',col:6,row:1},
      {id:'B_cavalry',side:'B',col:10,row:1}
    ],leaders:[
      {id:'A_leader',side:'A',col:2,row:7},
      {id:'B_leader',side:'B',col:10,row:1}
    ]},
    sectorCells,
    movementUnitTypes:{
      A_light:'LIGHT_INFANTRY',
      A_medium:'MEDIUM_INFANTRY',
      A_cavalry:'LIGHT_CAVALRY',
      B_heavy:'HEAVY_INFANTRY',
      B_auxilia:'AUXILIA_INFANTRY',
      B_cavalry:'MEDIUM_CAVALRY'
    },
    movementTerrain:[
      {col:4,row:4,kind:'FOREST'},
      {col:7,row:4,kind:'HILL'},
      {col:9,row:4,kind:'BROKEN_GROUND'}
    ]
  };
}
