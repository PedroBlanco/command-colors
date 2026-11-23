/** Local-only browser lab; no licensed artwork, card texts or legal Ancients rules. */
import {deckActions, deckCommand, deckSummary, parseSyntheticMovementPath} from './deck-controls.mjs';
import {createMovementBoard,renderMovementBoard} from './movement-board-ui.mjs';
import {distance} from '../hex-grid/hex.mjs';
import {describeCommandError} from './command-feedback.mjs';
import {createPrivateViewScope} from './private-view-scope.mjs';
import {privateProjectionMatches} from './private-projection.mjs';
import {createRevisionRefresh} from './revision-refresh.mjs';

const el = id => document.getElementById(id);
const message = value => {el('message').textContent = value;};
const stateText = value => {el('state').textContent = JSON.stringify(value,null,2);};
// Report command errors in their originating control group, not only in #message.
const deckFeedbackSlots=Object.freeze({
  'deck-initialize':'deck-init-feedback','deck-play':'deck-card-feedback',
  'deck-unit-add':'deck-orders-feedback','deck-unit-clear':'deck-orders-feedback',
  'deck-orders':'deck-orders-feedback','deck-undo':'deck-orders-feedback',
  'deck-move':'deck-move-feedback','deck-movement':'deck-move-feedback',
  'deck-ask-defense':'deck-combat-feedback','deck-stand':'deck-combat-feedback',
  'deck-evade':'deck-combat-feedback','deck-combat':'deck-combat-feedback',
  'deck-draw':'deck-combat-feedback'
});
function clearDeckFeedback() {
  for(const id of new Set(Object.values(deckFeedbackSlots))) el(id).textContent='';
}
let cached = null;
let signedInHandle = null;
const privateScope = createPrivateViewScope();
let movementBoard = null;
let ancientsDraft = null;
let ancientsDraftScope = null;
let ancientsRetry = null;
let ancientsWatch = null, ancientsWatchMatchId = null, ancientsWatchBusy = false;
function syncAncientsWatch(){
  const id=cached?.status==='LAB_ONLY'&&signedInHandle
    ? privateScope.capture().matchId:null;
  if(!id||ancientsWatchMatchId!==id){
    if(ancientsWatch!==null)clearInterval(ancientsWatch);
    ancientsWatch=null;ancientsWatchMatchId=null;
  }
  if(!id||ancientsWatch!==null)return;
  ancientsWatchMatchId=id;
  ancientsWatch=setInterval(async()=>{
    if(ancientsWatchBusy||document.hidden||cached?.status!=='LAB_ONLY'||
       privateScope.capture().matchId!==id)return;
    ancientsWatchBusy=true;
    try{await inspect();}
    catch{/* The next authenticated poll can retry; never reveal old state. */}
    finally{ancientsWatchBusy=false;}
  },12000); // Fallback in case a private SSE notice is missed.
  ancientsWatch.unref?.();
}
let updates = null, updateMatchId = null, inspectionSequence = 0;
let lobbyStatus = null, panelKey = null;
let lobbyWatch = null, lobbyWatchMatchId = null, lobbyWatchBusy = false;

// SSE is primary; a bounded authorized recheck only while INVITING
// avoids a stuck lobby if the READY transition notice is missed.
function syncLobbyWatch(mode, matchId) {
  const waiting = mode === 'invite' && Boolean(signedInHandle && matchId);
  if (!waiting || lobbyWatchMatchId !== matchId) {
    if (lobbyWatch !== null) clearInterval(lobbyWatch);
    lobbyWatch = null;
    lobbyWatchMatchId = null;
  }
  if (!waiting || lobbyWatch !== null) return;
  const watching = matchId;
  lobbyWatchMatchId = watching;
  lobbyWatch = setInterval(async () => {
    if (lobbyWatchBusy || document.hidden || !signedInHandle ||
        privateScope.capture().matchId !== watching ||
        lobbyStatus === 'READY') return;
    lobbyWatchBusy = true;
    try {
      await inspect(); // independently revalidates session and match
    } catch {
      // A transient GET error cannot leak state or stop later recovery.
    } finally { lobbyWatchBusy = false; }
  }, 2500);
  lobbyWatch.unref?.(); // Node test harness; no effect on browsers
}
let selectedOrderUnits = new Set(), orderSelectionContext = null;

