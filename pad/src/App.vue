<script setup lang="ts">
import {computed,onMounted,onBeforeUnmount,ref,watch,nextTick} from 'vue';
import CodeEditor from './components/CodeEditor.vue';
import DebugTerminal from './components/DebugTerminal.vue';
import OutputDiff from './components/OutputDiff.vue';
import type {Config,Draft,CaseResult,Compilation,DebugState} from '../shared/types';
const api=window.labpad;
const draft=ref<Draft>(),config=ref<Config>(),settings=ref<Config>();
const dataRoot=ref(''),version=ref(''),compilerLabel=ref('正在读取编译器…');
const labInput=ref(''),problemInput=ref('');
const busy=ref<'judge'|'debug'|null>(null),debugRunning=ref(false);
const bottomTab=ref<'output'|'debug'>('output'),logs=ref(''),error=ref(''),notice=ref('');
const saveStatus=ref('已保存'),settingsOpen=ref(false),ready=ref(false);
const results=ref<Record<string,CaseResult>>({}),diffOpen=ref<Record<string,boolean>>({});
const finished=ref(false),phase=ref('准备就绪');
const terminal=ref<InstanceType<typeof DebugTerminal>>();
const settingsMessage=ref(''),settingsSaving=ref(false);
let pauseSave=true,saveTail:Promise<void>=Promise.resolve(),revision=0;
const disposers:(()=>void)[]=[];
const clone=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
const snapshot=()=>clone(draft.value!);
const passed=computed(()=>Object.values(results.value).filter(c=>c.verdict==='AC').length);
const cArgs=computed({get:()=>settings.value?.compiler.cArgs.join('\n')??'',
 set:v=>{if(settings.value)settings.value.compiler.cArgs=v.split(/\r?\n/).filter(Boolean);}});
const cppArgs=computed({get:()=>settings.value?.compiler.cppArgs.join('\n')??'',
 set:v=>{if(settings.value)settings.value.compiler.cppArgs=v.split(/\r?\n/).filter(Boolean);}});
const linkArgs=computed({get:()=>settings.value?.compiler.linkArgs.join('\n')??'',
 set:v=>{if(settings.value)settings.value.compiler.linkArgs=v.split(/\r?\n/).filter(Boolean);}});
