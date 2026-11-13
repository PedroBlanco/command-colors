import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const MATCH='123e4567-e89b-42d3-a456-426614174000';
let serial=0;
async function withBrowser(run,{owner='alice'}={}) {
  const originals={document:globalThis.document,window:globalThis.window,fetch:globalThis.fetch,
    EventSource:globalThis.EventSource,setInterval:globalThis.setInterval,
    clearInterval:globalThis.clearInterval};
  const elements=new Map(),handlers=new Map(),requests=[],feeds=[];
  const intervals=new Map();let timerId=0;
  const setInterval=(cb,ms)=>{const id=++timerId;intervals.set(id,{cb,ms});return id;};
  const clearInterval=id=>intervals.delete(id);
  function element(id) {
    if(!elements.has(id))elements.set(id,{value:'',textContent:'',hidden:false,disabled:false,open:false,children:[],handlers:new Map(),
      get options(){return this.children},
      get selectedOptions(){return this.children.filter(option=>option.selected)},
      addEventListener(event,fn){this.handlers.set(event,fn)},
      replaceChildren(){this.children=[];this.value=''},
      appendChild(option){this.children.push(option);if(this.children.length===1)this.value=option.value},
      async dispatch(event){return await this.handlers.get(event)?.({preventDefault(){}})}});
    return elements.get(id);
  }
  const document={hidden:false,getElementById:element,createElement:()=>({value:'',textContent:''}),
    addEventListener(name,fn){handlers.set(name,fn)},async dispatch(name){await handlers.get(name)?.()}};
  const window={addEventListener(name,fn){handlers.set(name,fn)},async dispatch(name){await handlers.get(name)?.()}};
  const state={login:false,lobby:'INVITING',revision:0,deckPhase:null,
    board:[{id:'synthetic-a',side:'A',col:2,row:4},
      {id:'synthetic-a2',side:'A',col:3,row:4},
      {id:'synthetic-b',side:'B',col:10,row:4}]};
  class FakeEventSource {
    constructor(url){this.url=url;this.events=new Map();this.closed=false;feeds.push(this)}
    addEventListener(name,fn){this.events.set(name,fn)}
    emit(revision){this.events.get('revision')?.({data:JSON.stringify(revision)})}
    close(){this.closed=true}
  }
  const fetch=async(path,options={})=>{
    requests.push({path,method:options.method??'GET',body:options.body});
    let response={code:'NOT_FOUND'},status=404;
    if(path==='/api/session' && options.method==='POST'){state.login=true;response={ok:true};status=200;}
    else if(path==='/api/session' && options.method==='DELETE'){state.login=false;response={ok:true};status=200;}
    else if(path==='/api/session' && state.login){response={authenticated:true,handle:owner};status=200;}
    else if(path==='/api/matches' && options.method==='POST'){response={matchId:MATCH};status=201;}
    else if(path===`/api/matches/${MATCH}` && state.login){response={matchId:MATCH,status:state.lobby,players:state.lobby==='READY'?[{side:'A',handle:owner},{side:'B',handle:owner==='alice'?'bob':'alice'}]:[{side:'A',handle:owner}],
      ...(state.lobby==='READY'?{state:{matchId:MATCH,you:'A',turn:state.revision?'B':'A',revision:state.revision,yourHand:['A_CARD'],opponentCardCount:3,board:state.board,
        ...(state.deckPhase?{phase:state.deckPhase,actingSide:'A',
          pendingDecision:null,movedUnitIds:[],drawPileCount:10,
          discardPile:[],cardInPlay:null}:{})}}:{})};status=200;}
    else if(path===`/api/matches/${MATCH}/commands` && state.login){state.revision++;response={code:'APPLIED'};status=200;}
    return {ok:status<400,status,json:async()=>response};
  };
  Object.assign(globalThis,{document,window,fetch,EventSource:FakeEventSource,
    setInterval,clearInterval});
  element('handle').value=owner;element('password').value='test-only';
  try {
    await import(`./browser-ui.mjs?mock=${++serial}`);
    return await run({element,document,window,feeds,requests,state,
      timerCount:()=>intervals.size,
      pulseLobby:async()=>{
        const running=[...intervals.values()];
        for(const timer of running)await timer.cb();
      }});
  } finally {
    intervals.clear();
    Object.assign(globalThis,originals);
  }
}

