import test from 'node:test';
import assert from 'node:assert/strict';
import {boardModel, renderBoard, BOARD_VIEWBOX} from './board-view.mjs';

class FakeNode {
  constructor(doc, tag) { this.ownerDocument = doc; this.tag = tag; this.attrs = {}; this.children = []; this.handlers = {}; this.dataset = {}; this.classes = new Set();
    this.classList = {add: value => this.classes.add(value), remove: value => this.classes.delete(value)}; }
  setAttribute(name, value) { this.attrs[name] = value; }
  addEventListener(name, fn) { this.handlers[name] = fn; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
}
const fakeSvg = () => { const doc = {createElementNS: (_ns, name) => new FakeNode(doc, name)}; return new FakeNode(doc, 'svg'); };

test('tablero de 117 hexágonos y límites del SVG', () => {
  const model = boardModel([]);
  assert.equal(model.cells.length, 117);
  assert.equal(model.units.length, 0);
  assert.equal(new Set(model.cells.map(c => c.key)).size, 117);
  assert.ok(model.cells.every(c => c.points.split(' ').length === 6));
  assert.ok(model.cells.every(c => c.points.split(' ').every(p => p.split(',').every(n => Number(n) >= 0))));
  assert.ok(BOARD_VIEWBOX.width > 480);
});

test('unidad sintética: posición válida, identidad propia y asignación', () => {
  const model = boardModel([{id:'x-123',side:'A',col:3,row:4}]);
  assert.equal(model.units.length,1);assert.equal(model.units[0].side,'A');
  assert.equal(model.units[0].col,3);assert.equal(model.units[0].row,4);
});

test('rechaza coordenadas, lados y colisiones inválidos', () => {
  assert.throws(() => boardModel([{id:'a',side:'A',col:13,row:0}]), /Unidad/);
  assert.throws(() => boardModel([{id:'a',side:'X',col:1,row:1}]), /Unidad/);
  assert.throws(() => boardModel([{id:'a',side:'A',col:1.1,row:1}]), /Unidad/);
  assert.throws(() => boardModel([{id:'a',side:'A',col:2,row:1},{id:'b',side:'B',col:2,row:1}]), /duplicado/);
  assert.throws(() => boardModel({board:[]}), /Tablero/);
});

test('renderizado SVG: 117 controles, unidades y eventos accesibles', () => {
  const svg=fakeSvg();let chosen=null;
  const result=renderBoard(svg,[{id:'a',side:'A',col:2,row:3}], value=>{chosen=value;});
  assert.equal(result.cells,117);assert.equal(result.units,1);
  assert.equal(svg.children.length,2);
  assert.equal(svg.children[0].children.length,117);
  const target=svg.children[0].children.find(c=>c.attrs['aria-label'].includes('Columna 3, fila 4'));
  assert.equal(target.attrs.role,'button');
  assert.equal(target.attrs.tabindex,'0');
  target.handlers.click();
  assert.deepEqual({col:chosen.col,row:chosen.row,unit:chosen.unit.id},{col:2,row:3,unit:'a'});
  assert.equal(target.attrs['aria-pressed'],'true');
  assert.equal(svg.dataset.selectedCell,'2,3');
  const changed=renderBoard(svg,[],()=>{});
  assert.equal(changed.selection,'2,3');
});

test('selección por teclado con Enter', () => {
  const svg=fakeSvg();let count=0;renderBoard(svg,[],()=>count++);
  const first=svg.children[0].children[0];let prevented=false;
  first.handlers.keydown({key:'Enter',preventDefault:()=>{prevented=true;}});
  assert.equal(count,1);assert.equal(prevented,true);
});
