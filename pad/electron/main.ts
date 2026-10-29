import {app,BrowserWindow,dialog,ipcMain,Menu,shell,nativeImage,nativeTheme} from 'electron';
import {Formatter} from '../core/formatter';
import path from 'node:path';
import {mkdirSync,rmSync,constants} from 'node:fs';
import {tmpdir} from 'node:os';
import {readFile,writeFile,mkdir,stat,access,realpath,rename} from 'node:fs/promises';
import type {IPty} from 'node-pty';
import {createRequire} from 'node:module';
import {Compiler} from '../core/compiler';
import {judge} from '../core/judge';
import {Storage,decodeText,readJSON,importPairs,exists,exportName,writeSource} from '../core/storage';
import {filePart,selection,validateConfig,validateDraft,validateProblem} from '../shared/validate';
import type {CompilerConfig,Config,Draft,DebugState,JudgeEvent,Language,PathKind,SaveResult} from '../shared/types';
app.setName('LabPad');if(process.platform==='win32')app.setAppUserModelId('cn.xep.labpad');
const root=path.resolve(__dirname,'../../..'),chromeData=path.join(tmpdir(),'labpad-ui-'+process.pid);
mkdirSync(chromeData,{recursive:true});app.setPath('userData',chromeData);app.setPath('sessionData',chromeData);
app.on('will-quit',()=>{try{rmSync(chromeData,{recursive:true,force:true,maxRetries:2,retryDelay:50});}catch{}});
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
const compiler=new Compiler({toolchain,checkers,processHost:process.platform==='win32'?path.join(checkers,'process-host.exe'):undefined});
let win:BrowserWindow,config:Config,currentDocument:Draft|undefined,documentDirty=false,sourceEncoding='UTF-8';
let controller:AbortController|undefined,active:Promise<unknown>|undefined,terminal:IPty|undefined;
let closing=false,initialized=false,saves:Promise<unknown>=Promise.resolve();
const send=(channel:string,value:unknown)=>{if(win&&!win.isDestroyed())win.webContents.send(channel,value);};
const debugState=(state:DebugState)=>send('debug:state',state),judgeEvent=(event:JudgeEvent)=>send('judge:event',event);
function requireIdle(){if(active)throw new Error('请先停止正在运行的任务');}
async function stop(){controller?.abort();await active;}
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
 const snapshot=structuredClone(validateDraft(value)),original=JSON.stringify(snapshot),file=config.sourceFile,encoding=sourceEncoding,options=structuredClone(config);
 const task=saves.catch(()=>{}).then(async()=>{
  let formatWarning:string|undefined;
  if(options.formatOnSave){try{snapshot.source=await formatter.format(snapshot.source,snapshot.language,options.indentSize);}catch(e){formatWarning='格式化失败，已保存原文：'+(e instanceof Error?e.message:String(e));}}
  if(file)await writeSource(file,snapshot.source,encoding);
  await storage.save(snapshot,!file);
  config={...config,currentLab:snapshot.problem.labId,currentProblem:snapshot.problem.problemId,language:snapshot.language};
  await storage.saveConfig(config);
  if(currentDocument&&(JSON.stringify(currentDocument)===original||JSON.stringify(currentDocument)===JSON.stringify(snapshot))){currentDocument=structuredClone(snapshot);documentDirty=false;}
  return {path:file||storage.paths(snapshot.problem.labId,snapshot.problem.problemId,snapshot.language).source,source:snapshot.source,formatWarning};
 });
 saves=task.catch(()=>{});return task;
}
async function selectDraft(lab:string,problem:string,language:Language){
 requireIdle();selection(lab,problem);if(!['c','cpp'].includes(language))throw new Error('无效语言');await saves;await storage.flush();
 const draft=await storage.load(lab,problem,language);
 config={...config,currentLab:lab,currentProblem:problem,language,sourceFile:null};await storage.saveConfig(config);
 currentDocument=draft;documentDirty=false;sourceEncoding='UTF-8';return draft;
}
async function settingsResult(){
 return {config,dataRoot:storage.root,projects:await storage.projects(),compilerLabel:await compiler.info(config.compiler).catch((e:Error)=>'编译器尚不可用：'+e.message)};
}
async function bootstrap(){
 let draft=currentDocument?structuredClone(currentDocument):await storage.load(config.currentLab,config.currentProblem,config.language),warning:string|undefined;
 if(!currentDocument&&config.sourceFile){
  try{
   const decoded=decodeText(await readFile(config.sourceFile));draft.source=decoded.text;sourceEncoding=decoded.encoding;
   draft.language=path.extname(config.sourceFile).toLowerCase()==='.cpp'?'cpp':'c';
  }catch(e){warning='无法打开原源码：'+config.sourceFile+'\n'+String(e);config={...config,sourceFile:null};await storage.saveConfig(config);}
 }
 const managed=storage.paths(draft.problem.labId,draft.problem.problemId,draft.language).source;
 if(!currentDocument){currentDocument=structuredClone(draft);documentDirty=false;}
 return {...await settingsResult(),draft,sourcePath:config.sourceFile||(await exists(managed)?managed:null),version:app.getVersion(),warning};
}
async function confirmUnsaved(){
 const result=await dialog.showMessageBox(win,{type:'question',title:'保存修改',message:'当前源码或测试点有未保存的修改。',buttons:['保存','不保存','取消'],defaultId:0,cancelId:2,noLink:true});
 return (['save','discard','cancel'] as const)[result.response];
}
async function startDebug(value:Draft){
 requireIdle();const d=structuredClone(validateDraft(value)),settings=structuredClone(config),abort=new AbortController();controller=abort;
 debugState({status:'compiling'});
 const task=(async()=>{
  let prepared:Awaited<ReturnType<Compiler['compile']>>|undefined;
  try{
   prepared=await compiler.compile(d.source,d.language,settings.compiler,abort.signal);
   judgeEvent({type:'compilation',compilation:prepared.compilation});
   if(prepared.compilation.status==='cancelled'){debugState({status:'stopped'});return;}
   if(prepared.compilation.status==='CE'){debugState({status:'error',message:'编译失败，请查看“输出”页'});return;}
   if(abort.signal.aborted){debugState({status:'stopped'});return;}
   const env=await compiler.environment();
   await new Promise<void>((resolve,reject)=>{
    let timer:ReturnType<typeof setTimeout>|undefined,pending='',scheduled:ReturnType<typeof setTimeout>|undefined;
    const flush=()=>{if(pending){send('debug:data',pending);pending='';}scheduled=undefined;};
    try{
     const child=pty.spawn(prepared!.executable,[],{name:'xterm-256color',cols:100,rows:18,cwd:prepared!.directory,env:Object.fromEntries(Object.entries(env).filter((e):e is [string,string]=>e[1]!==undefined))});terminal=child;
     const kill=()=>{try{child.kill();}catch{}};
     abort.signal.addEventListener('abort',kill,{once:true});
     const dataListener=child.onData(data=>{pending=(pending+data).slice(-65536);if(!scheduled)scheduled=setTimeout(flush,16);});
     const exitListener=child.onExit(exit=>{
      if(timer)clearTimeout(timer);if(scheduled)clearTimeout(scheduled);flush();
      abort.signal.removeEventListener('abort',kill);dataListener.dispose();exitListener.dispose();terminal=undefined;
      debugState({status:abort.signal.aborted?'stopped':'exited',message:'退出码 '+exit.exitCode});resolve();
     });
     if(settings.debugTimeLimitMs)timer=setTimeout(()=>abort.abort(),settings.debugTimeLimitMs);
     debugState({status:'running'});if(abort.signal.aborted)kill();
    }catch(e){reject(e);}
   });
  }catch(e){debugState({status:'error',message:e instanceof Error?e.message:String(e)});}
  finally{await prepared?.cleanup();}
 })();
 active=task;void task.finally(()=>{if(active===task){active=undefined;controller=undefined;}});
}
async function initialize(){
 if(await exists(locationFile)){
  const value=await readJSON(locationFile) as {dataDirectory:string};await requirePath(value.dataDirectory,'directory');storage=new Storage(await realpath(value.dataDirectory));
 }
 config=await storage.init();initialized=true;nativeTheme.themeSource=config.theme;win.setBackgroundColor(config.theme==='light'?'#ffffff':'#1e1e1e');
 const projects=await storage.projects();
 if(!projects.some(p=>p.labId===config.currentLab)){config.currentLab='';config.currentProblem='';}
 else if(!projects.find(p=>p.labId===config.currentLab)!.problems.includes(config.currentProblem))config.currentProblem='';
 handle('bootstrap',bootstrap);handle('draft:save',persist);handle('draft:load',selectDraft);
 handle('draft:reload',async()=>{requireIdle();await saves;currentDocument=undefined;documentDirty=false;return bootstrap();});
 handle('projects',()=>storage.projects());
 handle('project:create',async(name:string)=>{requireIdle();await saves;await storage.createLab(name);return selectDraft(name,'',config.language);});
 handle('problem:create',async(lab:string,name:string,language:Language)=>{requireIdle();await saves;await storage.createProblem(lab,name,language);return selectDraft(lab,name,language);});
 ipcMain.on('document:state',(event,value:Draft,dirty:boolean)=>{if(event.sender===win.webContents){currentDocument=structuredClone(validateDraft(value));documentDirty=!!dirty;}});
 handle('document:confirm',confirmUnsaved);
 handle('path:validate',validatePath);
 handle('path:choose',async(kind:PathKind,current:string)=>{
  const result=await dialog.showOpenDialog(win,{title:kind==='directory'?'选择数据保存位置':'选择编译器可执行文件',defaultPath:current||undefined,properties:kind==='directory'?['openDirectory']:['openFile']});
  return result.canceled?null:result.filePaths[0];
 });
 handle('path:reveal',async(value:string,kind:PathKind)=>{await requirePath(value,kind);if(kind==='directory'){const error=await shell.openPath(value);if(error)throw new Error(error);}else shell.showItemInFolder(value);});
 handle('config:save',async(value:Config,dataRoot:string)=>{
  requireIdle();await saves;
  const next=structuredClone(validateConfig({...value,currentLab:config.currentLab,currentProblem:config.currentProblem,sourceFile:config.sourceFile}));
  await requirePath(dataRoot,'directory');const target=await realpath(dataRoot.trim());
  if(next.compiler.mode==='custom'){
   next.compiler.cPath=next.compiler.cPath.trim();next.compiler.cppPath=next.compiler.cppPath.trim();
   await requirePath(next.compiler.cPath,'executable');
   if(next.compiler.cppPath)await requirePath(next.compiler.cppPath,'executable');
   else if(next.language==='cpp'&&next.compiler.kind!=='zig')throw new Error('请填写 C++ 驱动路径');
  }
  await compiler.info(next.compiler);
  if(target!==await realpath(storage.root)){
   await storage.copyDataTo(target);const replacement=new Storage(target);await replacement.saveConfig(next);
   await mkdir(defaultRoot,{recursive:true});await writeFile(locationFile+'.tmp',JSON.stringify({dataDirectory:target},null,2)+'\n','utf8');await rename(locationFile+'.tmp',locationFile);storage=replacement;
  }else await storage.saveConfig(next);
  config=next;nativeTheme.themeSource=next.theme;win.setBackgroundColor(next.theme==='light'?'#ffffff':'#1e1e1e');return settingsResult();
 });
 handle('source:format',(source:string,language:Language,indentSize:number)=>{if(typeof source!=='string'||!['c','cpp'].includes(language))throw new Error('源码数据无效');return formatter.format(source,language,indentSize);});
 handle('compiler:info',(value:CompilerConfig)=>compiler.info(validateConfig({...config,compiler:value}).compiler));
 handle('source:open',async()=>{
  requireIdle();await saves;
  const selected=await dialog.showOpenDialog(win,{title:'打开单文件源码',properties:['openFile'],filters:[{name:'C / C++ 源码',extensions:['c','cpp']}]});
  if(selected.canceled)return null;
  const file=selected.filePaths[0],extension=path.extname(file).toLowerCase();
  if(!['.c','.cpp'].includes(extension))throw new Error('仅支持 .c / .cpp 单文件');
  const decoded=decodeText(await readFile(file));sourceEncoding=decoded.encoding;
  config={...config,sourceFile:file,language:extension==='.c'?'c':'cpp'};await storage.saveConfig(config);
  return {source:decoded.text,encoding:decoded.encoding,path:file,language:config.language};
 });
 handle('problem:import',async(lab:string,problem:string)=>{
  const selected=await dialog.showOpenDialog(win,{title:'导入题目 JSON 或完整 I/O 文件对',properties:['openFile','multiSelections'],filters:[{name:'题目或测试点',extensions:['json','in','out','ans']}]});
  if(selected.canceled)return null;
  const imported=selected.filePaths.length===1&&path.extname(selected.filePaths[0]).toLowerCase()==='.json'
   ?validateProblem(await readJSON(selected.filePaths[0])):await importPairs(selected.filePaths,lab,problem);
  await storage.save({source:'',language:config.language,problem:imported},false);
  config={...config,currentLab:imported.labId,currentProblem:imported.problemId};await storage.saveConfig(config);return imported;
 });
 handle('source:export',async(value:Draft)=>{
  const d=validateDraft(value),name=exportName(d,config.studentId);
  const selected=await dialog.showSaveDialog(win,{title:'导出当前源码 · 选择保存位置',defaultPath:name,filters:[{name:'源码文件',extensions:[d.language==='c'?'c':'cpp']}]});
  if(selected.canceled||!selected.filePath)return null;
  await writeSource(selected.filePath,d.source);return selected.filePath;
 });
 handle('problem:show',async(value:Draft)=>{
  const d=validateDraft(value),file=storage.paths(d.problem.labId,d.problem.problemId,d.language).problem;
  if(!await exists(file))throw new Error('请先保存当前题目，再打开题目文件');shell.showItemInFolder(file);
 });
 handle('judge',async(value:Draft)=>{
  requireIdle();const d=structuredClone(validateDraft(value)),abort=new AbortController();controller=abort;
  const task=Promise.resolve().then(()=>judge(compiler,d,structuredClone(config.compiler),abort.signal,judgeEvent));active=task;
  try{return await task;}finally{if(active===task){active=undefined;controller=undefined;}}
 });
 handle('cancel',stop);handle('debug:stop',stop);handle('debug:start',startDebug);
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
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
 try{await initialize();}catch(e){dialog.showErrorBox('无法打开 LabPad 数据目录',storage.root+'\n\n'+String(e));await compiler.dispose();await formatter.dispose();win.destroy();app.quit();return;}
 win.on('close',event=>{
  if(closing)return;event.preventDefault();closing=true;
  void(async()=>{
   try{
    if(documentDirty&&currentDocument){
     const choice=config.saveMode==='auto'?'save':await confirmUnsaved();
     if(choice==='cancel'){closing=false;return;}if(choice==='save')await persist(currentDocument);
    }
    await stop();await saves;if(initialized)await storage.flush();await compiler.dispose();await formatter.dispose();win.destroy();app.quit();
   }catch(e){closing=false;dialog.showErrorBox('尚未保存',String(e));}
  })();
 });
 if(process.env.VITE_DEV_SERVER_URL)await win.loadURL(process.env.VITE_DEV_SERVER_URL);else await win.loadFile(path.join(__dirname,'../renderer/index.html'));
});
app.on('window-all-closed',()=>app.quit());
