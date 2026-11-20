import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMovementBoard,createMovementBoard} from './movement-board-ui.mjs';

class Node {
  constructor(doc,tag){this.ownerDocument=doc;this.tag=tag;this.attrs={};this.children=[];
    this.listeners=new Map();this.classes=new Set();this.dataset={};this.textContent='';this.disabled=false;
    this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x)};}
  setAttribute(name,value){this.attrs[name]=String(value);}
  getAttribute(name){return this.attrs[name]??null;}
  contains(other){return this===other||this.children.some(child=>child.contains?.(other));}
  focus(){this.ownerDocument.activeElement=this;}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  addEventListener(name,fn){this.listeners.set(name,fn);}
  dispatch(name,details={}){return this.listeners.get(name)?.({key:'',preventDefault(){},...details});}
}
function fixture(){const doc={activeElement:null,createElementNS:(_ns,tag)=>new Node(doc,tag)};
  const svg=new Node(doc,'svg'),status=new Node(doc,'p'),undoButton=new Node(doc,'button'),
   cancelButton=new Node(doc,'button'),confirmButton=new Node(doc,'button'),
   attackButton=new Node(doc,'button');
  return {svg,status,undoButton,cancelButton,confirmButton,attackButton};}
const view=()=>({matchId:'123e4567-e89b-42d3-a456-426614174000',you:'A',turn:'A',actingSide:'A',
  phase:'MOVEMENT',revision:5,yourHand:[],movedUnitIds:[],pendingDecision:null,
  board:[{id:'synthetic-a',side:'A',col:3,row:4},{id:'synthetic-a2',side:'A',col:7,row:4},
    {id:'synthetic-b',side:'B',col:5,row:4}]});
function cell(svg,col,row){return svg.children[0].children.find(x=>Number(x.attrs['data-col'])===col&&Number(x.attrs['data-row'])===row);}

function setup(){const ui=fixture(),requests=[],errors=[];
 const controller=createMovementBoard({...ui,onConfirm:async(fields,key)=>{requests.push({fields,key})},
   onError:error=>errors.push(error.message),makeIdempotencyKey:()=> 'synthetic_key_001'});
 controller.setView(view());return {...ui,controller,requests,errors};}

test('renders exactly 117 accessible interactive hexes with public units only',()=>{
 const {svg}=setup();assert.equal(svg.children[0].children.length,117);
 assert.match(cell(svg,3,4).attrs['aria-label'],/synthetic-a/);
 assert.equal(cell(svg,3,4).attrs.role,'button');
 assert.equal(cell(svg,3,4).attrs.tabindex,'-1');
 assert.equal(cell(svg,0,0).attrs.tabindex,'0');
 assert.equal(cell(svg,3,4).children[1].attrs.class,'unit-a');
 assert.equal(JSON.stringify(svg).includes('secret-card'),false);
});

test('keyboard unit selection and click route need explicit confirmation',async()=>{
 const {svg,controller,requests,confirmButton,undoButton,status}=setup();
 let stopped=false;
 cell(svg,3,4).dispatch('keydown',{key:'Enter',preventDefault(){stopped=true}});
 assert.equal(stopped,true);
 assert.equal(controller.getDraft().unitId,'synthetic-a');
 assert.equal(confirmButton.disabled,true);
 cell(svg,4,4).dispatch('click');
 assert.deepEqual(controller.getDraft().path,[{col:4,row:4}]);
 assert.equal(undoButton.disabled,false);
 assert.equal(confirmButton.disabled,false);
 assert.match(status.textContent,/1 pasos/);
 assert.equal(cell(svg,4,4).attrs['aria-pressed'],'true');
 assert.equal(requests.length,0);
 await confirmButton.dispatch('click');
 assert.equal(requests.length,1);
 assert.deepEqual(requests[0],{fields:{unitId:'synthetic-a',path:[{col:4,row:4}]},key:'synthetic_key_001'});
 assert.equal(controller.getDraft(),null);
});

test('distant clicks build candidate routes, occupied destinations stay blocked',()=>{
 const {svg,controller,errors,requests,status}=setup();
 cell(svg,3,4).dispatch('click');
 cell(svg,5,5).dispatch('click');
 assert.equal(errors.length,0);
 assert.deepEqual(controller.getDraft().path.at(-1),{col:5,row:5});
 assert.ok(controller.getDraft().path.length>1);
 assert.match(status.textContent,/Ruta geométrica automática/);
 const oldPath=controller.getDraft().path;
 cell(svg,5,4).dispatch('click');
 assert.equal(errors.at(-1),'HEX_OCUPADO');
 assert.match(status.textContent,/está ocupado/);
 assert.deepEqual(controller.getDraft().path,oldPath);
 assert.equal(requests.length,0);
});

