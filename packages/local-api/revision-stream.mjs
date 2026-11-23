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
        const state = typeof store.viewForSession === 'function'
          ? store.viewForSession({sessionToken:token})
          : store.view(actor,{denyExperimentalLab:true});
        // The SQLite store can reject the internal lab inside one WAL read
        // snapshot without building any private hand. Older store adapters
        // are also guarded by the legacy LAB_ONLY status check.
        if (state?.code === 'SECTION_LAB_INTERNAL_ONLY' || state?.status === 'LAB_ONLY') {
          stop(); res.end(); return;
        }
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

/**
 * Explicit loopback Ancients LAB revision stream. This is NOT the generic
 * synthetic /updates endpoint. Never sends cards, units, terrain, movements
 * or any private snapshot: only revision counters. The experimental match
 * is independently authenticated inside SQLite on EVERY tick.
 */
export function startAncientsLabRevisionStream({
  res,token,matchId,identity,invitations,getStore,intervalMs=1000
}={}){
  if(!Number.isSafeInteger(intervalMs)||intervalMs<20)
    throw new TypeError('INVALID_POLL_INTERVAL');
  let closed=false,busy=false,previousKey=null,timer=null;
  const stop=()=>{
    if(closed)return;
    closed=true;
    if(timer!==null)clearInterval(timer);
  };
  res.once('close',stop);
  res.writeHead(200,{
    'content-type':'text/event-stream; charset=utf-8',
    'cache-control':'no-store','connection':'keep-alive',
    'x-content-type-options':'nosniff','x-frame-options':'DENY',
    'referrer-policy':'no-referrer','x-accel-buffering':'no'
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  async function tick(){
    if(closed||busy)return;
    busy=true;
    try{
      const session=identity.resolveSession(token);
      const lobby=session&&invitations.getMatch({sessionToken:token,matchId});
      const actor=lobby?.ok&&lobby.players.find(p=>p.handle===session.handle)?.side;
      if(!['A','B'].includes(actor)||lobby.status!=='READY')
        throw new Error('ANCIENTS_LAB_ACCESS_REVOKED');
      const store=await getStore(matchId);
      if(typeof store?.viewExperimentalSectionHistory!=='function')
        throw new Error('ANCIENTS_LAB_STORE_UNAVAILABLE');
      // Session/membership and the private view are checked in a single WAL
      // read snapshot, even if a previous lobby read succeeded.
      const result=store.viewExperimentalSectionHistory({sessionToken:token});
      const view=result?.status===200?result.view:null;
      if(!view||view.status!=='LAB_ONLY'||view.matchId!==matchId||
         view.you!==actor||!Number.isSafeInteger(view.revision)||
         view.revision<0)throw new Error('ANCIENTS_LAB_REVISION_UNAVAILABLE');
      const lobbyRevision=lobby.revision??0;
      if(!Number.isSafeInteger(lobbyRevision)||lobbyRevision<0)
        throw new Error('LOBBY_REVISION_INVALID');
      const key=`${lobbyRevision}:${view.revision}`;
      if(!closed&&key!==previousKey){
        previousKey=key;
        res.write(`id: ${key}\nevent: revision\ndata: ${JSON.stringify({
          lobbyRevision,gameRevision:view.revision
        })}\n\n`);
      }
    }catch{
      if(!closed){stop();res.end();}
    }finally{busy=false;}
  }
  timer=setInterval(()=>{void tick();},intervalMs);
  timer.unref?.();
  void tick();
  return stop;
}
