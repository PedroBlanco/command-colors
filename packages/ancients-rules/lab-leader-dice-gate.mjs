/**
 * Read-only gate between the fixture leader-dice journal and a FUTURE combat
 * executor. Even an uncontested roll NEVER authorizes a battle or leader loss.
 * No HTTP route may expose private dice or raw SQLite marker objects.
 */
import {createHash} from 'node:crypto';
import {validateLabPhysicalLeaderPreview} from './lab-physical-leader-agreement.mjs';
import {inspectLabRerollConsent} from './lab-reroll-consent-state.mjs';
import {inspectLabLeaderRerollAttempt} from './lab-leader-reroll-attempt-contract.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const FACES=new Set(['LIGHT','MEDIUM','HEAVY','LEADER','FLAG','SWORDS']);
const plain=x=>x!==null && typeof x==='object' && !Array.isArray(x);
const digest=x=>createHash('sha256').update(x).digest('hex');
const deny=(status,code)=>Object.freeze({status,code});

/**
 * Validates the complete saved leader roll, its computed outcome, board digest,
 * optional opponent review, and fixture status. Returns only a non-sensitive
 * status. Null is fail-closed; do not default to DIGITAL_CAPTURED.
 */
export function evaluateLabLeaderDiceGate({turnState,boardJson,reservationId}={}) {
  if(!plain(turnState) || turnState.schemaVersion!==1 ||
      turnState.labFixtureOnly!==true || turnState.status!=='ACTIVE' ||
      turnState.phase!=='COMBAT' || !['A','B'].includes(turnState.turn) ||
      !Number.isSafeInteger(turnState.revision) || turnState.revision<0 ||
      typeof boardJson!=='string' || !UUID.test(String(reservationId))) return null;
  const marker=turnState.pendingCombat, applied=marker?.appliedFixture;
  const saved=marker?.fixtureLeaderCasualtyPreview,roll=saved?.roll;
  const summary=applied?.summary;
  if(!plain(marker) || marker.kind!=='LAB_DIRECT_HITS_APPLIED_FIXTURE' ||
      marker.fullValidationRequired!==true || marker.reservationId!==reservationId ||
      marker.actor!==turnState.turn || !plain(applied) ||
      applied.unverifiedFullRules!==true ||
      !Number.isSafeInteger(applied.revision) || applied.revision<0 ||
      applied.revision>=turnState.revision ||
      applied.boardAfterSha256!==digest(boardJson) ||
      !plain(summary) || summary.leaderCheckRequired!==true ||
      summary.nextRequiredStep!=='LEADER_CASUALTY_CHECK' ||
      !Number.isSafeInteger(summary.blocksRemoved) || summary.blocksRemoved<1 ||
      typeof summary.unitEliminated!=='boolean' ||
      !plain(saved) || saved.kind!=='LEADER_CASUALTY_PREVIEW_ONLY' ||
      saved.requiresFullAuthorization!==true || !plain(roll)) return null;
  const count=summary.unitEliminated?1:2;
  if(roll.type!=='ANCIENTS_BASE_LEADER_CASUALTY_CAPTURED' ||
      roll.purpose!=='LEADER_CASUALTY_CHECK' ||
      roll.ruleset!=='ancients-base-3e-2009' ||
      roll.rollId!=='lab_leader_'+reservationId.replaceAll('-','') ||
      roll.actor!==marker.actor || !['A','B'].includes(roll.actor) ||
      !['DIGITAL','PHYSICAL'].includes(roll.source) ||
      roll.verification!==(roll.source==='DIGITAL'?'SERVER_GENERATED':'PLAYER_DECLARED') ||
      roll.diceCount!==count || !Array.isArray(roll.results) ||
      roll.results.length!==count || roll.results.some(face=>!FACES.has(face))) return null;
  const helmetCount=roll.results.filter(face=>face==='LEADER').length;
  const leaderWouldBeEliminated=helmetCount===count;
  const expected={kind:'LAB_LEADER_CASUALTY_OUTCOME_PREVIEW',diceCount:count,
    helmetCount,leaderWouldBeEliminated,
    leaderMustEvadeIfApplied:summary.unitEliminated&&!leaderWouldBeEliminated,
    leaderRemoved:false,leaderEvasionResolved:false,
    combatResolved:false,boardMutated:false,attackAuthorized:false};
  if(JSON.stringify(expected)!==JSON.stringify(saved.outcome)) return null;

  let status, rerollConsentState=null, rerollAttemptState=null;
  const agreement=saved.physicalAgreement;
  if(roll.source==='DIGITAL') {
    if(agreement!==undefined) return null;
    status='DIGITAL_SERVER_CAPTURED';
  } else {
    if(!validateLabPhysicalLeaderPreview(marker,boardJson)) return null;
    if(agreement===undefined) {
      status='PHYSICAL_AWAITING_OPPONENT';
    } else {
      if(!plain(agreement) || agreement.kind!=='LAB_PHYSICAL_LEADER_DICE_AGREEMENT_V1' ||
          !['CONFIRM','DISPUTE'].includes(agreement.decision) ||
          agreement.reviewerSide!==(marker.actor==='A'?'B':'A') ||
          !Number.isSafeInteger(agreement.revision) ||
          agreement.revision<=applied.revision ||
          agreement.revision>turnState.revision ||
          agreement.rollDigestSha256!==digest(JSON.stringify(roll))) return null;
      if(agreement.decision==='CONFIRM') {
        if(agreement.revision!==turnState.revision || saved.rerollConsent!==undefined) return null;
        status='PHYSICAL_OPPONENT_CONFIRMED';
      } else {
        const hasRerollAttempt=saved.rerollAttempt!==undefined;
        const consentRevision=agreement.revision+2;
        rerollConsentState=inspectLabRerollConsent({resolution:saved.rerollConsent,
          agreementRevision:agreement.revision,rollDigestSha256:agreement.rollDigestSha256,
          currentRevision:hasRerollAttempt?consentRevision:turnState.revision,
          attackerSide:marker.actor});
        if(!rerollConsentState) return null;
        if(hasRerollAttempt) {
          if(!rerollConsentState.unanimousConsent) return null;
          rerollAttemptState=inspectLabLeaderRerollAttempt({attempt:saved.rerollAttempt,
            reservationId,originalRollDigestSha256:agreement.rollDigestSha256,
            attackerSide:marker.actor,diceCount:roll.diceCount,
            consentRevision,currentRevision:turnState.revision});
          if(!rerollAttemptState) return null;
        }
        status='PHYSICAL_DISPUTED';
      }
    }
  }
  return Object.freeze({kind:'LAB_LEADER_DICE_GATE_V1',status,
    origin:roll.source,recordUncontested:status==='DIGITAL_SERVER_CAPTURED' ||
      status==='PHYSICAL_OPPONENT_CONFIRMED',
    needsOpponentReview:status==='PHYSICAL_AWAITING_OPPONENT',
    disputeBlocksContinuation:status==='PHYSICAL_DISPUTED',
    ...(rerollConsentState ? {rerollConsentStatus:rerollConsentState.status,
      rerollConsentVotes:rerollConsentState.recordedVotes,
      unanimousConsentForReroll:rerollConsentState.unanimousConsent,
      rerollAllowed:false,
      ...(rerollAttemptState ? {rerollAttemptStatus:rerollAttemptState.status,
        rerollDeclared:true,rerollPendingOpponentReview:true} : {})} : {}),
    combatAuthorized:false,leaderCasualtyApplied:false,
    evasionResolved:false,combatResolved:false,
    requiresCompleteRulesAuthorization:true});
}

