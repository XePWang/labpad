<script setup lang="ts">
import {ref,onMounted,onBeforeUnmount} from 'vue';
import {formatShortcut,parseShortcutLabel} from '../shared/shortcut-display';
import {shortcutActions,defaultShortcuts,validateShortcuts} from '../shared/shortcuts';
const ready=ref(false),platform=ref(navigator.platform),fields=ref<Record<string,string>>({});
function syncFields(){fields.value=Object.fromEntries(shortcutActions.map(([id])=>[id,(shortcuts.value[id]??[]).map(key=>formatShortcut(key,platform.value)).join('; ')]));}
function defaults(){shortcuts.value=defaultShortcuts(platform.value);syncFields();error.value='';notice.value='';}
const shortcuts=ref<Record<string,string[]>>(defaultShortcuts()),theme=ref('dark'),error=ref(''),notice=ref(''),recording=ref(''),strokes=ref<string[]>([]);
let timer:ReturnType<typeof setTimeout>|undefined;
onMounted(async()=>{const state=await window.labpad.shortcutSettings();shortcuts.value=state.shortcuts;platform.value=state.platform;theme.value=state.theme;syncFields();ready.value=true;});
function record(id:string){clearTimeout(timer);recording.value=id;strokes.value=[];notice.value='按下快捷键，可连续输入两段组合键；Esc 取消。';}
function keydown(event:KeyboardEvent){
 if(!recording.value)return;event.preventDefault();event.stopPropagation();if(event.key==='Escape'){clearTimeout(timer);strokes.value=[];recording.value='';notice.value='';return;}
 if(event.repeat||['Control','Shift','Alt','Meta'].includes(event.key))return;
 const key=[...(event.ctrlKey?['Control']:[]),...(event.metaKey?['Meta']:[]),...(event.altKey?['Alt']:[]),...(event.shiftKey?['Shift']:[]),event.code].join('+');strokes.value.push(key);
 clearTimeout(timer);const finish=()=>{shortcuts.value[recording.value]=[strokes.value.join(' ')];fields.value[recording.value]=text(recording.value);recording.value='';notice.value='';};
 if(strokes.value.length===2)finish();else timer=setTimeout(finish,1100);
}
onBeforeUnmount(()=>clearTimeout(timer));
async function save(){
 error.value='';const proposed:Record<string,string[]>={};try{
  const value=proposed;
  for(const [id,label] of shortcutActions){
   if(fields.value[id]===text(id)){value[id]=shortcuts.value[id]??[];continue;}
   try{value[id]=(fields.value[id]??'').split(';').map(s=>s.trim()).filter(Boolean).map(s=>parseShortcutLabel(s,platform.value));}catch(e){throw new Error(label+'：'+(e instanceof Error?e.message:String(e)));}
  }
  validateShortcuts(value,platform.value);await window.labpad.saveShortcuts(JSON.parse(JSON.stringify(value)));shortcuts.value=value;syncFields();notice.value='快捷键已保存，主窗口立即生效。';
 }catch(e){
  let message=e instanceof Error?e.message:String(e);
  for(const keys of Object.values({...shortcuts.value,...proposed}))for(const key of keys)message=message.replaceAll(key,formatShortcut(key,platform.value));
  error.value=message;
 }
}
function text(id:string){return (shortcuts.value[id]??[]).map(key=>formatShortcut(key,platform.value)).join('; ');}
function clear(id:string){shortcuts.value[id]=[];fields.value[id]='';}
</script>
<template>
 <div class="app-shell shortcuts-page" :data-theme="theme" @keydown.capture="keydown">
  <header><h2>快捷键</h2><p>点击录制，或输入当前系统的实际按键组合。多个快捷键用英文分号分隔，多段组合键用空格连接。</p></header>
  <fieldset :disabled="!ready" class="shortcut-fields"><div v-for="[id,label] in shortcutActions" :key="id" class="shortcut-row"><label :for="'key-'+id">{{label}}</label><input :id="'key-'+id" :aria-label="label+' 快捷键'" v-model="fields[id]" spellcheck="false"><button @click="record(id)">{{recording===id?'正在录制…':'录制'}}</button><button @click="clear(id)" :aria-label="'清除 '+label">清除</button></div></fieldset>
  <p v-if="error" class="field-error" role="alert">{{error}}</p><p role="status">{{notice}}</p>
  <footer><button @click="defaults">恢复默认</button><button class="primary" :disabled="!ready||!!recording" @click="save">保存快捷键</button></footer>
 </div>
</template>
<style>
.shortcuts-page{height:100vh;display:flex;flex-direction:column;background:var(--panel,#1e1e1e);color:var(--text,#ddd);padding:24px;gap:16px}.shortcuts-page h2{font-size:22px;margin-bottom:8px}.shortcuts-page header p{font-size:12px}.shortcuts-page .shortcut-fields{border:0;margin:0;padding:0;overflow:auto;flex:1;min-height:0}.shortcut-row{display:grid;grid-template-columns:120px minmax(0,1fr) 80px 50px;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #8883}.shortcut-row label{font-size:12px}.shortcut-row input{width:100%;min-width:0;font:12px Consolas,monospace}.shortcut-row button{font-size:12px;padding:6px}.shortcuts-page footer{height:auto;justify-content:space-between;padding:14px 0 0;background:none;border-top:1px solid #8884}
</style>
