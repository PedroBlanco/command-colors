import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkLocalLab} from './check-browser-lab.mjs';

test('diagnóstico es de solo lectura, no crea base ni directorios', async() => {
 const root=await mkdtemp(join(tmpdir(), 'ccw-preflight-'));
 try {
   const result=await checkLocalLab({rootDir:root,checkPort:async()=>true,portValue:'8788',sqliteCheck:false});
   assert.equal(result.ok,false);
   assert.ok(result.failures.some(x=>x.includes('Faltan')));
   assert.ok(result.warnings.some(x=>x.includes('No existe base')));
   assert.equal(result.tests,35);
 } finally {await rm(root,{recursive:true,force:true});}
});

test('diagnóstico rechaza puerto ocupado y puerto inseguro', async()=>{
 const root=await mkdtemp(join(tmpdir(),'ccw-port-'));
 try {
   const busy=await checkLocalLab({rootDir:root,checkPort:async()=>false,sqliteCheck:false});
   assert.ok(busy.failures.some(x=>x.includes('ocupado')));
   const invalid=await checkLocalLab({rootDir:root,portValue:'80',checkPort:async()=>true,sqliteCheck:false});
   assert.ok(invalid.failures.some(x=>x.includes('1024')));
 }finally{await rm(root,{recursive:true,force:true});}
});

import {readFile, writeFile, mkdir, symlink} from 'node:fs/promises';
import {parseArgs, selectTests, runTestBatch, validateLogFileTarget} from './run-test-suite.mjs';

const good = 'example/good.test.mjs', bad = 'example/bad.test.mjs';
async function runnerLab(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'ccw-test-batch-'));
  try {return await fn(dir);} finally {await rm(dir, {recursive:true,force:true});}
}
const runnerFixture = async (dir, fail = false) => {
  const file = join(dir, 'example', fail ? 'bad.test.mjs' : 'good.test.mjs');
  await mkdir(join(dir,'example'),{recursive:true});
  await writeFile(file, "import test from 'node:test';import assert from 'node:assert/strict';test('minimal',()=>assert.equal(1," + (fail ? '2' : '1') + "));\n");
};

test('suite selection only permits allowlisted names and forbids duplicates',()=>{
 assert.deepEqual(selectTests([good,bad],null),[good,bad]);
 assert.deepEqual(selectTests([good,bad],good),[good]);
 for (const name of ['other.test.mjs',`${good},${good}`,''])
   assert.throws(()=>selectTests([good,bad],name),TypeError);
});

test('CLI refuses duplicated/unknown flags without executing shell commands',()=>{
 assert.deepEqual(parseArgs(['--only='+good,'--log=local/results.tap']),{only:good,logFile:'local/results.tap',list:false});
 assert.throws(()=>parseArgs(['--what']),TypeError);
 assert.throws(()=>parseArgs(['--only='+good,'--only='+bad]),TypeError);
});

test('missing fixture fails closed without creating a test report',()=>runnerLab(async dir=>{
 const result=await runTestBatch({rootDir:dir,files:[good],logFile:'log.tap',forwardOutput:false});
 assert.equal(result.exitCode,2);assert.deepEqual(result.missing,[good]);
 await assert.rejects(readFile(join(dir,'log.tap')),{code:'ENOENT'});
}));

test('successful test is executed and verifiable log is never overwritten',()=>runnerLab(async dir=>{
 await runnerFixture(dir);
 const first=await runTestBatch({rootDir:dir,files:[good],logFile:'out/test.tap',forwardOutput:false});
 assert.equal(first.exitCode,0);assert.equal(first.suites,1);
 assert.match(first.sha256,/^[a-f0-9]{64}$/);
 const text=await readFile(first.logFile,'utf8');
 assert.match(text,/# pass 1/);assert.match(text,/# exitCode: 0/);
 await assert.rejects(runTestBatch({rootDir:dir,files:[good],logFile:'out/test.tap',forwardOutput:false}),{code:'EEXIST'});
}));

test('failed test preserves nonzero status and evidence for diagnosis',()=>runnerLab(async dir=>{
 await runnerFixture(dir,true);
 const result=await runTestBatch({rootDir:dir,files:[bad],logFile:'fail.tap',forwardOutput:false});
 assert.equal(result.exitCode,1);
 const text=await readFile(result.logFile,'utf8');
 assert.match(text,/# fail 1/);assert.match(text,/# exitCode: 1/);
}));

test('unsafe path or repeated test entries are rejected before launch',()=>runnerLab(async dir=>{
 for (const files of [[good,good],['../outside.test.mjs'],['/absolute.test.mjs'],[]])
   await assert.rejects(runTestBatch({rootDir:dir,files,forwardOutput:false}),TypeError);
}));

test('log de regresión rechaza ruta exterior y padre simbólico fuera del proyecto', async t => runnerLab(async dir => {
  await runnerFixture(dir);
  assert.throws(() => validateLogFileTarget(dir, '../escape.tap'), /LOG_MUST_BE_INSIDE_PROJECT/);
  assert.equal(validateLogFileTarget(dir, 'safe/subdir/test.tap'), join(dir, 'safe', 'subdir', 'test.tap'));
  const outside = await mkdtemp(join(tmpdir(), 'ccw-runner-external-'));
  try {
    try {
      await symlink(outside, join(dir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
        t.skip('Sin permiso para crear enlaces simbólicos en este sistema');
        return;
      }
      throw error;
    }
    await assert.rejects(
      runTestBatch({rootDir: dir, files: [good], logFile: 'linked/evidence.tap', forwardOutput: false}),
      /LOG_MUST_BE_INSIDE_PROJECT/
    );
    await assert.rejects(readFile(join(outside, 'evidence.tap')), {code: 'ENOENT'});
  } finally {
    await rm(outside, {recursive: true, force: true});
  }
}));
