/** No official artwork, cards, map or legal moves. Minimal cookie-based browser smoke test. */
const el = id => document.getElementById(id);
const message = value => {el('message').textContent = value;};
const stateText = value => {el('state').textContent = JSON.stringify(value,null,2);};
let cached = null;
let updates = null, updateMatchId = null, lastNotice = null, inspectionSequence = 0;
let pendingRefresh = false;

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
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && pendingRefresh) {
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
  try {const data=await api('GET','/api/session');el('current').textContent = `Conectado: ${data.handle}`;}
  catch {el('current').textContent='Sin sesión';}
}
async function inspect() {
  const sequence = ++inspectionSequence;
  const id = el('match-id').value.trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw Error('Introduce el identificador de partida');
  const lobby=await api('GET',`/api/matches/${id}`);
  if (sequence !== inspectionSequence || el('match-id').value.trim() !== id) return lobby;
  subscribeTo(id);
  el('lobby').textContent=JSON.stringify({status:lobby.status,players:lobby.players},null,2);
  cached=lobby.state??null;
  stateText(cached ? {tuBando:cached.you,turno:cached.turn,revision:cached.revision,
    tuMano:cached.yourHand,cartasDelRival:cached.opponentCardCount,unidadesPublicas:cached.board}
    : {estado:'Esperando segundo jugador'});
  return lobby;
}
function action(id,callback) {
  el(id).addEventListener('click',async() => {
    try { await callback(); message('Operación realizada'); }
    catch(error){message(error.message);}
  });
}
el('login-form').addEventListener('submit',async(event) => {
  event.preventDefault();
  try {await api('POST','/api/session',{handle:el('handle').value,password:el('password').value}); closeUpdates();
    el('password').value=''; await session(); message('Sesión iniciada');}
  catch(error){message(error.message);}
});
action('logout',async()=>{await api('DELETE','/api/session');closeUpdates();cached=null;await session();stateText(null);});
action('create',async()=>{const result=await api('POST','/api/matches');el('match-id').value=result.matchId;await inspect();});
el('match-id').addEventListener('input', () => {if (el('match-id').value.trim() !== updateMatchId) {closeUpdates();cached=null;}});
action('refresh',inspect);
action('invite',async()=>{const id=el('match-id').value.trim();
  const data=await api('POST',`/api/matches/${id}/invitations`,{targetHandle:el('invitee').value});
  el('invite-token').textContent=data.token;});
action('accept',async()=>{const data=await api('POST','/api/invitations/accept',{invitationToken:el('received').value.trim()});
  el('match-id').value=data.matchId;await inspect();});
action('reject',async()=>{await api('POST','/api/invitations/reject',{invitationToken:el('received').value.trim()});});
action('turn',async()=>{if(!cached)throw Error('No hay partida activa');
  await api('POST',`/api/matches/${cached.matchId}/commands`,{type:'pass_demo_turn',expectedRevision:cached.revision,
    idempotencyKey:crypto.randomUUID().replaceAll('-','')});await inspect();});
action('events',async()=>{const id=el('match-id').value.trim();const events=await api('GET',`/api/matches/${id}/events`);stateText(events);});
await session();
