import {validateComparison} from './comparison';
import {validateShortcuts} from './shortcuts';
import type {Config,Draft,Problem,LayoutConfig} from './types';
export function filePart(value:unknown,label:string):string {
 if(typeof value!=='string'||!value.trim()||/[<>:"/\\|?*\x00-\x1f]/.test(value)||/[. ]$/.test(value)||
 value==='.'||value==='..'||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(value))
 throw new Error(label+'不能为空，也不能包含路径或不合法的文件名字符');
 return value;
}
export function selection(lab:unknown,problem:unknown){
 if(typeof lab!=='string'||typeof problem!=='string')throw new Error('项目和题号格式无效');
 if(lab)filePart(lab,'实验名称');if(problem){if(!lab)throw new Error('请先选择实验项目');filePart(problem,'题号');}
}
export function validateProblem(value:unknown):Problem {
 const p=value as Problem;
 if(!p||p.schemaVersion!==1)throw new Error('题目 schemaVersion 必须为 1');
 selection(p.labId,p.problemId);
 if(typeof p.title!=='string')throw new Error('题目 title 必须为字符串');
 if(!Number.isSafeInteger(p.timeLimitMs)||p.timeLimitMs<=0||!Number.isSafeInteger(p.outputLimitBytes)||p.outputLimitBytes<=0)
 throw new Error('timeLimitMs 和 outputLimitBytes 必须为正整数');
 validateComparison(p.comparison,'题目比较规则');
 if(!Array.isArray(p.testCases))throw new Error('testCases 必须为数组');
 const ids=new Set<string>();
 for(const t of p.testCases){
 if(!t||typeof t.id!=='string'||!t.id||ids.has(t.id)||typeof t.input!=='string'||typeof t.expectedOutput!=='string')
 throw new Error('测试点需要唯一 id 和字符串 input、expectedOutput');
 if(t.comparison!==undefined)validateComparison(t.comparison,'测试点 '+t.id+' 比较规则');
 ids.add(t.id);
 }
 return p;
}
export function validateDraft(value:unknown):Draft {
 const d=value as Draft;
 if(!d||typeof d.source!=='string'||!['c','cpp'].includes(d.language))throw new Error('源码数据无效');
 validateProblem(d.problem);return d;
}
export function validateLayout(value:unknown):LayoutConfig{
 const l=value as LayoutConfig;
 if(!l||!Number.isFinite(l.editorPercent)||l.editorPercent<20||l.editorPercent>80||!Number.isFinite(l.outputPercent)||l.outputPercent<12||l.outputPercent>65)throw new Error('布局比例超出可调整范围');
 return {editorPercent:l.editorPercent,outputPercent:l.outputPercent};
}
export function validateConfig(value:unknown):Config {
 const c=value as Config;
 if(!c||c.schemaVersion!==1||!['classId','name','studentId'].every(k=>typeof(c as any)[k]==='string'))
 throw new Error('个人配置格式无效');
 selection(c.currentLab,c.currentProblem);
 if(!['manual','auto'].includes(c.saveMode)||!(c.sourceFile===null||typeof c.sourceFile==='string'))throw new Error('保存设置无效');
 if(!['c','cpp'].includes(c.language))throw new Error('源码语言无效');
 if(![1,2,4].includes(c.indentSize)||!['light','dark'].includes(c.theme)||typeof c.formatOnSave!=='boolean')throw new Error('编辑器设置无效');
 validateLayout(c.layout);validateShortcuts(c.shortcuts);
 if(!Number.isFinite(c.zoomFactor)||c.zoomFactor<0.75||c.zoomFactor>2)throw new Error('界面缩放应为 75% 至 200%');
 const b=c.compiler;
 if(!b||!['builtin','custom'].includes(b.mode)||!['zig','gcc','clang'].includes(b.kind)||
 typeof b.cPath!=='string'||typeof b.cppPath!=='string'||
 ![b.cArgs,b.cppArgs,b.linkArgs].every(a=>Array.isArray(a)&&a.every(s=>typeof s==='string')))
 throw new Error('编译器设置无效；每行填写一个参数');
 if(c.debugTimeLimitMs!==null&&(!Number.isSafeInteger(c.debugTimeLimitMs)||c.debugTimeLimitMs<=0))
 throw new Error('调试时限应留空或填写正整数（毫秒）');
 if(!Number.isSafeInteger(c.terminalBufferLines)||c.terminalBufferLines<100||c.terminalBufferLines>100000)
 throw new Error('终端缓冲应为 100 至 100000 行');
 return c;
}
