/**
 * CCW-014: builder for a movement path selected on a future SVG board.
 * Only reads the player's authorized board projection. This is NOT a rules
 * engine: the SQLite server decides orders, movement range and terrain.
 */
import {distance, inBounds} from '../hex-grid/hex.mjs';
import {deckActions} from './deck-controls.mjs';

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const key = cell => `${cell.col},${cell.row}`;
const coordinates = cell => ({col: cell.col, row: cell.row});

function ownUnit(view, unitId) {
  if (!deckActions(view).includes('move_synthetic_unit')) throw new Error('MOVIMIENTO_NO_DISPONIBLE');
  if (!Array.isArray(view.movedUnitIds) || !Array.isArray(view.board)
      || view.board.length > 117 || view.movedUnitIds.length > 117) {
    throw new Error('VISTA_TABLERO_INVALIDA');
  }
  const ids = new Set(), locations = new Set();
  for (const unit of view.board) {
    if (!unit || typeof unit !== 'object' || Array.isArray(unit)
        || typeof unit.id !== 'string' || !IDENTIFIER.test(unit.id)
        || !['A', 'B'].includes(unit.side) || !inBounds(unit)
        || ids.has(unit.id) || locations.has(key(unit))) throw new Error('VISTA_TABLERO_INVALIDA');
    ids.add(unit.id); locations.add(key(unit));
  }
  if (typeof unitId !== 'string' || !IDENTIFIER.test(unitId)) throw new Error('UNIDAD_NO_PROPIA');
  const unit = view.board.find(item => item.id === unitId);
  if (!unit || unit.side !== view.you) throw new Error('UNIDAD_NO_PROPIA');
  if (view.movedUnitIds.includes(unitId)) throw new Error('UNIDAD_YA_MOVIDA');
  return unit;
}

function checkedDraft(view, draft) {
  const unit = ownUnit(view, draft?.unitId);
  if (!draft || !Number.isSafeInteger(draft.revision) || draft.revision !== view.revision
      || !draft.origin || !inBounds(draft.origin) || key(draft.origin) !== key(unit)) {
    throw new Error('BORRADOR_DESACTUALIZADO');
  }
  if (!Array.isArray(draft.path) || draft.path.length > 32) throw new Error('RUTA_INVALIDA');
  const occupied = new Set(view.board.map(key));
  const visited = new Set([key(unit)]);
  let last = coordinates(unit);
  for (const step of draft.path) {
    if (!step || typeof step !== 'object' || Array.isArray(step) || !inBounds(step)) throw new Error('HEX_INVALIDO');
    if (visited.has(key(step))) throw new Error('HEX_REPETIDO');
    if (distance(last, step) !== 1) throw new Error('HEX_NO_ADYACENTE');
    if (occupied.has(key(step))) throw new Error('HEX_OCUPADO');
    visited.add(key(step));
    last = coordinates(step);
  }
  return {unit, last, visited, occupied};
}

/** Called when a player selects one of their unmoved units. */
export function beginMovementDraft(view, unitId) {
  const unit = ownUnit(view, unitId);
  return {unitId: unit.id, revision: view.revision, origin: coordinates(unit), path: []};
}

/** Append a *geometrically* valid step; no official movement limits here. */
export function appendMovementHex(view, draft, destination) {
  const {last, visited, occupied} = checkedDraft(view, draft);
  if (!destination || typeof destination !== 'object' || Array.isArray(destination) || !inBounds(destination)) {
    throw new Error('HEX_INVALIDO');
  }
  if (draft.path.length === 32) throw new Error('RUTA_DEMASIADO_LARGA');
  if (visited.has(key(destination))) throw new Error('HEX_REPETIDO');
  if (distance(last, destination) !== 1) throw new Error('HEX_NO_ADYACENTE');
  if (occupied.has(key(destination))) throw new Error('HEX_OCUPADO');
  return {unitId: draft.unitId, revision: draft.revision, origin: coordinates(draft.origin),
    path: [...draft.path.map(coordinates), coordinates(destination)]};
}

/** Local undo, with no request to the game server. */
export function undoMovementHex(view, draft) {
  checkedDraft(view, draft);
  return {unitId: draft.unitId, revision: draft.revision, origin: coordinates(draft.origin),
    path: draft.path.slice(0, -1).map(coordinates)};
}

/** The existing deckCommand() will add actor-free revision and idempotency. */
export function movementDraftFields(view, draft) {
  checkedDraft(view, draft);
  if (draft.path.length === 0) throw new Error('RUTA_VACIA');
  return {unitId: draft.unitId, path: draft.path.map(coordinates)};
}
