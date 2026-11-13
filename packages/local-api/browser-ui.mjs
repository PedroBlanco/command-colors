/** Local-only browser lab; no licensed artwork, card texts or legal Ancients rules. */
import {deckActions, deckCommand, deckSummary, parseSyntheticMovementPath} from './deck-controls.mjs';
import {createMovementBoard} from './movement-board-ui.mjs';
import {createPrivateViewScope} from './private-view-scope.mjs';
import {privateProjectionMatches} from './private-projection.mjs';
import {createRevisionRefresh} from './revision-refresh.mjs';

const el = id => document.getElementById(id);
const message = value => {el('message').textContent = value;};
const stateText = value => {el('state').textContent = JSON.stringify(value,null,2);};
let cached = null;
let signedInHandle = null;
const privateScope = createPrivateViewScope();
let movementBoard = null;
let updates = null, updateMatchId = null, inspectionSequence = 0;
let lobbyStatus = null, panelKey = null;
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
  const key = [signedInHandle ?? '', matchId ?? '', mode].join(':');
  if (key === panelKey) return;
  panelKey = key;
  const open = {
    'login-details': mode === 'login',
    'match-details': mode === 'browse' || mode === 'invite',
    'invite-details': mode === 'browse' || mode === 'invite',
    'state-details': mode === 'ready' || mode === 'game',
    'deck-details': mode === 'ready' || mode === 'game',
    'movement-details': mode === 'game'
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

function renderDeck() {
  const isDeck = cached && typeof cached.phase === 'string';
  const options = isDeck ? deckActions(cached) : [];
  const orderContext = cached?.phase === 'ASSIGN_ORDERS'
    ? [cached.matchId,cached.you,cached.revision].join(':') : null;
  if (orderContext !== orderSelectionContext) {
    selectedOrderUnits.clear();
    orderSelectionContext = orderContext;
  }
  el('deck-panel').hidden = !isDeck;
  el('deck-initialize').disabled = !cached || cached.you !== 'A' || cached.revision !== 0 || isDeck;
  el('turn').disabled = Boolean(isDeck);
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
  movementBoard?.setView(cached);
  updatePanels();
}

function clearMatchPresentation() {
  lobbyStatus = null;
  cached = null;
  stateText(null);
  el('lobby').textContent = 'Sin partida cargada';
  el('invite-token').textContent = '—';
  el('received').value = '';
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
function subscribeTo(matchId) {
  if (typeof EventSource !== 'function') return;
  if (updates && updateMatchId === matchId) return;
  closeUpdates();
  updateMatchId = matchId;
  const stream = new EventSource(`/api/matches/${matchId}/updates`);
  updates = stream;
  el('connection').textContent = 'Conectando avisos de partida…';
  stream.onopen = () => {
    if (updates === stream) el('connection').textContent = 'Avisos de partida conectados';
  };
  stream.onerror = () => {
    if (updates === stream) el('connection').textContent = 'Reconectando avisos de partida…';
  };
  stream.addEventListener('revision', event => {
    // Ignore callbacks queued before logout or a match / identity switch.
    if (updates !== stream || el('match-id').value.trim() !== matchId) return;
    try {
      const {lobbyRevision, gameRevision} = JSON.parse(event.data);
      if (!Number.isSafeInteger(lobbyRevision) || !(gameRevision === null || Number.isSafeInteger(gameRevision))) return;
      // The event can arrive just before visibilitychange is dispatched.
      // Never launch a private GET from a hidden tab merely for a notice.
      if (document.hidden) revisionRefresh.setPaused(true);
      // A revision is acknowledged only after inspect() really succeeds.
      // Failed HTTP requests remain pending for bounded automatic retry.
      revisionRefresh.notice(`${lobbyRevision}:${gameRevision}`);
    } catch {message('No se ha podido interpretar el aviso de revisión');}
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
  } catch(error) {
    if (!privateScope.isCurrent(ticket,id) || sequence !== inspectionSequence || el('match-id').value.trim() !== id) return false;
    if (/^(401|403|404):/.test(error.message)) {
      closeUpdates();clearPrivateView();
      if (/^401:/.test(error.message)) el('current').textContent='Sin sesión';
      message('La sesión o la partida ya no están disponibles.');
      return false;
    }
    throw error;
  }
  if (!privateScope.isCurrent(ticket,id) || sequence !== inspectionSequence || el('match-id').value.trim() !== id) return false;
  if (!privateProjectionMatches(lobby,signedInHandle,id)) {
    // Refuse to render a side that does not belong to the verified account,
    // including a 200 response after an inter-tab cookie transition.
    closeUpdates();clearPrivateView();
    message('La respuesta de partida no corresponde a la sesión vigente.');
    return false;
  }
  subscribeTo(id);
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
  el(id).addEventListener('click',async() => {
    const ticket=privateScope.capture();
    try {
      const outcome = await callback();
      if (outcome !== false && privateScope.isCurrent(ticket)) message('Operación realizada');
    } catch(error) {
      if (privateScope.isCurrent(ticket)) message(error.message);
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
  onConfirm: async (fields, idempotencyKey) => {
    if (await sendDeck('move_synthetic_unit', fields, idempotencyKey))
      message('Movimiento sintético confirmado por el servidor');
  },
  onError: error => message(error.message)
});
renderDeck();
await session();
