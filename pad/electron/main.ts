import {previewPlan} from '../core/build/plan';
import {assertParameters} from '../shared/parameters';
import {app,BrowserWindow,dialog,ipcMain,Menu,shell,nativeImage,nativeTheme,clipboard} from 'electron';
import {cleanInactiveRuntime} from '../core/runtime';
import {validateShortcuts} from '../shared/shortcuts';
import {Formatter} from '../core/formatter';
import {detectCompilers} from '../core/toolchains';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {mkdirSync,rmSync,constants} from 'node:fs';
import {tmpdir} from 'node:os';
import {readFile,writeFile,mkdir,stat,access,realpath,rename} from 'node:fs/promises';
import type {IPty} from 'node-pty';
import {createRequire} from 'node:module';
import {Compiler} from '../core/compiler';
import writeFileAtomic from 'write-file-atomic';
import {parse as parseMake} from '../shared/lpmake';
import {resolve as resolveBuild} from '../core/build/resolve';
import {compileDraft,copyResources,clearWorkspaceCache} from '../core/build';
import {parseWorkspacePackage,workspacePackage,workspacePath,effectiveCompiler,type ProjectBuildOptions} from '../shared/workspace';
import {parseLabPackage,parseTestCases} from '../shared/project-format';
import {parseIOPatch,parseProjectTests,mergeTests,exportIO,exportProjectTests} from '../shared/test-import';
import {readProjectArchive} from '../core/project-archive';
import {prepareWorkspaceProject,prepareSource,prepareProject,submissionZip,fingerprint,checkRecord,coverage,storedCheck,exportChoices,type Submission} from '../core/submission';
import {judge} from '../core/judge';
import {Storage,readJSON,importPairs,exists,writeSource} from '../core/storage';
import {filePart,selection,validateConfig,validateDraft,validateLayout,validateProblem} from '../shared/validate';
import type {CompilerConfig,Config,Draft,DebugState,JudgeEvent,Language,LoadedDraft,PathKind,SaveResult} from '../shared/types';
app.setName('LabPad');if(process.platform==='win32')app.setAppUserModelId('cn.xep.labpad');
const root=path.resolve(__dirname,'../../..'),chromeData=path.join(tmpdir(),'labpad-ui-'+process.pid);
mkdirSync(chromeData,{recursive:true});app.setPath('userData',chromeData);app.setPath('sessionData',chromeData);
app.on('quit',()=>{try{rmSync(chromeData,{recursive:true,force:true,maxRetries:2,retryDelay:50});}catch{}});
const pty=(app.isPackaged?require(path.join(process.resourcesPath,'app.asar.unpacked/node_modules/node-pty/lib/index.js')):createRequire(path.join(root,'pad/package.json'))('node-pty')) as typeof import('node-pty');
const platform=process.platform==='win32'?'win':process.platform==='darwin'?'mac':'linux';
const resourceRoot=app.isPackaged?process.resourcesPath:path.join(root,'.work');
const toolchain=app.isPackaged?path.join(resourceRoot,'toolchain'):path.join(resourceRoot,'toolchains',platform+'-'+process.arch);
const checkers=app.isPackaged?path.join(resourceRoot,'checkers'):path.join(resourceRoot,'checkers',platform+'-'+process.arch);
const iconPath=app.isPackaged?path.join(resourceRoot,'icon.png'):path.join(root,'pad/assets/icon.png');
function dataLocation(){
 if(process.env.LABPAD_DATA_DIR)return path.resolve(process.env.LABPAD_DATA_DIR);
 if(!app.isPackaged)return path.join(root,'.work','dev-run','labpad');
 const base=process.platform==='darwin'?path.resolve(path.dirname(process.execPath),'../../..'):path.dirname(process.env.APPIMAGE||process.env.PORTABLE_EXECUTABLE_FILE||process.execPath);
 return path.join(base,'labpad');
}
const defaultRoot=dataLocation(),locationFile=path.join(defaultRoot,'location.json');
let storage=new Storage(defaultRoot);
const formatterRoot=app.isPackaged?path.join(process.resourcesPath,'app.asar.unpacked/package.json'):path.join(root,'pad/package.json');
const formatter=new Formatter(app.isPackaged?path.join(process.resourcesPath,'formatter-worker.cjs'):path.join(__dirname,'formatter-worker.cjs'),createRequire(formatterRoot).resolve('@wasm-fmt/clang-format/node'));
const compiler=new Compiler({toolchain,checkers,cacheDirectory:process.env.LABPAD_CACHE_DIR,processHost:process.platform==='win32'?path.join(checkers,'process-host.exe'):undefined});
let shortcutWindow:BrowserWindow|undefined,openBuffers:Draft[]=[];
let warmController:AbortController|undefined,warmTask:Promise<unknown>|undefined,warmTimer:ReturnType<typeof setTimeout>|undefined;
let debugSession=0,acknowledge:((id:number,size:number)=>void)|undefined;
let win:BrowserWindow,config:Config,currentDocument:Draft|undefined,documentDirty=false;
let controller:AbortController|undefined,active:Promise<unknown>|undefined,terminal:IPty|undefined;
let closing=false,initialized=false,saves:Promise<unknown>=Promise.resolve();
const send=(channel:string,value:unknown)=>{if(win&&!win.isDestroyed())win.webContents.send(channel,value);};
const debugState=(state:DebugState)=>send('debug:state',state),judgeEvent=(event:JudgeEvent)=>send('judge:event',event);
function requireIdle(){if(active)throw new Error('请先停止正在运行的任务');}
async function stop(){controller?.abort();await active;}
async function stopWarmup(){clearTimeout(warmTimer);warmController?.abort();await warmTask?.catch(()=>{});warmTask=undefined;warmController=undefined;}
function scheduleWarmup(){
 clearTimeout(warmTimer);if(process.env.LABPAD_SKIP_WARMUP||config.compiler.mode!=='builtin')return;
 warmTimer=setTimeout(()=>{const abort=new AbortController();warmController=abort;warmTask=(async()=>{for(const language of ['c','cpp'] as Language[]){if(abort.signal.aborted)return;const prepared=await compiler.compile(language==='c'?'#include <stdio.h>\nint main(void){puts("labpad");return 0;}':'#include <iostream>\nint main(){std::cout << "labpad";}',language,config.compiler,abort.signal);await prepared.cleanup();}})().catch(()=>{});},800);
}
function handle(channel:string,fn:(...args:any[])=>any){ipcMain.handle(channel,(event,...args)=>{if(event.sender!==win.webContents)throw new Error('无效窗口');return fn(...args);});}
async function validatePath(value:string,kind:PathKind,allowEmpty=false){
 if(!value.trim())return {valid:allowEmpty,message:allowEmpty?'':'请填写路径'};
 if(!path.isAbsolute(value.trim()))return {valid:false,message:'请输入完整路径'};
 try{
  const info=await stat(value.trim());
  if(kind==='directory'?!info.isDirectory():!info.isFile())return {valid:false,message:kind==='directory'?'请选择文件夹':'请选择编译器可执行文件'};
  await access(value.trim(),kind==='directory'?constants.W_OK:constants.X_OK);
  return {valid:true,message:''};
 }catch(e:any){return {valid:false,message:e.code==='ENOENT'?'路径不存在，请重新选择或输入':e.code==='EACCES'?'没有访问该路径的权限':'无法访问路径：'+e.message};}
}
async function requirePath(value:string,kind:PathKind){const result=await validatePath(value,kind);if(!result.valid)throw new Error(result.message);}
async function inputIdentity(d:Draft,options:CompilerConfig){return compiler.identityFor(d,options);}
async function draftOptions(d:Draft){return d.file?structuredClone(config.compiler):effectiveCompiler(config.compiler,d.problem.labId?await storage.buildOptions(d.problem.labId):undefined);}
async function buildInput(value:Draft){const d=structuredClone(validateDraft(value));if(await storage.workspace.isProject(d.problem.labId))d.workspace=await storage.workspace.snapshot(d.problem.labId,[...openBuffers,d]);return d;}
async function workspaceBootstrap(){
 const lab=config.currentLab,state=await storage.workspace.read(lab),documents=await storage.workspace.documents(lab);
 let draft=documents.find(d=>d.file===currentDocument?.file)??documents.find(d=>d.file===state.activeFile)??documents[0];
 if(!draft){const source=(await storage.workspace.open(lab,'LPMake.txt'));documents.push(source);draft=source;}
 if(currentDocument?.file&&currentDocument.problem.labId===lab){const current=currentDocument;draft={...draft,...current};const index=documents.findIndex(d=>d.file===current.file);if(index>=0)documents[index]=draft;else documents.push(draft);}else documentDirty=false;
 currentDocument=draft;
 return {...await settingsResult(),draft,documents,sourcePath:draft.sourceFile??null,version:app.getVersion(),workspace:{files:await storage.workspace.list(lab),expanded:state.expanded??[],sidebarWidth:state.sidebarWidth??190,sidebarCollapsed:state.sidebarCollapsed??false}};
}
async function persist(value:Draft):Promise<SaveResult>{
 const snapshot=structuredClone(validateDraft(value)),original=JSON.stringify(snapshot),options=structuredClone(config);
 const task=saves.catch(()=>{}).then(async()=>{
  if(snapshot.file&&await storage.workspace.isProject(snapshot.problem.labId)){
   let formatWarning:string|undefined;
   if(options.formatOnSave&&/\.(c|cpp|cc|cxx|h|hpp|hh)$/i.test(snapshot.file))try{snapshot.source=await formatter.format(snapshot.source,snapshot.language,options.indentSize);}catch(e){formatWarning='格式化失败，已保存原文：'+String(e);}
   await storage.workspace.save(snapshot);if(currentDocument?.documentId===snapshot.documentId&&JSON.stringify(currentDocument)===original){currentDocument=structuredClone(snapshot);documentDirty=false;}
   return {path:await storage.workspace.path(snapshot.problem.labId,snapshot.file),source:snapshot.source,formatWarning,workspaceBuild:snapshot.file==='LPMake.txt'?snapshot.workspaceBuild:undefined};
  }
  let formatWarning:string|undefined;
  if(options.formatOnSave){try{snapshot.source=await formatter.format(snapshot.source,snapshot.language,options.indentSize);}catch(e){formatWarning='格式化失败，已保存原文：'+(e instanceof Error?e.message:String(e));}}
  await storage.save(snapshot);
  config={...config,currentLab:snapshot.problem.labId,currentProblem:snapshot.problem.problemId,language:snapshot.language};
  await storage.saveConfig(config);
  if(currentDocument&&(JSON.stringify(currentDocument)===original||JSON.stringify(currentDocument)===JSON.stringify(snapshot))){currentDocument=structuredClone(snapshot);documentDirty=false;}
  const state=await storage.projectState(snapshot.problem.labId,snapshot.problem.problemId,snapshot.language),version=state.documents?.find(v=>v.id===snapshot.documentId);
  return {path:(version?storage.documentPath(snapshot.problem.labId,snapshot.problem.problemId,version):storage.paths(snapshot.problem.labId,snapshot.problem.problemId,snapshot.language).source),source:snapshot.source,formatWarning};
 });
 saves=task.catch(()=>{});return task;
}
async function selectDraft(lab:string,problem:string,language:Language,preferStored=true){
 requireIdle();selection(lab,problem);if(!['c','cpp'].includes(language))throw new Error('无效语言');await saves;await storage.flush();
 if(await storage.workspace.isProject(lab)){
  config={...config,currentLab:lab,currentProblem:'',sourceFile:null};await storage.saveConfig(config);currentDocument=undefined;openBuffers=[];return (await workspaceBootstrap()).draft;
 }
 const initial=await storage.load(lab,problem,language,preferStored);
 let documents=await storage.openDocuments(lab,problem,language),draft=documents.find(d=>d.documentId===initial.documentId)??documents.find(d=>preferStored||d.language===language);
 if(!draft)draft=await storage.newVersion(initial);
 config={...config,currentLab:lab,currentProblem:problem,language:draft.language,sourceFile:null};await storage.saveConfig(config);
 currentDocument=draft;openBuffers=[draft];documentDirty=false;return draft;
}
async function settingsResult(){
 return {config,dataRoot:storage.root,projects:await storage.projects(),compilerLabel:await compiler.info(config.compiler).catch((e:Error)=>'编译器尚不可用：'+e.message)};
}
async function bootstrap(){
 if(await storage.workspace.isProject(config.currentLab))return workspaceBootstrap();
 if(!currentDocument){
  if(config.sourceFile&&!config.currentLab&&!(await storage.projectState('','',config.language)).documents?.length&&await exists(config.sourceFile))await storage.importSource('','',config.sourceFile);
  const initial=await storage.load(config.currentLab,config.currentProblem,config.language,true),documents=await storage.openDocuments(config.currentLab,config.currentProblem,config.language);
  currentDocument=documents.find(d=>d.documentId===initial.documentId)??documents[0];documentDirty=false;
  if(config.sourceFile){config={...config,sourceFile:null};await storage.saveConfig(config);}
 }
 const documents=await storage.openDocuments(currentDocument!.problem.labId,currentDocument!.problem.problemId,currentDocument!.language);
 const current=documents.find(d=>d.documentId===currentDocument!.documentId)??currentDocument as LoadedDraft;
 currentDocument={...current,...currentDocument};
 return {...await settingsResult(),draft:structuredClone(currentDocument),documents,sourcePath:current.sourceFile??null,version:app.getVersion()};
}
function submissionServices(){const options=structuredClone(config.compiler);return {identity:(language:Language)=>compiler.identity(options,language),format:(source:string,language:Language)=>formatter.format(source,language,4)};}
async function confirmUnsaved(){
 const result=await dialog.showMessageBox(win,{type:'question',title:'保存修改',message:'源码、构建设置或测试点有未保存的修改。',buttons:['保存','不保存','取消'],defaultId:0,cancelId:2,noLink:true});
 return (['save','discard','cancel'] as const)[result.response];
}
async function startDebug(value:Draft){
 requireIdle();await stopWarmup();requireIdle();const d=await buildInput(value),settings={...structuredClone(config),compiler:await draftOptions(value)},abort=new AbortController();controller=abort;
 debugState({status:'compiling'});
 let outcome:DebugState|undefined;
 const task=(async()=>{
  let prepared:Awaited<ReturnType<Compiler['compile']>>|undefined,shutdown:Promise<void>|undefined;
  try{
   prepared=await compileDraft(compiler,d,settings.compiler,abort.signal);await copyResources(prepared.resources,prepared.directory);
   judgeEvent({type:'compilation',compilation:prepared.compilation});
   if(prepared.compilation.status==='cancelled'){outcome={status:'stopped'};return;}
   if(prepared.compilation.status==='CE'){outcome={status:'error',message:'编译失败，请查看“输出”页'};return;}
   if(abort.signal.aborted){outcome={status:'stopped'};return;}
   const env=await compiler.environment(settings.compiler);
   await new Promise<void>((resolve,reject)=>{
    let timer:ReturnType<typeof setTimeout>|undefined,pending='',scheduled:ReturnType<typeof setTimeout>|undefined,unacked=0,paused=false;
    const session=++debugSession;
    const flush=()=>{if(pending){send('debug:data',{session,data:pending});pending='';}scheduled=undefined;};
    try{
     const child=pty.spawn(process.platform==='win32'?compiler.paths.processHost!:prepared!.executable,process.platform==='win32'?['--terminal',prepared!.executable]:[],{name:'xterm-256color',cols:100,rows:18,cwd:prepared!.directory,env:Object.fromEntries(Object.entries(env).filter((e):e is [string,string]=>e[1]!==undefined))});terminal=child;
     const kill=()=>{
      if(shutdown)return;
      if(process.platform==='win32')shutdown=new Promise<void>(done=>{execFile('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true},()=>{if(terminal===child)try{child.kill();}catch{}done();});});
      else try{child.kill();}catch{}
     };
     abort.signal.addEventListener('abort',kill,{once:true});
     acknowledge=(id,size)=>{if(id!==session)return;unacked=Math.max(0,unacked-size);if(paused&&unacked<65536){paused=false;child.resume();}};
     const dataListener=child.onData(data=>{pending+=data;unacked+=data.length;if(unacked>262144&&!paused){paused=true;child.pause();}if(!scheduled)scheduled=setTimeout(flush,16);});
     const exitListener=child.onExit(exit=>{
      if(timer)clearTimeout(timer);if(scheduled)clearTimeout(scheduled);flush();
      abort.signal.removeEventListener('abort',kill);dataListener.dispose();exitListener.dispose();terminal=undefined;acknowledge=undefined;
      outcome={status:abort.signal.aborted?'stopped':'exited',message:'退出码 '+exit.exitCode};resolve();
     });
     if(settings.debugTimeLimitMs)timer=setTimeout(()=>abort.abort(),settings.debugTimeLimitMs);
     debugState({status:'running'});if(abort.signal.aborted)kill();
    }catch(e){reject(e);}
   });
  }catch(e){outcome={status:abort.signal.aborted?'stopped':'error',message:abort.signal.aborted?undefined:e instanceof Error?e.message:String(e)};}
  finally{await shutdown;try{await prepared?.cleanup();}catch(e){outcome={status:'error',message:'清理运行文件失败：'+(e instanceof Error?e.message:String(e))};}}
 })();
 active=task;void task.finally(()=>{if(active===task){active=undefined;controller=undefined;if(outcome)debugState(outcome);}});
}
async function initialize(){
 if(await exists(locationFile)){
  const value=await readJSON(locationFile) as {dataDirectory:string};await requirePath(value.dataDirectory,'directory');storage=new Storage(await realpath(value.dataDirectory));
 }
 config=await storage.init();initialized=true;win.webContents.setZoomFactor(config.zoomFactor);void cleanInactiveRuntime();nativeTheme.themeSource=config.theme;win.setBackgroundColor(config.theme==='light'?'#ffffff':'#1e1e1e');
 const projects=await storage.projects();
 if(!projects.some(p=>p.labId===config.currentLab)){config.currentLab='';config.currentProblem='';}
 else if(!projects.find(p=>p.labId===config.currentLab)!.problems.includes(config.currentProblem))config.currentProblem='';
 handle('bootstrap',bootstrap);handle('draft:save',persist);handle('draft:load',selectDraft);
 handle('draft:reload',async()=>{requireIdle();await saves;currentDocument=undefined;documentDirty=false;return bootstrap();});
 handle('workspace:sources',async(lab:string,text:string)=>{if(typeof text!=='string'||!await storage.workspace.isProject(lab))throw new Error('项目无效');return (await resolveBuild(parseMake(text).spec,storage.workspace.root(lab))).units.map(u=>u.path);});
 handle('workspace:files',(lab:string)=>storage.workspace.list(lab));
 handle('workspace:open',(lab:string,file:string)=>storage.workspace.open(lab,file));
 handle('workspace:view',async(lab:string,value:any)=>{
  if(!await storage.workspace.isProject(lab))throw new Error('请选择多文件项目');
  const update:any={};for(const key of ['activeFile','openFiles','expanded','sidebarWidth','sidebarCollapsed'])if(Object.hasOwn(value,key))update[key]=value[key];
  if(update.openFiles){if(!Array.isArray(update.openFiles))throw new Error('打开文件列表无效');update.openFiles.forEach(workspacePath);}
  if(update.activeFile)workspacePath(update.activeFile);if(update.expanded)update.expanded.forEach(workspacePath);
  if(update.sidebarWidth!==undefined&&(!Number.isFinite(update.sidebarWidth)||update.sidebarWidth<120||update.sidebarWidth>420))throw new Error('侧栏宽度无效');
  await storage.workspace.update(lab,update);
 });
 handle('workspace:file',async(lab:string,action:string,file:string,target?:string,content?:string)=>{
  requireIdle();await saves;if(!await storage.workspace.isProject(lab))throw new Error('请选择多文件项目');
  if(action==='reveal'){shell.showItemInFolder(await storage.workspace.path(lab,file));return storage.workspace.list(lab);}
  if(!['newFile','newFolder','rename','delete'].includes(action))throw new Error('文件操作无效');
  if(action==='delete'){
   const entries=await storage.workspace.list(lab),count=entries.filter(e=>e.path===file||e.path.startsWith(file+'/')).length;
   const choice=await dialog.showMessageBox(win,{type:'warning',title:'删除项目文件',message:'删除“'+file+'”？',detail:'将删除 '+count+' 项及其中未保存的修改。此操作无法撤销。',buttons:['取消','删除'],defaultId:0,cancelId:0,noLink:true});if(choice.response!==1)return entries;
  }
  return storage.workspace.mutate(lab,action as 'newFile'|'newFolder'|'rename'|'delete',file,target,content);
 });
 handle('build:preview',async(value:Draft,options?:ProjectBuildOptions)=>{
  const d=await buildInput(value),base=d.workspace?structuredClone(config.compiler):options?effectiveCompiler(config.compiler,options):await draftOptions(d);
  return previewPlan(d,base);
 });
 handle('project:build:get',async(lab:string)=>await storage.workspace.isProject(lab)?{inheritDefaults:(await storage.workspace.read(lab)).inheritDefaults,cArgs:[],cppArgs:[],linkArgs:[]}:storage.buildOptions(lab));
 handle('project:build:save',async(lab:string,value:ProjectBuildOptions)=>{
  requireIdle();await saves;if(await storage.workspace.isProject(lab)){await storage.workspace.update(lab,{inheritDefaults:!!value.inheritDefaults});return;}
  if(!value.inheritDefaults){assertParameters(value.cArgs,'C 参数');assertParameters(value.cppArgs,'C++ 参数');assertParameters(value.linkArgs,'链接参数');}
  await storage.saveBuildOptions(lab,value);
 });
 handle('project:delete',async(lab:string)=>{
  await saves;filePart(lab,'项目名称');const project=(await storage.projects()).find(p=>p.labId===lab);if(!project)throw new Error('项目已不存在');
  let files=0,tests=0;
  if(project.mode==='project'){files=(await storage.workspace.list(lab)).filter(f=>!f.directory).length;tests=(await storage.workspace.read(lab)).tests.testCases.length;}
  else for(const id of project.problems){files+=(await storage.allDocuments(lab,id,'c')).length;tests+=(await storage.load(lab,id,'c',true)).problem.testCases.length;}
  const choice=await dialog.showMessageBox(win,{type:'warning',title:'删除实验项目',message:'删除“'+lab+'”？',detail:'将删除本项目的 '+files+' 份文件、'+tests+' 个测试点、项目配置及本地记录。'+(documentDirty&&currentDocument?.problem.labId===lab?'\n包含未保存的修改。':'')+(active&&currentDocument?.problem.labId===lab?'\n正在运行的任务会停止。':'')+'\n此操作无法撤销。原始导入文件及其他项目保留。',buttons:['取消','删除整个项目'],defaultId:0,cancelId:0,noLink:true});
  if(choice.response!==1)return false;
  if(active){if(currentDocument?.problem.labId!==lab)throw new Error('请等当前任务结束后再删除项目');await stop();}
  await stopWarmup();await clearWorkspaceCache(compiler,lab);await storage.deleteLab(lab);
  if(config.currentLab===lab){config={...config,currentLab:'',currentProblem:''};await storage.saveConfig(config);currentDocument=undefined;openBuffers=[];documentDirty=false;}
  return true;
 });
 handle('zoom:reset',async()=>{win.webContents.setZoomFactor(1);config={...config,zoomFactor:1};await storage.saveConfig(config);send('zoom:changed',1);});
 handle('projects',()=>storage.projects());
  handle('source:recent',async(lab:string,problem:string,closed:string[])=>{selection(lab,problem);if(await storage.workspace.isProject(lab)){const files=await storage.workspace.list(lab);const file=closed.map(id=>id.replace(/^file:/,'')).find(f=>files.some(e=>!e.directory&&e.path===f))??files.find(f=>!f.directory)?.path;return file?storage.workspace.open(lab,file):null;}return storage.recentDocument(lab,problem,closed);});
  handle('check:state',async(value:Draft)=>{const d=await buildInput(value),options=await draftOptions(d);return coverage(storage,d,{...config,compiler:options},await inputIdentity(d,options));});
  handle('check:problems',async(value:Draft,buffers:Draft[])=>{
   const current=validateDraft(value);if(current.file)return {};const project=(await storage.projects()).find(p=>p.labId===current.problem.labId),states:Record<string,string>={};
   const identities=new Map<Language,string>();
   for(const id of project?.problems??[]){
    const d=id===current.problem.problemId?current:buffers.find(b=>b.problem.problemId===id&&b.problem.labId===current.problem.labId)??await storage.load(current.problem.labId,id,'c',true);
    const options=await draftOptions(d);if(!identities.has(d.language))identities.set(d.language,await compiler.identity(options,d.language));
    states[id]=(await coverage(storage,d,{...config,compiler:options},identities.get(d.language)!)).state;
   }
   return states;
  });
  handle('export:choices',async(buffers:Draft[])=>{requireIdle();await saves;if(!currentDocument)throw new Error('请先选择实验项目');return exportChoices(storage,currentDocument,buffers.map(validateDraft));});
  handle('export:preview',async(kind:string,values:Draft[],includeConfig=false)=>{
   requireIdle();await saves;if(!values.length)throw new Error('请至少选择一份源码');
   const drafts=values.map(validateDraft);
   if(await storage.workspace.isProject(drafts[0].problem.labId)){
    if(kind==='project'){
     const d=await buildInput(drafts[0]),options=await draftOptions(d),preview=await prepareWorkspaceProject(storage,d,structuredClone(config),[...openBuffers,...drafts],includeConfig,submissionServices()),record=(await storage.workspace.read(d.problem.labId)).check;
     if(d.problem.testCases.length&&(!record||record.fingerprint!==fingerprint(d,options,await inputIdentity(d,options))||record.total!==d.problem.testCases.length)&&!preview.warnings.some(w=>w.startsWith('尚未全部通过')))preview.warnings.unshift('尚未全部通过：内容或规则已改变，请重新测试。');
     return preview;
    }
    const d=await buildInput(drafts[0]);if(!d.file)throw new Error('请先选择文件');const name=path.basename(d.file),preview=await prepareWorkspaceProject(storage,d,structuredClone(config),[...openBuffers,...drafts],false,submissionServices()),record=(await storage.workspace.read(d.problem.labId)).check;
    if(record?.fingerprint!==fingerprint(d,await draftOptions(d),await inputIdentity(d,await draftOptions(d)))&&!preview.warnings.some(w=>w.startsWith('尚未全部通过')))preview.warnings.unshift('尚未全部通过：请先测试当前项目。');
    return {kind:'source',name,labId:d.problem.labId,files:[{name,source:d.source}],warnings:preview.warnings};
   }
   return kind==='project'?prepareProject(storage,drafts[0],{...structuredClone(config),compiler:await draftOptions(drafts[0])},submissionServices(),drafts,includeConfig):prepareSource(storage,drafts[0],{...structuredClone(config),compiler:await draftOptions(drafts[0])},submissionServices());
  });
  handle('export:write',async(value:Submission)=>{
   requireIdle();
   if(!value||!['source','project'].includes(value.kind)||!Array.isArray(value.files)||!value.files.length)throw new Error('导出内容无效');
   filePart(value.name,'导出文件名');for(const f of value.files){if(f.name!=='labpad.project.json')workspacePath(f.name);if(typeof f.source!=='string')throw new Error('导出内容无效');}
   const ext=value.kind==='project'?'zip':path.extname(value.files[0].name).slice(1)||'txt';
   const selected=await dialog.showSaveDialog(win,{title:value.kind==='project'?'导出实验项目 · 选择保存位置':'导出源码 · 选择保存位置',defaultPath:value.name,filters:[{name:value.kind==='project'?'ZIP 压缩包':'源码文件',extensions:[ext]}]});
   if(selected.canceled||!selected.filePath)return null;
   const file=path.extname(selected.filePath)?selected.filePath:selected.filePath+'.'+ext;
   if(path.extname(file).toLowerCase()!=='.'+ext)throw new Error('请选择 .'+ext+' 文件');
   if(value.kind==='project')await writeFileAtomic(file,Buffer.from(submissionZip({...value,name:path.basename(file)})));else await writeSource(file,value.files[0].source);
   return file;
  });
 handle('project:create',async(name:string,mode='problem-set')=>{requireIdle();await saves;if(mode==='project'){await storage.workspace.create(name,config.language);return selectDraft(name,'',config.language);}if(mode!=='problem-set')throw new Error('项目类型无效');const carry=currentDocument&&structuredClone(currentDocument);await storage.createLab(name);const next=await selectDraft(name,'',config.language);if(carry){const copy=await storage.newVersion({...next,source:carry.source,language:carry.language});currentDocument=copy;return copy;}return next;});
 handle('problem:create',async(lab:string,name:string,language:Language)=>{requireIdle();await saves;const carry=currentDocument&&!currentDocument.problem.problemId?structuredClone(currentDocument):undefined;const next=await storage.createProblem(lab,name,language);if(carry)await storage.save({...next,source:carry.source,language:carry.language});return selectDraft(lab,name,carry?.language??language);});
 ipcMain.on('document:state',(event,value:Draft,dirty:boolean)=>{if(event.sender===win.webContents){currentDocument=structuredClone(validateDraft(value));documentDirty=!!dirty;}});
 ipcMain.on('workspace:state',(event,values:Draft[],dirty:boolean)=>{if(event.sender===win.webContents){openBuffers=values.map(d=>structuredClone(validateDraft(d)));documentDirty=!!dirty;}});
 handle('documents:open',async(lab:string,problem:string,language:Language)=>await storage.workspace.isProject(lab)?storage.workspace.documents(lab):storage.openDocuments(lab,problem,language));
 handle('document:activate',async(id:string)=>{if(!currentDocument)throw new Error('尚未打开文件');if(currentDocument.file&&await storage.workspace.isProject(currentDocument.problem.labId)){await storage.workspace.update(currentDocument.problem.labId,{activeFile:currentDocument.file});return;}await storage.activateDocument(currentDocument.problem.labId,currentDocument.problem.problemId,id);const state=await storage.projectState(currentDocument.problem.labId,currentDocument.problem.problemId,currentDocument.language),version=state.documents?.find(v=>v.id===id);if(version){config={...config,language:version.language,sourceFile:null};await storage.saveConfig(config);}});
 handle('source:version',(value:Draft,fromTemplate:boolean)=>{requireIdle();return storage.newVersion(value,fromTemplate===true);});
 handle('clipboard:write',(text:string)=>{if(typeof text!=='string')throw new Error('复制内容无效');clipboard.writeText(text);});
  handle('path:show-file',async(file:string)=>{if(typeof file!=='string'||!path.isAbsolute(file))throw new Error('请选择已保存的源码文件');try{if(!(await stat(file)).isFile())throw new Error();await access(file,constants.R_OK);}catch{throw new Error('文件不存在或无法访问，请先保存源码');}shell.showItemInFolder(file);});
 handle('path:copy',(file:string,relative:boolean)=>{clipboard.writeText(relative?path.relative(storage.root,file):file);});
 handle('cache:clear',async()=>{requireIdle();await stopWarmup();return compiler.cache.clear();});
 handle('shortcuts:open',async()=>{
  if(shortcutWindow&&!shortcutWindow.isDestroyed()){shortcutWindow.focus();return;}
  shortcutWindow=new BrowserWindow({parent:win,width:760,height:750,minWidth:540,minHeight:480,title:'LabPad · 快捷键',icon:iconPath,backgroundColor:config.theme==='light'?'#ffffff':'#1e1e1e',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  shortcutWindow.setMenuBarVisibility(false);shortcutWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));shortcutWindow.webContents.on('will-navigate',e=>e.preventDefault());
  shortcutWindow.on('closed',()=>{shortcutWindow=undefined;});
  if(process.env.VITE_DEV_SERVER_URL)await shortcutWindow.loadURL(process.env.VITE_DEV_SERVER_URL+'#shortcuts');else await shortcutWindow.loadFile(path.join(__dirname,'../renderer/index.html'),{hash:'shortcuts'});
 });
 ipcMain.handle('shortcuts:get',event=>{if(event.sender!==shortcutWindow?.webContents)throw new Error('无效窗口');return {shortcuts:config.shortcuts,theme:config.theme,platform:process.platform};});
 ipcMain.handle('shortcuts:save',async(event,value:unknown)=>{if(event.sender!==shortcutWindow?.webContents)throw new Error('无效窗口');const shortcuts=structuredClone(validateShortcuts(value));await saves;config={...config,shortcuts};await storage.saveConfig(config);send('shortcuts:changed',shortcuts);});
 handle('document:confirm',confirmUnsaved);
 handle('path:validate',validatePath);
 handle('path:choose',async(kind:PathKind,current:string)=>{
  const result=await dialog.showOpenDialog(win,{title:kind==='directory'?'选择数据保存位置':'选择编译器可执行文件',defaultPath:current||undefined,properties:kind==='directory'?['openDirectory']:['openFile']});
  return result.canceled?null:result.filePaths[0];
 });
 handle('path:reveal',async(value:string,kind:PathKind)=>{await requirePath(value,kind);if(kind==='directory'){const error=await shell.openPath(value);if(error)throw new Error(error);}else shell.showItemInFolder(value);});
 handle('config:save',async(value:Config,dataRoot:string)=>{
  requireIdle();await stopWarmup();await saves;
  const next=structuredClone(validateConfig({...value,currentLab:config.currentLab,currentProblem:config.currentProblem,sourceFile:config.sourceFile,layout:config.layout,shortcuts:config.shortcuts}));
  await requirePath(dataRoot,'directory');const target=await realpath(dataRoot.trim());
  if(next.compiler.mode==='custom'){
   next.compiler.cPath=next.compiler.cPath.trim();next.compiler.cppPath=next.compiler.cppPath.trim();
   await requirePath(next.compiler.cPath,'executable');
   if(next.compiler.cppPath)await requirePath(next.compiler.cppPath,'executable');
   else if(next.language==='cpp'&&next.compiler.kind!=='zig')throw new Error('请填写 C++ 编译器路径');
  }
  await compiler.info(next.compiler);
  if(target!==await realpath(storage.root)){
   await storage.copyDataTo(target);const replacement=new Storage(target);await replacement.saveConfig(next);
   await mkdir(defaultRoot,{recursive:true});await writeFile(locationFile+'.tmp',JSON.stringify({dataDirectory:target},null,2)+'\n','utf8');await rename(locationFile+'.tmp',locationFile);storage=replacement;
  }else await storage.saveConfig(next);
  config=next;win.webContents.setZoomFactor(next.zoomFactor);scheduleWarmup();nativeTheme.themeSource=next.theme;win.setBackgroundColor(next.theme==='light'?'#ffffff':'#1e1e1e');return settingsResult();
 });
 handle('source:format',(source:string,language:Language,indentSize:number)=>{if(typeof source!=='string'||!['c','cpp'].includes(language))throw new Error('源码数据无效');return formatter.format(source,language,indentSize);});
 handle('layout:save',async(value:unknown)=>{const layout=validateLayout(value);await saves;config={...config,layout};await storage.saveConfig(config);return layout;});
 handle('compiler:detect',async()=>{requireIdle();return detectCompilers({cwd:await compiler.session,exclude:[toolchain],processHost:compiler.paths.processHost});});
 handle('compiler:info',(value:CompilerConfig)=>compiler.info(validateConfig({...config,compiler:value}).compiler));
 handle('source:import',async()=>{
  requireIdle();await saves;
  const selected=await dialog.showOpenDialog(win,{title:'导入单文件源码',properties:['openFile'],filters:[{name:'C / C++ 源码',extensions:['c','cpp']}]});
  if(selected.canceled)return null;
  const file=selected.filePaths[0];
  if(await storage.workspace.isProject(config.currentLab)){
   const name=workspacePath('src/'+path.basename(file)),target=await storage.workspace.path(config.currentLab,name,true),decoded=(await import('../core/storage')).decodeText(await readFile(file));
   if(await exists(target)&&await realpath(file)===await realpath(target)){const document=await storage.workspace.open(config.currentLab,name);return {source:document.source,encoding:document.sourceEncoding!,path:document.sourceFile!,language:document.language,document,reused:true};}
   if(await exists(target)){const choice=await dialog.showMessageBox(win,{type:'question',title:'替换项目文件',message:'“'+name+'”已存在，是否替换？',detail:'当前文件及其未保存修改将被替换。原始导入文件保留。',buttons:['取消','替换'],defaultId:0,cancelId:0,noLink:true});if(choice.response!==1)return null;await writeSource(target,decoded.text);}else await storage.workspace.mutate(config.currentLab,'newFile',name,undefined,decoded.text);
   const document=await storage.workspace.open(config.currentLab,name);currentDocument=document;openBuffers=openBuffers.filter(d=>d.file!==name);
   return {source:document.source,encoding:document.sourceEncoding!,path:document.sourceFile!,language:document.language,document};
  }
  if(!['.c','.cpp'].includes(path.extname(file).toLowerCase()))throw new Error('仅支持 .c / .cpp 单文件');
  const document=await storage.importSource(config.currentLab,config.currentProblem,file);
  currentDocument=document;config={...config,sourceFile:null,language:document.language};await storage.saveConfig(config);
  return {source:document.source,encoding:document.sourceEncoding!,path:document.sourceFile!,language:document.language,document};
 });
 handle('problem:save',async(value:unknown)=>{const problem=structuredClone(validateProblem(value));await saves;if(!currentDocument)throw new Error('尚未打开题目');if(currentDocument.file)await storage.workspace.update(problem.labId,{tests:problem});else await storage.save({...currentDocument,problem},false);});
 handle('problem:import',async(lab:string,problem:string)=>{
  requireIdle();selection(lab,problem);await saves;
  const current=currentDocument?.problem.labId===lab&&currentDocument.problem.problemId===problem?structuredClone(currentDocument):await storage.load(lab,problem,config.language);
  const selected=await dialog.showOpenDialog(win,{title:'导入测试点 · 当前题目',properties:['openFile','multiSelections'],filters:[{name:'标准 I/O',extensions:['json','in','out','ans']}]});
  if(selected.canceled)return null;
  const patch=selected.filePaths.length===1&&path.extname(selected.filePaths[0]).toLowerCase()==='.json'
   ?parseIOPatch(await readJSON(selected.filePaths[0]),current.problem):{testCases:(await importPairs(selected.filePaths,lab,problem)).testCases};
  const choice=await dialog.showMessageBox(win,{type:'question',title:'导入测试点',message:'导入 '+patch.testCases!.length+' 个测试点',detail:'当前有 '+current.problem.testCases.length+' 个测试点。覆盖会替换现有测试点；追加会保留原点及其比较规则。',buttons:['取消','覆盖现有测试点','追加到末尾'],defaultId:0,cancelId:0,noLink:true});
  if(!choice.response)return null;const mode=choice.response===1?'replace':'append';let adoptLimits=false;
  if(mode==='append'&&(patch.timeLimitMs!==undefined&&patch.timeLimitMs!==current.problem.timeLimitMs||patch.outputLimitBytes!==undefined&&patch.outputLimitBytes!==current.problem.outputLimitBytes)){
   const answer=await dialog.showMessageBox(win,{type:'question',title:'测试限制',message:'导入文件包含不同的时限或输出上限。',detail:'这些限制作用于整题。追加测试点时，可以保留当前限制。',buttons:['取消','保留当前限制','采用导入限制'],defaultId:1,cancelId:0,noLink:true});
   if(!answer.response)return null;adoptLimits=answer.response===2;
  }
  const imported=mergeTests(current.problem,patch,mode,adoptLimits);
  const confirm=await dialog.showMessageBox(win,{type:'question',title:'确认导入',message:(mode==='replace'?'覆盖后':'追加后')+'共 '+imported.problem.testCases.length+' 个测试点',detail:(mode==='append'?'原测试点及其比较规则保留。':'仅替换测试点及文件中明确给出的规则，源码保留。')+(imported.renamed.length?'\n编号冲突已调整：'+imported.renamed.map(x=>x.from+' → '+x.to).join('、'):'')+'\n导入后需要重新测试。',buttons:['取消','导入'],defaultId:1,cancelId:0,noLink:true});
  if(confirm.response!==1)return null;
  if(await storage.workspace.isProject(lab))await storage.workspace.update(lab,{tests:imported.problem});else await storage.save({...current,problem:imported.problem},false);if(currentDocument?.problem.labId===lab&&currentDocument.problem.problemId===problem)currentDocument.problem=imported.problem;return imported.problem;
 });
 handle('project:import',async()=>{
  requireIdle();await saves;
  const selected=await dialog.showOpenDialog(win,{title:'导入实验项目',properties:['openFile'],filters:[{name:'实验项目 JSON',extensions:['json','zip']}]});
  if(selected.canceled)return null;
  const value=(path.extname(selected.filePaths[0]).toLowerCase()==='.zip'?await readProjectArchive(selected.filePaths[0]):await readJSON(selected.filePaths[0])) as any,target=(await storage.projects()).find(p=>p.labId===value?.labId),testsOnly=value?.kind==='labpad.projectTests';
  let update=testsOnly;
  if(target&&!testsOnly){
   const choice=await dialog.showMessageBox(win,{type:'question',title:'导入实验项目',message:'“'+target.labId+'”已存在。',detail:'更新测试点会保留源码、模板和正在编辑的内容。',buttons:['取消','更新测试点','导入副本'],defaultId:1,cancelId:0,noLink:true});
   if(!choice.response)return null;update=choice.response===1;
  }
  if(update){
   const incoming=parseProjectTests(value);if(!target)throw new Error('未找到项目“'+incoming.labId+'”，请先导入完整项目。');
   if(incoming.mode!==(target.mode??'problem-set'))throw new Error('项目模式不符，无法更新测试点。');
   if(incoming.mode==='project'){
    const current=currentDocument?.problem.labId===target.labId?currentDocument.problem:(await storage.workspace.read(target.labId)).tests;
    const tests=mergeTests(current,incoming.tests!,'replace').problem;
    const answer=await dialog.showMessageBox(win,{type:'question',title:'更新项目测试点',message:'更新“'+target.labId+'”的 '+tests.testCases.length+' 个测试点',detail:'源码、LPMake与未保存编辑保留。空测试集将清空现有测试点。',buttons:['取消','更新测试点'],defaultId:0,cancelId:0,noLink:true});if(answer.response!==1)return null;
    await storage.workspace.update(target.labId,{tests});if(currentDocument?.problem.labId===target.labId)currentDocument.problem=tests;return {...await bootstrap(),updatedProblems:[tests]};
   }
   const missing=incoming.problems!.filter(p=>!target.problems.includes(p.problemId));if(missing.length)throw new Error('以下题号不存在：'+missing.map(p=>p.problemId).join('、'));
   const rules=await Promise.all(incoming.problems!.map(async p=>{
    const current=currentDocument?.problem.labId===target.labId&&currentDocument.problem.problemId===p.problemId?currentDocument.problem:(await storage.load(target.labId,p.problemId,'c',true)).problem;
    return mergeTests(current,p.rules,'replace').problem;
   }));
   const choice=await dialog.showMessageBox(win,{type:'question',title:'更新项目测试点',message:'更新“'+target.labId+'”的 '+rules.length+' 道题目',detail:rules.map(p=>p.problemId+'：'+p.testCases.length+' 个测试点'+(!p.testCases.length?'（将清空）':'')).join('\n')+'\n源码及未保存编辑保留；未列出的题目不变。',buttons:['取消','更新测试点'],defaultId:0,cancelId:0,noLink:true});
   if(choice.response!==1)return null;
   await storage.updateProjectTests(target.labId,rules);
   const current=rules.find(p=>p.problemId===currentDocument?.problem.problemId&&p.labId===currentDocument.problem.labId);if(current&&currentDocument)currentDocument.problem=current;
   return {...await bootstrap(),updatedProblems:rules};
  }
  const workspace=value?.mode==='project'?parseWorkspacePackage(value):undefined,lab=workspace??parseLabPackage(value),name=await storage.nextLabName(lab.labId);
  if(documentDirty||openBuffers.length){const choice=await confirmUnsaved();if(choice==='cancel')return null;if(choice==='save')for(const d of openBuffers.length?openBuffers:currentDocument?[currentDocument]:[])await persist(d);}
  const imported=workspace?await storage.workspace.create(name,config.language,workspace):undefined;if(imported)await selectDraft(name,'',imported.language);else{const created=await storage.importProject(lab,name);await selectDraft(created.labId,created.problemId,created.language);}
  return bootstrap();
 });
 handle('tests:export',async(kind:string,value:unknown)=>{
  requireIdle();await saves;const problem=validateProblem(value);let content:unknown=exportIO(problem),name=(problem.problemId||problem.labId||'测试点')+'.io.json';
  if(kind==='project'){
   const target=(await storage.projects()).find(p=>p.labId===problem.labId);if(!target)throw new Error('请先选择实验项目');
   if(target.mode==='project'){content={schemaVersion:2,kind:'labpad.projectTests',mode:'project',labId:problem.labId,tests:exportIO(problem)};name=problem.labId+'.tests.json';}else{const rules=await Promise.all(target.problems.map(async id=>id===problem.problemId?problem:(await storage.load(problem.labId,id,'c',true)).problem));content=exportProjectTests(problem.labId,rules);name=problem.labId+'.tests.json';}
  }else if(kind!=='current')throw new Error('导出类型无效');
  const file=await dialog.showSaveDialog(win,{title:kind==='project'?'导出项目测试点':'导出当前测试点',defaultPath:name,filters:[{name:'JSON',extensions:['json']}]});
  if(file.canceled||!file.filePath)return null;const target=file.filePath.endsWith('.json')?file.filePath:file.filePath+'.json';await writeFileAtomic(target,JSON.stringify(content,null,2)+'\n');return target;
 });
 handle('problem:show',async(value:Draft)=>{
  const d=validateDraft(value);if(d.file){shell.showItemInFolder(storage.workspace.metadata(d.problem.labId));return;}const file=storage.paths(d.problem.labId,d.problem.problemId,d.language).problem;
  if(!await exists(file))throw new Error('请先保存当前题目，再打开题目文件');shell.showItemInFolder(file);
 });
 handle('judge',async(value:Draft,ids?:string[])=>{
  requireIdle();await stopWarmup();requireIdle();const d=await buildInput(value),options=await draftOptions(value),abort=new AbortController();controller=abort;
  const task=(async()=>{
   const hash=fingerprint(d,options,await inputIdentity(d,options));
   const previous=await storedCheck(storage,d);
   await storage.recordCheck(d,checkRecord(d,hash,undefined,previous));
   const result=await judge(compiler,d,options,abort.signal,judgeEvent,ids);
   await storage.recordCheck(d,checkRecord(d,hash,result,previous));return result;
  })();active=task;
  try{return await task;}finally{if(active===task){active=undefined;controller=undefined;}}
 });
 handle('cancel',stop);handle('debug:stop',stop);handle('debug:start',startDebug);
 ipcMain.on('debug:ack',(event,id:number,size:number)=>{if(event.sender===win.webContents&&Number.isSafeInteger(id)&&Number.isSafeInteger(size)&&size>0)acknowledge?.(id,size);});
 ipcMain.on('debug:input',(event,data:unknown)=>{if(event.sender===win.webContents&&typeof data==='string')terminal?.write(data);});
 ipcMain.on('debug:resize',(event,cols:number,rows:number)=>{if(event.sender===win.webContents&&Number.isSafeInteger(cols)&&Number.isSafeInteger(rows)&&cols>0&&rows>0)try{terminal?.resize(Math.min(cols,500),Math.min(rows,200));}catch{}});
}
app.whenReady().then(async()=>{
 Menu.setApplicationMenu(Menu.buildFromTemplate([
 ...(process.platform==='darwin'?[{role:'appMenu' as const}]:[]),
 {label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
 {label:'视图',submenu:[{label:'实际大小',accelerator:'CommandOrControl+0',click:()=>{win.webContents.setZoomFactor(1);if(config){config={...config,zoomFactor:1};void storage.saveConfig(config);send('zoom:changed',1);}}},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]}
 ] as Electron.MenuItemConstructorOptions[]));
 const icon=nativeImage.createFromPath(iconPath);if(process.platform==='darwin'&&!icon.isEmpty())app.dock?.setIcon(icon);
 win=new BrowserWindow({width:1440,height:950,minWidth:1000,minHeight:720,title:'LabPad',icon,backgroundColor:'#0c111b',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 if(process.platform!=='darwin'){win.setAutoHideMenuBar(false);win.setMenuBarVisibility(false);}
 win.webContents.on('before-input-event',(event,input)=>{
   if((process.platform==='darwin'?input.meta:input.control)&&!input.alt&&input.type==='keyDown'&&(input.key==='0'||input.code==='Digit0')){
    event.preventDefault();win.webContents.setZoomFactor(1);if(config){config={...config,zoomFactor:1};void storage.saveConfig(config);send('zoom:changed',1);}
   }
  });
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
 try{await initialize();}catch(e){dialog.showErrorBox('无法打开 LabPad 数据目录',storage.root+'\n\n'+String(e));await compiler.dispose();await formatter.dispose();win.destroy();app.quit();return;}
 win.on('close',event=>{
  if(closing)return;event.preventDefault();closing=true;
  void(async()=>{
   try{
    if(documentDirty&&currentDocument){
     const choice=config.saveMode==='auto'?'save':await confirmUnsaved();
     if(choice==='cancel'){closing=false;return;}if(choice==='save'){if(openBuffers.length)for(const buffer of openBuffers)await persist(buffer);else await storage.save(currentDocument,false);}
    }
    await stopWarmup();await stop();await saves;if(initialized)await storage.flush();await compiler.dispose();await formatter.dispose();shortcutWindow?.destroy();win.destroy();app.quit();
   }catch(e){closing=false;dialog.showErrorBox('尚未保存',String(e));}
  })();
 });
 if(process.env.VITE_DEV_SERVER_URL)await win.loadURL(process.env.VITE_DEV_SERVER_URL);else await win.loadFile(path.join(__dirname,'../renderer/index.html'));
 scheduleWarmup();
});
app.on('window-all-closed',()=>app.quit());
