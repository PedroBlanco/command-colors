import test from 'node:test';
import assert from 'node:assert/strict';
import {LOCAL_TEST_FILES} from './check-browser-lab.mjs';
import {CCWB_SECURITY_SUITES, validNodeVersion, parseValidationOptions,
  assertSecurityManifest, validateCcwHttp} from './validate-ccwb-http.mjs';

test('SEC-001: security validation includes the SQLite lobby and WAL revocation suites',()=>{
  assert.equal(CCWB_SECURITY_SUITES.length,12);
  assert.deepEqual(assertSecurityManifest(),CCWB_SECURITY_SUITES);
  for (const suite of ['packages/sqlite-store/sqlite.test.mjs',
    'packages/sqlite-store/wal-cross-process-revocation.test.mjs',
    'packages/sqlite-store/wal-transaction-contract.test.mjs',
    'packages/sqlite-store/section-mutation-session-guard.test.mjs'])
    assert.ok(CCWB_SECURITY_SUITES.includes(suite));
  assert.throws(()=>assertSecurityManifest(
    LOCAL_TEST_FILES.filter(p=>p!=='packages/sqlite-store/sqlite.test.mjs')),
    /SECURITY_SUITE_NOT_IN_MANIFEST/);
});

test('portable launcher enforces Node 22.16 minimum and strict CLI modes',()=>{
  for (const version of ['22.16.0','22.17.1','23.0.0','24.1.0'])
    assert.equal(validNodeVersion(version),true,version);
  for (const version of ['22.15.9','21.99.0','',null,'22.16','v22.16.0'])
    assert.equal(validNodeVersion(version),false,String(version));
  assert.deepEqual(parseValidationOptions([]),{fullRegression:false,list:false});
  assert.deepEqual(parseValidationOptions(['--full']),{fullRegression:true,list:false});
  assert.deepEqual(parseValidationOptions(['--list']),{fullRegression:false,list:true});
  for (const args of [['--full','--full'],['--full','--list'],['--only=anything'],
    ['--log=/tmp/external'],['--unknown']])
    assert.throws(()=>parseValidationOptions(args),/INVALID_OPTION/);
});

test('portable launcher runs security suites before full regression with separate TAP paths',async()=>{
  const calls=[];
  const runBatch=async options=>{
    calls.push(options);
    return {exitCode:0,suites:options.files.length,missing:[],
      sha256:'example-hash',logFile:options.logFile};
  };
  const result=await validateCcwHttp({
    fullRegression:true,rootDir:'/tmp/dry-run',version:'22.16.0',
    now:()=>new Date('2026-11-12T12:00:00.000Z'),pid:123,
    auditManifest:()=>({ok:true,discovered:72,declared:72,missing:[],unregistered:[]}),
    runBatch
  });
  assert.equal(result.exitCode,0);
  assert.equal(calls.length,2);
  assert.deepEqual(calls[0].files,CCWB_SECURITY_SUITES);
  assert.deepEqual(calls[1].files,LOCAL_TEST_FILES);
  assert.match(calls[0].logFile,/ccwb-security-20261112-120000[.]000-123[.]tap$/);
  assert.match(calls[1].logFile,/ccwb-full-20261112-120000[.]000-123[.]tap$/);
  assert.equal(result.results[1].type,'full');
});

test('portable launcher aborts full regression on failed or missing security suite',async()=>{
  for (const failure of [
    {exitCode:1,missing:[]},
    {exitCode:0,missing:['packages/sqlite-store/sqlite.test.mjs']}
  ]) {
    let calls=0;
    const result=await validateCcwHttp({
      fullRegression:true,version:'22.16.0',
      auditManifest:()=>({ok:true,discovered:72,declared:72,missing:[],unregistered:[]}),
      runBatch:async()=>{calls++;return failure;}
    });
    assert.equal(result.exitCode,failure.exitCode || 2);
    assert.equal(calls,1);
    assert.equal(result.results.length,1);
  }
});

test('portable launcher never starts tests with an unsupported Node version',async()=>{
  let called=false;
  const result=await validateCcwHttp({version:'22.15.9',
    runBatch:async()=>{called=true;throw new Error('must not run');}});
  assert.equal(result.exitCode,2);
  assert.equal(result.reason,'NODE_22_16_REQUIRED');
  assert.equal(called,false);
});


test('portable launcher blocks any test run when the manifest misses a repository suite',async()=>{
  let invoked=false;
  const inventory={ok:false,discovered:73,declared:72,missing:[],
    unregistered:['packages/future/unlisted.test.mjs']};
  const result=await validateCcwHttp({
    version:'22.16.0', fullRegression:true,
    auditManifest:()=>inventory,
    runBatch:async()=>{invoked=true;throw new Error('must not run');}
  });
  assert.equal(result.exitCode,2);
  assert.equal(result.reason,'TEST_MANIFEST_DRIFT');
  assert.deepEqual(result.inventory,inventory);
  assert.deepEqual(result.results,[]);
  assert.equal(invoked,false);
});
