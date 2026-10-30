import {readFile,readdir,lstat,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fromBuffer,type Entry} from 'yauzl';
import {decodeText,writeSource} from '../core/storage';
import type {Student} from './roster';
export interface Candidate{key:string;labId?:string;ordinal?:number;studentId:string;problemId:string;language:'c'|'cpp';source:string;hash:string;origin:string;file:string}
export interface IntakeIssue{origin:string;message:string;students:string[];problemId?:string;pending:boolean}
export interface Intake{candidates:Candidate[];issues:IntakeIssue[];empty:{studentId:string;problemId:string}[]}
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
export async function collect(submit:string,src:string,students:Student[],problems:string[],labId=''):Promise<Intake>{
 const result:Intake={candidates:[],issues:[],empty:[]};let bytes=0,entries=0;
 const identify=(origin:string)=>students.filter(s=>new RegExp('(?:^|[^0-9])'+s.studentId+'(?:$|[^0-9])').test(origin)).map(s=>s.studentId);
 const identifyProblem=(name:string)=>{
  const stem=path.posix.basename(name).replace(/\.(c|cpp)$/i,'');
  const exact=problems.filter(p=>stem===p||stem.endsWith('_'+p));
  if(exact.length===1)return exact[0];if(exact.length>1)return undefined;
  const matches=problems.filter(p=>new RegExp('(?:^|_)'+p.replace(/[.*+?^$\{\}()|[\]\\]/g,'\\$&')+'_v(?:[2-9]|[1-9][0-9]+)$','i').test(stem));
  return matches.length===1?matches[0]:undefined;
 };
 const issue=(origin:string,message:string,pending=true,problemId?:string)=>result.issues.push({origin,message,students:identify(origin),problemId,pending});
 async function file(name:string,origin:string,data:Buffer,depth:number){
  if(++entries>20000||bytes+data.length>256*1024**2)throw Error('收件内容超过上限（20000 个文件 / 256 MB）');
  bytes+=data.length;
  if(/\.zip$/i.test(name)){
   if(depth>=5){issue(origin,'嵌套 ZIP 超过 5 层');return;}
   try{await zip(data,origin,depth+1);}catch(e){issue(origin,'ZIP 无法读取：'+(e instanceof Error?e.message:String(e)));}return;
  }
  if(!/\.(c|cpp)$/i.test(name))return;
  const ids=identify(origin),problemId=identifyProblem(name);
  if(ids.length!==1||!problemId){issue(origin,ids.length!==1?'学号归属不明确':'无法匹配项目题号',true,problemId);return;}
  if(data.length>2*1024**2){issue(origin,'源码超过 2 MB',true,problemId);return;}
  let source:string;
  try{source=decodeText(data).text;if(source.includes('\0'))throw Error('源码含有 NUL 字节');}catch(e){issue(origin,e instanceof Error?e.message:String(e),true,problemId);return;}
  if(!source.trim()){result.empty.push({studentId:ids[0],problemId});return;}
  const language=/\.cpp$/i.test(name)?'cpp':'c',sourceHash=hash(Buffer.from(source,'utf8')),key=hash(labId+'\0'+origin+'\0'+sourceHash);
  const destination=path.join(src,ids[0],problemId,key+'.'+language);await mkdir(path.dirname(destination),{recursive:true});await writeSource(destination,source);
  result.candidates.push({key,labId,studentId:ids[0],problemId,language,source,hash:sourceHash,origin,file:path.relative(path.dirname(src),destination)});
 }
 async function zip(data:Buffer,origin:string,depth:number):Promise<void>{
  await new Promise<void>((resolve,reject)=>fromBuffer(data,{lazyEntries:true,validateEntrySizes:true},(error,archive)=>{
   if(error||!archive){reject(error??Error('ZIP 无效'));return;}let ordinal=0,done=false;
   const fail=(e:Error)=>{if(done)return;done=true;archive.close();reject(e);};
   archive.on('error',fail);archive.on('end',()=>{if(!done){done=true;resolve();}});
   archive.on('entry',(entry:Entry)=>{
    const name=entry.fileName.replace(/\\/g,'/'),entryOrigin=origin+'!/'+name+' [entry '+(++ordinal)+']';
    if(name.startsWith('/')||/^[A-Za-z]:/.test(name)||name.split('/').some(p=>p==='..')||((entry.externalFileAttributes>>>16)&0o170000)===0o120000){issue(entryOrigin,'ZIP 条目路径或链接无效');archive.readEntry();return;}
    if(name.endsWith('/')){archive.readEntry();return;}
    if(entry.uncompressedSize>100*1024**2||bytes+entry.uncompressedSize>256*1024**2){fail(Error('ZIP 解压内容超过上限'));return;}
    archive.openReadStream(entry,(err,stream)=>{
     if(err||!stream){fail(err??Error('无法读取 ZIP 条目'));return;}const chunks:Buffer[]=[];let size=0;
     stream.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>100*1024**2){stream.destroy(Error('ZIP 条目过大'));return;}chunks.push(chunk);});
     stream.on('error',fail);stream.on('end',()=>{void file(name,entryOrigin,Buffer.concat(chunks),depth).then(()=>archive.readEntry(),fail);});
    });
   });archive.readEntry();
  }));
 }
 async function directory(dir:string,relative=''){
  const names=(await readdir(dir)).sort((a,b)=>a.localeCompare(b,'en'));
  for(const name of names){
   const absolute=path.join(dir,name),origin=path.posix.join(relative,name),info=await lstat(absolute);
   if(info.isSymbolicLink()){issue(origin,'收件目录中存在符号链接');continue;}
   if(info.isDirectory())await directory(absolute,origin);
   else if(info.isFile()){
    if(info.size>100*1024**2){issue(origin,'收件文件超过 100 MB');continue;}
    try{await file(name,origin,await readFile(absolute),0);}catch(e){issue(origin,e instanceof Error?e.message:String(e));}
   }
  }
 }
 await mkdir(src,{recursive:true});
 try{await directory(submit);}catch(e:any){if(e.code!=='ENOENT')throw e;}
 result.candidates.sort((a,b)=>a.origin.localeCompare(b.origin,'en')||a.key.localeCompare(b.key,'en'));
 return result;
}
