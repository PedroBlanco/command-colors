/** CCW-011: máquina pura de fases con elementos SINTÉTICOS (no aplica reglas de Ancients). */
export const TURN_PHASES=Object.freeze(['AWAIT_CARD','ASSIGN_ORDERS','MOVEMENT','COMBAT','DRAW_CARD']);
const RULESET='synthetic-phases-v1';
const ID=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const OPTIONS=['STAND','EVADE'];
const other=side=>side==='A'?'B':'A';
const reject=rejection=>({accepted:false,rejection});
function validState(s){
 if(!s||s.schemaVersion!==1||s.ruleset!==RULESET||s.status!=='ACTIVE'
  ||!['A','B'].includes(s.turn)||!TURN_PHASES.includes(s.phase)
  ||!Number.isSafeInteger(s.revision)||s.revision<0||!(s.playedCard===null||(typeof s.playedCard==='string'&&ID.test(s.playedCard)))
  ||!Array.isArray(s.orderedUnits)||!s.orderedUnits.every(x=>typeof x==='string'&&ID.test(x))
  ||!(s.lastDefense===null||(s.lastDefense&&OPTIONS.includes(s.lastDefense.choice)&&typeof s.lastDefense.targetUnit==='string'&&ID.test(s.lastDefense.targetUnit)))
  ||!(s.pendingDecision===null||(s.pendingDecision&&s.phase==='COMBAT'
   &&s.pendingDecision.kind==='DEFENSE_CHOICE'&&s.pendingDecision.actor===other(s.turn)
   &&typeof s.pendingDecision.targetUnit==='string'&&ID.test(s.pendingDecision.targetUnit)
   &&Array.isArray(s.pendingDecision.options)&&s.pendingDecision.options.join(',')===OPTIONS.join(',')))){
  throw new Error('INVALID_PHASE_STATE');
 }
}
export function initialSyntheticTurn({startingSide='A'}={}){
 if(!['A','B'].includes(startingSide))throw new TypeError('INVALID_STARTING_SIDE');
 return {schemaVersion:1,ruleset:RULESET,status:'ACTIVE',revision:0,turn:startingSide,
  phase:'AWAIT_CARD',playedCard:null,orderedUnits:[],pendingDecision:null,lastDefense:null};
}
/** Pure synchronous reducer. Authentication, persistence and deduplication are external. */
export function transitionSyntheticTurn(state,command){
 validState(state);
 if(!command||typeof command!=='object'||Array.isArray(command))return reject('INVALID_COMMAND');
 const {actor,type,expectedRevision}=command;
 if(!['A','B'].includes(actor)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||typeof type!=='string')return reject('INVALID_COMMAND');
 if(expectedRevision!==state.revision)return reject('STALE_REVISION');
 if(actor!==(state.pendingDecision?.actor??state.turn))return reject('NOT_ACTING_PLAYER');
 const n=structuredClone(state);let event;
 switch(type){
  case 'play_synthetic_card':
   if(state.phase!=='AWAIT_CARD'||typeof command.cardRef!=='string'||!ID.test(command.cardRef))return reject('WRONG_PHASE_OR_INPUT');
   n.playedCard=command.cardRef;n.phase='ASSIGN_ORDERS';
   event={type:'CARD_PLAYED_SIMULATED',side:actor,cardRef:n.playedCard};break;
  case 'assign_synthetic_orders':
   if(state.phase!=='ASSIGN_ORDERS'||!Array.isArray(command.unitIds)||command.unitIds.length>117
      ||!command.unitIds.every(x=>typeof x==='string'&&ID.test(x))||new Set(command.unitIds).size!==command.unitIds.length)return reject('WRONG_PHASE_OR_INPUT');
   n.orderedUnits=[...command.unitIds];n.phase='MOVEMENT';
   event={type:'ORDERS_SET_SIMULATED',side:actor,count:n.orderedUnits.length};break;
  case 'undo_synthetic_orders':
   if(state.phase!=='MOVEMENT')return reject('UNDO_NOT_AVAILABLE');
   n.orderedUnits=[];n.phase='ASSIGN_ORDERS';event={type:'ORDERS_UNDONE_SIMULATED',side:actor};break;
  case 'finish_synthetic_movement':
   if(state.phase!=='MOVEMENT')return reject('WRONG_PHASE');
   n.phase='COMBAT';event={type:'MOVEMENT_PHASE_ENDED_SIMULATED',side:actor};break;
  case 'ask_synthetic_defense':
   if(state.phase!=='COMBAT'||state.pendingDecision!==null||typeof command.targetUnit!=='string'||!ID.test(command.targetUnit))return reject('WRONG_PHASE_OR_INPUT');
   n.pendingDecision={kind:'DEFENSE_CHOICE',actor:other(state.turn),targetUnit:command.targetUnit,options:[...OPTIONS]};
   event={type:'DEFENSE_REQUESTED_SIMULATED',side:actor,targetUnit:command.targetUnit,requiredActor:other(state.turn)};break;
  case 'answer_synthetic_defense':
   if(state.phase!=='COMBAT'||state.pendingDecision===null||!OPTIONS.includes(command.choice))return reject('WRONG_PHASE_OR_INPUT');
   n.lastDefense={choice:command.choice,targetUnit:state.pendingDecision.targetUnit};n.pendingDecision=null;
   event={type:'DEFENSE_RECORDED_SIMULATED',side:actor,choice:command.choice};break;
  case 'finish_synthetic_combat':
   if(state.phase!=='COMBAT'||state.pendingDecision!==null)return reject('DECISION_OR_PHASE_PENDING');
   n.phase='DRAW_CARD';event={type:'COMBAT_PHASE_ENDED_SIMULATED',side:actor};break;
  case 'acknowledge_synthetic_draw':
   if(state.phase!=='DRAW_CARD')return reject('WRONG_PHASE');
   n.phase='AWAIT_CARD';n.turn=other(state.turn);n.playedCard=null;n.orderedUnits=[];n.pendingDecision=null;n.lastDefense=null;
   event={type:'NEXT_TURN_SIMULATED',side:n.turn};break;
  default:return reject('UNSUPPORTED_COMMAND');
 }
 n.revision=state.revision+1;
 return {accepted:true,nextState:n,events:[{sequence:n.revision,...event}]};
}
