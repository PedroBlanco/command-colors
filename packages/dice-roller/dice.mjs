/**
 * CCW-015/016 — dice capture contract, independent of any official ruleset.
 * The server selects actor, dieFaces, diceCount and rollId after authorization.
 * A client must NEVER supply the roll specification or random source.
 * Duplicate dieFaces are intentional: each slot has equal probability.
 */
import {randomInt} from 'node:crypto';

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const FACE = /^[A-Z][A-Z0-9_]{0,31}$/;
const MAX_DICE = 32;
const MAX_FACES = 16;

function validateSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new TypeError('INVALID_ROLL_SPEC');
  const {rollId, actor, diceCount, dieFaces} = spec;
  if (typeof rollId !== 'string' || !ID.test(rollId)) throw new TypeError('INVALID_ROLL_ID');
  if (actor !== 'A' && actor !== 'B') throw new TypeError('INVALID_ROLL_ACTOR');
  if (!Number.isSafeInteger(diceCount) || diceCount < 1 || diceCount > MAX_DICE) {
    throw new TypeError('INVALID_DICE_COUNT');
  }
  if (!Array.isArray(dieFaces) || dieFaces.length < 2 || dieFaces.length > MAX_FACES ||
      !dieFaces.every(face => typeof face === 'string' && FACE.test(face))) {
    throw new TypeError('INVALID_DIE_FACES');
  }
  return {rollId, actor, diceCount, dieFaces: [...dieFaces]};
}

function makeEvent({rollId, actor, diceCount}, source, results) {
  return {
    type: 'DICE_ROLLED_SYNTHETIC', rollId, actor, source, diceCount,
    results: [...results],
    verification: source === 'DIGITAL' ? 'SERVER_GENERATED' : 'PLAYER_DECLARED'
  };
}

/**
 * Cryptographically selected slot for each die. A randomIndex replacement is
 * intended for tests; production must use the default crypto.randomInt.
 * The return value contains no RNG seed and no undisclosed die-face order.
 */
export function generateDigitalRoll(spec, randomIndex = randomInt) {
  const validated = validateSpec(spec);
  if (typeof randomIndex !== 'function') throw new TypeError('INVALID_RANDOM_SOURCE');
  const results = [];
  for (let i = 0; i < validated.diceCount; i++) {
    const index = randomIndex(validated.dieFaces.length);
    if (!Number.isSafeInteger(index) || index < 0 || index >= validated.dieFaces.length) {
      throw new TypeError('INVALID_RANDOM_RESULT');
    }
    results.push(validated.dieFaces[index]);
  }
  return makeEvent(validated, 'DIGITAL', results);
}

/**
 * Record the player's physical dice WITHOUT treating the declaration as verified.
 * An authorized service must derive actor from the session, compare revisions,
 * enforce the chosen dice mode and persist the event with its idempotency key.
 */
export function recordPhysicalRoll(spec, declaredFaces) {
  const validated = validateSpec(spec);
  const legalFaces = new Set(validated.dieFaces);
  if (!Array.isArray(declaredFaces) || declaredFaces.length !== validated.diceCount ||
      !declaredFaces.every(face => typeof face === 'string' && legalFaces.has(face))) {
    throw new TypeError('INVALID_PHYSICAL_DECLARATION');
  }
  return makeEvent(validated, 'PHYSICAL', declaredFaces);
}
