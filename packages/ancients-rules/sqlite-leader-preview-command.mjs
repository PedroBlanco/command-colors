/**
 * PRIVATE SQLite lab factory: transaction-bound leader dice PREVIEW command.
 * All dependencies, including the authenticated membership lookup and official
 * rule evaluation, are injected only by the server-side test-lab composition.
 * This factory is not an HTTP endpoint or a combat authorization mechanism.
 */
export function makeLeaderPreviewCommand({MATCH,KEY,denied,inTransaction,row,sideFor,
  previous,createHash,deriveStagedAncientsRangedBlockLoss,
  planBaseAncientsRangedResolution,captureBaseAncientsLeaderCasualtyDice,
  previewBaseAncientsLeaderCasualtyCheck,update,eventInsert,commandInsert} = {}) {
/**
 * Records a distinct LEADER-CASUALTY *PREVIEW* once, bound to the already
 * staged six-face ranged roll. No combat damage is authorized or applied.
 * The caller must provide sessionUserId from a trusted authenticated session.
 */
function stageLeaderCasualtyPreview(request = {}) {
  const fields=['matchId','sessionUserId','reservationId','expectedRevision',
    'idempotencyKey','mode','declaredFaces'];
  if (!request || typeof request!=='object' || Array.isArray(request) ||
      Object.keys(request).some(k=>!fields.includes(k)))
    return denied(400,'INVALID_LEADER_PREVIEW_REQUEST');
  const {matchId,sessionUserId,reservationId,expectedRevision,idempotencyKey,
    mode,declaredFaces}=request;
  if (!MATCH.test(String(matchId)) || typeof sessionUserId!=='string' || !sessionUserId ||
      !MATCH.test(String(reservationId)) || !Number.isSafeInteger(expectedRevision) ||
      expectedRevision<0 || typeof idempotencyKey!=='string' || !KEY.test(idempotencyKey) ||
      (mode!=='DIGITAL' && mode!=='PHYSICAL') ||
      (mode==='DIGITAL' && declaredFaces!==undefined) ||
      (mode==='PHYSICAL' && (!Array.isArray(declaredFaces) ||
        ![1,2].includes(declaredFaces.length) ||
        !declaredFaces.every(face=>typeof face==='string' &&
          /^[A-Z][A-Z0-9_]{0,31}$/.test(face)))))
    return denied(400,'INVALID_LEADER_PREVIEW_REQUEST');
  const faces=mode==='PHYSICAL' ? [...declaredFaces] : null;
  const signature=JSON.stringify(['LEADER_CASUALTY_PREVIEW',expectedRevision,
    reservationId,mode,faces]);
  return inTransaction(() => {
    const entry=row.get(matchId);
    const side=entry && sideFor(entry,sessionUserId);
    if (!side) return denied(404,'NOT_FOUND');
    const replay=previous.get(matchId,side,idempotencyKey);
    if (replay && replay.signature!==signature) return denied(409,'IDEMPOTENCY_KEY_REUSED');
    if (!replay && entry.revision!==expectedRevision) return denied(409,'STALE_REVISION');
    const turnState=JSON.parse(entry.turn_json);
    if (turnState.revision!==entry.revision) throw new Error('LAB_REVISION_MISMATCH');
    const marker=turnState.pendingCombat;
    if (!marker || marker.kind!=='RANGED_DICE_STAGED_OFFICIAL_PREVIEW' ||
        marker.actor!==side || marker.reservationId!==reservationId ||
        marker.fullValidationRequired!==true ||
        typeof marker.boardSnapshotSha256!=='string' ||
        marker.boardSnapshotSha256!==createHash('sha256').update(entry.board_json).digest('hex'))
      return denied(409,'LEADER_PREVIEW_UNAVAILABLE');
    let checklist;
    try {
      const loss=deriveStagedAncientsRangedBlockLoss({
        turnState,board:JSON.parse(entry.board_json),sessionSide:side,
        reservationId,expectedRevision:entry.revision
      });
      checklist=planBaseAncientsRangedResolution({blockLoss:loss});
    } catch { return denied(409,'LEADER_PREVIEW_UNAVAILABLE'); }
    if (!checklist.steps.some(step=>step.kind==='LEADER_CASUALTY_CHECK'))
      return denied(409,'LEADER_CHECK_NOT_PENDING');
    const rollId='leader_'+reservationId.replaceAll('-','');
    if (replay) {
      const saved=marker.leaderCasualtyPreview;
      if (!saved || saved.kind!=='LEADER_CASUALTY_PREVIEW_ONLY' ||
          saved.roll?.actor!==side || saved.roll?.rollId!==rollId ||
          saved.roll.source!==mode) return denied(409,'LEADER_PREVIEW_REPLAY_UNAVAILABLE');
      try {
        const recalculated=previewBaseAncientsLeaderCasualtyCheck({checklist,roll:saved.roll});
        if (JSON.stringify(recalculated)!==JSON.stringify(saved.outcome))
          return denied(409,'LEADER_PREVIEW_REPLAY_UNAVAILABLE');
      } catch {return denied(409,'LEADER_PREVIEW_REPLAY_UNAVAILABLE');}
      return Object.freeze({status:200,code:'LEADER_PREVIEW_ALREADY_STAGED',
        revision:replay.committed_revision,reservationId,
        roll:structuredClone(saved.roll),outcome:structuredClone(saved.outcome),
        previewOnly:true,attackAuthorized:false,combatResolved:false});
    }
    if (marker.leaderCasualtyPreview!==undefined)
      return denied(409,'LEADER_PREVIEW_ALREADY_PRESENT');
    let roll,outcome;
    try {
      roll=captureBaseAncientsLeaderCasualtyDice({rollId,actor:side,
        diceCount:checklist.blockLoss.leaderCasualtyCheck.diceCount,mode,
        ...(mode==='PHYSICAL' ? {declaredFaces:faces} : {})});
      outcome=previewBaseAncientsLeaderCasualtyCheck({checklist,roll});
    } catch(error) {
      if (error instanceof TypeError) return denied(400,'INVALID_LEADER_PREVIEW_DICE');
      throw error;
    }
    marker.leaderCasualtyPreview={kind:'LEADER_CASUALTY_PREVIEW_ONLY',
      roll,outcome,requiresAuthorizedHitApplication:true};
    const revision=entry.revision+1;
    turnState.revision=revision;
    if (update.run(revision,JSON.stringify(turnState),matchId,entry.revision).changes!==1)
      throw new Error('LAB_CONCURRENT_UPDATE');
    eventInsert.run(matchId,revision,JSON.stringify({sequence:revision,
      type:'LEADER_CASUALTY_PREVIEW_STAGED',side,source:mode,
      diceCount:roll.diceCount}));
    commandInsert.run(matchId,side,idempotencyKey,signature,reservationId,revision);
    return Object.freeze({status:200,code:'LEADER_PREVIEW_STAGED',revision,
      reservationId,roll:structuredClone(roll),outcome:structuredClone(outcome),
      previewOnly:true,attackAuthorized:false,combatResolved:false});
  });
}

  return stageLeaderCasualtyPreview;
}
