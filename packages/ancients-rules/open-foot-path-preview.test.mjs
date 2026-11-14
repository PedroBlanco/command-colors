import test from 'node:test';
import assert from 'node:assert/strict';
import {ANCIENTS_RULESET} from './movement-profile.mjs';
import {
  assessOpenHexPathGeometry as pathGeometry
} from './movement-regimes.mjs';
import {
  OPEN_FOOT_PATH_PREVIEW_SCOPE,
  previewBaseOpenFootPath as preview
} from './open-foot-path-preview.mjs';

const cell=(col,row)=>({col,row});
const one=()=>[cell(3,4)];
const two=()=>[cell(3,4),cell(4,4)];
const occupied=()=>[
  {id:'unitA',side:'A',col:2,row:4},
  {id:'enemy',side:'B',col:10,row:4}
];
const input=(changes={})=>({
  scope:OPEN_FOOT_PATH_PREVIEW_SCOPE,
  ruleset:ANCIENTS_RULESET,
  unitType:'LIGHT_INFANTRY',
  cardFamily:'ORDINARY_SECTION',
  from:cell(2,4),
  path:two(),
  occupiedCells:occupied(),
  terrain:[],leaders:[],scenarioExceptions:[],
  ...changes
});
const geometry=(changes={})=>pathGeometry({
  from:cell(2,4),path:two(),occupiedCells:occupied(),...changes
});
const fail=(r,reason,step=null)=>{
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.reason,reason);
  assert.equal(r.step,step);
  assert.equal(r.destination,null);
  assert.equal(r.canCommit,false);
  assert.equal(r.movementAuthorized,false);
};
const noAuthority=r=>{
  assert.equal(r.movementAuthorized,false);
  assert.equal(r.canCommit,false);
  assert.equal(r.dbChanged,false);
  assert.equal(r.officialMovementAuthorized,false);
  assert.equal(r.needsFullLegalityCheck,true);
};

test('multihex geometry: a connected two-hex route returns a detached destination',()=>{
  const args={from:cell(2,4),path:two(),occupiedCells:occupied()};
  const before=structuredClone(args);
  const r=pathGeometry(args);
  assert.equal(r.status,'CANDIDATE_PATH_GEOMETRY');
  assert.equal(r.steps,2);
  assert.deepEqual(r.destination,cell(4,4));
  assert.equal(Object.isFrozen(r),true);
  assert.equal(Object.isFrozen(r.destination),true);
  assert.deepEqual(args,before);
  args.path[1].col=8;
  assert.deepEqual(r.destination,cell(4,4));
});

test('multihex geometry: one-hex route uses the same shared edge checker',()=>{
  const r=geometry({path:one()});
  assert.equal(r.status,'CANDIDATE_PATH_GEOMETRY');
  assert.equal(r.steps,1);
  assert.deepEqual(r.destination,cell(3,4));
  assert.equal(r.canCommit,false);
});

test('multihex geometry: an adjacent two-hex turn is not restricted to a straight line',()=>{
  const r=geometry({path:[cell(3,4),cell(2,5)]});
  assert.equal(r.status,'CANDIDATE_PATH_GEOMETRY');
  assert.deepEqual(r.destination,cell(2,5));
});

test('multihex geometry: all intermediate occupied hexes block before destination',()=>{
  const r=geometry({occupiedCells:[...occupied(),cell(3,4)]});
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.reason,'OCCUPIED_DESTINATION');
  assert.equal(r.step,0);
  assert.equal(r.destination,null);
});

test('multihex geometry: occupied final destination blocks with precise step index',()=>{
  const r=geometry({occupiedCells:[...occupied(),cell(4,4)]});
  assert.equal(r.reason,'OCCUPIED_DESTINATION');
  assert.equal(r.step,1);
  assert.equal(r.destination,null);
});

test('multihex geometry: a jump over an intermediate hex is never allowed',()=>{
  const r=geometry({path:[cell(4,4)]});
  assert.equal(r.reason,'NOT_ONE_ADJACENT_HEX');
  assert.equal(r.step,0);
});

test('multihex geometry: a later jump is rejected without exposing partial path',()=>{
  const r=geometry({path:[cell(3,4),cell(6,4)]});
  assert.equal(r.reason,'NOT_ONE_ADJACENT_HEX');
  assert.equal(r.step,1);
  assert.equal(r.destination,null);
});

