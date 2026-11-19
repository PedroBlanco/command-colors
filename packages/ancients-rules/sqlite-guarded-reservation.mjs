/**
 * Laboratory-only bridge to the real, read-only Ancients ranged declaration
 * guard. No HTTP route, no production schema migration and no attack execution.
 * Never pass a client-authored board, turn state or session user ID here.
 */
import {openAncientsReservationLab} from './sqlite-reservation-lab.mjs';
import {precheckAncientsRangedDeclaration} from './ranged-turn-precheck.mjs';

export function openGuardedAncientsReservationLab({file} = {}) {
  return openAncientsReservationLab({
    file,
    checkDeclaration: precheckAncientsRangedDeclaration
  });
}

/**
 * Uses the real Ancients precheck to store six-face results as PREVIEWS only.
 * This does NOT authorize combat, apply blocks, or serve an HTTP endpoint.
 * An already-persisted synthetic reservation retains its own plan version.
 */
export function openOfficialAncientsRangedPreviewLab({file} = {}) {
  return openAncientsReservationLab({file,
    checkDeclaration:precheckAncientsRangedDeclaration,dicePlanMode:'OFFICIAL_PREVIEW'});
}
