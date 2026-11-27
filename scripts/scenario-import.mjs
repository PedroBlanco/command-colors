/** Load trusted local JSON files once at startup. Never exposed as an upload API. */
import {readdirSync,openSync,fstatSync,readSync,closeSync,constants} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createAncientsScenarioCatalog} from '../packages/ancients-rules/scenario-catalog.mjs';

const MAX_FILE_BYTES=256*1024;
function readScenarioDirectory(directory){
  if(typeof directory!=='string'||!directory.trim())throw Error('INVALID_SCENARIO_DIRECTORY');
  const root=resolve(directory),entries=readdirSync(root,{withFileTypes:true})
    .filter(e=>e.name.toLowerCase().endsWith('.json')).sort((a,b)=>a.name.localeCompare(b.name));
  if(entries.length>500)throw Error('TOO_MANY_SCENARIO_FILES');
  const documents=[];
  for(const entry of entries){
    try{
      if(!entry.isFile()||entry.isSymbolicLink())throw Error('SCENARIO_NOT_REGULAR_FILE');
      const fd=openSync(join(root,entry.name),constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
      try{
        const stat=fstatSync(fd);
        if(!stat.isFile()||stat.size<1||stat.size>MAX_FILE_BYTES)throw Error('SCENARIO_FILE_SIZE');
        const bytes=Buffer.alloc(stat.size+1);
        let count=0,n;
        while(count<bytes.length&&(n=readSync(fd,bytes,count,bytes.length-count,null))>0)count+=n;
        if(count!==stat.size)throw Error('SCENARIO_FILE_CHANGED');
        const data=bytes.subarray(0,count);
        documents.push({filename:entry.name,bytes:count,sha256:createHash('sha256').update(data).digest('hex'),
          document:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data))});
      }finally{closeSync(fd);}
    }catch(error){throw new Error('SCENARIO_IMPORT_FAILED '+entry.name+': '+error.message,{cause:error});}
  }
  return documents;
}

function readCatalog(directory){
  const files=readScenarioDirectory(directory);
  // Validate the entire batch before returning: no partial catalog on error.
  return {files,catalog:createAncientsScenarioCatalog(files.map(f=>f.document))};
}

export function loadAncientsScenarioDirectory(directory){
  return directory===undefined?createAncientsScenarioCatalog():readCatalog(directory).catalog;
}

/** Read-only batch preflight: same parser and initialization as server startup. */
export function auditAncientsScenarioDirectory(directory,{expectedOfficialCount}={}){
  if(expectedOfficialCount!==undefined&&(!Number.isSafeInteger(expectedOfficialCount)||expectedOfficialCount<0||expectedOfficialCount>500))
    throw Error('INVALID_EXPECTED_OFFICIAL_COUNT');
  const {files,catalog}=readCatalog(directory);
  const scenarios=files.map(({filename,bytes,sha256,document:d})=>({
    filename,bytes,sha256,id:d.id,title:d.title,kind:d.provenance.kind,geometry:d.geometry
  }));
  const counts={OFFICIAL:0,COMMUNITY:0,ORIGINAL:0};
  for(const s of scenarios)counts[s.kind]++;
  if(expectedOfficialCount!==undefined&&counts.OFFICIAL!==expectedOfficialCount)
    throw Error('SCENARIO_OFFICIAL_COUNT_MISMATCH: expected '+expectedOfficialCount+', found '+counts.OFFICIAL);
  return {schemaVersion:1,externalCount:scenarios.length,catalogCount:catalog.list().length,counts,scenarios};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{
    const args=process.argv.slice(2);
    if(!(args.length===1||args.length===3&&args[1]==='--expect-official'&&/^\d+$/.test(args[2])))
      throw Error('Uso: node scripts/scenario-import.mjs <directorio> [--expect-official N]');
    console.log(JSON.stringify(auditAncientsScenarioDirectory(args[0],{expectedOfficialCount:args.length===3?Number(args[2]):undefined}),null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
