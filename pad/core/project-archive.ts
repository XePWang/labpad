import {fromBuffer,type Entry,type ZipFile} from 'yauzl';import {readFile} from 'node:fs/promises';
import {workspacePath,uniquePaths,type WorkspaceSnapshot} from '../shared/workspace';
import {snapshotBytes} from './workspace-files';
async function readEntry(archive:ZipFile,entry:Entry,limit=8*1024**2):Promise<Buffer>{
 return new Promise((resolve,reject)=>archive.openReadStream(entry,(error,stream)=>{
  if(error||!stream){reject(error??Error('无法读取 ZIP 条目'));return;}const chunks:Buffer[]=[];let size=0;
  stream.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>limit)stream.destroy(Error('项目文件超过大小限制'));else chunks.push(chunk);});stream.once('error',reject);stream.once('end',()=>resolve(Buffer.concat(chunks)));
 }));
}
export async function archiveSnapshot(data:Buffer):Promise<WorkspaceSnapshot>{
 const archive=await new Promise<ZipFile>((resolve,reject)=>fromBuffer(data,{lazyEntries:true,autoClose:false,validateEntrySizes:true},(e,z)=>e||!z?reject(e??Error('ZIP 无效')):resolve(z)));
 try{
  const entries:Entry[]=[];await new Promise<void>((resolve,reject)=>{
   archive.once('error',reject);archive.once('end',resolve);archive.on('entry',(entry:Entry)=>{entries.push(entry);if(entries.length>65536){reject(Error('ZIP 条目过多'));archive.close();}else archive.readEntry();});archive.readEntry();
  });
  const excluded:string[]=[];
  for(const entry of entries)if(entry.fileName.endsWith('/.labpad-build.json')&&entry.uncompressedSize<=65536){
   try{const value=JSON.parse((await readEntry(archive,entry,65536)).toString('utf8'));if(value?.kind==='labpad.build'&&value.schemaVersion===1)excluded.push(entry.fileName.slice(0,-'.labpad-build.json'.length));}catch{}
  }
  const files:Record<string,Buffer>={};let bytes=0,count=0;
  for(const entry of entries){
   const name=entry.fileName;
   if(name.endsWith('/')||excluded.some(prefix=>name.startsWith(prefix))||/(?:^|\/)(?:\.labpad|\.labpad-project\.json|\.labpad-candidate\.json)$/.test(name))continue;
   if(++count>4096||(bytes+=entry.uncompressedSize)>64*1024**2||entry.uncompressedSize>8*1024**2)throw Error('项目 ZIP 超过4096项 / 64MB限制');
   if(((entry.externalFileAttributes>>>16)&0o170000)===0o120000)throw Error('项目 ZIP 不支持符号链接');
   const checked=name.endsWith('/labpad.project.json')?name.slice(0,-'labpad.project.json'.length)+'descriptor.json':name==='labpad.project.json'?'descriptor.json':name;
   workspacePath(checked);if(Object.hasOwn(files,name))throw Error('ZIP 中有重复文件：'+name);files[name]=await readEntry(archive,entry);
  }
  const names=Object.keys(files),prefix=names[0]?.split('/')[0]+'/';
  const unwrapped=names.length&&names.every(n=>n.startsWith(prefix))?Object.fromEntries(names.map(n=>[n.slice(prefix.length),files[n]])):files;
  uniquePaths(Object.keys(unwrapped).filter(n=>n!=='labpad.project.json'));return snapshotBytes(unwrapped);
 }finally{archive.close();}
}
/** Text-only compatibility helper; project callers use archiveSnapshot for binary resources. */
export async function archiveFiles(data:Buffer):Promise<Record<string,string>>{return (await archiveSnapshot(data)).files;}
export function restorePackage(files:Record<string,string>,binaryFiles:Record<string,string>={}):unknown{
 if(!Object.hasOwn(files,'labpad.project.json'))throw Error('ZIP缺少labpad.project.json。请导入附带项目配置的提交包。');
 const value=JSON.parse(files['labpad.project.json'].replace(/^\uFEFF/,''));
 const content=(name:string)=>{workspacePath(name);if(Object.hasOwn(files,name))return files[name];if(Object.hasOwn(binaryFiles,name))return binaryFiles[name];throw Error('ZIP缺少文件：'+name);};
 if(value.mode==='project'){
  if(!Array.isArray(value.files))throw Error('配置缺少files');
  value.files=value.files.filter((f:any)=>f.path!=='LPMake.txt'||Object.hasOwn(files,'LPMake.txt')).map((f:any)=>({path:f.path,content:content(f.path),...(Object.hasOwn(binaryFiles,f.path)?{encoding:'base64'}:{})}));
 }else{
  if(!Array.isArray(value.problems))throw Error('配置缺少problems');
  for(const p of value.problems){if(p.sourceFile)p.source=content(p.sourceFile);if(p.versions)p.versions=p.versions.map((v:any)=>({...v,source:content(v.file)}));}
 }
 return value;
}
export async function readProjectArchive(file:string){const snapshot=await archiveSnapshot(await readFile(file));return restorePackage(snapshot.files,snapshot.binaryFiles);}