async function nextTurn() {await new Promise(resolve=>setImmediate(resolve));}

test('browser UI: auto-refresca al recibir revisión SSE sin mostrar la mano contraria',()=>withBrowser(async ctx=>{
  await ctx.element('login-form').dispatch('submit');
  await ctx.element('create').dispatch('click');
  assert.equal(ctx.element('match-id').value,MATCH);
  assert.equal(ctx.feeds.length,1);
  assert.equal(ctx.feeds[0].url,`/api/matches/${MATCH}/updates`);
  assert.equal(ctx.element('state').textContent.includes('Esperando segundo'),true);
  ctx.state.lobby='READY';
  const reads=()=>ctx.requests.filter(r=>r.path===`/api/matches/${MATCH}`).length;
  const before=reads();
  ctx.feeds[0].emit({lobbyRevision:1,gameRevision:0});
  await nextTurn();
  assert.equal(reads(),before+1);
  assert.equal(ctx.element('state').textContent.includes('A_CARD'),true);
  assert.equal(ctx.element('state').textContent.includes('PRIVATE_B'),false);
  ctx.feeds[0].emit({lobbyRevision:1,gameRevision:0});
  await nextTurn();
  assert.equal(reads(),before+1); // avoid duplicate fetches for same revision
  ctx.state.revision=1;
  ctx.feeds[0].emit({lobbyRevision:1,gameRevision:1});
  await nextTurn();
  assert.equal(ctx.element('state').textContent.includes('"revision": 1'),true);
  await ctx.element('logout').dispatch('click');
  assert.equal(ctx.feeds[0].closed,true);
}));

test('browser UI: cambio de partida y pestaña oculta cierran o posponen avisos',()=>withBrowser(async ctx=>{
  await ctx.element('login-form').dispatch('submit');
  await ctx.element('create').dispatch('click');
  const feed=ctx.feeds[0];
  ctx.document.hidden=true;
  const before=ctx.requests.length;
  feed.emit({lobbyRevision:1,gameRevision:0});
  await nextTurn();
  assert.equal(ctx.requests.length,before); // defer while hidden
  ctx.document.hidden=false;
  await ctx.document.dispatch('visibilitychange');
  await nextTurn();
  assert.ok(ctx.requests.length>before);
  ctx.element('match-id').value='not-a-match';
  await ctx.element('match-id').dispatch('input');
  assert.equal(feed.closed,true);
  assert.equal(ctx.element('connection').textContent,'Avisos en tiempo real desconectados');
}));


test('late callbacks from a closed SSE feed cannot affect a new login to the same match',()=>withBrowser(async ctx=>{
  await ctx.element('login-form').dispatch('submit');
  await ctx.element('create').dispatch('click');
  const stale=ctx.feeds[0];
  await ctx.element('logout').dispatch('click');
  assert.equal(stale.closed,true);
  await ctx.element('login-form').dispatch('submit');
  await ctx.element('create').dispatch('click');
  const current=ctx.feeds.at(-1);
  assert.notEqual(stale,current);
  const reads=()=>ctx.requests.filter(x=>x.path===`/api/matches/${MATCH}`).length;
  const before=reads();
  stale.emit({lobbyRevision:77,gameRevision:77});
  await nextTurn();
  assert.equal(reads(),before);
  current.emit({lobbyRevision:1,gameRevision:0});
  await nextTurn();
  assert.equal(reads(),before+1);
}));

test('multiple SSE notices while hidden coalesce into one refreshed projection',()=>withBrowser(async ctx=>{
  await ctx.element('login-form').dispatch('submit');
  await ctx.element('create').dispatch('click');
  const feed=ctx.feeds[0];
  const reads=()=>ctx.requests.filter(x=>x.path===`/api/matches/${MATCH}`).length;
  const before=reads();
  ctx.document.hidden=true;
  await ctx.document.dispatch('visibilitychange');
  feed.emit({lobbyRevision:1,gameRevision:0});
  feed.emit({lobbyRevision:1,gameRevision:1});
  feed.emit({lobbyRevision:1,gameRevision:1});
  await nextTurn();
  assert.equal(reads(),before);
  ctx.document.hidden=false;
  await ctx.document.dispatch('visibilitychange');
  await nextTurn();
  assert.equal(reads(),before+1);
}));

