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

/** Versioned topology. Legacy functions above intentionally remain unchanged. */
export const LAB_BOARD_GEOMETRY='LAB_ODD_Q_13X9';
export const OFFICIAL_BOARD_GEOMETRY='OFFICIAL_ODD_R_113';

const officialInBounds=({col,row})=>Number.isSafeInteger(col)&&Number.isSafeInteger(row)&&
  row>=0&&row<BOARD_ROWS&&col>=0&&col<BOARD_COLUMNS-(row&1);
const officialToCube=({col,row})=>{
  if(!Number.isSafeInteger(col)||!Number.isSafeInteger(row))throw TypeError('Coordenadas enteras requeridas');
  const z=row,x=col-(row-(row&1))/2;
  return {x,y:-x-z,z};
};
const officialFromCube=({x,y,z})=>{
  if(![x,y,z].every(Number.isSafeInteger)||x+y+z!==0)throw TypeError('Cubo hexagonal inválido');
  return {col:x+(z-(z&1))/2,row:z};
};
const officialCells=()=>Array.from({length:BOARD_ROWS},(_,row)=>
  Array.from({length:BOARD_COLUMNS-(row&1)},(_,col)=>({col,row}))).flat();
const officialCenter=({col,row},radius=24,originX=0,originY=0)=>{
  if(!Number.isFinite(radius)||radius<=0)throw RangeError('Radio inválido');
  return {x:originX+Math.sqrt(3)*radius*(col+(row&1)/2),y:originY+1.5*radius*row};
};
const officialPolygon=(cell,radius=24,originX=0,originY=0)=>{
  const {x,y}=officialCenter(cell,radius,originX,originY);
  return Array.from({length:6},(_,k)=>({x:x+radius*Math.cos((k+.5)*Math.PI/3),y:y+radius*Math.sin((k+.5)*Math.PI/3)}));
};
const officialDistance=(a,b)=>{
  const u=officialToCube(a),v=officialToCube(b);
  return Math.max(Math.abs(u.x-v.x),Math.abs(u.y-v.y),Math.abs(u.z-v.z));
};
const officialNeighbors=cell=>{
  if(!officialInBounds(cell))throw RangeError('Origen fuera del tablero');
  const {x,y,z}=officialToCube(cell);
  return CUBE_DIRECTIONS.map(d=>officialFromCube({x:x+d.x,y:y+d.y,z:z+d.z})).filter(officialInBounds);
};
const legacy=Object.freeze({
  id:LAB_BOARD_GEOMETRY,cellCount:117,inBounds,toCube,fromCube,allCells,neighbors,distance,pixelCenter,polygonPoints,
  depth:c=>2*c.row+(c.col&1),edgeNormalAngle:i=>(i+.5)*Math.PI/3
});
const official=Object.freeze({
  id:OFFICIAL_BOARD_GEOMETRY,cellCount:113,inBounds:officialInBounds,toCube:officialToCube,fromCube:officialFromCube,
  allCells:officialCells,neighbors:officialNeighbors,distance:officialDistance,pixelCenter:officialCenter,polygonPoints:officialPolygon,
  depth:c=>c.row,edgeNormalAngle:i=>(i+1)*Math.PI/3
});
export function getBoardGeometry(id=LAB_BOARD_GEOMETRY){
  if(id===LAB_BOARD_GEOMETRY)return legacy;
  if(id===OFFICIAL_BOARD_GEOMETRY)return official;
  throw TypeError('UNSUPPORTED_BOARD_GEOMETRY');
}

/** Fixed physical board sectors as viewed from the southern baseline (A).
 * The two vertical dividers cross centers in long rows and lie on edges in
 * short rows. B's relative flank labels are reversed by the game journal.
 */
export function officialSectorCells(){
  return Object.fromEntries(officialCells().map(({col,row})=>[
    col+','+row,row%2===0&&col===4?['LEFT','CENTER']:row%2===0&&col===8?['CENTER','RIGHT']:
      col<4?['LEFT']:col<8?['CENTER']:['RIGHT']
  ]));
}
