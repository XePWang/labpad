import {prepareBuildDirectory} from '../artifacts';
import {draftPlan,buildOptionsSignature,standaloneSource} from './plan';
import {mkdir,readFile,writeFile,rm,cp,mkdtemp,readdir,link,rmdir} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';import {performance} from 'node:perf_hooks';
import type {Compiler,Prepared} from '../compiler';import {runProcess} from '../process';import {parse,ConfigError} from '../../shared/lpmake';import {resolve} from './resolve';import {workspacePath,uniquePaths,type WorkspaceSnapshot} from '../../shared/workspace';import type {CompilerConfig,Draft,Compilation} from '../../shared/types';
export interface BuildLocation{directory:string;owner:string;cwd:string}
export async function compileDraft(compiler:Compiler,draft:Draft,config:CompilerConfig,signal?:AbortSignal,location?:BuildLocation):Promise<Prepared>{
 config=await compiler.forDraft(draft,config);
 if(!draft.workspace)return compiler.compile(draft.source,draft.language,config,signal,draft.sourceFiles&&draft.file?{snapshot:draft.sourceFiles,file:draft.file}:undefined);
 return buildWorkspace(compiler,draft.workspace,draft.problem.labId,config,signal,draft,location);
}
export async function syncSnapshot(root:string,files:Record<string,string>,binaryFiles:Record<string,string>={},pruneKnown?:Set<string>){
 const entries:Record<string,Buffer>={...Object.fromEntries(Object.entries(files).map(([name,text])=>[name,Buffer.from(text,'utf8')])),...Object.fromEntries(Object.entries(binaryFiles).map(([name,text])=>[name,Buffer.from(text,'base64')]))};
 uniquePaths([...Object.keys(files),...Object.keys(binaryFiles)]);await mkdir(root,{recursive:true});
 async function prune(dir:string,prefix=''){for(const e of await readdir(dir,{withFileTypes:true})){
  const rel=prefix+e.name,target=path.join(dir,e.name);if(e.isDirectory()){if(!pruneKnown&&!Object.keys(entries).some(f=>f.startsWith(rel+'/')))await rm(target,{recursive:true,force:true});else{await prune(target,rel+'/');if(pruneKnown)await rmdir(target).catch((e:any)=>{if(!['ENOTEMPTY','EEXIST'].includes(e.code))throw e;});}}
  else if(!Object.hasOwn(entries,rel)&&(!pruneKnown||pruneKnown.has(rel)))await rm(target,{force:true});
 }}
 await prune(root);
 for(const [name,bytes] of Object.entries(entries)){const file=path.join(root,workspacePath(name));await mkdir(path.dirname(file),{recursive:true});if(!(await readFile(file).catch(()=>undefined))?.equals(bytes))await writeFile(file,bytes);}
}
export async function buildWorkspace(compiler:Compiler,snapshot:WorkspaceSnapshot,labId:string,config:CompilerConfig,signal?:AbortSignal,context?:Draft,location?:BuildLocation):Promise<Prepared>{
 const started=performance.now(),session=await mkdtemp(path.join(await compiler.session,'project-')),directory=path.join(session,'work'),initialExecutable=path.join(session,'bin',process.platform==='win32'?'program.exe':'program'),cleanup=()=>rm(session,{recursive:true,force:true,maxRetries:10,retryDelay:100});await mkdir(directory,{recursive:true});await mkdir(path.dirname(initialExecutable),{recursive:true});let executable=initialExecutable;
 let release:(()=>Promise<void>)|undefined;
 try{
  release=await compiler.cache.acquire(signal);await compiler.cache.trim();signal?.throwIfAborted();
  const input:Draft=context??{source:'',language:'c',problem:{labId} as Draft['problem'],workspace:snapshot},logical=draftPlan(input,config),identity=await compiler.identityFor(input,config),signature=buildOptionsSignature(input,config),effective={driver:signature.driver,units:[...new Set(logical.units.map(u=>JSON.stringify([u.language,u.args])))],linkLanguage:logical.linkLanguage,linkArgs:logical.linkArgs},key=createHash('sha256').update(JSON.stringify([labId,identity,effective])).digest('hex').slice(0,24);
  const buildRoot=location?.directory??path.join(compiler.cache.directory,'projects',key),root=path.join(buildRoot,'snapshot'),outputName=logical.target+(process.platform==='win32'?'.exe':''),output=path.join(buildRoot,outputName);executable=path.join(session,'bin',outputName);const symbols=process.platform==='win32'?[logical.target+'.pdb',outputName+'.pdb']:[];
  const owned=location?await prepareBuildDirectory(buildRoot,location.owner,[
   'owner.json','link.rsp',outputName,...symbols,...logical.units.map(u=>'obj/'+u.path+'.o'),...logical.units.map((_,i)=>'link-objects/'+i+'.o'),
   ...[...Object.keys(snapshot.files),...Object.keys(snapshot.binaryFiles??{})].map(f=>'snapshot/'+f)
  ]):undefined;
  await mkdir(buildRoot,{recursive:true});await writeFile(path.join(buildRoot,'owner.json'),JSON.stringify({labId}),'utf8');await rm(output,{force:true});for(const name of symbols)await rm(path.join(buildRoot,name),{force:true});
  await syncSnapshot(root,snapshot.files,snapshot.binaryFiles,owned?new Set(owned.files.filter(f=>f.startsWith('snapshot/')).map(f=>f.slice(9))):undefined);
  if(typeof snapshot.files['LPMake.txt']!=='string')throw new ConfigError('',0,'The build configuration file "LPMake.txt" is missing.','Create LPMake.txt in the project root and add a target() declaration.');
  const plan=await resolve(parse(standaloneSource(input,config)).spec,root,{c:[],cpp:[],link:[]},false,(config as import('./plan').CompilerContext).linkTarget),env=await compiler.environment(config);
  const compilation:Compilation={status:'success',stdout:'',stderr:'',command:[],commands:[],elapsedMs:0};
  const logs:{stdout:string;stderr:string;code:number|null;reason?:string;command:string[]}[]=new Array(plan.units.length);
  for(const unit of plan.units)await compiler.assertNative(config,unit.language,[...unit.args,...plan.linkArgs]);
  const objects=plan.units.map(u=>path.join(buildRoot,'obj',u.path+'.o'));let next=0;
  const abort=new AbortController(),cancel=()=>abort.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  async function worker(){while(!abort.signal.aborted){
   const i=next++;if(i>=plan.units.length)return;const unit=plan.units[i],object=objects[i];await mkdir(path.dirname(object),{recursive:true});
   const {program,prefix}=compiler.resolve(config,unit.language),args=[...prefix,...unit.args,'-c',path.join(root,unit.path),'-o',object];
   const result=await runProcess(program,args,{cwd:root,timeLimitMs:120000,outputLimitBytes:524288,signal:abort.signal,env,processHost:compiler.paths.processHost});
   logs[i]={stdout:result.stdout.toString('utf8'),stderr:result.stderr.toString('utf8')+(result.stderrTruncated?'\n[stderr 已截断]':''),code:result.code,reason:result.reason,command:[program,...args]};
  }}
  let thrown:unknown;
  try{
   const settled=await Promise.allSettled(Array.from({length:Math.min(os.availableParallelism(),8,plan.units.length)},()=>worker().catch(e=>{abort.abort();throw e;})));
   thrown=settled.find(r=>r.status==='rejected');if(thrown)throw (thrown as PromiseRejectedResult).reason;
  }finally{signal?.removeEventListener('abort',cancel);}
  for(const [i,log] of logs.entries()){if(!log)continue;compilation.commands!.push(log.command);compilation.stdout+=log.stdout;compilation.stderr+='['+plan.units[i].path+']\n'+log.stderr;}
  if(signal?.aborted||logs.some(l=>l?.reason==='cancelled'))compilation.status='cancelled';
  else if(logs.some(l=>!l||l.code!==0||l.reason))compilation.status='CE';
  if(compilation.status==='success'){
   const {program,prefix}=compiler.resolve(config,plan.linkLanguage);
   // A response file preserves argument boundaries and avoids Windows command length limits.
   // ASCII aliases keep MinGW's response-file parser independent of the Windows code page.
   const aliases=path.join(buildRoot,'link-objects');if(!location)await rm(aliases,{recursive:true,force:true});await mkdir(aliases,{recursive:true});
   const linkObjects:string[]=[];
   for(const [i,object] of objects.entries()){const name=String(i)+'.o';if(location)await rm(path.join(aliases,name),{force:true});await link(object,path.join(aliases,name));linkObjects.push('link-objects/'+name);}
   const linkArgs=plan.linkArgs.map(arg=>arg.startsWith('-L'+root)?'-Lsnapshot/'+path.relative(root,arg.slice(2)).replaceAll('\\','/'):arg);
   const args=[...linkObjects,...linkArgs,'-o',path.basename(output)],rsp=path.join(buildRoot,'link.rsp');
   await writeFile(rsp,args.map(a=>'"'+a.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"').join('\n'),'utf8');
   const command=[program,...prefix,'@link.rsp'];compilation.commands!.push([program,...prefix,...args]);
   const linked=await runProcess(command[0],command.slice(1),{cwd:buildRoot,timeLimitMs:120000,outputLimitBytes:524288,signal,env,processHost:compiler.paths.processHost});
   compilation.stdout+=linked.stdout.toString('utf8');compilation.stderr+=linked.stderr.toString('utf8');if(linked.reason==='cancelled')compilation.status='cancelled';else if(linked.code!==0||linked.reason)compilation.status='CE';
  }
  compilation.command=compilation.commands![0]??[];compilation.elapsedMs=Math.round(performance.now()-started);
  if(compilation.status==='success'){if(!location){await cp(output,executable);for(const name of symbols)try{await cp(path.join(buildRoot,name),path.join(path.dirname(executable),name));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}}else{await rm(output,{force:true});for(const name of symbols)await rm(path.join(buildRoot,name),{force:true});}
  return {directory,executable:location?output:executable,compilation,resources:snapshot.files,binaryResources:snapshot.binaryFiles,snapshotRoot:root,buildDirectory:buildRoot,runDirectory:location?.cwd,cleanup};
 }catch(e){await cleanup();throw e;}finally{await release?.();}
}
export async function copyResources(files:Record<string,string>|undefined,directory:string,binaryFiles:Record<string,string>={}){
 for(const [name,base64] of Object.entries(binaryFiles)){const file=path.join(directory,workspacePath(name));await mkdir(path.dirname(file),{recursive:true});await writeFile(file,Buffer.from(base64,'base64'));}
 if(!files)return;for(const [name,text] of Object.entries(files)){
  if(name==='LPMake.txt'||/\.(c|cpp|cc|cxx|h|hpp|hh|hxx)$/i.test(name))continue;
  const file=path.join(directory,workspacePath(name));await mkdir(path.dirname(file),{recursive:true});await writeFile(file,text,'utf8');
 }
}

export async function clearWorkspaceCache(compiler:Compiler,labId:string){
 const release=await compiler.cache.acquire();try{
  const root=path.join(compiler.cache.directory,'projects');
  for(const entry of await readdir(root,{withFileTypes:true}).catch((e:any)=>{if(e.code==='ENOENT')return [];throw e;})){
   if(!entry.isDirectory()||!/^[0-9a-f]{24}$/.test(entry.name))continue;const dir=path.join(root,entry.name);
   const owner=await readFile(path.join(dir,'owner.json'),'utf8').then(text=>JSON.parse(text)).catch(()=>undefined);
   if(owner?.labId===labId)await rm(dir,{recursive:true,force:true});
  }
 }finally{await release();}
}
