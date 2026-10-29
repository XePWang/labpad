import {createHash} from 'node:crypto';
import {zipSync,strToU8} from 'fflate';
import {defaultSource} from '../shared/defaults';
import {filePart,validateDraft} from '../shared/validate';
import {Storage,exportName} from './storage';
import type {CompilerConfig,Config,Draft,JudgeResult,Language} from '../shared/types';
import type {CheckRecord} from '../shared/project-format';
export interface Submission{kind:'source'|'project';name:string;labId:string;files:{name:string;source:string}[];warnings:string[]}
export interface SubmissionServices{identity(language:Language):Promise<string>;format(source:string,language:Language):Promise<string>}
export function fingerprint(draft:Draft,compiler:CompilerConfig,identity:string){
 const p=draft.problem,c=p.comparison;
 return createHash('sha256').update(JSON.stringify([draft.language,draft.source.replace(/^\uFEFF/,''),p.labId,p.problemId,p.timeLimitMs,p.outputLimitBytes,
  c.type,c.type==='floatTokens'?c.absoluteTolerance:null,c.type==='floatTokens'?c.relativeTolerance:null,
  p.testCases.map(t=>[t.id,t.input,t.expectedOutput]),compiler,identity])).digest('hex');
}
export function checkRecord(draft:Draft,hash:string,result?:JudgeResult):CheckRecord{
 const total=draft.problem.testCases.length,passed=result?.cases.filter(c=>c.status==='completed'&&c.verdict==='AC').length??0;
 const status:CheckRecord['status']=!result?'running':result.status==='error'?'error':result.status==='cancelled'?'cancelled':
  total>0&&result.compilation?.status==='success'&&result.cases.length===total&&passed===total?'passed':'failed';
 return {fingerprint:hash,passed,total,status,checkedAt:new Date().toISOString()};
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
 const total=draft.problem.testCases.length;
 if(!total)return '未设置测试点';
 const record=(await storage.projectState(draft.problem.labId,draft.problem.problemId,draft.language)).checks[draft.language];
 if(!record)return '尚未测试';
 if(record.fingerprint!==fingerprint(draft,config.compiler,identity))return '内容或编译器已变更，需重新测试';
 if(record.status==='passed'&&record.total===total&&record.passed===total)return '';
 if(record.status==='running'||record.status==='cancelled')return '测试未完成';
 if(record.status==='error')return '测试执行出错';
 return record.passed+'/'+total+' 个测试点通过';
}
export async function prepareSource(storage:Storage,value:Draft,config:Config,services:SubmissionServices):Promise<Submission>{
 const draft=structuredClone(validateDraft(value)),warnings:string[]=[],status=await testStatus(storage,draft,config,await services.identity(draft.language));
 if(status)warnings.push('尚未全部通过：'+(draft.problem.problemId||'空项目')+'（'+status+'）。');
 const missing=identityWarning(config);if(missing)warnings.push(missing);
 return {kind:'source',name:exportName(draft,config.studentId),labId:draft.problem.labId,files:[{name:exportName(draft,config.studentId),source:draft.source}],warnings};
}
export async function prepareProject(storage:Storage,value:Draft,config:Config,services:SubmissionServices):Promise<Submission>{
 const current=structuredClone(validateDraft(value)),labId=filePart(current.problem.labId,'实验项目');
 const project=(await storage.projects()).find(lab=>lab.labId===labId);
 const ids=[...(project?.problems??[])];if(current.problem.problemId&&!ids.includes(current.problem.problemId))ids.push(current.problem.problemId);
 if(!ids.length)throw new Error('当前实验项目没有题目，请先新建或导入题目');
 const files:Submission['files']=[],unedited:string[]=[],unpassed:string[]=[],warnings:string[]=[];
 const identities=new Map<Language,string>();
 for(const id of ids){
  const draft=id===current.problem.problemId?current:await storage.load(labId,id,'c',true);
  const state=await storage.projectState(labId,id,draft.language),starter=state.starters[draft.language]??defaultSource(draft.language);
  let same=draft.source.replace(/\r\n/g,'\n').trim()===starter.replace(/\r\n/g,'\n').trim();
  if(!same){try{same=(await services.format(draft.source,draft.language)).trim()===(await services.format(starter,draft.language)).trim();}catch{}}
  if(same||!draft.source.trim())unedited.push(id);
  if(!identities.has(draft.language))identities.set(draft.language,await services.identity(draft.language));
  const status=await testStatus(storage,draft,config,identities.get(draft.language)!);if(status)unpassed.push(id+'（'+status+'）');
  if('warning' in draft&&draft.warning)warnings.push(id+'：'+draft.warning);
  files.push({name:exportName(draft,config.studentId),source:draft.source});
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
 for(const file of submission.files){filePart(file.name,'源码文件名');files[folder+'/'+file.name]=strToU8(file.source.replace(/^\uFEFF/,''));}
 return zipSync(files,{level:6});
}
