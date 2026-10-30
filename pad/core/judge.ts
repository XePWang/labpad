import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {sandboxCommand} from './sandbox';
import {Compiler} from './compiler';
import {runProcess} from './process';
import {strictText} from '../shared/comparison';
import {validateDraft} from '../shared/validate';
import type {Draft,CompilerConfig,JudgeEvent,JudgeResult,CaseResult} from '../shared/types';
export async function judge(compiler:Compiler,value:Draft,config:CompilerConfig,signal?:AbortSignal,onEvent?:(e:JudgeEvent)=>void,ids?:string[]):Promise<JudgeResult>{
 const draft=validateDraft(structuredClone(value));
 if(ids&&(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!draft.problem.testCases.some(t=>t.id===id))))throw new Error('请选择有效的测试点');
 const result:JudgeResult={status:'completed',cases:[],compiler:'',comparison:draft.problem.comparison,selectedCaseIds:ids};
 if(!draft.problem.testCases.length)return {...result,status:'error',error:'请先新增或导入测试点'};
 let prepared:Awaited<ReturnType<Compiler['compile']>>|undefined;
 try{
  prepared=await compiler.compile(draft.source,draft.language,config,signal);
  result.compilation=prepared.compilation;result.compiler=prepared.compilation.command[0];
  onEvent?.({type:'compilation',compilation:prepared.compilation});
  if(prepared.compilation.status==='cancelled'){result.status='cancelled';return result;}
  if(prepared.compilation.status==='CE')return result;
  for(const [index,test] of draft.problem.testCases.entries()){
   if(ids&&!ids.includes(test.id))continue;
   if(signal?.aborted){result.status='cancelled';break;}
   const cwd=path.join(prepared.directory,'case-'+index);await mkdir(cwd);
   const command=compiler.paths.isolation==='bubblewrap'?sandboxCommand(prepared.executable,cwd):{program:prepared.executable,args:[]};
   const r=await runProcess(command.program,command.args,{cwd,input:Buffer.from(test.input,'utf8'),
    timeLimitMs:draft.problem.timeLimitMs,outputLimitBytes:draft.problem.outputLimitBytes,
    signal,env:await compiler.environment(config),processHost:compiler.paths.processHost});
   const c:CaseResult={id:test.id,status:'completed',elapsedMs:r.elapsedMs,stdout:r.stdout.toString('utf8'),
    stderr:r.stderr.toString('utf8')+(r.stderrTruncated?'\n[stderr 已截断]':''),
    exitCode:r.code,signal:r.signal,message:''};
   if(r.reason==='cancelled'){c.status='cancelled';result.status='cancelled';}
   else if(r.reason==='timeout')c.verdict='TLE';
   else if(r.reason==='output')c.verdict='OLE';
   else if(r.code!==0||r.signal)c.verdict='RE';
   else{
    const comparison=test.comparison??draft.problem.comparison;
    if(comparison.type==='strictText'){
     const checked=strictText(c.stdout,test.expectedOutput,comparison);c.verdict=checked.accepted?'AC':'WA';c.message=checked.message;
    }else{
    const checker=path.join(compiler.paths.checkers,(comparison.type==='wcmp'?'wcmp':'float-tokens')+(process.platform==='win32'?'.exe':''));
    const input=path.join(cwd,'input'),actual=path.join(cwd,'actual'),answer=path.join(cwd,'answer');
    await Promise.all([writeFile(input,test.input,'utf8'),writeFile(actual,r.stdout),writeFile(answer,test.expectedOutput,'utf8')]);
    const args=[input,actual,answer];
    if(comparison.type==='floatTokens')args.push(comparison.absoluteTolerance===undefined?'-':String(comparison.absoluteTolerance),
     comparison.relativeTolerance===undefined?'-':String(comparison.relativeTolerance));
    const checked=await runProcess(checker,args,{cwd,timeLimitMs:10000,outputLimitBytes:32768,
     signal,env:await compiler.environment(config),processHost:compiler.paths.processHost});
    c.message=checked.stderr.toString('utf8')||checked.stdout.toString('utf8');
    if(checked.reason==='cancelled'){c.status='cancelled';result.status='cancelled';}
    else if(checked.reason||checked.signal||![0,1,2,4,8].includes(checked.code??-1)){
     throw new Error('Checker 执行失败（'+checked.code+'）：'+c.message);
    }else c.verdict=checked.code===0?'AC':'WA';
    }
   }
   result.cases.push(c);onEvent?.({type:'case',index,result:c});
   if(result.status==='cancelled')break;
  }
 }catch(error){
  result.status=signal?.aborted?'cancelled':'error';
  if(result.status==='error')result.error=error instanceof Error?error.message:String(error);
 }finally{await prepared?.cleanup();}
 return result;
}
