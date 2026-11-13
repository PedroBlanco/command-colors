/**
 * CCW-014: small SVG board for the authenticated LOCAL browser laboratory.
 * Visual decisions are reversible previews; only a confirmed request reaches
 * the server, which remains authoritative. No licensed assets or game rules.
 */
import {allCells, pixelCenter, polygonPoints} from '../hex-grid/hex.mjs';
import {deckActions} from './deck-controls.mjs';
import {beginMovementDraft, appendMovementHex, undoMovementHex, movementDraftFields} from './hex-selection.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const RADIUS = 24, OX = 35, OY = 34;
// The SYNTHETIC scenario now starts on opposite long edges of a
// LANDSCAPE 13 × 9 board. Rotate only the B viewer 180 degrees; do not
// transform stored odd-q coordinates or the server's authoritative moves.
const DISPLAY_WIDTH = 510, DISPLAY_HEIGHT = 430;
function displayPoint(point, viewer) {
  return viewer === 'B'
    ? {x:DISPLAY_WIDTH-point.x,y:DISPLAY_HEIGHT-point.y}
    : point;
}
const boardCells = allCells();
const key = ({col,row}) => `${col},${row}`;

function svgNode(doc, name, attrs = {}) {
  const node = doc.createElementNS(SVG_NS,name);
  for (const [attribute,value] of Object.entries(attrs)) node.setAttribute(attribute,String(value));
  return node;
}

/** Render public cells/units with keyboard and pointer selection. */
export function renderMovementBoard(svg, board, draft, onSelect, viewer='A') {
  if (!svg?.ownerDocument?.createElementNS || !Array.isArray(board) || board.length > 117 ||
      !['A','B'].includes(viewer)) {
    throw new TypeError('INVALID_MOVEMENT_BOARD_VIEW');
  }
  const doc = svg.ownerDocument;
  const cellsById = new Map();
  const units = new Map();
  for (const unit of board) {
    if (!unit || !Number.isSafeInteger(unit.col) || !Number.isSafeInteger(unit.row)
      || unit.col < 0 || unit.col > 12 || unit.row < 0 || unit.row > 8
      || typeof unit.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(unit.id)
      || !['A','B'].includes(unit.side) || units.has(unit.id) || cellsById.has(key(unit))) {
      throw new TypeError('INVALID_MOVEMENT_BOARD_VIEW');
    }
    units.set(unit.id,unit);
    cellsById.set(key(unit),unit);
  }
  const marked = new Map((draft?.path ?? []).map((step,index) => [key(step),index+1]));
  // One Tab stop on the board; arrow keys navigate cells. Preserve DOM focus
  // through redraws, otherwise Enter would strand keyboard players after
  // selecting their first unit or hexagon.
  const focusKey = svg.dataset?.focusedCell ?? '0,0';
  const hadBoardFocus = !!doc.activeElement && !!svg.contains?.(doc.activeElement);
  const focusable = new Map();
  const group = svgNode(doc,'g',{'aria-label':'Tablero hexagonal de laboratorio'});
  for (const cell of boardCells) {
    const unit = cellsById.get(key(cell));
    const origin = draft && key(draft.origin) === key(cell);
    const step = marked.get(key(cell));
    const position = displayPoint(pixelCenter(cell,RADIUS,OX,OY),viewer);
    const hex = svgNode(doc,'g',{
      role:'button',tabindex:key(cell)===focusKey ? '0' : '-1',
      'aria-label':`Columna ${cell.col+1}, fila ${cell.row+1}${unit ? `, unidad ${unit.id} del bando ${unit.side}` : ', vacía'}${origin ? ', origen elegido' : ''}${step ? `, paso ${step}` : ''}`,
      'aria-pressed':String(Boolean(origin || step)),
      'data-col':cell.col,'data-row':cell.row
    });
    hex.classList.add('hex-target');
    if (origin) hex.classList.add('hex-origin');
    if (step) hex.classList.add('hex-route');
    const points = polygonPoints(cell,RADIUS,OX,OY)
      .map(p=>displayPoint(p,viewer))
      .map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
    hex.append(svgNode(doc,'polygon',{points,class:'hex-shape'}));
    if (unit) {
      const badge = svgNode(doc,'circle',{cx:position.x,cy:position.y,r:15,class:unit.side==='A'?'unit-a':'unit-b','pointer-events':'none'});
      const text = svgNode(doc,'text',{x:position.x,y:position.y+4,'text-anchor':'middle',class:'unit-label','pointer-events':'none'});
      text.textContent=unit.side;
      hex.append(badge,text);
    }
    if (step) {
      const indexLabel=svgNode(doc,'text',{x:position.x+14,y:position.y-11,class:'route-number','text-anchor':'middle','pointer-events':'none'});
      indexLabel.textContent=String(step);
      hex.append(indexLabel);
    }
    const activate=()=>{
      const current=svg.dataset?.focusedCell ?? focusKey;
      if (current !== key(cell)) {
        focusable.get(current)?.setAttribute('tabindex','-1');
        hex.setAttribute('tabindex','0');
        if (svg.dataset) svg.dataset.focusedCell=key(cell);
      }
      onSelect?.({col:cell.col,row:cell.row});
    };
    hex.addEventListener('click',activate);
    hex.addEventListener('keydown',event=>{
      if (event.key==='Enter'||event.key===' ') {event.preventDefault();activate();return;}
      // Keyboard directions follow the rotated *display*, not the stored
      // odd-q coordinates. Commands always keep their canonical col/row.
      const deltas=viewer==='B' ? {
        ArrowLeft:[1,0],ArrowRight:[-1,0],
        ArrowUp:[0,1],ArrowDown:[0,-1]
      } : {
        ArrowLeft:[-1,0],ArrowRight:[1,0],
        ArrowUp:[0,-1],ArrowDown:[0,1]
      };
      const delta=deltas[event.key];
      if (!delta) return;
      event.preventDefault();
      const target=focusable.get(`${Math.max(0,Math.min(12,cell.col+delta[0]))},${Math.max(0,Math.min(8,cell.row+delta[1]))}`);
      if (!target || target===hex) return;
      hex.setAttribute('tabindex','-1');
      target.setAttribute('tabindex','0');
      if(svg.dataset)svg.dataset.focusedCell=`${target.getAttribute('data-col')},${target.getAttribute('data-row')}`;
      target.focus?.();
    });
    focusable.set(key(cell),hex);
    group.append(hex);
  }
  svg.replaceChildren(group);
  if (hadBoardFocus) focusable.get(svg.dataset?.focusedCell ?? focusKey)?.focus?.();
  svg.setAttribute('viewBox',`0 0 ${DISPLAY_WIDTH} ${DISPLAY_HEIGHT}`);
  return {cells:boardCells.length,units:board.length,selectedSteps:draft?.path.length ?? 0};
}

