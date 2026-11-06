/** Spike técnico de dos clientes: no es un servidor jugable, ni seguro para Internet. */
import {createServer as httpCreateServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const UI_PATH = fileURLToPath(new URL('./index.html', import.meta.url));
const STATIC_PATHS = new Map([
  ['/', {path: UI_PATH, type: 'text/html'}],
  ['/spikes/004/board-client.mjs', {path: fileURLToPath(new URL('./board-client.mjs', import.meta.url)), type: 'text/javascript'}],
  ['/spikes/004/board-view.mjs', {path: fileURLToPath(new URL('./board-view.mjs', import.meta.url)), type: 'text/javascript'}],
  ['/packages/hex-grid/hex.mjs', {path: fileURLToPath(new URL('../../packages/hex-grid/hex.mjs', import.meta.url)), type: 'text/javascript'}]
]);

export function createDemo() {
  let state = {
    revision: 0,
    turn: 'A',
    publicBoard: [{id: 'unit-a', side: 'A', col: 3, row: 4}, {id: 'unit-b', side: 'B', col: 9, row: 4}],
    hands: {A: ['ONLY_A_CARD_1', 'ONLY_A_CARD_2'], B: ['ONLY_B_CARD_1', 'ONLY_B_CARD_2', 'ONLY_B_CARD_3']}
  };
  const idempotency = new Map();
  const subscribers = new Set();
  function view(player) {
    if (player !== 'A' && player !== 'B') throw new Error('Jugador desconocido');
    const other = player === 'A' ? 'B' : 'A';
    return {
      revision: state.revision, turn: state.turn, you: player,
      board: state.publicBoard.map(item => ({...item})),
      yourHand: [...state.hands[player]], opponentCardCount: state.hands[other].length
    };
  }
  function command(player, action) {
    if (player !== 'A' && player !== 'B') return {status: 403, code: 'FORBIDDEN'};
    if (!action || typeof action !== 'object' || Array.isArray(action) || action.type !== 'end_demo_turn'
        || !Number.isSafeInteger(action.expectedRevision)
        || typeof action.idempotencyKey !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(action.idempotencyKey)) {
      return {status: 400, code: 'INVALID_COMMAND'};
    }
    const key = `${player}:${action.idempotencyKey}`;
    const signature = `${action.type}:${action.expectedRevision}`;
    const recorded = idempotency.get(key);
    if (recorded) {
      if (recorded.signature !== signature) return {status: 409, code: 'IDEMPOTENCY_KEY_REUSED'};
      return {status: 200, code: 'ALREADY_APPLIED', view: view(player)};
    }
    if (action.expectedRevision !== state.revision) return {status: 409, code: 'STALE_REVISION', view: view(player)};
    if (state.turn !== player) return {status: 403, code: 'NOT_YOUR_TURN', view: view(player)};
    state = {...state, revision: state.revision + 1, turn: player === 'A' ? 'B' : 'A'};
    idempotency.set(key, {signature});
    for (const notify of subscribers) notify(state.revision);
    return {status: 200, code: 'APPLIED', view: view(player)};
  }
  function subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }
  return {view, command, subscribe};
}

async function readJson(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 16384) throw new Error('BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createApp(demo = createDemo()) {
  const server = httpCreateServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const player = req.headers['x-demo-player'];
      const json = (status, data) => {
        res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'});
        res.end(JSON.stringify(data));
      };
      const staticAsset = STATIC_PATHS.get(url.pathname);
      if (req.method === 'GET' && staticAsset) {
        res.writeHead(200, {'content-type': `${staticAsset.type}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'});
        res.end(await readFile(staticAsset.path));
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        if (player !== 'A' && player !== 'B') return json(401, {code: 'DEMO_PLAYER_REQUIRED'});
        if (req.method === 'GET' && url.pathname === '/api/state') return json(200, demo.view(player));
        if (req.method === 'POST' && url.pathname === '/api/command') {
          if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return json(415, {code: 'JSON_REQUIRED'});
          const body = await readJson(req);
          const answer = demo.command(player, body);
          return json(answer.status, answer);
        }
        if (req.method === 'GET' && url.pathname === '/api/events') {
          res.writeHead(200, {'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-store', 'connection': 'keep-alive'});
          res.write(`data: ${JSON.stringify({revision: demo.view(player).revision})}\n\n`);
          const unsubscribe = demo.subscribe(revision => res.write(`data: ${JSON.stringify({revision})}\n\n`));
          res.on('close', unsubscribe);
          return;
        }
      }
      return json(404, {code: 'NOT_FOUND'});
    } catch (error) {
      res.writeHead(error.message === 'BODY_TOO_LARGE' ? 413 : 400, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
      res.end(JSON.stringify({code: error.message === 'BODY_TOO_LARGE' ? 'BODY_TOO_LARGE' : 'INVALID_REQUEST'}));
    }
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  const port = Number(process.env.PORT || 8787);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Puerto inválido');
  createApp().listen(port, '127.0.0.1', () => console.log(`Spike local: http://127.0.0.1:${port} (NO PUBLICAR)`));
}
