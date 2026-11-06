/** Vista SVG sin reglas. Recibe exclusivamente la proyección pública del servidor. */
import {allCells, inBounds, pixelCenter, polygonPoints} from '../../packages/hex-grid/hex.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const RADIUS = 24;
const OX = 33;
const OY = 33;
export const BOARD_VIEWBOX = Object.freeze({x: 0, y: 0, width: 506, height: 426});

function createSvg(doc, tag, attributes = {}) {
  const el = doc.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, String(value));
  return el;
}

export function boardModel(publicBoard) {
  if (!Array.isArray(publicBoard) || publicBoard.length > 117) throw new TypeError('Tablero público inválido');
  const occupied = new Set();
  const units = publicBoard.map(unit => {
    if (!unit || typeof unit !== 'object' || !inBounds(unit)
      || typeof unit.id !== 'string' || unit.id.length < 1 || unit.id.length > 80
      || !['A', 'B'].includes(unit.side)) throw new TypeError('Unidad pública inválida');
    const key = `${unit.col},${unit.row}`;
    if (occupied.has(key)) throw new TypeError('Hexágono duplicado en el escenario sintético');
    occupied.add(key);
    const {x, y} = pixelCenter(unit, RADIUS, OX, OY);
    return {id: unit.id, side: unit.side, col: unit.col, row: unit.row, x, y};
  });
  const cells = allCells().map(cell => {
    const points = polygonPoints(cell, RADIUS, OX, OY)
      .map(({x, y}) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    return {...cell, key: `${cell.col},${cell.row}`, points};
  });
  return {cells, units};
}

export function renderBoard(svg, publicBoard, onSelect) {
  const {cells, units} = boardModel(publicBoard);
  const doc = svg.ownerDocument;
  const unitByCell = new Map(units.map(u => [`${u.col},${u.row}`, u]));
  const previousSelection = svg.dataset?.selectedCell ?? null;
  const group = createSvg(doc, 'g', {'aria-label': 'Tablero táctico de prueba'});
  let selected = null;
  let chosen = null;
  function choose(cell, el) {
    if (selected) { selected.classList.remove('selected'); selected.setAttribute('aria-pressed', 'false'); }
    selected = el;
    chosen = cell.key;
    el.classList.add('selected');
    el.setAttribute('aria-pressed', 'true');
    if (svg.dataset) svg.dataset.selectedCell = chosen;
    if (typeof onSelect === 'function') onSelect({col: cell.col, row: cell.row, unit: unitByCell.get(chosen) ?? null});
  }
  for (const cell of cells) {
    const hex = createSvg(doc, 'g', {
      role: 'button', tabindex: '0', 'aria-pressed': 'false',
      'aria-label': `Columna ${cell.col + 1}, fila ${cell.row + 1}${unitByCell.has(cell.key) ? ', ocupada' : ', vacía'}`
    });
    hex.classList.add('hex-target');
    hex.append(createSvg(doc, 'polygon', {points: cell.points, class: 'hex-shape'}));
    const handler = () => choose(cell, hex);
    hex.addEventListener('click', handler);
    hex.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); handler(); }
    });
    if (previousSelection === cell.key) {
      chosen = cell.key; selected = hex;
      hex.classList.add('selected'); hex.setAttribute('aria-pressed', 'true');
    }
    group.append(hex);
  }
  const unitLayer = createSvg(doc, 'g', {'aria-hidden': 'true', 'pointer-events': 'none'});
  for (const unit of units) {
    const token = createSvg(doc, 'g', {class: 'token'});
    token.append(createSvg(doc, 'rect', {x: unit.x - 16, y: unit.y - 13, width: 32, height: 26,
      rx: 5, fill: unit.side === 'A' ? '#285c83' : '#a0473d'}));
    const text = createSvg(doc, 'text', {x: unit.x, y: unit.y + 5, 'text-anchor': 'middle'});
    text.textContent = unit.side;
    token.append(text);
    unitLayer.append(token);
  }
  svg.replaceChildren(group, unitLayer);
  return {cells: cells.length, units: units.length, selection: chosen};
}
