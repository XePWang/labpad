import type {Config,Draft,Problem} from './types';
export function filePart(value:unknown,label:string):string {
 if(typeof value!=='string'||!value.trim()||/[<>:"/\\|?*\x00-\x1f]/.test(value)||/[. ]$/.test(value)||
 value==='.'||value==='..'||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(value))
 throw new Error(label+'不能为空，也不能包含路径或不合法的文件名字符');
 return value;
}
export function validateProblem(value:unknown):Problem {
 const p=value as Problem;
 if(!p||p.schemaVersion!==1)throw new Error('题目 schemaVersion 必须为 1');
 filePart(p.labId,'实验名称');filePart(p.problemId,'题号');
 if(typeof p.title!=='string')throw new Error('题目 title 必须为字符串');
 if(!Number.isSafeInteger(p.timeLimitMs)||p.timeLimitMs<=0||!Number.isSafeInteger(p.outputLimitBytes)||p.outputLimitBytes<=0)
 throw new Error('timeLimitMs 和 outputLimitBytes 必须为正整数');
 const c=p.comparison;
 if(!c||!['wcmp','floatTokens'].includes(c.type))throw new Error('comparison.type 必须为 wcmp 或 floatTokens');
 if(c.type==='floatTokens'){
 const values=[c.absoluteTolerance,c.relativeTolerance];
 if(values.every(v=>v===undefined)||values.some(v=>v!==undefined&&(!Number.isFinite(v)||v<0)))
 throw new Error('浮点模式至少设置一项有限且非负的 absoluteTolerance / relativeTolerance');
 }
 if(!Array.isArray(p.testCases))throw new Error('testCases 必须为数组');
 const ids=new Set<string>();
 for(const t of p.testCases){
 if(!t||typeof t.id!=='string'||!t.id||ids.has(t.id)||typeof t.input!=='string'||typeof t.expectedOutput!=='string')
 throw new Error('测试点需要唯一 id 和字符串 input、expectedOutput');
 ids.add(t.id);
 }
 return p;
}
export function validateDraft(value:unknown):Draft {
 const d=value as Draft;
 if(!d||typeof d.source!=='string'||!['c','cpp'].includes(d.language))throw new Error('源码数据无效');
 validateProblem(d.problem);return d;
}
export function validateConfig(value:unknown):Config {
 const c=value as Config;
 if(!c||c.schemaVersion!==1||!['classId','name','studentId'].every(k=>typeof(c as any)[k]==='string'))
 throw new Error('个人配置格式无效');
 filePart(c.currentLab,'实验名称');filePart(c.currentProblem,'题号');
 if(!['c','cpp'].includes(c.language))throw new Error('源码语言无效');
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