test('undo and cancel are local and never send a command',()=>{
 const {svg,controller,undoButton,cancelButton,requests}=setup();
 cell(svg,3,4).dispatch('click');cell(svg,4,4).dispatch('click');cell(svg,4,5).dispatch('click');
 undoButton.dispatch('click');assert.deepEqual(controller.getDraft().path,[{col:4,row:4}]);
 cancelButton.dispatch('click');assert.equal(controller.getDraft(),null);
 assert.equal(requests.length,0);
});

test('new revision or changed identity/phase discards the unsubmitted path',()=>{
 const {svg,controller,confirmButton}=setup();
 cell(svg,3,4).dispatch('click');cell(svg,4,4).dispatch('click');
 controller.setView({...view(),revision:6});
 assert.equal(controller.getDraft(),null);
 assert.equal(confirmButton.disabled,true);
 controller.setView(view());
 cell(svg,3,4).dispatch('click');cell(svg,4,4).dispatch('click');
 controller.setView({...view(),you:'B'});
 assert.equal(controller.getDraft(),null);
 controller.setView({...view(),phase:'COMBAT'});
 assert.equal(confirmButton.disabled,true);
});

test('failed transmission retains idempotency key for retry, changed route resets it',async()=>{
 const ui=fixture(),calls=[],errors=[];let shouldFail=true,sequence=0;
 const ctrl=createMovementBoard({...ui,onConfirm:async(fields,key)=>{
   calls.push({fields,key});if(shouldFail)throw Error('NETWORK_FAILED');
 },onError:e=>errors.push(e.message),makeIdempotencyKey:()=>`retry_key_${++sequence}`});
 ctrl.setView(view());ctrl.select({col:3,row:4});ctrl.select({col:4,row:4});
 await ctrl.confirm();await ctrl.confirm();
 assert.deepEqual(calls.map(x=>x.key),['retry_key_1','retry_key_1']);
 assert.deepEqual(errors,['NETWORK_FAILED','NETWORK_FAILED']);
 shouldFail=false;
 ctrl.select({col:4,row:5});
 await ctrl.confirm();
 assert.equal(calls[2].key,'retry_key_2');
 assert.equal(ctrl.getDraft(),null);
});

test('SSE revision refreshed during pending POST is not lost',async()=>{
 const ui=fixture();let finish,started;
 const wasStarted=new Promise(resolve=>{started=resolve});
 const c=createMovementBoard({...ui,onConfirm:async()=>{started();await new Promise(resolve=>finish=resolve)},makeIdempotencyKey:()=> 'key123456'});
 c.setView(view());c.select({col:3,row:4});c.select({col:4,row:4});
 const posting=c.confirm();await wasStarted;
 c.setView({...view(),revision:6});
 finish();await posting;
 assert.equal(c.getDraft(),null);
 assert.equal(ui.confirmButton.disabled,true);
});

test('renderer rejects duplicate ids, occupied cells, out-of-bounds, and invalid sides',()=>{
 const {svg}=fixture();
 for(const board of [
   [{id:'x',side:'A',col:3,row:4},{id:'x',side:'B',col:5,row:4}],
   [{id:'x',side:'A',col:3,row:4},{id:'y',side:'B',col:3,row:4}],
   [{id:'x',side:'A',col:13,row:4}],
   [{id:'x',side:'Z',col:3,row:4}]
 ])assert.throws(()=>renderMovementBoard(svg,board,null,()=>{}),/INVALID_MOVEMENT_BOARD_VIEW/);
});

