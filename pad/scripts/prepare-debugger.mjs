import {readFile,writeFile,mkdir,rename,chmod,copyFile,rm,symlink} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';import {createHash} from 'node:crypto';import {pipeline} from 'node:stream/promises';import {Readable} from 'node:stream';
import {spawnSync} from 'node:child_process';
import {fromBuffer} from 'yauzl';import path from 'node:path';import {fileURLToPath} from 'node:url';
const pad=path.resolve(fileURLToPath(new URL('..',import.meta.url))),work=path.resolve(pad,'../.work');
const pin=JSON.parse(await readFile(path.join(pad,'debuggers.json'),'utf8'));
async function hash(file){const h=createHash('sha256');for await(const part of createReadStream(file))h.update(part);return h.digest('hex');}
export async function prepareDebugger(target){
 const platform=pin.platforms[target];if(!platform)throw Error('Unsupported debugger platform: '+target);
 const directory=path.join(work,'debuggers',target),metadata=path.join(directory,'runtime.json');
 try{const old=JSON.parse(await readFile(metadata,'utf8'));if(old.layoutVersion===2&&old.version===pin.version&&old.sha256===platform.sha256){await readFile(path.join(directory,'adapter',target.startsWith('win')?'codelldb.exe':'codelldb'));await readFile(path.join(directory,'bin',target.startsWith('win')?'codelldb-launch.exe':'codelldb-launch'));return directory;}}catch{}
 const archive=path.join(work,'downloads',platform.asset);await mkdir(path.dirname(archive),{recursive:true});
 try{await readFile(archive);}catch(error){
  if(error.code!=='ENOENT')throw error;
  const response=await fetch('https://github.com/vadimcn/codelldb/releases/download/v'+pin.version+'/'+platform.asset,{signal:AbortSignal.timeout(900000)});
  if(!response.ok)throw Error('Debugger download failed: '+response.status);await pipeline(Readable.fromWeb(response.body),createWriteStream(archive+'.part'));await rename(archive+'.part',archive);
 }
 if(await hash(archive)!==platform.sha256)throw Error('Debugger archive checksum mismatch: '+platform.asset);
 if(path.dirname(directory)!==path.join(work,'debuggers'))throw Error('Invalid debugger destination');
 await rm(directory,{recursive:true,force:true});await mkdir(directory,{recursive:true});
 const data=await readFile(archive);
 await new Promise((resolve,reject)=>fromBuffer(data,{lazyEntries:true,validateEntrySizes:true},(error,zip)=>{
  if(error||!zip){reject(error??Error('Invalid debugger archive'));return;}let failed=false;
  const fail=e=>{if(!failed){failed=true;zip.close();reject(e);}};zip.once('error',fail);zip.once('end',resolve);
  zip.on('entry',entry=>{
   if(!/^extension\/(?:(?:adapter|lldb)\/|bin\/codelldb-launch(?:\.exe)?$)/.test(entry.fileName)){zip.readEntry();return;}
   const name=entry.fileName.slice('extension/'.length),out=path.resolve(directory,name);
   if(!out.startsWith(directory+path.sep)||name.split('/').includes('..')){fail(Error('Invalid debugger archive path'));return;}
   const mode=(entry.externalFileAttributes>>>16)&0o777,link=((entry.externalFileAttributes>>>16)&0o170000)===0o120000;
   void (async()=>{
    if(entry.fileName.endsWith('/')){await mkdir(out,{recursive:true});zip.readEntry();return;}
    await mkdir(path.dirname(out),{recursive:true});
    const stream=await new Promise((yes,no)=>zip.openReadStream(entry,(e,s)=>e||!s?no(e??Error('Cannot read debugger entry')):yes(s)));
    if(link){
     const parts=[];for await(const part of stream)parts.push(part);const targetName=Buffer.concat(parts).toString('utf8');
     if(path.isAbsolute(targetName)||!path.resolve(path.dirname(out),targetName).startsWith(directory+path.sep))throw Error('Debugger symlink escapes runtime');
     await symlink(targetName,out);
    }else{
     await pipeline(stream,createWriteStream(out,{flags:'wx'}));
     await chmod(out,mode||(/\/(?:codelldb|lldb|lldb-server|lldb-argdumper)(?:\.exe)?$/.test(out)?0o755:0o644));
    }
    if(!failed)zip.readEntry();
   })().catch(fail);
  });zip.readEntry();
 }));
 if(target==='linux-x64'&&process.platform==='linux'){const stripped=spawnSync('strip',['--strip-debug',path.join(directory,'bin/codelldb-launch')],{encoding:'utf8'});if(stripped.status!==0)throw Error('Cannot strip debugger launcher: '+(stripped.stderr??''));}
 const notices=path.join(directory,'licenses');await mkdir(notices,{recursive:true});
 for(const [from,to]of [['codelldb/LICENSE','CodeLLDB.txt'],['llvm/LICENSE.TXT','LLVM.txt'],['python/LICENSE','Python.txt']])await copyFile(path.join(pad,'vendor',from),path.join(notices,to));
 await writeFile(metadata,JSON.stringify({layoutVersion:2,version:pin.version,sha256:platform.sha256,adapter:'CodeLLDB',python:'3.12.7'},null,2)+'\n');
 console.log('Offline debugger ready: '+target);return directory;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 for(const target of process.argv.slice(2))await prepareDebugger(target);
}
