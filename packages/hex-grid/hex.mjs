/** Geometría hexagonal sin reglas de juego ni contenido oficial. Coordenadas odd-q. */
export const BOARD_COLUMNS = 13;
export const BOARD_ROWS = 9;

export function inBounds({col, row}, columns = BOARD_COLUMNS, rows = BOARD_ROWS) {
  return Number.isInteger(col) && Number.isInteger(row) && col >= 0 && col < columns && row >= 0 && row < rows;
}

export function toCube({col, row}) {
  if (!Number.isInteger(col) || !Number.isInteger(row)) throw new TypeError('Coordenadas enteras requeridas');
  const x = col, z = row - (col - (col & 1)) / 2;
  return {x, y: -x - z, z};
}

export function fromCube({x, y, z}) {
  if (![x, y, z].every(Number.isInteger) || x + y + z !== 0) throw new TypeError('Cubo hexagonal inválido');
  return {col: x, row: z + (x - (x & 1)) / 2};
}

const CUBE_DIRECTIONS = [
  {x: 1, y: -1, z: 0}, {x: 1, y: 0, z: -1}, {x: 0, y: 1, z: -1},
  {x: -1, y: 1, z: 0}, {x: -1, y: 0, z: 1}, {x: 0, y: -1, z: 1}
];

export function distance(a, b) {
  const u = toCube(a), v = toCube(b);
  return Math.max(Math.abs(u.x - v.x), Math.abs(u.y - v.y), Math.abs(u.z - v.z));
}

export function neighbors(cell, columns = BOARD_COLUMNS, rows = BOARD_ROWS) {
  if (!inBounds(cell, columns, rows)) throw new RangeError('Origen fuera del tablero');
  const {x, y, z} = toCube(cell);
  return CUBE_DIRECTIONS.map(d => fromCube({x: x + d.x, y: y + d.y, z: z + d.z}))
    .filter(c => inBounds(c, columns, rows));
}

export function allCells(columns = BOARD_COLUMNS, rows = BOARD_ROWS) {
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1) throw new RangeError('Dimensiones inválidas');
  return Array.from({length: columns * rows}, (_, i) => ({col: Math.floor(i / rows), row: i % rows}));
}

/** Centros para hexágonos de cima plana; el origen y radio son configurables. */
export function pixelCenter({col, row}, radius = 24, originX = 0, originY = 0) {
  if (!Number.isFinite(radius) || radius <= 0) throw new RangeError('Radio inválido');
  return {x: originX + 1.5 * radius * col, y: originY + Math.sqrt(3) * radius * (row + (col & 1) / 2)};
}

export function polygonPoints(cell, radius = 24, originX = 0, originY = 0) {
  const {x, y} = pixelCenter(cell, radius, originX, originY);
  return Array.from({length: 6}, (_, k) => ({x: x + radius * Math.cos(k * Math.PI / 3), y: y + radius * Math.sin(k * Math.PI / 3)}));
}

/** Secciones dependientes de datos externos; NO codifica fronteras oficiales. */
export function sectorsFor(cell, membership) {
  if (!inBounds(cell)) throw new RangeError('Celda inválida');
  const sectors = membership?.[`${cell.col},${cell.row}`];
  if (!Array.isArray(sectors) || sectors.length === 0 || sectors.some(s => !['left', 'center', 'right'].includes(s))) {
    throw new Error('Falta asignación validada de sectores');
  }
  return [...new Set(sectors)];
}
