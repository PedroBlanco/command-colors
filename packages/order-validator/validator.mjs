/**
 * CCW-013: trusted, synthetic order-eligibility boundary.
 * This does NOT implement official Ancients cards or sector boundaries.
 * cardProfiles, units and sectorMembership MUST be supplied from server-owned
 * scenario/card data, never from the incoming browser command.
 */
import {inBounds, sectorsFor} from '../hex-grid/hex.mjs';

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SECTORS = new Set(['left', 'center', 'right']);
const fail = reason => ({accepted: false, reason});
const validId = value => typeof value === 'string' && ID.test(value);

function trustedConfiguration(context, cardRef) {
  if (!context || typeof context !== 'object' || Array.isArray(context)
      || !context.cardProfiles || typeof context.cardProfiles !== 'object' || Array.isArray(context.cardProfiles)
      || !Array.isArray(context.units) || context.units.length > 256
      || !context.sectorMembership || typeof context.sectorMembership !== 'object'
      || Array.isArray(context.sectorMembership)) {
    throw new TypeError('INVALID_SERVER_ORDER_CONTEXT');
  }
  if (!Object.hasOwn(context.cardProfiles, cardRef)) return null;
  const profile = context.cardProfiles[cardRef];
  if (!profile || !Number.isSafeInteger(profile.maxUnits) || profile.maxUnits < 1 || profile.maxUnits > 117
      || !Array.isArray(profile.allowedSectors) || profile.allowedSectors.length < 1
      || profile.allowedSectors.length > 3 || new Set(profile.allowedSectors).size !== profile.allowedSectors.length
      || !profile.allowedSectors.every(s => SECTORS.has(s))) {
    throw new TypeError('INVALID_SERVER_CARD_PROFILE');
  }
  const registry = new Map();
  for (const unit of context.units) {
    if (!unit || !validId(unit.id) || !['A', 'B'].includes(unit.side)
        || !unit.cell || !inBounds(unit.cell) || typeof unit.orderable !== 'boolean'
        || registry.has(unit.id)) throw new TypeError('INVALID_SERVER_UNIT_ROSTER');
    let membership;
    try { membership = sectorsFor(unit.cell, context.sectorMembership); }
    catch { throw new TypeError('INVALID_SERVER_SECTOR_DATA'); }
    registry.set(unit.id, {side: unit.side, orderable: unit.orderable, sectors: membership});
  }
  return {profile, registry};
}

/**
 * Validate and return a sanitized command for transitionCommandSession().
 * The caller MUST derive command.actor from the authenticated session and
 * MUST apply the command transactionally with revision/idempotency checks.
 * This helper itself does not persist state or authorize an HTTP session.
 */
export function validateSyntheticOrderAssignment(snapshot, command, context) {
  const phase = snapshot?.phaseState;
  if (!phase || !['A', 'B'].includes(phase.turn) || !Number.isSafeInteger(phase.revision)
      || phase.revision < 0 || !validId(snapshot.activeCard)) {
    throw new TypeError('INVALID_ORDER_SNAPSHOT');
  }
  if (!command || typeof command !== 'object' || Array.isArray(command)
      || command.type !== 'assign_synthetic_orders' || !['A', 'B'].includes(command.actor)
      || !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0
      || !Array.isArray(command.unitIds) || command.unitIds.length > 117
      || !command.unitIds.every(validId) || new Set(command.unitIds).size !== command.unitIds.length) {
    return fail('INVALID_ORDER_COMMAND');
  }
  if (command.expectedRevision !== phase.revision) return fail('STALE_REVISION');
  if (command.actor !== phase.turn) return fail('NOT_ACTING_PLAYER');
  if (phase.phase !== 'ASSIGN_ORDERS' || phase.pendingDecision != null) return fail('WRONG_PHASE');

  const config = trustedConfiguration(context, snapshot.activeCard);
  if (!config) return fail('UNSUPPORTED_CARD');
  if (command.unitIds.length > config.profile.maxUnits) return fail('ORDER_LIMIT_EXCEEDED');

  for (const id of command.unitIds) {
    const unit = config.registry.get(id);
    // Same response for nonexistent, enemy, blocked and wrong-sector units.
    if (!unit || unit.side !== phase.turn || !unit.orderable
        || !unit.sectors.some(s => config.profile.allowedSectors.includes(s))) {
      return fail('UNIT_NOT_ELIGIBLE');
    }
  }
  return {accepted: true, command: {
    type: 'assign_synthetic_orders', actor: phase.turn,
    expectedRevision: phase.revision, unitIds: [...command.unitIds]
  }};
}
