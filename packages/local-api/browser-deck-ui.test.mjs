import test from 'node:test';
import assert from 'node:assert/strict';

const MATCH='123e4567-e89b-42d3-a456-426614174000';
let serial=0;
async function withBrowser(run, {onMoveCommand=null,onInvite=null}={}) {
 const original={document:globalThis.document,window:globalThis.window,fetch:globalThis.fetch,EventSource:globalThis.EventSource};
 const elements=new Map(), handlers=new Map(), requests=[], sources=[];
 function element(id) {
   if(!elements.has(id))elements.set(id,{
     value:'',textContent:'',disabled:false,hidden:false,children:[],listeners:new Map(),
     addEventListener(type,fn){this.listeners.set(type,fn)},
     async dispatch(type){await this.listeners.get(type)?.({preventDefault(){}})},
     replaceChildren(){this.children=[];this.value=''},
     appendChild(option){this.children.push(option);if(this.children.length===1)this.value=option.value}
   });
   return elements.get(id);
 }
 const document={hidden:false,getElementById:element,createElement(type){return {type,value:'',textContent:''}},
   addEventListener(type,fn){handlers.set(type,fn)},async dispatch(type){await handlers.get(type)?.()}};
 const window={addEventListener(type,fn){handlers.set(type,fn)}};
 const state={login:false,lobby:'INVITING',initialized:false,phase:'AWAIT_CARD',revision:0,
   handA:['own_1','own_2'],handB:['other_1','other_2','other_3'],discard:[],inPlay:null,turn:'A',
   board:[{id:'unit_a',side:'A',col:3,row:4},{id:'unit_b',side:'B',col:9,row:4}],movedUnitIds:[]};
 class FakeEventSource {
   constructor(url){this.url=url;this.closed=false;this.listeners=new Map();sources.push(this)}
   addEventListener(type,fn){this.listeners.set(type,fn)}
   close(){this.closed=true}
   emit(x){this.listeners.get('revision')?.({data:JSON.stringify(x)})}
 }
 const fetch=async(path,options={})=>{
   const data=options.body?JSON.parse(options.body):undefined;
   requests.push({path,method:options.method,body:data,headers:options.headers});
   let code='NOT_FOUND',status=404,response={code};
   if(path==='/api/session'&&options.method==='POST'){state.login=true;status=200;response={ok:true}}
   else if(path==='/api/session'&&options.method==='DELETE'){state.login=false;status=200;response={ok:true}}
   else if(path==='/api/session'&&state.login){status=200;response={authenticated:true,handle:'alice'}}
   else if(path==='/api/matches'&&options.method==='POST'){status=201;response={matchId:MATCH}}
   else if(path===`/api/matches/${MATCH}`&&state.login){
     const view={matchId:MATCH,you:'A',turn:state.turn,revision:state.revision,yourHand:[...state.handA],
       opponentCardCount:state.handB.length,board:structuredClone(state.board),movedUnitIds:[...state.movedUnitIds]};
     if(state.initialized)Object.assign(view,{phase:state.phase,actingSide:state.turn,drawPileCount:13,
       discardPile:[...state.discard],cardInPlay:state.inPlay,pendingDecision:null});
     status=200;response={status:state.lobby,players:[{side:'A',handle:'alice'},{side:'B',handle:'bob'}],
       ...(state.lobby==='READY'?{state:view}:{})};
   }
   else if(path===`/api/matches/${MATCH}/invitations`&&options.method==='POST'){
     if(onInvite) await onInvite();
     status=201;response={token:'test-secret-invitation'};
   }
   else if(path===`/api/matches/${MATCH}/deck/initialize`&&options.method==='POST'){
     if(state.lobby==='READY'&&!state.initialized&&Object.keys(data).length===0){state.initialized=true;status=201;response={code:'DECK_INITIALIZED'}}
     else{status=409;response={code:'NOT_AVAILABLE'}}
   }
   else if(path===`/api/matches/${MATCH}/commands`&&options.method==='POST'){
     if(data?.type==='move_synthetic_unit' && onMoveCommand) await onMoveCommand();
     if(!state.initialized || data.expectedRevision!==state.revision){status=409;response={code:'STALE_REVISION'}}
     else{
       const next={
         play_synthetic_card:'ASSIGN_ORDERS',assign_synthetic_orders:'MOVEMENT',
         undo_synthetic_orders:'ASSIGN_ORDERS',move_synthetic_unit:'MOVEMENT',finish_synthetic_movement:'COMBAT',
         finish_synthetic_combat:'DRAW_CARD',acknowledge_synthetic_draw:'AWAIT_CARD'
       };
       if(!Object.hasOwn(next,data.type)){status=400;response={code:'UNSUPPORTED_COMMAND'}}
       else{if(data.type==='play_synthetic_card'){state.inPlay=data.cardRef;state.handA.splice(state.handA.indexOf(data.cardRef),1)}
         if(data.type==='move_synthetic_unit'){
           const unit=state.board.find(x=>x.id===data.unitId);
           if(unit){unit.col=data.path.at(-1).col;unit.row=data.path.at(-1).row;state.movedUnitIds.push(unit.id);}
         }
         if(data.type==='acknowledge_synthetic_draw'){state.discard.push(state.inPlay);state.inPlay=null;state.handA.push('new_card');state.turn='B'}
         state.phase=next[data.type];state.revision++;status=200;response={code:'APPLIED'};}
     }
   }
   return {ok:status<400,status,json:async()=>response};
 };
 Object.assign(globalThis,{document,window,fetch,EventSource:FakeEventSource});
 element('handle').value='alice';element('password').value='test-password';
 try {
   await import(`./browser-ui.mjs?deckmock=${++serial}`);
   return await run({element,state,requests,sources,document});
 } finally {Object.assign(globalThis,original)}
}

