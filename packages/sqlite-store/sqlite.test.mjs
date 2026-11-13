import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {openSqliteComposition} from './sqlite.mjs';

const PASSWORD = 'test-only-DO-NOT-USE-in-production-00000';
async function local(fn, options={}) {
  const dir = await mkdtemp(join(tmpdir(), 'ccw-sqlite-'));
  const file = join(dir,'data.sqlite');
  const instances=[];
  const open = more => {
    const service = openSqliteComposition({file,...options,...more});
    instances.push(service);
    return service;
  };
  try {return await fn(open, file);} finally {
    instances.reverse().forEach(x=>x.close());
    await rm(dir,{force:true,recursive:true});
  }
}
async function account(service, handle) {
  assert.equal((await service.identity.provisionAccount({handle,password:PASSWORD})).ok,true);
  const login=await service.identity.logIn({handle,password:PASSWORD});
  assert.equal(login.ok,true);
  return login.token;
}
function invite(s, a, b, targetHandle='bob') {
  const created=s.invitations.createMatch({sessionToken:a});
  assert.equal(created.ok,true);
  const matchId=created.matchId;
  const i=s.invitations.issueInvitation({sessionToken:a,matchId,targetHandle});
  assert.equal(i.ok,true);
  const joined=s.invitations.acceptInvitation({sessionToken:b,invitationToken:i.token});
  assert.equal(joined.ok,true);
  return matchId;
}
const cmd=(actor,revision,key)=>({actor,type:'pass_demo_turn',expectedRevision:revision,idempotencyKey:key});

test('SQLite: identities and sessions survive a close and reopen',()=>local(async open=>{
 const first=open();const alice=await account(first,'alice');
 const user=first.identity.resolveSession(alice);
 assert.equal(user.handle,'alice');
 first.close(); // close explicitly, remove from auto-cleanup by reopening? handled separately
 const second=open();
 assert.deepEqual(second.identity.resolveSession(alice),user);
 assert.equal((await second.identity.logIn({handle:'alice',password:'wrong-password-1234'})).code,'INVALID_CREDENTIALS');
 const b=await second.identity.logIn({handle:'alice',password:PASSWORD});
 assert.ok(b.token);assert.notEqual(b.token,alice);
}));

test('SQLite: invitations, join and match access remain persistent',()=>local(async open=>{
 const a=open();const alice=await account(a,'alice'),bob=await account(a,'bob'),eve=await account(a,'eve');
 const created=a.invitations.createMatch({sessionToken:alice});
 const i=a.invitations.issueInvitation({sessionToken:alice,matchId:created.matchId,targetHandle:'bob'});
 assert.equal(a.invitations.getMatch({sessionToken:eve,matchId:created.matchId}).code,'NOT_FOUND');
 assert.equal(a.invitations.acceptInvitation({sessionToken:eve,invitationToken:i.token}).code,'INVITATION_NOT_AVAILABLE');
 a.close();
 const b=open();
 assert.equal(b.invitations.acceptInvitation({sessionToken:bob,invitationToken:i.token}).ok,true);
 assert.equal(b.invitations.acceptInvitation({sessionToken:bob,invitationToken:i.token}).code,'INVITATION_NOT_AVAILABLE');
 assert.equal(b.invitations.getMatch({sessionToken:alice,matchId:created.matchId}).status,'READY');
 assert.equal(b.invitations.getMatch({sessionToken:eve,matchId:created.matchId}).code,'NOT_FOUND');
}));

test('SQLite: tokens and passwords never stored in plaintext',()=>local(async(open)=>{
 const s=open();const a=await account(s,'alice'),b=await account(s,'bob');
 const m=s.invitations.createMatch({sessionToken:a});
 const token=s.invitations.issueInvitation({sessionToken:a,matchId:m.matchId,targetHandle:'bob'}).token;
 const db=s.unsafeTestDatabase();
 assert.equal(db.prepare('SELECT count(*) as count FROM sessions WHERE token_digest=?').get(a).count,0);
 assert.equal(db.prepare('SELECT count(*) as count FROM invitations WHERE token_digest=?').get(token).count,0);
 assert.equal(db.prepare('SELECT count(*) as count FROM accounts WHERE password_hash=?').get(PASSWORD).count,0);
 assert.ok(b.length>=40);
}));