// Fold irrelevant application phases, but do not override a player's manual
// expand/collapse choice on every SSE update. Never expose private data merely
// because a panel has been opened: authorized GET and projection still rule.
function updatePanels() {
  const matchId = privateScope.capture().matchId;
  const mode = !signedInHandle ? 'login' : !matchId ? 'browse' :
    lobbyStatus !== 'READY' ? 'invite' :
      typeof cached?.phase === 'string' ? 'game' : 'ready';
  el('login-form').hidden = Boolean(signedInHandle);
  el('logout').disabled = !signedInHandle;
  syncLobbyWatch(mode,matchId);
  const key = [signedInHandle ?? '', matchId ?? '', mode].join(':');
  if (key === panelKey) return;
  panelKey = key;
  const open = {
    'login-details': mode === 'login',
    'match-details': mode === 'browse' || mode === 'invite',
    'invite-details': mode === 'browse' || mode === 'invite',
    'state-details': mode === 'ready' || mode === 'game',
    'deck-details': mode === 'ready' || mode === 'game',
    'movement-details': mode === 'game' && cached?.status !== 'LAB_ONLY',
    'ancients-details': mode === 'game' && cached?.status === 'LAB_ONLY'
  };
  for (const [id,expanded] of Object.entries(open)) el(id).open = expanded;
}

// A dropdown is only a convenience: the server independently validates all
// unit IDs and all orders. Never present hidden hands or opponent units as
// selectable own units.
function updateUnitOptions(id, side, multiple = false) {
  const select = el(id);
  const previous = new Set(Array.from(select.selectedOptions ?? [],option=>option.value));
  const previousValue = select.value;
  select.replaceChildren();
  if (!multiple) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Selecciona una unidad';
    select.appendChild(placeholder);
  }
  const units = Array.isArray(cached?.board) ? cached.board : [];
  for (const unit of units) {
    if (!unit || unit.side !== side || typeof unit.id !== 'string' ||
        !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(unit.id) ||
        !Number.isSafeInteger(unit.col) || !Number.isSafeInteger(unit.row)) continue;
    const option = document.createElement('option');
    option.value = unit.id;
    option.textContent = `${unit.id} (col. ${unit.col+1}, fila ${unit.row+1})`;
    option.selected = multiple ? previous.has(unit.id) : previousValue === unit.id;
    select.appendChild(option);
  }
  if (!multiple && !Array.from(select.options ?? select.children ?? [])
    .some(option=>option.value === previousValue && option.selected)) select.value = '';
}
const revisionRefresh = createRevisionRefresh({
  inspect: () => inspect(),
  onError: error => message(error.message)
});
revisionRefresh.setPaused(document.hidden);