test('visibility race: hiding during session revalidation must not resume queued SSE',()=>withBrowser(async ctx=>{
  await ctx.element('login-form').dispatch('submit');
  await ctx.element('create').dispatch('click');
  const feed=ctx.feeds[0];
  const reads=()=>ctx.requests.filter(x=>x.path===`/api/matches/${MATCH}`).length;
  ctx.document.hidden=true;
  await ctx.document.dispatch('visibilitychange');
  feed.emit({lobbyRevision:1,gameRevision:0});
  await nextTurn();
  const before=reads();
  const originalFetch=globalThis.fetch;
  let release=null;
  globalThis.fetch=(path,options)=>path==='/api/session' && options?.method==='GET'
    ? new Promise(resolve=>{release=()=>originalFetch(path,options).then(resolve);})
    : originalFetch(path,options);
  try {
    ctx.document.hidden=false;
    const pendingVisible=ctx.document.dispatch('visibilitychange');
    await nextTurn();
    assert.equal(typeof release,'function','the visible handler must be awaiting session');
    ctx.document.hidden=true;
    await ctx.document.dispatch('visibilitychange');
    const finishSession=release;release=null;finishSession();
    await pendingVisible;
    await nextTurn();
    assert.equal(reads(),before,'a stale visibility event must not start a private GET in a hidden tab');
  } finally {
    globalThis.fetch=originalFetch;
    release?.();
  }
  ctx.document.hidden=false;
  await ctx.document.dispatch('visibilitychange');
  await nextTurn();
  assert.equal(reads(),before+1,'the queued notice resumes only after a fresh visible session check');
}));


test('stage panels collapse unused login/lobby/board and preserve manual folding on refresh',()=>withBrowser(async ctx=>{
  assert.equal(ctx.element('login-details').open,true);
  assert.equal(ctx.element('match-details').open,false);
  assert.equal(ctx.element('movement-details').open,false);
  await ctx.element('login-form').dispatch('submit');
  assert.equal(ctx.element('login-details').open,false);
  assert.equal(ctx.element('login-form').hidden,true);
  assert.equal(ctx.element('logout').disabled,false);
  assert.equal(ctx.element('match-details').open,true);
  assert.equal(ctx.element('invite-details').open,true);
  await ctx.element('create').dispatch('click');
  assert.equal(ctx.element('movement-details').open,false);
  ctx.state.lobby='READY';
  await ctx.element('refresh').dispatch('click');
  assert.equal(ctx.element('match-details').open,false);
  assert.equal(ctx.element('state-details').open,true);
  assert.equal(ctx.element('deck-details').open,true);
  ctx.state.deckPhase='ASSIGN_ORDERS';
  await ctx.element('refresh').dispatch('click');
  assert.equal(ctx.element('movement-details').open,true);
  ctx.element('movement-details').open=false;
  await ctx.element('refresh').dispatch('click');
  assert.equal(ctx.element('movement-details').open,false,'preserve user collapse during same phase');
  await ctx.element('logout').dispatch('click');
  assert.equal(ctx.element('login-form').hidden,false);
  assert.equal(ctx.element('login-details').open,true);
  assert.equal(ctx.element('deck-details').open,false);
  assert.equal(ctx.element('movement-details').open,false);
}));