test('multihex geometry: a repeated origin is rejected before evaluating occupancy',()=>{
  const r=geometry({path:[cell(3,4),cell(2,4)]});
  assert.equal(r.reason,'REPEATED_HEX');
  assert.equal(r.step,1);
});

test('multihex geometry: later repeated hex is rejected even if unoccupied',()=>{
  const r=geometry({path:[cell(3,4),cell(4,4),cell(3,4)]});
  assert.equal(r.reason,'REPEATED_HEX');
  assert.equal(r.step,2);
});

test('multihex geometry: out-of-bounds and fractional cells fail closed',()=>{
  for(const path of [[cell(3,4),cell(13,4)],
    [cell(3,4),cell(4,-1)], [cell(3,4),{col:4.2,row:4}]])
    fail(geometry({path}),'INVALID_PATH_GEOMETRY_INPUT');
});

test('multihex geometry: empty, oversized, sparse and extra-index paths fail',()=>{
  const sparse=new Array(2);sparse[0]=cell(3,4);
  const extended=two();extended.extra='client-controlled';
  for(const path of [[],new Array(33).fill(cell(2,4)),sparse,extended])
    fail(geometry({path}),'INVALID_PATH_GEOMETRY_INPUT');
});

test('multihex geometry: occupied list cannot contain accessor or sparse holes',()=>{
  const sparse=new Array(1);
  const getter=[cell(2,4)];
  let calls=0;
  Object.defineProperty(getter[0],'col',{
    enumerable:true,get(){calls++;throw Error('GETTER')}
  });
  fail(geometry({occupiedCells:sparse}),'INVALID_PATH_GEOMETRY_INPUT');
  fail(geometry({occupiedCells:getter}),'INVALID_PATH_GEOMETRY_INPUT');
  assert.equal(calls,0);
});

test('multihex geometry: root/path/coordinate Proxy get traps are never invoked',()=>{
  const hits=[];
  const coordinates=new Proxy(cell(3,4),{
    get(){hits.push('COORDINATE_GET');throw Error('PROXY_GET')}
  });
  const path=new Proxy([coordinates,cell(4,4)],{
    get(){hits.push('ARRAY_GET');throw Error('PROXY_GET')}
  });
  const input=new Proxy({from:cell(2,4),path,occupiedCells:occupied()},{
    get(){hits.push('ROOT_GET');throw Error('PROXY_GET')}
  });
  assert.equal(pathGeometry(input).status,'CANDIDATE_PATH_GEOMETRY');
  assert.deepEqual(hits,[]);
});

test('multihex geometry: a foreign client actor or proof is not part of input',()=>{
  for(const key of ['actor','movementAuthorized','candidateEvidence','signature']){
    const request={from:cell(2,4),path:two(),occupiedCells:occupied()};
    request[key]=true;
    fail(pathGeometry(request),'INVALID_PATH_GEOMETRY_INPUT');
  }
});

test('open foot preview: light infantry variants can move one or two clear hexes',()=>{
  for(const unitType of [
    'LIGHT_INFANTRY','LIGHT_SLING_INFANTRY','LIGHT_BOW_INFANTRY'
  ]){
    for(const path of [one(),two()]){
      const r=preview(input({unitType,path}));
      assert.equal(r.status,'OPEN_FOOT_PATH_CANDIDATE',unitType);
      assert.equal(r.steps,path.length);
      assert.equal(r.battleAfterMovement,'POSSIBLE');
      assert.deepEqual(r.destination,path.at(-1));
      noAuthority(r);
    }
  }
});

test('open foot preview: auxilia may move two hexes but not battle afterwards',()=>{
  const first=preview(input({unitType:'AUXILIA_INFANTRY',path:one()}));
  const second=preview(input({unitType:'AUXILIA_INFANTRY',path:two()}));
  assert.equal(first.status,'OPEN_FOOT_PATH_CANDIDATE');
  assert.equal(first.battleAfterMovement,'POSSIBLE');
  assert.equal(second.status,'OPEN_FOOT_PATH_CANDIDATE');
  assert.equal(second.battleAfterMovement,'UNAVAILABLE');
  noAuthority(second);
});

