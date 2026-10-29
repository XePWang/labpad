import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import treeKill from 'tree-kill';
import type {ProcessResult} from '../shared/types';
export interface ProcessOptions {
 cwd:string;input?:Buffer;timeLimitMs:number;outputLimitBytes:number;
 signal?:AbortSignal;env?:NodeJS.ProcessEnv;processHost?:string;
}
export async function killTree(pid:number):Promise<void>{
 if(process.platform!=='win32'){
 try{process.kill(-pid,'SIGKILL');}catch(e:any){if(e.code!=='ESRCH')throw e;}
 }else await new Promise<void>(resolve=>treeKill(pid,'SIGKILL',()=>resolve()));
}
export function runProcess(program:string,args:string[],options:ProcessOptions):Promise<ProcessResult>{
 if(options.signal?.aborted)return Promise.resolve({code:null,signal:null,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0),elapsedMs:0,reason:'cancelled',stderrTruncated:false});
 return new Promise((resolve,reject)=>{
 const started=performance.now(),wrapped=process.platform==='win32'&&options.processHost;
 const child=spawn(wrapped?options.processHost!:program,wrapped?[program,...args]:args,{
 cwd:options.cwd,env:options.env??process.env,shell:false,windowsHide:true,
 detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});
 let reason:ProcessResult['reason'],timer:ReturnType<typeof setTimeout>|undefined;
 let stdoutSize=0,stderrSize=0,stderrTruncated=false,launchError:Error|undefined;
 const out:Buffer[]=[],err:Buffer[]=[];
 const stop=(why:ProcessResult['reason'])=>{
 if(!reason){reason=why;if(child.pid)void killTree(child.pid).catch(()=>child.kill('SIGKILL'));}
 };
 const cancel=()=>stop('cancelled');
 options.signal?.addEventListener('abort',cancel,{once:true});
 child.once('spawn',()=>{
 timer=setTimeout(()=>stop('timeout'),options.timeLimitMs);
 if(options.signal?.aborted)cancel();
 child.stdin.end(options.input??Buffer.alloc(0));
 });
 child.stdin.on('error',(e:NodeJS.ErrnoException)=>{if(e.code!=='EPIPE'&&e.code!=='ERR_STREAM_DESTROYED')launchError=e;});
 child.stdout.on('data',(chunk:Buffer)=>{
 const remaining=Math.max(0,options.outputLimitBytes-stdoutSize);
 if(remaining)out.push(chunk.subarray(0,remaining));
 stdoutSize+=chunk.length;if(stdoutSize>options.outputLimitBytes)stop('output');
 });
 child.stderr.on('data',(chunk:Buffer)=>{
 const remaining=Math.max(0,262144-stderrSize);
 if(remaining)err.push(chunk.subarray(0,remaining));
 stderrSize+=chunk.length;stderrTruncated ||= stderrSize>262144;
 });
 child.once('error',error=>{launchError=error;});
 child.once('exit',()=>{if(child.pid)void killTree(child.pid).catch(()=>{});});
 child.once('close',(code,signal)=>{
 if(timer)clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);
 if(!launchError&&wrapped&&code===125&&Buffer.concat(err).toString('utf8').startsWith('LabPad process host:'))launchError=new Error(Buffer.concat(err).toString('utf8'));
 if(launchError){reject(launchError);return;}
 resolve({code,signal,stdout:Buffer.concat(out),stderr:Buffer.concat(err),
 elapsedMs:Math.round(performance.now()-started),reason,stderrTruncated});
 });
 });
}