// Optional, explicitly local Ancients laboratory. This control surface is
// completely separate from the old synthetic deck command contract.
function renderAncients() {
  const lab=cached?.status==='LAB_ONLY';
  const ready=lobbyStatus==='READY'&&Boolean(cached?.matchId);
  syncAncientsWatch();
  el('ancients-details').hidden=!ready;
  el('ancients-start').disabled=!ready||lab||cached?.you!=='A'||
    cached?.revision!==0||Boolean(cached?.phase);
  el('ancients-refresh').disabled=!ready;
  el('ancients-controls').hidden=!lab;
  if(!lab){
    ancientsDraft=null;ancientsDraftScope=null;ancientsRetry=null;
    el('ancients-status').textContent=ready
      ? 'Demo de Ancients no iniciada. Requiere activación local expresa.'
      : 'No hay partida preparada.';
    return;
  }
  const isTurn=cached.turn===cached.you;
  const scope=[cached.matchId,cached.you,cached.revision,cached.phase].join(':');
  if(ancientsDraftScope!==scope){ancientsDraft=null;ancientsRetry=null;ancientsDraftScope=scope;}
  el('ancients-status').textContent=
    `Ancients experimental · ${cached.phase} · turno ${cached.turn} · revisión ${cached.revision}`;
  const terrainNames={FOREST:'bosque',HILL:'colina',
    BROKEN_GROUND:'terreno accidentado'};
  el('ancients-terrain-info').textContent='Terreno del escenario: '+
    (cached.terrain?.length
      ?cached.terrain.map(x=>`${terrainNames[x.kind]??'desconocido'} (${x.col+1},${x.row+1})`).join('; ')
      :'solo hexágonos despejados')+'.';
  const cardSelect=el('ancients-card');
  const chosen=cardSelect.value;
  cardSelect.replaceChildren();
  for(const card of cached.yourHand??[]){
    const option=document.createElement('option');
    option.value=card.instanceId;
    option.textContent=card.definitionId;
    cardSelect.appendChild(option);
  }
  if((cached.yourHand??[]).some(c=>c.instanceId===chosen))
    cardSelect.value=chosen;
  const unitSelect=el('ancients-units');
  const selected=new Set(Array.from(unitSelect.selectedOptions??[],x=>x.value));
  unitSelect.replaceChildren();
  for(const unit of cached.board??[]){
    if(unit.side!==cached.you)continue;
    const option=document.createElement('option');
    option.value=unit.id;
    option.textContent=`${unit.id} (${unit.unitType}, ${unit.col+1},${unit.row+1})`;
    option.selected=selected.has(unit.id);
    unitSelect.appendChild(option);
  }
  const ordered=new Set(Array.isArray(cached.orderedUnitIds)?cached.orderedUnitIds:[]);
  const moved=new Set(Array.isArray(cached.movedUnitIds)?cached.movedUnitIds:[]);
  const selectable=(cached.board??[]).filter(u=>u.side===cached.you&&
    ordered.has(u.id)&&!moved.has(u.id)).map(u=>u.id);
  el('ancients-play').disabled=!isTurn||cached.phase!=='AWAIT_CARD'||
    (cached.yourHand??[]).length===0;
  el('ancients-order').disabled=!isTurn||cached.phase!=='ASSIGN_ORDERS';
  el('ancients-end').disabled=!isTurn||cached.phase!=='LAB_RESOLUTION_PENDING';
  el('ancients-clear-path').disabled=!ancientsDraft;
  el('ancients-move').disabled=!isTurn||cached.phase!=='LAB_RESOLUTION_PENDING'||
    !ancientsDraft?.path.length;
  el('ancients-route-status').textContent=ancientsDraft
    ? `Unidad ${ancientsDraft.unitId}: ${ancientsDraft.path.length} hexágonos. Confirma para validar en el servidor.`
    : `${selectable.length} unidades ordenadas disponibles; selecciona una sobre el tablero.`;
  const svg=el('ancients-board');
  if(svg?.ownerDocument?.createElementNS){
    renderMovementBoard(svg,cached.board??[],ancientsDraft,selectAncientsHex,cached.you,{
      terrain:Array.isArray(cached.terrain)?cached.terrain:[],
      selectableUnitIds:selectable
    });
  }
}
function selectAncientsHex(cell){
  if(cached?.status!=='LAB_ONLY'||cached.turn!==cached.you||
     cached.phase!=='LAB_RESOLUTION_PENDING')return;
  const units=cached.board??[];
  const at=units.find(u=>u.col===cell.col&&u.row===cell.row);
  const ordered=new Set(cached.orderedUnitIds??[]);
  const moved=new Set(cached.movedUnitIds??[]);
  if(at?.side===cached.you&&ordered.has(at.id)&&!moved.has(at.id)){
    ancientsDraft={unitId:at.id,origin:{col:at.col,row:at.row},
      path:[],revision:cached.revision};
  }else if(ancientsDraft){
    const key=p=>`${p.col},${p.row}`;
    const previous=ancientsDraft.path.at(-1)??ancientsDraft.origin;
    const index=ancientsDraft.path.findIndex(p=>key(p)===key(cell));
    if(key(ancientsDraft.origin)===key(cell)){
      ancientsDraft.path=[];
    }else if(index>=0){
      ancientsDraft.path=ancientsDraft.path.slice(0,index+1);
    }else if(distance(previous,cell)!==1){
      el('ancients-route-status').textContent='El siguiente hexágono debe ser contiguo.';
      return;
    }else if(at){
      el('ancients-route-status').textContent='El hexágono está ocupado.';
      return;
    }else if(ancientsDraft.path.length>=4){
      el('ancients-route-status').textContent='Superado el máximo provisional de cuatro hexágonos.';
      return;
    }else{
      ancientsDraft.path.push({col:cell.col,row:cell.row});
    }
  }
  renderAncients();
}
async function sendAncients(type,fields={},idempotencyKey=null){
  if(cached?.status!=='LAB_ONLY'||!cached?.matchId)
    throw Error('LABORATORIO_NO_DISPONIBLE');
  const matchId=cached.matchId,ticket=privateScope.capture();
  if(!await confirmCurrentSession(ticket,matchId))return false;
  const signature=JSON.stringify({matchId,side:cached.you,
    revision:cached.revision,type,fields});
  if(!ancientsRetry||ancientsRetry.signature!==signature){
    ancientsRetry={signature,
      key:idempotencyKey??crypto.randomUUID().replaceAll('-','')};
  }
  const command={type,expectedRevision:cached.revision,
    idempotencyKey:ancientsRetry.key,...fields};
  // Retry the exact same command with the exact same key after transport
  // uncertainty. Never allow a network retry to create a second movement.
  await api('POST',`/api/matches/${matchId}/ancients-lab/commands`,command);
  ancientsRetry=null;
  if(!privateScope.isCurrent(ticket,matchId))return false;
  await inspect();
  return privateScope.isCurrent(ticket,matchId);
}

