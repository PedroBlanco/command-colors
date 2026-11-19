/**
 * CCRL fixtures only: defender attests (or disputes) the NEW physical roll.
 * Distinct from consent to reroll; never applies a leader casualty or evasion.
 */
import {evaluateLabLeaderDiceGate} from './lab-leader-dice-gate.mjs';
import {inspectLabLeaderRerollReviewState,LAB_LEADER_REROLL_REVIEW_KIND}
  from './lab-leader-reroll-review-state.mjs';
import {createHash} from 'node:crypto';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const KEY=/^[A-Za-z0-9_-]{8,80}$/;
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const deny=(status,code)=>Object.freeze({status,code});
const hash=x=>createHash('sha256').update(x).digest('hex');

export function makeLabPhysicalLeaderRerollReviewCommand({inTransaction,row,previous,
  sideFor,updateTurn,eventInsert,commandInsert}={}) {
  if(![inTransaction,row?.get,previous?.get,sideFor,updateTurn?.run,
    eventInsert?.run,commandInsert?.run].every(f=>typeof f==='function'))
    throw new TypeError('INVALID_LAB_REROLL_REVIEW_FACTORY');
  return function reviewLabPhysicalLeaderReroll(request={}) {
    const fields=['matchId','sessionUserId','reservationId','expectedRevision',
      'idempotencyKey','decision'];
    if(!record(request)||Object.keys(request).some(k=>!fields.includes(k)))
      return deny(400,'INVALID_LAB_REROLL_REVIEW_REQUEST');
    const {matchId,sessionUserId,reservationId,expectedRevision,idempotencyKey,decision}=request;
    if(!UUID.test(String(matchId))||!UUID.test(String(reservationId))||
        typeof sessionUserId!=='string'||!sessionUserId||
        !Number.isSafeInteger(expectedRevision)||expectedRevision<0||
        typeof idempotencyKey!=='string'||!KEY.test(idempotencyKey)||
        !['CONFIRM','DISPUTE'].includes(decision))
      return deny(400,'INVALID_LAB_REROLL_REVIEW_REQUEST');
    const signature=JSON.stringify(['LAB_LEADER_REROLL_REVIEW_V1',
      expectedRevision,reservationId,decision]);
    return inTransaction(()=>{
      const entry=row.get(matchId),side=entry&&sideFor(entry,sessionUserId);
      if(!side)return deny(404,'NOT_FOUND');
      const replay=previous.get(matchId,side,idempotencyKey);
      if(replay&&replay.signature!==signature)return deny(409,'IDEMPOTENCY_KEY_REUSED');
      if(!replay&&entry.revision!==expectedRevision)return deny(409,'STALE_REVISION');
      let turnState;
      try{turnState=JSON.parse(entry.turn_json);}catch{return deny(409,'REROLL_REVIEW_UNAVAILABLE');}
      if(turnState.revision!==entry.revision)return deny(409,'REROLL_REVIEW_UNAVAILABLE');
      const marker=turnState.pendingCombat,saved=marker?.fixtureLeaderCasualtyPreview;
      // The declaration's original author cannot review their own new results.
      if(!marker||marker.actor===side||!['A','B'].includes(marker.actor))
        return deny(409,'REROLL_REVIEW_UNAVAILABLE');
      const gate=evaluateLabLeaderDiceGate({turnState,boardJson:entry.board_json,
        reservationId});
      if(!gate||gate.status!=='PHYSICAL_DISPUTED'||!gate.rerollDeclared||
          !gate.unanimousConsentForReroll)return deny(409,'REROLL_REVIEW_UNAVAILABLE');
      const attempt=saved?.rerollAttempt,original=saved?.physicalAgreement;
      const consentRevision=original?.revision+2;
      const parsed=inspectLabLeaderRerollReviewState({attempt,reservationId,
        attackerSide:marker.actor,diceCount:saved.roll.diceCount,
        consentRevision,currentRevision:entry.revision,
        originalRollDigestSha256:original.rollDigestSha256});
      if(!parsed)return deny(409,'REROLL_REVIEW_UNAVAILABLE');
      if(replay){
        if(!attempt.review||parsed.reviewDecision!==decision||
            replay.committed_revision!==attempt.review.revision)
          return deny(409,'REROLL_REVIEW_REPLAY_UNAVAILABLE');
        return Object.freeze({status:200,code:'REROLL_REVIEW_ALREADY_RECORDED',
          revision:replay.committed_revision,decision,
          newRollAccepted:parsed.newRollAccepted,reviewPending:false,
          combatAuthorized:false,leaderCasualtyApplied:false,labOnly:true});
      }
      if(attempt.review!==undefined)return deny(409,'REROLL_REVIEW_ALREADY_RECORDED');
      if(parsed.status!=='PHYSICAL_REROLL_AWAITING_OPPONENT')
        return deny(409,'REROLL_REVIEW_UNAVAILABLE');
      const revision=entry.revision+1;
      attempt.review={kind:LAB_LEADER_REROLL_REVIEW_KIND,revision,
        reviewerSide:side,decision,
        newRollDigestSha256:hash(JSON.stringify(attempt.roll)),
        originalRollDigestSha256:original.rollDigestSha256};
      const updated=inspectLabLeaderRerollReviewState({attempt,reservationId,
        attackerSide:marker.actor,diceCount:saved.roll.diceCount,
        consentRevision,currentRevision:revision,
        originalRollDigestSha256:original.rollDigestSha256});
      if(!updated)throw new Error('LAB_REROLL_REVIEW_STATE_MISMATCH');
      turnState.revision=revision;
      if(updateTurn.run(revision,JSON.stringify(turnState),matchId,entry.revision).changes!==1)
        throw new Error('LAB_CONCURRENT_UPDATE');
      eventInsert.run(matchId,revision,JSON.stringify({sequence:revision,
        type:'LAB_PHYSICAL_LEADER_REROLL_REVIEWED',side,decision}));
      commandInsert.run(matchId,side,idempotencyKey,signature,reservationId,revision);
      return Object.freeze({status:200,code:'REROLL_REVIEW_RECORDED',revision,
        decision,newRollAccepted:updated.newRollAccepted,reviewPending:false,
        combatAuthorized:false,leaderCasualtyApplied:false,labOnly:true});
    });
  };
}
