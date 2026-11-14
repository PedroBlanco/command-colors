import test from 'node:test';
import assert from 'node:assert/strict';
import {ANCIENTS_RULESET} from './movement-profile.mjs';
import {
  OPEN_FOOT_PATH_CORE_KIND,OPEN_FOOT_PATH_CORE_POLICY,
  replayCoreOpenFootPaths
} from './core-open-foot-path-v2.mjs';
import {
  FOOT_PATH_AUDIT_KIND,auditCoreOpenFootPathReplay as audit
} from './foot-path-v2-replay-audit.mjs';

const cell=(col,row)=>({col,row});
const state=()=>({
  kind:OPEN_FOOT_PATH_CORE_KIND,schemaVersion:2,ruleset:ANCIENTS_RULESET,
  revision:2,turn:'A',phase:'MOVE',
  board:{units:[
    {id:'unitA',side:'A',col:2,row:4},
    {id:'reserve',side:'A',col:2,row:6},
    {id:'enemy',side:'B',col:10,row:4}
  ],leaders:[]},
  orderLedger:{issuedUnitIds:['unitA','reserve'],movedUnitIds:[]}
});
const policy=()=>({
  scope:OPEN_FOOT_PATH_CORE_POLICY,ruleset:ANCIENTS_RULESET,
  cardFamily:'ORDINARY_SECTION',terrain:[],scenarioExceptions:[],
  unitTypes:{unitA:'LIGHT_INFANTRY',reserve:'MEDIUM_INFANTRY',
    enemy:'HEAVY_INFANTRY'}
});
const command=(unitId='unitA',revision=2,path=[cell(3,4),cell(4,4)])=>({
  actor:'A',expectedRevision:revision,unitId,path
});
const prepare=(actions=[command()])=>{
  const trustedInitialState=state(),trustedPolicy=policy();
  const replay=replayCoreOpenFootPaths({
    initialState:trustedInitialState,policy:trustedPolicy,actions
  });
  assert.equal(replay.status,'RULE_PATH_REPLAY_CANDIDATE');
  return {
    trustedInitialState,trustedPolicy,
    trustedRowRevision:replay.nextState.revision,
    actions,proposedState:replay.nextState,
    proposedTransitions:replay.transitions
  };
};
const denied=(r,reason,step=null)=>{
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.reason,reason);
  assert.equal(r.step,step);
  assert.equal(r.replayedState,null);
  assert.equal(r.transitionCount,null);
  assert.equal(r.canCommit,false);
  assert.equal(r.dbChanged,false);
};
const guarded=r=>{
  assert.equal(r.movementAuthorized,false);
  assert.equal(r.officialMovementAuthorized,false);
  assert.equal(r.canCommit,false);
  assert.equal(r.dbChanged,false);
  assert.equal(r.needsServerTransaction,true);
};

test('V2 audit: one complete two-hex action matches independent replay',()=>{
  const args=prepare(),before=structuredClone(args);
  const r=audit(args);
  assert.equal(r.status,'PRIVATE_PATH_REPLAY_AUDIT_CANDIDATE');
  assert.equal(r.kind,FOOT_PATH_AUDIT_KIND);
  assert.equal(r.transitionCount,1);
  assert.equal(r.replayedState.revision,3);
  assert.deepEqual(r.replayedState.board.units[0],
    {id:'unitA',side:'A',col:4,row:4});
  assert.deepEqual(args,before);
  assert.equal(Object.isFrozen(r.replayedState.board.units[0]),true);
  guarded(r);
});

test('V2 audit: two different ordered units replay with two revisions',()=>{
  const actions=[command(),command('reserve',3,[cell(3,6)])];
  const r=audit(prepare(actions));
  assert.equal(r.status,'PRIVATE_PATH_REPLAY_AUDIT_CANDIDATE');
  assert.equal(r.transitionCount,2);
  assert.equal(r.replayedState.revision,4);
  assert.deepEqual(r.replayedState.orderLedger.movedUnitIds,
    ['unitA','reserve']);
  guarded(r);
});

test('V2 audit: empty sequence is a valid consistency check, not a move',()=>{
  const r=audit(prepare([]));
  assert.equal(r.status,'PRIVATE_PATH_REPLAY_AUDIT_CANDIDATE');
  assert.equal(r.transitionCount,0);
  assert.equal(r.replayedState.revision,2);
  guarded(r);
});

test('V2 audit: stale trusted row revision blocks a matching proposal',()=>{
  const args=prepare();args.trustedRowRevision=2;
  denied(audit(args),'PATH_AUDIT_ROW_REVISION_DRIFT');
});

test('V2 audit: state coordinate or moved ledger drift blocks',()=>{
  for(const mutate of [
    x=>x.proposedState.board.units[0].col=5,
    x=>x.proposedState.orderLedger.movedUnitIds=[],
    x=>x.proposedState.revision=4
  ]){
    const args=structuredClone(prepare());
    mutate(args);
    denied(audit(args),'PATH_AUDIT_STATE_DRIFT');
  }
});

