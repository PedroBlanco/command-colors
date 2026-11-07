import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from './server.mjs';

test('HTTP: sirve la interfaz y módulos SVG solo desde rutas permitidas', async () => {
  const server=createApp();server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const root=await fetch(base+'/');
    assert.equal(root.status,200);
    const html=await root.text();
    assert.match(html,/id="board"/);
    assert.match(html,/board-client\.mjs/);
    for (const url of ['/spikes/004/board-client.mjs','/spikes/004/board-view.mjs','/packages/hex-grid/hex.mjs']) {
      const response=await fetch(base+url);
      assert.equal(response.status,200);
      assert.match(response.headers.get('content-type'),/text\/javascript/);
      assert.ok((await response.text()).length>100);
    }
    assert.equal((await fetch(base+'/docs/01-requisitos.md')).status,404);
    assert.equal((await fetch(base+'/spikes/004/server.mjs')).status,404);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('HTTP: el tablero servido es público y cada mano sigue privada', async () => {
  const server=createApp();server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const a=await (await fetch(base+'/api/state',{headers:{'x-demo-player':'A'}})).json();
    const b=await (await fetch(base+'/api/state',{headers:{'x-demo-player':'B'}})).json();
    assert.deepEqual(a.board,b.board);
    assert.equal(JSON.stringify(a).includes('ONLY_B_CARD'),false);
    assert.equal(JSON.stringify(b).includes('ONLY_A_CARD'),false);
    assert.equal((await fetch(base+'/api/state')).status,401);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
