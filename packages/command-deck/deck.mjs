/**
 * CCW-012: secret command-card deck with opaque, unique card-instance IDs.
 * Pure state transitions integrated with the *synthetic* CCW-011 turn phases.
 * No official card content, scenario setup or Ancients rules are embedded.
 * Only server code may hold full snapshots; clients receive projectHand().
 */
import {randomInt} from 'node:crypto';
import {initialSyntheticTurn, transitionSyntheticTurn} from '../turn-phase/phase.mjs';

const KIND = 'opaque-command-deck-v1';
const CARD_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SIDES = ['A', 'B'];
const MAX_CARDS = 512;
const fail = reason => ({accepted: false, reason});
const clone = value => structuredClone(value);

function validCards(items) {
  return Array.isArray(items) && items.every(id => typeof id === 'string' && CARD_ID.test(id));
}

/** Fisher–Yates, crypto.randomInt by default; injected index source ONLY for tests. */
export function shuffleCardIds(cardIds, randomIndex = randomInt) {
  if (!validCards(cardIds) || cardIds.length < 1 || cardIds.length > MAX_CARDS || new Set(cardIds).size !== cardIds.length) {
    throw new TypeError('INVALID_CARD_INSTANCES');
  }
  if (typeof randomIndex !== 'function') throw new TypeError('INVALID_RANDOM_SOURCE');
  const shuffled = [...cardIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    if (!Number.isSafeInteger(j) || j < 0 || j > i) throw new TypeError('INVALID_RANDOM_RESULT');
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Deal explicit scenario-specific hand sizes, without encoding any game's named cards.
 * Top of draw pile is its final element, so pop() is a hidden, constant-time draw.
 */
export function createCommandSession({cardIds, handSizes, startingSide = 'A', randomIndex} = {}) {
  if (!handSizes || !SIDES.every(side => Number.isSafeInteger(handSizes[side]) && handSizes[side] >= 1 && handSizes[side] <= 100)
      || !validCards(cardIds) || handSizes.A + handSizes.B > cardIds.length) {
    throw new TypeError('INVALID_SETUP');
  }
  const pile = shuffleCardIds(cardIds, randomIndex);
  const hands = {A: [], B: []};
  for (const side of SIDES) for (let n = 0; n < handSizes[side]; n++) hands[side].push(pile.pop());
  return {
    schemaVersion: 1, kind: KIND,
    phaseState: initialSyntheticTurn({startingSide}),
    handSizes: {A: handSizes.A, B: handSizes.B},
    totalCards: cardIds.length,
    drawPile: pile, hands, discardPile: [], activeCard: null
  };
}

/** Reject corrupt saved snapshots, duplicate instances and inconsistent phase/card coupling. */
export function assertCommandSnapshot(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.kind !== KIND
      || !Number.isSafeInteger(snapshot.totalCards) || snapshot.totalCards < 1 || snapshot.totalCards > MAX_CARDS
      || !snapshot.handSizes || !SIDES.every(side => Number.isSafeInteger(snapshot.handSizes[side])
        && snapshot.handSizes[side] >= 1 && snapshot.handSizes[side] <= 100)
      || !validCards(snapshot.drawPile) || !validCards(snapshot.discardPile)
      || !snapshot.hands || !SIDES.every(side => validCards(snapshot.hands[side]))
      || !(snapshot.activeCard === null || (typeof snapshot.activeCard === 'string' && CARD_ID.test(snapshot.activeCard)))) {
    throw new TypeError('COMMAND_SNAPSHOT_INVALID');
  }
  const all = [...snapshot.drawPile, ...snapshot.hands.A, ...snapshot.hands.B,
    ...snapshot.discardPile, ...(snapshot.activeCard === null ? [] : [snapshot.activeCard])];
  if (all.length !== snapshot.totalCards || new Set(all).size !== all.length) throw new TypeError('CARD_CONSERVATION_FAILED');
  const phase = snapshot.phaseState;
  // Do not trust stored JSON phase state: invoke the validating phase reducer with a harmless stale command.
  try {
    if (!phase || !SIDES.includes(phase.turn) || !Number.isSafeInteger(phase.revision)
      || !Number.isSafeInteger(phase.schemaVersion) || phase.schemaVersion !== 1) throw Error('phase');
    const validation = transitionSyntheticTurn(phase, {type: '__validate_only__', actor: phase.turn, expectedRevision: -1});
    if (validation.accepted) throw Error('unexpected validation transition');
  } catch { throw new TypeError('COMMAND_PHASE_INVALID'); }
  if ((phase.playedCard ?? null) !== snapshot.activeCard
      || (phase.phase === 'AWAIT_CARD' && snapshot.activeCard !== null)
      || (phase.phase !== 'AWAIT_CARD' && snapshot.activeCard === null)) {
    throw new TypeError('PHASE_CARD_MISMATCH');
  }
  return true;
}

/** Public discard pile and quantities, but ONLY the requesting player's hand. */
export function projectCommandSession(snapshot, actor) {
  assertCommandSnapshot(snapshot);
  if (!SIDES.includes(actor)) return null;
  const other = actor === 'A' ? 'B' : 'A';
  const phase = snapshot.phaseState;
  return {
    revision: phase.revision, you: actor, turn: phase.turn,
    phase: phase.phase,
    actingSide: phase.pendingDecision?.actor ?? phase.turn,
    yourHand: [...snapshot.hands[actor]],
    opponentCardCount: snapshot.hands[other].length,
    drawPileCount: snapshot.drawPile.length,
    discardPile: [...snapshot.discardPile],
    cardInPlay: snapshot.activeCard,
    pendingDecision: phase.pendingDecision ? clone(phase.pendingDecision) : null
  };
}

/**
 * Authorized caller must derive `command.actor` from a server session, never browser JSON.
 * No random calls occur during transitions; redraws consume the already-secret pile.
 * Rejections cannot modify the caller's snapshot. Persistence/idempotency are external.
 */
export function transitionCommandSession(snapshot, command) {
  assertCommandSnapshot(snapshot);
  const phase = transitionSyntheticTurn(snapshot.phaseState, command);
  if (!phase.accepted) return fail(phase.rejection);
  const next = clone(snapshot);
  const actor = command.actor;
  if (command.type === 'play_synthetic_card') {
    const pos = next.hands[actor].indexOf(command.cardRef);
    if (pos < 0) return fail('CARD_NOT_IN_OWN_HAND');
    next.hands[actor].splice(pos, 1);
    next.activeCard = command.cardRef;
  }
  if (command.type === 'acknowledge_synthetic_draw') {
    next.discardPile.push(next.activeCard);
    next.activeCard = null;
    if (next.drawPile.length > 0) next.hands[actor].push(next.drawPile.pop());
  }
  next.phaseState = phase.nextState;
  assertCommandSnapshot(next);
  // The public event must not leak the newly drawn card or the hidden pile's order.
  return {accepted: true, nextState: next, events: phase.events};
}
