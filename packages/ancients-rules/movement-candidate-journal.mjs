/**
 * LAB-ANC / R-04: deterministic audit evidence for a HYPOTHETICAL movement
 * sequence. NOT game_events, not an authoritative move and never a commit.
 * Only a future, independently validated rules engine may execute movement.
 */
import {createHash} from 'node:crypto';
import {precheckAncientsMovementSequence} from './leader-unit-sequence-preflight.mjs';

export const CANDIDATE_JOURNAL_KIND='ANCIENTS_MOVEMENT_CANDIDATE_JOURNAL_V1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const revision=x=>Number.isSafeInteger(x)&&x>=0;
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const coordinate=p=>[p.col,p.row];
const ordered=xs=>[...xs].sort();
const pieceList=xs=>xs.map(x=>[x.id,x.side,x.col,x.row,...('type' in x?[x.type]:[])])
  .sort((a,b)=>a[0].localeCompare(b[0]));
const terrainList=xs=>xs.map(x=>[x.col,x.row,x.kind]).sort((a,b)=>
  a[0]-b[0]||a[1]-b[1]||a[2].localeCompare(b[2]));
const readOnly=result=>Object.freeze({
  ...result,movementAuthorized:false,attackAuthorized:false,
  stateChanged:false,needsFullLegalityCheck:true
});
const immutable=x=>{
  if(x!==null&&typeof x==='object'){
    for(const v of Object.values(x))immutable(v);
    Object.freeze(x);
  }
  return x;
};

/**
 * All scenario, card order and board inputs MUST come from a trusted,
 * replay-verified server. This function has NO session authentication.
 * A hash-chain offers deterministic auditing and accidental-change detection,
 * NOT cryptographic authentication of the referee or the database writer.
 */
export function buildAncientsCandidateJournal({
  matchId,actor,baseRevision,units,leaders,orderedUnitIds,orderedLeaderIds,
  terrain,actions
}={}) {
  if(typeof matchId!=='string'||!UUID.test(matchId)||!['A','B'].includes(actor)||
     !revision(baseRevision))throw new TypeError('INVALID_CANDIDATE_JOURNAL_SCOPE');
  // All movement and input validation must complete before a single entry
  // exists. A rejected or conditional move never yields a partial audit log.
  const result=precheckAncientsMovementSequence({
    units,leaders,actor,orderedUnitIds,orderedLeaderIds,terrain,actions
  });
  if(result.status!=='CANDIDATE_SEQUENCE')
    return readOnly({status:'BLOCKED',reason:result.reason,
      step:result.step,journal:null});
  const contextDigest=hash([
    CANDIDATE_JOURNAL_KIND,matchId,actor,baseRevision,
    pieceList(units),pieceList(leaders),ordered(orderedUnitIds),
    ordered(orderedLeaderIds),terrainList(terrain)
  ]);
  let previousDigest=contextDigest;
  const entries=[];
  for(let i=0;i<result.steps.length;i++){
    const source=actions[i],screened=result.steps[i];
    const entry={
      sequence:i+1,
      pieceKind:source.kind,pieceId:source.id,
      from:{...screened.from},
      path:source.path.map(cell=>({col:cell.col,row:cell.row})),
      to:{...screened.to},
      leaderCarried:screened.leaderCarried??null,
      attachedLeader:screened.attachedLeader??null,
      detachedFromUnit:screened.detachedFromUnit??null,
      joinedUnit:screened.joinedUnit??null,
      previousDigest
    };
    entry.digest=hash([
      previousDigest,entry.sequence,entry.pieceKind,entry.pieceId,
      coordinate(entry.from),entry.path.map(coordinate),
      coordinate(entry.to),entry.leaderCarried,entry.attachedLeader,
      entry.detachedFromUnit,entry.joinedUnit
    ]);
    entries.push(immutable(entry));
    previousDigest=entry.digest;
  }
  const journal=immutable({
    kind:CANDIDATE_JOURNAL_KIND,matchId,actor,baseRevision,
    contextDigest,entries,finalDigest:previousDigest,
    movementAuthorized:false,attackAuthorized:false,stateChanged:false,
    needsFullLegalityCheck:true
  });
  return readOnly({status:'CANDIDATE_EVIDENCE',reason:null,step:null,journal});
}

/**
 * Regenerate from independently trusted board/orders/actions, not from
 * journal entries. Fail closed on missing, extra or edited fields.
 * Matching a hash chain NEVER grants movement authority.
 */
export function verifyAncientsCandidateJournal({
  journal,matchId,actor,baseRevision,units,leaders,orderedUnitIds,
  orderedLeaderIds,terrain,actions
}={}) {
  const rebuilt=buildAncientsCandidateJournal({
    matchId,actor,baseRevision,units,leaders,orderedUnitIds,orderedLeaderIds,
    terrain,actions
  });
  return rebuilt.status==='CANDIDATE_EVIDENCE'&&
    journal!==null&&typeof journal==='object'&&!Array.isArray(journal)&&
    JSON.stringify(journal)===JSON.stringify(rebuilt.journal);
}
