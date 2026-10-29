import {mkdir,readFile,writeFile,rename,access,readdir,cp,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import iconv from 'iconv-lite';
import writeFileAtomic from 'write-file-atomic';
import {defaultConfig,defaultProblem,defaultSource} from '../shared/defaults';
import {filePart,selection,validateConfig,validateDraft,validateProblem} from '../shared/validate';
import type {Config,Draft,Language,Problem,Project} from '../shared/types';
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
 const name=draft.problem.problemId||'空项目';filePart(name,'题号');
 if(studentId.trim())filePart(studentId,'学号');
 return (studentId.trim()?studentId+'_':'')+name+(draft.language==='c'?'.c':'.cpp');
}
export class Storage{
 private tail:Promise<void>=Promise.resolve();
 constructor(readonly root:string){}
 private enqueue(task:()=>Promise<void>){const next=this.tail.then(task,task);this.tail=next;return next;}
 private async atomic(file:string,content:string){const temporary=file+'.tmp';await writeFile(temporary,content,'utf8');await rename(temporary,file);}
 async init():Promise<Config>{
  await mkdir(this.root,{recursive:true});await access(this.root,constants.W_OK);
  const file=path.join(this.root,'config.json');
  if(await exists(file)){
   const value=await readJSON(file) as Config;
   return validateConfig({...value,saveMode:value.saveMode??'manual',sourceFile:value.sourceFile??null,indentSize:value.indentSize??4,theme:value.theme??'dark',formatOnSave:value.formatOnSave??true});
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
 async load(labId:string,problemId:string,language:Language):Promise<Draft>{
  await this.flush();const p=this.paths(labId,problemId,language);
  const problem=await exists(p.problem)?validateProblem(await readJSON(p.problem)):defaultProblem(labId,problemId);
  if(!problemId){problem.labId=labId;problem.problemId='';}
  else if(problem.labId!==labId||problem.problemId!==problemId)throw new Error('题目文件中的 labId / problemId 与文件位置不一致');
  return {language,source:await exists(p.source)?decodeText(await readFile(p.source)).text:defaultSource(language),problem};
 }
 save(draft:Draft,saveSource=true){
  const snapshot=structuredClone(validateDraft(draft)),p=this.paths(snapshot.problem.labId,snapshot.problem.problemId,snapshot.language);
  return this.enqueue(async()=>{
   await mkdir(p.dir,{recursive:true});
   if(saveSource)await this.atomic(p.source,snapshot.source.replace(/^\uFEFF/,''));
   await this.atomic(p.problem,JSON.stringify(snapshot.problem,null,2)+'\n');
  });
 }
 async projects():Promise<Project[]>{
  await this.flush();const base=path.join(this.root,'projects');
  if(!await exists(base))return [];
  const result:Project[]=[];
  for(const item of await readdir(base,{withFileTypes:true})){
   if(!item.isDirectory())continue;
   try{filePart(item.name,'项目');}catch{continue;}
   const problems:string[]=[];
   for(const file of await readdir(path.join(base,item.name),{withFileTypes:true})){
    if(!file.isFile()||!file.name.endsWith('.json'))continue;
    const name=file.name.slice(0,-5);try{filePart(name,'题号');problems.push(name);}catch{}
   }
   result.push({labId:item.name,problems:problems.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))});
  }
  return result.sort((a,b)=>a.labId.localeCompare(b.labId,undefined,{numeric:true}));
 }
 async createLab(name:string){
  await this.flush();const dir=path.join(this.root,'projects',filePart(name,'项目名'));
  if(await exists(dir))throw new Error('项目已存在，请从下拉菜单中选择');
  await mkdir(dir,{recursive:true});
 }
 async createProblem(lab:string,name:string,language:Language){
  filePart(lab,'项目名');filePart(name,'题号');await this.flush();
  if(!await exists(path.join(this.root,'projects',lab)))throw new Error('请先新建或选择实验项目');
  if(await exists(this.paths(lab,name,language).problem))throw new Error('题号已存在，请从下拉菜单中选择');
  const draft={source:defaultSource(language),language,problem:defaultProblem(lab,name)};
  await this.save(draft);return draft;
 }
 async copyDataTo(target:string){
  await this.flush();
  const names=['projects','空项目.c','空项目.cpp','空项目.json'];
  for(const name of [...names,'config.json'])if(await exists(path.join(target,name)))throw new Error('目标目录已有 LabPad 数据，请选择其他目录，避免覆盖');
  const projects=path.join(this.root,'projects'),relative=path.relative(projects,target);
  if(relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))
   throw new Error('数据目录不能放在当前 projects 目录内部');
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