async function loginReady(c){
 await c.element('login-form').dispatch('submit');
 await c.element('create').dispatch('click');
 c.state.lobby='READY';
 await c.element('refresh').dispatch('click');
}

test('deck controls are hidden on legacy and only available after owner initializes',()=>withBrowser(async c=>{
 await loginReady(c);
 assert.equal(c.element('deck-panel').hidden,true);
 assert.equal(c.element('deck-initialize').disabled,false);
 await c.element('deck-initialize').dispatch('click');
 assert.equal(c.state.initialized,true);
 assert.equal(c.element('deck-panel').hidden,false);
 assert.equal(c.element('turn').disabled,true);
 assert.equal(c.element('deck-play').disabled,false);
 assert.deepEqual(c.element('deck-card').children.map(x=>x.value),['own_1','own_2']);
 assert.equal(c.element('state').textContent.includes('other_1'),false);
 assert.equal(c.element('state').textContent.includes('own_1'),true);
 assert.equal(c.element('deck-initialize').disabled,true);
}));

test('browser commands send expected revision and fields, never actor',()=>withBrowser(async c=>{
 await loginReady(c); await c.element('deck-initialize').dispatch('click');
 await c.element('deck-play').dispatch('click');
 let sent=c.requests.find(x=>x.body?.type==='play_synthetic_card');
 assert.equal(sent.body.cardRef,'own_1');
 assert.equal(sent.body.expectedRevision,0);
 assert.equal(Object.hasOwn(sent.body,'actor'),false);
 assert.match(sent.body.idempotencyKey,/^[a-z0-9]{32}$/i);
 assert.equal(c.element('deck-orders').disabled,false);
 c.element('deck-units').value='unit_a, unit_b';
 await c.element('deck-orders').dispatch('click');
 sent=c.requests.find(x=>x.body?.type==='assign_synthetic_orders');
 assert.deepEqual(sent.body.unitIds,['unit_a','unit_b']);
 assert.equal(sent.body.expectedRevision,1);
 assert.equal(c.element('deck-undo').disabled,false);
 await c.element('deck-movement').dispatch('click');
 assert.equal(c.element('deck-combat').disabled,false);
 await c.element('deck-combat').dispatch('click');
 assert.equal(c.element('deck-draw').disabled,false);
 await c.element('deck-draw').dispatch('click');
 assert.equal(c.state.turn,'B');
 assert.equal(c.element('deck-play').disabled,true);
 assert.equal(c.element('deck-status').textContent.includes('debe actuar B'),true);
}));