test('SQLite: separate matches isolate private hands, events and revisions',()=>local(async open=>{
 const s=open(),a=await account(s,'alice'),b=await account(s,'bob');
 const one=invite(s,a,b),two=invite(s,a,b);
 const game1=s.getStore(one),game2=s.getStore(two);
 assert.equal(game1.view('A').matchId,one);
 assert.equal(game2.view('A').matchId,two);
 assert.equal(JSON.stringify(game1.view('A')).includes('PRIVATE_B_'),false);
 assert.equal(JSON.stringify(game1.view('B')).includes('PRIVATE_A_'),false);
 assert.equal(JSON.stringify(game1.view('A')).includes('HIDDEN_FUTURE_CARD'),false);
 assert.equal((await game1.dispatch(cmd('A',0,'first_turn_0001'))).code,'APPLIED');
 assert.equal(game1.view('B').revision,1);
 assert.equal(game2.view('B').revision,0);
 assert.equal(game1.publicEvents('B').length,1);
 assert.equal(game2.publicEvents('B').length,0);
}));

test('SQLite: durable idempotency and history after process restart',()=>local(async open=>{
 const s=open(),a=await account(s,'alice'),b=await account(s,'bob');
 const matchId=invite(s,a,b);
 const g=s.getStore(matchId);
 assert.equal((await g.dispatch(cmd('A',0,'replay_key_0001'))).code,'APPLIED');
 s.close();
 const restarted=open(),r=restarted.getStore(matchId);
 assert.equal(r.view('B').revision,1);
 assert.equal(r.view('B').turn,'B');
 assert.equal(r.publicEvents('A').length,1);
 assert.equal((await r.dispatch(cmd('A',0,'replay_key_0001'))).code,'ALREADY_APPLIED');
 assert.equal((await r.dispatch(cmd('A',1,'replay_key_0001'))).code,'IDEMPOTENCY_KEY_REUSED');
 assert.equal((await r.dispatch(cmd('B',1,'follow_on_0001'))).code,'APPLIED');
 assert.equal(r.view('A').revision,2);
}));

test('SQLite: two connections serialize update conflicts for same revision',()=>local(async open=>{
 const x=open(),a=await account(x,'alice'),b=await account(x,'bob'),id=invite(x,a,b);
 const y=open();
 const [r1,r2]=await Promise.all([
   x.getStore(id).dispatch(cmd('A',0,'simultaneous_x')),
   y.getStore(id).dispatch(cmd('A',0,'simultaneous_y'))
 ]);
 assert.deepEqual([r1.status,r2.status].sort(),[200,409]);
 assert.equal(x.getStore(id).view('B').revision,1);
 assert.equal(y.getStore(id).publicEvents('A').length,1);
 assert.equal(y.getStore(id).view('A').turn,'B');
}));

test('SQLite: rollback on event write failure leaves state and key unchanged',()=>local(async open=>{
 const s=open(),a=await account(s,'alice'),b=await account(s,'bob'),id=invite(s,a,b);
 const db=s.unsafeTestDatabase();
 db.exec("CREATE TRIGGER break_event BEFORE INSERT ON game_events BEGIN SELECT RAISE(ABORT, 'SIMULATED_IO_ERROR'); END;");
 await assert.rejects(s.getStore(id).dispatch(cmd('A',0,'fail_first_0001')),/SIMULATED_IO_ERROR/);
 assert.equal(s.getStore(id).view('A').revision,0);
 assert.equal(s.getStore(id).publicEvents('A').length,0);
 assert.equal(db.prepare('SELECT count(*) AS c FROM game_commands WHERE match_id=?').get(id).c,0);
 db.exec('DROP TRIGGER break_event');
 assert.equal((await s.getStore(id).dispatch(cmd('A',0,'fail_first_0001'))).code,'APPLIED');
}));

