/**
 * Explicit second-player acknowledgement of PHYSICAL leader dice in the CCRL
 * fixture lab. No outcome is applied; disagreement never changes the dice.
 * This factory is server-only and must never be exposed through a game API.
 */
import {createHash} from 'node:crypto';

const FACES = Object.freeze(['LIGHT','MEDIUM','HEAVY','LEADER','FLAG','SWORDS']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{8,80}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const deny = (status,code) => Object.freeze({status,code});
const obj = value => value && typeof value==='object' && !Array.isArray(value);

/** Validates stored *fixture* outcome before an opponent acknowledges it. */
export function validateLabPhysicalLeaderPreview(marker,boardJson) {
  if (!obj(marker) || marker.kind!=='LAB_DIRECT_HITS_APPLIED_FIXTURE' ||
      marker.fullValidationRequired!==true ||
      !UUID.test(String(marker.reservationId)) || !['A','B'].includes(marker.actor)) return null;
  const applied=marker.appliedFixture, summary=applied?.summary;
  const saved=marker.fixtureLeaderCasualtyPreview, roll=saved?.roll;
  if (!obj(applied) || applied.unverifiedFullRules!==true ||
      !Number.isSafeInteger(applied.revision) || applied.revision<0 ||
      applied.boardAfterSha256!==hash(boardJson) ||
      !obj(summary) || summary.leaderCheckRequired!==true ||
      summary.nextRequiredStep!=='LEADER_CASUALTY_CHECK' ||
      !Number.isSafeInteger(summary.blocksRemoved) || summary.blocksRemoved<1 ||
      typeof summary.unitEliminated!=='boolean' ||
      saved?.kind!=='LEADER_CASUALTY_PREVIEW_ONLY' ||
      saved.requiresFullAuthorization!==true || !obj(roll)) return null;
  const count=summary.unitEliminated?1:2;
  if (roll.type!=='ANCIENTS_BASE_LEADER_CASUALTY_CAPTURED' ||
      roll.purpose!=='LEADER_CASUALTY_CHECK' ||
      roll.ruleset!=='ancients-base-3e-2009' ||
      roll.rollId!=='lab_leader_'+marker.reservationId.replaceAll('-','') ||
      roll.actor!==marker.actor || roll.source!=='PHYSICAL' ||
      roll.verification!=='PLAYER_DECLARED' || roll.diceCount!==count ||
      !Array.isArray(roll.results) || roll.results.length!==count ||
      roll.results.some(face=>!FACES.includes(face))) return null;
  const helmetCount=roll.results.filter(face=>face==='LEADER').length;
  const leaderWouldBeEliminated=helmetCount===count;
  const outcome={kind:'LAB_LEADER_CASUALTY_OUTCOME_PREVIEW',diceCount:count,
    helmetCount,leaderWouldBeEliminated,
    leaderMustEvadeIfApplied:summary.unitEliminated&&!leaderWouldBeEliminated,
    leaderRemoved:false,leaderEvasionResolved:false,
    combatResolved:false,boardMutated:false,attackAuthorized:false};
  if (JSON.stringify(outcome)!==JSON.stringify(saved.outcome)) return null;
  return Object.freeze({saved,roll,rollDigestSha256:hash(JSON.stringify(roll))});
}

/**
 * Prepared statements and sideFor are supplied by the trusted CCRL adapter.
 * The caller must enforce both fixture opt-ins before constructing the factory.
 */
export function makeLabPhysicalLeaderAgreementCommand({inTransaction,row,previous,sideFor,
  updateTurn,eventInsert,commandInsert}={}) {
  if (![inTransaction,row?.get,previous?.get,sideFor,updateTurn?.run,
    eventInsert?.run,commandInsert?.run].every(f=>typeof f==='function'))
    throw new TypeError('INVALID_PHYSICAL_AGREEMENT_FACTORY');
  return function reviewLabPhysicalLeaderDice(request={}) {
    const fields=['matchId','sessionUserId','reservationId','expectedRevision','idempotencyKey','decision'];
    if (!obj(request) || Object.keys(request).some(k=>!fields.includes(k)))
      return deny(400,'INVALID_PHYSICAL_AGREEMENT_REQUEST');
    const {matchId,sessionUserId,reservationId,expectedRevision,idempotencyKey,decision}=request;
    if (!UUID.test(String(matchId)) || !UUID.test(String(reservationId)) ||
        typeof sessionUserId!=='string' || !sessionUserId ||
        !Number.isSafeInteger(expectedRevision) || expectedRevision<0 ||
        typeof idempotencyKey!=='string' || !KEY.test(idempotencyKey) ||
        !['CONFIRM','DISPUTE'].includes(decision))
      return deny(400,'INVALID_PHYSICAL_AGREEMENT_REQUEST');
    const signature=JSON.stringify(['LAB_PHYSICAL_LEADER_DICE_AGREEMENT_V1',
      expectedRevision,reservationId,decision]);
    return inTransaction(()=>{
      const entry=row.get(matchId),side=entry && sideFor(entry,sessionUserId);
      if (!side) return deny(404,'NOT_FOUND');
      const replay=previous.get(matchId,side,idempotencyKey);
      if (replay && replay.signature!==signature) return deny(409,'IDEMPOTENCY_KEY_REUSED');
      if (!replay && entry.revision!==expectedRevision) return deny(409,'STALE_REVISION');
      const state=JSON.parse(entry.turn_json),marker=state.pendingCombat;
      if (state.revision!==entry.revision) throw new Error('LAB_REVISION_MISMATCH');
      if (state.labFixtureOnly!==true || state.status!=='ACTIVE' ||
          state.phase!=='COMBAT' || !obj(marker) ||
          marker.reservationId!==reservationId || marker.actor===side ||
          state.turn!==marker.actor)
        return deny(409,'PHYSICAL_AGREEMENT_UNAVAILABLE');
      const valid=validateLabPhysicalLeaderPreview(marker,entry.board_json);
      if (!valid) return deny(409,'PHYSICAL_AGREEMENT_UNAVAILABLE');
      const stored=valid.saved.physicalAgreement;
      if (replay) {
        if (!obj(stored) || stored.kind!=='LAB_PHYSICAL_LEADER_DICE_AGREEMENT_V1' ||
            stored.revision!==replay.committed_revision ||
            stored.decision!==decision || stored.reviewerSide!==side ||
            stored.rollDigestSha256!==valid.rollDigestSha256)
          return deny(409,'PHYSICAL_AGREEMENT_REPLAY_UNAVAILABLE');
        return Object.freeze({status:200,code:'PHYSICAL_AGREEMENT_ALREADY_RECORDED',
          revision:replay.committed_revision,decision,labOnly:true,
          physicalRollAccepted:decision==='CONFIRM',attackAuthorized:false,
          combatResolved:false,boardMutated:false});
      }
      if (stored!==undefined) return deny(409,'PHYSICAL_AGREEMENT_ALREADY_RECORDED');
      const revision=entry.revision+1;
      valid.saved.physicalAgreement={kind:'LAB_PHYSICAL_LEADER_DICE_AGREEMENT_V1',
        revision,reviewerSide:side,decision,
        rollDigestSha256:valid.rollDigestSha256};
      state.revision=revision;
      if (updateTurn.run(revision,JSON.stringify(state),matchId,entry.revision).changes!==1)
        throw new Error('LAB_CONCURRENT_UPDATE');
      eventInsert.run(matchId,revision,JSON.stringify({sequence:revision,
        type:'LAB_PHYSICAL_LEADER_DICE_REVIEWED',side,decision}));
      commandInsert.run(matchId,side,idempotencyKey,signature,reservationId,revision);
      return Object.freeze({status:200,code:'PHYSICAL_AGREEMENT_RECORDED',
        revision,decision,labOnly:true,
        physicalRollAccepted:decision==='CONFIRM',attackAuthorized:false,
        combatResolved:false,boardMutated:false});
    });
  };
}
