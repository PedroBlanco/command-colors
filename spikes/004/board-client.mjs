/** Controlador de una maqueta local: sin sesiones reales ni acciones de juego. */
import {BOARD_VIEWBOX, renderBoard} from './board-view.mjs';

const find = id => document.getElementById(id);
const player = find('player'), board = find('board'), viewport = find('viewport');
const hand = find('hand'), selected = find('selected');
const endTurn = find('end-turn'), connection = find('connection'), message = find('message');
const view = {...BOARD_VIEWBOX};
let state = null, epoch = 0, subscription = null, drag = null, dragMoved = false;
const base = BOARD_VIEWBOX;
function applyViewport() {
  board.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`);
  find('zoom').textContent = `Zoom: ${Math.round(base.width / view.width * 100)} %`;
}
function zoom(factor) {
  const width = Math.min(base.width * 1.4, Math.max(base.width / 3, view.width * factor));
  const height = width * base.height / base.width;
  view.x += (view.width - width) / 2; view.y += (view.height - height) / 2;
  view.width = width; view.height = height; applyViewport();
}
find('zoom-in').onclick = () => zoom(.8);
find('zoom-out').onclick = () => zoom(1.25);
find('reset').onclick = () => { Object.assign(view, base); applyViewport(); };

viewport.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  drag = {id: event.pointerId, x: event.clientX, y: event.clientY, vx: view.x, vy: view.y};
  dragMoved = false;
  viewport.setPointerCapture(event.pointerId);
});
viewport.addEventListener('pointermove', event => {
  if (!drag || drag.id !== event.pointerId) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (Math.hypot(dx, dy) > 5) dragMoved = true;
  if (!dragMoved) return;
  const rect = board.getBoundingClientRect();
  view.x = drag.vx - dx * view.width / rect.width;
  view.y = drag.vy - dy * view.height / rect.height;
  viewport.classList.add('dragging'); applyViewport();
});
function clearDrag(event) {
  if (drag && drag.id === event.pointerId) { drag = null; viewport.classList.remove('dragging'); }
}
viewport.addEventListener('pointerup', clearDrag);
viewport.addEventListener('pointercancel', clearDrag);
board.addEventListener('click', event => {
  if (dragMoved) { event.stopPropagation(); event.preventDefault(); dragMoved = false; }
}, true);

function draw(data) {
  state = data;
  const info = renderBoard(board, data.board, picked => {
    selected.textContent = `Columna ${picked.col + 1}, fila ${picked.row + 1}`
      + (picked.unit ? ` · Unidad ${picked.unit.id} del bando ${picked.unit.side}` : ' · Vacío');
  });
  find('turn').textContent = `Turno ficticio: ${data.turn} · revisión ${data.revision}`;
  find('opponent').textContent = `Cartas del contrario: ${data.opponentCardCount}`;
  hand.replaceChildren();
  for (const card of data.yourHand) {
    const li = document.createElement('li'); li.textContent = card; hand.append(li);
  }
  endTurn.disabled = player.value !== data.turn;
  if (!info.cells) message.textContent = 'Tablero sin geometría';
}

async function refresh(token = epoch) {
  const who = player.value;
  try {
    const response = await fetch('/api/state', {headers: {'x-demo-player': who}, cache: 'no-store'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (token !== epoch || who !== player.value) return;
    draw(data);
    connection.textContent = 'Estado obtenido del servidor local';
  } catch (error) {
    if (token === epoch) connection.textContent = `No se pudo recuperar el estado: ${error.message}`;
  }
}
async function connect() {
  if (subscription) subscription.abort();
  const token = ++epoch, who = player.value, ac = new AbortController();
  subscription = ac;
  endTurn.disabled = true;
  await refresh(token);
  if (token !== epoch) return;
  try {
    const response = await fetch('/api/events', {headers: {'x-demo-player': who}, signal: ac.signal});
    if (!response.ok || !response.body) throw new Error('SSE no disponible');
    connection.textContent = 'Sincronización activa';
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});
      if (buffer.length > 32768) throw new Error('Evento demasiado largo');
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const packet = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const dataLine = packet.split('\n').find(line => line.startsWith('data: '));
        if (!dataLine) continue;
        const notice = JSON.parse(dataLine.slice(6));
        if (notice.revision !== state?.revision) await refresh(token);
      }
    }
  } catch (error) {
    if (!ac.signal.aborted && token === epoch) connection.textContent = 'Sin avisos en tiempo real; usa Actualizar';
  }
}
player.addEventListener('change', () => {state = null; message.textContent = ''; connect();});
find('refresh').onclick = () => refresh();
endTurn.onclick = async () => {
  if (!state || state.turn !== player.value) return;
  endTurn.disabled = true;
  const who = player.value, token = epoch;
  try {
    const key = crypto.randomUUID().replaceAll('-', '');
    const response = await fetch('/api/command', {
      method: 'POST', headers: {'x-demo-player': who, 'content-type': 'application/json'},
      body: JSON.stringify({type: 'end_demo_turn', expectedRevision: state.revision, idempotencyKey: key})
    });
    const data = await response.json();
    if (token === epoch) message.textContent = `HTTP ${response.status} · ${data.code}`;
  } catch (error) {
    if (token === epoch) message.textContent = `No se pudo enviar el turno: ${error.message}`;
  }
  if (token === epoch) await refresh(token);
};
applyViewport();
connect();
