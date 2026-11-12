/**
 * Local SSE revision notice. Sends ONLY counters, never cards, decks or game events.
 * Every poll revalidates the active session and membership. For loopback tests only.
 * Clients reconstruct full authorized state via GET; no event replay is necessary.
 */
export function startRevisionStream({res, token, matchId, identity, invitations, getStore, intervalMs = 1000}) {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 20) throw new TypeError('INVALID_POLL_INTERVAL');
  let closed = false;
  let busy = false;
  let previousKey = null;
  let timer;
  const stop = () => {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
  };
  res.once('close', stop);
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    'connection': 'keep-alive',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'x-accel-buffering': 'no'
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');

  async function tick() {
    if (closed || busy) return;
    busy = true;
    try {
      const session = identity.resolveSession(token);
      const lobby = session && invitations.getMatch({sessionToken: token, matchId});
      const actor = lobby?.ok && lobby.players.find(p => p.handle === session.handle)?.side;
      if (!actor || !['A', 'B'].includes(actor)) {
        stop();
        res.end();
        return;
      }
      const lobbyRevision = lobby.revision ?? 0;
      if (!Number.isSafeInteger(lobbyRevision) || lobbyRevision < 0) throw new Error('LOBBY_REVISION_INVALID');
      let gameRevision = null;
      if (lobby.status === 'READY') {
        const store = await getStore(matchId);
        const state = store.view(actor);
        // A connection opened before laboratory activation must not continue
        // reporting its experimental revision (even though SSE has no cards).
        if (state?.status === 'LAB_ONLY') { stop(); res.end(); return; }
        if (!state || state.matchId !== matchId || !Number.isSafeInteger(state.revision)) {
          throw new Error('MATCH_REVISION_INVALID');
        }
        gameRevision = state.revision;
      }
      const key = `${lobbyRevision}:${gameRevision === null ? 'waiting' : gameRevision}`;
      if (!closed && key !== previousKey) {
        previousKey = key;
        res.write(`id: ${key}\nevent: revision\ndata: ${JSON.stringify({lobbyRevision, gameRevision})}\n\n`);
      }
    } catch {
      if (!closed) {stop(); res.end();}
    } finally {busy = false;}
  }
  timer = setInterval(() => {void tick();}, intervalMs);
  timer.unref?.();
  void tick();
  return stop;
}
