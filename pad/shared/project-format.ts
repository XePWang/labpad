import {defaultProblem,defaultSource} from './defaults';
import {filePart,validateProblem} from './validate';
import type {Draft,Language,Problem} from './types';
export interface LabPackage{schemaVersion:1;kind:'labpad.project';labId:string;problems:LabProblem[]}
export interface LabProblem{problemId:string;title:string;language:Language;source:string;timeLimitMs:number;outputLimitBytes:number;comparison:Problem['comparison'];testCases:Problem['testCases']}
export interface CheckRecord{fingerprint:string;passed:number;total:number;status:'passed'|'failed'|'cancelled'|'error'|'running';checkedAt:string}
export interface ProblemState{language:Language;starters:Partial<Record<Language,string>>;checks:Partial<Record<Language,CheckRecord>>;sources:Partial<Record<Language,{path:string;encoding:string}>>}
export interface LabState{schemaVersion:1;labId:string;order?:string[];problems:Record<string,ProblemState>}
export function parseLabPackage(value:unknown):LabPackage{
 const p=value as any;
 if(!p||p.schemaVersion!==1||p.kind!=='labpad.project')throw new Error('请选择 kind 为 labpad.project、schemaVersion 为 1 的实验项目 JSON');
 const labId=filePart(p.labId,'项目名称');
 if(!Array.isArray(p.problems)||!p.problems.length)throw new Error('实验项目至少需要一道题目');
 const ids=new Set<string>();
 const problems:LabProblem[]=p.problems.map((item:any)=>{
  if(!item||typeof item!=='object')throw new Error('实验题目格式无效');
  const problemId=filePart(item.problemId,'题号'),key=problemId.normalize('NFC').toLowerCase();
  if(ids.has(key))throw new Error('题号重复：'+problemId);ids.add(key);
  const language=item.language??'c';if(!['c','cpp'].includes(language))throw new Error(problemId+'：language 应为 c 或 cpp');
  let source=item.source===undefined?defaultSource(language):item.source;
  if(Array.isArray(source)){if(!source.every(s=>typeof s==='string'&&!/[\r\n]/.test(s)))throw new Error(problemId+'：source 数组每项应为一行源码');source=source.join('\n')+'\n';}
  if(typeof source!=='string')throw new Error(problemId+'：source 应为字符串或逐行字符串数组');
  const problem=validateProblem({...defaultProblem(labId,problemId),title:item.title??problemId,
   ...(item.timeLimitMs!==undefined?{timeLimitMs:item.timeLimitMs}:{}),...(item.outputLimitBytes!==undefined?{outputLimitBytes:item.outputLimitBytes}:{}),
   ...(item.comparison!==undefined?{comparison:item.comparison}:{}),testCases:item.testCases??[]});
  return {problemId,title:problem.title,language,source,timeLimitMs:problem.timeLimitMs,outputLimitBytes:problem.outputLimitBytes,comparison:problem.comparison,testCases:problem.testCases};
 });
 return {schemaVersion:1,kind:'labpad.project',labId,problems};
}
export function labDraft(lab:LabPackage,item:LabProblem,labId=lab.labId):Draft{
 return {source:item.source,language:item.language,problem:{schemaVersion:1,labId,problemId:item.problemId,title:item.title,timeLimitMs:item.timeLimitMs,outputLimitBytes:item.outputLimitBytes,comparison:item.comparison,testCases:item.testCases}};
}
export function parseTestCases(value:unknown,current:Problem):Problem{
 const p=value as any;
 if(p?.kind==='labpad.project')throw new Error('这是实验项目文件，请从“导入”中选择“导入实验项目”');
 if(!p||p.schemaVersion!==1||(p.kind!==undefined&&p.kind!=='labpad.testCases'))throw new Error('请选择标准 I/O JSON（kind: labpad.testCases，schemaVersion: 1）');
 return structuredClone(validateProblem({...current,
  ...(p.comparison!==undefined?{comparison:p.comparison}:{}),...(p.timeLimitMs!==undefined?{timeLimitMs:p.timeLimitMs}:{}),
  ...(p.outputLimitBytes!==undefined?{outputLimitBytes:p.outputLimitBytes}:{}),testCases:p.testCases}));
}
