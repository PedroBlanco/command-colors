/**
 * CCW-014: small SVG board for the authenticated LOCAL browser laboratory.
 * Visual decisions are reversible previews; only a confirmed request reaches
 * the server, which remains authoritative. No licensed assets or game rules.
 */
import {allCells, pixelCenter, polygonPoints} from '../hex-grid/hex.mjs';
import {deckActions} from './deck-controls.mjs';
import {describeCommandError} from './command-feedback.mjs';
import {beginMovementDraft, appendMovementHex, undoMovementHex, movementDraftFields,
  nextMovementHexes, truncateMovementDraft, extendMovementDraftTo} from './hex-selection.mjs';

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
// Reusable presentation of base-edition unit classes; never grants movement,
// battle permission or eligibility. No game art or card text is embedded.
const TYPE_LABELS=Object.freeze({
  LIGHT_INFANTRY:['IL','infantería ligera'],
  LIGHT_SLING_INFANTRY:['HO','honderos ligeros'],
  LIGHT_BOW_INFANTRY:['AR','arqueros ligeros'],
  AUXILIA_INFANTRY:['AX','infantería auxiliar'],
  WARRIOR_INFANTRY:['GU','guerreros'],
  MEDIUM_INFANTRY:['IM','infantería media'],
  HEAVY_INFANTRY:['IP','infantería pesada'],
  HEAVY_WAR_MACHINE:['MG','máquina de guerra pesada'],
  LIGHT_CAVALRY:['CL','caballería ligera'],
  MEDIUM_CAVALRY:['CM','caballería media'],
  HEAVY_CAVALRY:['CP','caballería pesada'],
  ELEPHANT:['EL','elefantes'],
  HEAVY_CHARIOT:['CA','carros pesados']
});
const TERRAIN_LABELS=Object.freeze({
  FOREST:['B','bosque','terrain-forest'],
  HILL:['C','colina','terrain-hill'],
  BROKEN_GROUND:['A','terreno accidentado','terrain-broken']
});

function svgNode(doc, name, attrs = {}) {
  const node = doc.createElementNS(SVG_NS,name);
  for (const [attribute,value] of Object.entries(attrs)) node.setAttribute(attribute,String(value));
  return node;
}