function renderDeck() {
  const isDeck = cached && cached.status !== 'LAB_ONLY' && typeof cached.phase === 'string';
  const options = isDeck ? deckActions(cached) : [];
  const orderContext = cached?.phase === 'ASSIGN_ORDERS'
    ? [cached.matchId,cached.you,cached.revision].join(':') : null;
  if (orderContext !== orderSelectionContext) {
    selectedOrderUnits.clear();
    orderSelectionContext = orderContext;
  }
  el('deck-panel').hidden = !isDeck;
  el('deck-initialize').disabled = !cached || cached.you !== 'A' || cached.revision !== 0 || isDeck || cached.status === 'LAB_ONLY';
  el('turn').disabled = Boolean(isDeck || cached?.status === 'LAB_ONLY');
  const select = el('deck-card');
  const selected = select.value;
  select.replaceChildren();
  if (isDeck && Array.isArray(cached.yourHand)) {
    for (const cardRef of cached.yourHand) {
      const option = document.createElement('option');
      option.value = cardRef;
      option.textContent = cardRef;
      select.appendChild(option);
    }
    if (cached.yourHand.includes(selected)) select.value = selected;
  }
  updateUnitOptions('deck-units',cached?.you);
  updateUnitOptions('deck-move-unit',cached?.you);
  updateUnitOptions('deck-target',cached?.you === 'A' ? 'B' : 'A');
  const currentUnits = new Set((Array.isArray(cached?.board) ? cached.board : [])
    .filter(unit => unit?.side === cached?.you).map(unit => unit.id));
  for (const id of selectedOrderUnits) {
    if (!currentUnits.has(id)) selectedOrderUnits.delete(id);
  }
  el('deck-unit-selected').textContent = selectedOrderUnits.size
    ? `Unidades seleccionadas: ${[...selectedOrderUnits].join(', ')}`
    : 'Ninguna unidad seleccionada';
  el('deck-unit-add').disabled = !options.includes('assign_synthetic_orders') ||
    !currentUnits.has(el('deck-units').value) ||
    selectedOrderUnits.has(el('deck-units').value);
  el('deck-unit-clear').disabled = selectedOrderUnits.size === 0;
  for (const [id,type] of [
    ['deck-play','play_synthetic_card'],['deck-orders','assign_synthetic_orders'],
    ['deck-undo','undo_synthetic_orders'],['deck-move','move_synthetic_unit'],['deck-movement','finish_synthetic_movement'],
    ['deck-ask-defense','ask_synthetic_defense'],['deck-stand','answer_synthetic_defense'],
    ['deck-evade','answer_synthetic_defense'],['deck-combat','finish_synthetic_combat'],
    ['deck-draw','acknowledge_synthetic_draw']
  ]) el(id).disabled = !options.includes(type) ||
    (id === 'deck-play' && select.value === '') ||
    (id === 'deck-orders' && selectedOrderUnits.size === 0);
  el('deck-status').textContent = isDeck
    ? `Mazo de prueba · fase ${cached.phase} · turno ${cached.turn} · debe actuar ${cached.actingSide}`
    : 'El mazo de prueba aún no está inicializado';
  movementBoard?.setView(cached?.status==='LAB_ONLY'?null:cached);
  renderAncients();
  updatePanels();
}

