/** Local-only browser lab; no licensed artwork, card texts or legal Ancients rules. */
import {deckActions, deckCommand, deckSummary, parseSyntheticMovementPath} from './deck-controls.mjs';
import {createMovementBoard} from './movement-board-ui.mjs';
import {createPrivateViewScope} from './private-view-scope.mjs';

const el = id => document.getElementById(id);
const message = value => {el('message').textContent = value;};
const stateText = value => {el('state').textContent = JSON.stringify(value,null,2);};
let cached = null;
let signedInHandle = null;
const privateScope = createPrivateViewScope();
let movementBoard = null;
let updates = null, updateMatchId = null, lastNotice = null, inspectionSequence = 0;
let pendingRefresh = false;

function renderDeck() {
  const isDeck = cached && typeof cached.phase === 'string';
  const options = isDeck ? deckActions(cached) : [];
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
  for (const [id,type] of [
    ['deck-play','play_synthetic_card'],['deck-orders','assign_synthetic_orders'],
    ['deck-undo','undo_synthetic_orders'],['deck-move','move_synthetic_unit'],['deck-movement','finish_synthetic_movement'],
    ['deck-ask-defense','ask_synthetic_defense'],['deck-stand','answer_synthetic_defense'],
    ['deck-evade','answer_synthetic_defense'],['deck-combat','finish_synthetic_combat'],
    ['deck-draw','acknowledge_synthetic_draw']
  ]) el(id).disabled = !options.includes(type) || (id === 'deck-play' && select.value === '');
  el('deck-status').textContent = isDeck
    ? `Mazo de prueba · fase ${cached.phase} · turno ${cached.turn} · debe actuar ${cached.actingSide}`
    : 'El mazo de prueba aún no está inicializado';
  movementBoard?.setView(cached);
}

function clearMatchPresentation() {
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
}
function closeUpdates() {
  if (updates) updates.close();
  updates = null;
  updateMatchId = null;
  lastNotice = null;
  pendingRefresh = false;
  el('connection').textContent = 'Avisos en tiempo real desconectados';
}
function subscribeTo(matchId) {
  if (typeof EventSource !== 'function') return;
  if (updates && updateMatchId === matchId) return;
  closeUpdates();
  updateMatchId = matchId;
  updates = new EventSource(`/api/matches/${matchId}/updates`);
  el('connection').textContent = 'Conectando avisos de partida…';
  updates.onopen = () => {el('connection').textContent = 'Avisos de partida conectados';};
  updates.onerror = () => {el('connection').textContent = 'Reconectando avisos de partida…';};
  updates.addEventListener('revision', event => {
    if (el('match-id').value.trim() !== matchId) return;
    try {
      const {lobbyRevision, gameRevision} = JSON.parse(event.data);
      if (!Number.isSafeInteger(lobbyRevision) || !(gameRevision === null || Number.isSafeInteger(gameRevision))) return;
      const key = `${lobbyRevision}:${gameRevision}`;
      if (key === lastNotice) return;
      lastNotice = key;
      if (document.hidden) pendingRefresh = true;
      else inspect().catch(error => message(error.message));
    } catch {message('No se ha podido interpretar el aviso de revisión');}
  });
}
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) return;
  // Cookies can change when another tab logs in as a different player.
  // Revalidate before revealing an old hand or processing deferred SSE.
  if (!await session()) return;
  if (pendingRefresh) {
    pendingRefresh = false;
    inspect().catch(error => message(error.message));
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
      message('Ha cambiado la identidad de la sesión. Vuelve a abrir la partida.');
      return false;
    }
    signedInHandle=data.handle;
    el('current').textContent=`Conectado: ${data.handle}`;
    return true;
  } catch (error) {
    if (!privateScope.isCurrent(ticket)) return false;
    if (/^401:/.test(error.message)) {
      closeUpdates();clearPrivateView();
      el('current').textContent='Sin sesión';
      message('La sesión ha caducado o se ha cerrado.');
    } else {
      el('current').textContent='No se ha podido verificar la sesión';
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
  subscribeTo(id);
  el('lobby').textContent=JSON.stringify({status:lobby.status,players:lobby.players},null,2);
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
async function sendDeck(type, fields = {}, retryKey = null) {
  if (!cached?.matchId) throw new Error('No hay partida activa');
  const matchId = cached.matchId;
  const ticket = privateScope.capture();
  if (!privateScope.isCurrent(ticket,matchId) || el('match-id').value.trim() !== matchId)
    throw new Error('PARTIDA_DESACTUALIZADA');
  const key = retryKey ?? crypto.randomUUID().replaceAll('-','');
  const request = deckCommand(cached,type,fields,key);
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
    await session();
    if (privateScope.isCurrent(ticket)) message('Sesión iniciada');
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
  const data=await api('POST',`/api/matches/${id}/invitations`,{targetHandle:el('invitee').value});
  if(!privateScope.isCurrent(ticket,id) || el('match-id').value.trim()!==id)return false;
  el('invite-token').textContent=data.token;
});
action('accept',async()=>{
  const ticket=privateScope.capture();
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
  await api('POST','/api/invitations/reject',{invitationToken:el('received').value.trim()});
  return privateScope.isCurrent(ticket);
});
action('turn',async()=>{
  if(!cached?.matchId)throw Error('No hay partida activa');
  const matchId=cached.matchId,ticket=privateScope.capture();
  if(!privateScope.isCurrent(ticket,matchId))throw Error('PARTIDA_DESACTUALIZADA');
  await api('POST',`/api/matches/${matchId}/commands`,{type:'pass_demo_turn',expectedRevision:cached.revision,
    idempotencyKey:crypto.randomUUID().replaceAll('-','')});
  if(!privateScope.isCurrent(ticket,matchId))return false;
  await inspect();
  return privateScope.isCurrent(ticket,matchId);
});
action('events',async()=>{
  const id=el('match-id').value.trim(),ticket=privateScope.capture();
  if(!privateScope.isCurrent(ticket,id))throw Error('PARTIDA_DESACTUALIZADA');
  const events=await api('GET',`/api/matches/${id}/events`);
  if(!privateScope.isCurrent(ticket,id) || el('match-id').value.trim()!==id)return false;
  stateText(events);
});
action('deck-initialize',async()=>{
  if(!cached?.matchId || cached.you !== 'A' || cached.revision !== 0 || cached.phase)throw Error('INICIALIZACION_NO_DISPONIBLE');
  const id=cached.matchId,ticket=privateScope.capture();
  if(!privateScope.isCurrent(ticket,id))throw Error('PARTIDA_DESACTUALIZADA');
  await api('POST',`/api/matches/${id}/deck/initialize`,{});
  if(!privateScope.isCurrent(ticket,id))return false;
  await inspect();
  return privateScope.isCurrent(ticket,id);
});
action('deck-play',()=>sendDeck('play_synthetic_card',{cardRef:el('deck-card').value}));
action('deck-orders',()=>sendDeck('assign_synthetic_orders',{
  unitIds: el('deck-units').value.split(/[\s,]+/).filter(Boolean)
}));
action('deck-undo',()=>sendDeck('undo_synthetic_orders'));
action('deck-move',()=>sendDeck('move_synthetic_unit',{
  unitId: el('deck-move-unit').value.trim(),
  path: parseSyntheticMovementPath(el('deck-move-path').value)
}));
action('deck-movement',()=>sendDeck('finish_synthetic_movement'));
action('deck-ask-defense',()=>sendDeck('ask_synthetic_defense',{targetUnit:el('deck-target').value.trim()}));
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
