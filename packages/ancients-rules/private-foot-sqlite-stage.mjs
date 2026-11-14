/**
 * PRIVATE, SYNTHETIC, SINGLE-STEP foot journal staging.
 *
 * Inputs verifiedState and trustedScenario may ONLY come from the CCWB
 * replay-verified server adapter and server-owned synthetic policy. A stage
 * is a persisted PROPOSAL, never an authorized movement or a public event.
 */
import {previewVerifiedSectionFootCore} from './verified-foot-core-preview.mjs';
import {ANCIENTS_RULESET} from './movement-profile.mjs';
import {CORE_OPEN_FOOT_KIND,CORE_OPEN_FOOT_POLICY}
  from './core-open-foot-movement.mjs';
import {
  initializeFootMovementJournal,proposeFootMovementJournalAppend,
  checkFootJournalAnchor
} from './foot-movement-journal.mjs';

export const PRIVATE_FOOT_STAGE_KIND='PRIVATE_LAB_FOOT_STAGE_V1';
const guards=Object.freeze({
  movementAuthorized:false,officialMovementAuthorized:false,
  attackAuthorized:false,boardChanged:false,gameRevisionChanged:false,
  canCommit:false,dbChanged:false
});
const deny=(reason)=>Object.freeze({
  status:'BLOCKED',reason,kind:PRIVATE_FOOT_STAGE_KIND,
  journal:null,...guards
});
const semantic=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const safe=(v)=>structuredClone(v);

/**
 * The staged ledger is strictly independent of the card/order command log.
 * The latter is verified by the caller in the SAME SQLite transaction.
 *
 * Only the FIRST movement can be proposed: after that one hypothetical
 * foot step, additional actions cannot be staged. Repeating the SAME key
 * and semantic command returns an idempotent no-write response.
 */
export function planPrivateFootSqliteStage({
  matchId,verifiedState,actor,expectedRevision,actions,
  idempotencyKey,trustedScenario,previousJournal=null
}={}){
  try{
    const preview=previewVerifiedSectionFootCore({
      verifiedState,actor,expectedRevision,actions,trustedScenario
    });
    if(preview.status!=='PRIVATE_CORE_FOOT_PROPOSAL')
      return deny(preview.reason??'FOOT_LAB_PREVIEW_REJECTED');
    const units=verifiedState.board.units;
    const typeMapping={};
    for(const unit of units)
      typeMapping[unit.id]=trustedScenario.unitTypes[unit.id];

    const initialState={
      kind:CORE_OPEN_FOOT_KIND,schemaVersion:1,ruleset:ANCIENTS_RULESET,
      revision:verifiedState.revision,turn:actor,phase:'MOVE',
      board:{
        units:units.map(u=>({id:u.id,side:u.side,col:u.col,row:u.row})),
        leaders:[]
      },
      orderLedger:{
        issuedUnitIds:verifiedState.orderSnapshot.pieces.map(p=>p.id),
        movedUnitIds:[]
      }
    };
    const policy={
      scope:CORE_OPEN_FOOT_POLICY,ruleset:ANCIENTS_RULESET,
      cardFamily:'ORDINARY_SECTION',
      terrain:[],scenarioExceptions:[],unitTypes:typeMapping
    };
    const initialized=initializeFootMovementJournal({
      matchId,initialState,policy
    });
    if(initialized.status!=='PRIVATE_FOOT_JOURNAL_INITIAL_CANDIDATE')
      return deny('FOOT_LAB_ANCHOR_INVALID');
    const requested=actions[0];
    const command={
      actor,expectedRevision,unitId:requested.id,
      to:{col:requested.path[0].col,row:requested.path[0].row}
    };
    if(previousJournal!==null){
      // The initial match/board/policy must come from fresh CCWB replay,
      // not from the stored provisional journal itself.
      const checked=checkFootJournalAnchor({
        journal:previousJournal,trustedMatchId:matchId,
        trustedInitialState:initialState,trustedPolicy:policy,
        rowRevision:verifiedState.revision+1
      });
      if(checked.status!=='PRIVATE_FOOT_JOURNAL_ANCHORED_CANDIDATE'||
         checked.entryCount!==1)
        return deny('FOOT_LAB_PERSISTED_JOURNAL_DRIFT');
      const retry=proposeFootMovementJournalAppend({
        journal:previousJournal,command,idempotencyKey
      });
      if(retry.status==='FOOT_JOURNAL_ALREADY_PROPOSED')
        return Object.freeze({
          status:'PRIVATE_FOOT_STAGE_ALREADY_RECORDED',
          kind:PRIVATE_FOOT_STAGE_KIND,reason:null,
          journal:null,stagedRevision:retry.priorRevision,...guards
        });
      if(retry.reason==='FOOT_IDEMPOTENCY_CONFLICT')
        return deny('FOOT_LAB_IDEMPOTENCY_CONFLICT');
      return deny('FOOT_LAB_ONE_STEP_ONLY');
    }

    const proposed=proposeFootMovementJournalAppend({
      journal:initialized.journal,command,idempotencyKey
    });
    if(proposed.status!=='PRIVATE_FOOT_JOURNAL_APPEND_CANDIDATE')
      return deny(proposed.reason??'FOOT_LAB_APPEND_FAILED');
    if(!semantic(proposed.journal.state,preview.proposal.nextState))
      return deny('FOOT_LAB_REDUCER_PROJECTION_DRIFT');
    const checked=checkFootJournalAnchor({
      journal:proposed.journal,trustedMatchId:matchId,
      trustedInitialState:initialState,trustedPolicy:policy,
      rowRevision:verifiedState.revision+1
    });
    if(checked.status!=='PRIVATE_FOOT_JOURNAL_ANCHORED_CANDIDATE')
      return deny('FOOT_LAB_PROPOSED_JOURNAL_INVALID');
    return Object.freeze({
      status:'PRIVATE_FOOT_STAGE_APPEND_CANDIDATE',
      kind:PRIVATE_FOOT_STAGE_KIND,reason:null,
      journal:proposed.journal,
      stagedRevision:proposed.journal.state.revision,
      ...guards
    });
  }catch{
    return deny('FOOT_LAB_STAGE_INVALID');
  }
}
