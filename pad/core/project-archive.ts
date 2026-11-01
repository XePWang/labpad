import {fromBuffer,type Entry} from 'yauzl';import {readFile} from 'node:fs/promises';import {decodeText} from './storage';import {workspacePath,uniquePaths} from '../shared/workspace';
export async function archiveFiles(data:Buffer):Promise<Record<string,string>>{
 const files:Record<string,string>={};let count=0,bytes=0;
 await new Promise<void>((resolve,reject)=>fromBuffer(data,{lazyEntries:true,validateEntrySizes:true},(error,archive)=>{
  if(error||!archive){reject(error??new Error('ZIP无效'));return;}let done=false;
  const fail=(e:Error)=>{if(done)return;done=true;archive.close();reject(e);};archive.on('error',fail);archive.on('end',()=>{if(!done){done=true;resolve();}});
  archive.on('entry',(entry:Entry)=>{
   const name=entry.fileName;
   if(name.endsWith('/')){archive.readEntry();return;}
   try{
    if(++count>4096||(bytes+=entry.uncompressedSize)>64*1024**2||entry.uncompressedSize>8*1024**2)throw new Error('项目ZIP超过4096项 / 64MB限制');
    if(((entry.externalFileAttributes>>>16)&0o170000)===0o120000)throw new Error('项目ZIP不支持符号链接');
    // The root descriptor is permitted in archives, while managed file paths reserve it.
    const checked=name.endsWith('/labpad.project.json')?name.slice(0,-'labpad.project.json'.length)+'descriptor.json':name==='labpad.project.json'?'descriptor.json':name;
    workspacePath(checked);if(Object.hasOwn(files,name))throw new Error('ZIP中有重复文件：'+name);
   }catch(e){fail(e as Error);return;}
   archive.openReadStream(entry,(err,stream)=>{
    if(err||!stream){fail(err??new Error('无法读取ZIP条目'));return;}const chunks:Buffer[]=[];let size=0;
    stream.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>8*1024**2)stream.destroy(new Error('项目文件超过8MB'));else chunks.push(chunk);});
    stream.on('error',fail);stream.on('end',()=>{try{files[name]=decodeText(Buffer.concat(chunks)).text;archive.readEntry();}catch(e){fail(e as Error);}});
   });
  });archive.readEntry();
 }));
 // Remove exactly one outer submission directory, never flatten the project itself.
 const names=Object.keys(files),prefix=names[0]?.split('/')[0]+'/';
 return names.length&&names.every(n=>n.startsWith(prefix))?Object.fromEntries(names.map(n=>[n.slice(prefix.length),files[n]])):files;
}
export function restorePackage(files:Record<string,string>):unknown{
 if(!Object.hasOwn(files,'labpad.project.json'))throw new Error('ZIP缺少labpad.project.json。请导入附带项目配置的提交包。');
 const value=JSON.parse(files['labpad.project.json'].replace(/^\uFEFF/,''));const content=(name:string)=>{workspacePath(name);if(!Object.hasOwn(files,name))throw new Error('ZIP缺少文件：'+name);return files[name];};
 if(value.mode==='project'){
  if(!Array.isArray(value.files))throw new Error('配置缺少files');value.files=value.files.map((f:any)=>({path:f.path,content:content(f.path)}));
 }else{
  if(!Array.isArray(value.problems))throw new Error('配置缺少problems');
  for(const p of value.problems){if(p.sourceFile)p.source=content(p.sourceFile);if(p.versions)p.versions=p.versions.map((v:any)=>({...v,source:content(v.file)}));}
 }
 return value;
}
export async function readProjectArchive(file:string){return restorePackage(await archiveFiles(await readFile(file)));}