test('SQLite: concurrent invitation acceptance keeps one guest',()=>local(async open=>{
 const s=open(),a=await account(s,'alice'),b=await account(s,'bob'),c=await account(s,'carol');
 const id=s.invitations.createMatch({sessionToken:a}).matchId;
 const bInvite=s.invitations.issueInvitation({sessionToken:a,matchId:id,targetHandle:'bob'});
 const cInvite=s.invitations.issueInvitation({sessionToken:a,matchId:id,targetHandle:'carol'});
 const t=open();
 const [rb,rc]=await Promise.all([
  Promise.resolve().then(()=>s.invitations.acceptInvitation({sessionToken:b,invitationToken:bInvite.token})),
  Promise.resolve().then(()=>t.invitations.acceptInvitation({sessionToken:c,invitationToken:cInvite.token}))
 ]);
 assert.deepEqual([rb.ok,rc.ok].sort(),[false,true]);
 assert.equal(s.invitations.getMatch({sessionToken:a,matchId:id}).players.length,2);
}));

test('SQLite: session expiry and invitation deadline are strict',()=>local(async open=>{
 let now=1000;
 const s=open({clock:()=>now,sessionTtlMs:2000,invitationTtlMs:1000});
 const a=await account(s,'alice'),b=await account(s,'bob');
 const id=s.invitations.createMatch({sessionToken:a}).matchId;
 const invitation=s.invitations.issueInvitation({sessionToken:a,matchId:id,targetHandle:'bob'});
 now=2000;
 assert.equal(s.invitations.acceptInvitation({sessionToken:b,invitationToken:invitation.token}).code,'INVITATION_NOT_AVAILABLE');
 now=3000;
 assert.equal(s.identity.resolveSession(a),null);
 assert.equal(s.invitations.getMatch({sessionToken:a,matchId:id}).code,'UNAUTHENTICATED');
}));


test('SQLite: a fresh Node.js process reads durable game state from disk',()=>local(async (open,file)=>{
 const s=open(),a=await account(s,'alice'),b=await account(s,'bob');
 const id=invite(s,a,b);
 assert.equal((await s.getStore(id).dispatch(cmd('A',0,'fresh_process_01'))).code,'APPLIED');
 s.close();
 const moduleUrl=new URL('./sqlite.mjs',import.meta.url).href;
 const script=`import {openSqliteComposition} from ${JSON.stringify(moduleUrl)};
   const s=openSqliteComposition({file:process.argv[1]});
   const view=s.getStore(process.argv[2]).view('B');
   const events=s.getStore(process.argv[2]).publicEvents('A');
   console.log(JSON.stringify({revision:view.revision,turn:view.turn,eventCount:events.length}));
   s.close();`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',script,file,id],{encoding:'utf8',timeout:12000});
 assert.equal(child.status,0,child.stderr);
 assert.deepEqual(JSON.parse(child.stdout.trim()),{revision:1,turn:'B',eventCount:1});
}));

test('SEC-001: lobby read keeps session, membership and players in one closed WAL snapshot',()=>local(async open=>{
  const first=open(),alice=await account(first,'alice'),bob=await account(first,'bob');
  const id=invite(first,alice,bob);
  const second=open();
  const initial=first.invitations.getMatch({sessionToken:bob,matchId:id});
  assert.equal(initial.ok,true);
  assert.equal(initial.status,'READY');
  assert.deepEqual(initial.players.map(p=>p.side),['A','B']);
  assert.equal(first.unsafeTestDatabase().isTransaction,false);
  // A committed change on a second connection must be visible to the
  // next snapshot: never publish stale membership or a stale participant list.
  second.unsafeTestDatabase().prepare('UPDATE matches SET guest_id=NULL, lobby_revision=lobby_revision+1 WHERE id=?').run(id);
  assert.deepEqual(first.invitations.getMatch({sessionToken:bob,matchId:id}),
    {ok:false,code:'NOT_FOUND'});
  const owner=first.invitations.getMatch({sessionToken:alice,matchId:id});
  assert.equal(owner.status,'INVITING');
  assert.deepEqual(owner.players.map(p=>p.side),['A']);
  assert.equal(first.unsafeTestDatabase().isTransaction,false);
}));