test('a forged card or invalid orders are rejected before HTTP mutation',()=>withBrowser(async c=>{
 await loginReady(c);await c.element('deck-initialize').dispatch('click');
 const before=c.requests.length;
 c.element('deck-card').value='enemy_secret';
 await c.element('deck-play').dispatch('click');
 assert.equal(c.requests.length,before);
 assert.equal(c.element('message').textContent,'CARTA_NO_PROPIA');
 c.element('deck-card').value='own_1';
 await c.element('deck-play').dispatch('click');
 const count=c.requests.length;
 c.element('deck-units').value='same,same';
 await c.element('deck-orders').dispatch('click');
 assert.equal(c.requests.length,count);
 assert.equal(c.element('message').textContent,'ORDENES_INVALIDAS');
}));

test('SSE refresh and logout never revive cards from a previous session',()=>withBrowser(async c=>{
 await loginReady(c);await c.element('deck-initialize').dispatch('click');
 const source=c.sources[0];
 assert.equal(source.closed,false);
 c.state.revision=1;source.emit({lobbyRevision:1,gameRevision:1});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(c.element('deck-panel').hidden,false);
 await c.element('logout').dispatch('click');
 assert.equal(source.closed,true);
 assert.equal(c.element('deck-panel').hidden,true);
 assert.equal(c.element('state').textContent.includes('own_1'),false);
}));

test('switching browser identity clears cards, lobby and invitation token',()=>withBrowser(async c=>{
 await loginReady(c);await c.element('deck-initialize').dispatch('click');
 assert.equal(c.element('state').textContent.includes('own_1'),true);
 c.element('invite-token').textContent='temporary-secret-invitation';
 const previousFeed=c.sources[0];
 c.element('handle').value='bob';
 await c.element('login-form').dispatch('submit');
 assert.equal(previousFeed.closed,true);
 assert.equal(c.element('deck-panel').hidden,true);
 assert.equal(c.element('deck-initialize').disabled,true);
 assert.equal(c.element('state').textContent.includes('own_1'),false);
 assert.equal(c.element('invite-token').textContent,'—');
 assert.equal(c.element('match-id').value,'');
 assert.equal(c.element('lobby').textContent,'Sin partida cargada');
}));

test('switching match input clears old cards before fetching another lobby',()=>withBrowser(async c=>{
 await loginReady(c);await c.element('deck-initialize').dispatch('click');
 assert.equal(c.element('state').textContent.includes('own_1'),true);
 const feed=c.sources[0];
 c.element('match-id').value='invalid-new-match';
 await c.element('match-id').dispatch('input');
 assert.equal(feed.closed,true);
 assert.equal(c.element('state').textContent.includes('own_1'),false);
 assert.equal(c.element('deck-panel').hidden,true);
}));