function clearMatchPresentation() {
  lobbyStatus = null;
  cached = null;
  stateText(null);
  el('lobby').textContent = 'Sin partida cargada';
  el('invite-token').textContent = '—';
  el('received').value = '';
  clearDeckFeedback();
  renderDeck();
}
function clearPrivateView() {
  signedInHandle = null;
  privateScope.reset();
  inspectionSequence++; // invalidate GETs started under an earlier session
  clearMatchPresentation();
  el('match-id').value = '';
  updatePanels();
}
function selectActiveMatch(id) {
  // Programmatic navigation (create/accept) must clear private tokens too,
  // not just edits from the match-id input event.
  if (privateScope.capture().matchId !== id) {
    closeUpdates();
    inspectionSequence++;
    clearMatchPresentation();
  }
  privateScope.selectMatch(id);
  updatePanels();
}
function closeUpdates() {
  if (updates) updates.close();
  updates = null;
  updateMatchId = null;
  revisionRefresh.reset();
  el('connection').textContent = 'Avisos en tiempo real desconectados';
}
function subscribeTo(matchId,kind='synthetic') {
  if (typeof EventSource !== 'function') return;
  const subscriptionKey=matchId+':'+kind;
  if (updates && updateMatchId === subscriptionKey) return;
  closeUpdates();
  updateMatchId = subscriptionKey;
  const stream = new EventSource(`/api/matches/${matchId}/${kind==='ancients'
    ?'ancients-lab/updates':'updates'}`);
  const ticket = privateScope.capture();
  updates = stream;
  const active = () => updates === stream && privateScope.isCurrent(ticket,matchId) &&
    el('match-id').value.trim() === matchId;
  el('connection').textContent = 'Conectando avisos de partida…';
  stream.onopen = () => {
    if (active()) el('connection').textContent = 'Avisos de partida conectados';
  };
  stream.onerror = () => {
    if (active()) el('connection').textContent = 'Reconectando avisos de partida…';
  };
  stream.addEventListener('revision', event => {
    // Ignore callbacks queued before logout or a match / identity switch.
    if (!active()) return;
    try {
      const {lobbyRevision, gameRevision} = JSON.parse(event.data);
      if (!Number.isSafeInteger(lobbyRevision) || !(gameRevision === null || Number.isSafeInteger(gameRevision))) return;
      // The event can arrive just before visibilitychange is dispatched.
      // Never launch a private GET from a hidden tab merely for a notice.
      if (document.hidden) revisionRefresh.setPaused(true);
      // A revision is acknowledged only after inspect() really succeeds.
      // Failed HTTP requests remain pending for bounded automatic retry.
      revisionRefresh.notice(`${lobbyRevision}:${gameRevision}`);
    } catch {if (active()) message('No se ha podido interpretar el aviso de revisión');}
  });
}
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    revisionRefresh.setPaused(true);
    return;
  }
  // Confirm the current cookie identity before resuming deferred notices.
  if (!await session() || document.hidden) return;
  // A second visibilitychange may hide the tab while the session GET awaits.
  // Never unpause based on a stale visible event.
  revisionRefresh.setPaused(false);
  // A focused waiting lobby must refresh even if the SSE revision was missed.
  if (lobbyStatus === 'INVITING' && !document.hidden) {
    try { await inspect(); } catch { /* the periodic guard will retry */ }
  }
});
window.addEventListener('beforeunload', closeUpdates);

