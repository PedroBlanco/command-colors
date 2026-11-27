import test from 'node:test';
import assert from 'node:assert/strict';
import {BOARD_COLUMNS, BOARD_ROWS, inBounds, toCube, fromCube, distance, neighbors, allCells, pixelCenter, polygonPoints, sectorsFor,getBoardGeometry,OFFICIAL_BOARD_GEOMETRY,officialSectorCells} from './hex.mjs';

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

test('official board: 113 cells, exact edges, reversible coordinates, mirrored sectors',()=>{
 const g=getBoardGeometry(OFFICIAL_BOARD_GEOMETRY),cells=g.allCells(),sectors=officialSectorCells();
 assert.equal(cells.length,113);assert.equal(Object.keys(sectors).length,113);
 for(const c of cells){
  assert.deepEqual(g.fromCube(g.toCube(c)),c);
  assert.equal(g.inBounds(c),true);
  const reverse={col:12-(c.row&1)-c.col,row:8-c.row};
  assert.equal(g.inBounds(reverse),true);
  assert.deepEqual(sectors[`${reverse.col},${reverse.row}`],sectors[`${c.col},${c.row}`].map(s=>s==='LEFT'?'RIGHT':s==='RIGHT'?'LEFT':s).reverse());
  for(const n of g.neighbors(c)){
   assert.equal(g.distance(c,n),1);
   assert.ok(g.neighbors(n).some(h=>h.col===c.col&&h.row===c.row));
   const a=g.pixelCenter(c,1),b=g.pixelCenter(n,1);
   assert.ok(Math.abs(Math.hypot(a.x-b.x,a.y-b.y)-Math.sqrt(3))<1e-10);
  }
 }
 assert.equal(g.inBounds({col:12,row:1}),false);
 assert.equal(g.neighbors({col:0,row:0}).length,2);
 assert.equal(g.neighbors({col:6,row:4}).length,6);
 assert.deepEqual(sectors['4,4'],['LEFT','CENTER']);
 assert.deepEqual(sectors['4,3'],['CENTER']);
 assert.equal(getBoardGeometry().allCells().length,117);
 assert.throws(()=>getBoardGeometry('UNKNOWN'),/UNSUPPORTED_BOARD_GEOMETRY/);
});