test('manual movement button sends sanitized own-unit path after order assignment',()=>withBrowser(async c=>{
 await loginReady(c);await c.element('deck-initialize').dispatch('click');
 await c.element('deck-play').dispatch('click');
 c.element('deck-units').value='unit_a';
 await c.element('deck-orders').dispatch('click');
 assert.equal(c.element('deck-move').disabled,false);
 c.element('deck-move-unit').value='unit_a';
 c.element('deck-move-path').value=' 4,4 ';
 await c.element('deck-move').dispatch('click');
 const sent=c.requests.find(x=>x.body?.type==='move_synthetic_unit');
 assert.ok(sent);
 assert.deepEqual(sent.body.path,[{col:4,row:4}]);
 assert.equal(sent.body.unitId,'unit_a');
 assert.equal(sent.body.expectedRevision,2);
 assert.equal(Object.hasOwn(sent.body,'actor'),false);
 assert.equal(c.state.board[0].col,4);
 assert.equal(c.element('deck-undo').disabled,true);
 assert.equal(c.element('deck-movement').disabled,false);
 const before=c.requests.length;
 c.element('deck-move-path').value='13,4';
 await c.element('deck-move').dispatch('click');
 assert.equal(c.requests.length,before);
 assert.equal(c.element('message').textContent,'RUTA_INVALIDA');
}));


test('late movement success after switching match never refreshes or overwrites the new view',()=>{
 let enter,release;
 const entered=new Promise(resolve=>enter=resolve);
 const gate=new Promise(resolve=>release=resolve);
 return withBrowser(async c=>{
   await loginReady(c);
   await c.element('deck-initialize').dispatch('click');
   await c.element('deck-play').dispatch('click');
   c.element('deck-units').value='unit_a';
   await c.element('deck-orders').dispatch('click');
   c.element('deck-move-unit').value='unit_a';
   c.element('deck-move-path').value='4,4';
   const pending=c.element('deck-move').dispatch('click');
   await entered;
   c.element('match-id').value='123e4567-e89b-42d3-a456-426614174001';
   await c.element('match-id').dispatch('input');
   c.element('message').textContent='NEW_SESSION_MESSAGE';
   const previousReads=c.requests.filter(x=>x.path===`/api/matches/${MATCH}`).length;
   release();
   await pending;
   assert.equal(c.element('message').textContent,'NEW_SESSION_MESSAGE');
   assert.equal(c.element('state').textContent,'null');
   assert.equal(c.element('deck-panel').hidden,true);
   assert.equal(c.requests.filter(x=>x.path===`/api/matches/${MATCH}`).length,previousReads);
 },{onMoveCommand:async()=>{enter();await gate}});
});

test('late movement success after logout never restores the former private board',()=>{
 let enter,release;
 const entered=new Promise(resolve=>enter=resolve);
 const gate=new Promise(resolve=>release=resolve);
 return withBrowser(async c=>{
   await loginReady(c);
   await c.element('deck-initialize').dispatch('click');
   await c.element('deck-play').dispatch('click');
   c.element('deck-units').value='unit_a';
   await c.element('deck-orders').dispatch('click');
   c.element('deck-move-unit').value='unit_a';
   c.element('deck-move-path').value='4,4';
   const pending=c.element('deck-move').dispatch('click');
   await entered;
   await c.element('logout').dispatch('click');
   c.element('message').textContent='LOGGED_OUT_MESSAGE';
   release();
   await pending;
   assert.equal(c.element('message').textContent,'LOGGED_OUT_MESSAGE');
   assert.equal(c.element('match-id').value,'');
   assert.equal(c.element('deck-panel').hidden,true);
   assert.equal(c.element('state').textContent.includes('own_1'),false);
 },{onMoveCommand:async()=>{enter();await gate}});
});


test('late invitation response is discarded after switching match',()=>{
 let enter,release;
 const entered=new Promise(resolve=>enter=resolve);
 const gate=new Promise(resolve=>release=resolve);
 return withBrowser(async c=>{
   await loginReady(c);
   c.element('invitee').value='bob';
   const pending=c.element('invite').dispatch('click');
   await entered;
   c.element('match-id').value='123e4567-e89b-42d3-a456-426614174001';
   await c.element('match-id').dispatch('input');
   c.element('message').textContent='MATCH_CHANGED';
   release();
   await pending;
   assert.equal(c.element('invite-token').textContent,'');
   assert.equal(c.element('message').textContent,'MATCH_CHANGED');
 },{onInvite:async()=>{enter();await gate}});
});
