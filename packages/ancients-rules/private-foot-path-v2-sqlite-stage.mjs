/**
 * CCWB LAB ONLY — transactional input capture and V2 full-path stage planner.
 * A synthetic scenario and replay-verified CCWB orders must come from trusted
 * SERVER code. This never authorizes a movement or changes the real board.
 */
import {ANCIENTS_RULESET} from './movement-profile.mjs';
import {previewVerifiedSectionFootCore}
  from './verified-foot-core-preview.mjs';
import {OPEN_FOOT_PATH_CORE_KIND,OPEN_FOOT_PATH_CORE_POLICY,
  reduceCoreOpenFootPath} from './core-open-foot-path-v2.mjs';
import {
  initializeFootPathJournal,proposeFootPathJournalAppend,
  checkFootPathJournalAnchor
} from './foot-path-v2-journal.mjs';

export const PRIVATE_FOOT_PATH_STAGE_KIND='PRIVATE_LAB_FOOT_PATH_STAGE_V2';
const KEY=/^[A-Za-z0-9_-]{8,80}$/;
const ID=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const guard=Object.freeze({
  movementAuthorized:false,officialMovementAuthorized:false,
  attackAuthorized:false,boardChanged:false,gameRevisionChanged:false,
  canCommit:false,dbChanged:false
});
const blocked=reason=>Object.freeze({
  status:'BLOCKED',reason,kind:PRIVATE_FOOT_PATH_STAGE_KIND,
  journal:null,...guard
});
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,keys)=>plain(x)&&Reflect.ownKeys(x).length===keys.length&&
  keys.every(k=>{
    const d=Object.getOwnPropertyDescriptor(x,k);
    return d?.enumerable===true&&Object.hasOwn(d,'value');
  });
const field=(x,k)=>Object.getOwnPropertyDescriptor(x,k).value;
const cell=c=>exact(c,['col','row'])&&
  Number.isSafeInteger(field(c,'col'))&&
  Number.isSafeInteger(field(c,'row'))&&
  field(c,'col')>=0&&field(c,'col')<13&&
  field(c,'row')>=0&&field(c,'row')<9;
// No xs.length or xs[i] reads on untrusted arrays: both can invoke a
// Proxy.get trap. Only own DATA descriptors are allowed, including length.
const dense=(xs,min,max)=>{
  if(!Array.isArray(xs)||Object.getPrototypeOf(xs)!==Array.prototype)
    return false;
  const count=Object.getOwnPropertyDescriptor(xs,'length')?.value;
  if(!Number.isSafeInteger(count)||count<min||count>max||
     Reflect.ownKeys(xs).length!==count+1)return false;
  for(let i=0;i<count;i++){
    const d=Object.getOwnPropertyDescriptor(xs,String(i));
    if(!d?.enumerable||!Object.hasOwn(d,'value'))return false;
  }
  return true;
};
const length=xs=>Object.getOwnPropertyDescriptor(xs,'length').value;
/**
 * Snapshot the entire untrusted request BEFORE acquiring BEGIN IMMEDIATE.
 * No browser-selected actor, scenario, card, policy, signature or game state.
 */
