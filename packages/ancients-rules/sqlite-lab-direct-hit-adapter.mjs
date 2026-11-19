/**
 * Deliberate, explicitly opted-in bridge for the isolated CCRL fixture lab.
 * Never import it into the HTTP API or treat its effects as official combat.
 * The real previously saved dice/board snapshot supplies all effect counts.
 */
import {deriveStagedAncientsRangedBlockLoss} from './ranged-block-snapshot.mjs';
import {openLabOnlyDirectHitCommit} from './sqlite-lab-direct-hit-commit.mjs';

export function openAncientsDirectHitFixtureAdapter({file,enableUnsafeFixtureMutation=false}={}) {
  return openLabOnlyDirectHitCommit({file,
    deriveTrustedPreview:deriveStagedAncientsRangedBlockLoss,
    allowTestFixtureMutation:enableUnsafeFixtureMutation});
}
