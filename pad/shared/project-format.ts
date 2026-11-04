import {parseTemplates,sourceText,type SourceTemplates} from './templates';
import {parseIOPatch,mergeTests} from './test-import';
import {defaultProblem,defaultSource} from './defaults';
import {filePart,validateProblem} from './validate';
import type {Draft,Language,Problem,CaseResult} from './types';
export interface LabPackage{buildOptions?:import('./workspace').ProjectBuildOptions;schemaVersion:1;kind:'labpad.project';labId:string;problems:LabProblem[]}
export interface LabProblem{templates?:SourceTemplates;problemId:string;title:string;language:Language;source:string;timeLimitMs:number;outputLimitBytes:number;comparison:Problem['comparison'];testCases:Problem['testCases'];versions?:{file:string;language:Language;source:string}[]}
export interface CheckRecord{fingerprint:string;passed:number;total:number;status:'passed'|'failed'|'cancelled'|'error'|'running';checkedAt:string;compilationStatus?:'success'|'CE'|'cancelled';cases?:CaseResult[]}
export interface SourceDocument{id:string;file:string;language:Language;encoding:string;externalPath?:string;starter?:string;check?:CheckRecord}
export interface ProblemState{documents?:SourceDocument[];activeDocumentId?:string;language:Language;starters:Partial<Record<Language,string>>;checks:Partial<Record<Language,CheckRecord>>;sources:Partial<Record<Language,{path:string;encoding:string}>>}
export interface LabState{view?:{expanded?:string[];sidebarWidth?:number;sidebarCollapsed?:boolean;rightCollapsed?:boolean};buildOptions?:import('./workspace').ProjectBuildOptions;schemaVersion:1;labId:string;order?:string[];problems:Record<string,ProblemState>}
export function parseLabPackage(value:unknown):LabPackage{
 const p=value as any;
 if(!p||![1,2].includes(p.schemaVersion)||p.kind!=='labpad.project'||(p.mode??'problem-set')!=='problem-set')throw new Error('请选择 kind 为 labpad.project、schemaVersion 为 1 或 2 的题目集 JSON');
 const labId=filePart(p.labId,'项目名称');
 if(!Array.isArray(p.problems)||!p.problems.length)throw new Error('实验项目至少需要一道题目');
 const ids=new Set<string>();
 const problems:LabProblem[]=p.problems.map((item:any)=>{
  if(!item||typeof item!=='object')throw new Error('实验题目格式无效');
  const problemId=filePart(item.problemId,'题号'),key=problemId.normalize('NFC').toLowerCase();
  if(ids.has(key))throw new Error('题号重复：'+problemId);ids.add(key);
  const language=item.language??'c';if(!['c','cpp'].includes(language))throw new Error(problemId+'：language 应为 c 或 cpp');
  if(item.sourceFile&&item.source===undefined)throw new Error('请同时导入源码所在的ZIP，缺少文件：'+item.sourceFile);
  const templates=parseTemplates(item.templates),source=sourceText(item.source??templates?.[language as Language]??defaultSource(language),problemId+'：source ');
  const problem=validateProblem({...defaultProblem(labId,problemId),title:item.title??problemId,
   ...(item.timeLimitMs!==undefined?{timeLimitMs:item.timeLimitMs}:{}),...(item.outputLimitBytes!==undefined?{outputLimitBytes:item.outputLimitBytes}:{}),
   ...(item.comparison!==undefined?{comparison:item.comparison}:{}),testCases:item.testCases??[]});
  const versions=item.versions?.map((v:any)=>{filePart(v.file,'源码文件名');if(!['c','cpp'].includes(v.language)||typeof v.source!=='string')throw new Error('版本源码不完整');return {file:v.file,language:v.language,source:v.source};});
  return {...(templates?{templates}:{}),...(versions?{versions}:{}),problemId,title:problem.title,language,source,timeLimitMs:problem.timeLimitMs,outputLimitBytes:problem.outputLimitBytes,comparison:problem.comparison,testCases:problem.testCases};
 });
 let buildOptions:import('./workspace').ProjectBuildOptions|undefined;
 if(p.buildOptions!==undefined){const b=p.buildOptions;if(!b||typeof b.inheritDefaults!=='boolean'||![b.cArgs,b.cppArgs,b.linkArgs].every(a=>Array.isArray(a)&&a.every((s:any)=>typeof s==='string')))throw new Error('项目编译参数无效');buildOptions=structuredClone(b);}
 return {...(buildOptions?{buildOptions}:{}),schemaVersion:1,kind:'labpad.project',labId,problems};
}
export function labDraft(lab:LabPackage,item:LabProblem,labId=lab.labId):Draft{
 return {source:item.source,language:item.language,problem:{schemaVersion:1,labId,problemId:item.problemId,title:item.title,timeLimitMs:item.timeLimitMs,outputLimitBytes:item.outputLimitBytes,comparison:item.comparison,testCases:item.testCases}};
}
export function parseTestCases(value:unknown,current:Problem):Problem{return mergeTests(current,parseIOPatch(value,current),'replace').problem;}