export function snapshotFootPathV2StageRequest(request){
  try{
    if(!exact(request,['sessionToken','expectedRevision','idempotencyKey','actions']))
      return null;
    const sessionToken=field(request,'sessionToken'),
      expectedRevision=field(request,'expectedRevision'),
      idempotencyKey=field(request,'idempotencyKey'),
      actions=field(request,'actions');
    if(typeof sessionToken!=='string'||sessionToken.length<20||
       sessionToken.length>256||
       !Number.isSafeInteger(expectedRevision)||expectedRevision<0||
       typeof idempotencyKey!=='string'||!KEY.test(idempotencyKey)||
       !dense(actions,1,1))return null;
    const action=field(actions,'0');
    if(!exact(action,['kind','id','path'])||
       field(action,'kind')!=='UNIT'||
       typeof field(action,'id')!=='string'||
       !ID.test(field(action,'id'))||
       field(action,'id')==='__proto__')return null;
    const path=field(action,'path');
    if(!dense(path,1,2))return null;
    const cells=[];
    for(let i=0;i<length(path);i++){
      const source=field(path,String(i));
      if(!cell(source))return null;
      cells.push(Object.freeze({
        col:field(source,'col'),row:field(source,'row')
      }));
    }
    return Object.freeze({
      sessionToken,expectedRevision,idempotencyKey,
      actions:Object.freeze([Object.freeze({
        kind:'UNIT',id:field(action,'id'),path:Object.freeze(cells)
      })])
    });
  }catch{return null;}
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
/**
 * Inside one SQLite writer transaction, after session/membership check and
 * replay of the complete CCWB card/order command history:
 *  - Validate the first edge against the verified CCWB order/card/synthetic
 *    scenario, via the existing one-step secure preview.
 *  - Rebuild the V2 core's independent initial board from CCWB (not journal).
 *  - Compare V2 first-edge result with V1 secure preview.
 *  - Run the V2 whole-path reducer and private journal.
 *
 * This planner is not an official scenario certification. No HTTP exposure.
 */
export function planPrivateFootPathV2SqliteStage({
  matchId,verifiedState,actor,expectedRevision,actions,
  idempotencyKey,trustedScenario,previousJournal=null
}={}){
  try{
    if(!Array.isArray(actions)||actions.length!==1||
       !Array.isArray(actions[0]?.path)||actions[0].path.length<1||
       actions[0].path.length>2)
      return blocked('FOOT_PATH_LAB_INVALID_ACTION');
    const one={kind:'UNIT',id:actions[0].id,path:[actions[0].path[0]]};
    const first=previewVerifiedSectionFootCore({
      verifiedState,actor,expectedRevision,actions:[one],trustedScenario
    });
    if(first.status!=='PRIVATE_CORE_FOOT_PROPOSAL')
      return blocked(first.reason??'FOOT_PATH_LAB_VERIFIED_CONTEXT_REJECTED');
    const sourceUnits=verifiedState.board.units;
    const unitTypes={};
    for(const u of sourceUnits)
      Object.defineProperty(unitTypes,u.id,{
        value:trustedScenario.unitTypes[u.id],enumerable:true,
        writable:true,configurable:true
      });
    const initialState={
      kind:OPEN_FOOT_PATH_CORE_KIND,schemaVersion:2,
      ruleset:ANCIENTS_RULESET,revision:expectedRevision,turn:actor,
      phase:'MOVE',board:{
        units:sourceUnits.map(u=>({id:u.id,side:u.side,col:u.col,row:u.row})),
        leaders:[]},
      orderLedger:{
        issuedUnitIds:verifiedState.orderSnapshot.pieces.map(u=>u.id),
        movedUnitIds:[]
      }
    };
    const policy={
      scope:OPEN_FOOT_PATH_CORE_POLICY,ruleset:ANCIENTS_RULESET,
      cardFamily:'ORDINARY_SECTION',terrain:[],
      scenarioExceptions:[],unitTypes
    };
    const initial=initializeFootPathJournal({matchId,initialState,policy});
    if(initial.status!=='PRIVATE_FOOT_PATH_JOURNAL_INITIAL_CANDIDATE')
      return blocked('FOOT_PATH_LAB_INITIAL_ANCHOR_INVALID');
    const command={
      actor,expectedRevision,unitId:one.id,
      path:actions[0].path.map(p=>({col:p.col,row:p.row}))
    };
    const projectedFirst=reduceCoreOpenFootPath({
      state:initialState,policy,action:{
        ...command,path:[command.path[0]]
      }
    });
    const legacyFirst=first.proposal.nextState;
    if(projectedFirst.status!=='RULE_PATH_TRANSITION_CANDIDATE'||
       !same({...projectedFirst.nextState,
         kind:legacyFirst.kind,schemaVersion:legacyFirst.schemaVersion},
         legacyFirst))
      return blocked('FOOT_PATH_LAB_FIRST_EDGE_DRIFT');
    if(previousJournal!==null){
      const checked=checkFootPathJournalAnchor({
        journal:previousJournal,trustedMatchId:matchId,
        trustedInitialState:initialState,trustedPolicy:policy,
        rowRevision:expectedRevision+1
      });
      if(checked.status!=='PRIVATE_FOOT_PATH_JOURNAL_ANCHORED_CANDIDATE'||
         checked.entryCount!==1)
        return blocked('FOOT_PATH_LAB_PERSISTED_JOURNAL_DRIFT');
      const retry=proposeFootPathJournalAppend({
        journal:previousJournal,command,idempotencyKey
      });
      if(retry.status==='PRIVATE_FOOT_PATH_JOURNAL_ALREADY_PROPOSED')
        return Object.freeze({
          status:'PRIVATE_FOOT_PATH_STAGE_ALREADY_RECORDED',
          reason:null,kind:PRIVATE_FOOT_PATH_STAGE_KIND,
          journal:null,provisionalRevision:retry.priorRevision,...guard
        });
      if(retry.reason==='FOOT_PATH_IDEMPOTENCY_CONFLICT')
        return blocked('FOOT_PATH_LAB_IDEMPOTENCY_CONFLICT');
      return blocked('FOOT_PATH_LAB_ONLY_ONE_ACTION');
    }
    const appended=proposeFootPathJournalAppend({
      journal:initial.journal,command,idempotencyKey
    });
    if(appended.status!=='PRIVATE_FOOT_PATH_JOURNAL_APPEND_CANDIDATE')
      return blocked(appended.reason??'FOOT_PATH_LAB_APPEND_REJECTED');
    const verified=checkFootPathJournalAnchor({
      journal:appended.journal,trustedMatchId:matchId,
      trustedInitialState:initialState,trustedPolicy:policy,
      rowRevision:expectedRevision+1
    });
    if(verified.status!=='PRIVATE_FOOT_PATH_JOURNAL_ANCHORED_CANDIDATE'||
       verified.entryCount!==1)
      return blocked('FOOT_PATH_LAB_PROPOSAL_DRIFT');
    return Object.freeze({
      status:'PRIVATE_FOOT_PATH_STAGE_APPEND_CANDIDATE',
      reason:null,kind:PRIVATE_FOOT_PATH_STAGE_KIND,
      journal:appended.journal,
      provisionalRevision:expectedRevision+1,...guard
    });
  }catch{return blocked('FOOT_PATH_LAB_INVALID_CONTEXT');}
}
