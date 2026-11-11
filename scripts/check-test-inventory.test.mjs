import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyTestInventory} from './check-test-inventory.mjs';

function withFiles(paths, action) {
  const dir=mkdtempSync(join(tmpdir(), 'ccw-inventory-'));
  try {
    for(const path of paths) {
      const file=join(dir,path);
      mkdirSync(join(file,'..'), {recursive:true});
      writeFileSync(file,"// test fixture\n");
    }
    for (const folder of ['packages','scripts','spikes']) mkdirSync(join(dir,folder),{recursive:true});
    return action(dir);
  } finally {rmSync(dir,{recursive:true,force:true});}
}
const manifest=['packages/a.test.mjs','scripts/b.test.mjs'];
const verify=(dir,extra={})=>verifyTestInventory({rootDir:dir,manifest,...extra});

test('inventory: exact, distinct paths pass without modifying the project',()=>withFiles(manifest,dir=>{
 const a=verify(dir), b=verify(dir);
 assert.equal(a.ok,true);assert.deepEqual(a,b);
 assert.equal(a.expected,2);assert.equal(a.actual,2);
}));
test('inventory: missing suite fails closed',()=>withFiles(['packages/a.test.mjs'],dir=>{
 const r=verify(dir);assert.equal(r.ok,false);
 assert.deepEqual(r.missing,['scripts/b.test.mjs']);
}));
test('inventory: unlisted suite fails closed',()=>withFiles([...manifest,'packages/new.test.mjs'],dir=>{
 const r=verify(dir);assert.equal(r.ok,false);
 assert.deepEqual(r.unlisted,['packages/new.test.mjs']);
}));
test('inventory: duplicate manifest entry fails',()=>withFiles(manifest,dir=>{
 const r=verify(dir,{manifest:[...manifest,manifest[0]]});
 assert.equal(r.ok,false);assert.deepEqual(r.duplicates,[manifest[0]]);
}));
test('inventory: traversal, absolute and non-test names are invalid',()=>withFiles(manifest,dir=>{
 const r=verify(dir,{manifest:[...manifest,'../escape.test.mjs','/tmp/x.test.mjs','test.js']});
 assert.equal(r.ok,false);assert.equal(r.invalid.length,3);
}));
test('inventory: symlinked test is neither followed nor considered a valid suite',t=>withFiles(manifest,dir=>{
 try {symlinkSync(join(dir,manifest[0]),join(dir,'packages','alias.test.mjs'));}
 catch(e){if(['EPERM','EACCES','ENOTSUP'].includes(e.code)){t.skip();return;}throw e;}
 const r=verify(dir);assert.equal(r.ok,false);
 assert.deepEqual(r.links,['packages/alias.test.mjs']);
}));
test('inventory: absence of a scan root is an error',()=>withFiles(manifest,dir=>{
 const r=verify(dir,{scanRoots:['packages','scripts','absent']});
 assert.equal(r.ok,false);assert.deepEqual(r.missingRoots,['absent']);
}));
test('inventory: reject unsafe or duplicate scan roots',()=>withFiles(manifest,dir=>{
 for(const scanRoots of [['packages','../escape'],['scripts','scripts']])
   assert.throws(()=>verify(dir,{scanRoots}),TypeError);
}));
test('inventory: invalid manifest shape fails promptly',()=>withFiles(manifest,dir=>{
 for (const m of [null,{},'packages/a.test.mjs'])
   assert.throws(()=>verify(dir,{manifest:m}),TypeError);
}));
