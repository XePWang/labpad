import {readFile,writeFile,mkdir,rename,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {stringify} from 'csv-stringify/sync';
import {parse} from 'csv-parse/sync';
import lockfile from 'proper-lockfile';
import writeFileAtomic from 'write-file-atomic';
import {retainVersions} from './versions';
import {Compiler,type RuntimePaths} from '../core/compiler';
import {judge} from '../core/judge';
import {runProcess} from '../core/process';
import {sandboxCommand} from '../core/sandbox';
import {readJSON,exists} from '../core/storage';
import {parseLabPackage,parseTestCases,labDraft} from '../shared/project-format';
import {defaultConfig} from '../shared/defaults';
import type {Draft,CompilerConfig,JudgeResult,Problem} from '../shared/types';
import {readRoster,type Student} from './roster';
import {collect,type Candidate, type Intake} from './collect';
import {score100} from './score';
export interface GradeConfig{schemaVersion:1;project:string;roster:string;hiddenTests?:Record<string,string>;weights:Record<string,number>;compiler?:Partial<CompilerConfig>;isolation?:'bubblewrap'|'none'}
interface Outcome{problemId:string;valid:boolean;empty:boolean;pending:boolean;status:string;passed:number;total:number;candidate?:Candidate;result?:JudgeResult}
interface StudentGrade{student:Student;outcomes:Outcome[]}
interface GradeState{schemaVersion:1;context:string;students:Record<string,StudentGrade>}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function executable(value:string){
 if(path.isAbsolute(value)||value.includes(path.sep))return path.resolve(value);
 for(const dir of (process.env.PATH??'').split(path.delimiter)){const file=path.join(dir,value+(process.platform==='win32'&&!path.extname(value)?'.exe':''));if(await exists(file))return file;}
 throw Error('找不到编译器：'+value+'。请在 grade.json 中填写完整路径。');
}
export async function compilerConfig(value?:Partial<CompilerConfig>):Promise<CompilerConfig>{
 const kind=value?.kind??'gcc',base=defaultConfig().compiler;
 if(!['gcc','zig','clang'].includes(kind))throw Error('编译器类型应为 gcc、clang 或 zig');
 const cPath=await executable(value?.cPath||(kind==='gcc'?'gcc':kind==='clang'?'clang':'zig'));
 const cppPath=kind==='zig'?cPath:await executable(value?.cppPath||(kind==='gcc'?'g++':'clang++'));
 const config={...base,...value,mode:'custom' as const,kind,cPath,cppPath};
 for(const args of [config.cArgs,config.cppArgs,config.linkArgs])if(!Array.isArray(args)||args.some(v=>typeof v!=='string'))throw Error('编译参数应为字符串数组');
 return config;
}
function issueApplies(intake:Intake,id:string,problemId:string){return intake.issues.some(x=>x.pending&&(!x.students.length||x.students.includes(id))&&(!x.problemId||x.problemId===problemId));}
async function gradeStudent(student:Student,problems:Problem[],intake:Intake,compiler:Compiler,config:CompilerConfig,signal?:AbortSignal):Promise<StudentGrade>{
 const outcomes:Outcome[]=[];
 for(const problem of problems){
  signal?.throwIfAborted();const versions=intake.candidates.filter(v=>v.studentId===student.studentId&&v.problemId===problem.problemId);
  let best:{candidate:Candidate;result:JudgeResult;passed:number}|undefined,taskError=false;
  for(const candidate of versions){
   signal?.throwIfAborted();
   let result:JudgeResult;
   if(problem.testCases.length)result=await judge(compiler,{source:candidate.source,language:candidate.language,problem},config,signal);
   else{const prepared=await compiler.compile(candidate.source,candidate.language,config,signal);try{result={status:prepared.compilation.status==='cancelled'?'cancelled':'completed',compiler:prepared.compilation.command[0],comparison:problem.comparison,compilation:prepared.compilation,cases:[]};}finally{await prepared.cleanup();}}
   if(result.status==='cancelled'){signal?.throwIfAborted();throw Error('评测已取消');}
   if(result.status==='error'){taskError=true;continue;}
   const passed=result.cases.filter(c=>c.status==='completed'&&c.verdict==='AC').length;
   if(!best||passed>best.passed)best={candidate,result,passed};
  }
  const total=problem.testCases.length,passed=best?.passed??0;
  const pending=(taskError||issueApplies(intake,student.studentId,problem.problemId))&&!(total>0&&passed===total);
  const empty=intake.empty.some(v=>v.studentId===student.studentId&&v.problemId===problem.problemId);
  outcomes.push({problemId:problem.problemId,valid:versions.length>0,empty,pending,status:pending?'待核对':!versions.length?(empty?'空源码':'未提交'):best?.result.compilation?.status==='CE'?'编译失败':passed===total&&total>0?'通过':total?'未全部通过':'无测试点',passed,total,candidate:best?.candidate,result:best?.result});
 }
 return {student,outcomes};
}
function rows(state:GradeState,roster:Student[],problems:Problem[],weights:Record<string,number>){
 const summary:Record<string,string|number>[]=[],cases:Record<string,string|number>[]=[];
 for(const student of roster){
  const grade=state.students[student.studentId],outcomes=grade?.outcomes??[];
  const pending=outcomes.some(o=>o.pending),pendingScore=outcomes.some(o=>o.pending&&(weights[o.problemId]??0)>0),scores=grade&&!pendingScore?score100(problems.map(p=>({weight:weights[p.problemId]??0,passed:outcomes.find(o=>o.problemId===p.problemId)?.passed??0,total:p.testCases.length}))):undefined;
  const row:Record<string,string|number>={'序号':student.sequence,'学号':student.studentId,'姓名':student.name,'实验':problems[0].labId,'有效文件':grade?(outcomes.some(o=>o.valid)?'是':pending?'待核对':'否'):'未核对','缺交题号':grade?outcomes.filter(o=>!o.valid&&!o.pending).map(o=>o.problemId).join('、'):'','状态':!grade?'未送测':pending?'待核对':'已完成'};
  for(const [index,p] of problems.entries()){
   const o=outcomes.find(v=>v.problemId===p.problemId),prefix=p.problemId+'_';
   row[prefix+'有效文件']=o?(o.valid?'是':o.pending?'待核对':'否'):'未核对';
   row[prefix+'状态']=o?.status??'未送测';row[prefix+'编译']=o?.result?.compilation?.status??'未运行';
   row[prefix+'来源']=o?.candidate?.origin??'';row[prefix+'SHA256']=o?.candidate?.hash??'';row[prefix+'源码']=o?.candidate?.file??'';
   row[prefix+'通过']=o?o.passed:'';row[prefix+'测试点']=p.testCases.length;row[prefix+'得分']=scores?scores.parts[index].toFixed(2):'';
   if(o)for(const test of p.testCases){
    const c=o.result?.cases.find(c=>c.id===test.id),ce=o.result?.compilation?.status==='CE',status=c?.verdict??(ce?'CE':o.pending?'待核对':o.valid?'未运行':o.status);
    const sep=test.id.indexOf(':');
    cases.push({'序号':student.sequence,'学号':student.studentId,'姓名':student.name,'实验':p.labId,'题号':p.problemId,'来源':o.candidate?.origin??'','SHA256':o.candidate?.hash??'','测试点':test.id.slice(sep+1),'范围':test.id.startsWith('hidden:')?'隐藏':'公开','比较模式':(test.comparison??p.comparison).type,'是否运行':c?.status==='completed'?'是':'否','结果':status,'耗时ms':c?c.elapsedMs:'','说明':(c?.message??(ce?'编译失败，测试点未运行':o.status)).slice(0,300)});
   }
  }
  row['得分100']=scores?scores.total.toFixed(2):'';row['满分']=100;row['扣分']=scores?scores.deduction.toFixed(2):'';
  row['依据']=outcomes.filter(o=>o.status!=='通过').map(o=>o.problemId+'：'+o.status+'（'+o.passed+'/'+o.total+'）').join('；');
  row['评语']='';summary.push(row);
 }
 return {summary,cases};
}
async function replaceOutput(lab:string,state:GradeState,summary:Record<string,string|number>[],cases:Record<string,string|number>[],issues:Intake['issues']){
 const output=path.join(lab,'output'),stage=path.join(lab,'build','output-'+randomUUID()),backup=path.join(lab,'build','previous-'+randomUUID());
 await mkdir(stage,{recursive:true});let moved=false;
 try{
  if(await exists(path.join(output,'summary.csv'))){
   const old=parse(await readFile(path.join(output,'summary.csv'),'utf8'),{columns:true,bom:true}) as Record<string,string>[];
   const comments=new Map(old.map(r=>[r['学号'],r['评语']??'']));
   for(const row of summary)row['评语']=comments.get(String(row['学号']))??'';
  }
  const options={header:true,bom:true,record_delimiter:'\r\n',escape_formulas:true};
  await Promise.all([writeFile(path.join(stage,'summary.csv'),stringify(summary,options),'utf8'),writeFile(path.join(stage,'cases.csv'),stringify(cases,{...options,columns:['序号','学号','姓名','实验','题号','来源','SHA256','测试点','范围','比较模式','是否运行','结果','耗时ms','说明']}),'utf8'),writeFile(path.join(stage,'state.json'),JSON.stringify(state,null,2)+'\n'),writeFile(path.join(stage,'intake.json'),JSON.stringify(issues,null,2)+'\n')]);
  if(await exists(output)){await rename(output,backup);moved=true;}
  try{await rename(stage,output);}catch(e){if(moved)await rename(backup,output);throw e;}
  if(moved)await rm(backup,{recursive:true,force:true});
 }finally{await rm(stage,{recursive:true,force:true});}
}
export async function runGrade(lab:string,paths:RuntimePaths,options:{studentId?:string;signal?:AbortSignal;progress?:(message:string)=>void}={}){
 lab=path.resolve(lab);const configFile=path.join(lab,'grade.json'),release=await lockfile.lock(configFile,{realpath:true,retries:0});
 let compiler:Compiler|undefined;
 try{
  const value=await readJSON(configFile) as GradeConfig;
  if(value.schemaVersion!==1||typeof value.project!=='string'||typeof value.roster!=='string'||!value.weights||typeof value.weights!=='object')throw Error('grade.json 需要 schemaVersion: 1、project、roster 和 weights');
  const pkg=parseLabPackage(await readJSON(path.resolve(lab,value.project))),problems:Problem[]=[];
  for(const item of pkg.problems){
   const original=labDraft(pkg,item).problem,problem=structuredClone(original);
   problem.testCases=original.testCases.map(t=>({...t,id:'public:'+t.id,comparison:t.comparison??original.comparison}));
   const hiddenFile=value.hiddenTests?.[item.problemId];
   if(hiddenFile){
    const raw=await readJSON(path.resolve(lab,hiddenFile)) as Record<string,unknown>,hidden=parseTestCases(raw,original);
    if(raw.timeLimitMs!==undefined)problem.timeLimitMs=hidden.timeLimitMs;
    if(raw.outputLimitBytes!==undefined)problem.outputLimitBytes=hidden.outputLimitBytes;
    problem.testCases.push(...hidden.testCases.map(t=>({...t,id:'hidden:'+t.id,comparison:t.comparison??hidden.comparison})));
   }
   if(!Number.isSafeInteger(value.weights[item.problemId]??0)||(value.weights[item.problemId]??0)<0||(value.weights[item.problemId]??0)>100000)throw Error(item.problemId+'：权重应为 0 至 100000 的整数');
   if(value.weights[item.problemId]>0&&!problem.testCases.length)throw Error(item.problemId+'：计分题没有测试点');problems.push(problem);
  }
  if(Object.keys(value.weights).some(id=>!pkg.problems.some(p=>p.problemId===id)))throw Error('weights 中存在项目未定义的题号');
  if(Object.keys(value.hiddenTests??{}).some(id=>!pkg.problems.some(p=>p.problemId===id)))throw Error('hiddenTests 中存在项目未定义的题号');
  score100(problems.map(p=>({weight:value.weights[p.problemId]??0,passed:0,total:p.testCases.length})));
  const roster=await readRoster(path.resolve(lab,value.roster)),config=await compilerConfig(value.compiler),isolation=value.isolation??'bubblewrap';
  if(!['bubblewrap','none'].includes(isolation))throw Error('isolation 应为 bubblewrap 或 none');
  await mkdir(path.join(lab,'build'),{recursive:true});compiler=new Compiler({...paths,workDirectory:path.join(lab,'build'),cacheDirectory:path.join(lab,'build','compiler-cache'),isolation});
  const context=digest([problems,value.weights,roster,config,await compiler.identity(config,'c'),await compiler.identity(config,'cpp'),isolation]);
  let state:GradeState={schemaVersion:1,context,students:{}};
  if(options.studentId){
   if(!roster.some(s=>s.studentId===options.studentId))throw Error('该学号不在点名册中：'+options.studentId);
   if(await exists(path.join(lab,'output','state.json'))){state=await readJSON(path.join(lab,'output','state.json')) as GradeState;if(state.context!==context)throw Error('项目、测试、名单或编译器已变化，请全量重测或使用新的实验目录。');}
  }
  if(isolation==='bubblewrap'){
   if(process.platform!=='linux')throw Error('隔离批测需要 Linux 与 Bubblewrap；可信夹具可显式设置 isolation: none。');
   const check=path.join(await compiler.session,'isolation-check');await mkdir(check);const cmd=sandboxCommand('/usr/bin/true',check);
   let ready;
   try{ready=await runProcess(cmd.program,cmd.args,{cwd:check,timeLimitMs:10000,outputLimitBytes:32768});}catch{throw Error('无法启动 Bubblewrap。请安装 bubblewrap 并允许用户命名空间，详见助教指南。');}
   if(ready.code!==0)throw Error('Bubblewrap 无法建立评测环境：'+ready.stderr.toString('utf8').trim());
  }
  await compiler.info(config);
  for(const language of ['c','cpp'] as const){
   const source=(language==='c'?['#include <stdio.h>','int main(void){return 0;}']:['#include <iostream>','int main(){std::cout << "";return 0;}']).join('\n');
   const prepared=await compiler.compile(source,language,config,options.signal);
   try{if(prepared.compilation.status!=='success')throw Error((language==='c'?'C':'C++')+' 工具链自检失败，请检查编译器及参数：\n'+prepared.compilation.stderr);}finally{await prepared.cleanup();}
  }
  const intake=await collect(path.join(lab,'submit'),path.join(lab,'src'),roster,problems.map(p=>p.problemId),pkg.labId);
  const versions=await retainVersions(lab,pkg.labId,roster.map(s=>s.studentId),problems.map(p=>p.problemId),intake);
  await writeFileAtomic(path.join(lab,'src','index.json'),JSON.stringify(versions,null,2)+'\n');
  const selected=options.studentId?roster.filter(s=>s.studentId===options.studentId):roster;
  for(const [index,student] of selected.entries()){
   options.signal?.throwIfAborted();options.progress?.('评测 '+(index+1)+' / '+selected.length);
   state.students[student.studentId]=await gradeStudent(student,problems,intake,compiler,config,options.signal);
  }
  options.signal?.throwIfAborted();
  const report=rows(state,roster,problems,value.weights);
  // Sources are kept in src; avoid repeating them in the intermediate report.
  const persisted=JSON.parse(JSON.stringify(state, (key,v)=>key==='source'?undefined:v)) as GradeState;
  await replaceOutput(lab,persisted,report.summary,report.cases,intake.issues);
  options.progress?.('已写入 '+path.join(lab,'output','summary.csv')+' 和 cases.csv');
  return {summary:report.summary,cases:report.cases,state:persisted,issues:intake.issues};
 }finally{await compiler?.dispose();await release();}
}
