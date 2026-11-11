/**
 * Read-only, fail-closed check of bilateral consent to reconsider a DISPUTED
 * physical leader roll in the *fixture-only* CCRL SQLite laboratory.
 * The original faces and opponent dispute remain immutable. Even unanimous
 * consent does NOT create a new roll or authorize a real game effect.
 */
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));
const SIDES = ['A', 'B'];
const CHOICES = ['CONSENT_REROLL', 'REFUSE_REROLL'];
export const LAB_REROLL_CONSENT_KIND = 'LAB_LEADER_REROLL_CONSENT_V1';

export function inspectLabRerollConsent({resolution,agreementRevision,rollDigestSha256,
  currentRevision,attackerSide} = {}) {
  if (!Number.isSafeInteger(agreementRevision) || agreementRevision < 0 ||
      !Number.isSafeInteger(currentRevision) || currentRevision < agreementRevision ||
      typeof rollDigestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(rollDigestSha256) ||
      !SIDES.includes(attackerSide)) return null;
  if (resolution === undefined) {
    if (currentRevision !== agreementRevision) return null;
    return Object.freeze({status:'AWAITING_BOTH_CONSENTS',recordedVotes:0,
      unanimousConsent:false,rerollPerformed:false,rerollAllowed:false});
  }
  if (!exact(resolution,['kind','agreementRevision','rollDigestSha256','votes']) ||
      resolution.kind !== LAB_REROLL_CONSENT_KIND ||
      resolution.agreementRevision !== agreementRevision ||
      resolution.rollDigestSha256 !== rollDigestSha256 || !record(resolution.votes)) return null;
  const sides=Object.keys(resolution.votes);
  if (sides.length < 1 || sides.length > 2 ||
      sides.some(side=>!SIDES.includes(side))) return null;
  const revisions=[];
  for (const side of sides) {
    const vote=resolution.votes[side];
    if (!exact(vote,['choice','revision']) || !CHOICES.includes(vote.choice) ||
        !Number.isSafeInteger(vote.revision) || vote.revision<=agreementRevision ||
        vote.revision>currentRevision) return null;
    revisions.push(vote.revision);
  }
  revisions.sort((a,b)=>a-b);
  if (currentRevision !== agreementRevision+sides.length ||
      revisions.some((rev,i)=>rev!==agreementRevision+i+1)) return null;
  const refused=sides.some(side=>resolution.votes[side].choice==='REFUSE_REROLL');
  const unanimous=sides.length===2 && !refused;
  const status=refused ? 'REROLL_REFUSED' : unanimous ?
    'BOTH_CONSENTED_NO_REROLL_YET' : 'AWAITING_OTHER_CONSENT';
  return Object.freeze({status,recordedVotes:sides.length,unanimousConsent:unanimous,
    rerollPerformed:false,rerollAllowed:false});
}
