<script setup lang="ts">
import {computed,onMounted,onBeforeUnmount,ref,watch,nextTick} from 'vue';
import {Splitpanes,Pane,type SplitpanesResizedPayload} from 'splitpanes';
import 'splitpanes/dist/splitpanes.css';
import CodeEditor from './components/CodeEditor.vue';
import DebugTerminal from './components/DebugTerminal.vue';
import OutputDiff from './components/OutputDiff.vue';
import PathField from './components/PathField.vue';
import SourceTabs from './components/SourceTabs.vue';
import {createKeybindingsHandler,parseKeybinding,matchKeybindingPress} from 'tinykeys';
import ActionMenu from './components/ActionMenu.vue';
import type {Config,Draft,CaseResult,Compilation,DebugState,Project,DetectedCompiler,EditorCursor,LayoutConfig,LoadedDraft} from '../shared/types';
const api=window.labpad,clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const draft=ref<Draft>(),config=ref<Config>(),settings=ref<Config>(),projects=ref<Project[]>([]);
const dataRoot=ref(''),settingsRoot=ref(''),version=ref(''),sourcePath=ref<string|null>(null),compilerLabel=ref('正在读取编译器…');
const fileBusy=ref(false),blocked=computed(()=>!!busy.value||fileBusy.value);
const busy=ref<'judge'|'debug'|null>(null),debugRunning=ref(false),bottomTab=ref<'output'|'debug'>('output');
const logs=ref(''),error=ref(''),notice=ref(''),saveStatus=ref('已保存'),dirty=ref(false),ready=ref(false);
const settingsOpen=ref(false),settingsSaving=ref(false),settingsMessage=ref(''),pathValidity=ref({data:true,c:true,cpp:true});
const results=ref<Record<string,CaseResult>>({}),diffOpen=ref<Record<string,boolean>>({}),finished=ref(false),phase=ref('准备就绪');
const terminal=ref<InstanceType<typeof DebugTerminal>>(),editor=ref<InstanceType<typeof CodeEditor>>();
const cursor=ref<EditorCursor>({line:1,column:1,selectionChars:0,selectionLines:0,lines:1,focused:false}),hintIndex=ref(0);
let hintTimer:ReturnType<typeof setInterval>|undefined,noticeTimer:ReturnType<typeof setTimeout>|undefined,layoutTail:Promise<unknown>=Promise.resolve();
const footerPulse=ref('');let pulseTimer:ReturnType<typeof setTimeout>|undefined;
function flashFooter(text:string){clearTimeout(pulseTimer);footerPulse.value=text;pulseTimer=setTimeout(()=>{footerPulse.value='';},4000);}
const tips=computed(()=>[
 config.value?.saveMode==='auto'?'自动保存已开启，写完稍停即可保存。':'Ctrl+S 保存当前源码；导入副本也会保存在这里。',
 '空格小点只负责指路，导出的仍是普通空格。',
 '选中多行后按 Tab / Shift+Tab，整块调整缩进。',
 '没有测试点时，编译通过就会进入调试页。',
 'Shift+Alt+F 整理代码；Ctrl+Z 可整次撤销。',
 '测试输入、预期输出和比较规则随题目 JSON 保存。',
 '别急，先让一个小例子跑通。',
 '多测一个边界值，心里就多一点底。',
 '分隔线可以拖，给忙碌的一边多一点位置。',
 '分号藏得再好，编译器也会认真找。',
 '空输入、零、负数：边界值也想拥有姓名。',
 '测试点通过以后，别忘了再读一遍题目。',
 '思路卡住时，先把问题缩小一点。',
 '我负责对答案，你负责奇思妙想。',
 '累了就停一下，分号不会自己长出来。',
 '一个小测试，也能照亮一大段代码。',
 '选中几行按 Tab，大家一起挪一挪。',
 'Shift+Tab 往回走，缩进也有回头路。',
 'Ctrl+F 找一找，变量名不用靠眼力。',
 'Ctrl+Z 撤销、Ctrl+Shift+Z 重做，放心整理代码。',
 '输入跑完会关闭 stdin，读到 EOF 就可以收工。',
 '输出多了少了？点开 Diff 看看差在哪。',
 draft.value?.language==='cpp'?'一个 cout，也能帮思路探探路。':'一个 printf，也能帮思路探探路。',
 '导出前再跑一次，让提交更踏实。',
 '给测试点一个特别的输入，也许会有新发现。',
 '代码可以慢慢写，测试记得常常跑。'
]);
const footerHint=computed(()=>formatting.value?'正在整理代码格式…':busy.value?phase.value+' · '+compilerLabel.value:fileBusy.value?'正在准备文件…':notice.value||footerPulse.value|| (cursor.value.selectionChars?'已选 '+cursor.value.selectionChars+' 个字符 · '+cursor.value.selectionLines+' 行；Tab / Shift+Tab 可整块缩进。':tips.value[hintIndex.value%tips.value.length]));
interface SourceTab{id:string;document:LoadedDraft;savedSource:string;dirty:boolean;revision:number;status:string}
const tabs=ref<SourceTab[]>([]),activeId=ref('');let savedRules='';
const rulesDirty=ref(false),activeTab=computed(()=>tabs.value.find(t=>t.id===activeId.value));
const documentEpoch=ref(''),formatting=ref(false);
const compilerChoiceOpen=ref(false),compilerScanning=ref(false),detectedCompilers=ref<DetectedCompiler[]>([]),selectedCompiler=ref(''),compilerDialog=ref<HTMLElement>();
const newKind=ref<'lab'|'problem'|null>(null),newName=ref(''),newMessage=ref(''),newSaving=ref(false);
let pauseSave=true,revision=0,saveTail:Promise<unknown>=Promise.resolve(),saveTimer:ReturnType<typeof setTimeout>|undefined;
const disposers:(()=>void)[]=[];
const snapshot=()=>clone(draft.value!);
const passed=computed(()=>Object.values(results.value).filter(c=>c.verdict==='AC').length);
const problems=computed(()=>projects.value.find(p=>p.labId===draft.value?.problem.labId)?.problems??[]);
const filename=computed(()=>sourcePath.value?.split(/[\\/]/).pop()||(draft.value?.problem.problemId||'空项目')+(draft.value?.language==='cpp'?'.cpp':'.c'));
const validSettingsPaths=computed(()=>pathValidity.value.data&&(settings.value?.compiler.mode!=='custom'||(pathValidity.value.c&&pathValidity.value.cpp)));
const cArgs=computed({get:()=>settings.value?.compiler.cArgs.join('\n')??'',set:v=>{if(settings.value)settings.value.compiler.cArgs=v.split(/\r?\n/).filter(Boolean);}});
const cppArgs=computed({get:()=>settings.value?.compiler.cppArgs.join('\n')??'',set:v=>{if(settings.value)settings.value.compiler.cppArgs=v.split(/\r?\n/).filter(Boolean);}});
const linkArgs=computed({get:()=>settings.value?.compiler.linkArgs.join('\n')??'',set:v=>{if(settings.value)settings.value.compiler.linkArgs=v.split(/\r?\n/).filter(Boolean);}});
function message(e:unknown){return e instanceof Error?e.message:String(e);}
async function action(fn:()=>Promise<unknown>){error.value='';notice.value='';try{await fn();}catch(e){error.value=message(e);}}
async function fileAction(fn:()=>Promise<unknown>){
 if(blocked.value)return;fileBusy.value=true;clearTimeout(saveTimer);
 try{await saveTail.catch(()=>{});await fn();}finally{fileBusy.value=false;if(dirty.value&&config.value?.saveMode==='auto'){saveTimer=setTimeout(()=>void action(saveAll),350);}}
}
function invalidate(){results.value={};diffOpen.value={};finished.value=false;phase.value='内容已修改，请重新运行';}
function recordState(){
 if(!draft.value)return;
 api.documentState(snapshot(),dirty.value);
 api.workspaceState(tabs.value.filter(t=>t.dirty||rulesDirty.value).map(t=>({...clone(t.document),problem:clone(draft.value!.problem)})),rulesDirty.value||tabs.value.some(t=>t.dirty));
}
function enqueueSave(value:Draft,id:number){
 const tab=tabs.value.find(t=>t.id===value.documentId);if(!tab)return Promise.reject(new Error('请先新建或导入源码'));
 tab.status='保存中…';if(tab.id===activeId.value)saveStatus.value=tab.status;
 const task=saveTail.catch(()=>{}).then(()=>api.saveDraft(value)).then(async result=>{
  const current=tabs.value.find(t=>t.id===value.documentId);
  if(current){
   current.savedSource=result.source;current.document.sourceFile=result.path;
   if(current.revision===id||current.document.source===result.source){
    current.document.source=result.source;current.dirty=false;current.status='已保存';
    if(activeId.value===current.id){
     pauseSave=true;editor.value?.applyText(result.source);draft.value!.source=result.source;sourcePath.value=result.path;pauseSave=false;
    }
   }else{current.dirty=current.document.source!==result.source;current.status=current.dirty?'未保存':'已保存';}
  }
  if(JSON.stringify(value.problem)===JSON.stringify(draft.value!.problem)){savedRules=JSON.stringify(value.problem);rulesDirty.value=false;}
  dirty.value=!!activeTab.value?.dirty||rulesDirty.value;saveStatus.value=activeTab.value?.status??'已保存';recordState();
  if(result.formatWarning)error.value=result.formatWarning;
  flashFooter('已保存 · '+result.path);projects.value=await api.projects();return result.path;
 }).catch(e=>{if(tab){tab.status='保存失败';tab.dirty=true;}saveStatus.value=activeTab.value?.status??'保存失败';error.value=message(e);recordState();throw e;});
 saveTail=task;void task.catch(()=>{});return task;
}
watch(draft,()=>{
 if(pauseSave||!draft.value)return;
 revision++;const tab=activeTab.value;
 if(tab){tab.document={...clone(draft.value),sourceFile:sourcePath.value??undefined,name:tab.document.name,sourceEncoding:tab.document.sourceEncoding};tab.revision++;tab.dirty=tab.document.source!==tab.savedSource;tab.status=tab.dirty?'未保存':'已保存';}
 rulesDirty.value=JSON.stringify(draft.value.problem)!==savedRules;
 dirty.value=!!tab?.dirty||rulesDirty.value;saveStatus.value=dirty.value?'未保存':'已保存';footerPulse.value='';recordState();invalidate();clearTimeout(saveTimer);
 if(config.value?.saveMode==='auto'&&!fileBusy.value){saveTimer=setTimeout(()=>void action(saveAll),350);}
},{deep:true,flush:'sync'});
function replaceDraft(value:LoadedDraft,file:string|null=null,documents:LoadedDraft[]=[value]){
 clearTimeout(saveTimer);pauseSave=true;const unique=new Map(documents.map(d=>[d.documentId!,d]));if(value.documentId)unique.set(value.documentId,value);
 tabs.value=[...unique.values()].map(d=>({id:d.documentId!,document:clone(d),savedSource:d.source,dirty:false,revision:0,status:'已保存'}));
 activeId.value=value.documentId??tabs.value[0]?.id??'';documentEpoch.value=activeId.value;
 draft.value={...clone(value),documentId:activeId.value};sourcePath.value=file??value.sourceFile??null;dirty.value=false;rulesDirty.value=false;savedRules=JSON.stringify(value.problem);revision++;
 if(config.value){config.value.currentLab=value.problem.labId;config.value.currentProblem=value.problem.problemId;config.value.language=value.language;}
 if(value.warning)error.value=value.warning;results.value={};diffOpen.value={};finished.value=false;saveStatus.value='已保存';phase.value='准备就绪';pauseSave=false;recordState();
}
async function loadWorkspace(value:LoadedDraft){replaceDraft(value,null,await api.openDocuments(value.problem.labId,value.problem.problemId,value.language));}
function activateTab(id:string){
 if(blocked.value||id===activeId.value)return;const tab=tabs.value.find(t=>t.id===id);if(!tab)return;
 clearTimeout(saveTimer);pauseSave=true;const problem=clone(draft.value!.problem);activeId.value=id;draft.value={...clone(tab.document),problem};sourcePath.value=tab.document.sourceFile??null;documentEpoch.value=id;
 dirty.value=tab.dirty||rulesDirty.value;saveStatus.value=dirty.value?'未保存':tab.status;revision++;config.value!.language=tab.document.language;pauseSave=false;invalidate();recordState();
 void action(()=>api.activateDocument(id));nextTick(()=>editor.value?.focus());
 if(config.value?.saveMode==='auto'&&(tabs.value.some(t=>t.dirty)||rulesDirty.value))saveTimer=setTimeout(()=>void action(saveAll),350);
}
async function saveNow(){clearTimeout(saveTimer);await saveTail.catch(()=>{});if(activeTab.value)await enqueueSave(snapshot(),activeTab.value.revision);else if(rulesDirty.value){await api.saveProblem(clone(draft.value!.problem));savedRules=JSON.stringify(draft.value!.problem);rulesDirty.value=false;dirty.value=false;recordState();}}
async function saveAll(){clearTimeout(saveTimer);await saveTail.catch(()=>{});if(!tabs.value.length){await saveNow();return;}for(const tab of [...tabs.value].filter(t=>t.dirty||rulesDirty.value||tabs.value.length===1))await enqueueSave({...clone(tab.document),problem:clone(draft.value!.problem)},tab.revision);if(activeId.value)await api.activateDocument(activeId.value);}
async function beforeChange(){
 clearTimeout(saveTimer);await saveTail.catch(()=>{});
 if(!rulesDirty.value&&!tabs.value.some(t=>t.dirty))return true;
 if(config.value!.saveMode==='auto'){await saveAll();return true;}
 const choice=await api.confirmUnsaved();if(choice==='cancel')return false;if(choice==='save')await saveAll();return true;
}
async function chooseSave(value:string){await(value==='all'?saveAll():saveNow());}
async function tabAction(value:string,id=activeId.value){
 const index=tabs.value.findIndex(t=>t.id===id),tab=tabs.value[index];if(!tab)return;
 if(value==='copyPath'||value==='copyRelativePath'){if(tab.document.sourceFile)await api.copyPath(tab.document.sourceFile,value==='copyRelativePath');return;}
 if(value==='version'){const created=await api.newVersion({...clone(tab.document),problem:clone(draft.value!.problem)});addDocument(created);return;}
 let targets=value==='others'?tabs.value.filter(t=>t.id!==id):value==='right'?tabs.value.slice(index+1):value==='saved'?tabs.value.filter(t=>!t.dirty):value==='all'?tabs.value:[tab];
 if(!targets.length)return;const closesAll=targets.length===tabs.value.length;
 if(targets.some(t=>t.dirty)||(closesAll&&rulesDirty.value)){
  const choice=config.value!.saveMode==='auto'?'save':await api.confirmUnsaved();if(choice==='cancel')return;
  if(choice==='save')for(const t of targets.filter(t=>t.dirty||rulesDirty.value))await enqueueSave({...clone(t.document),problem:clone(draft.value!.problem)},t.revision);
  else if(closesAll&&rulesDirty.value){const original=await api.loadDraft(draft.value!.problem.labId,draft.value!.problem.problemId,draft.value!.language);pauseSave=true;draft.value!.problem=original.problem;savedRules=JSON.stringify(original.problem);rulesDirty.value=false;pauseSave=false;}
 }
 const ids=new Set(targets.map(t=>t.id));tabs.value=tabs.value.filter(t=>!ids.has(t.id));
 if(ids.has(activeId.value)){
  const next=tabs.value[Math.min(index,tabs.value.length-1)];activeId.value='';if(next)activateTab(next.id);else{documentEpoch.value='';dirty.value=rulesDirty.value;recordState();}
 }else recordState();
}
function addDocument(document:LoadedDraft){
 const found=tabs.value.find(t=>t.id===document.documentId);
 if(!found)tabs.value.push({id:document.documentId!,document:clone(document),savedSource:document.source,dirty:false,revision:0,status:'已保存'});
 const was=fileBusy.value;fileBusy.value=false;activateTab(document.documentId!);fileBusy.value=was;recordState();
}
function selectionAction(event:Event,lab:boolean){const control=event.target as HTMLSelectElement,value=control.value;control.value=lab?draft.value!.problem.labId:draft.value!.problem.problemId;void action(()=>fileAction(()=>lab?selectLab(value):selectProblem(value)));}
async function selectLab(value:string){
 if(value==='@new:lab'){newKind.value='lab';newName.value='';newMessage.value='';return;}
 if(!await beforeChange())return;
 const problem=projects.value.find(p=>p.labId===value)?.problems[0]??'';
 await loadWorkspace(await api.loadDraft(value,problem,draft.value!.language));
}
async function selectProblem(value:string){
 if(value==='@new:problem'){newKind.value='problem';newName.value='';newMessage.value='';return;}
 if(await beforeChange())await loadWorkspace(await api.loadDraft(draft.value!.problem.labId,value,draft.value!.language));
}
async function createItem(){
 if(newSaving.value)return;newSaving.value=true;newMessage.value='';
 try{
  if(!await beforeChange())return;recordState();
  const value=newKind.value==='lab'?await api.createLab(newName.value):await api.createProblem(draft.value!.problem.labId,newName.value,draft.value!.language);
  projects.value=await api.projects();await loadWorkspace(value);newKind.value=null;
 }catch(e){newMessage.value=message(e);}finally{newSaving.value=false;}
}
function applyBootstrap(state:Awaited<ReturnType<typeof api.bootstrap>>){
 config.value=state.config;projects.value=state.projects;version.value=state.version;dataRoot.value=state.dataRoot;compilerLabel.value=state.compilerLabel;
 replaceDraft(state.draft,state.sourcePath,state.documents);ready.value=true;if(state.warning)error.value=state.warning;
}
async function reload(){if(await beforeChange())applyBootstrap(await api.reloadDocument());}
async function newSource(value:string){
 if(value!=='c'&&value!=='cpp')return;
 const created=await api.newVersion({...snapshot(),documentId:undefined,language:value},true);
 addDocument(created);phase.value='准备就绪';flashFooter('已新建 · '+created.sourceFile);
}
async function importSourceFile(){
 const value=await api.importSource();if(!value)return;addDocument(value.document);
 notice.value='已导入 '+value.path+' · '+value.encoding;
}
async function importIO(){
 clearTimeout(saveTimer);await saveTail;
 const problem=await api.importIO(draft.value!.problem.labId,draft.value!.problem.problemId);if(!problem)return;
 const wasDirty=dirty.value;pauseSave=true;draft.value!.problem=problem;revision++;savedRules=JSON.stringify(problem);rulesDirty.value=false;pauseSave=false;
 config.value!.currentLab=problem.labId;config.value!.currentProblem=problem.problemId;
 dirty.value=wasDirty;saveStatus.value=wasDirty?'未保存':'已保存';recordState();invalidate();projects.value=await api.projects();
 if(wasDirty&&config.value!.saveMode==='auto')await saveNow();
 notice.value='已导入 '+problem.testCases.length+' 个测试点';
}
async function formatCode(){
 if(formatting.value||blocked.value)return;
 formatting.value=true;const id=revision,size=config.value!.indentSize,language=draft.value!.language;
 try{
  const formatted=await api.formatCode(draft.value!.source,language,size);
  if(id!==revision||size!==config.value!.indentSize||language!==draft.value!.language){notice.value='代码或缩进设置已改变，请重新格式化';return;}
  editor.value?.applyText(formatted);editor.value?.focus();
 }finally{formatting.value=false;}
}
async function importProject(){if(!await beforeChange())return;const result=await api.importProject();if(result){applyBootstrap(result);notice.value='已导入项目：'+result.draft.problem.labId;}}
async function chooseImport(value:string){await fileAction(value==='source'?importSourceFile:value==='project'?importProject:importIO);}
async function chooseExport(value:string){await fileAction(async()=>{const file=await(value==='project'?api.exportProject(snapshot()):api.exportSource(snapshot()));if(file)notice.value='已导出：'+file;});}
function showCompilation(c:Compilation){
 logs.value='编译命令\n'+c.command.map(s=>/\s/.test(s)?JSON.stringify(s):s).join(' ')+'\n\n'
 +(c.stdout?'stdout\n'+c.stdout+'\n':'')+(c.stderr?'stderr\n'+c.stderr+'\n':'')+'\n编译状态：'+c.status+' · '+c.elapsedMs+' ms\n';
}
async function debug(){
 busy.value='debug';debugRunning.value=false;bottomTab.value='output';phase.value='编译中…';logs.value='';
 try{if(config.value!.saveMode==='auto'&&dirty.value)await saveNow();await api.debugStart(snapshot());}catch(e){busy.value=null;throw e;}
}
async function run(){
 if(!draft.value!.problem.testCases.length){await debug();return;}
 busy.value='judge';results.value={};finished.value=false;phase.value='编译中…';logs.value='';bottomTab.value='output';
 try{
  if(config.value!.saveMode==='auto'&&dirty.value)await saveNow();
  const result=await api.judge(snapshot());if(result.compilation)showCompilation(result.compilation);
  if(result.status==='error'){error.value=result.error||'评测任务失败';phase.value='任务错误';}
  else if(result.status==='cancelled')phase.value='已停止';
  else if(result.compilation?.status==='CE')phase.value='编译失败 · CE';else phase.value='测试完成';
  for(const c of result.cases)results.value[c.id]=c;
  logs.value+='\n'+result.cases.map(c=>'测试点 '+c.id+' · '+(c.verdict||c.status)+' · '+c.elapsedMs+' ms'
   +(c.exitCode!==null?' · 退出码 '+c.exitCode:'')+(c.signal?' · '+c.signal:'')+(c.message?'\n'+c.message:'')+(c.stderr?'\nstderr\n'+c.stderr:'')).join('\n\n');
 }finally{busy.value=null;finished.value=true;}
}
async function stop(){phase.value='正在停止…';await api.cancel();}
function addCase(){const tests=draft.value!.problem.testCases;let id=1;while(tests.some(t=>t.id===String(id)))id++;tests.push({id:String(id),input:'',expectedOutput:''});}
function openSettings(){settings.value=clone(config.value!);settingsRoot.value=dataRoot.value;settingsMessage.value='';settingsOpen.value=true;}
async function saveSettings(){
 if(settingsSaving.value)return;settingsSaving.value=true;settingsMessage.value='';
 try{
  const wasAuto=config.value!.saveMode==='auto',oldRoot=dataRoot.value,oldCompiler=compilerLabel.value;
  const languageChanged=settings.value!.language!==draft.value!.language;
  const reloadNeeded=settingsRoot.value!==dataRoot.value||languageChanged;
  if(reloadNeeded&&!await beforeChange())return;
  const result=await api.saveConfig(clone(settings.value!),settingsRoot.value);
  config.value=result.config;dataRoot.value=result.dataRoot;compilerLabel.value=result.compilerLabel;projects.value=result.projects;
  if(languageChanged){await loadWorkspace(await api.loadDraft(config.value.currentLab,config.value.currentProblem,config.value.language,false));}
  else if(reloadNeeded)applyBootstrap(await api.reloadDocument());
  else if(!wasAuto&&config.value.saveMode==='auto'&&dirty.value)await saveNow();
  settingsOpen.value=false;notice.value=oldRoot!==dataRoot.value?'数据目录：'+dataRoot.value:oldCompiler!==compilerLabel.value?compilerLabel.value:'设置已保存';
 }catch(e){settingsMessage.value=message(e);}finally{settingsSaving.value=false;}
}
async function detectInstalledCompilers(){
 if(compilerScanning.value)return;compilerScanning.value=true;
 try{detectedCompilers.value=await api.detectCompilers();selectedCompiler.value='';compilerChoiceOpen.value=true;await nextTick();compilerDialog.value?.focus();}
 finally{compilerScanning.value=false;}
}
function useDetectedCompiler(){
 const chosen=detectedCompilers.value.find(c=>c.id===selectedCompiler.value);if(!chosen||!settings.value)return;
 settings.value.compiler=clone(chosen.compiler);compilerChoiceOpen.value=false;
}
function resized(axis:keyof LayoutConfig,event:SplitpanesResizedPayload){
 if(!config.value||!event.event||event.panes.length!==2)return;
 const value=Math.round(event.panes[axis==='editorPercent'?0:1].size*10)/10;
 if(value===config.value.layout[axis])return;
 const layout={...config.value.layout,[axis]:value};config.value.layout=layout;
 layoutTail=layoutTail.catch(()=>{}).then(()=>api.saveLayout(layout)).catch(e=>{error.value='布局未保存：'+message(e);});
}
function handleDebugState(s:DebugState){
 if(s.status==='compiling'){busy.value='debug';phase.value='编译中…';}
 if(s.status==='running'){busy.value='debug';debugRunning.value=true;phase.value='调试运行中';bottomTab.value='debug';}
 if(['exited','stopped','error'].includes(s.status)){
  busy.value=null;debugRunning.value=false;phase.value=s.status==='stopped'?'已停止':s.status==='error'?'编译或调试失败':'调试结束';
  if(s.message)terminal.value?.write('\r\n['+s.message+']\r\n');if(s.status==='error'){error.value=s.message||'调试启动失败';bottomTab.value='output';}
 }
}
let keyHandler:(event:KeyboardEvent)=>void=()=>{};
let prefixes:ReturnType<typeof parseKeybinding>[number][]=[];
function installShortcuts(){
 const bindings:Record<string,(event:KeyboardEvent)=>void>={};
 prefixes=Object.values(config.value?.shortcuts??{}).flat().filter(key=>key.includes(' ')).map(key=>parseKeybinding(key)[0]);
 for(const [id,keys] of Object.entries(config.value?.shortcuts??{}))for(const key of keys)bindings[key]=event=>{
  if(event.repeat||fileBusy.value||settingsOpen.value||newKind.value||compilerChoiceOpen.value)return;
  const inTerminal=(event.target as Element)?.closest?.('.debug-terminal');
  if(id==='interrupt'){
   if(!inTerminal)return;event.preventDefault();event.stopPropagation();
   if(terminal.value?.selection())void navigator.clipboard.writeText(terminal.value.selection());else if(debugRunning.value)void action(stop);return;
  }
  if(['run','format','close','closeSaved','closeAll','next','previous'].includes(id)&&blocked.value)return;
  if(!tabs.value.length&&id!=='saveAll')return;event.preventDefault();event.stopPropagation();
  const operations:Record<string,()=>Promise<unknown>|void>={
   run,save:saveNow,saveAll,format:formatCode,close:()=>tabAction('close'),closeSaved:()=>tabAction('saved'),closeAll:()=>tabAction('all'),
   next:()=>activateTab(tabs.value[(tabs.value.findIndex(t=>t.id===activeId.value)+1)%tabs.value.length].id),
   previous:()=>activateTab(tabs.value[(tabs.value.findIndex(t=>t.id===activeId.value)-1+tabs.value.length)%tabs.value.length].id),
   copyPath:()=>tabAction('copyPath'),copyRelativePath:()=>tabAction('copyRelativePath')
  };
  installShortcuts();
  const fn=operations[id];if(fn)void action(async()=>{await fn();});
 };
 keyHandler=createKeybindingsHandler(bindings,{ignore:event=>event.repeat||event.isComposing});
}
function handleShortcut(event:KeyboardEvent){if(event.isComposing||event.repeat||settingsOpen.value||newKind.value||compilerChoiceOpen.value||fileBusy.value)return;const prefix=prefixes.some(press=>matchKeybindingPress(event,press));keyHandler(event);if(prefix){event.preventDefault();event.stopPropagation();}}
const cacheMessage=ref(''),clearingCache=ref(false);
async function clearCache(){
 clearingCache.value=true;cacheMessage.value='';
 try{const size=await api.clearCache();cacheMessage.value='已清理 '+(size/1024**2).toFixed(1)+' MB，下一次编译会重建缓存。';}catch(e){cacheMessage.value=message(e);}finally{clearingCache.value=false;}
}
onMounted(async()=>{
 if(!api){error.value='请在 LabPad 桌面窗口中打开此页面';return;}
 disposers.push(api.onJudge(event=>{if(event.type==='compilation'){showCompilation(event.compilation);if(busy.value==='judge'&&event.compilation.status==='success')phase.value='运行测试点…';}else results.value[event.result.id]=event.result;}),
 api.onDebugData((data,ack)=>terminal.value?.write(data,ack)),api.onDebugState(handleDebugState));
 disposers.push(api.onShortcuts(value=>{if(config.value)config.value.shortcuts=value;installShortcuts();}));
 window.addEventListener('keydown',handleShortcut,true);hintTimer=setInterval(()=>hintIndex.value++,9000);
 await action(async()=>{
  applyBootstrap(await api.bootstrap());installShortcuts();
 });
});
watch(notice,value=>{clearTimeout(noticeTimer);if(value)noticeTimer=setTimeout(()=>{notice.value='';},4000);});
onBeforeUnmount(()=>{clearInterval(hintTimer);clearTimeout(noticeTimer);clearTimeout(pulseTimer);clearTimeout(saveTimer);disposers.forEach(d=>d());window.removeEventListener('keydown',handleShortcut,true);});
</script>
<template>
 <div class="app-shell" :data-theme="config?.theme||'dark'">
  <header class="brandbar"><div class="brand"><span class="brand-mark">L<span>↗</span></span><strong>LabPad</strong><span class="dev-tag">DEV</span></div><span class="version">v{{version||'0.1.0-dev.6'}}</span></header>
  <div v-if="error" class="alert error" role="alert"><span>{{error}}</span><button @click="error=''">关闭</button></div>
  <div v-if="!ready" class="loading"><h2>正在准备工作区</h2><p>加载配置、源码与本地编译器。</p></div>
  <template v-if="ready&&draft&&config">
   <section class="toolbar">
    <div class="project-select"><label>实验项目<select aria-label="实验项目" :value="draft.problem.labId" :disabled="blocked" @change="selectionAction($event,true)"><option value="">&lt;无&gt;</option><option v-for="p in projects" :key="p.labId" :value="p.labId">{{p.labId}}</option><option value="@new:lab">＋ 新建项目…</option></select></label><span class="path-divider">/</span><label>题号<select aria-label="题号" :value="draft.problem.problemId" :disabled="blocked" @change="selectionAction($event,false)"><option value="">&lt;无&gt;</option><option v-for="p in problems" :key="p" :value="p">{{p}}</option><option value="@new:problem" :disabled="!draft.problem.labId">＋ 新建题号…</option></select></label><div class="run-actions"><button class="primary" :disabled="blocked||!activeTab" title="编译并运行（F9 / Ctrl+Enter）" @click="action(run)">▶ {{draft.problem.testCases.length?'编译并运行测试点':'编译并运行'}}</button><button class="stop" :disabled="!busy" @click="action(stop)">■ 停止</button><span class="phase"><i :class="{pulse:!!busy}"></i>{{phase}}</span></div></div>
    <div class="toolbar-actions"><ActionMenu label="新建源码" :items="[{label:'C 源码（.c）',value:'c'},{label:'C++ 源码（.cpp）',value:'cpp'}]" :disabled="blocked" @select="action(()=>fileAction(()=>newSource($event)))"/><ActionMenu label="导入" :items="[{label:'导入源码',value:'source'},{label:'导入标准 I/O',value:'io'},{label:'导入实验项目',value:'project'}]" :disabled="blocked" @select="action(()=>chooseImport($event))"/><ActionMenu label="保存" :items="[{label:'保存当前',value:'current'},{label:'保存全部',value:'all'}]" :disabled="fileBusy||(!tabs.length&&!rulesDirty)" @select="action(()=>chooseSave($event))"/><ActionMenu label="导出" :items="[{label:'导出源码',value:'source'},{label:'导出实验项目',value:'project'}]" :disabled="blocked" @select="action(()=>chooseExport($event))"/><span class="toolbar-separator"></span><button class="settings-button" :disabled="fileBusy" @click="openSettings">⚙ 设置</button></div>
   </section>
   <Splitpanes class="work-layout" horizontal :maximize-panes="false" @resized="resized('outputPercent',$event)"><Pane :size="100-config.layout.outputPercent" :min-size="35" :max-size="88"><Splitpanes class="workspace" :maximize-panes="false" @resized="resized('editorPercent',$event)">
    <Pane class="editor-pane" :size="config.layout.editorPercent" :min-size="20" :max-size="80">
    <SourceTabs :tabs="tabs.map(t=>({id:t.id,name:t.document.name||t.document.sourceFile?.split(/[\\/]/).pop()||'空项目.c',path:t.document.sourceFile||'',dirty:t.dirty}))" :active="activeId" :theme="config.theme" :disabled="blocked" @activate="activateTab" @action="(value,id)=>action(()=>tabAction(value,id))"/>
    <div v-if="activeTab" class="pane-heading editor-heading"><div :title="sourcePath||'保存后写入当前数据目录'"><span class="file-icon">{{draft.language==='c'?'C':'C++'}}</span>{{filename}}</div><div class="editor-actions"><button class="format-button" :disabled="blocked||formatting" @click="action(formatCode)">{{formatting?'格式化中…':'格式化代码'}}</button><span class="save-status" :class="{failed:saveStatus==='保存失败'}">{{saveStatus}}</span></div></div>
    <CodeEditor v-if="tabs.length" ref="editor" v-model="draft.source" :document-id="documentEpoch" :open-ids="tabs.map(t=>t.id)" :indent-size="config.indentSize" :theme="config.theme" :disabled="blocked" @cursor="cursor=$event"/>
    <div v-else class="editor-empty"><strong>代码在这里等你</strong><p>新建一份源码，或导入已有文件，继续编写。</p><div class="empty-editor-actions"><ActionMenu label="新建源码" :items="[{label:'C 源码（.c）',value:'c'},{label:'C++ 源码（.cpp）',value:'cpp'}]" :disabled="blocked" @select="action(()=>fileAction(()=>newSource($event)))"/></div></div>
    <div class="editor-status"><span>{{draft.language==='c'?'C':'C++'}} · 空格：{{config.indentSize}}</span><span>{{config.saveMode==='auto'?'自动保存':'手动保存'}}</span></div>
   </Pane>
    <Pane class="cases-pane" :size="100-config.layout.editorPercent" :min-size="20" :max-size="80"><div class="pane-heading"><div>测试点 <span class="counter">{{draft.problem.testCases.length}}</span><span v-if="finished" class="passed-count">{{passed}} / {{draft.problem.testCases.length}} 通过</span></div><div class="small-actions"><button :disabled="blocked" title="比较规则与时限保存在此 JSON 中" @click="action(()=>api.showProblemFile(snapshot()))">题目文件</button><button :disabled="blocked" title="重新读取已保存的源码与题目规则" @click="action(()=>fileAction(reload))">重新加载</button><button :disabled="blocked" @click="addCase">＋ 新增</button></div></div>
     <div class="cases-list"><div v-if="!draft.problem.testCases.length" class="empty-state"><h3>直接运行，或添加测试点</h3><p>没有测试点时，编译成功后进入下方调试页。<br>需要比较输出时，导入标准 I/O 或新增测试点。</p><button :disabled="blocked" @click="addCase">＋ 新增测试点</button></div>
      <article v-for="(test,index) in draft.problem.testCases" :key="test.id" class="case-card">
       <div class="case-heading"><strong><span class="case-number">{{index+1}}</span>测试点 {{test.id}}</strong><div><span class="verdict" :class="results[test.id]?.verdict?.toLowerCase()">{{results[test.id]?.verdict||(results[test.id]?.status==='cancelled'?'已停止':finished?'未运行':busy==='judge'?'等待中':'未运行')}}</span><span v-if="results[test.id]" class="elapsed">{{results[test.id].elapsedMs}} ms</span><button class="delete" :disabled="blocked" aria-label="删除测试点" @click="draft.problem.testCases.splice(index,1)">×</button></div></div>
       <div class="io-pair"><label>标准输入 <span>stdin</span><textarea v-model="test.input" :disabled="blocked" :aria-label="'标准输入 '+test.id" placeholder="允许空输入" spellcheck="false"></textarea></label><label>预期输出 <span>expected</span><textarea v-model="test.expectedOutput" :disabled="blocked" :aria-label="'预期输出 '+test.id" placeholder="填写完整标准输出" spellcheck="false"></textarea></label></div>
       <div class="actual-heading"><span>实际输出</span><button v-if="results[test.id]" @click="diffOpen[test.id]=!diffOpen[test.id]">{{diffOpen[test.id]?'查看原文':'查看 Diff'}}</button></div>
       <OutputDiff v-if="diffOpen[test.id]&&results[test.id]" :expected="test.expectedOutput" :actual="results[test.id].stdout"/>
       <pre v-else class="actual-output">{{results[test.id]?(results[test.id].stdout||'（空输出）'):'（尚无输出）'}}</pre><pre v-if="results[test.id]?.message" class="checker-message">{{results[test.id].message}}</pre>
      </article>
     </div>
    </Pane>
   </Splitpanes></Pane><Pane :size="config.layout.outputPercent" :min-size="12" :max-size="65">
   <section class="bottom-panel"><div class="bottom-heading"><div class="bottom-tabs"><button :class="{active:bottomTab==='output'}" @click="bottomTab='output'">输出</button><button :class="{active:bottomTab==='debug'}" @click="bottomTab='debug'">调试 <i v-if="debugRunning" class="live-dot"></i></button></div>
    <div v-show="bottomTab==='debug'" class="small-actions"><button :disabled="blocked||!activeTab" @click="action(debug)">▶ 编译并启动</button><button :disabled="!debugRunning" @click="terminal?.eof()">发送 EOF</button><button :disabled="!busy" @click="action(stop)">■ 停止程序</button><button @click="terminal?.clear()">清空显示</button></div>
    <div v-show="bottomTab==='output'" class="small-actions"><button @click="logs=''">清空显示</button></div></div>
    <pre v-show="bottomTab==='output'" class="output-log" data-testid="output">{{logs||'点击“编译并运行”。没有测试点时，编译成功后会自动进入调试页。'}}</pre>
    <div v-show="bottomTab==='debug'" class="terminal-wrapper"><DebugTerminal ref="terminal" :running="debugRunning" :scrollback="config.terminalBufferLines" :theme="config.theme"/></div>
   </section></Pane></Splitpanes>
   <footer class="statusbar"><div class="status-hint" role="status" :title="footerHint"><Transition name="status-slide" mode="out-in"><span :key="footerHint">{{footerHint}}</span></Transition></div><span class="cursor-position" aria-label="光标位置">行 {{cursor.line}} · 列 {{cursor.column}}<span v-if="cursor.selectionChars"> · 已选 {{cursor.selectionChars}}</span></span></footer>
  </template>
  <div v-if="settingsOpen&&settings" class="modal-backdrop" @mousedown.self="!settingsSaving&&(settingsOpen=false)">
   <section class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <div class="settings-title"><div><span class="eyebrow">PREFERENCES</span><h2 id="settings-title">设置</h2></div><button class="close-button" aria-label="关闭设置" :disabled="settingsSaving" @click="settingsOpen=false">×</button></div>
    <div v-if="settingsMessage" class="settings-message" role="alert">{{settingsMessage}}</div>
    <fieldset class="settings-scroll" :disabled="settingsSaving">
     <section><h3>个人信息</h3><p>填写学号后，导出的文件名会自动加上学号。留空也可以导出。</p><div class="field-grid"><label>班号<input v-model="settings.classId" aria-label="班号" placeholder="例如 9527"></label><label>姓名<input v-model="settings.name" aria-label="姓名" placeholder="例如 马冬梅"></label><label>学号<input v-model="settings.studentId" aria-label="学号" placeholder="例如 7355608"></label></div></section>
     <section><h3>编辑与保存</h3><div class="field-grid two"><label>保存方式<select v-model="settings.saveMode" aria-label="保存方式"><option value="manual">手动保存（默认）</option><option value="auto">自动保存</option></select></label><label>源码语言<select v-model="settings.language" aria-label="源码语言"><option value="c">C（.c）</option><option value="cpp">C++（.cpp）</option></select></label><label>Tab / 缩进空格数<select v-model.number="settings.indentSize" aria-label="Tab / 缩进空格数"><option :value="1">1 个空格</option><option :value="2">2 个空格</option><option :value="4">4 个空格（默认）</option></select></label><label>主题<select v-model="settings.theme" aria-label="主题"><option value="dark">暗色 · VS Code</option><option value="light">亮色 · VS Code</option></select></label></div><label class="checkbox-field"><input v-model="settings.formatOnSave" type="checkbox" aria-label="保存时自动格式化">保存时自动格式化（clang-format）</label><div class="field-grid two"><label>界面缩放<select v-model.number="settings.zoomFactor" aria-label="界面缩放"><option v-for="scale in [0.75,0.8,0.9,1,1.1,1.25,1.5,1.75,2]" :key="scale" :value="scale">{{Math.round(scale*100)}}%</option></select></label><label>快捷键<button aria-label="设置快捷键…" @click="action(()=>api.openShortcuts())">设置快捷键…</button></label></div><p>导入的源码保存在数据目录；保存更新当前副本。</p></section>
     <section><h3>数据位置</h3><PathField v-model="settingsRoot" label="数据保存位置" kind="directory" @valid="pathValidity.data=$event"/><p>请选择已存在的文件夹。更换位置时复制现有资料，原目录保留。</p></section>
     <section><div class="settings-section-heading"><h3>编译器</h3><button v-if="settings.compiler.mode==='custom'" :disabled="compilerScanning||!!busy" @click="action(detectInstalledCompilers)">{{compilerScanning?'正在检测…':'自动检测'}}</button></div><p>内置 Zig 启动时静默预热，自动使用可用核心；缓存超过 2 GB 时自动回收。</p><div class="field-grid"><label>使用方式<select v-model="settings.compiler.mode" aria-label="编译器使用方式"><option value="builtin">内置 Zig</option><option value="custom">自定义编译器</option></select></label><label v-if="settings.compiler.mode==='custom'">编译器类型<select v-model="settings.compiler.kind" aria-label="编译器类型"><option value="zig">Zig</option><option value="gcc">GCC</option><option value="clang">Clang</option></select></label></div><div v-if="settings.compiler.mode==='custom'" class="compiler-paths"><PathField v-model="settings.compiler.cPath" label="C 编译器路径" kind="executable" @valid="pathValidity.c=$event"/><PathField v-model="settings.compiler.cppPath" label="C++ 编译器路径" kind="executable" :allow-empty="settings.compiler.kind==='zig'||settings.language==='c'" @valid="pathValidity.cpp=$event"/></div><div class="cache-controls"><button :disabled="!!busy||clearingCache" @click="clearCache">{{clearingCache?'正在清理…':'清理编译缓存'}}</button><span role="status">{{cacheMessage}}</span></div></section>
     <section><h3>高级编译参数</h3><p>每行一个参数。源码和输出路径由程序追加。</p><div class="field-grid"><label>C 参数<textarea v-model="cArgs" rows="5" spellcheck="false"></textarea></label><label>C++ 参数<textarea v-model="cppArgs" rows="5" spellcheck="false"></textarea></label><label>链接参数<textarea v-model="linkArgs" rows="5" spellcheck="false"></textarea></label></div></section>
     <section><h3>交互调试</h3><div class="field-grid two"><label>调试时限（毫秒，留空则手动停止）<input :value="settings.debugTimeLimitMs??''" @input="settings.debugTimeLimitMs=($event.target as HTMLInputElement).value===''?null:Number(($event.target as HTMLInputElement).value)" type="number" min="1"></label><label>终端显示缓冲（行）<input v-model.number="settings.terminalBufferLines" type="number" min="100" max="100000"></label></div></section>
    </fieldset>
    <div class="settings-footer"><div><button :disabled="settingsSaving" @click="settingsOpen=false">取消</button><button class="primary" :disabled="!!busy||settingsSaving||!validSettingsPaths" @click="saveSettings">{{settingsSaving?'保存中…':'保存设置'}}</button></div></div>
   </section>
  </div>
  <div v-if="compilerChoiceOpen" class="modal-backdrop compiler-picker-backdrop"><section ref="compilerDialog" tabindex="-1" class="compiler-picker" role="dialog" aria-modal="true" aria-labelledby="compiler-picker-title" @keydown.esc.stop.prevent="compilerChoiceOpen=false"><h2 id="compiler-picker-title">自动检测编译器</h2><template v-if="detectedCompilers.length"><p>选择编译器后，自动填写类型、路径和默认参数；保存设置后生效。</p><div class="compiler-options"><label v-for="candidate in detectedCompilers" :key="candidate.id" class="compiler-option"><input v-model="selectedCompiler" type="radio" name="detected-compiler" :value="candidate.id" :aria-label="candidate.name+' '+candidate.compiler.cPath"><span><strong>{{candidate.name}}<small v-if="!candidate.compiler.cppPath"> · 仅 C</small></strong><span>{{candidate.version}}</span><code>{{candidate.compiler.cPath}}</code><small v-if="candidate.target">{{candidate.target}}</small></span></label></div></template><p v-else class="compiler-not-found">LabPad在常用路径未找到可支持的编译器</p><div class="compiler-picker-actions"><button @click="compilerChoiceOpen=false">{{detectedCompilers.length?'取消':'关闭'}}</button><button v-if="detectedCompilers.length" class="primary" :disabled="!selectedCompiler" @click="useDetectedCompiler">使用此编译器</button></div></section></div>
  <div v-if="newKind" class="modal-backdrop"><section class="create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-title"><h2 id="create-title">{{newKind==='lab'?'新建项目':'新建题号'}}</h2><label>{{newKind==='lab'?'项目名称':'题号'}}<input v-model="newName" :aria-label="newKind==='lab'?'项目名称':'新题号'" :placeholder="newKind==='lab'?'例如 实验2':'例如 Lab 2-1'" :disabled="newSaving" @keydown.enter="createItem" autofocus></label><p v-if="newMessage" class="field-error" role="alert">{{newMessage}}</p><div class="create-actions"><button :disabled="newSaving" @click="newKind=null">取消</button><button class="primary" :disabled="newSaving||!newName.trim()" @click="createItem">新建</button></div></section></div>
 </div>
</template>