function message(e:unknown){return e instanceof Error?e.message:String(e);}
async function action(fn:()=>Promise<unknown>){error.value='';notice.value='';try{await fn();}catch(e){error.value=message(e);}}
function queueSave(){
 if(pauseSave||!draft.value)return;
 const value=snapshot(),id=++revision;saveStatus.value='保存中…';
 if(finished.value){finished.value=false;results.value={};phase.value='内容已修改，请重新运行';}
 saveTail=saveTail.catch(()=>{}).then(()=>api.saveDraft(value)).then(()=>{
  if(id===revision)saveStatus.value='已保存';
 }).catch(e=>{saveStatus.value='保存失败';error.value=message(e);throw e;});
 void saveTail.catch(()=>{});
}
watch(draft,queueSave,{deep:true,flush:'sync'});
function replaceDraft(value:Draft){
 pauseSave=true;draft.value=value;labInput.value=value.problem.labId;problemInput.value=value.problem.problemId;
 if(config.value){config.value.currentLab=value.problem.labId;config.value.currentProblem=value.problem.problemId;config.value.language=value.language;}
 results.value={};diffOpen.value={};finished.value=false;pauseSave=false;saveStatus.value='已保存';
}
async function switchProblem(){
 await saveTail;
 const value=await api.loadDraft(labInput.value,problemInput.value,draft.value!.language);
 replaceDraft(value);phase.value='准备就绪';
}
async function saveNow(){await saveTail;await api.saveDraft(snapshot());saveStatus.value='已保存';}
async function openSource(){
 const value=await api.openSource();if(!value)return;
 draft.value!.source=value.source;draft.value!.language=value.language;
 notice.value='已作为草稿打开 · '+value.encoding;results.value={};finished.value=false;
}
async function importIO(){
 await saveTail;
 const problem=await api.importIO(draft.value!.problem.labId,draft.value!.problem.problemId);if(!problem)return;
 if(problem.labId!==draft.value!.problem.labId||problem.problemId!==draft.value!.problem.problemId)
  replaceDraft(await api.loadDraft(problem.labId,problem.problemId,draft.value!.language));
 draft.value!.problem=problem;await saveNow();notice.value='已导入 '+problem.testCases.length+' 个测试点';
}
async function exportSource(){
 await saveNow();
 if(!config.value!.studentId.trim()){openSettings();settingsMessage.value='请先填写学号，再导出源码。';return;}
 const file=await api.exportSource(snapshot());if(file)notice.value='已导出：'+file;
}
function showCompilation(c:Compilation){
 logs.value='编译命令\n'+c.command.map(s=>/\s/.test(s)?JSON.stringify(s):s).join(' ')+'\n\n'
  +(c.stdout?'stdout\n'+c.stdout+'\n':'')+(c.stderr?'stderr\n'+c.stderr+'\n':'')
  +'\n编译状态：'+c.status+' · '+c.elapsedMs+' ms\n';
}
async function run(){
 busy.value='judge';results.value={};finished.value=false;phase.value='编译中…';logs.value='';bottomTab.value='output';
 try{
  await saveNow();
  const result=await api.judge(snapshot());
  if(result.compilation)showCompilation(result.compilation);
  if(result.status==='error'){error.value=result.error||'评测任务失败';phase.value='任务错误';}
  else if(result.status==='cancelled')phase.value='已停止';
  else if(result.compilation?.status==='CE')phase.value='编译失败 · CE';
  else phase.value='测试完成';
  for(const c of result.cases)results.value[c.id]=c;
  logs.value+='\n'+result.cases.map(c=>'测试点 '+c.id+' · '+(c.verdict||c.status)+' · '+c.elapsedMs+' ms'
   +(c.exitCode!==null?' · 退出码 '+c.exitCode:'')+(c.signal?' · '+c.signal:'')
   +(c.message?'\n'+c.message:'')+(c.stderr?'\nstderr\n'+c.stderr:'')).join('\n\n');
 }finally{busy.value=null;finished.value=true;}
}
async function debug(){
 busy.value='debug';debugRunning.value=false;bottomTab.value='debug';phase.value='编译中…';
 try{await saveNow();await api.debugStart(snapshot());}catch(e){busy.value=null;throw e;}
}
async function stop(){phase.value='正在停止…';await api.cancel();}
function addCase(){
 const tests=draft.value!.problem.testCases;let id=1;while(tests.some(t=>t.id===String(id)))id++;
 tests.push({id:String(id),input:'',expectedOutput:''});
}
function openSettings(){settings.value=clone(config.value!);settingsMessage.value='';settingsOpen.value=true;}
async function saveSettings(){
 if(settingsSaving.value)return;settingsSaving.value=true;
 settingsMessage.value='';
 try{
  await saveTail;
  const next=await api.saveConfig(clone(settings.value!));config.value=next;
  compilerLabel.value=await api.compilerInfo(next.compiler).catch(e=>'编译器不可用：'+message(e));
  if(next.currentLab!==draft.value!.problem.labId||next.currentProblem!==draft.value!.problem.problemId||next.language!==draft.value!.language){
   labInput.value=next.currentLab;problemInput.value=next.currentProblem;
   await saveTail;replaceDraft(await api.loadDraft(next.currentLab,next.currentProblem,next.language));
  }
  settingsOpen.value=false;notice.value='设置已保存';
 }catch(e){settingsMessage.value=message(e);}finally{settingsSaving.value=false;}
}
function handleDebugState(s:DebugState){
 if(s.status==='compiling'){busy.value='debug';phase.value='编译中…';}
 if(s.status==='running'){busy.value='debug';debugRunning.value=true;phase.value='调试运行中';bottomTab.value='debug';}
 if(['exited','stopped','error'].includes(s.status)){
  busy.value=null;debugRunning.value=false;phase.value=s.status==='stopped'?'已停止':s.status==='error'?'调试失败':'调试结束';
  if(s.message)terminal.value?.write('\r\n['+s.message+']\r\n');
  if(s.status==='error'){error.value=s.message||'调试启动失败';bottomTab.value='output';}
 }
}
onMounted(async()=>{
 if(!api){error.value='请在 LabPad 桌面窗口中打开此页面';return;}
 disposers.push(api.onJudge(event=>{
  if(event.type==='compilation'){showCompilation(event.compilation);if(busy.value==='judge'&&event.compilation.status==='success')phase.value='运行测试点…';}
  else results.value[event.result.id]=event.result;
 }),api.onDebugData(data=>terminal.value?.write(data)),api.onDebugState(handleDebugState));
 await action(async()=>{
  const state=await api.bootstrap();config.value=state.config;version.value=state.version;
  dataRoot.value=state.dataRoot;compilerLabel.value=state.compilerLabel;replaceDraft(state.draft);ready.value=true;
  if(!config.value.studentId){await nextTick();openSettings();}
 });
});
onBeforeUnmount(()=>disposers.forEach(dispose=>dispose()));
</script>
<template>
 <div class="app-shell">
  <header class="brandbar"><div class="brand"><span class="brand-mark">L<span>↗</span></span><strong>LabPad</strong><span class="dev-tag">DEV</span><span class="brand-subtitle">程序设计实验 · 本地自测</span></div><span class="version">v{{version||'0.1.0-dev.1'}}</span></header>
  <div v-if="error" class="alert error" role="alert"><span>{{error}}</span><button @click="error=''">关闭</button></div>
  <div v-if="notice" class="alert success" role="status"><span>{{notice}}</span><button @click="notice=''">关闭</button></div>
  <div v-if="!ready" class="loading"><h2>正在准备工作区</h2><p>加载配置、草稿与本地编译器。</p></div>
  <template v-if="ready&&draft&&config">
   <section class="toolbar">
    <div class="project-select"><label>实验项目<input aria-label="实验项目" v-model="labInput" :disabled="!!busy" @keydown.enter="action(switchProblem)" @change="action(switchProblem)"></label><span class="path-divider">/</span><label>题号<input aria-label="题号" v-model="problemInput" :disabled="!!busy" @keydown.enter="action(switchProblem)" @change="action(switchProblem)"></label></div>
    <div class="toolbar-actions"><button :disabled="!!busy" @click="action(importIO)">导入标准 I/O</button><button :disabled="!!busy" @click="action(openSource)">打开源码</button><button @click="action(saveNow)">保存草稿</button><button class="export" @click="action(exportSource)">导出源码 ↗</button><span class="toolbar-separator"></span><button class="settings-button" @click="openSettings">⚙ 设置</button></div>
   </section>
   <section class="runbar"><div><button class="primary" :disabled="!!busy" @click="action(run)">▶ 编译并运行测试点</button><button class="stop" :disabled="!busy" @click="action(stop)">■ 停止</button><span class="phase"><i :class="{pulse:!!busy}"></i>{{phase}}</span></div><span class="compiler-label" :title="compilerLabel">{{compilerLabel}}</span></section>
   <main class="workspace">
    <section class="editor-pane"><div class="pane-heading"><div><span class="file-icon">{{draft.language==='c'?'C':'C++'}}</span>{{draft.problem.problemId}}{{draft.language==='c'?'.c':'.cpp'}}</div><span class="save-status" :class="{failed:saveStatus==='保存失败'}">{{saveStatus}}</span></div><CodeEditor v-model="draft.source" :disabled="!!busy"/><div class="editor-status"><span>UTF-8 · 单文件{{draft.language==='c'?' C':' C++'}}</span><span>草稿自动保存</span></div></section>
    <section class="cases-pane"><div class="pane-heading"><div>测试点 <span class="counter">{{draft.problem.testCases.length}}</span><span v-if="finished" class="passed-count">{{passed}} / {{draft.problem.testCases.length}} 通过</span></div><div class="small-actions"><button :disabled="!!busy" title="比较规则与时限保存在此 JSON 中；修改后点重新加载" @click="action(()=>api.showProblemFile(snapshot()))">题目文件</button><button :disabled="!!busy" title="重新读取已保存的源码与题目规则" @click="action(switchProblem)">重新加载</button><button :disabled="!!busy" @click="addCase">＋ 新增</button></div></div>
     <div class="cases-list">
      <div v-if="!draft.problem.testCases.length" class="empty-state"><h3>从一个测试点开始</h3><p>导入标准 I/O，或新增输入与预期输出。</p><button @click="addCase">＋ 新增测试点</button></div>
      <article v-for="(test,index) in draft.problem.testCases" :key="test.id" class="case-card">
       <div class="case-heading"><strong><span class="case-number">{{index+1}}</span>测试点 {{test.id}}</strong><div><span class="verdict" :class="results[test.id]?.verdict?.toLowerCase()">{{results[test.id]?.verdict||(results[test.id]?.status==='cancelled'?'已停止':finished?'未运行':busy==='judge'?'等待中':'未运行')}}</span><span v-if="results[test.id]" class="elapsed">{{results[test.id].elapsedMs}} ms</span><button class="delete" :disabled="!!busy" aria-label="删除测试点" @click="draft.problem.testCases.splice(index,1)">×</button></div></div>
       <div class="io-pair"><label>标准输入 <span>stdin</span><textarea v-model="test.input" :disabled="!!busy" :aria-label="'标准输入 '+test.id" placeholder="允许空输入" spellcheck="false"></textarea></label><label>预期输出 <span>expected</span><textarea v-model="test.expectedOutput" :disabled="!!busy" :aria-label="'预期输出 '+test.id" placeholder="填写完整标准输出" spellcheck="false"></textarea></label></div>
       <div class="actual-heading"><span>实际输出</span><button v-if="results[test.id]" @click="diffOpen[test.id]=!diffOpen[test.id]">{{diffOpen[test.id]?'查看原文':'查看 Diff'}}</button></div>
       <OutputDiff v-if="diffOpen[test.id]&&results[test.id]" :expected="test.expectedOutput" :actual="results[test.id].stdout"/>
       <pre v-else class="actual-output">{{results[test.id]?(results[test.id].stdout||'（空输出）'):'（尚无输出）'}}</pre>
       <pre v-if="results[test.id]?.message" class="checker-message">{{results[test.id].message}}</pre>
      </article>
     </div>
    </section>
   </main>
   <section class="bottom-panel">
    <div class="bottom-heading"><div class="bottom-tabs"><button :class="{active:bottomTab==='output'}" @click="bottomTab='output'">输出</button><button :class="{active:bottomTab==='debug'}" @click="bottomTab='debug'">调试 <i v-if="debugRunning" class="live-dot"></i></button></div>
     <div v-show="bottomTab==='debug'" class="small-actions"><button :disabled="!!busy" @click="action(debug)">▶ 编译并启动</button><button :disabled="!debugRunning" @click="terminal?.eof()">发送 EOF</button><button :disabled="!busy" @click="action(stop)">■ 停止程序</button><button @click="terminal?.clear()">清空显示</button></div>
     <div v-show="bottomTab==='output'" class="small-actions"><span class="muted">原始编译与运行信息</span><button @click="logs=''">清空显示</button></div>
    </div>
    <pre v-show="bottomTab==='output'" class="output-log" data-testid="output">{{logs||'编译并运行后，原始诊断会显示在这里。\n需要手动输入？切换到“调试”，点击“编译并启动”。'}}</pre>
    <div v-show="bottomTab==='debug'" class="terminal-wrapper"><DebugTerminal ref="terminal" :running="debugRunning" :scrollback="config.terminalBufferLines"/></div>
   </section>
   <footer><span class="local-dot"></span>离线工作区<span class="footer-path" :title="dataRoot">{{dataRoot}}</span><span class="footer-right">规则随题目 JSON 保存 · {{saveStatus}}</span></footer>
  </template>
  <div v-if="settingsOpen&&settings" class="modal-backdrop" @mousedown.self="!settingsSaving&&(settingsOpen=false)">
   <section class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <div class="settings-title"><div><span class="eyebrow">PREFERENCES</span><h2 id="settings-title">设置</h2></div><button class="close-button" aria-label="关闭设置" :disabled="settingsSaving" @click="settingsOpen=false">×</button></div>
    <div v-if="settingsMessage" class="settings-message" role="alert">{{settingsMessage}}</div>
    <div class="settings-scroll">
     <section><h3>个人信息</h3><p>仅在这里保存。导出源码时使用学号自动命名。</p><div class="field-grid"><label>班号<input v-model="settings.classId" aria-label="班号" placeholder="例如 240101"></label><label>姓名<input v-model="settings.name" aria-label="姓名"></label><label>学号<input v-model="settings.studentId" aria-label="学号" placeholder="例如 12345678"></label></div></section>
     <section><h3>实验项目</h3><div class="field-grid"><label>实验名称<input v-model="settings.currentLab" aria-label="设置实验名称" placeholder="Lab 2"></label><label>题号<input v-model="settings.currentProblem" aria-label="设置题号" placeholder="Lab 2-1"></label><label>源码语言<select v-model="settings.language"><option value="c">C（.c）</option><option value="cpp">C++（.cpp）</option></select></label></div></section>
     <section><h3>编译器</h3><p>内置工具链可以直接使用；指定本机工具链时，路径应指向其可执行文件。</p><div class="field-grid"><label>使用方式<select v-model="settings.compiler.mode"><option value="builtin">内置 Zig</option><option value="custom">自定义编译器</option></select></label><label v-if="settings.compiler.mode==='custom'">工具链类型<select v-model="settings.compiler.kind"><option value="zig">Zig</option><option value="gcc">GCC</option><option value="clang">Clang</option></select></label></div><div v-if="settings.compiler.mode==='custom'" class="field-grid two"><label>C 驱动路径<input v-model="settings.compiler.cPath" placeholder="gcc / clang / zig 的完整路径"></label><label>C++ 驱动路径<input v-model="settings.compiler.cppPath" placeholder="g++ / clang++；Zig 可留空"></label></div></section>
     <section><h3>高级编译参数</h3><p>每行一个参数。源码路径和输出路径由程序追加；参数直接传给编译器，不经过 Shell。</p><div class="field-grid"><label>C 参数<textarea v-model="cArgs" rows="5" spellcheck="false"></textarea></label><label>C++ 参数<textarea v-model="cppArgs" rows="5" spellcheck="false"></textarea></label><label>链接参数<textarea v-model="linkArgs" rows="5" spellcheck="false"></textarea></label></div><div class="command-preview"><span>命令预览（C）</span><code>{{settings.compiler.mode==='builtin'?'内置 zig cc':settings.compiler.cPath+(settings.compiler.kind==='zig'?' cc':'')}} {{settings.compiler.cArgs.join(' ')}} &lt;当前源码&gt; {{settings.compiler.linkArgs.join(' ')}} -o &lt;临时程序&gt;</code></div></section>
     <section><h3>交互调试</h3><div class="field-grid two"><label>调试时限（毫秒，留空则手动停止）<input :value="settings.debugTimeLimitMs??''" @input="settings.debugTimeLimitMs=($event.target as HTMLInputElement).value===''?null:Number(($event.target as HTMLInputElement).value)" type="number" min="1"></label><label>终端显示缓冲（行）<input v-model.number="settings.terminalBufferLines" type="number" min="100" max="100000"></label></div></section>
     <section class="data-location"><h3>数据位置</h3><code>{{dataRoot}}</code><p>配置、源码草稿与导入的标准 I/O 自动保存在这里。比较方式和误差阈值写在每题 JSON 中。</p></section>
    </div>
    <div class="settings-footer"><span>本地保存 · 无需账号</span><div><button :disabled="settingsSaving" @click="settingsOpen=false">取消</button><button class="primary" :disabled="!!busy||settingsSaving" @click="saveSettings">{{settingsSaving?'保存中…':'保存设置'}}</button></div></div>
   </section>
  </div>
 </div>
</template>
