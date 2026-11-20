/**
 * Internal CCWB V2 draft lifecycle gate.
 * Applied only after full CCWB replay and a fresh accepted real section
 * command, under the same BEGIN IMMEDIATE that will advance game_revision.
 * A private path draft is not a game command/event.
 */
import {replayFootPathJournal}
  from './foot-path-v2-journal.mjs';

export const FOOT_PATH_V2_STAGE_LIFECYCLE='PRIVATE_FOOT_PATH_STAGE_LIFECYCLE_V2';
const verdict=status=>Object.freeze({
  status,kind:FOOT_PATH_V2_STAGE_LIFECYCLE
});
const absent=verdict('ABSENT'),corrupt=verdict('CORRUPT'),
  conflict=verdict('KEY_CONFLICT'),replaceable=verdict('REPLACEABLE');

export function inspectFootPathV2StageForSectionAdvance({
  persisted,matchId,gameRevision,actor,idempotencyKey
}={}){
  try{
    if(!persisted||
       Object.getPrototypeOf(persisted)!==Object.prototype||
       typeof matchId!=='string'||
       !Number.isSafeInteger(gameRevision)||gameRevision<0||
       gameRevision>=Number.MAX_SAFE_INTEGER||
       !['A','B'].includes(actor)||
       typeof idempotencyKey!=='string')
      return corrupt;
    if(!Object.hasOwn(persisted,'ancientsFootPathJournalV2Lab'))
      return absent;
    const j=persisted.ancientsFootPathJournalV2Lab;
    const result=replayFootPathJournal(j);
    if(result.status!=='PRIVATE_FOOT_PATH_JOURNAL_REPLAY_CANDIDATE'||
       j.matchId!==matchId||j.initialState.revision!==gameRevision||
       j.state.revision!==gameRevision+1||
       j.entries.length!==1||
       j.entries[0].command.expectedRevision!==gameRevision||
       j.entries[0].transition.revision!==gameRevision+1)
      return corrupt;
    const entry=j.entries[0];
    return entry.command.actor===actor&&
      entry.idempotencyKey===idempotencyKey?conflict:replaceable;
  }catch{return corrupt;}
}
