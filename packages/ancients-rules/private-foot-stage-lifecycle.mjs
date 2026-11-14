/**
 * Internal lifecycle gate for a CCWB SECTION command after a private foot
 * movement was staged. The staged step is hypothetical, not a game command.
 *
 * This validates internal consistency only. Trusted replay / scenario
 * provenance is verified separately by the CCWB bridge.
 */
import {replayFootMovementJournal} from './foot-movement-journal.mjs';

export const FOOT_STAGE_LIFECYCLE='PRIVATE_FOOT_STAGE_LIFECYCLE_V1';
const verdict=(status)=>Object.freeze({status,kind:FOOT_STAGE_LIFECYCLE});
const ABSENT=verdict('ABSENT'),CORRUPT=verdict('CORRUPT'),
  CONFLICT=verdict('KEY_CONFLICT'),REPLACEABLE=verdict('REPLACEABLE');

/**
 * Called by the trusted CCWB writer ONLY after:
 * - authentication/membership and complete CCWB replay under BEGIN IMMEDIATE;
 * - a fresh section command was accepted by the CCWB reducer;
 * - an existing committed-command retry and stale revision were excluded.
 *
 * A valid staged proposal must be tied to the current section revision.
 * A distinct accepted section command may invalidate it atomically.
 * Reusing its unconfirmed key as a section command is explicitly forbidden.
 */
export function inspectFootStageForSectionAdvance({
  persisted,matchId,gameRevision,actor,idempotencyKey
}={}){
  try{
    if(!persisted||Object.getPrototypeOf(persisted)!==Object.prototype||
       typeof matchId!=='string'||
       !Number.isSafeInteger(gameRevision)||gameRevision<0||
       !['A','B'].includes(actor)||typeof idempotencyKey!=='string')
      return CORRUPT;
    if(!Object.hasOwn(persisted,'ancientsFootMovementJournalLab'))
      return ABSENT;
    const foot=persisted.ancientsFootMovementJournalLab;
    const replayed=replayFootMovementJournal(foot);
    if(replayed.status!=='PRIVATE_FOOT_JOURNAL_REPLAY_CANDIDATE'||
       foot.matchId!==matchId||
       foot.initialState.revision!==gameRevision||
       foot.state.revision!==gameRevision+1||
       foot.entries.length!==1||
       foot.entries[0].transition.revision!==gameRevision+1||
       foot.entries[0].command.expectedRevision!==gameRevision)
      return CORRUPT;
    const entry=foot.entries[0];
    return entry.command.actor===actor&&entry.idempotencyKey===idempotencyKey
      ? CONFLICT : REPLACEABLE;
  }catch{return CORRUPT;}
}
