import {mkdtemp,mkdir,writeFile,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runProcess} from './process';
import type {CompilerConfig,Language,Compilation} from '../shared/types';
export interface RuntimePaths {toolchain:string;checkers:string;processHost?:string;cacheDirectory?:string}
export interface Prepared {compilation:Compilation;executable:string;directory:string;cleanup():Promise<void>}
export class Compiler {
 readonly session:Promise<string>;
 constructor(readonly paths:RuntimePaths){
  this.session=mkdtemp(path.join(tmpdir(),'labpad-'));
 }
 async environment():Promise<NodeJS.ProcessEnv>{
  const root=await this.session;
  const cache=this.paths.cacheDirectory??path.join(tmpdir(),'labpad-compiler-cache-'+(process.getuid?.()??'user'));
  await mkdir(cache,{recursive:true});
  return {...process.env,LANG:'C.UTF-8',LC_ALL:'C.UTF-8',
   ZIG_GLOBAL_CACHE_DIR:cache,ZIG_LOCAL_CACHE_DIR:path.join(root,'cache')};
 }
 resolve(config:CompilerConfig,language:Language):{program:string;prefix:string[]}{
  const zig=config.mode==='builtin'||config.kind==='zig';
  const program=config.mode==='builtin'
   ?path.join(this.paths.toolchain,process.platform==='win32'?'zig.exe':'zig')
   :(language==='c'?config.cPath:config.cppPath|| (config.kind==='zig'?config.cPath:''));
  if(!program)throw new Error('请在设置中指定'+(language==='c'?'C':'C++')+'编译器可执行文件');
  return {program,prefix:zig?[language==='c'?'cc':'c++']:[]};
 }
 async info(config:CompilerConfig):Promise<string>{
  const {program}=this.resolve(config,'c');
  const kind=config.mode==='builtin'?'zig':config.kind;
  const r=await runProcess(program,kind==='zig'?['version']:['--version'],{
   cwd:await this.session,timeLimitMs:10000,outputLimitBytes:32768,env:await this.environment(),processHost:this.paths.processHost});
  if(r.reason||r.code!==0)throw new Error('无法读取编译器版本：'+r.stderr.toString('utf8'));
  return (config.mode==='builtin'?'内置 Zig ':'自定义 ')+(r.stdout.toString('utf8').split(/\r?\n/)[0]||kind);
 }
 async compile(source:string,language:Language,config:CompilerConfig,signal?:AbortSignal):Promise<Prepared>{
  const directory=await mkdtemp(path.join(await this.session,'run-'));
  const executable=path.join(directory,process.platform==='win32'?'program.exe':'program');
  const cleanup=()=>rm(directory,{recursive:true,force:true});
  try{
   const sourcePath=path.join(directory,'main.'+(language==='c'?'c':'cpp'));
   await writeFile(sourcePath,source.replace(/^\uFEFF/,''),'utf8');
   const {program,prefix}=this.resolve(config,language);
   const args=[...prefix,...(language==='c'?config.cArgs:config.cppArgs),sourcePath,...config.linkArgs,'-o',executable];
   const r=await runProcess(program,args,{cwd:directory,timeLimitMs:120000,outputLimitBytes:524288,
    signal,env:await this.environment(),processHost:this.paths.processHost});
   if(r.reason&&r.reason!=='cancelled')throw new Error(r.reason==='timeout'?'编译工具运行超时':'编译工具输出超过上限');
   const compilation:Compilation={status:r.reason==='cancelled'?'cancelled':r.code===0?'success':'CE',
    stdout:r.stdout.toString('utf8'),stderr:r.stderr.toString('utf8')+(r.stderrTruncated?'\n[stderr 已截断]':''),
    command:[program,...args],elapsedMs:r.elapsedMs};
   if(compilation.status==='success'){
    try{await access(executable);}catch{throw new Error('编译器没有生成可执行文件，请检查编译参数');}
   }
   return {compilation,executable,directory,cleanup};
  }catch(error){await cleanup();throw error;}
 }
 async dispose(){await rm(await this.session,{recursive:true,force:true});}
}
