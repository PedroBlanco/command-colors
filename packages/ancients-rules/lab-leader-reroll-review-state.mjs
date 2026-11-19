/**
 * CCRL fixture-only validation for second-player review of a NEW physical
 * leader-dice declaration. Neither confirmation nor rejection applies a loss.
 */
import {inspectLabLeaderRerollAttempt} from './lab-leader-reroll-attempt-contract.mjs';

export const LAB_LEADER_REROLL_REVIEW_KIND='LAB_PHYSICAL_LEADER_REROLL_REVIEW_V1';
const isRecord=x=>x!==null && typeof x==='object' && !Array.isArray(x);
const exact=(x,fields)=>isRecord(x) && Object.keys(x).length===fields.length &&
  fields.every(field=>Object.hasOwn(x,field));
const DIGEST=/^[0-9a-f]{64}$/;

/** Returns only a status, never results, cascos or actual leader consequences. */
export function inspectLabLeaderRerollReviewState({attempt,reservationId,attackerSide,
  diceCount,consentRevision,currentRevision,originalRollDigestSha256}={}) {
  if(!isRecord(attempt))return null;
  const hasReview=Object.hasOwn(attempt,'review');
  const expectedFields=['kind','createdRevision','originalRollDigestSha256','roll'];
  if(!exact(attempt,hasReview?[...expectedFields,'review']:expectedFields))return null;
  // Old immutable declaration contract is bound to the declaration's own
  // revision, not the later review revision.
  const declaration=inspectLabLeaderRerollAttempt({
    attempt:{kind:attempt.kind,createdRevision:attempt.createdRevision,
      originalRollDigestSha256:attempt.originalRollDigestSha256,roll:attempt.roll},
    reservationId,attackerSide,diceCount,consentRevision,
    originalRollDigestSha256,currentRevision:attempt.createdRevision
  });
  if(!declaration || !Number.isSafeInteger(currentRevision) ||
      currentRevision<attempt.createdRevision)return null;
  if(!hasReview) {
    if(currentRevision!==attempt.createdRevision)return null;
    return Object.freeze({status:'PHYSICAL_REROLL_AWAITING_OPPONENT',
      newRollAccepted:false,opponentReviewPending:true,reviewDecision:null,
      combatAuthorized:false,leaderCasualtyApplied:false});
  }
  const review=attempt.review;
  if(!exact(review,['kind','revision','reviewerSide','decision',
      'newRollDigestSha256','originalRollDigestSha256']) ||
      review.kind!==LAB_LEADER_REROLL_REVIEW_KIND ||
      review.revision!==attempt.createdRevision+1 ||
      currentRevision!==review.revision ||
      review.reviewerSide!==(attackerSide==='A'?'B':'A') ||
      !['CONFIRM','DISPUTE'].includes(review.decision) ||
      !DIGEST.test(String(review.newRollDigestSha256)) ||
      review.newRollDigestSha256!==declaration.newRollDigestSha256 ||
      review.originalRollDigestSha256!==originalRollDigestSha256) return null;
  return Object.freeze({status:review.decision==='CONFIRM'?
      'PHYSICAL_REROLL_CONFIRMED':'PHYSICAL_REROLL_DISPUTED',
    newRollAccepted:review.decision==='CONFIRM',opponentReviewPending:false,
    reviewDecision:review.decision,combatAuthorized:false,leaderCasualtyApplied:false});
}
