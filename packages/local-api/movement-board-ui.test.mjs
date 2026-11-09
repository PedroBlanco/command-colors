import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMovementBoard,createMovementBoard} from './movement-board-ui.mjs';

class Node {
  constructor(doc,tag){this.ownerDocument=doc;this.tag=tag;this.attrs={};this.children=[];
    this.listeners=new Map();this.classes=new Set();this.textContent='';this.disabled=false;
    this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x)};}
  setAttribute(name,value){this.attrs[name]=value;}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  addEventListener(name,fn){this.listeners.set(name,fn);}
  dispatch(name,details={}){return this.listeners.get(name)?.({key:'',preventDefault(){},...details});}
}
function fixture(){const doc={createElementNS:(_ns,tag)=>new Node(doc,tag)};
  const svg=new Node(doc,'svg'),status=new Node(doc,'p'),undoButton=new Node(doc,'button'),
   cancelButton=new Node(doc,'button'),confirmButton=new Node(doc,'button');
  return {svg,status,undoButton,cancelButton,confirmButton};}
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
 assert.equal(cell(svg,3,4).attrs.tabindex,'0');
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

test('occupied cells and jumps are rejected without mutating the route',()=>{
 const {svg,controller,errors,requests}=setup();
 cell(svg,3,4).dispatch('click');
 cell(svg,5,5).dispatch('click');
 assert.deepEqual(errors,['HEX_NO_ADYACENTE']);
 cell(svg,4,4).dispatch('click');
 cell(svg,5,4).dispatch('click');
 assert.equal(errors.at(-1),'HEX_OCUPADO');
 assert.deepEqual(controller.getDraft().path,[{col:4,row:4}]);
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
