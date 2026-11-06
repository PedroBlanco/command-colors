import test from 'node:test';
import assert from 'node:assert/strict';
import {BOARD_COLUMNS, BOARD_ROWS, inBounds, toCube, fromCube, distance, neighbors, allCells, pixelCenter, polygonPoints, sectorsFor} from './hex.mjs';

test('board: 117 hexágonos únicos dentro del rango', () => {
  const board = allCells();
  assert.equal(board.length, BOARD_COLUMNS * BOARD_ROWS);
  assert.equal(new Set(board.map(h => `${h.col},${h.row}`)).size, 117);
  assert.ok(board.every(h => inBounds(h)));
  assert.equal(inBounds({col: -1, row: 0}), false);
  assert.equal(inBounds({col: 13, row: 0}), false);
  assert.equal(inBounds({col: 0.5, row: 4}), false);
});

test('cube/offset: ida y vuelta en todas las celdas', () => {
  for (const cell of allCells()) assert.deepEqual(fromCube(toCube(cell)), cell);
  assert.throws(() => fromCube({x: 1, y: 1, z: 1}));
});

test('vecinos: simetría, distancia uno y límites', () => {
  for (const cell of allCells()) for (const other of neighbors(cell)) {
    assert.equal(distance(cell, other), 1);
    assert.ok(neighbors(other).some(c => c.col === cell.col && c.row === cell.row));
  }
  assert.equal(neighbors({col: 0, row: 0}).length, 2);
  assert.equal(neighbors({col: 6, row: 4}).length, 6);
  assert.throws(() => neighbors({col: -1, row: 4}), RangeError);
});

test('distancia: simétrica y triangular', () => {
  const a = {col: 0, row: 0}, b = {col: 6, row: 4}, c = {col: 12, row: 8};
  assert.equal(distance(a, a), 0);
  assert.equal(distance(a, b), distance(b, a));
  assert.ok(distance(a, c) <= distance(a, b) + distance(b, c));
});

test('SVG: centro del siguiente hexágono y seis vértices', () => {
  const a = pixelCenter({col: 0, row: 0}, 20), b = pixelCenter({col: 1, row: 0}, 20);
  assert.equal(b.x - a.x, 30);
  assert.ok(Math.abs(b.y - a.y - 10 * Math.sqrt(3)) < 1e-10);
  assert.equal(polygonPoints({col: 5, row: 4}).length, 6);
  assert.throws(() => pixelCenter({col: 0, row: 0}, 0), RangeError);
});

test('sectores: los hexágonos compartidos se modelan explícitamente', () => {
  assert.deepEqual(sectorsFor({col: 4, row: 3}, {'4,3': ['left', 'center']}), ['left', 'center']);
  assert.throws(() => sectorsFor({col: 4, row: 3}, {}), /validada/);
});