/** Render public cells/units with keyboard and pointer selection. */
export function renderMovementBoard(svg, board, draft, onSelect, viewer='A',
  {nextCells=[], selectableUnitIds=[], combatTargetIds=[], selectedTargetId=null,
    terrain=[],leaders=[]}={}) {
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
  if(!Array.isArray(leaders)||leaders.length+board.length>117)
    throw new TypeError('INVALID_MOVEMENT_LEADER_VIEW');
  const leadersByCell=new Map(),leaderIds=new Set();
  for(const leader of leaders){
    if(!leader||typeof leader!=='object'||Array.isArray(leader)||
       !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(leader.id)||
       !['A','B'].includes(leader.side)||
       !Number.isSafeInteger(leader.col)||!Number.isSafeInteger(leader.row)||
       leader.col<0||leader.col>12||leader.row<0||leader.row>8||
       leaderIds.has(leader.id)||units.has(leader.id)||
       leadersByCell.has(key(leader))||
       (cellsById.has(key(leader))&&
        cellsById.get(key(leader)).side!==leader.side))
      throw new TypeError('INVALID_MOVEMENT_LEADER_VIEW');
    leaderIds.add(leader.id);
    leadersByCell.set(key(leader),leader);
  }
  // Terrain comes only from an authorized server view. Presentation is inert:
  // never infer the legality of an action from a color, label or SVG class.
  if(!Array.isArray(terrain)||terrain.length>117||
     terrain.some(t=>!t||typeof t!=='object'||Array.isArray(t)||
       Object.keys(t).length!==3||
       !Number.isSafeInteger(t.col)||!Number.isSafeInteger(t.row)||
       t.col<0||t.col>=13||t.row<0||t.row>=9||
       !Object.hasOwn(TERRAIN_LABELS,t.kind))||
     new Set(terrain.map(key)).size!==terrain.length)
    throw new TypeError('INVALID_MOVEMENT_TERRAIN_VIEW');
  const terrainByCell=new Map(terrain.map(t=>[key(t),TERRAIN_LABELS[t.kind]]));
  // Presentational hints cannot grant permission; validate their bounded shape.
  if (!Array.isArray(nextCells) || nextCells.length>6 ||
      nextCells.some(cell => !cell || !Number.isSafeInteger(cell.col) ||
        !Number.isSafeInteger(cell.row) || cell.col<0 || cell.col>12 ||
        cell.row<0 || cell.row>8) ||
      !Array.isArray(selectableUnitIds) || selectableUnitIds.length>117 ||
      selectableUnitIds.some(id => typeof id!=='string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)))
    throw new TypeError('INVALID_MOVEMENT_BOARD_HINTS');
  if (!Array.isArray(combatTargetIds) || combatTargetIds.length>117 ||
      combatTargetIds.some(id=>typeof id!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)) ||
      !(selectedTargetId===null ||
        (typeof selectedTargetId==='string' && combatTargetIds.includes(selectedTargetId))))
    throw new TypeError('INVALID_MOVEMENT_BOARD_HINTS');
  const combatTargets=new Set(combatTargetIds);
  const nextKeys = new Set(nextCells.map(key));
  const selectable = new Set(selectableUnitIds);
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
    const leader=leadersByCell.get(key(cell));
    const unitType=unit&&Object.hasOwn(TYPE_LABELS,unit.unitType)
      ? TYPE_LABELS[unit.unitType]:null;
    const terrainLabel=terrainByCell.get(key(cell));
    const origin = draft && key(draft.origin) === key(cell);
    const step = marked.get(key(cell));
    const next = nextKeys.has(key(cell));
    const selectableOwn = unit?.side===viewer && selectable.has(unit.id);
    const rivalTarget=unit?.side!==viewer && combatTargets.has(unit?.id);
    const chosenTarget=rivalTarget && selectedTargetId===unit.id;
    const position = displayPoint(pixelCenter(cell,RADIUS,OX,OY),viewer);
    const hex = svgNode(doc,'g',{
      role:'button',tabindex:key(cell)===focusKey ? '0' : '-1',
      'aria-label':`Columna ${cell.col+1}, fila ${cell.row+1}${unit ? `, unidad ${unit.id} del bando ${unit.side}${unitType ? `, ${unitType[1]}` : ''}` : leader ? ', sin unidad' : ', vacía'}${leader ? `, líder ${leader.id} del bando ${leader.side}`:''}${terrainLabel ? `, ${terrainLabel[1]}` : ''}${origin ? ', origen elegido' : ''}${step ? `, paso ${step}; pulsa para volver a este paso` : ''}${next ? ', siguiente hexágono candidato geométrico' : ''}${selectableOwn ? ', propia sin mover' : ''}${rivalTarget ? ', rival seleccionable para decisión defensiva sintética' : ''}${chosenTarget ? ', objetivo elegido' : ''}`,
      'aria-pressed':String(Boolean(origin || step)),
      'data-col':cell.col,'data-row':cell.row
    });
    hex.classList.add('hex-target');
    if (terrainLabel)hex.classList.add(terrainLabel[2]);
    if (selectableOwn) hex.classList.add('hex-selectable');
    if (rivalTarget) hex.classList.add('hex-combat-selectable');
    if (chosenTarget) hex.classList.add('hex-combat-selected');
    if (next) hex.classList.add('hex-next');
    if (origin) hex.classList.add('hex-origin');
    if (step) hex.classList.add('hex-route');
    const points = polygonPoints(cell,RADIUS,OX,OY)
      .map(p=>displayPoint(p,viewer))
      .map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
    hex.append(svgNode(doc,'polygon',{points,class:'hex-shape'}));
    if(terrainLabel){
      const marker=svgNode(doc,'text',{
        x:position.x-15,y:position.y-11,class:'terrain-marker',
        'text-anchor':'middle','pointer-events':'none'
      });
      marker.textContent=terrainLabel[0];
      hex.append(marker);
    }
    if (next) hex.append(svgNode(doc,'circle',{
      cx:position.x,cy:position.y,r:7,class:'hex-next-marker','pointer-events':'none'
    }));
    if (unit) {
      const badge = svgNode(doc,'circle',{cx:position.x,cy:position.y,r:15,class:unit.side==='A'?'unit-a':'unit-b','pointer-events':'none'});
      const text = svgNode(doc,'text',{x:position.x,y:position.y+4,'text-anchor':'middle',class:'unit-label','pointer-events':'none'});
      text.textContent=unitType?unitType[0]:unit.side;
      hex.append(badge,text);
    }
    if (leader){
      const leaderMarker=svgNode(doc,'text',{
        x:position.x+15,y:position.y-11,class:'leader-marker',
        'text-anchor':'middle','pointer-events':'none'
      });
      leaderMarker.textContent='L';
      hex.append(leaderMarker);
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
  attackButton,onRequestDefense,onConfirm,onError=()=>{},
  makeIdempotencyKey=()=>crypto.randomUUID().replaceAll('-','')}={}) {
  if (typeof onConfirm!=='function') throw new TypeError('MISSING_MOVEMENT_SENDER');
  let view=null, draft=null, keyForRetry=null, pending=false, autoRoute=false;
  let selectedTargetId=null, defenseRetryKey=null, activeError=null;
  const message=value=>{if(status)status.textContent=value;};
  // Local geometry failures belong beside the board, not only in the
  // application's general message area. Never echo private server payloads.
  const localErrors=Object.freeze({
    HEX_OCUPADO:'El hexágono de destino está ocupado.',
    HEX_REPETIDO:'Ese hexágono ya forma parte del recorrido.',
    HEX_INVALIDO:'El hexágono elegido no es válido.',
    RUTA_INACCESIBLE:'No existe un recorrido geométrico libre hasta el destino.',
    RUTA_DEMASIADO_LARGA:'El recorrido supera los 32 pasos del laboratorio.',
    BORRADOR_DESACTUALIZADO:'La partida ha cambiado. Vuelve a elegir la unidad.',
    SELECCIONA_UNIDAD_PROPIA:'Selecciona primero una unidad propia.',
    OBJETIVO_RIVAL_REQUERIDO:'Selecciona una unidad rival durante el combate sintético.'
  });
  const reportError=error=>{
    const code=error?.message;
    activeError=Object.hasOwn(localErrors,code)
      ? localErrors[code] : describeCommandError(error);
    message(activeError);
    onError(error);
  };
  function repaint() {
    if (!svg?.ownerDocument?.createElementNS) return; // stub DOM in legacy tests
    const actions=deckActions(view);
    const editable=actions.includes('move_synthetic_unit');
    const defenseReady=typeof onRequestDefense==='function' &&
      actions.includes('ask_synthetic_defense');
    let renderError = false, nextCells = [], selectableUnitIds = [], combatTargetIds = [];
    try {
      if (editable) {
        const moved = new Set(Array.isArray(view.movedUnitIds) ? view.movedUnitIds : []);
        selectableUnitIds = view.board.filter(unit => unit.side===view.you && !moved.has(unit.id))
          .map(unit => unit.id);
        if (draft) nextCells = nextMovementHexes(view,draft);
      }
      if (defenseReady)
        combatTargetIds=view.board.filter(unit=>unit.side!==view.you).map(unit=>unit.id);
      renderMovementBoard(svg,view?.board??[],editable?draft:null,select,view?.you??'A',
        {nextCells,selectableUnitIds,combatTargetIds,
          selectedTargetId:defenseReady?selectedTargetId:null,
          terrain:Array.isArray(view?.terrain)?view.terrain:[]});
    } catch(err) {
      draft=null;keyForRetry=null;autoRoute=false;
      selectedTargetId=null;defenseRetryKey=null;renderError=true;onError(err);
      svg.replaceChildren();
    }
    if (undoButton)undoButton.disabled=pending||renderError||!editable||!draft?.path.length;
    if (cancelButton)cancelButton.disabled=pending||renderError||!draft;
    if (confirmButton)confirmButton.disabled=pending||renderError||!editable||!draft?.path.length;
    if (attackButton)attackButton.disabled=pending||renderError||!defenseReady||!selectedTargetId;
    message(renderError ? 'El tablero recibido no es válido.' :
      activeError ? activeError :
      defenseReady ? (selectedTargetId
        ? `Objetivo rival ${selectedTargetId} seleccionado. Solicita la decisión defensiva para enviar el comando al servidor.`
        : 'Combate sintético: selecciona una unidad rival para solicitar su decisión defensiva.') :
      !editable?'Tablero de consulta. No puedes mover ahora.':
      draft?`Unidad ${draft.unitId}: ${draft.path.length} pasos seleccionados. ${nextCells.length} vecinos geométricos marcados.${autoRoute ? ' Ruta geométrica automática sugerida (sin validar reglas).' : ''} Toca un paso anterior para recortar la ruta o confirma para enviar al servidor.`:
        `${selectableUnitIds.length} unidades propias sin mover destacadas. Selecciona una para trazar la ruta.`);
  }
  function select(cell) {
    if(pending)return;
    activeError=null;
    try {
      if (!view) throw Error('MOVIMIENTO_NO_DISPONIBLE');
      const actions=deckActions(view);
      const occupied = view.board.find(unit=>key(unit)===key(cell));
      if (typeof onRequestDefense==='function' &&
          actions.includes('ask_synthetic_defense')) {
        if (!occupied || occupied.side===view.you) throw Error('OBJETIVO_RIVAL_REQUERIDO');
        selectedTargetId=occupied.id;
        defenseRetryKey=null;
        repaint();
        return;
      }
      if (!actions.includes('move_synthetic_unit'))throw Error('MOVIMIENTO_NO_DISPONIBLE');
      if (draft && (key(draft.origin)===key(cell) ||
          draft.path.some(step=>key(step)===key(cell)))) {
        draft=truncateMovementDraft(view,draft,cell);
        autoRoute=false;
      } else if (occupied?.side===view.you) {
        draft=beginMovementDraft(view,occupied.id);
        autoRoute=false;
      } else if(draft) {
        const before=draft.path.length;
        // This only builds a candidate route locally, never an authorized move.
        draft=extendMovementDraftTo(view,draft,cell);
        autoRoute=draft.path.length-before>1;
      } else throw Error('SELECCIONA_UNIDAD_PROPIA');
      keyForRetry=null;repaint();
    } catch(error){reportError(error);}
  }
  async function confirm() {
    if(pending)return;
    activeError=null;
    try {
      const fields=movementDraftFields(view,draft);
      if(!keyForRetry)keyForRetry=makeIdempotencyKey();
      pending=true;repaint();
      const result=await onConfirm(fields,keyForRetry);
      if(result===false)return; // Superseded identity cannot confirm this move.
      draft=null;keyForRetry=null;autoRoute=false;
    } catch(error){reportError(error);} finally {pending=false;repaint();}
  }
  async function requestDefense() {
    if (pending) return;
    activeError=null;
    try {
      if (!selectedTargetId || !view ||
          !deckActions(view).includes('ask_synthetic_defense') ||
          !view.board.some(u=>u?.id===selectedTargetId && u.side!==view.you))
        throw Error('OBJETIVO_RIVAL_REQUERIDO');
      if (!defenseRetryKey) defenseRetryKey=makeIdempotencyKey();
      pending=true;repaint();
      const result=await onRequestDefense(selectedTargetId,defenseRetryKey);
      if (result!==false) {
        selectedTargetId=null;defenseRetryKey=null;
      }
    } catch(error){reportError(error);} finally {pending=false;repaint();}
  }
  function undo() {
    if(pending)return;
    activeError=null;
    try {draft=undoMovementHex(view,draft);keyForRetry=null;autoRoute=false;repaint();}catch(error){reportError(error);}
  }
  function cancel() {if(pending)return;draft=null;keyForRetry=null;autoRoute=false;activeError=null;repaint();}
  undoButton?.addEventListener('click',undo);
  cancelButton?.addEventListener('click',cancel);
  confirmButton?.addEventListener('click',confirm);
  attackButton?.addEventListener('click',requestDefense);
  function setView(next) {
    // Also accept an SSE/HTTP refresh while a submission is in flight.
    if(!next||!view || next.matchId!==view.matchId || next.you!==view.you
       || next.revision!==view.revision || next.phase!==view.phase || next.actingSide!==view.actingSide) {
      draft=null;keyForRetry=null;autoRoute=false;
      selectedTargetId=null;defenseRetryKey=null;activeError=null;
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
        draft=null;keyForRetry=null;autoRoute=false;
      }
    }
    if (selectedTargetId && (!next ||
        !deckActions(next).includes('ask_synthetic_defense') ||
        !Array.isArray(next.board) ||
        !next.board.some(u=>u?.id===selectedTargetId && u.side!==next.you))) {
      selectedTargetId=null;defenseRetryKey=null;
    }
    view=next;
    repaint();
  }
  repaint();
  return Object.freeze({setView,select,undo,cancel,confirm,requestDefense,
    getDraft:()=>draft ? structuredClone(draft):null});
}