async function api(method,path,data) {
  const res = await fetch(path, {
    method, credentials:'same-origin', cache:'no-store',
    headers: method === 'GET' ? {} : {'content-type':'application/json','x-ccw-request':'1'},
    ...(data===undefined ? {} : {body:JSON.stringify(data)})
  });
  const result = await res.json();
  if (!res.ok) throw new Error(`${res.status}: ${result.code ?? 'Error'}`);
  return result;
}
async function session() {
  const ticket=privateScope.capture();
  try {
    const data=await api('GET','/api/session');
    if (!privateScope.isCurrent(ticket)) return false;
    if (!data || typeof data.handle !== 'string' || !data.handle.trim()) {
      closeUpdates();clearPrivateView();
      el('current').textContent='Sin sesión';
      return false;
    }
    if (signedInHandle && signedInHandle !== data.handle) {
      closeUpdates();clearPrivateView();
      signedInHandle=data.handle;
      el('current').textContent=`Conectado: ${data.handle}`;
      updatePanels();
      message('Ha cambiado la identidad de la sesión. Vuelve a abrir la partida.');
      return false;
    }
    signedInHandle=data.handle;
    el('current').textContent=`Conectado: ${data.handle}`;
    updatePanels();
    return true;
  } catch (error) {
    if (!privateScope.isCurrent(ticket)) return false;
    if (/^401:/.test(error.message)) {
      closeUpdates();clearPrivateView();
      el('current').textContent='Sin sesión';
      message('La sesión ha caducado o se ha cerrado.');
    } else {
      // Treat a failed identity check as unverified: keep no old hand visible.
      closeUpdates();clearPrivateView();
      el('current').textContent='No se ha podido verificar la sesión';
      message('No se puede verificar la identidad; vuelve a identificarte.');
    }
    return false;
  }
}
async function inspect() {
  const id = el('match-id').value.trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw Error('Introduce el identificador de partida');
  selectActiveMatch(id);
  const sequence = ++inspectionSequence;
  const ticket = privateScope.capture();
  // Recheck the session before processing SSE or another private snapshot.
  // Another tab may have logged in with a different cookie while we were open.
  if (!await session() || !privateScope.isCurrent(ticket,id) ||
      sequence !== inspectionSequence || el('match-id').value.trim() !== id) return false;
  let lobby;
  try {
    lobby=await api('GET',`/api/matches/${id}`);
  } catch(initialError) {
    let error=initialError;
    if(error.message==='409: SECTION_LAB_INTERNAL_ONLY'){
      try {
        // This route exists only on explicitly opt-in loopback instances.
        lobby=await api('GET',`/api/matches/${id}/ancients-lab`);
      }catch(labError){error=labError;}
    }
    if(!lobby){
      if (!privateScope.isCurrent(ticket,id) || sequence !== inspectionSequence || el('match-id').value.trim() !== id) return false;
      if (/^(401|403|404):/.test(error.message)) {
        closeUpdates();clearPrivateView();
        if (/^401:/.test(error.message)) el('current').textContent='Sin sesión';
        message('La sesión o la partida ya no están disponibles.');
        return false;
      }
      throw error;
    }
  }
  if (!privateScope.isCurrent(ticket,id) || sequence !== inspectionSequence || el('match-id').value.trim() !== id) return false;
  if (!privateProjectionMatches(lobby,signedInHandle,id)) {
    // Refuse to render a side that does not belong to the verified account,
    // including a 200 response after an inter-tab cookie transition.
    closeUpdates();clearPrivateView();
    message('La respuesta de partida no corresponde a la sesión vigente.');
    return false;
  }
  subscribeTo(id,lobby.state?.status==='LAB_ONLY'?'ancients':'synthetic');
  el('lobby').textContent=JSON.stringify({status:lobby.status,players:lobby.players},null,2);
  lobbyStatus = lobby.status;
  cached=lobby.state??null;
  renderDeck();
  stateText(cached ? (deckSummary(cached) ?? {tuBando:cached.you,turno:cached.turn,revision:cached.revision,
    tuMano:cached.yourHand,cartasDelRival:cached.opponentCardCount,unidadesPublicas:cached.board})
    : {estado:'Esperando segundo jugador'});
  return lobby;
}
function action(id,callback) {
  const feedbackId=Object.hasOwn(deckFeedbackSlots,id) ? deckFeedbackSlots[id] : null;
  el(id).addEventListener('click',async() => {
    const ticket=privateScope.capture();
    if (feedbackId && privateScope.isCurrent(ticket)) el(feedbackId).textContent='';
    try {
      const outcome = await callback();
      if (outcome !== false && privateScope.isCurrent(ticket)) {
        message('Operación realizada');
        if (feedbackId) el(feedbackId).textContent='Operación realizada';
      }
    } catch(error) {
      if (privateScope.isCurrent(ticket)) {
        const explanation=feedbackId ? describeCommandError(error) : error.message;
        message(explanation);
        if (feedbackId) el(feedbackId).textContent=explanation;
      }
    }
  });
}
/** A cookie may have changed in another tab since the current view was drawn. */
async function confirmCurrentSession(ticket, matchId = ticket.matchId) {
  if (!privateScope.isCurrent(ticket,matchId)) return false;
  if (!await session()) return false;
  return privateScope.isCurrent(ticket,matchId) &&
    (matchId === null || el('match-id').value.trim() === matchId);
}
async function sendDeck(type, fields = {}, retryKey = null) {
  if (!cached?.matchId) throw new Error('No hay partida activa');
  const matchId = cached.matchId;
  const ticket = privateScope.capture();
  if (!privateScope.isCurrent(ticket,matchId) || el('match-id').value.trim() !== matchId)
    throw new Error('PARTIDA_DESACTUALIZADA');
  const key = retryKey ?? crypto.randomUUID().replaceAll('-','');
  const request = deckCommand(cached,type,fields,key);
  // A command cannot rely only on a cached client-side actor. Validate the
  // current cookie identity before issuing this mutation.
  if (!await session() || !privateScope.isCurrent(ticket,matchId) ||
      el('match-id').value.trim() !== matchId) return false;
  try {
    await api('POST',`/api/matches/${matchId}/commands`,request);
  } catch (error) {
    // An old failure cannot overwrite a new account's status message.
    if (!privateScope.isCurrent(ticket,matchId) || el('match-id').value.trim() !== matchId) return false;
    throw error;
  }
  if (!privateScope.isCurrent(ticket,matchId) || el('match-id').value.trim() !== matchId) return false;
  await inspect();
  return privateScope.isCurrent(ticket,matchId);
}
el('login-form').addEventListener('submit',async(event) => {
  event.preventDefault();
  // Invalidate all old GET/POST responses as soon as identity changes.
  closeUpdates(); clearPrivateView();
  const ticket = privateScope.capture();
  try {
    await api('POST','/api/session',{handle:el('handle').value,password:el('password').value});
    if (!privateScope.isCurrent(ticket)) return;
    el('password').value='';
    if (await session() && privateScope.isCurrent(ticket)) message('Sesión iniciada');
  } catch(error){if(privateScope.isCurrent(ticket)) message(error.message);}
});
action('logout',async()=>{
  closeUpdates();clearPrivateView();
  const ticket=privateScope.capture();
  await api('DELETE','/api/session');
  if(!privateScope.isCurrent(ticket))return false;
  await session();
  return privateScope.isCurrent(ticket);
});
action('create',async()=>{
  const ticket=privateScope.capture();
  if(!await confirmCurrentSession(ticket))return false;
  const result=await api('POST','/api/matches');
  if(!privateScope.isCurrent(ticket))return false;
  el('match-id').value=result.matchId;
  selectActiveMatch(result.matchId);
  const nextTicket=privateScope.capture();
  await inspect();
  return privateScope.isCurrent(nextTicket,result.matchId);
});
el('match-id').addEventListener('input', () => {
  if (el('match-id').value.trim() !== updateMatchId) {
    privateScope.reset();closeUpdates();inspectionSequence++;
    clearMatchPresentation();
  }
});
action('refresh',inspect);
action('invite',async()=>{
  const id=el('match-id').value.trim(),ticket=privateScope.capture();
  if(!privateScope.isCurrent(ticket,id))throw Error('PARTIDA_DESACTUALIZADA');
  if(!await confirmCurrentSession(ticket,id))return false;
  const data=await api('POST',`/api/matches/${id}/invitations`,{targetHandle:el('invitee').value});
  if(!privateScope.isCurrent(ticket,id) || el('match-id').value.trim()!==id)return false;
  // A cookie might change in a second tab while the token POST is pending.
  // Never display a secret response until identity has been rechecked.
  if(!await confirmCurrentSession(ticket,id))return false;
  el('invite-token').textContent=data.token;
});
action('accept',async()=>{
  const ticket=privateScope.capture();
  if(!await confirmCurrentSession(ticket))return false;
  const data=await api('POST','/api/invitations/accept',{invitationToken:el('received').value.trim()});
  if(!privateScope.isCurrent(ticket))return false;
  el('match-id').value=data.matchId;
  selectActiveMatch(data.matchId);
  const nextTicket=privateScope.capture();
  await inspect();
  return privateScope.isCurrent(nextTicket,data.matchId);
});
action('reject',async()=>{
  const ticket=privateScope.capture();
  if(!await confirmCurrentSession(ticket))return false;
  await api('POST','/api/invitations/reject',{invitationToken:el('received').value.trim()});
  return privateScope.isCurrent(ticket);
});
action('turn',async()=>{
  if(!cached?.matchId)throw Error('No hay partida activa');
  const matchId=cached.matchId,revision=cached.revision,ticket=privateScope.capture();
  if(!privateScope.isCurrent(ticket,matchId))throw Error('PARTIDA_DESACTUALIZADA');
  if(!await confirmCurrentSession(ticket,matchId))return false;
  await api('POST',`/api/matches/${matchId}/commands`,{type:'pass_demo_turn',expectedRevision:revision,
    idempotencyKey:crypto.randomUUID().replaceAll('-','')});
  if(!privateScope.isCurrent(ticket,matchId))return false;
  await inspect();
  return privateScope.isCurrent(ticket,matchId);
});
action('events',async()=>{
  const id=el('match-id').value.trim(),ticket=privateScope.capture();
  if(!privateScope.isCurrent(ticket,id))throw Error('PARTIDA_DESACTUALIZADA');
  if(!await confirmCurrentSession(ticket,id))return false;
  const events=await api('GET',`/api/matches/${id}/events`);
  if(!privateScope.isCurrent(ticket,id) || el('match-id').value.trim()!==id)return false;
  // Event contents are not accepted from a request whose cookie identity
  // may have changed while its HTTP response was in flight.
  if(!await confirmCurrentSession(ticket,id))return false;
  stateText(events);
});
action('deck-initialize',async()=>{
  if(!cached?.matchId || cached.you !== 'A' || cached.revision !== 0 || cached.phase)throw Error('INICIALIZACION_NO_DISPONIBLE');
  const id=cached.matchId,ticket=privateScope.capture();
  if(!privateScope.isCurrent(ticket,id))throw Error('PARTIDA_DESACTUALIZADA');
  if(!await confirmCurrentSession(ticket,id))return false;
  await api('POST',`/api/matches/${id}/deck/initialize`,{});
  if(!privateScope.isCurrent(ticket,id))return false;
  await inspect();
  return privateScope.isCurrent(ticket,id);
});
action('ancients-start',async()=>{
  const id=cached?.matchId,ticket=privateScope.capture();
  if(!id||cached.you!=='A'||cached.revision!==0||cached.phase)
    throw Error('INICIALIZACION_NO_DISPONIBLE');
  if(!await confirmCurrentSession(ticket,id))return false;
  await api('POST',`/api/matches/${id}/ancients-lab/initialize`,{});
  if(!privateScope.isCurrent(ticket,id))return false;
  await inspect();
  return privateScope.isCurrent(ticket,id);
});
action('ancients-refresh',inspect);
action('ancients-play',()=>sendAncients('PLAY_SECTION_CARD',{
  cardInstanceId:el('ancients-card').value
}));
action('ancients-order',()=>sendAncients('ASSIGN_SECTION_ORDERS',{
  unitIds:Array.from(el('ancients-units').selectedOptions??[],x=>x.value),
  leaderIds:[]
}));
action('ancients-clear-path',async()=>{
  ancientsDraft=null;renderAncients();return false;
});
action('ancients-move',()=>{
  if(!ancientsDraft?.path.length||ancientsDraft.revision!==cached?.revision)
    throw Error('BORRADOR_DESACTUALIZADO');
  const selected=(cached?.board??[]).find(u=>u.id===ancientsDraft.unitId);
  const type=['LIGHT_CAVALRY','MEDIUM_CAVALRY','HEAVY_CAVALRY',
    'ELEPHANT','HEAVY_CHARIOT'].includes(selected?.unitType)
    ?'MOVE_SECTION_MOUNTED_PATH_V1':'MOVE_SECTION_FOOT_PATH_V2';
  return sendAncients(type,{
    unitId:ancientsDraft.unitId,
    path:ancientsDraft.path.map(p=>({col:p.col,row:p.row}))
  });
});
action('ancients-end',()=>sendAncients('END_EXPERIMENTAL_TURN'));
action('deck-play',()=>sendDeck('play_synthetic_card',{cardRef:el('deck-card').value}));
el('deck-units').addEventListener('change',()=>{
  const id=el('deck-units').value;
  const available=Array.isArray(cached?.board) &&
    cached.board.some(unit=>unit?.id===id && unit.side===cached.you);
  el('deck-unit-add').disabled =
    !deckActions(cached).includes('assign_synthetic_orders') ||
    !available || selectedOrderUnits.has(id);
});
action('deck-unit-add',async()=>{
  const id=el('deck-units').value;
  if (!deckActions(cached).includes('assign_synthetic_orders') ||
      !cached?.board?.some(unit=>unit?.id===id && unit.side===cached.you))
    throw Error('UNIDAD_NO_DISPONIBLE');
  selectedOrderUnits.add(id);
  renderDeck();
  return false; // local selection only, no server command was applied
});
action('deck-unit-clear',async()=>{
  selectedOrderUnits.clear();
  renderDeck();
  return false;
});
action('deck-orders',()=>sendDeck('assign_synthetic_orders',{
  unitIds: [...selectedOrderUnits]
}));
action('deck-undo',()=>sendDeck('undo_synthetic_orders'));
action('deck-move',()=>sendDeck('move_synthetic_unit',{
  unitId: el('deck-move-unit').value,
  path: parseSyntheticMovementPath(el('deck-move-path').value)
}));
action('deck-movement',()=>sendDeck('finish_synthetic_movement'));
action('deck-ask-defense',()=>sendDeck('ask_synthetic_defense',{targetUnit:el('deck-target').value}));
action('deck-stand',()=>sendDeck('answer_synthetic_defense',{choice:'STAND'}));
action('deck-evade',()=>sendDeck('answer_synthetic_defense',{choice:'EVADE'}));
action('deck-combat',()=>sendDeck('finish_synthetic_combat'));
action('deck-draw',()=>sendDeck('acknowledge_synthetic_draw'));
movementBoard = createMovementBoard({
  svg: el('movement-board'),
  status: el('movement-status'),
  undoButton: el('board-undo'),
  cancelButton: el('board-cancel'),
  confirmButton: el('board-confirm'),
  attackButton: el('board-ask-defense'),
  onRequestDefense: async (unitId,idempotencyKey) => {
    const confirmed=await sendDeck('ask_synthetic_defense',
      {targetUnit:unitId},idempotencyKey);
    if (confirmed) message('Solicitud de defensa sintética registrada');
    return confirmed;
  },
  onConfirm: async (fields, idempotencyKey) => {
    const confirmed=await sendDeck('move_synthetic_unit', fields, idempotencyKey);
    if (confirmed) message('Movimiento sintético confirmado por el servidor');
    return confirmed;
  },
  onError: error => message(describeCommandError(error))
});
renderDeck();
await session();