test('open foot preview: medium and heavy infantry are limited to one hex',()=>{
  for(const unitType of ['MEDIUM_INFANTRY','HEAVY_INFANTRY']){
    const first=preview(input({unitType,path:one()}));
    assert.equal(first.status,'OPEN_FOOT_PATH_CANDIDATE');
    assert.equal(first.battleAfterMovement,'POSSIBLE');
    fail(preview(input({unitType,path:two()})),
      'STANDARD_FOOT_MOVEMENT_EXCEEDED');
  }
});

test('open foot preview: a three-hex route exceeds all ordinary infantry profiles',()=>{
  const path=[...two(),cell(5,4)];
  for(const unitType of ['LIGHT_INFANTRY','AUXILIA_INFANTRY']){
    fail(preview(input({unitType,path})),
      'STANDARD_FOOT_MOVEMENT_EXCEEDED');
  }
});

test('open foot preview: warrior, cavalry, elephant, chariot and machine are not implicitly allowed',()=>{
  for(const unitType of [
    'WARRIOR_INFANTRY','HEAVY_WAR_MACHINE',
    'LIGHT_CAVALRY','MEDIUM_CAVALRY','HEAVY_CAVALRY',
    'ELEPHANT','HEAVY_CHARIOT','__proto__','UNKNOWN'
  ])fail(preview(input({unitType,path:one()})),'UNSUPPORTED_FOOT_UNIT');
});

test('open foot preview: special cards, leaders, terrain and scenario exceptions are excluded',()=>{
  for(const changes of [
    {cardFamily:'FIRST_STRIKE'},
    {leaders:[{id:'leaderA',side:'A',col:2,row:4}]},
    {terrain:[{kind:'HILL',col:12,row:8}]},
    {scenarioExceptions:['CUSTOM']},
    {leaders:new Array(1)},
    {terrain:null}
  ]){
    const r=preview(input(changes));
    assert.equal(r.status,'BLOCKED');
    assert.equal(r.canCommit,false);
  }
});

test('open foot preview: wrong ruleset, scope or extra authority fields fail closed',()=>{
  fail(preview(input({ruleset:'napoleonics'})),
    'UNSUPPORTED_FOOT_PATH_RULESET');
  fail(preview(input({scope:'OFFICIAL_ANY_SCENARIO'})),
    'UNSUPPORTED_FOOT_PATH_SCOPE');
  for(const extra of [{actor:'A'}, {sessionToken:'secret'},
    {board:{}}, {canCommit:true}, {cardPlayAuthorized:true}]){
    fail(preview(input(extra)),'INVALID_OPEN_FOOT_PATH_REQUEST');
  }
});

test('open foot preview: invalid geometry is never upgraded by an acceptable infantry profile',()=>{
  const r=preview(input({path:[cell(3,4),cell(7,4)]}));
  fail(r,'NOT_ONE_ADJACENT_HEX',1);
  const second=preview(input({
    path:two(),occupiedCells:[...occupied(),cell(4,4)]
  }));
  fail(second,'OCCUPIED_DESTINATION',1);
});

test('open foot preview: reads exact own data fields without executing getters',()=>{
  const request=input(),hits=[];
  Object.defineProperty(request,'unitType',{
    enumerable:true,get(){hits.push('GET');throw Error('HOSTILE_GETTER')}
  });
  fail(preview(request),'INVALID_OPEN_FOOT_PATH_REQUEST');
  const proxy=new Proxy(input(),{
    get(){hits.push('PROXY_GET');throw Error('PROXY_GET')}
  });
  assert.equal(preview(proxy).status,'OPEN_FOOT_PATH_CANDIDATE');
  assert.deepEqual(hits,[]);
});

test('open foot preview: source changes cannot change frozen candidate result',()=>{
  const request=input(),before=structuredClone(request);
  const candidate=preview(request);
  assert.equal(candidate.status,'OPEN_FOOT_PATH_CANDIDATE');
  request.path[1].col=9;
  request.occupiedCells.push(cell(4,4));
  assert.deepEqual(candidate.destination,cell(4,4));
  assert.equal(candidate.steps,2);
  assert.equal(Object.isFrozen(candidate),true);
  assert.equal(Object.isFrozen(candidate.destination),true);
  assert.equal(candidate.dbChanged,false);
  assert.equal(before.path[1].col,4);
});