test('V2 audit: transition path, battle and side drift blocks',()=>{
  for(const mutate of [
    x=>x.proposedTransitions[0].path[1].col=5,
    x=>x.proposedTransitions[0].battleAfterMovement='UNAVAILABLE',
    x=>x.proposedTransitions[0].side='B',
    x=>x.proposedTransitions[0].kind='ANCIENTS_MOVEMENT_COMMITTED_V1'
  ]){
    const args=structuredClone(prepare());mutate(args);
    denied(audit(args),'PATH_AUDIT_TRANSITION_DRIFT',0);
  }
});

test('V2 audit: transition count must equal action count',()=>{
  const args=structuredClone(prepare());
  args.proposedTransitions=[];
  denied(audit(args),'INVALID_PATH_AUDIT_SCOPE');
});

test('V2 audit: missing independently sourced anchor or injected authority blocks',()=>{
  for(const mutate of [
    x=>delete x.trustedPolicy,
    x=>delete x.trustedRowRevision,
    x=>x.canCommit=true,
    x=>x.clientSignature='UNTRUSTED',
    x=>x.trustedRowRevision='3'
  ]){
    const args=structuredClone(prepare());mutate(args);
    denied(audit(args),'INVALID_PATH_AUDIT_SCOPE');
  }
});

test('V2 audit: invalid actions and duplicate movement have no partial result',()=>{
  const args=structuredClone(prepare([
    command(),command('reserve',3,[cell(3,6)])
  ]));
  args.actions[1]=command('unitA',3,[cell(5,4)]);
  denied(audit(args),'UNIT_ALREADY_MOVED',1);
});

test('V2 audit: tampered trusted policy fails replay, not a proof of authority',()=>{
  const args=prepare();args.trustedPolicy.unitTypes.unitA='ELEPHANT';
  denied(audit(args),'UNSUPPORTED_FOOT_UNIT',0);
});

test('V2 audit: V1 journal state cannot be substituted for V2',()=>{
  const args=prepare();
  args.trustedInitialState.kind='ANCIENTS_OPEN_FOOT_MOVEMENT_CORE_V1';
  args.trustedInitialState.schemaVersion=1;
  denied(audit(args),'INVALID_PATH_CORE_SCOPE');
});

test('V2 audit: JSON round trip retains deterministic comparison',()=>{
  const args=JSON.parse(JSON.stringify(prepare()));
  const first=audit(args),second=audit(args);
  assert.equal(first.status,'PRIVATE_PATH_REPLAY_AUDIT_CANDIDATE');
  assert.deepEqual(first,second);
  guarded(first);
});

test('V2 audit: root and nested getter are never invoked',()=>{
  const hits=[],root=prepare();
  Object.defineProperty(root,'trustedPolicy',{
    enumerable:true,get(){hits.push('GET');throw Error('GETTER')}
  });
  denied(audit(root),'INVALID_PATH_AUDIT_INPUT');
  const nested=prepare();
  Object.defineProperty(nested.actions[0],'path',{
    enumerable:true,get(){hits.push('NESTED');throw Error('GETTER')}
  });
  denied(audit(nested),'INVALID_PATH_AUDIT_INPUT');
  assert.deepEqual(hits,[]);
});

test('V2 audit: Proxy get trap never invoked for trusted snapshots',()=>{
  const hits=[],args=prepare();
  const p=new Proxy(args,{
    get(){hits.push('GET');throw Error('PROXY_GET')}
  });
  const r=audit(p);
  assert.equal(r.status,'PRIVATE_PATH_REPLAY_AUDIT_CANDIDATE');
  assert.deepEqual(hits,[]);
});

test('V2 audit: cycles, sparse actions and extra array attributes block',()=>{
  const cycle=prepare();cycle.cycle=cycle;
  denied(audit(cycle),'INVALID_PATH_AUDIT_INPUT');
  const sparse=prepare();sparse.actions=new Array(1);
  denied(audit(sparse),'INVALID_PATH_AUDIT_INPUT');
  const extra=prepare();extra.actions.extra=true;
  denied(audit(extra),'INVALID_PATH_AUDIT_INPUT');
});

test('V2 audit: candidate is detached and deeply frozen',()=>{
  const args=structuredClone(prepare()),r=audit(args);
  args.proposedState.board.units[0].col=8;
  args.proposedTransitions[0].path[1].col=8;
  assert.equal(r.replayedState.board.units[0].col,4);
  assert.equal(Object.isFrozen(r.replayedState),true);
  assert.equal(Object.isFrozen(r.replayedState.board),true);
  assert.equal(Object.isFrozen(r.replayedState.board.units),true);
  guarded(r);
});
