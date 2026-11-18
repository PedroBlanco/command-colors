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
let rangedCheckContext=null,rangedCheckBusy=false;
let rangedRollBusy=false,rangedRollRetry=null;
let signedInHandle = null;
const privateScope = createPrivateViewScope();
let movementBoard = null;
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
    'movement-details': mode === 'game'
  };
  for (const [id,expanded] of Object.entries(open)) el(id).open = expanded;
}

const PUBLIC_TROOP_LABELS=Object.freeze({
  LIGHT_INFANTRY:'Infantería ligera',
  LIGHT_SLING_INFANTRY:'Infantería ligera con honda',
  LIGHT_BOW_INFANTRY:'Infantería ligera con arco',
  AUXILIA_INFANTRY:'Auxiliares',WARRIOR_INFANTRY:'Guerreros',
  MEDIUM_INFANTRY:'Infantería media',HEAVY_INFANTRY:'Infantería pesada',
  HEAVY_WAR_MACHINE:'Máquina de guerra pesada',
  LIGHT_CAVALRY:'Caballería ligera',MEDIUM_CAVALRY:'Caballería media',
  HEAVY_CAVALRY:'Caballería pesada',ELEPHANT:'Elefante',
  HEAVY_CHARIOT:'Carro pesado'
});

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
    const type=cached?.trainingReference?.unitTypes?.[unit.id];
    const troop=Object.hasOwn(PUBLIC_TROOP_LABELS,type)?
      ' · '+PUBLIC_TROOP_LABELS[type]:'';
    option.textContent = `${unit.id}${troop} (col. ${unit.col+1}, fila ${unit.row+1})`;
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