test('SEC-001: lobby read denies session revoked by a second WAL connection',()=>local(async open=>{
  const first=open(),alice=await account(first,'alice'),bob=await account(first,'bob');
  const id=invite(first,alice,bob),other=open();
  assert.equal(first.invitations.getMatch({sessionToken:alice,matchId:id}).status,'READY');
  other.identity.logOut(alice);
  assert.deepEqual(first.invitations.getMatch({sessionToken:alice,matchId:id}),
    {ok:false,code:'UNAUTHENTICATED'});
  assert.equal(first.invitations.getMatch({sessionToken:bob,matchId:id}).ok,true);
  // Keep 401 precedence even when the requested match ID is malformed.
  assert.deepEqual(first.invitations.getMatch({sessionToken:'invalid',matchId:'invalid'}),
    {ok:false,code:'UNAUTHENTICATED'});
  assert.equal(first.unsafeTestDatabase().isTransaction,false);
}));


test('SEC-001: all match and invitation mutations validate session under writer transaction',()=>local(async open=>{
  let enforce=false,db;
  const service=open({clock:()=>{
    if(enforce)assert.equal(db.isTransaction,true,'session must be checked after BEGIN IMMEDIATE');
    return Date.now();
  }});
  db=service.unsafeTestDatabase();
  const alice=await account(service,'alice'),bob=await account(service,'bob'),
    charlie=await account(service,'charlie');
  enforce=true;
  const joinedMatch=service.invitations.createMatch({sessionToken:alice});
  assert.equal(joinedMatch.ok,true);
  const inviteBob=service.invitations.issueInvitation({
    sessionToken:alice,matchId:joinedMatch.matchId,targetHandle:'bob'
  });
  assert.equal(inviteBob.ok,true);
  const joined=service.invitations.acceptInvitation({
    sessionToken:bob,invitationToken:inviteBob.token
  });
  assert.equal(joined.ok,true);
  const rejectMatch=service.invitations.createMatch({sessionToken:alice});
  const inviteToReject=service.invitations.issueInvitation({
    sessionToken:alice,matchId:rejectMatch.matchId,targetHandle:'charlie'
  });
  assert.equal(service.invitations.rejectInvitation({
    sessionToken:charlie,invitationToken:inviteToReject.token
  }).ok,true);
  const revokeMatch=service.invitations.createMatch({sessionToken:alice});
  const inviteToRevoke=service.invitations.issueInvitation({
    sessionToken:alice,matchId:revokeMatch.matchId,targetHandle:'charlie'
  });
  assert.equal(service.invitations.revokeInvitation({
    sessionToken:alice,matchId:revokeMatch.matchId,invitationId:inviteToRevoke.invitationId
  }).ok,true);
  assert.equal(db.isTransaction,false);
  const statuses=db.prepare('SELECT status FROM invitations ORDER BY rowid').all()
    .map(row=>row.status);
  assert.deepEqual(statuses,['ACCEPTED','REJECTED','REVOKED']);
}));

