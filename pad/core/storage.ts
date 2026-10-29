import {mkdir,readFile,writeFile,rename,access,readdir,cp,stat,mkdtemp,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import iconv from 'iconv-lite';
import writeFileAtomic from 'write-file-atomic';
import {defaultConfig,defaultProblem,defaultSource} from '../shared/defaults';
import {filePart,selection,validateConfig,validateDraft,validateProblem} from '../shared/validate';
import {parseLabPackage,labDraft} from '../shared/project-format';
import type {CheckRecord,LabState,ProblemState} from '../shared/project-format';
import type {Config,Draft,LoadedDraft,Language,Problem,Project} from '../shared/types';
export function decodeText(bytes:Buffer):{text:string;encoding:string}{
 try{return {text:new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,''),encoding:'UTF-8'};}
 catch{const text=iconv.decode(bytes,'cp936');if(!iconv.encode(text,'cp936').equals(bytes))throw new Error('无法完整识别文件编码，请先将文件另存为 UTF-8');return {text,encoding:'GBK / CP936'};}
}
export async function writeSource(file:string,source:string,encoding='UTF-8'){
 const text=source.replace(/^\uFEFF/,''),bytes=encoding==='GBK / CP936'?iconv.encode(text,'cp936'):Buffer.from(text,'utf8');
 if(encoding==='GBK / CP936'&&iconv.decode(bytes,'cp936')!==text)throw new Error('源码包含 GBK 无法保存的字符；请先将文件另存为 UTF-8');
 await writeFileAtomic(file,bytes);
}
export async function readJSON(file:string):Promise<unknown>{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readFile(file)).replace(/^\uFEFF/,''));}
export async function exists(file:string){try{await access(file);return true;}catch(e:any){if(e.code==='ENOENT')return false;throw e;}}
export function exportName(draft:Draft,studentId:string){
 const name=draft.problem.problemId||'空项目',id=studentId.trim();filePart(name,'题号');
 if(id)filePart(id,'学号');return (id?id+'_':'')+name+(draft.language==='c'?'.c':'.cpp');
}
export class Storage{
 private tail:Promise<unknown>=Promise.resolve();
 constructor(readonly root:string){}
 private enqueue<T>(task:()=>Promise<T>){const next=this.tail.then(task,task);this.tail=next.catch(()=>{});return next;}
 private async atomic(file:string,content:string){await writeFileAtomic(file,content,{encoding:'utf8'});}
 async init():Promise<Config>{
  await mkdir(this.root,{recursive:true});await access(this.root,constants.W_OK);
  const file=path.join(this.root,'config.json');
  if(await exists(file)){
   const value=await readJSON(file) as Config;
   return validateConfig({...value,saveMode:value.saveMode??'manual',sourceFile:value.sourceFile??null,indentSize:value.indentSize??4,theme:value.theme??'dark',formatOnSave:value.formatOnSave??true,layout:value.layout??{editorPercent:53,outputPercent:28}});
  }
  const config=defaultConfig();await this.saveConfig(config);return config;
 }
 saveConfig(config:Config){
  const snapshot=structuredClone(validateConfig(config));
  return this.enqueue(()=>this.atomic(path.join(this.root,'config.json'),JSON.stringify(snapshot,null,2)+'\n'));
 }
 paths(labId:string,problemId:string,language:Language){
  selection(labId,problemId);
  const dir=problemId?path.join(this.root,'projects',labId):this.root,base=problemId||'空项目';
  return {dir,source:path.join(dir,base+(language==='c'?'.c':'.cpp')),problem:path.join(dir,base+'.json')};
 }
 private statePath(labId:string,problemId:string){return path.join(this.paths(labId,problemId,'c').dir,'.labpad');}
 private async readState(labId:string,problemId:string):Promise<LabState>{
  const file=this.statePath(labId,problemId),id=problemId?labId:'';
  if(!await exists(file))return {schemaVersion:1,labId:id,problems:{}};
  const value=await readJSON(file) as LabState;
  if(!value||value.schemaVersion!==1||value.labId!==id||!value.problems||typeof value.problems!=='object'||Array.isArray(value.problems))throw new Error('项目状态文件格式无效：'+file);
  return value;
 }
 private stateFor(meta:LabState,id:string,language:Language):ProblemState{
  const current=Object.hasOwn(meta.problems,id)?meta.problems[id]:undefined;
  if(!current)return {language,starters:{},checks:{},sources:{}};
  if(!['c','cpp'].includes(current.language)||!current.starters||!current.checks)throw new Error('题目状态记录格式无效：'+id);
  return {...current,sources:current.sources??{}};
 }
 private async writeState(labId:string,problemId:string,meta:LabState){await mkdir(this.paths(labId,problemId,'c').dir,{recursive:true});await this.atomic(this.statePath(labId,problemId),JSON.stringify(meta,null,2)+'\n');}
 async projectState(labId:string,problemId:string,language:Language){await this.flush();return this.stateFor(await this.readState(labId,problemId),problemId,language);}
 async load(labId:string,problemId:string,language:Language,preferStored=false):Promise<LoadedDraft>{
  await this.flush();let p=this.paths(labId,problemId,language);
  const problem=await exists(p.problem)?validateProblem(await readJSON(p.problem)):defaultProblem(labId,problemId);
  if(!problemId){problem.labId=labId;problem.problemId='';}
  else if(problem.labId!==labId||problem.problemId!==problemId)throw new Error('题目文件中的 labId / problemId 与文件位置不一致');
  const meta=await this.readState(labId,problemId),stored=Object.hasOwn(meta.problems,problemId)?this.stateFor(meta,problemId,language):undefined;
  if(preferStored&&problemId){
   if(stored)language=stored.language;
   else if(!await exists(p.source)){const other:Language=language==='c'?'cpp':'c';if(await exists(this.paths(labId,problemId,other).source))language=other;}
  }
  p=this.paths(labId,problemId,language);let warning:string|undefined;
  const binding=problemId?stored?.sources[language]:undefined;
  if(binding){
   try{const decoded=decodeText(await readFile(binding.path));return {language,source:decoded.text,problem,sourceFile:binding.path,sourceEncoding:decoded.encoding};}
   catch{warning='关联源码无法读取：'+binding.path+'；现显示项目内的源码，请检查原文件位置。';}
  }
  const draft:LoadedDraft={language,source:await exists(p.source)?decodeText(await readFile(p.source)).text:defaultSource(language),problem};
  if(warning)draft.warning=warning;return draft;
 }
 save(draft:Draft,saveSource=true){
  const snapshot=structuredClone(validateDraft(draft)),p=this.paths(snapshot.problem.labId,snapshot.problem.problemId,snapshot.language);
  return this.enqueue(async()=>{
   await mkdir(p.dir,{recursive:true});
   if(saveSource)await this.atomic(p.source,snapshot.source.replace(/^\uFEFF/,''));
   await this.atomic(p.problem,JSON.stringify(snapshot.problem,null,2)+'\n');
   if(saveSource){
    const meta=await this.readState(snapshot.problem.labId,snapshot.problem.problemId),state=this.stateFor(meta,snapshot.problem.problemId,snapshot.language);
    state.language=snapshot.language;state.starters[snapshot.language]??=defaultSource(snapshot.language);delete state.sources[snapshot.language];
    meta.problems={...meta.problems,[snapshot.problem.problemId]:state};await this.writeState(snapshot.problem.labId,snapshot.problem.problemId,meta);
   }
  });
 }
 bindSource(labId:string,problemId:string,language:Language,file:string,encoding:string){
  if(!problemId)return Promise.resolve();
  selection(labId,problemId);
  return this.enqueue(async()=>{
   const meta=await this.readState(labId,problemId),state=this.stateFor(meta,problemId,language);state.language=language;state.starters[language]??=defaultSource(language);state.sources[language]={path:file,encoding};
   meta.problems={...meta.problems,[problemId]:state};await this.writeState(labId,problemId,meta);
  });
 }
 recordCheck(draft:Draft,record:CheckRecord){
  const d=structuredClone(validateDraft(draft));
  return this.enqueue(async()=>{
   const meta=await this.readState(d.problem.labId,d.problem.problemId),state=this.stateFor(meta,d.problem.problemId,d.language);
   state.starters[d.language]??=defaultSource(d.language);state.checks[d.language]=structuredClone(record);
   meta.problems={...meta.problems,[d.problem.problemId]:state};await this.writeState(d.problem.labId,d.problem.problemId,meta);
  });
 }
 async projects():Promise<Project[]>{
  await this.flush();const base=path.join(this.root,'projects');if(!await exists(base))return [];
  const result:Project[]=[];
  for(const item of await readdir(base,{withFileTypes:true})){
   if(!item.isDirectory())continue;try{filePart(item.name,'项目');}catch{continue;}
   const problems:string[]=[];
   for(const file of await readdir(path.join(base,item.name),{withFileTypes:true})){
    if(!file.isFile()||!file.name.endsWith('.json'))continue;
    const name=file.name.slice(0,-5);try{filePart(name,'题号');problems.push(name);}catch{}
   }
   const order=(await this.readState(item.name,'_')).order??[];
   problems.sort((a,b)=>{const ai=order.indexOf(a),bi=order.indexOf(b);return (ai<0?Number.MAX_SAFE_INTEGER:ai)-(bi<0?Number.MAX_SAFE_INTEGER:bi)||a.localeCompare(b,undefined,{numeric:true});});
   result.push({labId:item.name,problems});
  }
  return result.sort((a,b)=>a.labId.localeCompare(b.labId,undefined,{numeric:true}));
 }
 async nextLabName(name:string){
  filePart(name,'项目名称');const names=new Set((await this.projects()).map(p=>p.labId.normalize('NFC').toLowerCase()));let value=name,index=2;
  while(names.has(value.normalize('NFC').toLowerCase()))value=name+' ('+index+++')';return value;
 }
 async importProject(value:unknown,targetLabId?:string){
  const lab=parseLabPackage(value),id=filePart(targetLabId??lab.labId,'项目名称');
  return this.enqueue(async()=>{
   const base=path.join(this.root,'projects');await mkdir(base,{recursive:true});
   const names=await readdir(base);if(names.some(name=>name.normalize('NFC').toLowerCase()===id.normalize('NFC').toLowerCase()))throw new Error('项目已存在，请重新导入并选择副本');
   const destination=path.join(base,id),temporary=await mkdtemp(path.join(this.root,'.import-'));
   try{
    const meta:LabState={schemaVersion:1,labId:id,order:lab.problems.map(p=>p.problemId),problems:{}};
    for(const item of lab.problems){
     const draft=labDraft(lab,item,id),prefix=path.join(temporary,item.problemId);
     await writeFile(prefix+(item.language==='c'?'.c':'.cpp'),item.source.replace(/^\uFEFF/,''),'utf8');
     await writeFile(prefix+'.json',JSON.stringify(draft.problem,null,2)+'\n','utf8');
     meta.problems={...meta.problems,[item.problemId]:{language:item.language,starters:{[item.language]:item.source},checks:{},sources:{}}};
    }
    await writeFile(path.join(temporary,'.labpad'),JSON.stringify(meta,null,2)+'\n','utf8');
    await rename(temporary,destination);return {labId:id,problemId:lab.problems[0].problemId,language:lab.problems[0].language};
   }catch(error){await rm(temporary,{recursive:true,force:true});throw error;}
  });
 }
 async createLab(name:string){
  await this.flush();const dir=path.join(this.root,'projects',filePart(name,'项目名'));
  if(await exists(dir))throw new Error('项目已存在，请从下拉菜单中选择');await mkdir(dir,{recursive:true});
 }
 async createProblem(lab:string,name:string,language:Language){
  filePart(lab,'项目名');filePart(name,'题号');await this.flush();
  if(!await exists(path.join(this.root,'projects',lab)))throw new Error('请先新建或选择实验项目');
  if(await exists(this.paths(lab,name,language).problem))throw new Error('题号已存在，请从下拉菜单中选择');
  const draft={source:defaultSource(language),language,problem:defaultProblem(lab,name)};await this.save(draft);return draft;
 }
 async copyDataTo(target:string){
  await this.flush();const names=['projects','空项目.c','空项目.cpp','空项目.json','.labpad'];
  for(const name of [...names,'config.json'])if(await exists(path.join(target,name)))throw new Error('目标目录已有 LabPad 数据，请选择其他目录，避免覆盖');
  const projects=path.join(this.root,'projects'),relative=path.relative(projects,target);
  if(relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw new Error('数据目录不能放在当前 projects 目录内部');
  for(const name of names)if(await exists(path.join(this.root,name)))await cp(path.join(this.root,name),path.join(target,name),{recursive:true,force:false,errorOnExist:true});
 }
 async flush(){await this.tail;}
}

export async function importPairs(files:string[],labId:string,problemId:string):Promise<Problem>{
 const groups=new Map<string,{input?:string;answers:string[]}>();
 for(const file of files){
  const ext=path.extname(file).toLowerCase();
  if(!['.in','.out','.ans'].includes(ext))throw new Error('请选择 .in 和同名 .out / .ans 文件');
  const key=path.join(path.dirname(file),path.basename(file).slice(0,-ext.length)),group=groups.get(key)??{answers:[]};
  if(ext==='.in')group.input=file;else group.answers.push(file);groups.set(key,group);
 }
 const problem=defaultProblem(labId,problemId);
 for(const [key,group] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
  if(!group.input||group.answers.length!==1)throw new Error(path.basename(key)+' 缺少文件对，或同时存在 .out 与 .ans');
  const id=path.basename(key);if(problem.testCases.some(t=>t.id===id))throw new Error('不同目录出现同名测试点：'+id);
  problem.testCases.push({id,input:decodeText(await readFile(group.input)).text,expectedOutput:decodeText(await readFile(group.answers[0])).text});
 }
 if(!problem.testCases.length)throw new Error('未找到完整测试点');return problem;
}
