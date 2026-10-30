import {readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
export async function cleanInactiveRuntime(){
 for(const name of await readdir(tmpdir())){
  const match=/^labpad-(?:ui-|runtime-)(\d+)(?:-|$)/.exec(name);if(!match)continue;
  const pid=Number(match[1]);if(pid===process.pid)continue;
  try{process.kill(pid,0);continue;}catch(e:any){if(e.code!=='ESRCH')continue;}
  await rm(path.join(tmpdir(),name),{recursive:true,force:true,maxRetries:1}).catch(()=>{});
 }
}
