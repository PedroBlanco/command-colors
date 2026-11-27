/** Load trusted local JSON files once at startup. Never exposed as an upload API. */
import {readdirSync,openSync,fstatSync,readSync,closeSync,constants} from 'node:fs';
import {join,resolve} from 'node:path';
import {createAncientsScenarioCatalog} from '../packages/ancients-rules/scenario-catalog.mjs';

const MAX_FILE_BYTES=256*1024;
export function loadAncientsScenarioDirectory(directory){
  if(directory===undefined)return createAncientsScenarioCatalog();
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
        documents.push(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,count))));
      }finally{closeSync(fd);}
    }catch(error){throw new Error('SCENARIO_IMPORT_FAILED '+entry.name+': '+error.message,{cause:error});}
  }
  // Validate the entire batch before returning: no partial catalog on error.
  return createAncientsScenarioCatalog(documents);
}
