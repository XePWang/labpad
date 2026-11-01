import {readdir,lstat,readFile,mkdir,writeFile} from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {archiveFiles} from '../core/project-archive';import {decodeText,exists,readJSON} from '../core/storage';import {workspacePath,uniquePaths,type WorkspaceSnapshot} from '../shared/workspace';import type {Intake,Candidate} from './collect';import type {Student} from './roster';
export function snapshotHash(files:Record<string,string>){return createHash('sha256').update(JSON.stringify(Object.entries(files).sort(([a],[b])=>a<b?-1:a>b?1:0))).digest('hex');}
export async function directoryFiles(root:string):Promise<Record<string,string>>{
 const files:Record<string,string>={};let bytes=0;
 async function walk(dir:string,prefix=''){for(const entry of await readdir(dir,{withFileTypes:true})){
  const name=prefix+entry.name;if(entry.name==='.labpad-candidate.json')continue;
  if(entry.name==='labpad.project.json'&&!prefix){files[name]=decodeText(await readFile(path.join(dir,entry.name))).text;continue;}
  workspacePath(name);if(entry.isSymbolicLink())throw new Error('项目中存在符号链接：'+name);
  if(entry.isDirectory())await walk(path.join(dir,entry.name),name+'/');else if(entry.isFile()){
   const stat=await lstat(path.join(dir,entry.name));if(stat.size>8*1024**2||(bytes+=stat.size)>64*1024**2||Object.keys(files).length>=4096)throw new Error('项目超过4096项 / 64MB限制');
   files[name]=decodeText(await readFile(path.join(dir,entry.name))).text;
  }
 }}
 await walk(root);uniquePaths(Object.keys(files).filter(n=>n!=='labpad.project.json'));return files;
}
export async function collectProjects(submit:string,src:string,students:Student[],labId:string):Promise<Intake>{
 const intake:Intake={candidates:[],issues:[],empty:[]};
 const identify=(origin:string)=>students.filter(s=>new RegExp('(?:^|[^0-9])'+s.studentId+'(?:$|[^0-9])').test(origin)).map(s=>s.studentId);
 async function candidate(origin:string,files:Record<string,string>){
  const ids=identify(origin);if(ids.length!==1)throw new Error('学号归属不明确');
  delete files['labpad.project.json'];uniquePaths(Object.keys(files));
  if(!Object.keys(files).some(n=>/\.(c|cpp|cc|cxx)$/i.test(n)&&files[n].trim())){intake.empty.push({studentId:ids[0],problemId:'main'});return;}
  const hash=snapshotHash(files),key=createHash('sha256').update(labId+'\0'+origin+'\0'+hash).digest('hex'),root=path.join(src,ids[0],key);
  await mkdir(root,{recursive:true});for(const [name,text] of Object.entries(files)){const target=path.join(root,workspacePath(name));await mkdir(path.dirname(target),{recursive:true});await writeFile(target,text,'utf8');}
  const workspace:WorkspaceSnapshot={files,inheritDefaults:true};
  intake.candidates.push({key,mode:'project',labId,studentId:ids[0],problemId:'main',language:Object.keys(files).some(n=>/\.(cpp|cc|cxx)$/i.test(n))?'cpp':'c',source:'',workspace,hash,origin,file:path.relative(path.dirname(src),root)});
 }
 async function walk(dir:string,relative=''){
  for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:1)){
   const full=path.join(dir,entry.name),origin=relative?relative+'/'+entry.name:entry.name;
   try{
    if(entry.isSymbolicLink())throw new Error('收件目录中存在符号链接');
    if(entry.isFile()&&/\.zip$/i.test(entry.name))await candidate(origin,await archiveFiles(await readFile(full)));
    else if(entry.isDirectory()){
     const children=await readdir(full,{withFileTypes:true}),direct=children.some(e=>e.name==='LPMake.txt'||e.name==='src'||/\.(c|cpp|cc|cxx)$/i.test(e.name));
     if(direct&&identify(origin).length===1)await candidate(origin,await directoryFiles(full));else await walk(full,origin);
    }
   }catch(e){intake.issues.push({origin,message:e instanceof Error?e.message:String(e),students:identify(origin),problemId:'main',pending:true});}
  }
 }
 if(await exists(submit))await walk(submit);intake.candidates.sort((a,b)=>a.origin<b.origin?-1:a.origin>b.origin?1:0);return intake;
}
export function controlledStudentBuild(files:Record<string,string>){
 // Teacher opt-in permits the declaration language only, never external file or tool hooks.
 const make=files['LPMake.txt'];if(!make)throw new Error('学生项目缺少 LPMake.txt');return make;
}
