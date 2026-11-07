/**
 * CCW-012 laboratory SQLite adapter for opaque command cards.
 * Integrates with the existing v1 six-table schema; no migration necessary.
 * Not a rules engine: all command types and cards are synthetic.
 * The HTTP gateway MUST derive actor from an authenticated participant.
 */
import {createCommandSession, assertCommandSnapshot, projectCommandSession, transitionCommandSession} from './deck.mjs';
import {validateSyntheticOrderAssignment} from '../order-validator/validator.mjs';
import {createServerSyntheticOrderContext} from '../order-validator/server-context.mjs';
import {transitionSyntheticMovement} from '../movement/movement.mjs';
import {createServerSyntheticMovementPolicy} from '../movement/server-policy.mjs';

const KEY = /^[A-Za-z0-9_-]{8,80}$/;
const TYPES = new Set([
  'play_synthetic_card', 'assign_synthetic_orders', 'undo_synthetic_orders',
  'finish_synthetic_movement', 'ask_synthetic_defense',
  'answer_synthetic_defense', 'finish_synthetic_combat', 'acknowledge_synthetic_draw',
  'move_synthetic_unit'
]);
const SYNTHETIC_CARDS = Object.freeze(Array.from({length: 18}, (_, i) => `synthetic_card_${String(i + 1).padStart(2, '0')}`));
const deny = (status, code) => ({status, code});

function getPrivateState(row, matchId) {
  if (!row || row.id !== matchId || row.guest_id === null) throw new Error('MATCH_NOT_READY');
  const state = JSON.parse(row.private_state);
  if (state.schemaVersion !== 1 || state.matchId !== matchId || !Array.isArray(state.board)) throw new Error('CORRUPT_MATCH');
  return state;
}

export function hasCommandDeck(row) {
  return !!row && Object.hasOwn(JSON.parse(row.private_state), 'commandSession');
}

function project(row, matchId, actor) {
  if (!['A', 'B'].includes(actor)) return null;
  const state = getPrivateState(row, matchId);
  if (!Object.hasOwn(state, 'commandSession')) throw new Error('COMMAND_DECK_NOT_INITIALIZED');
  assertCommandSnapshot(state.commandSession);
  if (row.game_revision !== state.commandSession.phaseState.revision) throw new Error('COMMAND_REVISION_MISMATCH');
  const view = projectCommandSession(state.commandSession, actor);
  return {matchId, status: 'ACTIVE', board: structuredClone(state.board), ...view};
}

function semanticCommand(request) {
  const type = request?.type;
  if (!TYPES.has(type)) return null;
  const fields = {};
  if (type === 'play_synthetic_card') fields.cardRef = request.cardRef;
  if (type === 'assign_synthetic_orders') fields.unitIds = request.unitIds;
  if (type === 'ask_synthetic_defense') fields.targetUnit = request.targetUnit;
  if (type === 'answer_synthetic_defense') fields.choice = request.choice;
  if (type === 'move_synthetic_unit') { fields.unitId = request.unitId; fields.path = request.path; }
  return {type, fields};
}

/**
 * getRow: prepared SELECT * FROM matches WHERE id=?
 * atomic: synchronous BEGIN IMMEDIATE / COMMIT / ROLLBACK transaction.
 * db: current open SQLite connection, only inside the server composition.
 */
