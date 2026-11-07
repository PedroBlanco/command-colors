import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createSqliteCommandDeckStore, hasCommandDeck} from './sqlite-game.mjs';

const MATCH = '123e4567-e89b-42d3-a456-426614174000';
const initial = () => ({schemaVersion:1,matchId:MATCH,status:'ACTIVE',turn:'A',board:[{id:'unit_1',side:'A',col:3,row:4},{id:'alpha',side:'A',col:4,row:4},
    {id:'beta',side:'A',col:5,row:4}],
  hands:{A:['LEGACY_A_ONLY'],B:['LEGACY_B_ONLY']},deck:['LEGACY_FUTURE']});
function open(file) {
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA busy_timeout=4000; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS matches(id TEXT PRIMARY KEY,owner_id TEXT,guest_id TEXT,
      lobby_revision INTEGER DEFAULT 0,game_revision INTEGER DEFAULT 0,private_state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS game_events(match_id TEXT NOT NULL,sequence INTEGER NOT NULL,
      visibility TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(match_id,sequence));
    CREATE TABLE IF NOT EXISTS game_commands(match_id TEXT NOT NULL,actor TEXT NOT NULL,idem_key TEXT NOT NULL,
      signature TEXT NOT NULL,committed_revision INTEGER NOT NULL,PRIMARY KEY(match_id,actor,idem_key));`);
  const getRow=id=>db.prepare('SELECT * FROM matches WHERE id=?').get(id);
  const atomic=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
  const store=createSqliteCommandDeckStore({db, matchId:MATCH, getRow, atomic});
  return {db,store,close:()=>db.close(),getRow};
}
function fixture(fn) {
  const dir=mkdtempSync(join(tmpdir(),'ccw-deck-db-'));
  const file=join(dir,'match.sqlite');
  const handles=[];
  const connect=()=>{const opened=open(file);handles.push(opened);return opened;};
  const inst=connect();
  inst.db.prepare('INSERT INTO matches(id,owner_id,guest_id,private_state) VALUES (?,?,?,?)')
    .run(MATCH,'account_A','account_B',JSON.stringify(initial()));
  try{return fn({connect,inst,file});}
  finally{for(const h of handles.reverse()){try{h.close()}catch{}}rmSync(dir,{recursive:true,force:true});}
}
function command(actor,type,revision,details={},key=`idempotency_${type}_${revision}`){
 return {actor,type,expectedRevision:revision,idempotencyKey:key,...details};
}
function apply(store,actor,type,revision,details={},key){const r=store.dispatch(command(actor,type,revision,details,key));assert.equal(r.status,200,JSON.stringify(r));return r.view;}

test('setup is owner only, requires lobby READY, and never repeats or overwrites existing demo',()=>fixture(({inst})=>{
  assert.equal(inst.store.initialize('B').status,403);
  assert.equal(hasCommandDeck(inst.getRow(MATCH)),false);
  const original=inst.getRow(MATCH);
  inst.db.prepare('UPDATE matches SET guest_id=NULL WHERE id=?').run(MATCH);
  assert.throws(()=>inst.store.initialize('A'),/MATCH_NOT_READY/);
  inst.db.prepare('UPDATE matches SET guest_id=? WHERE id=?').run('account_B',MATCH);
  const response=inst.store.initialize('A');
  assert.equal(response.status,201);assert.equal(response.view.yourHand.length,2);
  assert.equal(response.view.opponentCardCount,3);
  assert.equal(inst.getRow(MATCH).lobby_revision,original.lobby_revision+1);
  assert.equal(hasCommandDeck(inst.getRow(MATCH)),true);
  assert.equal(inst.store.initialize('A').code,'DECK_ALREADY_STARTED');
  assert.equal(inst.store.initialize('B').status,403);
}));

test('projections hide opponent and undealt cards, including legacy demo secrets',()=>fixture(({inst})=>{
  inst.store.initialize('A');
  const raw=JSON.parse(inst.getRow(MATCH).private_state).commandSession;
  const a=inst.store.view('A'), b=inst.store.view('B');
  assert.equal(a.you,'A');assert.equal(b.you,'B');
  assert.equal(a.revision,0);assert.equal(a.phase,'AWAIT_CARD');
  for(const secret of [...raw.hands.B,...raw.drawPile,'LEGACY_A_ONLY','LEGACY_B_ONLY','LEGACY_FUTURE']){
    assert.equal(JSON.stringify(a).includes(secret),false);
  }
  for(const secret of [...raw.hands.A,...raw.drawPile])assert.equal(JSON.stringify(b).includes(secret),false);
  assert.equal(Object.hasOwn(a,'drawPile'),false);
  assert.equal(inst.store.view('C'),null);
  a.yourHand.push('intrusion');assert.equal(inst.store.view('A').yourHand.includes('intrusion'),false);
}));

test('cannot play cards of another player, no state change on rejection',()=>fixture(({inst})=>{
  inst.store.initialize('A');
  const snapshot=JSON.parse(inst.getRow(MATCH).private_state);
  const secret=snapshot.commandSession.hands.B[0];
  const denied=inst.store.dispatch(command('A','play_synthetic_card',0,{cardRef:secret}));
  assert.equal(denied.status,400);assert.equal(denied.code,'CARD_NOT_IN_OWN_HAND');
  assert.equal(JSON.stringify(denied).includes(secret),false);
  assert.equal(inst.getRow(MATCH).game_revision,0);
}));

test('phase commands commit revision, event and key in one database transaction',()=>fixture(({inst})=>{
  inst.store.initialize('A');
  const a=inst.store.view('A');
  const played=apply(inst.store,'A','play_synthetic_card',0,{cardRef:a.yourHand[0]});
  assert.equal(played.revision,1);assert.equal(played.phase,'ASSIGN_ORDERS');
  assert.equal(inst.getRow(MATCH).game_revision,1);
  assert.equal(inst.db.prepare('SELECT count(*) n FROM game_events').get().n,1);
  assert.equal(inst.db.prepare('SELECT count(*) n FROM game_commands').get().n,1);
  assert.equal(inst.store.view('B').yourHand.length,3);
  const publicEvent=inst.db.prepare('SELECT payload FROM game_events').get().payload;
  const raw=JSON.parse(inst.getRow(MATCH).private_state).commandSession;
  for(const x of [...raw.hands.B,...raw.drawPile])assert.equal(publicEvent.includes(x),false);
}));

test('a different payload with the same idempotency key is rejected',()=>fixture(({inst})=>{
  inst.store.initialize('A');
  const cards=inst.store.view('A').yourHand;
  const key='shared_first_action';
  const first=inst.store.dispatch(command('A','play_synthetic_card',0,{cardRef:cards[0]},key));
  assert.equal(first.code,'APPLIED');
  const again=inst.store.dispatch(command('A','play_synthetic_card',0,{cardRef:cards[0]},key));
  assert.equal(again.code,'ALREADY_APPLIED');
  const mismatch=inst.store.dispatch(command('A','play_synthetic_card',0,{cardRef:cards[1]},key));
  assert.equal(mismatch.code,'IDEMPOTENCY_KEY_REUSED');
  assert.equal(inst.getRow(MATCH).game_revision,1);
}));

test('a stale revision and wrong actor do not execute, nor expose hand',()=>fixture(({inst})=>{
  inst.store.initialize('A');
  const view=inst.store.view('A');
  assert.equal(inst.store.dispatch(command('B','play_synthetic_card',0,{cardRef:view.yourHand[0]})).status,403);
  apply(inst.store,'A','play_synthetic_card',0,{cardRef:view.yourHand[0]});
  const stale=inst.store.dispatch(command('A','assign_synthetic_orders',0,{unitIds:[]}));
  assert.equal(stale.code,'STALE_REVISION');
  assert.equal(stale.view.you,'A');
  assert.equal(JSON.stringify(stale).includes(inst.store.view('B').yourHand[0]),false);
}));

test('cards persist across closing the DB and reopening with a different connection',()=>fixture(({inst,connect})=>{
  inst.store.initialize('A');
  const card=inst.store.view('A').yourHand[0];
  apply(inst.store,'A','play_synthetic_card',0,{cardRef:card});
  const second=connect();
  assert.equal(second.store.view('B').revision,1);
  assert.equal(second.store.view('A').cardInPlay,card);
  assert.equal(second.store.dispatch(command('A','play_synthetic_card',0,{cardRef:card},'another_request_001')).code,'STALE_REVISION');
  assert.equal(second.store.dispatch(command('A','play_synthetic_card',0,{cardRef:card},'idempotency_play_synthetic_card_0')).code,'ALREADY_APPLIED');
}));

test('updates made on two independent connections do not overwrite one another',()=>fixture(({inst,connect})=>{
  inst.store.initialize('A');
  const other=connect();
  const a=inst.store.view('A').yourHand[0];
  const one=inst.store.dispatch(command('A','play_synthetic_card',0,{cardRef:a},'req_alpha_001'));
  const two=other.store.dispatch(command('A','play_synthetic_card',0,{cardRef:a},'req_beta_0002'));
  assert.equal(one.status,200);assert.equal(two.status,409);
  assert.equal(other.store.view('B').revision,1);
}));

test('transaction rollback on event write failure preserves all private cards and key',()=>fixture(({inst})=>{
  inst.store.initialize('A');
  const before=inst.getRow(MATCH).private_state;
  inst.db.exec("CREATE TRIGGER fail_event BEFORE INSERT ON game_events BEGIN SELECT RAISE(ABORT, 'SIMULATED_DISK_ERROR'); END;");
  const card=inst.store.view('A').yourHand[0];
  assert.throws(()=>inst.store.dispatch(command('A','play_synthetic_card',0,{cardRef:card})),/SIMULATED_DISK_ERROR/);
  assert.equal(inst.getRow(MATCH).private_state,before);
  assert.equal(inst.getRow(MATCH).game_revision,0);
  assert.equal(inst.db.prepare('SELECT count(*) n FROM game_commands').get().n,0);
  inst.db.exec('DROP TRIGGER fail_event');
  assert.equal(inst.store.dispatch(command('A','play_synthetic_card',0,{cardRef:card})).status,200);
}));

test('pending defender decision is restored without giving attacker another action',()=>fixture(({inst,connect})=>{
  inst.store.initialize('A');
  const card=inst.store.view('A').yourHand[0];
  apply(inst.store,'A','play_synthetic_card',0,{cardRef:card});
  apply(inst.store,'A','assign_synthetic_orders',1,{unitIds:['unit_1']});
  apply(inst.store,'A','finish_synthetic_movement',2);
  apply(inst.store,'A','ask_synthetic_defense',3,{targetUnit:'unit_b'});
  const restarted=connect();
  assert.equal(restarted.store.view('B').actingSide,'B');
  assert.equal(restarted.store.view('B').turn,'A');
  assert.equal(restarted.store.dispatch(command('A','finish_synthetic_combat',4)).code,'NOT_ACTING_PLAYER');
  apply(restarted.store,'B','answer_synthetic_defense',4,{choice:'EVADE'});
  assert.equal(restarted.store.view('B').actingSide,'A');
  assert.equal(restarted.store.view('B').turn,'A');
}));

test('full turn discards public card and draws privately, game event cannot reveal top card',()=>fixture(({inst})=>{
  inst.store.initialize('A');
  const a=inst.store.view('A');
  const played=a.yourHand[0];
  apply(inst.store,'A','play_synthetic_card',0,{cardRef:played});
  apply(inst.store,'A','assign_synthetic_orders',1,{unitIds:[]});
  apply(inst.store,'A','finish_synthetic_movement',2);
  apply(inst.store,'A','finish_synthetic_combat',3);
  const hiddenBefore=JSON.parse(inst.getRow(MATCH).private_state).commandSession.drawPile.at(-1);
  apply(inst.store,'A','acknowledge_synthetic_draw',4);
  assert.equal(inst.store.view('B').turn,'B');
  assert.equal(inst.store.view('A').yourHand.includes(hiddenBefore),true);
  assert.equal(inst.store.view('B').yourHand.includes(hiddenBefore),false);
  assert.equal(inst.store.view('A').discardPile.includes(played),true);
  assert.equal(inst.store.view('A').drawPileCount,12);
  const allEvents=inst.db.prepare('SELECT payload FROM game_events').all().map(x=>x.payload).join('');
  assert.equal(allEvents.includes(hiddenBefore),false);
}));

test('new Node process can read persisted revision and private hands without raw deck leakage',()=>fixture(({inst,file})=>{
  inst.store.initialize('A');
  const card=inst.store.view('A').yourHand[0];
  apply(inst.store,'A','play_synthetic_card',0,{cardRef:card});
  const mod=new URL('./sqlite-game.mjs',import.meta.url).href;
  const script=`import {DatabaseSync} from 'node:sqlite';import {createSqliteCommandDeckStore} from ${JSON.stringify(mod)};
    const db=new DatabaseSync(process.argv[1]);const getRow=id=>db.prepare('SELECT * FROM matches WHERE id=?').get(id);
    const atomic=fn=>{db.exec('BEGIN IMMEDIATE');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}};
    const store=createSqliteCommandDeckStore({db,matchId:process.argv[2],getRow,atomic});
    const view=store.view('B'); console.log(JSON.stringify({revision:view.revision,turn:view.turn,cardCount:view.opponentCardCount}));db.close();`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script,file,MATCH],{encoding:'utf8',timeout:12000});
  assert.equal(child.status,0,child.stderr);
  assert.deepEqual(JSON.parse(child.stdout.trim()),{revision:1,turn:'A',cardCount:1});
}));

test('initialization is atomic: failed SQL update leaves no private deck',()=>fixture(({inst})=>{
  inst.db.exec("CREATE TRIGGER fail_setup BEFORE UPDATE ON matches BEGIN SELECT RAISE(ABORT, 'SETUP_IO_ERROR'); END;");
  assert.throws(()=>inst.store.initialize('A'),/SETUP_IO_ERROR/);
  assert.equal(hasCommandDeck(inst.getRow(MATCH)),false);
  assert.equal(inst.getRow(MATCH).lobby_revision,0);
  inst.db.exec('DROP TRIGGER fail_setup');
  assert.equal(inst.store.initialize('A').status,201);
}));

test('two connections cannot initialize the same match twice',()=>fixture(({inst,connect})=>{
  const another=connect();
  assert.equal(inst.store.initialize('A').status,201);
  assert.equal(another.store.initialize('A').code,'DECK_ALREADY_STARTED');
  assert.equal(inst.getRow(MATCH).lobby_revision,1);
}));

test('corrupt persisted card instances are rejected before any projection',()=>fixture(({inst})=>{
  inst.store.initialize('A');
  const state=JSON.parse(inst.getRow(MATCH).private_state);
  state.commandSession.hands.B[0]=state.commandSession.hands.A[0];
  inst.db.prepare('UPDATE matches SET private_state=? WHERE id=?').run(JSON.stringify(state),MATCH);
  assert.throws(()=>inst.store.view('A'),/CARD_CONSERVATION_FAILED/);
  assert.throws(()=>inst.store.dispatch(command('A','play_synthetic_card',0,{cardRef:state.commandSession.hands.A[0]})),/CARD_CONSERVATION_FAILED/);
  assert.equal(inst.getRow(MATCH).game_revision,0);
}));

test('idempotency signature includes ordered unit IDs, not merely command type',()=>fixture(({inst})=>{
  inst.store.initialize('A');
  const card=inst.store.view('A').yourHand[0];
  apply(inst.store,'A','play_synthetic_card',0,{cardRef:card});
  const key='same_orders_key_0001';
  const ok=inst.store.dispatch(command('A','assign_synthetic_orders',1,{unitIds:['alpha']},key));
  assert.equal(ok.status,200);
  const modified=inst.store.dispatch(command('A','assign_synthetic_orders',1,{unitIds:['beta']},key));
  assert.equal(modified.code,'IDEMPOTENCY_KEY_REUSED');
  assert.equal(inst.store.view('A').revision,2);
}));

test('unsupported legacy demo turn cannot bypass the deck phase reducer',()=>fixture(({inst})=>{
  inst.store.initialize('A');
  const response=inst.store.dispatch(command('A','pass_demo_turn',0));
  assert.equal(response.status,400);
  assert.equal(response.code,'INVALID_COMMAND');
  assert.equal(inst.getRow(MATCH).game_revision,0);
}));

test('separate matches isolate revisions, public events and private command decks',()=>fixture(({inst})=>{
  const otherId='223e4567-e89b-42d3-a456-426614174111';
  const next={...initial(),matchId:otherId};
  inst.db.prepare('INSERT INTO matches(id,owner_id,guest_id,private_state) VALUES (?,?,?,?)')
    .run(otherId,'account_A','account_B',JSON.stringify(next));
  const getRow=id=>inst.db.prepare('SELECT * FROM matches WHERE id=?').get(id);
  const atomic=fn=>{inst.db.exec('BEGIN IMMEDIATE');try{const result=fn();inst.db.exec('COMMIT');return result;}catch(e){inst.db.exec('ROLLBACK');throw e;}};
  const other=createSqliteCommandDeckStore({db:inst.db,matchId:otherId,getRow,atomic});
  assert.equal(inst.store.initialize('A').status,201);
  assert.equal(other.initialize('A').status,201);
  const card=inst.store.view('A').yourHand[0];
  apply(inst.store,'A','play_synthetic_card',0,{cardRef:card});
  assert.equal(inst.store.view('A').revision,1);
  assert.equal(other.view('A').revision,0);
  assert.equal(inst.db.prepare('SELECT count(*) n FROM game_events WHERE match_id=?').get(otherId).n,0);
  assert.equal(inst.db.prepare('SELECT count(*) n FROM game_commands WHERE match_id=?').get(otherId).n,0);
  assert.equal(other.view('A').yourHand.length,2);
}));
