import {mkdir,opendir,rm,lstat} from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import {setTimeout as delay} from 'node:timers/promises';
export async function directorySize(directory:string):Promise<number>{
 let bytes=0;
 try{for await(const entry of await opendir(directory)){
  const file=path.join(directory,entry.name);if(entry.isDirectory())bytes+=await directorySize(file);else if(entry.isFile())bytes+=(await lstat(file).catch(()=>({size:0}))).size;
 }}catch(e:any){if(e.code!=='ENOENT')throw e;}return bytes;
}
export class CompilerCache{
 private checked=0;
 constructor(readonly directory:string,readonly limitBytes=2*1024**3){}
 async acquire(signal?:AbortSignal,wait=true):Promise<()=>Promise<void>>{
  await mkdir(this.directory,{recursive:true});
  for(;;){
   signal?.throwIfAborted();
   try{return await lockfile.lock(this.directory,{realpath:false,stale:30000,update:10000,retries:0});}
   catch(e:any){if(e.code!=='ELOCKED')throw e;if(!wait)throw new Error('另一个 LabPad 正在编译，请稍后清理');await delay(150,undefined,{signal});}
  }
 }
 async trim(){
  if(Date.now()-this.checked<300000)return;this.checked=Date.now();
  if(await this.size()>this.limitBytes)await this.erase();
 }
 private async erase(){for await(const entry of await opendir(this.directory))await rm(path.join(this.directory,entry.name),{recursive:true,force:true});}
 async clear(){const release=await this.acquire(undefined,false);try{const size=await this.size();await this.erase();this.checked=Date.now();return size;}finally{await release();}}
 size(){return directorySize(this.directory);}
}
