import {mkdir,readFile,readdir,lstat,rename,rm,writeFile,mkdtemp} from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';import writeFileAtomic from 'write-file-atomic';
import {workspacePath,workspaceTemplate,parseWorkspacePackage,uniquePaths,type WorkspaceState,type WorkspaceFile,type WorkspaceSnapshot} from '../shared/workspace';
import {defaultProblem,defaultSource} from '../shared/defaults';import {filePart,validateProblem} from '../shared/validate';import type {LoadedDraft,Draft,Language,Problem} from '../shared/types';
import {decodeText,readJSON,exists,writeSource} from './storage';
export class WorkspaceStore{
 private tail:Promise<unknown>=Promise.resolve();
 constructor(readonly dataRoot:string){}
 root(lab:string){return path.join(this.dataRoot,'projects',filePart(lab,'项目名称'));}
 metadata(lab:string){return path.join(this.root(lab),'.labpad-project.json');}
 async isProject(lab:string){return !!lab&&await exists(this.metadata(lab));}
 private enqueue<T>(fn:()=>Promise<T>){const task=this.tail.then(fn,fn);this.tail=task.catch(()=>{});return task;}
 async read(lab:string):Promise<WorkspaceState>{
  await this.tail;const value=await readJSON(this.metadata(lab)) as WorkspaceState;
  if(value?.schemaVersion!==2||value.mode!=='project'||value.labId!==lab||typeof value.inheritDefaults!=='boolean')throw new Error('项目状态格式无效');
  validateProblem(value.tests);if(value.tests.labId!==lab||value.tests.problemId!=='')throw new Error('工作区测试目标不符');return value;
 }
 private async write(lab:string,state:WorkspaceState){await writeFileAtomic(this.metadata(lab),JSON.stringify(state,null,2)+'\n');}
 async path(lab:string,file:string,allowMissing=false){
  const root=this.root(lab),parts=workspacePath(file).split('/');let current=root;
  for(let i=0;i<parts.length;i++){current=path.join(current,parts[i]);try{if((await lstat(current)).isSymbolicLink())throw new Error('项目文件不支持符号链接：'+file);}catch(e:any){if(e.code==='ENOENT'&&allowMissing)break;throw e;}}
  return path.join(root,...parts);
 }
 async list(lab:string):Promise<WorkspaceFile[]>{
  await this.tail;const root=this.root(lab),result:WorkspaceFile[]=[];
  async function walk(dir:string,prefix=''){for(const entry of await readdir(dir,{withFileTypes:true})){
   if(!prefix&&entry.name==='.labpad-project.json')continue;
   const file=prefix+entry.name;workspacePath(file);
   if(entry.isSymbolicLink())throw new Error('项目文件不支持符号链接：'+file);
   result.push({path:file,directory:entry.isDirectory()});if(entry.isDirectory())await walk(path.join(dir,entry.name),file+'/');
  }}
  await walk(root);uniquePaths(result.filter(e=>!e.directory).map(e=>e.path));return result.sort((a,b)=>a.path.normalize('NFC')<b.path.normalize('NFC')?-1:1);
 }
 async create(lab:string,language:Language='c',value?:unknown){
  const pkg=value?parseWorkspacePackage(value):undefined,root=this.root(lab);await mkdir(path.dirname(root),{recursive:true});if(await exists(root))throw new Error('项目已存在');
  const temporary=await mkdtemp(path.join(this.dataRoot,'.workspace-'));
  try{
   const files=pkg?Object.fromEntries(pkg.files.map(f=>[f.path,f.content])):workspaceTemplate(language);
   for(const [file,content] of Object.entries(files)){const target=path.join(temporary,workspacePath(file));await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content,'utf8');}
   const first=Object.keys(files).find(f=>/\.(c|cpp|cc|cxx)$/i.test(f))??'LPMake.txt';
   const state:WorkspaceState={schemaVersion:2,mode:'project',labId:lab,tests:{...(pkg?.tests??defaultProblem(lab,'')),labId:lab,problemId:''},inheritDefaults:pkg?.build.inheritDefaults??true,templates:pkg?.templates,starters:Object.fromEntries(Object.entries(files).filter(([f])=>/\.(c|cpp|cc|cxx|h|hpp|hh|hxx)$/i.test(f))),activeFile:first,openFiles:[first],expanded:['src','include'],sidebarWidth:190,sidebarCollapsed:false};
   await writeFile(path.join(temporary,'.labpad-project.json'),JSON.stringify(state,null,2)+'\n');await rename(temporary,root);
  }catch(e){await rm(temporary,{recursive:true,force:true});throw e;}
  return this.open(lab,(await this.read(lab)).activeFile!);
 }
 async open(lab:string,file:string):Promise<LoadedDraft>{
  const state=await this.read(lab),target=await this.path(lab,file),decoded=decodeText(await readFile(target));
  return {workspaceBuild:{inheritDefaults:state.inheritDefaults},file,documentId:'file:'+file,name:file,sourceFile:target,sourceEncoding:decoded.encoding,source:decoded.text,language:/\.(cpp|cc|cxx|hpp|hh)$/i.test(file)?'cpp':'c',problem:state.tests};
 }
 async documents(lab:string){
  const state=await this.read(lab),files=await this.list(lab),paths=new Set(files.filter(f=>!f.directory).map(f=>f.path));
  const wanted=(state.openFiles??[state.activeFile??'LPMake.txt']).filter(f=>paths.has(f));if(!wanted.length&&paths.size)wanted.push(paths.has('LPMake.txt')?'LPMake.txt':[...paths][0]);
  return Promise.all(wanted.map(f=>this.open(lab,f)));
 }
 async snapshot(lab:string,buffers:Draft[]=[]):Promise<WorkspaceSnapshot>{
  const state=await this.read(lab),entries=await this.list(lab),files:Record<string,string>={};
  for(const item of entries)if(!item.directory)files[item.path]=decodeText(await readFile(await this.path(lab,item.path))).text;
  for(const d of buffers)if(d.problem.labId===lab&&d.file){workspacePath(d.file);if(!Object.hasOwn(files,d.file))throw new Error('编辑文件已不存在：'+d.file);files[d.file]=d.source;}
  const overlay=[...buffers].reverse().find(d=>d.problem.labId===lab&&typeof d.workspaceBuild?.inheritDefaults==='boolean');
  return {files,inheritDefaults:overlay?.workspaceBuild?.inheritDefaults??state.inheritDefaults};
 }
 async save(draft:Draft){
  if(!draft.file)throw new Error('请选择项目文件');const lab=draft.problem.labId,target=await this.path(lab,draft.file);
  return this.enqueue(async()=>{
   const oldSource=await readFile(target),oldMetadata=await readFile(this.metadata(lab)),state=JSON.parse(oldMetadata.toString('utf8')) as WorkspaceState;
   state.tests=structuredClone(validateProblem(draft.problem));
   if(draft.file==='LPMake.txt'&&draft.workspaceBuild)state.inheritDefaults=draft.workspaceBuild.inheritDefaults;
   try{await writeSource(target,draft.source);await this.write(lab,state);}
   catch(error){
    const restore=async(file:string,original:Buffer)=>{const current=await readFile(file).catch(()=>undefined);if(!current?.equals(original))await writeFileAtomic(file,original);};
    const restored=await Promise.allSettled([restore(target,oldSource),restore(this.metadata(lab),oldMetadata)]);
    if(restored.some(r=>r.status==='rejected'))throw new AggregateError([error,...restored.filter(r=>r.status==='rejected').map(r=>(r as PromiseRejectedResult).reason)],'保存失败，恢复原文件时也发生错误；编辑草稿仍保留。');
    throw error;
   }
  });
 }
 async update(lab:string,values:Partial<WorkspaceState>){
  await this.tail;return this.enqueue(async()=>{const state=await readJSON(this.metadata(lab)) as WorkspaceState;await this.write(lab,{...state,...structuredClone(values),schemaVersion:2,mode:'project',labId:lab});});
 }
 async mutate(lab:string,action:'newFile'|'newFolder'|'rename'|'delete',file:string,target?:string,content?:string){
  const entries=await this.list(lab);workspacePath(file);
  const key=(p:string)=>p.normalize('NFC').toLowerCase();
  const checkNew=(name:string,except?:string)=>{workspacePath(name);const parts=name.split('/');for(let i=1;i<parts.length;i++){const parent=parts.slice(0,i).join('/'),existing=entries.find(e=>e.directory&&key(e.path)===key(parent));if(existing&&existing.path!==parent)throw new Error('请保持文件夹名称的大小写：'+existing.path);}if(entries.some(e=>e.path!==except&&key(e.path)===key(name)))throw new Error('已有同名文件或文件夹：'+name);};
  if(action==='newFile'||action==='newFolder')checkNew(file);if(action==='rename')checkNew(target!,file);
  if(file==='LPMake.txt'&&(action==='delete'||action==='rename'))throw new Error('LPMake是项目构建文件，不能删除或重命名');
  if(action==='rename'&&target!.normalize('NFC').toLowerCase().startsWith(file.normalize('NFC').toLowerCase()+'/'))throw new Error('不能把文件夹移到自身内部');
  const state=action==='newFile'?await this.read(lab):undefined,initial=content??(/\.c$/i.test(file)?state?.templates?.c??defaultSource('c'):/\.(cpp|cc|cxx)$/i.test(file)?state?.templates?.cpp??defaultSource('cpp'):'');
  const source=await this.path(lab,file,action==='newFile'||action==='newFolder');
  await this.enqueue(async()=>{
   if(action==='newFile'){await mkdir(path.dirname(source),{recursive:true});await writeFile(source,initial,{encoding:'utf8',flag:'wx'});}
   if(action==='newFolder')await mkdir(source,{recursive:true});
   if(action==='delete')await rm(source,{recursive:true,force:false});
   if(action==='rename'){
    const destination=await this.path(lab,target!,true);await mkdir(path.dirname(destination),{recursive:true});
    if(key(file)===key(target!)){const intermediate=source+'.rename-'+randomUUID();await rename(source,intermediate);try{await rename(intermediate,destination);}catch(e){await rename(intermediate,source);throw e;}}
    else await rename(source,destination);
   }
  });return this.list(lab);
 }
 async flush(){await this.tail;}
}
