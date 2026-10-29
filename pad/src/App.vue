<script setup lang="ts">
import {computed,onMounted,onBeforeUnmount,ref,watch,nextTick} from 'vue';
import {Splitpanes,Pane,type SplitpanesResizedPayload} from 'splitpanes';
import 'splitpanes/dist/splitpanes.css';
import CodeEditor from './components/CodeEditor.vue';
import DebugTerminal from './components/DebugTerminal.vue';
import OutputDiff from './components/OutputDiff.vue';
import PathField from './components/PathField.vue';
import type {Config,Draft,CaseResult,Compilation,DebugState,Project,DetectedCompiler,EditorCursor,LayoutConfig} from '../shared/types';
const api=window.labpad,clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const draft=ref<Draft>(),config=ref<Config>(),settings=ref<Config>(),projects=ref<Project[]>([]);
const dataRoot=ref(''),settingsRoot=ref(''),version=ref(''),sourcePath=ref<string|null>(null),compilerLabel=ref('正在读取编译器…');
const busy=ref<'judge'|'debug'|null>(null),debugRunning=ref(false),bottomTab=ref<'output'|'debug'>('output');
const logs=ref(''),error=ref(''),notice=ref(''),saveStatus=ref('已保存'),dirty=ref(false),ready=ref(false);
const settingsOpen=ref(false),settingsSaving=ref(false),settingsMessage=ref(''),pathValidity=ref({data:true,c:true,cpp:true});
const results=ref<Record<string,CaseResult>>({}),diffOpen=ref<Record<string,boolean>>({}),finished=ref(false),phase=ref('准备就绪');
const terminal=ref<InstanceType<typeof DebugTerminal>>(),editor=ref<InstanceType<typeof CodeEditor>>();
const cursor=ref<EditorCursor>({line:1,column:1,selectionChars:0,selectionLines:0,lines:1,focused:false}),hintIndex=ref(0);
let hintTimer:ReturnType<typeof setInterval>|undefined,noticeTimer:ReturnType<typeof setTimeout>|undefined,layoutTail:Promise<unknown>=Promise.resolve();
const tips=computed(()=>[
 config.value?.saveMode==='auto'?'自动保存已开启，写完稍停即可保存。':'Ctrl+S 保存当前源码；打开的文件会写回原路径。',
 '空格小点只负责指路，导出的仍是普通空格。',
 '选中多行后按 Tab / Shift+Tab，整块调整缩进。',
 '没有测试点时，编译通过就会进入调试页。',
 'Shift+Alt+F 整理代码；Ctrl+Z 可整次撤销。',
 '测试输入、预期输出和比较规则随题目 JSON 保存。'
]);
const footerHint=computed(()=>formatting.value?'正在整理代码格式…':busy.value?phase.value:notice.value|| (cursor.value.selectionChars?'已选 '+cursor.value.selectionChars+' 个字符 · '+cursor.value.selectionLines+' 行；Tab / Shift+Tab 可整块缩进。':tips.value[hintIndex.value%tips.value.length]));
const documentEpoch=ref(0),formatting=ref(false);
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
function invalidate(){results.value={};diffOpen.value={};finished.value=false;phase.value='内容已修改，请重新运行';}
function recordState(){if(draft.value)api.documentState(snapshot(),dirty.value);}
function enqueueSave(value:Draft,id:number){
 saveStatus.value='保存中…';
 const task=saveTail.catch(()=>{}).then(()=>api.saveDraft(value)) .then(async result=>{
  if(id===revision||JSON.stringify({...value,source:result.source})===JSON.stringify(snapshot())){
   if(result.source!==draft.value!.source){pauseSave=true;editor.value?.applyText(result.source);draft.value!.source=result.source;pauseSave=false;revision++;}
   clearTimeout(saveTimer);dirty.value=false;sourcePath.value=result.path;saveStatus.value='已保存';recordState();
  }
  if(result.formatWarning)error.value=result.formatWarning;
  projects.value=await api.projects();return result.path;
 }).catch(e=>{saveStatus.value='保存失败';error.value=message(e);throw e;});
 saveTail=task;void task.catch(()=>{});return task;
}
watch(draft,()=>{
 if(pauseSave||!draft.value)return;
 revision++;dirty.value=true;saveStatus.value='未保存';recordState();invalidate();clearTimeout(saveTimer);
 if(config.value?.saveMode==='auto'){const value=snapshot(),id=revision;saveTimer=setTimeout(()=>void enqueueSave(value,id),250);}
},{deep:true,flush:'sync'});
function replaceDraft(value:Draft,file:string|null=null){
 clearTimeout(saveTimer);pauseSave=true;documentEpoch.value++;draft.value=value;sourcePath.value=file;dirty.value=false;revision++;
 if(config.value){config.value.currentLab=value.problem.labId;config.value.currentProblem=value.problem.problemId;config.value.language=value.language;config.value.sourceFile=null;}
 results.value={};diffOpen.value={};finished.value=false;saveStatus.value='已保存';phase.value='准备就绪';pauseSave=false;recordState();
}
async function saveNow(){clearTimeout(saveTimer);await saveTail.catch(()=>{});await enqueueSave(snapshot(),revision);}
async function beforeChange(){
 clearTimeout(saveTimer);await saveTail.catch(()=>{});
 if(!dirty.value)return true;
 if(config.value!.saveMode==='auto'){await saveNow();return true;}
 const choice=await api.confirmUnsaved();
 if(choice==='cancel')return false;if(choice==='save')await saveNow();return true;
}
async function selectLab(event:Event){
 const select=event.target as HTMLSelectElement,value=select.value;select.value=draft.value!.problem.labId;
 if(value==='@new:lab'){if(await beforeChange()){newKind.value='lab';newName.value='';newMessage.value='';}return;}
 if(!await beforeChange())return;
 const problem=projects.value.find(p=>p.labId===value)?.problems[0]??'';
 replaceDraft(await api.loadDraft(value,problem,draft.value!.language));
}
async function selectProblem(event:Event){
 const select=event.target as HTMLSelectElement,value=select.value;select.value=draft.value!.problem.problemId;
 if(value==='@new:problem'){if(await beforeChange()){newKind.value='problem';newName.value='';newMessage.value='';}return;}
 if(await beforeChange())replaceDraft(await api.loadDraft(draft.value!.problem.labId,value,draft.value!.language));
}
async function createItem(){
 if(newSaving.value)return;newSaving.value=true;newMessage.value='';
 try{
  const value=newKind.value==='lab'?await api.createLab(newName.value):await api.createProblem(draft.value!.problem.labId,newName.value,draft.value!.language);
  projects.value=await api.projects();replaceDraft(value);newKind.value=null;
 }catch(e){newMessage.value=message(e);}finally{newSaving.value=false;}
}
function applyBootstrap(state:Awaited<ReturnType<typeof api.bootstrap>>){
 const external=state.config.sourceFile;config.value=state.config;projects.value=state.projects;version.value=state.version;dataRoot.value=state.dataRoot;compilerLabel.value=state.compilerLabel;
 replaceDraft(state.draft,state.sourcePath);config.value.sourceFile=external;ready.value=true;if(state.warning)error.value=state.warning;
}
async function reload(){if(await beforeChange())applyBootstrap(await api.reloadDocument());}
async function openSource(){
 if(!await beforeChange())return;const value=await api.openSource();if(!value)return;
 const next=snapshot();next.source=value.source;next.language=value.language;replaceDraft(next,value.path);config.value!.sourceFile=value.path;
 notice.value='已打开 '+value.path+' · '+value.encoding;
}
async function importIO(){
 clearTimeout(saveTimer);await saveTail;
 const problem=await api.importIO(draft.value!.problem.labId,draft.value!.problem.problemId);if(!problem)return;
 const wasDirty=dirty.value;pauseSave=true;draft.value!.problem=problem;revision++;pauseSave=false;
 config.value!.currentLab=problem.labId;config.value!.currentProblem=problem.problemId;
 dirty.value=wasDirty;saveStatus.value=wasDirty?'未保存':'已保存';recordState();invalidate();projects.value=await api.projects();
 if(wasDirty&&config.value!.saveMode==='auto')await saveNow();
 notice.value='已导入 '+problem.testCases.length+' 个测试点';
}
async function formatCode(){
 if(formatting.value||busy.value)return;
 formatting.value=true;const id=revision,size=config.value!.indentSize,language=draft.value!.language;
 try{
  const formatted=await api.formatCode(draft.value!.source,language,size);
  if(id!==revision||size!==config.value!.indentSize||language!==draft.value!.language){notice.value='代码或缩进设置已改变，请重新格式化';return;}
  editor.value?.applyText(formatted);editor.value?.focus();
 }finally{formatting.value=false;}
}
async function exportSource(){const file=await api.exportSource(snapshot());if(file)notice.value='已导出：'+file;}
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
  const wasAuto=config.value!.saveMode==='auto';
  const languageChanged=settings.value!.language!==draft.value!.language;
  const reloadNeeded=settingsRoot.value!==dataRoot.value||languageChanged;
  if(reloadNeeded&&!await beforeChange())return;
  const result=await api.saveConfig(clone(settings.value!),settingsRoot.value);
  config.value=result.config;dataRoot.value=result.dataRoot;compilerLabel.value=result.compilerLabel;projects.value=result.projects;
  if(languageChanged){replaceDraft(await api.loadDraft(config.value.currentLab,config.value.currentProblem,config.value.language));}
  else if(reloadNeeded)applyBootstrap(await api.reloadDocument());
  else if(!wasAuto&&config.value.saveMode==='auto'&&dirty.value)await saveNow();
  settingsOpen.value=false;notice.value='设置已保存';
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
function saveShortcut(event:KeyboardEvent){if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();void action(saveNow);}}
onMounted(async()=>{
 if(!api){error.value='请在 LabPad 桌面窗口中打开此页面';return;}
 disposers.push(api.onJudge(event=>{if(event.type==='compilation'){showCompilation(event.compilation);if(busy.value==='judge'&&event.compilation.status==='success')phase.value='运行测试点…';}else results.value[event.result.id]=event.result;}),
 api.onDebugData(data=>terminal.value?.write(data)),api.onDebugState(handleDebugState));
 window.addEventListener('keydown',saveShortcut);hintTimer=setInterval(()=>hintIndex.value++,9000);
 await action(async()=>{
  applyBootstrap(await api.bootstrap());
 });
});
watch(notice,value=>{clearTimeout(noticeTimer);if(value)noticeTimer=setTimeout(()=>{notice.value='';},8000);});
onBeforeUnmount(()=>{clearInterval(hintTimer);clearTimeout(noticeTimer);clearTimeout(saveTimer);disposers.forEach(d=>d());window.removeEventListener('keydown',saveShortcut);});
</script>
<template>
 <div class="app-shell" :data-theme="config?.theme||'dark'">
  <header class="brandbar"><div class="brand"><span class="brand-mark">L<span>↗</span></span><strong>LabPad</strong><span class="dev-tag">DEV</span></div><span class="version">v{{version||'0.1.0-dev.4'}}</span></header>
  <div v-if="error" class="alert error" role="alert"><span>{{error}}</span><button @click="error=''">关闭</button></div>
  <div v-if="!ready" class="loading"><h2>正在准备工作区</h2><p>加载配置、源码与本地编译器。</p></div>
  <template v-if="ready&&draft&&config">
   <section class="toolbar">
    <div class="project-select"><label>实验项目<select aria-label="实验项目" :value="draft.problem.labId" :disabled="!!busy" @change="action(()=>selectLab($event))"><option value="">&lt;无&gt;</option><option v-for="p in projects" :key="p.labId" :value="p.labId">{{p.labId}}</option><option value="@new:lab">＋ 新建项目…</option></select></label><span class="path-divider">/</span><label>题号<select aria-label="题号" :value="draft.problem.problemId" :disabled="!!busy" @change="action(()=>selectProblem($event))"><option value="">&lt;无&gt;</option><option v-for="p in problems" :key="p" :value="p">{{p}}</option><option value="@new:problem" :disabled="!draft.problem.labId">＋ 新建题号…</option></select></label><div class="run-actions"><button class="primary" :disabled="!!busy" @click="action(run)">▶ {{draft.problem.testCases.length?'编译并运行测试点':'编译并运行'}}</button><button class="stop" :disabled="!busy" @click="action(stop)">■ 停止</button><span class="phase"><i :class="{pulse:!!busy}"></i>{{phase}}</span></div></div>
    <div class="toolbar-actions"><button :disabled="!!busy" @click="action(importIO)">导入标准 I/O</button><button :disabled="!!busy" @click="action(openSource)">打开源码</button><button @click="action(saveNow)">保存</button><button class="export" @click="action(exportSource)">导出源码 ↗</button><span class="toolbar-separator"></span><button class="settings-button" @click="openSettings">⚙ 设置</button></div>
   </section>
   <Splitpanes class="work-layout" horizontal :maximize-panes="false" @resized="resized('outputPercent',$event)"><Pane :size="100-config.layout.outputPercent" :min-size="35" :max-size="88"><Splitpanes class="workspace" :maximize-panes="false" @resized="resized('editorPercent',$event)">
    <Pane class="editor-pane" :size="config.layout.editorPercent" :min-size="20" :max-size="80"><div class="pane-heading"><div :title="sourcePath||'保存后写入当前数据目录'"><span class="file-icon">{{draft.language==='c'?'C':'C++'}}</span>{{filename}}{{dirty?' *':''}}</div><div class="editor-actions"><button class="format-button" :disabled="!!busy||formatting" title="格式化代码（Shift+Alt+F）" @click="action(formatCode)">{{formatting?'格式化中…':'格式化代码'}}</button><span class="save-status" :class="{failed:saveStatus==='保存失败'}">{{saveStatus}}</span></div></div><CodeEditor ref="editor" v-model="draft.source" :document-id="documentEpoch" :indent-size="config.indentSize" :theme="config.theme" :disabled="!!busy" @format="action(formatCode)" @cursor="cursor=$event"/><div class="editor-status"><span>单文件{{draft.language==='c'?' C':' C++'}} · 空格：{{config.indentSize}}</span><span>{{config.saveMode==='auto'?'自动保存':'手动保存 · Ctrl+S'}}</span></div></Pane>
    <Pane class="cases-pane" :size="100-config.layout.editorPercent" :min-size="20" :max-size="80"><div class="pane-heading"><div>测试点 <span class="counter">{{draft.problem.testCases.length}}</span><span v-if="finished" class="passed-count">{{passed}} / {{draft.problem.testCases.length}} 通过</span></div><div class="small-actions"><button :disabled="!!busy" title="比较规则与时限保存在此 JSON 中" @click="action(()=>api.showProblemFile(snapshot()))">题目文件</button><button :disabled="!!busy" title="重新读取已保存的源码与题目规则" @click="action(reload)">重新加载</button><button :disabled="!!busy" @click="addCase">＋ 新增</button></div></div>
     <div class="cases-list"><div v-if="!draft.problem.testCases.length" class="empty-state"><h3>直接运行，或添加测试点</h3><p>没有测试点时，编译成功后进入下方调试页。<br>需要比较输出时，导入标准 I/O 或新增测试点。</p><button @click="addCase">＋ 新增测试点</button></div>
      <article v-for="(test,index) in draft.problem.testCases" :key="test.id" class="case-card">
       <div class="case-heading"><strong><span class="case-number">{{index+1}}</span>测试点 {{test.id}}</strong><div><span class="verdict" :class="results[test.id]?.verdict?.toLowerCase()">{{results[test.id]?.verdict||(results[test.id]?.status==='cancelled'?'已停止':finished?'未运行':busy==='judge'?'等待中':'未运行')}}</span><span v-if="results[test.id]" class="elapsed">{{results[test.id].elapsedMs}} ms</span><button class="delete" :disabled="!!busy" aria-label="删除测试点" @click="draft.problem.testCases.splice(index,1)">×</button></div></div>
       <div class="io-pair"><label>标准输入 <span>stdin</span><textarea v-model="test.input" :disabled="!!busy" :aria-label="'标准输入 '+test.id" placeholder="允许空输入" spellcheck="false"></textarea></label><label>预期输出 <span>expected</span><textarea v-model="test.expectedOutput" :disabled="!!busy" :aria-label="'预期输出 '+test.id" placeholder="填写完整标准输出" spellcheck="false"></textarea></label></div>
       <div class="actual-heading"><span>实际输出</span><button v-if="results[test.id]" @click="diffOpen[test.id]=!diffOpen[test.id]">{{diffOpen[test.id]?'查看原文':'查看 Diff'}}</button></div>
       <OutputDiff v-if="diffOpen[test.id]&&results[test.id]" :expected="test.expectedOutput" :actual="results[test.id].stdout"/>
       <pre v-else class="actual-output">{{results[test.id]?(results[test.id].stdout||'（空输出）'):'（尚无输出）'}}</pre><pre v-if="results[test.id]?.message" class="checker-message">{{results[test.id].message}}</pre>
      </article>
     </div>
    </Pane>
   </Splitpanes></Pane><Pane :size="config.layout.outputPercent" :min-size="12" :max-size="65">
   <section class="bottom-panel"><div class="bottom-heading"><div class="bottom-tabs"><button :class="{active:bottomTab==='output'}" @click="bottomTab='output'">输出</button><button :class="{active:bottomTab==='debug'}" @click="bottomTab='debug'">调试 <i v-if="debugRunning" class="live-dot"></i></button></div>
    <div v-show="bottomTab==='debug'" class="small-actions"><button :disabled="!!busy" @click="action(debug)">▶ 编译并启动</button><button :disabled="!debugRunning" @click="terminal?.eof()">发送 EOF</button><button :disabled="!busy" @click="action(stop)">■ 停止程序</button><button @click="terminal?.clear()">清空显示</button></div>
    <div v-show="bottomTab==='output'" class="small-actions"><button @click="logs=''">清空显示</button></div></div>
    <pre v-show="bottomTab==='output'" class="output-log" data-testid="output">{{logs||'点击“编译并运行”。没有测试点时，编译成功后会自动进入调试页。'}}</pre>
    <div v-show="bottomTab==='debug'" class="terminal-wrapper"><DebugTerminal ref="terminal" :running="debugRunning" :scrollback="config.terminalBufferLines" :theme="config.theme"/></div>
   </section></Pane></Splitpanes>
   <footer class="statusbar"><div class="status-location"><span class="local-dot"></span><button class="status-folder" :title="dataRoot" @click="action(()=>api.revealPath(dataRoot,'directory'))">数据目录<span class="footer-path">{{dataRoot}}</span></button></div><span class="compiler-label" :title="compilerLabel">{{compilerLabel}}</span><div class="status-hint" role="status" :title="footerHint"><Transition name="status-slide" mode="out-in"><span :key="footerHint">{{footerHint}}</span></Transition></div><span class="cursor-position" aria-label="光标位置">行 {{cursor.line}} · 列 {{cursor.column}}<span v-if="cursor.selectionChars"> · 已选 {{cursor.selectionChars}}</span></span><span class="status-save">{{saveStatus}}</span></footer>
  </template>
  <div v-if="settingsOpen&&settings" class="modal-backdrop" @mousedown.self="!settingsSaving&&(settingsOpen=false)">
   <section class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <div class="settings-title"><div><span class="eyebrow">PREFERENCES</span><h2 id="settings-title">设置</h2></div><button class="close-button" aria-label="关闭设置" :disabled="settingsSaving" @click="settingsOpen=false">×</button></div>
    <div v-if="settingsMessage" class="settings-message" role="alert">{{settingsMessage}}</div>
    <fieldset class="settings-scroll" :disabled="settingsSaving">
     <section><h3>个人信息</h3><p>填写学号后，导出的文件名会自动加上学号。留空也可以导出。</p><div class="field-grid"><label>班号<input v-model="settings.classId" aria-label="班号"></label><label>姓名<input v-model="settings.name" aria-label="姓名"></label><label>学号<input v-model="settings.studentId" aria-label="学号" placeholder="例如 12345678"></label></div></section>
     <section><h3>编辑与保存</h3><div class="field-grid two"><label>保存方式<select v-model="settings.saveMode" aria-label="保存方式"><option value="manual">手动保存（默认）</option><option value="auto">自动保存</option></select></label><label>源码语言<select v-model="settings.language" aria-label="源码语言"><option value="c">C（.c）</option><option value="cpp">C++（.cpp）</option></select></label><label>Tab / 缩进空格数<select v-model.number="settings.indentSize" aria-label="Tab / 缩进空格数"><option :value="1">1 个空格</option><option :value="2">2 个空格</option><option :value="4">4 个空格（默认）</option></select></label><label>主题<select v-model="settings.theme" aria-label="主题"><option value="dark">暗色 · VS Code</option><option value="light">亮色 · VS Code</option></select></label></div><label class="checkbox-field"><input v-model="settings.formatOnSave" type="checkbox" aria-label="保存时自动格式化">保存时自动格式化（clang-format）</label><p>打开已有源码后，保存会直接写回原文件。新代码保存在当前数据目录中。</p></section>
     <section><h3>数据位置</h3><PathField v-model="settingsRoot" label="数据保存位置" kind="directory" @valid="pathValidity.data=$event"/><p>请选择已存在的文件夹。更换位置时复制现有资料，原目录保留。</p></section>
     <section><div class="settings-section-heading"><h3>编译器</h3><button v-if="settings.compiler.mode==='custom'" :disabled="compilerScanning||!!busy" @click="action(detectInstalledCompilers)">{{compilerScanning?'正在检测…':'自动检测'}}</button></div><p>内置 Zig 自动使用可用核心；编译缓存会保留，以加快后续运行。</p><div class="field-grid"><label>使用方式<select v-model="settings.compiler.mode" aria-label="编译器使用方式"><option value="builtin">内置 Zig</option><option value="custom">自定义编译器</option></select></label><label v-if="settings.compiler.mode==='custom'">编译器类型<select v-model="settings.compiler.kind" aria-label="编译器类型"><option value="zig">Zig</option><option value="gcc">GCC</option><option value="clang">Clang</option></select></label></div><div v-if="settings.compiler.mode==='custom'" class="compiler-paths"><PathField v-model="settings.compiler.cPath" label="C 编译器路径" kind="executable" @valid="pathValidity.c=$event"/><PathField v-model="settings.compiler.cppPath" label="C++ 编译器路径" kind="executable" :allow-empty="settings.compiler.kind==='zig'||settings.language==='c'" @valid="pathValidity.cpp=$event"/></div></section>
     <section><h3>高级编译参数</h3><p>每行一个参数。源码和输出路径由程序追加。</p><div class="field-grid"><label>C 参数<textarea v-model="cArgs" rows="5" spellcheck="false"></textarea></label><label>C++ 参数<textarea v-model="cppArgs" rows="5" spellcheck="false"></textarea></label><label>链接参数<textarea v-model="linkArgs" rows="5" spellcheck="false"></textarea></label></div></section>
     <section><h3>交互调试</h3><div class="field-grid two"><label>调试时限（毫秒，留空则手动停止）<input :value="settings.debugTimeLimitMs??''" @input="settings.debugTimeLimitMs=($event.target as HTMLInputElement).value===''?null:Number(($event.target as HTMLInputElement).value)" type="number" min="1"></label><label>终端显示缓冲（行）<input v-model.number="settings.terminalBufferLines" type="number" min="100" max="100000"></label></div></section>
    </fieldset>
    <div class="settings-footer"><span>本地保存 · 无需账号</span><div><button :disabled="settingsSaving" @click="settingsOpen=false">取消</button><button class="primary" :disabled="!!busy||settingsSaving||!validSettingsPaths" @click="saveSettings">{{settingsSaving?'保存中…':'保存设置'}}</button></div></div>
   </section>
  </div>
  <div v-if="compilerChoiceOpen" class="modal-backdrop compiler-picker-backdrop"><section ref="compilerDialog" tabindex="-1" class="compiler-picker" role="dialog" aria-modal="true" aria-labelledby="compiler-picker-title" @keydown.esc.stop.prevent="compilerChoiceOpen=false"><h2 id="compiler-picker-title">自动检测编译器</h2><template v-if="detectedCompilers.length"><p>选择编译器后，自动填写类型、路径和默认参数；保存设置后生效。</p><div class="compiler-options"><label v-for="candidate in detectedCompilers" :key="candidate.id" class="compiler-option"><input v-model="selectedCompiler" type="radio" name="detected-compiler" :value="candidate.id" :aria-label="candidate.name+' '+candidate.compiler.cPath"><span><strong>{{candidate.name}}<small v-if="!candidate.compiler.cppPath"> · 仅 C</small></strong><span>{{candidate.version}}</span><code>{{candidate.compiler.cPath}}</code><small v-if="candidate.target">{{candidate.target}}</small></span></label></div></template><p v-else class="compiler-not-found">LabPad在常用路径未找到可支持的编译器</p><div class="compiler-picker-actions"><button @click="compilerChoiceOpen=false">{{detectedCompilers.length?'取消':'关闭'}}</button><button v-if="detectedCompilers.length" class="primary" :disabled="!selectedCompiler" @click="useDetectedCompiler">使用此编译器</button></div></section></div>
  <div v-if="newKind" class="modal-backdrop"><section class="create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-title"><h2 id="create-title">{{newKind==='lab'?'新建项目':'新建题号'}}</h2><label>{{newKind==='lab'?'项目名称':'题号'}}<input v-model="newName" :aria-label="newKind==='lab'?'项目名称':'新题号'" :placeholder="newKind==='lab'?'例如 Lab 2':'例如 Lab 2-1'" :disabled="newSaving" @keydown.enter="createItem" autofocus></label><p v-if="newMessage" class="field-error" role="alert">{{newMessage}}</p><div class="create-actions"><button :disabled="newSaving" @click="newKind=null">取消</button><button class="primary" :disabled="newSaving||!newName.trim()" @click="createItem">新建</button></div></section></div>
 </div>
</template>
