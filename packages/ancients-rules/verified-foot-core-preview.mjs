/**
 * LAB-ANC / #97: read-only bridge between a VERIFIED section-card history
 * and the restricted independent Ancients foot movement core.
 *
 * The CCWB caller MUST verify the full SQLite command/event replay and the
 * actor's live session/membership in the same WAL read transaction. Neither
 * a candidate preflight nor a supplied policy is an authorization.
 *
 * The section lab has no persisted movement actions: this bridge proposes
 * ONE first step only, never a committed move or a continuing game state.
 */
import {screenBaseAncientsSectionCardOrders} from './section-card-order-screen.mjs';
import {ANCIENTS_RULESET,BASE_MOVEMENT_PROFILES} from './movement-profile.mjs';
import {
  CORE_OPEN_FOOT_KIND,CORE_OPEN_FOOT_POLICY,reduceCoreOpenFootStep
} from './core-open-foot-movement.mjs';

export const VERIFIED_FOOT_PREVIEW_KIND='PRIVATE_VERIFIED_FOOT_CORE_PREVIEW_V1';
const LAB_SCOPE='SYNTHETIC_OPEN_HEX_V1';
const SECTORS=new Set(['LEFT','CENTER','RIGHT']);
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  Object.getPrototypeOf(x)===Object.prototype;
const own=(x,k)=>Object.hasOwn(x,k);
const same=(a,b)=>a.col===b.col&&a.row===b.row;
const denied=reason=>Object.freeze({
  status:'BLOCKED',kind:VERIFIED_FOOT_PREVIEW_KIND,reason,
  proposal:null,movementAuthorized:false,officialMovementAuthorized:false,
  attackAuthorized:false,canCommit:false,dbChanged:false,
  boardChanged:false,needsServerTransaction:true
});
const noException=map=>{
  if(!record(map))return false;
  return Reflect.ownKeys(map).every(k=>typeof k==='string'&&
    k!=='__proto__'&&Array.isArray(map[k])&&
    map[k].length>=1&&map[k].length<=2&&
    map[k].every(x=>SECTORS.has(x))&&new Set(map[k]).size===map[k].length&&
    (map[k].length!==2||
      (map[k].includes('LEFT')&&map[k].includes('CENTER'))||
      (map[k].includes('CENTER')&&map[k].includes('RIGHT'))));
};
const equalSectors=(a,b)=>{
  if(!noException(a)||!noException(b))return false;
  const keys=Reflect.ownKeys(a);
  return keys.length===Reflect.ownKeys(b).length&&keys.every(k=>
    own(b,k)&&a[k].length===b[k].length&&
    a[k].every(label=>b[k].includes(label)));
};

/**
 * This does not construct an official match from arbitrary lab data. The
 * scope is explicitly synthetic, with no terrain, exceptions, or leaders;
 * core legality applies only to its narrow one-step foot subset.
 */
