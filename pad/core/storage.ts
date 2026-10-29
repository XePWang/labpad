import {mkdir,readFile,writeFile,rename,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import iconv from 'iconv-lite';
import {defaultConfig,defaultProblem,defaultSource} from '../shared/defaults';
import {filePart,validateConfig,validateDraft,validateProblem} from '../shared/validate';
import type {Config,Draft,Language,Problem} from '../shared/types';
export function decodeText(bytes:Buffer):{text:string;encoding:string}{
 try{return {text:new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,''),encoding:'UTF-8'};}
 catch{
  const text=iconv.decode(bytes,'cp936');
  if(!iconv.encode(text,'cp936').equals(bytes))throw new Error('无法完整识别文件编码，请先将文件另存为 UTF-8');
  return {text,encoding:'GBK / CP936'};
 }
}
export async function readJSON(file:string):Promise<unknown>{
 const bytes=await readFile(file);
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,''));
}
async function exists(file:string):Promise<boolean>{
 try{await access(file);return true;}catch(e:any){if(e.code==='ENOENT')return false;throw e;}
}
export class Storage{
 private tail:Promise<void>=Promise.resolve();
 constructor(readonly root:string){}
 private enqueue(task:()=>Promise<void>):Promise<void>{
  const next=this.tail.then(task,task);this.tail=next;return next;
 }
 private async atomic(file:string,content:string){
  const temporary=file+'.tmp';
  await writeFile(temporary,content,'utf8');await rename(temporary,file);
 }
 async init():Promise<Config>{
  await mkdir(this.root,{recursive:true});await access(this.root,constants.W_OK);
  const file=path.join(this.root,'config.json');
  if(await exists(file))return validateConfig(await readJSON(file));
  const config=defaultConfig();await this.saveConfig(config);return config;
 }
 saveConfig(config:Config):Promise<void>{
  const snapshot=structuredClone(validateConfig(config));
  return this.enqueue(()=>this.atomic(path.join(this.root,'config.json'),JSON.stringify(snapshot,null,2)+'\n'));
 }
 paths(labId:string,problemId:string,language:Language){
  const dir=path.join(this.root,'projects',filePart(labId,'实验名称'));
  const base=filePart(problemId,'题号');
  return {dir,source:path.join(dir,base+(language==='c'?'.c':'.cpp')),problem:path.join(dir,base+'.json')};
 }
 async load(labId:string,problemId:string,language:Language):Promise<Draft>{
  await this.flush();const p=this.paths(labId,problemId,language);
  const problem=await exists(p.problem)?validateProblem(await readJSON(p.problem)):defaultProblem(labId,problemId);
  if(problem.labId!==labId||problem.problemId!==problemId)throw new Error('题目文件中的 labId / problemId 与文件位置不一致');
  return {language,source:await exists(p.source)?decodeText(await readFile(p.source)).text:defaultSource(language),problem};
 }
 save(draft:Draft):Promise<void>{
  const snapshot=structuredClone(validateDraft(draft)),p=this.paths(snapshot.problem.labId,snapshot.problem.problemId,snapshot.language);
  return this.enqueue(async()=>{
   await mkdir(p.dir,{recursive:true});
   await this.atomic(p.source,snapshot.source.replace(/^\uFEFF/,''));
   await this.atomic(p.problem,JSON.stringify(snapshot.problem,null,2)+'\n');
  });
 }
 async flush(){await this.tail;}
}
export async function importPairs(files:string[],labId:string,problemId:string):Promise<Problem>{
 const groups=new Map<string,{input?:string;answers:string[]}>();
 for(const file of files){
  const ext=path.extname(file).toLowerCase();
  if(!['.in','.out','.ans'].includes(ext))throw new Error('请选择 .in 和同名 .out / .ans 文件');
  const key=path.join(path.dirname(file),path.basename(file).slice(0,-ext.length)),group=groups.get(key)??{answers:[]};
  if(ext==='.in')group.input=file;else group.answers.push(file);
  groups.set(key,group);
 }
 const problem=defaultProblem(labId,problemId);problem.testCases=[];
 for(const [key,group] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
  if(!group.input||group.answers.length!==1)throw new Error(path.basename(key)+' 缺少文件对，或同时存在 .out 与 .ans');
  const id=path.basename(key);
  if(problem.testCases.some(t=>t.id===id))throw new Error('不同目录出现同名测试点：'+id);
  problem.testCases.push({id,input:decodeText(await readFile(group.input)).text,
   expectedOutput:decodeText(await readFile(group.answers[0])).text});
 }
 if(!problem.testCases.length)throw new Error('未找到完整测试点');
 return problem;
}
