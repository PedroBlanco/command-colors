/**
 * CCW-014: small SVG board for the authenticated LOCAL browser laboratory.
 * Visual decisions are reversible previews; only a confirmed request reaches
 * the server, which remains authoritative. No licensed assets or game rules.
 */
import {allCells, pixelCenter, polygonPoints, distance} from '../hex-grid/hex.mjs';
import {deckActions} from './deck-controls.mjs';
import {previewBaseMovementOnBoard,previewBaseRangedOnBoard} from './ancients-base-reference.mjs';
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

function svgNode(doc, name, attrs = {}) {
  const node = doc.createElementNS(SVG_NS,name);
  for (const [attribute,value] of Object.entries(attrs)) node.setAttribute(attribute,String(value));
  return node;
}

/** Render public cells/units with keyboard and pointer selection. */
export function renderMovementBoard(svg, board, draft, onSelect, viewer='A',
  {nextCells=[], selectableUnitIds=[], combatTargetIds=[], selectedTargetId=null,
    orderableUnitIds=[], selectedOrderUnitIds=[],
    inspectionCell=null, movedUnitIds=[], profileCells=[],
    rangedTargets=[],inspectionTarget=null,losBlockerCells=[],terrainCells=[]}={}) {
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
  if (!Array.isArray(orderableUnitIds) || orderableUnitIds.length>117 ||
      !Array.isArray(selectedOrderUnitIds) || selectedOrderUnitIds.length>117 ||
      [...orderableUnitIds,...selectedOrderUnitIds].some(id=>typeof id!=='string' ||
        !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)) ||
      selectedOrderUnitIds.some(id=>!orderableUnitIds.includes(id)) ||
      new Set(selectedOrderUnitIds).size!==selectedOrderUnitIds.length)
    throw new TypeError('INVALID_MOVEMENT_BOARD_HINTS');
  if (inspectionCell!==null && (!inspectionCell ||
      !Number.isSafeInteger(inspectionCell.col) ||
      !Number.isSafeInteger(inspectionCell.row) ||
      inspectionCell.col<0||inspectionCell.col>12||
      inspectionCell.row<0||inspectionCell.row>8))
    throw new TypeError('INVALID_MOVEMENT_BOARD_HINTS');
  if (!Array.isArray(movedUnitIds)||movedUnitIds.length>117||
      movedUnitIds.some(id=>typeof id!=='string' ||
        !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)))
    throw new TypeError('INVALID_MOVEMENT_BOARD_HINTS');
  if(!Array.isArray(profileCells)||profileCells.length>117||
      profileCells.some(c=>!c||!Number.isSafeInteger(c.col)||
        !Number.isSafeInteger(c.row)||c.col<0||c.col>12||c.row<0||c.row>8||
        !Number.isSafeInteger(c.steps)||c.steps<1||c.steps>4||
        !['POSSIBLE','UNAVAILABLE','MANDATORY_CLOSE_COMBAT'].includes(c.battle)))
    throw new TypeError('INVALID_MOVEMENT_BOARD_HINTS');
  if(!Array.isArray(rangedTargets)||rangedTargets.length>117||
      rangedTargets.some(t=>!t||!Number.isSafeInteger(t.col)||
        !Number.isSafeInteger(t.row)||t.col<0||t.col>12||
        t.row<0||t.row>8||!['BLOCKED_BY_VISIBLE_UNITS',
        'NO_VISIBLE_UNIT_OBSTRUCTION'].includes(t.visibleUnitCorridor)))
    throw new TypeError('INVALID_MOVEMENT_BOARD_HINTS');
  if(!Array.isArray(losBlockerCells)||losBlockerCells.length>117||
      losBlockerCells.some(c=>!c||!Number.isSafeInteger(c.col)||
        !Number.isSafeInteger(c.row)||c.col<0||c.col>12||
        c.row<0||c.row>8))
    throw new TypeError('INVALID_MOVEMENT_BOARD_HINTS');
  const blockerKeys=new Set(losBlockerCells.map(key));
  if(blockerKeys.size!==losBlockerCells.length)
    throw new TypeError('INVALID_MOVEMENT_BOARD_HINTS');
  const rangedByCell=new Map(rangedTargets.map(t=>[key(t),t]));
  if(rangedByCell.size!==rangedTargets.length||
      (inspectionTarget!==null&&(!inspectionTarget||
        !Number.isSafeInteger(inspectionTarget.col)||
        !Number.isSafeInteger(inspectionTarget.row)||
        inspectionTarget.col<0||inspectionTarget.col>12||
        inspectionTarget.row<0||inspectionTarget.row>8)))
    throw new TypeError('INVALID_MOVEMENT_BOARD_HINTS');
  const previewByCell=new Map(profileCells.map(c=>[key(c),c]));
  if(previewByCell.size!==profileCells.length)
    throw new TypeError('INVALID_MOVEMENT_BOARD_HINTS');
  if(!Array.isArray(terrainCells)||terrainCells.length>117||
      terrainCells.some(t=>!t||!Number.isSafeInteger(t.col)||
        !Number.isSafeInteger(t.row)||t.col<0||t.col>12||t.row<0||
        t.row>8||!['FOREST','HILL','BROKEN_GROUND'].includes(t.kind)))
    throw new TypeError('INVALID_MOVEMENT_BOARD_HINTS');
  const terrainByCell=new Map(terrainCells.map(t=>[key(t),t.kind]));
  if(terrainByCell.size!==terrainCells.length)
    throw new TypeError('INVALID_MOVEMENT_BOARD_HINTS');
  const moved=new Set(movedUnitIds);
  const orderable=new Set(orderableUnitIds);
  const ordered=new Set(selectedOrderUnitIds);
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
    const origin = draft && key(draft.origin) === key(cell);
    const step = marked.get(key(cell));
    const next = nextKeys.has(key(cell));
    const selectableOwn = unit?.side===viewer && selectable.has(unit.id);
    const orderableOwn=unit?.side===viewer && orderable.has(unit.id);
    const chosenOrder=orderableOwn && ordered.has(unit.id);
    const rivalTarget=unit?.side!==viewer && combatTargets.has(unit?.id);
    const chosenTarget=rivalTarget && selectedTargetId===unit.id;
    const alreadyMoved=!!unit && unit.side===viewer && moved.has(unit.id);
    const inspected=inspectionCell && key(inspectionCell)===key(cell);
    const range=inspectionCell ? distance(cell,inspectionCell):null;
    const profilePreview=previewByCell.get(key(cell));
    const rangedPreview=rangedByCell.get(key(cell));
    const focusedTarget=inspectionTarget&&key(inspectionTarget)===key(cell);
    const viewBlocker=blockerKeys.has(key(cell));
    const terrainKind=terrainByCell.get(key(cell));
    const position = displayPoint(pixelCenter(cell,RADIUS,OX,OY),viewer);
    const hex = svgNode(doc,'g',{
      role:'button',tabindex:key(cell)===focusKey ? '0' : '-1',
      'aria-label':`Columna ${cell.col+1}, fila ${cell.row+1}${unit ? `, unidad ${unit.id} del bando ${unit.side}` : ', vacía'}${origin ? ', origen elegido' : ''}${step ? `, paso ${step}; pulsa para volver a este paso` : ''}${next ? ', siguiente hexágono candidato geométrico' : ''}${selectableOwn ? ', propia sin mover' : ''}${rivalTarget ? ', rival seleccionable para decisión defensiva sintética' : ''}${chosenTarget ? ', objetivo elegido' : ''}${orderableOwn ? ', propia disponible para órdenes' : ''}${chosenOrder ? ', seleccionada para recibir órdenes' : ''}${alreadyMoved ? ', movimiento ya realizado' : ''}${range!==null ? `, distancia geométrica ${range} hexágonos` : ''}${profilePreview ? `, referencia de movimiento base ${profilePreview.steps} pasos, combate ${profilePreview.battle}` : ''}${rangedPreview ? rangedPreview.visibleUnitCorridor==='BLOCKED_BY_VISIBLE_UNITS'?', referencia de disparo bloqueada por otra unidad visible':', referencia de disparo sin unidades interpuestas; terreno y líderes desconocidos' : ''}${terrainKind ? `, terreno del ejercicio: ${terrainKind}` : ''}${focusedTarget ? ', objetivo de inspección elegido' : ''}${viewBlocker ? ', unidad visible que bloquea el corredor hipotético' : ''}`,
      'aria-pressed':String(Boolean(origin || step || chosenOrder || chosenTarget || inspected || focusedTarget)),
      'data-col':cell.col,'data-row':cell.row
    });
    hex.classList.add('hex-target');
    if (selectableOwn) hex.classList.add('hex-selectable');
    if (orderableOwn) hex.classList.add('hex-orderable');
    if (chosenOrder) hex.classList.add('hex-order-selected');
    if (rivalTarget) hex.classList.add('hex-combat-selectable');
    if (chosenTarget) hex.classList.add('hex-combat-selected');
    if (alreadyMoved) hex.classList.add('hex-already-moved');
    if (inspected) hex.classList.add('hex-inspected');
    else if (range!==null && range>=1 && range<=3)hex.classList.add(`hex-range-${range}`);
    if (profilePreview)hex.classList.add(
      profilePreview.battle==='MANDATORY_CLOSE_COMBAT'?'hex-profile-charge':
      profilePreview.battle==='POSSIBLE'?'hex-profile-battle':'hex-profile-move'
    );
    if (rangedPreview)hex.classList.add(
      rangedPreview.visibleUnitCorridor==='BLOCKED_BY_VISIBLE_UNITS'
        ?'hex-profile-los-blocked':'hex-profile-los-open-unverified'
    );
    if (focusedTarget)hex.classList.add('hex-profile-target-focus');
    if (viewBlocker)hex.classList.add('hex-profile-los-obstacle');
    if (terrainKind)hex.classList.add('hex-terrain-'+terrainKind.toLowerCase().replaceAll('_','-'));
    if (next) hex.classList.add('hex-next');
    if (origin) hex.classList.add('hex-origin');
    if (step) hex.classList.add('hex-route');
    const points = polygonPoints(cell,RADIUS,OX,OY)
      .map(p=>displayPoint(p,viewer))
      .map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
    hex.append(svgNode(doc,'polygon',{points,class:'hex-shape'}));
    if (next) hex.append(svgNode(doc,'circle',{
      cx:position.x,cy:position.y,r:7,class:'hex-next-marker','pointer-events':'none'
    }));
    if (unit) {
      const badge = svgNode(doc,'circle',{cx:position.x,cy:position.y,r:15,class:unit.side==='A'?'unit-a':'unit-b','pointer-events':'none'});
      const text = svgNode(doc,'text',{x:position.x,y:position.y+4,'text-anchor':'middle',class:'unit-label','pointer-events':'none'});
      text.textContent=unit.side;
      hex.append(badge,text);
      if (alreadyMoved) {
        // Small public marker, with an equivalent spoken label on the hex.
        const dot=svgNode(doc,'circle',{
          cx:position.x+13,cy:position.y-13,r:6,
          class:'unit-moved-dot','pointer-events':'none'
        });
        const tick=svgNode(doc,'text',{
          x:position.x+13,y:position.y-10,
          'text-anchor':'middle',class:'unit-moved-tick','pointer-events':'none'
        });
        tick.textContent='✓';
        hex.append(dot,tick);
      }
    }
    if (terrainKind) {
      const symbol=svgNode(doc,'text',{
        x:position.x+14,y:position.y-13,
        'text-anchor':'middle',class:'terrain-symbol','pointer-events':'none'
      });
      symbol.textContent=terrainKind==='FOREST'?'♣':
        terrainKind==='HILL'?'▲':'◇';
      hex.append(symbol);
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
  attackButton,onRequestDefense,orderButton,onAssignOrders,onToggleOrderUnit,
  getOrderSelection=()=>[],phaseButtons={},onPhaseCommand,
  cardGroup,cardSelect,cardButton,onPlayCard,
  inspectButton,inspectPanel,overviewPanel,profileSelect,profileStatus,profileGroup,
  onConfirm,onError=()=>{},
  makeIdempotencyKey=()=>crypto.randomUUID().replaceAll('-','')}={}) {
  if (typeof onConfirm!=='function') throw new TypeError('MISSING_MOVEMENT_SENDER');
  let view=null, draft=null, keyForRetry=null, pending=false, autoRoute=false;
  let selectedTargetId=null, defenseRetryKey=null;
  let orderRetryKey=null, orderSelectionFingerprint=null;
  const phaseRetries=new Map();
  let phaseContext=null;
  let cardRetryKey=null,cardContext=null;
  let inspecting=false,inspectedCell=null,inspectedTarget=null;
  const PHASE_COMMANDS=Object.freeze({
    'finish_synthetic_movement':null,
    'finish_synthetic_combat':null,
    'acknowledge_synthetic_draw':null,
    'undo_synthetic_orders':null,
    'defense_stand':'STAND',
    'defense_evade':'EVADE'
  });
  function permittedPhaseCommand(action,actions=deckActions(view)) {
    if (!Object.hasOwn(PHASE_COMMANDS,action) || typeof onPhaseCommand!=='function')
      return false;
    const choice=PHASE_COMMANDS[action];
    if (choice===null) return actions.includes(action);
    return actions.includes('answer_synthetic_defense') &&
      Array.isArray(view?.pendingDecision?.options) &&
      view.pendingDecision.options.includes(choice);
  }
  function phaseFields(action) {
    const choice=PHASE_COMMANDS[action];
    return choice===null?{}:{choice};
  }
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
    OBJETIVO_RIVAL_REQUERIDO:'Selecciona una unidad rival durante el combate sintético.',
    UNIDAD_NO_PROPIA:'Selecciona una unidad propia para darle una orden.',
    ORDENES_INVALIDAS:'Debes seleccionar al menos una unidad propia.',
    CARTA_NO_PROPIA:'Selecciona una carta de tu mano.',
    ACCION_NO_DISPONIBLE:'Esta acción no está disponible en la fase actual.'
  });
  const reportError=error=>{
    if (Object.hasOwn(localErrors,error?.message)) message(localErrors[error.message]);
    onError(error);
  };
  function repaint() {
    if (!svg?.ownerDocument?.createElementNS) return; // stub DOM in legacy tests
    const actions=deckActions(view);
    const editable=actions.includes('move_synthetic_unit');
    const defenseReady=typeof onRequestDefense==='function' &&
      actions.includes('ask_synthetic_defense');
    const ordersReady=typeof onToggleOrderUnit==='function' &&
      typeof onAssignOrders==='function' && actions.includes('assign_synthetic_orders');
    const cardsReady=typeof onPlayCard==='function' &&
      actions.includes('play_synthetic_card') && Array.isArray(view?.yourHand);
    let renderError = false, nextCells = [], selectableUnitIds = [], combatTargetIds = [];
    let orderableUnitIds=[],selectedOrderUnitIds=[];
    let profileCells=[],rangedTargets=[],losBlockerCells=[];
    const boardValid=Array.isArray(view?.board);
    const training=view?.trainingReference?.kind==='SYNTHETIC_ANCIENTS_TRAINING_V1'?
      view.trainingReference:null;
    const terrainCells=Array.isArray(training?.terrain)?training.terrain:[];
    const movedPublic=Array.isArray(view?.movedUnitIds)?view.movedUnitIds:[];
    if (inspectButton) {
      inspectButton.disabled=!boardValid||pending;
      inspectButton.textContent=inspecting?'Volver al juego':'Inspeccionar tablero';
      inspectButton.setAttribute?.('aria-pressed',String(inspecting));
    }
    if (overviewPanel) {
      const boardUnits=boardValid?view.board:[];
      const own=boardUnits.filter(unit=>unit?.side===view?.you);
      const enemy=boardUnits.filter(unit=>unit?.side!==view?.you);
      const used=own.filter(unit=>movedPublic.includes(unit.id)).length;
      overviewPanel.textContent=!boardValid?'Sin tablero cargado':
        `Bando ${view.you} · Turno ${view.turn} · Debe actuar ${view.actingSide} · Fase ${view.phase} · Revisión ${view.revision}. ${own.length} unidades propias (${used} movidas), ${enemy.length} rivales.`;
    }
    if(profileGroup)profileGroup.hidden=!inspecting||!boardValid;
    const ownInspected=inspectedCell&&boardValid?view.board.find(u=>
      u.side===view.you&&key(u)===key(inspectedCell)):null;
    const boundType=ownInspected&&training?.unitTypes&&
      Object.hasOwn(training.unitTypes,ownInspected.id)?
      training.unitTypes[ownInspected.id]:null;
    if(profileSelect){
      if(boundType)profileSelect.value=boundType;
      profileSelect.disabled=!inspecting||!boardValid||Boolean(boundType);
    }
    if(profileStatus){
      if(!inspecting||!boardValid)profileStatus.textContent='';
      else {
        const own=inspectedCell && view.board.find(u=>u.side===view.you &&
          key(u)===key(inspectedCell));
        if(!own)profileStatus.textContent='Elige una unidad propia para ver un perfil base hipotético.';
        else try {
          const result=previewBaseMovementOnBoard({
            unitType:boundType??profileSelect?.value,
            origin:inspectedCell,
            occupiedCells:view.board.map(u=>({col:u.col,row:u.row}))
          });
          profileCells=result.reachable;
          const firing=previewBaseRangedOnBoard({
            unitType:result.unitType,origin:inspectedCell,actor:view.you,
            board:view.board,
            movedUnitIds:Array.isArray(view.movedUnitIds)?view.movedUnitIds:null,
            terrain:training?terrainCells:null
          });
          rangedTargets=firing.targets.filter(t=>
            t.visibleUnitCorridor!=='NOT_EVALUATED'
          ).map(t=>({col:t.col,row:t.row,
            visibleUnitCorridor:t.visibleUnitCorridor}));
          const open=rangedTargets.filter(t=>
            t.visibleUnitCorridor==='NO_VISIBLE_UNIT_OBSTRUCTION').length;
          const blocked=rangedTargets.length-open;
          const terrainNote=training?
            ' Terreno declarado por el servidor para este ejercicio sintético; no es un escenario oficial.':
            ' Terreno desconocido; la línea de visión supone suelo despejado.';
          const firingMessage=firing.status==='NO_MOVEMENT_LEDGER'
            ? 'Sin registro de movimiento: no se puede estimar disparo.'
            : firing.status==='MOVEMENT_STEPS_UNKNOWN'
              ? 'Unidad ya movida: se desconoce el número de pasos. No se estima disparo.'
              : `${open} corredores sin obstáculos detectados y ${blocked} con obstáculos bajo los datos de referencia; líderes desconocidos.`;
          const target=inspectedTarget?firing.targets.find(t=>
            key(t)===key(inspectedTarget)):null;
          const reasonName={
            NO_BASE_RANGED_WEAPON:'sin arma a distancia del perfil',
            RANGED_TARGET_ADJACENT:'objetivo adyacente, no es tiro a distancia',
            TARGET_OUT_OF_RANGE:'fuera del alcance del perfil',
            EXCEEDS_STANDARD_MOVEMENT:'movimiento excesivo para ese perfil',
            WAR_MACHINE_MOVED:'la máquina de guerra se ha movido',
            AUXILIA_MOVED_TWO:'auxiliares movidos dos hexágonos'
          };
          if(target && target.visibleUnitCorridor!=='NO_VISIBLE_UNIT_OBSTRUCTION' &&
             target.visibleUnitCorridor!=='NOT_EVALUATED')
            losBlockerCells=target.obstructingHexes;
          const targetMessage=inspectedTarget && firing.status!=='REFERENCE_ONLY'
            ? ' No hay datos fiables de pasos para valorar este objetivo.'
            : target?target.profileStatus!=='CANDIDATE'
              ? ` Objetivo ${target.id}: ${reasonName[target.profileReason]??'perfil no compatible'} (distancia ${target.distance}).`
              : target.visibleUnitCorridor==='BLOCKED_BY_VISIBLE_UNITS'
                ? ` Objetivo ${target.id}, distancia ${target.distance}: unidades interpuestas en ${target.obstructingHexes.map(c=>`(${c.col+1},${c.row+1})`).join(', ')}. Disparo de referencia bloqueado.`
                : target.visibleUnitCorridor==='BLOCKED_BY_TRAINING_TERRAIN'
                  ? ` Objetivo ${target.id}, distancia ${target.distance}: terreno de entrenamiento bloqueante en ${target.obstructingHexes.map(c=>`(${c.col+1},${c.row+1})`).join(', ')}.`
                  : ` Objetivo ${target.id}, distancia ${target.distance}: ${target.nominalDice} dados base orientativos; corredor sin obstáculos detectados, pero faltan líderes, órdenes y modificadores.`
              : '';
          const ranged=result.rangedReach===null?'sin disparo a distancia base':
            'alcance base de disparo '+result.rangedReach+' hex.';
          profileStatus.textContent=`Ancients base, ${boundType?'tipo declarado por el servidor para entrenamiento':'tipo HIPOTÉTICO elegido manualmente'}: ${result.unitType.replaceAll('_',' ').toLowerCase()}; máximo ${result.maxSteps} pasos; ${profileCells.length} destinos geométricos sin aplicar restricciones de terreno; ${ranged}. ${firingMessage}${targetMessage}${terrainNote} Verde: movimiento y combate según perfil; azul: movimiento; naranja: carga condicional; contorno rojo continuo: corredor sin bloqueos detectados; rojo discontinuo: obstáculo. NO verifica líderes, órdenes ni reglas completas de escenario. NO autoriza movimientos ni ataques.`;
        } catch {
          profileStatus.textContent='Selecciona un tipo de tropa válido del juego base.';
        }
      }
    }
    if (inspectPanel) {
      inspectPanel.hidden=!inspecting||!boardValid;
      if (!inspecting||!boardValid) inspectPanel.textContent='';
      else if (!inspectedCell) inspectPanel.textContent='Toca un hexágono para consultar su contenido y las distancias geométricas hasta otras unidades.';
      else {
        const unit=view.board.find(item=>key(item)===key(inspectedCell));
        const counterpart=view.board.filter(item=>key(item)!==key(inspectedCell))
          .map(item=>({unit:item,steps:distance(inspectedCell,item)}))
          .sort((a,b)=>a.steps-b.steps||a.unit.id.localeCompare(b.unit.id))
          .slice(0,5)
          .map(({unit:item,steps})=>`${item.id}: ${steps} hex.`);
        const who=unit?`${unit.id} · bando ${unit.side} · ${unit.side===view.you?'propia':'rival'}${unit.side===view.you && movedPublic.includes(unit.id)?' · ya movida':''}`:'hexágono vacío';
        inspectPanel.textContent=`Columna ${inspectedCell.col+1}, fila ${inspectedCell.row+1}: ${who}. ${counterpart.length?'Distancias a unidades próximas: '+counterpart.join(' · '):'No hay otras unidades.'} Distancias geométricas; no representan alcance de ataque ni legalidad de movimiento.`;
      }
    }
    try {
      if (editable) {
        const moved = new Set(Array.isArray(view.movedUnitIds) ? view.movedUnitIds : []);
        selectableUnitIds = view.board.filter(unit => unit.side===view.you && !moved.has(unit.id))
          .map(unit => unit.id);
        if (draft) nextCells = nextMovementHexes(view,draft);
      }
      if (defenseReady)
        combatTargetIds=view.board.filter(unit=>unit.side!==view.you).map(unit=>unit.id);
      if (ordersReady) {
        orderableUnitIds=view.board.filter(unit=>unit.side===view.you).map(unit=>unit.id);
        selectedOrderUnitIds=getOrderSelection();
      }
      // A changed local selection cannot reuse the previous POST's key.
      const fingerprint=ordersReady && Array.isArray(selectedOrderUnitIds)
        ? `${view.matchId}:${view.revision}:${selectedOrderUnitIds.join(',')}` : null;
      if (fingerprint!==orderSelectionFingerprint) {
        orderRetryKey=null;orderSelectionFingerprint=fingerprint;
      }
      renderMovementBoard(svg,view?.board??[],editable&&!inspecting?draft:null,select,view?.you??'A',
        {nextCells:inspecting?[]:nextCells,
          selectableUnitIds:inspecting?[]:selectableUnitIds,
          combatTargetIds:inspecting?[]:combatTargetIds,
          selectedTargetId:inspecting?null:defenseReady?selectedTargetId:null,
          orderableUnitIds:inspecting?[]:orderableUnitIds,
          selectedOrderUnitIds:inspecting?[]:selectedOrderUnitIds,
          inspectionCell:inspecting?inspectedCell:null,
          movedUnitIds:boardValid?movedPublic:[],
          profileCells:inspecting?profileCells:[],
          rangedTargets:inspecting?rangedTargets:[],
          inspectionTarget:inspecting?inspectedTarget:null,
          losBlockerCells:inspecting?losBlockerCells:[],
          terrainCells:boardValid?terrainCells:[]});
    } catch(err) {
      draft=null;keyForRetry=null;autoRoute=false;
      selectedTargetId=null;defenseRetryKey=null;
      orderRetryKey=null;orderSelectionFingerprint=null;renderError=true;onError(err);
      svg.replaceChildren();
    }
    // Keep the tactical toolbar focused on the current phase. A hidden
    // control cannot be invoked through stale keyboard focus or callbacks.
    if (undoButton) {
      undoButton.hidden=inspecting||!editable;
      undoButton.disabled=pending||renderError||inspecting||!editable||!draft?.path.length;
    }
    if (cancelButton) {
      cancelButton.hidden=inspecting||!editable;
      cancelButton.disabled=pending||renderError||inspecting||!draft;
    }
    if (confirmButton) {
      confirmButton.hidden=inspecting||!editable;
      confirmButton.disabled=pending||renderError||inspecting||!editable||!draft?.path.length;
    }
    if (attackButton) {
      attackButton.hidden=inspecting||!defenseReady;
      attackButton.disabled=pending||renderError||inspecting||!defenseReady||!selectedTargetId;
    }
    if (orderButton) {
      orderButton.hidden=inspecting||!ordersReady;
      orderButton.disabled=pending||renderError||inspecting||!ordersReady||!selectedOrderUnitIds.length;
    }
    if (cardGroup) cardGroup.hidden=inspecting||!cardsReady||renderError;
    if (cardSelect) {
      const current=cardSelect.value;
      cardSelect.replaceChildren();
      if (cardsReady && !renderError) {
        const hand=view.yourHand;
        // No opponent cards or deck content: only the authenticated private hand.
        for (const ref of hand) {
          if (typeof ref!=='string') continue;
          const option=(cardSelect.ownerDocument??svg.ownerDocument).createElement('option');
          option.value=ref;
          option.textContent=ref;
          if (typeof cardSelect.appendChild==='function')cardSelect.appendChild(option);
          else cardSelect.append(option);
        }
        cardSelect.value=hand.includes(current)?current:'';
      } else cardSelect.value='';
      if (cardSelect.value!==current)cardRetryKey=null;
      cardSelect.disabled=pending||!cardsReady||renderError;
    }
    if (cardButton)cardButton.disabled=pending||inspecting||!cardsReady||renderError||
      !view.yourHand.includes(cardSelect?.value);
    for (const [action,button] of Object.entries(phaseButtons)) {
      if (!button) continue;
      const allowed=!renderError && permittedPhaseCommand(action,actions);
      button.hidden=inspecting||!allowed;
      button.disabled=pending||inspecting||!allowed;
    }
    message(renderError ? 'El tablero recibido no es válido.' :
      inspecting?'Modo inspección: toca un hexágono para consultar posiciones y distancias. No se enviarán comandos.' :
      cardsReady ? 'Selecciona una carta de tu mano y pulsa Jugar carta de mando para continuar.' :
      ordersReady ? `Asignación de órdenes: ${selectedOrderUnitIds.length} unidades seleccionadas. Toca unidades propias para añadirlas o quitarlas y confirma para enviar al servidor.` :
      actions.includes('answer_synthetic_defense') ? 'Decisión defensiva sintética pendiente: elige Mantener posición o Evadir. No se envía nada hasta pulsar un botón.' :
      actions.includes('acknowledge_synthetic_draw') ? 'Fin del turno sintético: puedes robar una carta y pasar al rival.' :
      defenseReady ? (selectedTargetId
        ? `Objetivo rival ${selectedTargetId} seleccionado. Solicita la decisión defensiva para enviar el comando al servidor.`
        : 'Combate sintético: selecciona una unidad rival para solicitar su decisión defensiva.') :
      !editable?'Tablero de consulta. No puedes mover ahora.':
      draft?`Unidad ${draft.unitId}: ${draft.path.length} pasos seleccionados. ${nextCells.length} vecinos geométricos marcados.${autoRoute ? ' Ruta geométrica automática sugerida (sin validar reglas).' : ''} Toca un paso anterior para recortar la ruta o confirma para enviar al servidor.`:
        `${selectableUnitIds.length} unidades propias sin mover destacadas. Selecciona una para trazar la ruta.`);
  }
  function select(cell) {
    if(pending)return;
    try {
      if (!view) throw Error('MOVIMIENTO_NO_DISPONIBLE');
      if (inspecting) {
        const currentOwn=inspectedCell && view.board.find(unit=>
          unit.side===view.you && key(unit)===key(inspectedCell));
        const clicked=view.board.find(unit=>key(unit)===key(cell));
        if(currentOwn && clicked && clicked.side!==view.you){
          inspectedTarget={col:cell.col,row:cell.row};
        }else{
          inspectedCell={col:cell.col,row:cell.row};
          inspectedTarget=null;
        }
        repaint();
        return;
      }
      const actions=deckActions(view);
      const occupied = view.board.find(unit=>key(unit)===key(cell));
      if (typeof onToggleOrderUnit==='function' &&
          typeof onAssignOrders==='function' &&
          actions.includes('assign_synthetic_orders')) {
        if (!occupied || occupied.side!==view.you) throw Error('UNIDAD_NO_PROPIA');
        onToggleOrderUnit(occupied.id); // the app owns the existing order selection
        orderRetryKey=null;
        repaint();
        return;
      }
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
    if(pending||inspecting)return;
    try {
      const fields=movementDraftFields(view,draft);
      if(!keyForRetry)keyForRetry=makeIdempotencyKey();
      pending=true;repaint();
      await onConfirm(fields,keyForRetry);
      draft=null;keyForRetry=null;autoRoute=false;
    } catch(error){reportError(error);} finally {pending=false;repaint();}
  }
  async function requestDefense() {
    if (pending||inspecting) return;
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
  async function assignOrders() {
    if (pending||inspecting) return;
    try {
      if (!view || !deckActions(view).includes('assign_synthetic_orders') ||
          typeof onAssignOrders!=='function' || typeof onToggleOrderUnit!=='function')
        throw Error('ORDENES_INVALIDAS');
      const ids=getOrderSelection();
      if (!Array.isArray(ids) || ids.length<1 || ids.length>117 ||
          new Set(ids).size!==ids.length ||
          ids.some(id=>typeof id!=='string' ||
            !view.board.some(u=>u?.id===id && u.side===view.you)))
        throw Error('ORDENES_INVALIDAS');
      if (!orderRetryKey) orderRetryKey=makeIdempotencyKey();
      pending=true;repaint();
      const accepted=await onAssignOrders(orderRetryKey);
      if (accepted!==false) orderRetryKey=null;
    } catch(error){reportError(error);} finally {pending=false;repaint();}
  }
  /** Playing a selected private card requires explicit confirmation and the
   * same authenticated command path as the existing deck panel. */
  async function playCard() {
    if (pending||inspecting) return false;
    try {
      if (typeof onPlayCard!=='function' ||
          !deckActions(view).includes('play_synthetic_card'))
        throw Error('ACCION_NO_DISPONIBLE');
      const ref=cardSelect?.value;
      if (!ref || !Array.isArray(view.yourHand) || !view.yourHand.includes(ref))
        throw Error('CARTA_NO_PROPIA');
      if (!cardRetryKey) cardRetryKey=makeIdempotencyKey();
      pending=true;repaint();
      const accepted=await onPlayCard(ref,cardRetryKey);
      if (accepted!==false)cardRetryKey=null;
      return accepted;
    } catch(error){reportError(error);return false;}
    finally {pending=false;repaint();}
  }
  /** Buttons send only the already-supported synthetic commands; retries
   * reuse keys for the same view, phase and defensive choice. */
  async function sendPhaseAction(action) {
    if (pending||inspecting) return false;
    try {
      if (!permittedPhaseCommand(action)) throw Error('ACCION_NO_DISPONIBLE');
      if (!phaseRetries.has(action)) phaseRetries.set(action,makeIdempotencyKey());
      pending=true;repaint();
      const accepted=await onPhaseCommand(
        action.startsWith('defense_')?'answer_synthetic_defense':action,
        phaseFields(action),phaseRetries.get(action)
      );
      if (accepted!==false) phaseRetries.delete(action);
      return accepted;
    } catch(error){reportError(error);return false;}
    finally {pending=false;repaint();}
  }
  function undo() {
    if(pending||inspecting)return;
    try {draft=undoMovementHex(view,draft);keyForRetry=null;autoRoute=false;repaint();}catch(error){reportError(error);}
  }
  function cancel() {if(pending||inspecting)return;draft=null;keyForRetry=null;autoRoute=false;repaint();}
  function toggleInspect() {
    if (pending||!Array.isArray(view?.board))return;
    inspecting=!inspecting;
    inspectedCell=null;inspectedTarget=null;
    repaint();
  }
  inspectButton?.addEventListener('click',toggleInspect);
  profileSelect?.addEventListener('change',repaint);
  undoButton?.addEventListener('click',undo);
  cancelButton?.addEventListener('click',cancel);
  confirmButton?.addEventListener('click',confirm);
  attackButton?.addEventListener('click',requestDefense);
  orderButton?.addEventListener('click',assignOrders);
  cardSelect?.addEventListener('change',()=>{cardRetryKey=null;repaint();});
  cardButton?.addEventListener('click',playCard);
  for (const [action,button] of Object.entries(phaseButtons)) {
    if (button && Object.hasOwn(PHASE_COMMANDS,action))
      button.addEventListener('click',()=>sendPhaseAction(action));
  }
  function setView(next) {
    // Never reuse a command key across revisions, phases, identities or
    // a changed defense decision even if an inconsistent snapshot retains its revision.
    const context=next ? JSON.stringify([
      next.matchId,next.you,next.revision,next.phase,next.actingSide,
      next.turn,next.pendingDecision??null
    ]) : null;
    if (context!==phaseContext) {
      phaseRetries.clear();
      phaseContext=context;
    }
    const nextCardContext=next?JSON.stringify([
      next.matchId,next.you,next.revision,next.phase,next.actingSide
    ]):null;
    if (nextCardContext!==cardContext) {
      cardRetryKey=null;
      cardContext=nextCardContext;
      if (cardSelect)cardSelect.value='';
    }
    // Also accept an SSE/HTTP refresh while a submission is in flight.
    if(!next||!view || next.matchId!==view.matchId || next.you!==view.you
       || next.revision!==view.revision || next.phase!==view.phase || next.actingSide!==view.actingSide) {
      draft=null;keyForRetry=null;autoRoute=false;
      selectedTargetId=null;defenseRetryKey=null;
      orderRetryKey=null;orderSelectionFingerprint=null;
      inspecting=false;inspectedCell=null;inspectedTarget=null;
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
  return Object.freeze({setView,select,undo,cancel,confirm,requestDefense,assignOrders,
    sendPhaseAction,playCard,toggleInspect,
    getDraft:()=>draft ? structuredClone(draft):null});
}
