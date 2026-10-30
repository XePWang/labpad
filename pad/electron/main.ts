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
import {parseLabPackage,parseTestCases} from '../shared/project-format';
import {prepareSource,prepareProject,submissionZip,fingerprint,checkRecord,type Submission} from '../core/submission';
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
async function persist(value:Draft):Promise<SaveResult>{
 const snapshot=structuredClone(validateDraft(value)),original=JSON.stringify(snapshot),options=structuredClone(config);
 const task=saves.catch(()=>{}).then(async()=>{
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
async function confirmExport(prepared:Submission){
 if(!prepared.warnings.length)return true;
 const result=await dialog.showMessageBox(win,{type:'warning',title:'导出前请确认',message:'以下内容需要确认，仍要导出吗？',
  detail:prepared.warnings.join('\n\n')+'\n\n将导出当前代码；未保存的编辑也会包含在内。',buttons:['取消导出','仍然导出'],defaultId:0,cancelId:0,noLink:true});
 return result.response===1;
}
async function confirmUnsaved(){
 const result=await dialog.showMessageBox(win,{type:'question',title:'保存修改',message:'当前源码或测试点有未保存的修改。',buttons:['保存','不保存','取消'],defaultId:0,cancelId:2,noLink:true});
 return (['save','discard','cancel'] as const)[result.response];
}
async function startDebug(value:Draft){
 requireIdle();await stopWarmup();requireIdle();const d=structuredClone(validateDraft(value)),settings=structuredClone(config),abort=new AbortController();controller=abort;
 debugState({status:'compiling'});
 let outcome:DebugState|undefined;
 const task=(async()=>{
  let prepared:Awaited<ReturnType<Compiler['compile']>>|undefined,shutdown:Promise<void>|undefined;
  try{
   prepared=await compiler.compile(d.source,d.language,settings.compiler,abort.signal);
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
 handle('projects',()=>storage.projects());
 handle('project:create',async(name:string)=>{requireIdle();await saves;const carry=currentDocument&&structuredClone(currentDocument);await storage.createLab(name);const next=await selectDraft(name,'',config.language);if(carry){const copy=await storage.newVersion({...next,source:carry.source,language:carry.language});currentDocument=copy;return copy;}return next;});
 handle('problem:create',async(lab:string,name:string,language:Language)=>{requireIdle();await saves;const carry=currentDocument&&!currentDocument.problem.problemId?structuredClone(currentDocument):undefined;const next=await storage.createProblem(lab,name,language);if(carry)await storage.save({...next,source:carry.source,language:carry.language});return selectDraft(lab,name,carry?.language??language);});
 ipcMain.on('document:state',(event,value:Draft,dirty:boolean)=>{if(event.sender===win.webContents){currentDocument=structuredClone(validateDraft(value));documentDirty=!!dirty;}});
 ipcMain.on('workspace:state',(event,values:Draft[],dirty:boolean)=>{if(event.sender===win.webContents){openBuffers=values.map(d=>structuredClone(validateDraft(d)));documentDirty=!!dirty;}});
 handle('documents:open',(lab:string,problem:string,language:Language)=>storage.openDocuments(lab,problem,language));
 handle('document:activate',async(id:string)=>{if(!currentDocument)throw new Error('尚未打开文件');await storage.activateDocument(currentDocument.problem.labId,currentDocument.problem.problemId,id);const state=await storage.projectState(currentDocument.problem.labId,currentDocument.problem.problemId,currentDocument.language),version=state.documents?.find(v=>v.id===id);if(version){config={...config,language:version.language,sourceFile:null};await storage.saveConfig(config);}});
 handle('source:version',(value:Draft,fromTemplate:boolean)=>{requireIdle();return storage.newVersion(value,fromTemplate===true);});
 handle('path:copy',(file:string,relative:boolean)=>{clipboard.writeText(relative?path.relative(storage.root,file):file);});
 handle('cache:clear',async()=>{requireIdle();await stopWarmup();return compiler.cache.clear();});
 handle('shortcuts:open',async()=>{
  if(shortcutWindow&&!shortcutWindow.isDestroyed()){shortcutWindow.focus();return;}
  shortcutWindow=new BrowserWindow({parent:win,width:760,height:750,minWidth:540,minHeight:480,title:'LabPad · 快捷键',icon:iconPath,backgroundColor:config.theme==='light'?'#ffffff':'#1e1e1e',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  shortcutWindow.setMenuBarVisibility(false);shortcutWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));shortcutWindow.webContents.on('will-navigate',e=>e.preventDefault());
  shortcutWindow.on('closed',()=>{shortcutWindow=undefined;});
  if(process.env.VITE_DEV_SERVER_URL)await shortcutWindow.loadURL(process.env.VITE_DEV_SERVER_URL+'#shortcuts');else await shortcutWindow.loadFile(path.join(__dirname,'../renderer/index.html'),{hash:'shortcuts'});
 });
 ipcMain.handle('shortcuts:get',event=>{if(event.sender!==shortcutWindow?.webContents)throw new Error('无效窗口');return {shortcuts:config.shortcuts,theme:config.theme};});
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
  const file=selected.filePaths[0];if(!['.c','.cpp'].includes(path.extname(file).toLowerCase()))throw new Error('仅支持 .c / .cpp 单文件');
  const document=await storage.importSource(config.currentLab,config.currentProblem,file);
  currentDocument=document;config={...config,sourceFile:null,language:document.language};await storage.saveConfig(config);
  return {source:document.source,encoding:document.sourceEncoding!,path:document.sourceFile!,language:document.language,document};
 });
 handle('problem:save',async(value:unknown)=>{const problem=structuredClone(validateProblem(value));await saves;if(!currentDocument)throw new Error('尚未打开题目');await storage.save({...currentDocument,problem},false);});
 handle('problem:import',async(lab:string,problem:string)=>{
  requireIdle();selection(lab,problem);await saves;
  const current=currentDocument?.problem.labId===lab&&currentDocument.problem.problemId===problem?structuredClone(currentDocument):await storage.load(lab,problem,config.language);
  const selected=await dialog.showOpenDialog(win,{title:'导入标准 I/O · 当前题目',properties:['openFile','multiSelections'],filters:[{name:'标准 I/O',extensions:['json','in','out','ans']}]});
  if(selected.canceled)return null;
  const imported=selected.filePaths.length===1&&path.extname(selected.filePaths[0]).toLowerCase()==='.json'
   ?parseTestCases(await readJSON(selected.filePaths[0]),current.problem):{...current.problem,testCases:(await importPairs(selected.filePaths,lab,problem)).testCases};
  await storage.save({...current,problem:imported},false);return imported;
 });
 handle('project:import',async()=>{
  requireIdle();await saves;
  const selected=await dialog.showOpenDialog(win,{title:'导入实验项目',properties:['openFile'],filters:[{name:'实验项目 JSON',extensions:['json']}]});
  if(selected.canceled)return null;
  const lab=parseLabPackage(await readJSON(selected.filePaths[0])),name=await storage.nextLabName(lab.labId);
  if(name!==lab.labId){
   const choice=await dialog.showMessageBox(win,{type:'question',title:'导入项目副本',message:'“'+lab.labId+'”已存在。',detail:'将导入为“'+name+'”，原项目保留。',buttons:['取消导入','导入副本'],defaultId:0,cancelId:0,noLink:true});
   if(choice.response!==1)return null;
  }
  const imported=await storage.importProject(lab,name);await selectDraft(imported.labId,imported.problemId,imported.language);
  return bootstrap();
 });
 handle('source:export',async(value:Draft)=>{
  requireIdle();await saves;
  const d=structuredClone(validateDraft(value)),prepared=await prepareSource(storage,d,structuredClone(config),submissionServices());
  if(!await confirmExport(prepared))return null;
  const selected=await dialog.showSaveDialog(win,{title:'导出源码 · 选择保存位置',defaultPath:prepared.name,filters:[{name:'源码文件',extensions:[d.language==='c'?'c':'cpp']}]});
  if(selected.canceled||!selected.filePath)return null;
  await writeSource(selected.filePath,prepared.files[0].source);return selected.filePath;
 });
 handle('project:export',async(value:Draft)=>{
  requireIdle();await saves;
  const prepared=await prepareProject(storage,value,structuredClone(config),submissionServices());
  if(!await confirmExport(prepared))return null;
  const selected=await dialog.showSaveDialog(win,{title:'导出实验项目 · 选择保存位置',defaultPath:prepared.name,filters:[{name:'ZIP 压缩包',extensions:['zip']}]});
  if(selected.canceled||!selected.filePath)return null;
  const file=path.extname(selected.filePath)?selected.filePath:selected.filePath+'.zip';
  if(path.extname(file).toLowerCase()!=='.zip')throw new Error('实验项目请保存为 .zip 格式');
  await writeFileAtomic(file,Buffer.from(submissionZip(prepared)));return file;
 });
 handle('problem:show',async(value:Draft)=>{
  const d=validateDraft(value),file=storage.paths(d.problem.labId,d.problem.problemId,d.language).problem;
  if(!await exists(file))throw new Error('请先保存当前题目，再打开题目文件');shell.showItemInFolder(file);
 });
 handle('judge',async(value:Draft)=>{
  requireIdle();await stopWarmup();requireIdle();const d=structuredClone(validateDraft(value)),options=structuredClone(config.compiler),abort=new AbortController();controller=abort;
  const task=(async()=>{
   const hash=fingerprint(d,options,await compiler.identity(options,d.language));
   await storage.recordCheck(d,checkRecord(d,hash));
   const result=await judge(compiler,d,options,abort.signal,judgeEvent);
   await storage.recordCheck(d,checkRecord(d,hash,result));return result;
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
 {label:'视图',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]}
 ] as Electron.MenuItemConstructorOptions[]));
 const icon=nativeImage.createFromPath(iconPath);if(process.platform==='darwin'&&!icon.isEmpty())app.dock?.setIcon(icon);
 win=new BrowserWindow({width:1440,height:950,minWidth:1000,minHeight:720,title:'LabPad',icon,backgroundColor:'#0c111b',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 if(process.platform!=='darwin'){win.setAutoHideMenuBar(false);win.setMenuBarVisibility(false);}
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
