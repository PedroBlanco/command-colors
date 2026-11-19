/**
 * Atomic, explicitly bilateral vote on the option to repeat DISPUTED physical
 * leader dice. Fixture-only CCRL, not the actual reroll itself.
 * Request identity comes from a trusted session; no client-provided dice/board.
 */
import {evaluateLabLeaderDiceGate} from './lab-leader-dice-gate.mjs';
import {inspectLabRerollConsent,LAB_REROLL_CONSENT_KIND}
  from './lab-reroll-consent-state.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const KEY=/^[A-Za-z0-9_-]{8,80}$/;
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const deny=(status,code)=>Object.freeze({status,code});
const choices=['CONSENT_REROLL','REFUSE_REROLL'];

export function makeLabLeaderRerollConsentCommand({inTransaction,row,previous,
  sideFor,updateTurn,eventInsert,commandInsert}={}) {
  if (![inTransaction,row?.get,previous?.get,sideFor,updateTurn?.run,
    eventInsert?.run,commandInsert?.run].every(fn=>typeof fn==='function'))
    throw new TypeError('INVALID_REROLL_CONSENT_FACTORY');
  return function voteLabLeaderReroll(request={}) {
    const fields=['matchId','sessionUserId','reservationId','expectedRevision','idempotencyKey','choice'];
    if(!record(request) || Object.keys(request).some(key=>!fields.includes(key)))
      return deny(400,'INVALID_REROLL_CONSENT_REQUEST');
    const {matchId,sessionUserId,reservationId,expectedRevision,idempotencyKey,choice}=request;
    if(!UUID.test(String(matchId)) || !UUID.test(String(reservationId)) ||
        typeof sessionUserId!=='string' || !sessionUserId ||
        !Number.isSafeInteger(expectedRevision) || expectedRevision<0 ||
        typeof idempotencyKey!=='string' || !KEY.test(idempotencyKey) ||
        !choices.includes(choice)) return deny(400,'INVALID_REROLL_CONSENT_REQUEST');
    const signature=JSON.stringify(['LAB_LEADER_REROLL_CONSENT_V1',expectedRevision,reservationId,choice]);
    return inTransaction(()=>{
      const entry=row.get(matchId),side=entry&&sideFor(entry,sessionUserId);
      if(!side) return deny(404,'NOT_FOUND');
      const replay=previous.get(matchId,side,idempotencyKey);
      if(replay && replay.signature!==signature) return deny(409,'IDEMPOTENCY_KEY_REUSED');
      if(!replay && entry.revision!==expectedRevision) return deny(409,'STALE_REVISION');
      let state;
      try{state=JSON.parse(entry.turn_json);}catch{return deny(409,'REROLL_CONSENT_UNAVAILABLE');}
      if(state.revision!==entry.revision) return deny(409,'REROLL_CONSENT_UNAVAILABLE');
      const gate=evaluateLabLeaderDiceGate({turnState:state,boardJson:entry.board_json,reservationId});
      if(!gate || gate.status!=='PHYSICAL_DISPUTED') return deny(409,'REROLL_CONSENT_UNAVAILABLE');
      const saved=state.pendingCombat.fixtureLeaderCasualtyPreview;
      const agreement=saved.physicalAgreement;
      // A replay after a newer physical declaration must still return the original
      // recorded vote. Gate validation above has already checked that declaration.
      const recorded=inspectLabRerollConsent({resolution:saved.rerollConsent,
        agreementRevision:agreement.revision,rollDigestSha256:agreement.rollDigestSha256,
        currentRevision:gate.rerollDeclared?agreement.revision+2:entry.revision,
        attackerSide:state.pendingCombat.actor});
      if(!recorded) return deny(409,'REROLL_CONSENT_UNAVAILABLE');
      const vote=saved.rerollConsent?.votes?.[side];
      if(replay) {
        if(!record(vote) || vote.choice!==choice || vote.revision!==replay.committed_revision)
          return deny(409,'REROLL_CONSENT_REPLAY_UNAVAILABLE');
        return Object.freeze({status:200,code:'REROLL_CONSENT_ALREADY_RECORDED',
          revision:replay.committed_revision,choice,consentStatus:recorded.status,
          unanimousConsent:recorded.unanimousConsent,rerollPerformed:false,
          combatResolved:false,leaderCasualtyApplied:false,labOnly:true});
      }
      if(vote!==undefined) return deny(409,'REROLL_CONSENT_ALREADY_RECORDED');
      if(!saved.rerollConsent) saved.rerollConsent={kind:LAB_REROLL_CONSENT_KIND,
        agreementRevision:agreement.revision,rollDigestSha256:agreement.rollDigestSha256,votes:{}};
      const revision=entry.revision+1;
      saved.rerollConsent.votes[side]={choice,revision};
      const next=inspectLabRerollConsent({resolution:saved.rerollConsent,
        agreementRevision:agreement.revision,rollDigestSha256:agreement.rollDigestSha256,
        currentRevision:revision,attackerSide:state.pendingCombat.actor});
      if(!next) throw new Error('LAB_REROLL_CONSENT_STATE_MISMATCH');
      state.revision=revision;
      if(updateTurn.run(revision,JSON.stringify(state),matchId,entry.revision).changes!==1)
        throw new Error('LAB_CONCURRENT_UPDATE');
      eventInsert.run(matchId,revision,JSON.stringify({sequence:revision,
        type:'LAB_LEADER_REROLL_CONSENT_RECORDED',side,choice}));
      commandInsert.run(matchId,side,idempotencyKey,signature,reservationId,revision);
      return Object.freeze({status:200,code:'REROLL_CONSENT_RECORDED',revision,choice,
        consentStatus:next.status,unanimousConsent:next.unanimousConsent,
        rerollPerformed:false,combatResolved:false,leaderCasualtyApplied:false,labOnly:true});
    });
  };
}