/** Ranged declarations are public read-only evaluations, not battle commands. */
function renderRangedCheck() {
  const enabled=deckActions(cached).includes('check_training_ranged_declaration');
  const panel=el('board-ranged-check');
  panel.hidden=!enabled;
  const attacker=el('board-ranged-attacker'),target=el('board-ranged-target');
  const result=el('board-ranged-check-result');
  const context=enabled
    ? [cached.matchId,cached.you,cached.revision,cached.phase,cached.actingSide].join(':')
    : null;
  if(context!==rangedCheckContext) {
    rangedCheckContext=context;result.textContent='';
  }
  const priorAttacker=attacker.value,priorTarget=target.value;
  const options=(select,units,previous,label)=>{
    select.replaceChildren();
    const placeholder=document.createElement('option');
    placeholder.value='';placeholder.textContent=label;
    select.appendChild(placeholder);
    for(const unit of units){
      const option=document.createElement('option');
      option.value=unit.id;
      option.textContent=unit.id+' (col. '+(unit.col+1)+', fila '+(unit.row+1)+')';
      select.appendChild(option);
    }
    select.value=units.some(u=>u.id===previous)?previous:'';
  };
  const board=enabled&&Array.isArray(cached.board)?cached.board:[];
  options(attacker,board.filter(u=>u?.side===cached?.you),priorAttacker,'Elige una unidad propia');
  options(target,board.filter(u=>u?.side!==cached?.you),priorTarget,'Elige un rival');
  attacker.disabled=!enabled||rangedCheckBusy;
  target.disabled=!enabled||rangedCheckBusy;
  el('board-ranged-check-button').disabled=!enabled||rangedCheckBusy||
    !attacker.value||!target.value;
  const candidate=cached?.trainingRangedHints?.status==='REFERENCE_ONLY'
    ? cached.trainingRangedHints.candidates?.find(c=>
        c?.attackerId===attacker.value&&c?.targetId===target.value)
    : null;
  el('board-ranged-dice-hint').textContent=candidate&&
    Number.isSafeInteger(candidate.diceAfterTerrain)&&candidate.diceAfterTerrain>0
    ? `Referencia del servidor: ${candidate.diceAfterTerrain} dados para esta pareja. No autoriza el ataque.`
    : 'Selecciona una pareja de tiro orientativa y compruébala antes de registrar dados.';
  const roll=el('board-ranged-roll-mode');
  if(!['DIGITAL','PHYSICAL'].includes(roll.value))roll.value='DIGITAL';
  const physical=roll.value==='PHYSICAL';
  el('board-ranged-physical-group').hidden=!physical;
  roll.disabled=!enabled||rangedRollBusy;
  el('board-ranged-physical-faces').disabled=!enabled||rangedRollBusy||!physical;
  el('board-ranged-roll-button').disabled=rangedRollBusy||rangedCheckBusy||
    !deckActions(cached).includes('stage_training_ranged_dice')||
    !attacker.value||!target.value;
  const staged=cached?.trainingStagedRangedDice;
  el('board-ranged-roll-result').textContent=staged
    ? `Tirada ${staged.attackerId} → ${staged.targetId} registrada (${staged.roll.source==='DIGITAL'?'digital del servidor':'dados físicos declarados'}): ${staged.roll.results.join(', ')}. Coincidencias de color: ${staged.interpretation.matchingColorHits}; banderas pendientes: ${staged.interpretation.flagsPending}; sin efecto a distancia: ${staged.interpretation.misses}. No se han aplicado daños ni retiradas.`
    : '';
}
const TRAINING_RANGED_REASONS=Object.freeze({
  UNIT_NOT_ELIGIBLE:'La unidad atacante no recibió una orden o no pertenece a tu bando.',
  TARGET_NOT_ELIGIBLE:'El objetivo no es una unidad rival disponible.',
  NO_BASE_RANGED_WEAPON:'El tipo de tropa no tiene disparo a distancia base.',
  RANGED_TARGET_ADJACENT:'El objetivo está adyacente: no procede este tiro a distancia.',
  TARGET_OUT_OF_RANGE:'El objetivo queda fuera del alcance de disparo.',
  ADJACENT_ENEMY_PREVENTS_RANGED:'Una unidad enemiga adyacente impide disparar.',
  LINE_OF_SIGHT_BLOCKED:'El corredor de tiro está bloqueado.',
  WAR_MACHINE_MOVED:'La máquina de guerra no puede disparar después de moverse.',
  AUXILIA_MOVED_TWO:'Los auxiliares han movido demasiado para disparar.',
  EXCEEDS_STANDARD_MOVEMENT:'La unidad ha superado su perfil de movimiento.',
  NO_TRUSTED_MOVEMENT_LEDGER:'Esta partida no conserva un historial fiable de movimiento.',
  NO_VERSIONED_SCENARIO:'La partida no tiene un escenario de entrenamiento versionado.',
  WRONG_PHASE:'La comprobación solo está disponible en la fase de combate.',
  STALE_REVISION:'La partida ha cambiado; consulta su estado actualizado.',
  NOT_ACTING_PLAYER:'No es tu turno de combate.',
  INVALID_TRAINING_DECLARATION:'Selecciona una unidad propia y un objetivo rival.'
});

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
  renderRangedCheck();
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
  rangedRollRetry=null;rangedRollBusy=false;
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
    rangedRollRetry=null;
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
const submitSelectedOrders = (key=null) => sendDeck('assign_synthetic_orders',{
  unitIds: [...selectedOrderUnits]
},key);
action('deck-orders',()=>submitSelectedOrders());
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
for (const field of ['board-ranged-attacker','board-ranged-target']) {
  el(field).addEventListener('change',()=>{
    el('board-ranged-check-result').textContent='';
    renderRangedCheck();
  });
}
el('board-ranged-roll-mode').addEventListener('change',renderRangedCheck);
el('board-ranged-physical-faces').addEventListener('input',()=>{
  rangedRollRetry=null;
});
el('board-ranged-roll-button').addEventListener('click',async()=>{
  if(rangedRollBusy||!cached)return;
  const matchId=cached.matchId,revision=cached.revision,ticket=privateScope.capture();
  const fields={
    attackerId:el('board-ranged-attacker').value,
    targetId:el('board-ranged-target').value,
    mode:el('board-ranged-roll-mode').value
  };
  try{
    if(!deckActions(cached).includes('stage_training_ranged_dice'))
      throw Error('ACCION_NO_DISPONIBLE');
    if(fields.mode==='PHYSICAL'){
      fields.declaredFaces=el('board-ranged-physical-faces').value
        .split(',').map(s=>s.trim().toUpperCase());
    }
    const fingerprint=JSON.stringify([matchId,revision,fields]);
    if(rangedRollRetry?.fingerprint!==fingerprint)
      rangedRollRetry={fingerprint,key:crypto.randomUUID().replaceAll('-','')};
    // deckCommand never sends a client-provided dice count, actor, roll ID,
    // target type or RNG seed. The server rechecks everything transactionally.
    deckCommand(cached,'stage_training_ranged_dice',fields,rangedRollRetry.key);
    rangedRollBusy=true;renderRangedCheck();
    const confirmed=await sendDeck('stage_training_ranged_dice',fields,rangedRollRetry.key);
    if(confirmed&&privateScope.isCurrent(ticket,matchId)){
      rangedRollRetry=null;
      message('Tirada registrada por el servidor. Impactos y retiradas sin aplicar.');
    }
  }catch(error){
    if(privateScope.isCurrent(ticket,matchId)&&cached?.revision===revision)
      message('Tirada no registrada: '+(
        ['ACCION_NO_DISPONIBLE','MODO_TIRADA_INVALIDO','CARAS_DADOS_INVALIDAS',
         'DECLARACION_TIRO_INVALIDA'].includes(error.message)
          ? error.message : 'verifica la fase, los dados y la sesión.'));
  }finally{rangedRollBusy=false;renderRangedCheck();}
});
el('board-ranged-check-button').addEventListener('click',async()=>{
  if(rangedCheckBusy||!cached) return;
  const matchId=cached.matchId,revision=cached.revision,player=cached.you;
  const ticket=privateScope.capture();
  try {
    if(!deckActions(cached).includes('check_training_ranged_declaration'))
      throw Error('ACCION_NO_DISPONIBLE');
    const data={
      attackerId:el('board-ranged-attacker').value,
      targetId:el('board-ranged-target').value
    };
    const request=deckCommand(cached,'check_training_ranged_declaration',
      data,crypto.randomUUID().replaceAll('-',''));
    rangedCheckBusy=true;renderRangedCheck();
    if(!await confirmCurrentSession(ticket,matchId))return;
    const response=await api('POST',`/api/matches/${matchId}/commands`,request);
    if(!privateScope.isCurrent(ticket,matchId)||
       el('match-id').value.trim()!==matchId||
       cached?.revision!==revision||cached?.you!==player||
       el('board-ranged-attacker').value!==data.attackerId||
       el('board-ranged-target').value!==data.targetId||
       !deckActions(cached).includes('check_training_ranged_declaration'))return;
    const report=response.reference;
    if(response.code!=='TRAINING_RANGED_REFERENCE'||
       !report||report.attackAuthorized!==false||report.canCommit!==false||
       report.revision!==revision)
      throw Error('REFERENCIA_NO_VALIDA');
    el('board-ranged-check-result').textContent=report.status==='CANDIDATE'
      ? `Referencia ${data.attackerId} → ${data.targetId}: ${report.distance} hexágonos, ${report.diceAfterTerrain} dados orientativos tras terreno. El ataque NO está autorizado ni se ha registrado.`
      : `Referencia bloqueada: ${TRAINING_RANGED_REASONS[report.reason]??'No supera las comprobaciones parciales del servidor.'} No se ha registrado un ataque.`;
  }catch(error){
    if(privateScope.isCurrent(ticket,matchId)&&cached?.revision===revision)
      el('board-ranged-check-result').textContent=
        /^(400|401|403|404|409):/.test(error.message)
        ? 'No se pudo comprobar la declaración. Verifica tu sesión y actualiza la partida.'
        : 'Comprobación no disponible. No se ha registrado ningún ataque.';
  }finally{rangedCheckBusy=false;renderRangedCheck();}
});
movementBoard = createMovementBoard({
  svg: el('movement-board'),
  inspectButton:el('board-inspect-toggle'),
  inspectPanel:el('board-inspect-info'),
  overviewPanel:el('board-overview'),
  profileSelect:el('board-profile-type'),
  profileStatus:el('board-profile-status'),
  profileGroup:el('board-profile-group'),
  status: el('movement-status'),
  undoButton: el('board-undo'),
  cancelButton: el('board-cancel'),
  confirmButton: el('board-confirm'),
  attackButton: el('board-ask-defense'),
  orderButton: el('board-assign-orders'),
  getOrderSelection: () => [...selectedOrderUnits],
  onToggleOrderUnit: id => {
    if (!deckActions(cached).includes('assign_synthetic_orders') ||
        !cached?.board?.some(unit=>unit?.id===id && unit.side===cached.you))
      throw Error('UNIDAD_NO_PROPIA');
    if (selectedOrderUnits.has(id)) selectedOrderUnits.delete(id);
    else selectedOrderUnits.add(id);
    renderDeck(); // synchronizes the existing dropdown and the SVG selection
  },
  onAssignOrders: submitSelectedOrders,
  phaseButtons: {
    finish_synthetic_movement:el('board-finish-movement'),
    undo_synthetic_orders:el('board-undo-orders'),
    defense_stand:el('board-defense-stand'),
    defense_evade:el('board-defense-evade'),
    finish_synthetic_combat:el('board-finish-combat'),
    acknowledge_synthetic_draw:el('board-draw')
  },
  onPhaseCommand: (type,fields,key)=>sendDeck(type,fields,key),
  cardGroup:el('board-card-controls'),
  cardSelect:el('board-card-select'),
  cardButton:el('board-card-play'),
  onPlayCard:(cardRef,key)=>sendDeck('play_synthetic_card',{cardRef},key),
  onReferenceSelection: (role,id) => {
    if(!deckActions(cached).includes('check_training_ranged_declaration')||
       !['attacker','target'].includes(role)||
       !cached?.board?.some(u=>u?.id===id&&
         (role==='attacker'?u.side===cached.you:u.side!==cached.you)))return;
    el(role==='attacker'?'board-ranged-attacker':'board-ranged-target').value=id;
    el('board-ranged-check-result').textContent='';
    renderRangedCheck();
  },
  onRequestDefense: async (unitId,idempotencyKey) => {
    const confirmed=await sendDeck('ask_synthetic_defense',
      {targetUnit:unitId},idempotencyKey);
    if (confirmed) message('Solicitud de defensa sintética registrada');
    return confirmed;
  },
  onConfirm: async (fields, idempotencyKey) => {
    if (await sendDeck('move_synthetic_unit', fields, idempotencyKey))
      message('Movimiento sintético confirmado por el servidor');
  },
  onError: error => message(error.message)
});
renderDeck();
await session();