export function previewVerifiedSectionFootCore({
  verifiedState,actor,expectedRevision,actions,trustedScenario
}={}){
  try{
    const state=verifiedState;
    if(!record(state)||!['A','B'].includes(actor))return denied('INVALID_VERIFIED_CONTEXT');
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||
       expectedRevision!==state.revision)return denied('STALE_REVISION');
    if(state.turn!==actor)return denied('NOT_ACTING_PLAYER');
    if(state.phase!=='LAB_RESOLUTION_PENDING'||!record(state.orderSnapshot)||
       !Array.isArray(state.orderSnapshot.pieces)||
       state.orderSnapshot.side!==actor||
       state.orderSnapshot.revision!==state.revision)
      return denied('ORDERS_NOT_STAGED');

    if(!record(trustedScenario)||Reflect.ownKeys(trustedScenario).length!==5||
       !['scope','ruleset','unitTypes','terrain','scenarioExceptions']
         .every(k=>own(trustedScenario,k))||
       trustedScenario.scope!==LAB_SCOPE||
       trustedScenario.ruleset!==ANCIENTS_RULESET||
       !Array.isArray(trustedScenario.terrain)||
       trustedScenario.terrain.length!==0||
       !Array.isArray(trustedScenario.scenarioExceptions)||
       trustedScenario.scenarioExceptions.length!==0||
       !record(trustedScenario.unitTypes))
      return denied('UNSUPPORTED_VERIFIED_SCENARIO');

    if(!Array.isArray(actions)||actions.length!==1||
       !record(actions[0])||Reflect.ownKeys(actions[0]).length!==3||
       !['kind','id','path'].every(k=>own(actions[0],k))||
       actions[0].kind!=='UNIT'||
       !Array.isArray(actions[0].path)||actions[0].path.length!==1)
      return denied('ONLY_ONE_FOOT_STEP_SUPPORTED');

    if(!record(state.board)||!Array.isArray(state.board.units)||
       !Array.isArray(state.board.leaders)||state.board.leaders.length!==0||
       !record(state.sectorCells)||
       !equalSectors(state.orderSnapshot.sectorCells,state.sectorCells))
      return denied('UNSUPPORTED_VERIFIED_BOARD');

    // This is a card/order eligibility consistency screen, NOT a grant of
    // movement authority; the independent core checks the movement itself.
    const pieces=state.orderSnapshot.pieces;
    const units=state.board.units;
    if(pieces.some(p=>!record(p)||p.kind!=='UNIT'||p.side!==actor||
        !units.some(u=>u.id===p.id&&u.side===actor&&same(u,p))))
      return denied('UNSUPPORTED_VERIFIED_ORDERS');
    const ids=pieces.map(p=>p.id);
    if(new Set(ids).size!==ids.length)
      return denied('UNSUPPORTED_VERIFIED_ORDERS');
    const card=screenBaseAncientsSectionCardOrders({
      turnState:{schemaVersion:1,ruleset:ANCIENTS_RULESET,status:'ACTIVE',
        phase:'COMBAT',turn:actor,revision:state.revision,
        orderedUnitIds:ids,orderedLeaderIds:[]},
      sessionSide:actor,expectedRevision,
      handAtPlay:state.handAtPlay,cardPlay:state.cardPlay,
      orderSnapshot:state.orderSnapshot
    });
    if(card.status!=='CANDIDATE'||card.cardFamily!=='ORDINARY_SECTION')
      return denied('UNSUPPORTED_VERIFIED_ORDERS');

    const sourceTypes=trustedScenario.unitTypes;
    if(Reflect.ownKeys(sourceTypes).length!==units.length)
      return denied('UNSUPPORTED_VERIFIED_SCENARIO');
    const unitTypes={};
    for(const unit of units){
      if(!record(unit)||!own(sourceTypes,unit.id)||
         typeof sourceTypes[unit.id]!=='string'||
         !own(BASE_MOVEMENT_PROFILES,sourceTypes[unit.id]))
        return denied('UNSUPPORTED_VERIFIED_SCENARIO');
      // No data from the card, hand, journal or scenario enters the public
      // projection. The ID/side/position are taken from verified state only.
      unitTypes[unit.id]=sourceTypes[unit.id];
    }

    const core={
      kind:CORE_OPEN_FOOT_KIND,schemaVersion:1,ruleset:ANCIENTS_RULESET,
      revision:state.revision,turn:actor,phase:'MOVE',
      board:{units:units.map(u=>({id:u.id,side:u.side,col:u.col,row:u.row})),
        leaders:[]},
      // No movement history is stored by the LAB journal; this is the FIRST
      // hypothetical movement only. It must not be used for continuation.
      orderLedger:{issuedUnitIds:ids,movedUnitIds:[]}
    };
    const policy={
      scope:CORE_OPEN_FOOT_POLICY,ruleset:ANCIENTS_RULESET,
      cardFamily:'ORDINARY_SECTION',terrain:[],scenarioExceptions:[],
      unitTypes
    };
    const requested=actions[0];
    const outcome=reduceCoreOpenFootStep({
      state:core,policy,
      action:{actor,expectedRevision,unitId:requested.id,
        to:{col:requested.path[0].col,row:requested.path[0].row}}
    });
    if(outcome.status!=='RULE_TRANSITION_CANDIDATE')
      return denied(outcome.reason??'FOOT_CORE_REJECTED');
    return Object.freeze({
      status:'PRIVATE_CORE_FOOT_PROPOSAL',
      kind:VERIFIED_FOOT_PREVIEW_KIND,reason:null,
      proposal:outcome,
      movementAuthorized:false,officialMovementAuthorized:false,
      attackAuthorized:false,canCommit:false,dbChanged:false,
      boardChanged:false,needsServerTransaction:true
    });
  }catch{
    // Malformed or inconsistent trusted inputs do not produce partial boards.
    return denied('INVALID_VERIFIED_CONTEXT');
  }
}
