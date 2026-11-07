/** Prueba de concepto de almacenamiento de partidas: no es un motor ni una API segura. */
import {mkdir, open, readFile, rename, rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

const VERSION = 1;
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

function clone(value) { return structuredClone(value); }

/** Datos enteramente sintéticos para probar persistencia, sin recursos GMT. */
export function syntheticMatch() {
  return {
    schemaVersion: VERSION, matchId: 'synthetic-local-001', revision: 0, status: 'ACTIVE',
    players: ['A', 'B'], turn: 'A',
    board: [{id: 'unit-a', side: 'A', col: 3, row: 4}, {id: 'unit-b', side: 'B', col: 9, row: 4}],
    hands: {A: ['PRIVATE_A_1', 'PRIVATE_A_2'], B: ['PRIVATE_B_1', 'PRIVATE_B_2', 'PRIVATE_B_3']},
    deck: ['UNREVEALED_1'], events: [], idempotency: {}
  };
}

function validate(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== VERSION || typeof snapshot.matchId !== 'string'
      || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0
      || snapshot.status !== 'ACTIVE' || !Array.isArray(snapshot.players)
      || snapshot.players.length !== 2 || !snapshot.players.every(x => typeof x === 'string')
      || snapshot.players[0] === snapshot.players[1] || !snapshot.players.includes(snapshot.turn)
      || !Array.isArray(snapshot.board) || !snapshot.hands || !Array.isArray(snapshot.deck)
      || !snapshot.players.every(p => Array.isArray(snapshot.hands[p]))
      || !Array.isArray(snapshot.events) || !snapshot.idempotency || Array.isArray(snapshot.idempotency)
      || typeof snapshot.idempotency !== 'object') {
    throw new Error('SNAPSHOT_INVALID');
  }
  if (snapshot.events.length !== snapshot.revision) throw new Error('SNAPSHOT_REVISION_MISMATCH');
  return clone(snapshot);
}

/** Proyección filtrada. Ni el mazo ni la mano ajena salen de esta función. */
function project(snapshot, actor) {
  if (!snapshot.players.includes(actor)) return null;
  const opponent = snapshot.players.find(p => p !== actor);
  return {
    matchId: snapshot.matchId, revision: snapshot.revision,
    status: snapshot.status, turn: snapshot.turn, you: actor,
    board: clone(snapshot.board), yourHand: clone(snapshot.hands[actor]),
    opponentCardCount: snapshot.hands[opponent].length
  };
}

/** Contrato de transacción serial por instancia. La implementación SQL vendrá después. */
export function createMatchStore({snapshot = syntheticMatch(), commitSnapshot = async () => {}} = {}) {
  let current = validate(snapshot);
  let queue = Promise.resolve();
  function view(actor) { return project(current, actor); }
  function publicEvents(actor) {
    if (!current.players.includes(actor)) return null;
    return clone(current.events.filter(event => event.visibility === 'public'));
  }
  function dispatch(request) {
    const run = async () => {
      const {actor, type, expectedRevision, idempotencyKey} = request ?? {};
      if (!current.players.includes(actor)) return {status: 403, code: 'FORBIDDEN'};
      if (type !== 'pass_demo_turn' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
          || typeof idempotencyKey !== 'string' || !KEY_PATTERN.test(idempotencyKey)) {
        return {status: 400, code: 'INVALID_COMMAND'};
      }
      const key = `${actor}:${idempotencyKey}`;
      const signature = `${type}:${expectedRevision}`;
      const replay = Object.hasOwn(current.idempotency, key) ? current.idempotency[key] : null;
      if (replay) {
        if (replay.signature !== signature) return {status: 409, code: 'IDEMPOTENCY_KEY_REUSED'};
        return {status: 200, code: 'ALREADY_APPLIED', view: project(current, actor)};
      }
      if (expectedRevision !== current.revision) {
        return {status: 409, code: 'STALE_REVISION', view: project(current, actor)};
      }
      if (current.turn !== actor) return {status: 403, code: 'NOT_YOUR_TURN', view: project(current, actor)};
      const next = clone(current);
      next.revision += 1;
      next.turn = next.players.find(p => p !== actor);
      next.events.push({sequence: next.revision, type: 'DEMO_TURN_PASSED', actor, visibility: 'public'});
      next.idempotency[key] = {signature, committedRevision: next.revision};
      // El estado visible se cambia SOLO tras finalizar correctamente el commit.
      await commitSnapshot(clone(next));
      current = next;
      return {status: 200, code: 'APPLIED', view: project(current, actor)};
    };
    const result = queue.then(run);
    queue = result.then(() => {}, () => {}); // mantener cola operativa tras error de E/S
    return result;
  }
  return {view, publicEvents, dispatch};
}

/** Un único proceso, un único fichero, solamente para pruebas locales. No usar como DB real. */
export async function openLocalFileStore(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new TypeError('Ruta requerida');
  let snapshot;
  try {
    snapshot = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error; // no sobrescribir corrupción
    snapshot = syntheticMatch();
  }
  snapshot = validate(snapshot);
  async function commitSnapshot(next) {
    await mkdir(dirname(filePath), {recursive: true});
    const tempPath = `${filePath}.${randomUUID()}.tmp`;
    try {
      const file = await open(tempPath, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(next)); await file.sync(); }
      finally { await file.close(); }
      await rename(tempPath, filePath);
    } catch (error) {
      await rm(tempPath, {force: true}).catch(() => {});
      throw error;
    }
  }
  // Crear el primer snapshot comprobado si no existía; evita depender de la primera acción.
  try { await readFile(filePath); }
  catch (error) { if (error.code === 'ENOENT') await commitSnapshot(snapshot); else throw error; }
  return createMatchStore({snapshot, commitSnapshot});
}