export function createSqliteCommandDeckStore({db, matchId, getRow, atomic}) {
  if (!db || typeof getRow !== 'function' || typeof atomic !== 'function' || typeof matchId !== 'string') {
    throw new TypeError('INVALID_DECK_DEPENDENCIES');
  }
  function view(actor) { return project(getRow(matchId), matchId, actor); }
  function initialize(actor) {
    if (actor !== 'A') return deny(403, 'FORBIDDEN');
    return atomic(() => {
      const row = getRow(matchId);
      const state = getPrivateState(row, matchId);
      if (row.game_revision !== 0 || Object.hasOwn(state, 'commandSession')) return deny(409, 'DECK_ALREADY_STARTED');
      // Server-owned scenario-independent placeholder: never trust card IDs/sizes from a browser.
      const session = createCommandSession({cardIds: SYNTHETIC_CARDS, handSizes: {A: 2, B: 3}});
      state.commandSession = session;
      // This is an invented laboratory policy; never accept movement range from HTTP.
      createServerSyntheticMovementPolicy(state.board);
      state.movedUnitIds = [];
      db.prepare('UPDATE matches SET private_state=?, lobby_revision=lobby_revision+1 WHERE id=?')
        .run(JSON.stringify(state), matchId);
      const updated = {...row, private_state: JSON.stringify(state)};
      return {status: 201, code: 'DECK_INITIALIZED', view: project(updated, matchId, actor)};
    });
  }
  function dispatch(request = {}) {
    const {actor, expectedRevision, idempotencyKey} = request;
    if (!['A', 'B'].includes(actor)) return deny(403, 'FORBIDDEN');
    const semantic = semanticCommand(request);
    if (!semantic || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
        typeof idempotencyKey !== 'string' || !KEY.test(idempotencyKey)) return deny(400, 'INVALID_COMMAND');
    // Record *semantic* parameters in the idempotency signature; reusing one
    // request key for another card, order or decision must be rejected.
    const signature = JSON.stringify([semantic.type, expectedRevision, semantic.fields]);
    return atomic(() => {
      const row = getRow(matchId);
      const state = getPrivateState(row, matchId);
      if (!Object.hasOwn(state, 'commandSession')) return deny(409, 'DECK_NOT_INITIALIZED');
      assertCommandSnapshot(state.commandSession);
      if (state.commandSession.phaseState.revision !== row.game_revision) throw new Error('COMMAND_REVISION_MISMATCH');
      const previous = db.prepare('SELECT signature FROM game_commands WHERE match_id=? AND actor=? AND idem_key=?')
        .get(matchId, actor, idempotencyKey);
      if (previous) return previous.signature === signature
        ? {status: 200, code: 'ALREADY_APPLIED', view: project(row, matchId, actor)}
        : deny(409, 'IDEMPOTENCY_KEY_REUSED');
      if (row.game_revision !== expectedRevision) return {status: 409, code: 'STALE_REVISION', view: project(row, matchId, actor)};
      let approvedCommand = {actor, type: semantic.type, expectedRevision, ...semantic.fields};
      // Enforce CCW-013 at the authoritative transaction boundary. Both the
      // board and card profile come from server-owned persistent state, never
      // the request. Wrong-phase commands still use the normal phase reducer.
      if (semantic.type === 'assign_synthetic_orders' &&
          state.commandSession.phaseState.phase === 'ASSIGN_ORDERS') {
        const checked = validateSyntheticOrderAssignment(
          state.commandSession, approvedCommand,
          createServerSyntheticOrderContext(state.board, state.commandSession.activeCard)
        );
        if (!checked.accepted) {
          const code = checked.reason;
          return {status: code === 'NOT_ACTING_PLAYER' ? 403 : code === 'STALE_REVISION' ? 409 : 400,
            code, view: project(row, matchId, actor)};
        }
        approvedCommand = checked.command;
      }
      // Once a unit has moved, undoing its orders is no longer nonrandom
      // and reversible. No hidden move is erased by a later order edit.
      if (semantic.type === 'undo_synthetic_orders' && state.movedUnitIds?.length > 0) {
        return {status: 409, code: 'UNDO_NOT_AVAILABLE_AFTER_MOVEMENT', view: project(row, matchId, actor)};
      }
      let result;
      if (semantic.type === 'move_synthetic_unit') {
        // Older laboratory snapshots without tracking must fail closed.
        if (!Array.isArray(state.movedUnitIds)) return deny(409, 'MOVEMENT_STATE_UNAVAILABLE');
        result = transitionSyntheticMovement({
          board: state.board, movedUnitIds: state.movedUnitIds,
          phaseState: state.commandSession.phaseState
        }, approvedCommand, createServerSyntheticMovementPolicy(state.board));
        if (result.accepted) {
          state.board = result.nextState.board;
          state.movedUnitIds = result.nextState.movedUnitIds;
          state.commandSession.phaseState = result.nextState.phaseState;
          assertCommandSnapshot(state.commandSession);
        }
      } else {
        result = transitionCommandSession(state.commandSession, approvedCommand);
        if (result.accepted) {
          state.commandSession = result.nextState;
          if (semantic.type === 'acknowledge_synthetic_draw') state.movedUnitIds = [];
        }
      }
      if (!result.accepted) {
        const code = result.reason;
        return {status: code === 'NOT_ACTING_PLAYER' ? 403 : code === 'STALE_REVISION' ? 409 : 400,
          code, view: project(row, matchId, actor)};
      }
      const revision = state.commandSession.phaseState.revision;
      if (revision !== row.game_revision + 1 || result.events.length !== 1) throw new Error('COMMAND_SEQUENCE_INVALID');
      db.prepare('UPDATE matches SET game_revision=?, private_state=? WHERE id=? AND game_revision=?')
        .run(revision, JSON.stringify(state), matchId, row.game_revision);
      const event = result.events[0];
      db.prepare('INSERT INTO game_events(match_id,sequence,visibility,payload) VALUES (?,?,?,?)')
        .run(matchId, revision, 'public', JSON.stringify({...event, visibility: 'public'}));
      db.prepare('INSERT INTO game_commands(match_id,actor,idem_key,signature,committed_revision) VALUES (?,?,?,?,?)')
        .run(matchId, actor, idempotencyKey, signature, revision);
      return {status: 200, code: 'APPLIED', view: project({...row,game_revision:revision,private_state:JSON.stringify(state)}, matchId, actor)};
    });
  }
  return Object.freeze({view, initialize, dispatch});
}