test('single Tab stop, arrow navigation and persistent focus across SVG redraws',()=>{
 const {svg,controller}=setup();
 const all=()=>svg.children[0].children;
 assert.equal(all().filter(x=>x.attrs.tabindex==='0').length,1);
 cell(svg,0,0).focus();
 for(let i=0;i<3;i++){
   const current=svg.ownerDocument.activeElement;
   let prevented=false;current.dispatch('keydown',{key:'ArrowRight',preventDefault(){prevented=true}});
   assert.equal(prevented,true);
 }
 for(let i=0;i<4;i++)svg.ownerDocument.activeElement.dispatch('keydown',{key:'ArrowDown'});
 const unit=svg.ownerDocument.activeElement;
 assert.equal(unit.attrs['data-col'],'3');assert.equal(unit.attrs['data-row'],'4');
 assert.equal(controller.getDraft(),null);
 unit.dispatch('keydown',{key:'Enter'});
 assert.equal(controller.getDraft().unitId,'synthetic-a');
 assert.equal(svg.ownerDocument.activeElement,cell(svg,3,4));
 svg.ownerDocument.activeElement.dispatch('keydown',{key:'ArrowRight'});
 assert.equal(svg.ownerDocument.activeElement,cell(svg,4,4));
 svg.ownerDocument.activeElement.dispatch('keydown',{key:' '});
 assert.deepEqual(controller.getDraft().path,[{col:4,row:4}]);
 assert.equal(svg.ownerDocument.activeElement,cell(svg,4,4));
 assert.equal(all().filter(x=>x.attrs.tabindex==='0').length,1);
});

test('same-revision changed occupancy or origin fail closed instead of retaining stale routes',()=>{
 const {svg,controller,confirmButton}=setup();
 cell(svg,3,4).dispatch('click');cell(svg,4,4).dispatch('click');
 assert.equal(confirmButton.disabled,false);
 const changed=view();changed.board[2]={...changed.board[2],col:4,row:4};
 controller.setView(changed);
 assert.equal(controller.getDraft(),null);
 assert.equal(confirmButton.disabled,true);
 controller.setView(view());cell(svg,3,4).dispatch('click');
 const moved=view();moved.board[0]={...moved.board[0],col:2,row:4};
 controller.setView(moved);
 assert.equal(controller.getDraft(),null);
});

test('board redraw never steals focus from external controls',()=>{
 const {svg,controller,confirmButton}=setup();
 confirmButton.focus();
 controller.setView({...view(),revision:8});
 assert.equal(svg.ownerDocument.activeElement,confirmButton);
});


test('landscape 13 × 9: each player sees their army along the bottom long edge',()=>{
 const {svg}=fixture(),board=[
   {id:'north',side:'B',col:9,row:2},
   {id:'south',side:'A',col:3,row:6}
 ];
 renderMovementBoard(svg,board,null,()=>{},'A');
 const ownA=cell(svg,3,6).children[1],enemyB=cell(svg,9,2).children[1];
 assert.equal(svg.attrs.viewBox,'0 0 510 430');
 assert.ok(Number(ownA.attrs.cy)>Number(enemyB.attrs.cy),'A at the bottom for viewer A');
 assert.equal(cell(svg,3,6).attrs['data-col'],'3');
 assert.equal(cell(svg,3,6).attrs['data-row'],'6');
 renderMovementBoard(svg,board,null,()=>{},'B');
 const ownB=cell(svg,9,2).children[1],enemyA=cell(svg,3,6).children[1];
 assert.ok(Number(ownB.attrs.cy)>Number(enemyA.attrs.cy),'B at the bottom for viewer B');
 assert.equal(cell(svg,9,2).attrs['data-col'],'9');
 assert.equal(cell(svg,9,2).attrs['data-row'],'2');
});

test('B viewer keyboard directions follow rotated display rather than stored hex axes',()=>{
 const {svg}=fixture();
 renderMovementBoard(svg,view().board,null,()=>{},'B');
 cell(svg,5,4).focus();
 cell(svg,5,4).dispatch('keydown',{key:'ArrowRight'});
 assert.equal(svg.ownerDocument.activeElement,cell(svg,4,4));
 svg.ownerDocument.activeElement.dispatch('keydown',{key:'ArrowDown'});
 assert.equal(svg.ownerDocument.activeElement,cell(svg,4,3));
});

test('next-step hints and route trimming update the board without sending a command',()=>{
 const {svg,controller,requests}=setup();
 assert.equal(cell(svg,3,4).classes.has('hex-selectable'),true);
 cell(svg,3,4).dispatch('click');
 assert.equal(cell(svg,4,4).classes.has('hex-next'),true);
 assert.match(cell(svg,4,4).attrs['aria-label'],/candidato geométrico/);
 cell(svg,4,4).dispatch('click');
 cell(svg,4,5).dispatch('click');
 cell(svg,4,4).dispatch('click');
 assert.deepEqual(controller.getDraft().path,[{col:4,row:4}]);
 cell(svg,3,4).dispatch('click');
 assert.deepEqual(controller.getDraft().path,[]);
 assert.equal(requests.length,0);
});

