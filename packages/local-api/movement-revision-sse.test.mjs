/** CCW-014: SSE revision-only notifications from genuine SQLite movement state. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSqliteCommandDeckStore} from '../command-deck/sqlite-game.mjs';
import {startRevisionStream} from './revision-stream.mjs';

const MATCH='22222222-2222-4222-8222-222222222222';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class Recorder extends EventEmitter {
 constructor(){super();this.frames=[];this.closed=false;}
 writeHead(code,headers){this.code=code;this.headers=headers;}
 flushHeaders(){}
 write(s){this.frames.push(s);return true;}
 end(){this.closed=true;this.emit('close');}
 revisions(){return this.frames.filter(s=>s.includes('event: revision')).map(raw=>({
   raw,payload:JSON.parse(raw.split('\n').find(s=>s.startsWith('data: ')).slice(6))}));}
 async wait(revision){for(let i=0;i<80;i++){const x=this.revisions().find(e=>e.payload.gameRevision===revision);if(x)return x;await sleep(25);}throw Error('SSE_TIMEOUT');}
}
async function lab(fn){
 const dir=mkdtempSync(join(tmpdir(),'ccw-movement-sse-'));
 const db=new DatabaseSync(join(dir,'lab.sqlite'));
 const open=[];
 try{
  db.exec('CREATE TABLE matches(id TEXT PRIMARY KEY,guest_id TEXT,private_state TEXT,lobby_revision INTEGER DEFAULT 0,game_revision INTEGER DEFAULT 0);');
  db.exec('CREATE TABLE game_events(match_id TEXT,sequence INTEGER,visibility TEXT,payload TEXT,PRIMARY KEY(match_id,sequence));');
  db.exec('CREATE TABLE game_commands(match_id TEXT,actor TEXT,idem_key TEXT,signature TEXT,committed_revision INTEGER,PRIMARY KEY(match_id,actor,idem_key));');
  const state={schemaVersion:1,matchId:MATCH,status:'ACTIVE',turn:'A',
   board:[{id:'synthetic-a',side:'A',col:3,row:4},{id:'synthetic-b',side:'B',col:9,row:4}],
   hands:{A:['LEGACY_A'],B:['LEGACY_B']},deck:['LEGACY_SECRET']};
  db.prepare('INSERT INTO matches(id,guest_id,private_state) VALUES (?,?,?)').run(MATCH,'bob',JSON.stringify(state));
  const getRow=id=>db.prepare('SELECT * FROM matches WHERE id=?').get(id);
  const atomic=run=>{db.exec('BEGIN IMMEDIATE');try{const r=run();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
  const store=createSqliteCommandDeckStore({db,getRow,atomic,matchId:MATCH});
  const identities=new Map([['a',{handle:'alice'}],['b',{handle:'bob'}]]);
  const identity={resolveSession:t=>identities.get(t)??null};
  const invitations={getMatch:()=>({ok:true,revision:1,status:'READY',players:[{handle:'alice',side:'A'},{handle:'bob',side:'B'}]})};
  const getStore=async()=>({view:()=>({matchId:MATCH,revision:getRow(MATCH).game_revision})});
  function subscribe(token){const res=new Recorder();const stop=startRevisionStream({res,token,matchId:MATCH,identity,invitations,getStore,intervalMs:20});open.push({res,stop});return res;}
  function command(type,revision,fields={},key='key_'+type+'_'+revision){return store.dispatch({actor:'A',type,expectedRevision:revision,idempotencyKey:key,...fields});}
  await fn({store,subscribe,command,identities,db});
 }finally{for(const {res,stop} of open){stop();res.end();}db.close();rmSync(dir,{recursive:true,force:true});}
}
async function toMovement({store,command}){
 assert.equal(store.initialize('A').status,201);
 const card=store.view('A').yourHand[0];
 assert.equal(command('play_synthetic_card',0,{cardRef:card}).code,'APPLIED');
 assert.equal(command('assign_synthetic_orders',1,{unitIds:['synthetic-a']}).code,'APPLIED');
 return card;
}

test('SQLite movement notifies both players by revisions only; no hidden cards or paths',()=>lab(async h=>{
 const a=h.subscribe('a'),b=h.subscribe('b');
 await a.wait(0);await b.wait(0);
 const card=await toMovement(h);
 assert.equal(h.command('move_synthetic_unit',2,{unitId:'synthetic-a',path:[{col:4,row:4}]}).code,'APPLIED');
 await a.wait(3);await b.wait(3);
 assert.equal(h.store.view('A').board[0].col,4);
 assert.equal(h.store.view('B').board[0].col,4);
 const snap=JSON.parse(h.db.prepare('SELECT private_state FROM matches WHERE id=?').get(MATCH).private_state).commandSession;
 for(const s of [a,b])for(const e of s.revisions()){
  assert.deepEqual(Object.keys(e.payload).sort(),['gameRevision','lobbyRevision']);
  for(const hidden of [card,...snap.hands.A,...snap.hands.B,...snap.drawPile])assert.equal(e.raw.includes(hidden),false);
  assert.equal(e.raw.includes('UNIT_MOVED_SIMULATED'),false);
  assert.equal(e.raw.includes('path'),false);
 }
}));

test('rejected movement does not produce SSE notifications',()=>lab(async h=>{
 await toMovement(h);
 const a=h.subscribe('a'),b=h.subscribe('b');await a.wait(2);await b.wait(2);
 assert.equal(h.command('move_synthetic_unit',2,{unitId:'synthetic-b',path:[{col:8,row:4}]}).code,'UNIT_NOT_ELIGIBLE');
 await sleep(100);
 assert.deepEqual(a.revisions().map(e=>e.payload.gameRevision),[2]);
 assert.deepEqual(b.revisions().map(e=>e.payload.gameRevision),[2]);
}));

test('reconnection starts at the latest committed SQLite revision',()=>lab(async h=>{
 await toMovement(h);
 assert.equal(h.command('move_synthetic_unit',2,{unitId:'synthetic-a',path:[{col:4,row:4}]}).code,'APPLIED');
 const b=h.subscribe('b');const event=await b.wait(3);
 assert.deepEqual(event.payload,{lobbyRevision:1,gameRevision:3});
 assert.equal(b.revisions().length,1);
}));

test('revocation closes an active SSE stream at its next check',()=>lab(async h=>{
 const b=h.subscribe('b');await b.wait(0);h.identities.delete('b');
 for(let i=0;i<80&&!b.closed;i++)await sleep(25);
 assert.equal(b.closed,true);
}));
