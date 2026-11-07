import test from 'node:test';
import assert from 'node:assert/strict';

const MATCH='123e4567-e89b-42d3-a456-426614174000';
let serial=0;
async function withBrowser(run) {
  const originals={document:globalThis.document,window:globalThis.window,fetch:globalThis.fetch,EventSource:globalThis.EventSource};
  const elements=new Map(),handlers=new Map(),requests=[],feeds=[];
  function element(id) {
    if(!elements.has(id))elements.set(id,{value:'',textContent:'',hidden:false,disabled:false,children:[],handlers:new Map(),
      addEventListener(event,fn){this.handlers.set(event,fn)},
      replaceChildren(){this.children=[];this.value=''},
      appendChild(option){this.children.push(option);if(this.children.length===1)this.value=option.value},
      async dispatch(event){return await this.handlers.get(event)?.({preventDefault(){}})}});
    return elements.get(id);
  }
  const document={hidden:false,getElementById:element,createElement:()=>({value:'',textContent:''}),
    addEventListener(name,fn){handlers.set(name,fn)},async dispatch(name){await handlers.get(name)?.()}};
  const window={addEventListener(name,fn){handlers.set(name,fn)},async dispatch(name){await handlers.get(name)?.()}};
  const state={login:false,lobby:'INVITING',revision:0};
  class FakeEventSource {
    constructor(url){this.url=url;this.events=new Map();this.closed=false;feeds.push(this)}
    addEventListener(name,fn){this.events.set(name,fn)}
    emit(revision){this.events.get('revision')?.({data:JSON.stringify(revision)})}
    close(){this.closed=true}
  }
  const fetch=async(path,options={})=>{
    requests.push({path,method:options.method??'GET'});
    let response={code:'NOT_FOUND'},status=404;
    if(path==='/api/session' && options.method==='POST'){state.login=true;response={ok:true};status=200;}
    else if(path==='/api/session' && options.method==='DELETE'){state.login=false;response={ok:true};status=200;}
    else if(path==='/api/session' && state.login){response={authenticated:true,handle:'alice'};status=200;}
    else if(path==='/api/matches' && options.method==='POST'){response={matchId:MATCH};status=201;}
    else if(path===`/api/matches/${MATCH}` && state.login){response={status:state.lobby,players:[{side:'A',handle:'alice'}],
      ...(state.lobby==='READY'?{state:{matchId:MATCH,you:'A',turn:state.revision?'B':'A',revision:state.revision,yourHand:['A_CARD'],opponentCardCount:3,board:[]}}:{})};status=200;}
    else if(path===`/api/matches/${MATCH}/commands` && state.login){state.revision++;response={code:'APPLIED'};status=200;}
    return {ok:status<400,status,json:async()=>response};
  };
  Object.assign(globalThis,{document,window,fetch,EventSource:FakeEventSource});
  element('handle').value='alice';element('password').value='test-only';
  try {
    await import(`./browser-ui.mjs?mock=${++serial}`);
    return await run({element,document,window,feeds,requests,state});
  } finally {Object.assign(globalThis,originals)}
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
