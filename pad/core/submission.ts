import {createHash} from 'node:crypto';
import {zipSync,strToU8} from 'fflate';
import {defaultSource} from '../shared/defaults';
import {filePart,validateDraft} from '../shared/validate';
import {Storage,exportName} from './storage';
import type {CompilerConfig,Config,Draft,JudgeResult,Language,ExportPreview,ExportProblem,Coverage} from '../shared/types';
import type {CheckRecord} from '../shared/project-format';
export type Submission=ExportPreview;
export interface SubmissionServices{identity(language:Language):Promise<string>;format(source:string,language:Language):Promise<string>}
export function fingerprint(draft:Draft,compiler:CompilerConfig,identity:string){
 const p=draft.problem;
 return createHash('sha256').update(JSON.stringify([draft.language,draft.source.replace(/^\uFEFF/,''),p.labId,p.problemId,p.timeLimitMs,p.outputLimitBytes,
  p.comparison,p.testCases.map(t=>[t.id,t.input,t.expectedOutput,t.comparison??p.comparison]),compiler,identity])).digest('hex');
}
export function checkRecord(draft:Draft,hash:string,result?:JudgeResult,previous?:CheckRecord):CheckRecord{
 const total=draft.problem.testCases.length,selected=new Set(result?.selectedCaseIds??draft.problem.testCases.map(t=>t.id));
 const old=previous?.fingerprint===hash?previous.cases??[]:[];
 const cases=result?[...old.filter(c=>!selected.has(c.id)),...(result.compilation?.status==='success'?result.cases:[])]:old;
 const ordered=draft.problem.testCases.flatMap(t=>cases.filter(c=>c.id===t.id));
 const passed=ordered.filter(c=>c.status==='completed'&&c.verdict==='AC').length;
 const status:CheckRecord['status']=!result?'running':result.status==='error'?'error':result.status==='cancelled'?'cancelled':
  total>0&&result.compilation?.status==='success'&&ordered.length===total&&passed===total?'passed':'failed';
 return {fingerprint:hash,passed,total,status,checkedAt:new Date().toISOString(),compilationStatus:result?.compilation?.status,cases:ordered};
}
export async function storedCheck(storage:Storage,draft:Draft){
 const state=await storage.projectState(draft.problem.labId,draft.problem.problemId,draft.language);
 return draft.documentId?state.documents?.find(v=>v.id===draft.documentId)?.check:state.checks[draft.language];
}
export async function coverage(storage:Storage,draft:Draft,config:Config,identity:string):Promise<Coverage>{
 const record=await storedCheck(storage,draft),total=draft.problem.testCases.length;
 if(!total||!record)return {state:'未测',cases:[]};
 if(record.fingerprint!==fingerprint(draft,config.compiler,identity))return {state:'需重测',cases:[]};
 if(record.compilationStatus==='CE')return {state:'未通过',cases:record.cases??[]};
 if(record.status==='running')return {state:'运行中',cases:record.cases??[]};
 if(record.status==='passed'&&record.passed===total&&record.cases?.length===total)return {state:'通过',cases:record.cases};
 const cases=record.cases??[];
 return {state:cases.some(c=>c.verdict&&c.verdict!=='AC')||record.status==='error'?'未通过':cases.length<total?'部分已测':'未通过',cases};
}
function identityWarning(config:Config){
 const missing=[['班号',config.classId],['姓名',config.name],['学号',config.studentId]].filter(([,value])=>!value.trim()).map(([label])=>label);
 return missing.length?'未填写身份信息：'+missing.join('、')+'。':'';
}
function submissionFolder(config:Config,labId:string){
 const values=[config.classId.trim()||'未填班号',config.name.trim()||'未填姓名',config.studentId.trim()||'未填学号',labId];
 values.forEach((value,i)=>filePart(value,['班号','姓名','学号','项目名'][i]));return values.join('_');
}
async function testStatus(storage:Storage,draft:Draft,config:Config,identity:string){
 if(!draft.problem.testCases.length)return '未设置测试点';
 const record=await storedCheck(storage,draft);
 if(!record)return '尚未测试';
 if(record.fingerprint!==fingerprint(draft,config.compiler,identity))return '内容或编译器已变更，需重新测试';
 if(record.status==='passed'&&record.total===draft.problem.testCases.length&&record.passed===record.total)return '';
 if(record.status==='running'||record.status==='cancelled')return '测试未完成';
 if(record.status==='error')return '测试执行出错';
 return record.passed+'/'+record.total+' 个测试点通过';
}
export async function prepareSource(storage:Storage,value:Draft,config:Config,services:SubmissionServices):Promise<Submission>{
 const draft=structuredClone(validateDraft(value)),warnings:string[]=[],status=await testStatus(storage,draft,config,await services.identity(draft.language));
 if(status)warnings.push('尚未全部通过：'+(draft.problem.problemId||'空项目')+'（'+status+'）。');
 const missing=identityWarning(config);if(missing)warnings.push(missing);
 return {kind:'source',name:exportName(draft,config.studentId),labId:draft.problem.labId,files:[{name:exportName(draft,config.studentId),source:draft.source}],warnings};
}
export async function exportChoices(storage:Storage,current:Draft,buffers:Draft[]):Promise<ExportProblem[]>{
 const labId=filePart(current.problem.labId,'实验项目'),project=(await storage.projects()).find(p=>p.labId===labId);
 if(!project?.problems.length)throw new Error('当前实验项目没有题目，请先新建或导入题目');
 const overlays=new Map(buffers.filter(d=>d.problem.labId===labId).map(d=>[d.documentId,d]));
 return Promise.all(project.problems.map(async problemId=>({problemId,versions:(await storage.allDocuments(labId,problemId,'c')).map(d=>({...d,...(overlays.get(d.documentId)??{}),modifiedAt:d.modifiedAt}))})));
}
export async function prepareProject(storage:Storage,value:Draft,config:Config,services:SubmissionServices,chosen?:Draft[]):Promise<Submission>{
 const current=structuredClone(validateDraft(value)),labId=filePart(current.problem.labId,'实验项目');
 let drafts:Draft[];
 if(chosen)drafts=chosen.map(d=>structuredClone(validateDraft(d)));
 else{
  const project=(await storage.projects()).find(lab=>lab.labId===labId),ids=[...(project?.problems??[])];
  if(current.problem.problemId&&!ids.includes(current.problem.problemId))ids.push(current.problem.problemId);
  drafts=[];
  for(const id of ids){
   if(id!==current.problem.problemId)await storage.openDocuments(labId,id,'c');
   drafts.push(id===current.problem.problemId?current:await storage.load(labId,id,'c',true));
  }
 }
 if(!drafts.length)throw new Error('请至少选择一份源码');
 const known=(await storage.projects()).find(p=>p.labId===labId)?.problems??[];
 const unique=new Set<string>();
 for(const d of drafts){
  if(d.problem.labId!==labId||!d.problem.problemId||!known.includes(d.problem.problemId))throw new Error('所选源码不属于当前实验项目');
  const key=d.documentId??d.problem.problemId+':'+d.language;if(unique.has(key))throw new Error('同一源码版本不能重复导出');unique.add(key);
 }
 const files:Submission['files']=[],unedited:string[]=[],unpassed:string[]=[],warnings:string[]=[],counts=new Map<string,number>(),names=new Set<string>();
 const identities=new Map<Language,string>();
 for(const draft of drafts){
  const id=draft.problem.problemId,state=await storage.projectState(labId,id,draft.language),version=state.documents?.find(v=>v.id===draft.documentId),starter=version?.starter??state.starters[draft.language]??defaultSource(draft.language);
  const multi=drafts.filter(d=>d.problem.problemId===id).length>1,label=multi?id+' / '+(version?.file??draft.documentId):id;
  let same=draft.source.replace(/\r\n/g,'\n').trim()===starter.replace(/\r\n/g,'\n').trim();
  if(!same){try{same=(await services.format(draft.source,draft.language)).trim()===(await services.format(starter,draft.language)).trim();}catch{}}
  if(same||!draft.source.trim())unedited.push(label);
  if(!identities.has(draft.language))identities.set(draft.language,await services.identity(draft.language));
  const status=await testStatus(storage,draft,config,identities.get(draft.language)!);if(status)unpassed.push(label+'（'+status+'）');
  const n=(counts.get(id)??0)+1;counts.set(id,n);
  const name=exportName(draft,config.studentId).replace(/\.(c|cpp)$/,(ext)=> (n>1?'_v'+n:'')+ext),key=name.normalize('NFC').toLowerCase();
  if(names.has(key))throw new Error('导出文件名冲突：'+name+'。请调整题号或所选版本。');names.add(key);
  files.push({name,source:draft.source});
 }
 if(unedited.length)warnings.unshift('未编辑源码：'+unedited.join('、')+'。');
 if(unpassed.length)warnings.push('尚未全部通过：'+unpassed.join('、')+'。');
 if(!current.problem.problemId)warnings.push('当前代码尚未分配题号，不会加入实验项目。');
 const missing=identityWarning(config);if(missing)warnings.push(missing);
 return {kind:'project',name:submissionFolder(config,labId)+'.zip',labId,files,warnings};
}
export function submissionZip(submission:Submission):Uint8Array{
 const folder=submission.name.replace(/\.zip$/i,''),files:Record<string,Uint8Array>={};
 filePart(folder,'提交文件夹');
 for(const file of submission.files){filePart(file.name,'源码文件名');const name=folder+'/'+file.name;if(Object.hasOwn(files,name))throw new Error('重复导出文件：'+file.name);files[name]=strToU8(file.source.replace(/^\uFEFF/,''));}
 return zipSync(files,{level:6});
}