test('unit selectors offer current own units, enemy targets and submit selected IDs only',()=>withBrowser(async ctx=>{
  await ctx.element('login-form').dispatch('submit');
  await ctx.element('create').dispatch('click');
  ctx.state.lobby='READY';
  ctx.state.deckPhase='ASSIGN_ORDERS';
  await ctx.element('refresh').dispatch('click');
  const values=id=>ctx.element(id).children.map(option=>option.value).filter(Boolean);
  assert.deepEqual(values('deck-units'),['synthetic-a','synthetic-a2']);
  assert.deepEqual(values('deck-move-unit'),['synthetic-a','synthetic-a2']);
  assert.deepEqual(values('deck-target'),['synthetic-b']);
  assert.equal(ctx.element('deck-move-unit').value,'','no implicit own unit selected');
  const select=ctx.element('deck-units');
  assert.equal(ctx.element('deck-orders').disabled,true);
  select.value='synthetic-a';
  await select.dispatch('change');
  assert.equal(ctx.element('deck-unit-add').disabled,false);
  await ctx.element('deck-unit-add').dispatch('click');
  select.value='synthetic-a2';
  await select.dispatch('change');
  await ctx.element('deck-unit-add').dispatch('click');
  assert.equal(ctx.element('deck-orders').disabled,false);
  assert.match(ctx.element('deck-unit-selected').textContent,/synthetic-a2/);
  await ctx.element('deck-orders').dispatch('click');
  const request=ctx.requests.find(entry=>entry.path===`/api/matches/${MATCH}/commands`);
  const payload=JSON.parse(request.body);
  assert.equal(payload.type,'assign_synthetic_orders');
  assert.deepEqual(payload.unitIds,['synthetic-a','synthetic-a2']);
  assert.equal(payload.unitIds.includes('synthetic-b'),false);
}));


test('browser markup: every phase has native details and all unit fields are selectors',()=>{
  const html=readFileSync(new URL('./browser-ui.html',import.meta.url),'utf8');
  for(const id of [
    'login-details','match-details','invite-details','state-details',
    'deck-details','movement-details'
  ]) assert.match(html,new RegExp(`<details id="${id}"`));
  for(const id of ['deck-units','deck-move-unit','deck-target'])
    assert.match(html,new RegExp(`<select id="${id}"`));
  assert.match(html,/<button id="deck-unit-add"/);
  assert.match(html,/<button id="deck-unit-clear"/);
  assert.doesNotMatch(html,/<input id="deck-units"/);
  assert.equal((html.match(/<details\b/g)||[]).length,6);
  assert.equal((html.match(/<\/details>/g)||[]).length,6);
});


test('bob owner: missed SSE join still refreshes ready lobby through authorized recovery',()=>withBrowser(async ctx=>{
  await ctx.element('login-form').dispatch('submit');
  await ctx.element('create').dispatch('click');
  assert.equal(ctx.element('lobby').textContent.includes('INVITING'),true);
  assert.equal(ctx.timerCount(),1);
  const feed=ctx.feeds.at(-1);
  ctx.state.lobby='READY'; // Alice accepted, but SSE notice is deliberately dropped
  assert.equal(ctx.element('state').textContent.includes('A_CARD'),false);
  const readsBefore=ctx.requests.filter(x=>x.path===`/api/matches/${MATCH}`).length;
  await ctx.pulseLobby();
  assert.ok(ctx.requests.filter(x=>x.path===`/api/matches/${MATCH}`).length>readsBefore);
  assert.equal(ctx.element('state').textContent.includes('A_CARD'),true);
  assert.equal(ctx.element('lobby').textContent.includes('READY'),true);
  assert.equal(ctx.timerCount(),0,'recovery stops when match becomes ready');
  assert.equal(feed.closed,false,'successful fallback must preserve SSE subscription');
  assert.equal(ctx.element('state').textContent.includes('PRIVATE_B'),false);
  await ctx.element('logout').dispatch('click');
  assert.equal(ctx.timerCount(),0);
},{owner:'bob'}));

test('waiting lobby recovery is hidden-tab safe and terminates on logout',()=>withBrowser(async ctx=>{
  await ctx.element('login-form').dispatch('submit');
  await ctx.element('create').dispatch('click');
  assert.equal(ctx.timerCount(),1);
  const before=ctx.requests.length;
  ctx.document.hidden=true;
  await ctx.pulseLobby();
  assert.equal(ctx.requests.length,before,'hidden tab cannot request private match state');
  ctx.document.hidden=false;
  ctx.state.lobby='READY';
  await ctx.document.dispatch('visibilitychange');
  assert.equal(ctx.element('lobby').textContent.includes('READY'),true);
  assert.equal(ctx.timerCount(),0);
  await ctx.element('logout').dispatch('click');
  assert.equal(ctx.timerCount(),0);
},{owner:'bob'}));
