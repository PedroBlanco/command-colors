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
   assert.equal(result.tests,31);
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