/**
 * Server-composed SQLite query; exact participant membership is a dependency.
 * Only high-level status (never dice faces or outcomes) is returned to players.
 */
export function makeLabLeaderDiceGateReader({inTransaction,row,sideFor}={}) {
  if(typeof inTransaction!=='function' || typeof row?.get!=='function' ||
      typeof sideFor!=='function') throw new TypeError('INVALID_LAB_LEADER_GATE_FACTORY');
  return function readLabLeaderDiceGate(request={}) {
    const allowed=['matchId','sessionUserId','reservationId','expectedRevision'];
    if(!plain(request) || Object.keys(request).some(key=>!allowed.includes(key)))
      return deny(400,'INVALID_LAB_LEADER_GATE_REQUEST');
    const {matchId,sessionUserId,reservationId,expectedRevision}=request;
    if(!UUID.test(String(matchId)) || !UUID.test(String(reservationId)) ||
        typeof sessionUserId!=='string' || !sessionUserId ||
        !Number.isSafeInteger(expectedRevision) || expectedRevision<0)
      return deny(400,'INVALID_LAB_LEADER_GATE_REQUEST');
    return inTransaction(()=>{
      const entry=row.get(matchId),side=entry && sideFor(entry,sessionUserId);
      if(!side) return deny(404,'NOT_FOUND');
      if(entry.revision!==expectedRevision) return deny(409,'STALE_REVISION');
      let turnState;
      try{turnState=JSON.parse(entry.turn_json);}catch{return deny(409,'LEADER_GATE_UNAVAILABLE');}
      if(turnState.revision!==entry.revision) return deny(409,'LEADER_GATE_UNAVAILABLE');
      const gate=evaluateLabLeaderDiceGate({turnState,boardJson:entry.board_json,reservationId});
      if(!gate) return deny(409,'LEADER_GATE_UNAVAILABLE');
      return Object.freeze({status:200,code:'LAB_LEADER_DICE_GATE',revision:entry.revision,
        gate,labOnly:true,attackAuthorized:false,combatResolved:false});
    });
  };
}
