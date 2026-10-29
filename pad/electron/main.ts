import {app,BrowserWindow,dialog,ipcMain,Menu,shell} from 'electron';
import path from 'node:path';
import {mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {readFile,writeFile} from 'node:fs/promises';
import type {IPty} from 'node-pty';
import {createRequire} from 'node:module';
import {Compiler} from '../core/compiler';
import {judge} from '../core/judge';
import {Storage,decodeText,readJSON,importPairs} from '../core/storage';
import {filePart,validateConfig,validateDraft,validateProblem} from '../shared/validate';
import type {CompilerConfig,Config,Draft,DebugState,JudgeEvent,Language} from '../shared/types';

const root=path.resolve(__dirname,'../../..');
const chromeData=path.join(tmpdir(),'labpad-ui-'+process.pid);
mkdirSync(chromeData,{recursive:true});
app.setPath('userData',chromeData);app.setPath('sessionData',chromeData);
app.on('will-quit',()=>{try{rmSync(chromeData,{recursive:true,force:true,maxRetries:2,retryDelay:50});}catch{/* A locked cache can remain in the OS temporary directory. */}});
const pty=(app.isPackaged?require(path.join(process.resourcesPath,'app.asar.unpacked/node_modules/node-pty/lib/index.js')):createRequire(path.join(root,'pad/package.json'))('node-pty')) as typeof import('node-pty');
const platform=process.platform==='win32'?'win':process.platform==='darwin'?'mac':'linux';
const resourceRoot=app.isPackaged?process.resourcesPath:path.join(root,'.work');
const toolchain=app.isPackaged?path.join(resourceRoot,'toolchain'):path.join(resourceRoot,'toolchains',platform+'-'+process.arch);
const checkers=app.isPackaged?path.join(resourceRoot,'checkers'):path.join(resourceRoot,'checkers',platform+'-'+process.arch);
function dataLocation(){
 if(process.env.LABPAD_DATA_DIR)return path.resolve(process.env.LABPAD_DATA_DIR);
 if(!app.isPackaged)return path.join(root,'.work','dev-run','labpad');
 const base=process.platform==='darwin'?path.resolve(path.dirname(process.execPath),'../../..')
  :path.dirname(process.env.APPIMAGE||process.env.PORTABLE_EXECUTABLE_FILE||process.execPath);
 return path.join(base,'labpad');
}
const storage=new Storage(dataLocation());
const compiler=new Compiler({toolchain,checkers,
 processHost:process.platform==='win32'?path.join(checkers,'process-host.exe'):undefined});
let win:BrowserWindow,config:Config;
let controller:AbortController|undefined,active:Promise<unknown>|undefined,terminal:IPty|undefined;
let closing=false,initialized=false;
const send=(channel:string,value:unknown)=>{if(win&&!win.isDestroyed())win.webContents.send(channel,value);};
const debugState=(state:DebugState)=>send('debug:state',state);
const judgeEvent=(event:JudgeEvent)=>send('judge:event',event);
function requireIdle(){if(active)throw new Error('请先停止正在运行的任务');}
async function stop(){
 controller?.abort();
 await active;
}
function handle(channel:string,fn:(...args:any[])=>any){
 ipcMain.handle(channel,(event,...args)=>{if(event.sender!==win.webContents)throw new Error('无效窗口');return fn(...args);});
}
async function persist(d:Draft){
 const snapshot=validateDraft(d);await storage.save(snapshot);
 config={...config,currentLab:snapshot.problem.labId,currentProblem:snapshot.problem.problemId,language:snapshot.language};
 await storage.saveConfig(config);
}
async function startDebug(value:Draft){
 requireIdle();const d=structuredClone(validateDraft(value)),settings=structuredClone(config);
 const abort=new AbortController();controller=abort;
 debugState({status:'compiling'});
 const task=(async()=>{
  let prepared:Awaited<ReturnType<Compiler['compile']>>|undefined;
  try{
   await persist(d);
   prepared=await compiler.compile(d.source,d.language,settings.compiler,abort.signal);
   judgeEvent({type:'compilation',compilation:prepared.compilation});
   if(prepared.compilation.status==='cancelled'){debugState({status:'stopped'});return;}
   if(prepared.compilation.status==='CE'){debugState({status:'error',message:'编译失败，请查看“输出”页'});return;}
   if(abort.signal.aborted){debugState({status:'stopped'});return;}
   const env=await compiler.environment();
   await new Promise<void>((resolve,reject)=>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    let pending='',scheduled:ReturnType<typeof setTimeout>|undefined;
    const flush=()=>{if(pending){send('debug:data',pending);pending='';}scheduled=undefined;};
    try{
     const child=pty.spawn(prepared!.executable,[],{name:'xterm-256color',cols:100,rows:18,
      cwd:prepared!.directory,env:Object.fromEntries(Object.entries(env).filter((e):e is [string,string]=>e[1]!==undefined))});
     terminal=child;
     const kill=()=>{try{child.kill();}catch{}};
     abort.signal.addEventListener('abort',kill,{once:true});
     const dataListener=child.onData(data=>{
      pending=(pending+data).slice(-65536);
      if(!scheduled)scheduled=setTimeout(flush,16);
     });
     const exitListener=child.onExit(exit=>{
      if(timer)clearTimeout(timer);if(scheduled)clearTimeout(scheduled);flush();
      abort.signal.removeEventListener('abort',kill);dataListener.dispose();exitListener.dispose();
      terminal=undefined;
      debugState({status:abort.signal.aborted?'stopped':'exited',message:'退出码 '+exit.exitCode});
      resolve();
     });
     if(settings.debugTimeLimitMs)timer=setTimeout(()=>abort.abort(),settings.debugTimeLimitMs);
     debugState({status:'running'});
     if(abort.signal.aborted)kill();
    }catch(error){reject(error);}
   });
  }catch(error){debugState({status:'error',message:error instanceof Error?error.message:String(error)});}
  finally{await prepared?.cleanup();}
 })();
 active=task;
 void task.finally(()=>{if(active===task){active=undefined;controller=undefined;}});
}
async function initialize(){
 config=await storage.init();initialized=true;
 handle('bootstrap',async()=>({
  config,draft:await storage.load(config.currentLab,config.currentProblem,config.language),
  dataRoot:storage.root,version:app.getVersion(),
  compilerLabel:await compiler.info(config.compiler).catch((e:Error)=>'编译器尚不可用：'+e.message)
 }));
 handle('draft:save',persist);
 handle('draft:load',async(lab:string,problem:string,language:Language)=>{
  requireIdle();if(!['c','cpp'].includes(language))throw new Error('无效语言');
  const draft=await storage.load(filePart(lab,'实验名称'),filePart(problem,'题号'),language);
  config={...config,currentLab:lab,currentProblem:problem,language};await storage.saveConfig(config);return draft;
 });
 handle('config:save',async(value:Config)=>{
  const next=structuredClone(validateConfig(value));await storage.saveConfig(next);config=next;return config;
 });
 handle('compiler:info',(value:CompilerConfig)=>compiler.info(validateConfig({...config,compiler:value}).compiler));
 handle('source:open',async()=>{
  const selected=await dialog.showOpenDialog(win,{title:'打开单文件源码',properties:['openFile'],filters:[{name:'C / C++ 源码',extensions:['c','cpp']}]});
  if(selected.canceled)return null;
  const file=selected.filePaths[0],extension=path.extname(file).toLowerCase();
  if(!['.c','.cpp'].includes(extension))throw new Error('仅支持 .c / .cpp 单文件');
  const decoded=decodeText(await readFile(file));return {source:decoded.text,encoding:decoded.encoding,language:extension==='.c'?'c':'cpp'};
 });
 handle('problem:import',async(lab:string,problem:string)=>{
  const selected=await dialog.showOpenDialog(win,{title:'导入题目 JSON 或完整 I/O 文件对',properties:['openFile','multiSelections'],
   filters:[{name:'题目或测试点',extensions:['json','in','out','ans']}]});
  if(selected.canceled)return null;
  if(selected.filePaths.length===1&&path.extname(selected.filePaths[0]).toLowerCase()==='.json')
   return validateProblem(await readJSON(selected.filePaths[0]));
  return importPairs(selected.filePaths,lab,problem);
 });
 handle('source:export',async(value:Draft)=>{
  const d=validateDraft(value);filePart(config.studentId,'请在设置中填写学号');
  if(!/^Lab \d+-\d+$/.test(d.problem.problemId))throw new Error('导出题号请使用 Lab 2-1 这样的格式');
  const name=config.studentId+'_'+d.problem.problemId+(d.language==='c'?'.c':'.cpp');
  const selected=await dialog.showSaveDialog(win,{title:'导出当前源码 · 选择保存位置',defaultPath:name,
   filters:[{name:'源码文件',extensions:[d.language==='c'?'c':'cpp']}]});
  if(selected.canceled||!selected.filePath)return null;
  await writeFile(selected.filePath,d.source.replace(/^\uFEFF/,''),'utf8');return selected.filePath;
 });
 handle('problem:show',async(value:Draft)=>{
  await persist(value);shell.showItemInFolder(storage.paths(value.problem.labId,value.problem.problemId,value.language).problem);
 });
 handle('judge',async(value:Draft)=>{
  requireIdle();const d=structuredClone(validateDraft(value));
  const abort=new AbortController();controller=abort;
  const settings=structuredClone(config.compiler);
  const task=Promise.resolve().then(async()=>{await persist(d);return judge(compiler,d,settings,abort.signal,judgeEvent);});active=task;
  try{return await task;}finally{if(active===task){active=undefined;controller=undefined;}}
 });
 handle('cancel',stop);handle('debug:stop',stop);
 handle('debug:start',startDebug);
 ipcMain.on('debug:input',(event,data:unknown)=>{if(event.sender===win.webContents&&typeof data==='string')terminal?.write(data);});
 ipcMain.on('debug:resize',(event,cols:number,rows:number)=>{
  if(event.sender===win.webContents&&Number.isSafeInteger(cols)&&Number.isSafeInteger(rows)&&cols>0&&rows>0)
   try{terminal?.resize(Math.min(cols,500),Math.min(rows,200));}catch{}
 });
}
app.whenReady().then(async()=>{
 Menu.setApplicationMenu(Menu.buildFromTemplate([
  ...(process.platform==='darwin'?[{role:'appMenu' as const}]:[]),
  {label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
  {label:'视图',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]}
 ] as Electron.MenuItemConstructorOptions[]));
 win=new BrowserWindow({width:1440,height:950,minWidth:1000,minHeight:720,title:'LabPad · 实验自测',
  backgroundColor:'#0c111b',webPreferences:{preload:path.join(__dirname,'preload.cjs'),
   contextIsolation:true,nodeIntegration:false,sandbox:true}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',event=>event.preventDefault());
 try{await initialize();}
 catch(error){
  dialog.showErrorBox('无法打开 LabPad 数据目录',storage.root+'\n\n'+String(error)+'\n请将程序放在可写目录中，或修复现有配置。');
  await compiler.dispose();win.destroy();app.quit();return;
 }
 win.on('close',event=>{
  if(closing)return;event.preventDefault();closing=true;
  void (async()=>{
   try{await stop();if(initialized)await storage.flush();await compiler.dispose();win.destroy();app.quit();}
   catch(error){closing=false;dialog.showErrorBox('尚未保存',String(error));}
  })();
 });
 if(process.env.VITE_DEV_SERVER_URL)await win.loadURL(process.env.VITE_DEV_SERVER_URL);
 else await win.loadFile(path.join(__dirname,'../renderer/index.html'));
});
app.on('window-all-closed',()=>app.quit());
