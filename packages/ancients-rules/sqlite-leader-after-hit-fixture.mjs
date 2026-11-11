/**
 * Fixture-only leader casualty roll *preview*, strictly AFTER a committed
 * LAB_DIRECT_HITS_APPLIED_FIXTURE transition. Not an official battle command.
 * The caller must make the constructor inaccessible to HTTP and must inject
 * authenticated identities, SQLite statements and the canonical dice roller.
 */
export function makeLabLeaderAfterHitPreviewCommand({UUID,KEY,denied,inTransaction,
  row,previous,sideFor,createHash,captureLeaderDice,allowedFaces,updateTurn,
  eventInsert,commandInsert} = {}) {
  const DIGEST = raw => createHash('sha256').update(raw).digest('hex');
  const rollIdFor = id => 'lab_leader_'+id.replaceAll('-','');
  const bad = (code='LEADER_PREVIEW_UNAVAILABLE') => denied(409,code);
  const result = (code,revision,reservationId,roll,outcome) => Object.freeze({
    status:200,code,revision,reservationId,roll:structuredClone(roll),
    outcome:structuredClone(outcome),labOnly:true,previewOnly:true,
    attackAuthorized:false,combatResolved:false,boardMutated:false
  });
  const deriveOutcome = ({roll,side,reservationId,summary,diceCount}) => {
    if (!roll || roll.type!=='ANCIENTS_BASE_LEADER_CASUALTY_CAPTURED' ||
        roll.purpose!=='LEADER_CASUALTY_CHECK' ||
        roll.ruleset!=='ancients-base-3e-2009' ||
        roll.rollId!==rollIdFor(reservationId) || roll.actor!==side ||
        !['DIGITAL','PHYSICAL'].includes(roll.source) ||
        roll.verification!==(roll.source==='DIGITAL'?'SERVER_GENERATED':'PLAYER_DECLARED') ||
        roll.diceCount!==diceCount || !Array.isArray(roll.results) ||
        roll.results.length!==diceCount ||
        roll.results.some(face=>!allowedFaces.includes(face)))
      throw new TypeError('INVALID_LAB_LEADER_ROLL');
    const helmetCount=roll.results.filter(face=>face==='LEADER').length;
    const leaderWouldBeEliminated=helmetCount===diceCount;
    return Object.freeze({kind:'LAB_LEADER_CASUALTY_OUTCOME_PREVIEW',
      diceCount,helmetCount,leaderWouldBeEliminated,
      leaderMustEvadeIfApplied:summary.unitEliminated&&!leaderWouldBeEliminated,
      leaderRemoved:false,leaderEvasionResolved:false,
      combatResolved:false,boardMutated:false,attackAuthorized:false});
  };

  return function stageFixtureLeaderPreview(request={}) {
    const fields=['matchId','sessionUserId','reservationId','expectedRevision',
      'idempotencyKey','mode','declaredFaces'];
    if (!request || typeof request!=='object' || Array.isArray(request) ||
        Object.keys(request).some(x=>!fields.includes(x)))
      return denied(400,'INVALID_LAB_LEADER_REQUEST');
    const {matchId,sessionUserId,reservationId,expectedRevision,idempotencyKey,
      mode,declaredFaces}=request;
    if (typeof matchId!=='string' || !UUID.test(matchId) ||
        typeof reservationId!=='string' || !UUID.test(reservationId) ||
        typeof sessionUserId!=='string' || !sessionUserId ||
        !Number.isSafeInteger(expectedRevision) || expectedRevision<0 ||
        typeof idempotencyKey!=='string' || !KEY.test(idempotencyKey) ||
        !['DIGITAL','PHYSICAL'].includes(mode) ||
        (mode==='DIGITAL' && declaredFaces!==undefined) ||
        (mode==='PHYSICAL' && (!Array.isArray(declaredFaces) ||
          ![1,2].includes(declaredFaces.length) ||
          declaredFaces.some(face=>typeof face!=='string' || !/^[A-Z][A-Z0-9_]{0,31}$/.test(face)))))
      return denied(400,'INVALID_LAB_LEADER_REQUEST');
    const faces=mode==='PHYSICAL'?[...declaredFaces]:null;
    const signature=JSON.stringify(['LAB_LEADER_AFTER_HITS_PREVIEW_V1',
      expectedRevision,reservationId,mode,faces]);
    return inTransaction(() => {
      const entry=row.get(matchId);
      const side=entry && sideFor(entry,sessionUserId);
      if (!side) return denied(404,'NOT_FOUND');
      const replay=previous.get(matchId,side,idempotencyKey);
      if (replay && replay.signature!==signature) return bad('IDEMPOTENCY_KEY_REUSED');
      if (!replay && entry.revision!==expectedRevision) return bad('STALE_REVISION');
      const state=JSON.parse(entry.turn_json),marker=state.pendingCombat;
      if (state.revision!==entry.revision) throw new Error('LAB_REVISION_MISMATCH');
      const applied=marker?.appliedFixture, summary=applied?.summary;
      if (state.labFixtureOnly!==true || state.status!=='ACTIVE' ||
          state.turn!==side || state.phase!=='COMBAT' ||
          marker?.kind!=='LAB_DIRECT_HITS_APPLIED_FIXTURE' ||
          marker.actor!==side || marker.reservationId!==reservationId ||
          marker.fullValidationRequired!==true ||
          applied?.unverifiedFullRules!==true ||
          applied.revision!==expectedRevision ||
          applied.boardAfterSha256!==DIGEST(entry.board_json) ||
          !summary || summary.leaderCheckRequired!==true ||
          summary.nextRequiredStep!=='LEADER_CASUALTY_CHECK' ||
          !Number.isSafeInteger(summary.blocksRemoved) || summary.blocksRemoved<1 ||
          typeof summary.unitEliminated!=='boolean')
        return bad();
      const diceCount=summary.unitEliminated?1:2;
      if (replay) {
        const stored=marker.fixtureLeaderCasualtyPreview;
        if (!stored || stored.kind!=='LEADER_CASUALTY_PREVIEW_ONLY' ||
            stored.roll?.source!==mode) return bad('LEADER_PREVIEW_REPLAY_UNAVAILABLE');
        let outcome;
        try {outcome=deriveOutcome({roll:stored.roll,side,reservationId,summary,diceCount});}
        catch {return bad('LEADER_PREVIEW_REPLAY_UNAVAILABLE');}
        if (JSON.stringify(outcome)!==JSON.stringify(stored.outcome))
          return bad('LEADER_PREVIEW_REPLAY_UNAVAILABLE');
        return result('LEADER_PREVIEW_ALREADY_STAGED',replay.committed_revision,
          reservationId,stored.roll,stored.outcome);
      }
      if (marker.fixtureLeaderCasualtyPreview!==undefined)
        return bad('LEADER_PREVIEW_ALREADY_PRESENT');
      let roll,outcome;
      try {
        roll=captureLeaderDice({rollId:rollIdFor(reservationId),actor:side,
          diceCount,mode,...(mode==='PHYSICAL'?{declaredFaces:faces}:{})});
        outcome=deriveOutcome({roll,side,reservationId,summary,diceCount});
      } catch(error) {
        if(error instanceof TypeError) return denied(400,'INVALID_LAB_LEADER_DICE');
        throw error;
      }
      marker.fixtureLeaderCasualtyPreview={kind:'LEADER_CASUALTY_PREVIEW_ONLY',
        roll,outcome,requiresFullAuthorization:true};
      const revision=entry.revision+1;
      state.revision=revision;
      if(updateTurn.run(revision,JSON.stringify(state),matchId,entry.revision).changes!==1)
        throw new Error('LAB_CONCURRENT_UPDATE');
      eventInsert.run(matchId,revision,JSON.stringify({sequence:revision,
        type:'LAB_LEADER_CASUALTY_PREVIEW_STAGED',side,source:mode,diceCount}));
      commandInsert.run(matchId,side,idempotencyKey,signature,reservationId,revision);
      return result('LAB_LEADER_PREVIEW_STAGED',revision,reservationId,roll,outcome);
    });
  };
}