test('SEC-001: committed cross-connection logout prevents all invitation and match writes',()=>local(async open=>{
  const first=open(),alice=await account(first,'alice'),bob=await account(first,'bob'),
    charlie=await account(first,'charlie');
  const joinMatch=first.invitations.createMatch({sessionToken:alice}).matchId;
  const join=first.invitations.issueInvitation({
    sessionToken:alice,matchId:joinMatch,targetHandle:'bob'
  });
  const rejectMatch=first.invitations.createMatch({sessionToken:alice}).matchId;
  const reject=first.invitations.issueInvitation({
    sessionToken:alice,matchId:rejectMatch,targetHandle:'bob'
  });
  const revokeMatch=first.invitations.createMatch({sessionToken:alice}).matchId;
  const revoke=first.invitations.issueInvitation({
    sessionToken:alice,matchId:revokeMatch,targetHandle:'charlie'
  });
  const db=first.unsafeTestDatabase(),other=open();
  const count=table=>db.prepare('SELECT count(*) AS n FROM '+table).get().n;
  const before={matches:count('matches'),invitations:count('invitations')};
  other.identity.logOut(alice);
  other.identity.logOut(bob);
  assert.equal(first.invitations.createMatch({sessionToken:alice}).code,'UNAUTHENTICATED');
  assert.equal(first.invitations.issueInvitation({
    sessionToken:alice,matchId:joinMatch,targetHandle:'charlie'
  }).code,'UNAUTHENTICATED');
  assert.equal(first.invitations.revokeInvitation({
    sessionToken:alice,matchId:revokeMatch,invitationId:revoke.invitationId
  }).code,'UNAUTHENTICATED');
  assert.equal(first.invitations.acceptInvitation({
    sessionToken:bob,invitationToken:join.token
  }).code,'UNAUTHENTICATED');
  assert.equal(first.invitations.rejectInvitation({
    sessionToken:bob,invitationToken:reject.token
  }).code,'UNAUTHENTICATED');
  assert.deepEqual({matches:count('matches'),invitations:count('invitations')},before);
  assert.equal(db.prepare("SELECT count(*) AS n FROM invitations WHERE status!='PENDING'").get().n,0);
  assert.equal(first.invitations.getMatch({sessionToken:charlie,matchId:joinMatch}).code,
    'NOT_FOUND');
  assert.equal(db.isTransaction,false);
}));


test('new synthetic matches deploy A and B along opposite long edges, regardless of owner handle',()=>local(async open=>{
  const s=open(),alice=await account(s,'alice'),bob=await account(s,'bob');
  for(const [owner,guest,handle] of [
    [alice,bob,'bob'],[bob,alice,'alice']
  ]){
    const matchId=invite(s,owner,guest,handle);
    const a=s.getStore(matchId).view('A');
    const b=s.getStore(matchId).view('B');
    assert.equal(a.board.length,2);
    assert.deepEqual(a.board,b.board);
    assert.ok(a.board.find(unit=>unit.side==='A').row >
              a.board.find(unit=>unit.side==='B').row);
    assert.deepEqual(a.board,[
      {id:'synthetic-a',side:'A',col:3,row:6},
      {id:'synthetic-b',side:'B',col:9,row:2}
    ]);
    assert.equal(s.invitations.getMatch({sessionToken:owner,matchId}).players[0].side,'A');
    assert.equal(s.invitations.getMatch({sessionToken:guest,matchId}).players[1].side,'B');
  }
}));


test('previously saved landscape lab match is preserved without silent board migration',()=>local(async open=>{
  const s=open(),alice=await account(s,'alice'),bob=await account(s,'bob');
  const matchId=invite(s,alice,bob);
  const db=s.unsafeTestDatabase();
  const existing=db.prepare('SELECT private_state FROM matches WHERE id=?').get(matchId);
  const state=JSON.parse(existing.private_state);
  const olderBoard=[
    {id:'synthetic-a',side:'A',col:3,row:4},
    {id:'synthetic-b',side:'B',col:9,row:4}
  ];
  state.board=olderBoard;
  db.prepare('UPDATE matches SET private_state=? WHERE id=?')
    .run(JSON.stringify(state),matchId);
  s.close();
  const reopened=open();
  assert.deepEqual(reopened.getStore(matchId).view('A').board,olderBoard);
  assert.deepEqual(reopened.getStore(matchId).view('B').board,olderBoard);
  assert.equal(reopened.invitations.getMatch({sessionToken:alice,matchId}).status,'READY');
}));
