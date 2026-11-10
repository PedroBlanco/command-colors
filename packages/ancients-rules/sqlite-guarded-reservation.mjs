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