test('suggested routes need confirmation and expire after an updated revision',async()=>{
 const {controller,requests,confirmButton}=setup();
 controller.select({col:3,row:4});
 controller.select({col:8,row:6});
 assert.equal(requests.length,0);
 controller.setView({...view(),revision:6});
 assert.equal(controller.getDraft(),null);
 assert.equal(confirmButton.disabled,true);
 controller.setView(view());
 controller.select({col:3,row:4});
 controller.select({col:8,row:6});
 await controller.confirm();
 assert.equal(requests.length,1);
 assert.deepEqual(requests[0].fields.path.at(-1),{col:8,row:6});
 assert.equal(Object.hasOwn(requests[0].fields,'actor'),false);
});

test('clicking a rival in synthetic combat selects a target but never sends automatically',async()=>{
 const ui=fixture(),sent=[];
 const c=createMovementBoard({...ui,onConfirm:async()=>{},
   onRequestDefense:async(id,key)=>{sent.push({id,key});},
   makeIdempotencyKey:()=> 'defense_key_001'});
 c.setView({...view(),phase:'COMBAT'});
 assert.equal(cell(ui.svg,5,4).classes.has('hex-combat-selectable'),true);
 c.select({col:5,row:4});
 assert.equal(sent.length,0);
 assert.equal(ui.attackButton.disabled,false);
 assert.equal(cell(ui.svg,5,4).classes.has('hex-combat-selected'),true);
 await ui.attackButton.dispatch('click');
 assert.deepEqual(sent,[{id:'synthetic-b',key:'defense_key_001'}]);
 assert.equal(ui.attackButton.disabled,true);
});

test('wrong targets and stale combat selection cannot be submitted',async()=>{
 const ui=fixture(),sent=[],errors=[];
 const c=createMovementBoard({...ui,onConfirm:async()=>{},
   onRequestDefense:async id=>sent.push(id),onError:e=>errors.push(e.message)});
 c.setView({...view(),phase:'COMBAT'});
 c.select({col:3,row:4});
 assert.deepEqual(errors,['OBJETIVO_RIVAL_REQUERIDO']);
 c.select({col:5,row:4});
 c.setView({...view(),phase:'COMBAT',revision:6});
 await c.requestDefense();
 assert.equal(sent.length,0);
 assert.equal(ui.attackButton.disabled,true);
});

test('synthetic defense retry keeps the same idempotency key until success',async()=>{
 const ui=fixture(),keys=[];let fail=true;
 const c=createMovementBoard({...ui,onConfirm:async()=>{},
   onRequestDefense:async(_,key)=>{keys.push(key);if(fail)throw Error('NETWORK_FAILED')},
   makeIdempotencyKey:()=> 'defense_retry_01'});
 c.setView({...view(),phase:'COMBAT'});
 c.select({col:5,row:4});
 await c.requestDefense();
 fail=false;
 await c.requestDefense();
 assert.deepEqual(keys,['defense_retry_01','defense_retry_01']);
 assert.equal(ui.attackButton.disabled,true);
});

test('rejected server movement stays visible by board confirm and keeps retry key',async()=>{
  const ui=fixture(),errors=[],keys=[];
  const ctrl=createMovementBoard({...ui,onConfirm:async(_,key)=>{
    keys.push(key);throw Error('409: STALE_REVISION');
  },onError:e=>errors.push(e.message),makeIdempotencyKey:()=> 'retry_key_1'});
  ctrl.setView(view());ctrl.select({col:3,row:4});ctrl.select({col:4,row:4});
  await ctrl.confirm();
  assert.match(ui.status.textContent,/servidor rechazó.*409: STALE_REVISION/);
  assert.deepEqual(errors,['409: STALE_REVISION']);
  assert.ok(ctrl.getDraft());
  await ctrl.confirm();
  assert.deepEqual(keys,['retry_key_1','retry_key_1']);
  assert.match(ui.status.textContent,/409: STALE_REVISION/);
  ctrl.setView({...view(),revision:6});
  assert.doesNotMatch(ui.status.textContent,/409: STALE_REVISION/);
});
test('superseded movement response cannot discard its local pending route',async()=>{
  const ui=fixture(),ctrl=createMovementBoard({...ui,onConfirm:async()=>false});
  ctrl.setView(view());ctrl.select({col:3,row:4});ctrl.select({col:4,row:4});
  await ctrl.confirm();
  assert.deepEqual(ctrl.getDraft().path,[{col:4,row:4}]);
  assert.equal(ui.confirmButton.disabled,false);
});
