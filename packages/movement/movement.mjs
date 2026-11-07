/**
 * CCW-014: pure synthetic movement transition, not official Ancients rules.
 * The caller must derive actor from its authenticated session and provide
 * policy and board exclusively from the server-owned, persisted match state.
 * No state is persisted here: caller must commit revision, board, moved IDs
 * and event atomically, or discard the entire returned result.
 */
import {inBounds, distance} from '../hex-grid/hex.mjs';

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const validId = v => typeof v === 'string' && ID.test(v);
const sides = new Set(['A', 'B']);
const fail = reason => ({accepted: false, reason});
const key = cell => cell.col + ',' + cell.row;
const cell = value => value && typeof value === 'object' && !Array.isArray(value)
  && Number.isSafeInteger(value.col) && Number.isSafeInteger(value.row)
  && inBounds(value);

function verifyServerData(state, policy) {
  if (!state || typeof state !== 'object' || Array.isArray(state)
    || !Array.isArray(state.board) || state.board.length > 117
    || !Array.isArray(state.movedUnitIds) || state.movedUnitIds.length > 117
    || !state.phaseState || !sides.has(state.phaseState.turn)
    || !Number.isSafeInteger(state.phaseState.revision) || state.phaseState.revision < 0
    || state.phaseState.revision === Number.MAX_SAFE_INTEGER
    || !Array.isArray(state.phaseState.orderedUnits)
    || state.phaseState.orderedUnits.length > 117
    || !state.phaseState.orderedUnits.every(validId)
    || new Set(state.phaseState.orderedUnits).size !== state.phaseState.orderedUnits.length
    || !state.movedUnitIds.every(validId)
    || new Set(state.movedUnitIds).size !== state.movedUnitIds.length
    || state.movedUnitIds.some(id => !state.phaseState.orderedUnits.includes(id))) {
    throw new TypeError('INVALID_SERVER_MOVEMENT_STATE');
  }
  const ids = new Set(), occupied = new Set();
  for (const unit of state.board) {
    if (!unit || typeof unit !== 'object' || Array.isArray(unit)
      || !validId(unit.id) || !sides.has(unit.side)
      || !cell({col: unit.col, row: unit.row}) || ids.has(unit.id)
      || occupied.has(key(unit))) throw new TypeError('INVALID_SERVER_MOVEMENT_BOARD');
    ids.add(unit.id); occupied.add(key(unit));
  }
  if (state.movedUnitIds.some(id => !ids.has(id))) throw new TypeError('INVALID_SERVER_MOVEMENT_STATE');
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)
    || !policy.maxStepsByUnit || typeof policy.maxStepsByUnit !== 'object'
    || Array.isArray(policy.maxStepsByUnit) || !Array.isArray(policy.blockedCells)
    || policy.blockedCells.length > 117) throw new TypeError('INVALID_SERVER_MOVEMENT_POLICY');
  for (const [id, value] of Object.entries(policy.maxStepsByUnit)) {
    if (!validId(id) || !ids.has(id) || !Number.isSafeInteger(value)
      || value < 0 || value > 32) throw new TypeError('INVALID_SERVER_MOVEMENT_POLICY');
  }
  const blocked = new Set();
  for (const entry of policy.blockedCells) {
    if (!cell(entry) || blocked.has(key(entry))) throw new TypeError('INVALID_SERVER_MOVEMENT_POLICY');
    blocked.add(key(entry));
  }
  return {occupied, blocked};
}

/**
 * path = successive destination hexes (origin excluded); each step must be
 * adjacent. A length <= configured maxSteps never permits jumping obstacles.
 * These are laboratory-only rules: no official unit/terrain effects or retreats.
 */
export function transitionSyntheticMovement(state, command, policy) {
  const {occupied, blocked} = verifyServerData(state, policy);
  if (!command || typeof command !== 'object' || Array.isArray(command)
    || command.type !== 'move_synthetic_unit' || !sides.has(command.actor)
    || !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0
    || !validId(command.unitId) || !Array.isArray(command.path)
    || command.path.length < 1 || command.path.length > 32
    || !command.path.every(cell)) return fail('INVALID_MOVE_COMMAND');
  const phase = state.phaseState;
  if (command.expectedRevision !== phase.revision) return fail('STALE_REVISION');
  if (command.actor !== phase.turn) return fail('NOT_ACTING_PLAYER');
  if (phase.phase !== 'MOVEMENT' || phase.pendingDecision != null) return fail('WRONG_PHASE');
  const unit = state.board.find(item => item.id === command.unitId);
  // Do not reveal which of nonexistent/enemy/unordered/already moved applies.
  if (!unit || unit.side !== phase.turn
    || !phase.orderedUnits.includes(unit.id)
    || state.movedUnitIds.includes(unit.id)) return fail('UNIT_NOT_ELIGIBLE');
  const maxSteps = policy.maxStepsByUnit[unit.id];
  if (!Object.hasOwn(policy.maxStepsByUnit, unit.id) || !Number.isSafeInteger(maxSteps) || maxSteps < 0 || maxSteps > 32)
    return fail('MOVEMENT_POLICY_UNAVAILABLE');
  if (command.path.length > maxSteps) return fail('MOVEMENT_LIMIT_EXCEEDED');
  const from = {col: unit.col, row: unit.row};
  let previous = from;
  const visited = new Set([key(from)]);
  for (const next of command.path) {
    const k = key(next);
    if (distance(previous, next) !== 1) return fail('NON_ADJACENT_STEP');
    if (visited.has(k)) return fail('REPEATED_HEX');
    if (blocked.has(k) || occupied.has(k)) return fail('MOVEMENT_BLOCKED');
    visited.add(k);
    previous = next;
  }
  const nextBoard = structuredClone(state.board);
  const changed = nextBoard.find(item => item.id === unit.id);
  changed.col = previous.col; changed.row = previous.row;
  const nextRevision = phase.revision + 1;
  const nextState = {
    board: nextBoard,
    movedUnitIds: [...state.movedUnitIds, unit.id],
    phaseState: {...structuredClone(phase), revision: nextRevision}
  };
  const event = {type: 'UNIT_MOVED_SIMULATED', sequence: nextRevision,
    side: phase.turn, unitId: unit.id, from, to: {...previous},
    path: command.path.map(p => ({col: p.col, row: p.row}))};
  return {accepted: true, nextState, events: [event]};
}