/**
 * The caller supplies its authenticated view and its existing command sender.
 * A failed HTTP response preserves the request key for a safe idempotent retry.
 */
export function createMovementBoard({svg,status,undoButton,cancelButton,confirmButton,
  onConfirm,onError=()=>{},makeIdempotencyKey=()=>crypto.randomUUID().replaceAll('-','')}={}) {
  if (typeof onConfirm!=='function') throw new TypeError('MISSING_MOVEMENT_SENDER');
  let view=null, draft=null, keyForRetry=null, pending=false;
  const message=value=>{if(status)status.textContent=value;};
  function repaint() {
    if (!svg?.ownerDocument?.createElementNS) return; // stub DOM in legacy tests
    const editable = !!view && deckActions(view).includes('move_synthetic_unit');
    let renderError = false;
    try {renderMovementBoard(svg,view?.board??[],editable?draft:null,select,view?.you??'A');} catch(err) {
      draft=null;keyForRetry=null;renderError=true;onError(err);
      svg.replaceChildren();
    }
    if (undoButton)undoButton.disabled=pending||renderError||!editable||!draft?.path.length;
    if (cancelButton)cancelButton.disabled=pending||renderError||!draft;
    if (confirmButton)confirmButton.disabled=pending||renderError||!editable||!draft?.path.length;
    message(renderError ? 'El tablero recibido no es válido.' : !editable?'Tablero de consulta. No puedes mover ahora.':
      draft?`Unidad ${draft.unitId}: ${draft.path.length} pasos seleccionados. Confirma para enviar al servidor.`:
        'Selecciona una unidad propia y luego los hexágonos de su ruta.');
  }
  function select(cell) {
    if(pending)return;
    try {
      if (!view||!deckActions(view).includes('move_synthetic_unit'))throw Error('MOVIMIENTO_NO_DISPONIBLE');
      const occupied = view.board.find(unit=>key(unit)===key(cell));
      if (occupied?.side===view.you) draft=beginMovementDraft(view,occupied.id);
      else if(draft)draft=appendMovementHex(view,draft,cell);
      else throw Error('SELECCIONA_UNIDAD_PROPIA');
      keyForRetry=null;repaint();
    } catch(error){onError(error);}
  }
  async function confirm() {
    if(pending)return;
    try {
      const fields=movementDraftFields(view,draft);
      if(!keyForRetry)keyForRetry=makeIdempotencyKey();
      pending=true;repaint();
      await onConfirm(fields,keyForRetry);
      draft=null;keyForRetry=null;
    } catch(error){onError(error);} finally {pending=false;repaint();}
  }
  function undo() {
    if(pending)return;
    try {draft=undoMovementHex(view,draft);keyForRetry=null;repaint();}catch(error){onError(error);}
  }
  function cancel() {if(pending)return;draft=null;keyForRetry=null;repaint();}
  undoButton?.addEventListener('click',undo);
  cancelButton?.addEventListener('click',cancel);
  confirmButton?.addEventListener('click',confirm);
  function setView(next) {
    // Also accept an SSE/HTTP refresh while a submission is in flight.
    if(!next||!view || next.matchId!==view.matchId || next.you!==view.you
       || next.revision!==view.revision || next.phase!==view.phase || next.actingSide!==view.actingSide) {
      draft=null;keyForRetry=null;
    }
    // A same-revision projection should be immutable, but fail closed if a
    // corrupted/restored snapshot invalidates a draft even without a bump.
    if (draft && next) {
      try {
        if (draft.path.length) movementDraftFields(next,draft);
        else {
          const fresh=beginMovementDraft(next,draft.unitId);
          if (key(fresh.origin)!==key(draft.origin)) throw Error('BORRADOR_DESACTUALIZADO');
        }
      } catch {
        draft=null;keyForRetry=null;
      }
    }
    view=next;
    repaint();
  }
  repaint();
  return Object.freeze({setView,select,undo,cancel,confirm,getDraft:()=>draft ? structuredClone(draft):null});
}
