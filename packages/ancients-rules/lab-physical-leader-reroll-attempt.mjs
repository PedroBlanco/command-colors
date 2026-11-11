/** CCRL-only command to register a new PHYSICAL declaration after two votes. */
import {createHash} from 'node:crypto';
import {evaluateLabLeaderDiceGate} from './lab-leader-dice-gate.mjs';
import {inspectLabLeaderRerollAttempt,LAB_LEADER_REROLL_ATTEMPT_KIND,leaderRerollId}
  from './lab-leader-reroll-attempt-contract.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const KEY=/^[A-Za-z0-9_-]{8,80}$/;
const FACES=new Set(['LIGHT','MEDIUM','HEAVY','LEADER','FLAG','SWORDS']);
const obj=x=>x!==null && typeof x==='object' && !Array.isArray(x);
const hash=x=>createHash('sha256').update(x).digest('hex');
const deny=(status,code)=>Object.freeze({status,code});

/** Server-side CCRL composition supplies the authenticated participant and SQLite. */
export function makeLabPhysicalLeaderRerollAttemptCommand({inTransaction,row,previous,sideFor,
  updateTurn,eventInsert,commandInsert,captureLeaderDice}={}) {
  if(![inTransaction,row?.get,previous?.get,sideFor,updateTurn?.run,
      eventInsert?.run,commandInsert?.run,captureLeaderDice].every(f=>typeof f==='function'))
    throw new TypeError('INVALID_REROLL_ATTEMPT_FACTORY');
  return function declareLabPhysicalLeaderReroll(request={}) {
    const keys=['matchId','sessionUserId','reservationId','expectedRevision',
      'idempotencyKey','declaredFaces'];
    if(!obj(request) || Object.keys(request).some(k=>!keys.includes(k)))
      return deny(400,'INVALID_REROLL_DECLARATION');
    const {matchId,sessionUserId,reservationId,expectedRevision,
      idempotencyKey,declaredFaces}=request;
    if(!UUID.test(String(matchId)) || !UUID.test(String(reservationId)) ||
        typeof sessionUserId!=='string' || !sessionUserId ||
        !Number.isSafeInteger(expectedRevision) || expectedRevision<0 ||
        typeof idempotencyKey!=='string' || !KEY.test(idempotencyKey) ||
        !Array.isArray(declaredFaces) || ![1,2].includes(declaredFaces.length) ||
        declaredFaces.some(face=>!FACES.has(face)))
      return deny(400,'INVALID_REROLL_DECLARATION');
    const faces=[...declaredFaces];
    const signature=JSON.stringify(['LAB_PHYSICAL_REROLL_DECLARATION_V1',
      expectedRevision,reservationId,faces]);
    return inTransaction(()=>{
      const entry=row.get(matchId),side=entry&&sideFor(entry,sessionUserId);
      if(!side) return deny(404,'NOT_FOUND');
      const replay=previous.get(matchId,side,idempotencyKey);
      if(replay && replay.signature!==signature) return deny(409,'IDEMPOTENCY_KEY_REUSED');
      if(!replay && entry.revision!==expectedRevision) return deny(409,'STALE_REVISION');
      let state;
      try {state=JSON.parse(entry.turn_json);}catch{return deny(409,'REROLL_UNAVAILABLE');}
      if(state.revision!==entry.revision) return deny(409,'REROLL_UNAVAILABLE');
      const marker=state.pendingCombat,saved=marker?.fixtureLeaderCasualtyPreview;
      if(!marker || marker.actor!==side) return deny(409,'REROLL_UNAVAILABLE');
      const gate=evaluateLabLeaderDiceGate({turnState:state,
        boardJson:entry.board_json,reservationId});
      if(!gate || gate.status!=='PHYSICAL_DISPUTED' ||
          gate.unanimousConsentForReroll!==true)
        return deny(409,'REROLL_UNAVAILABLE');
      const agreement=saved?.physicalAgreement;
      const originalRoll=saved?.roll;
      if(agreement?.decision!=='DISPUTE' ||
          agreement.rollDigestSha256!==hash(JSON.stringify(originalRoll)))
        return deny(409,'REROLL_UNAVAILABLE');
      const consentRevision=agreement.revision+2;
      const attempt=saved.rerollAttempt;
      if(replay) {
        const check=inspectLabLeaderRerollAttempt({attempt,reservationId,
          originalRollDigestSha256:agreement.rollDigestSha256,attackerSide:side,
          diceCount:originalRoll.diceCount,consentRevision,currentRevision:entry.revision});
        if(!check || replay.committed_revision!==attempt.createdRevision)
          return deny(409,'REROLL_REPLAY_UNAVAILABLE');
        return Object.freeze({status:200,code:'LAB_REROLL_ALREADY_DECLARED',
          revision:attempt.createdRevision,roll:structuredClone(attempt.roll),
          pendingOpponentReview:true,originalRollPreserved:true,
          labOnly:true,combatAuthorized:false,combatResolved:false});
      }
      if(attempt!==undefined) return deny(409,'REROLL_ALREADY_DECLARED');
      if(entry.revision!==consentRevision || faces.length!==originalRoll.diceCount)
        return deny(409,'REROLL_UNAVAILABLE');
      let roll;
      try {roll=captureLeaderDice({rollId:leaderRerollId(reservationId),
        actor:side,diceCount:originalRoll.diceCount,mode:'PHYSICAL',declaredFaces:faces});}
      catch(error){if(error instanceof TypeError)return deny(400,'INVALID_REROLL_DICE');throw error;}
      const revision=entry.revision+1;
      saved.rerollAttempt={kind:LAB_LEADER_REROLL_ATTEMPT_KIND,
        createdRevision:revision,originalRollDigestSha256:agreement.rollDigestSha256,
        roll};
      if(!inspectLabLeaderRerollAttempt({attempt:saved.rerollAttempt,reservationId,
        originalRollDigestSha256:agreement.rollDigestSha256,attackerSide:side,
        diceCount:originalRoll.diceCount,consentRevision,currentRevision:revision}))
        throw new Error('REROLL_CAPTURE_CONTRACT_MISMATCH');
      state.revision=revision;
      if(updateTurn.run(revision,JSON.stringify(state),matchId,entry.revision).changes!==1)
        throw new Error('LAB_CONCURRENT_UPDATE');
      eventInsert.run(matchId,revision,JSON.stringify({sequence:revision,
        type:'LAB_LEADER_PHYSICAL_REROLL_DECLARED',side,source:'PHYSICAL',
        diceCount:roll.diceCount}));
      commandInsert.run(matchId,side,idempotencyKey,signature,reservationId,revision);
      return Object.freeze({status:200,code:'LAB_REROLL_DECLARED',revision,
        roll:structuredClone(roll),pendingOpponentReview:true,
        originalRollPreserved:true,labOnly:true,combatAuthorized:false,
        combatResolved:false});
    });
  };
}
