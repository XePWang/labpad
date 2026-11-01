import {defaultProblem} from './defaults';
import {filePart,validateProblem} from './validate';
import type {Problem,TestCase} from './types';
export type ProjectMode='problem-set'|'project';
export type TestPatch=Partial<Pick<Problem,'comparison'|'timeLimitMs'|'outputLimitBytes'|'testCases'>>;
export interface ProjectTests{schemaVersion:2;kind:'labpad.projectTests';mode:ProjectMode;labId:string;problems?:{problemId:string;rules:TestPatch}[];tests?:TestPatch}
const fields=['comparison','timeLimitMs','outputLimitBytes','testCases'] as const;
export function testPatch(value:unknown,lab='',problem=''):TestPatch{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('测试规则格式无效');
 const p=value as Record<string,unknown>,patch:Record<string,unknown>={};
 for(const key of fields)if(Object.hasOwn(p,key)){if(p[key]===undefined)throw new Error(key+' 不能为空');patch[key]=p[key];}
 validateProblem({...defaultProblem(lab,problem),...patch});return structuredClone(patch) as TestPatch;
}
export function parseIOPatch(value:unknown,current:Problem):TestPatch{
 const p=value as any;
 if(p?.kind==='labpad.project'||p?.kind==='labpad.projectTests')throw new Error('这是实验项目文件，请选择「导入 → 导入实验项目」。');
 if(!p||p.schemaVersion!==1||(p.kind!==undefined&&p.kind!=='labpad.testCases'))throw new Error('请选择标准 I/O JSON（kind: labpad.testCases，schemaVersion: 1）');
 if(p.labId!==undefined&&p.labId!==current.labId)throw new Error('项目名称不符：当前为“'+current.labId+'”，文件为“'+p.labId+'”。');
 if(p.problemId!==undefined&&p.problemId!==current.problemId)throw new Error('题号不符：当前为“'+current.problemId+'”，文件为“'+p.problemId+'”。');
 const patch=testPatch(p,current.labId,current.problemId);if(!patch.testCases)throw new Error('标准 I/O 文件缺少 testCases');return patch;
}
export function parseProjectTests(value:unknown):ProjectTests{
 const p=value as any;
 if(!p||!['labpad.project','labpad.projectTests'].includes(p.kind)||![1,2].includes(p.schemaVersion))throw new Error('请选择实验项目或项目测试点 JSON');
 const labId=filePart(p.labId,'项目名称'),mode:ProjectMode=p.mode??'problem-set';
 if(!['problem-set','project'].includes(mode)||p.schemaVersion===1&&mode!=='problem-set')throw new Error('项目模式无效');
 if(mode==='project')return {schemaVersion:2,kind:'labpad.projectTests',mode,labId,tests:testPatch(p.tests,labId,'')};
 if(!Array.isArray(p.problems)||!p.problems.length)throw new Error('项目测试点至少需要一道题目');
 const seen=new Set<string>();
 return {schemaVersion:2,kind:'labpad.projectTests',mode,labId,problems:p.problems.map((item:any)=>{
  const problemId=filePart(item?.problemId,'题号'),key=problemId.normalize('NFC').toLowerCase();
  if(seen.has(key))throw new Error('题号重复：'+problemId);seen.add(key);
  return {problemId,rules:testPatch(item,labId,problemId)};
 })};
}
export function mergeTests(current:Problem,patch:TestPatch,mode:'replace'|'append',adoptLimits=false){
 const renamed:{from:string;to:string}[]=[];let problem:Problem;
 if(mode==='replace')problem=validateProblem({...structuredClone(current),...structuredClone(patch)});
 else{
  const ids=new Set(current.testCases.map(t=>t.id)),incoming:TestCase[]=(patch.testCases??[]).map(t=>{
   const next=structuredClone(t),base=t.id;let n=2;while(ids.has(next.id))next.id=base+'-'+n++;
   if(next.id!==base)renamed.push({from:base,to:next.id});ids.add(next.id);
   next.comparison??=structuredClone(patch.comparison??current.comparison);return next;
  });
  problem=validateProblem({...structuredClone(current),...(adoptLimits&&patch.timeLimitMs!==undefined?{timeLimitMs:patch.timeLimitMs}:{}),...(adoptLimits&&patch.outputLimitBytes!==undefined?{outputLimitBytes:patch.outputLimitBytes}:{}),testCases:[...structuredClone(current.testCases),...incoming]});
 }
 return {problem:structuredClone(problem),renamed};
}
export function exportIO(problem:Problem){return {schemaVersion:1,kind:'labpad.testCases',labId:problem.labId,problemId:problem.problemId,...rulesOf(problem)};}
export function rulesOf(p:Problem){return structuredClone({comparison:p.comparison,timeLimitMs:p.timeLimitMs,outputLimitBytes:p.outputLimitBytes,testCases:p.testCases});}
export function exportProjectTests(labId:string,problems:Problem[]):unknown{return {schemaVersion:2,kind:'labpad.projectTests',mode:'problem-set',labId,problems:problems.map(p=>({problemId:p.problemId,...rulesOf(p)}))};}
