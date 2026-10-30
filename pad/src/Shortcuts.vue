<script setup lang="ts">
import {ref,onMounted,onBeforeUnmount} from 'vue';
import {shortcutActions,defaultShortcuts,validateShortcuts} from '../shared/shortcuts';
const ready=ref(false);
const shortcuts=ref<Record<string,string[]>>(defaultShortcuts()),theme=ref('dark'),error=ref(''),notice=ref(''),recording=ref(''),strokes=ref<string[]>([]);
let timer:ReturnType<typeof setTimeout>|undefined;
onMounted(async()=>{const state=await window.labpad.shortcutSettings();shortcuts.value=state.shortcuts;theme.value=state.theme;ready.value=true;});
function record(id:string){clearTimeout(timer);recording.value=id;strokes.value=[];notice.value='按下快捷键，可连续输入两段组合键；Esc 取消。';}
function keydown(event:KeyboardEvent){
 if(!recording.value)return;event.preventDefault();event.stopPropagation();if(event.key==='Escape'){recording.value='';notice.value='';return;}
 if(event.repeat||['Control','Shift','Alt','Meta'].includes(event.key))return;
 const key=[...(event.ctrlKey?['Control']:[]),...(event.metaKey?['Meta']:[]),...(event.altKey?['Alt']:[]),...(event.shiftKey?['Shift']:[]),event.code].join('+');strokes.value.push(key);
 clearTimeout(timer);const finish=()=>{shortcuts.value[recording.value]=[strokes.value.join(' ')];recording.value='';notice.value='';};
 if(strokes.value.length===2)finish();else timer=setTimeout(finish,1100);
}
onBeforeUnmount(()=>clearTimeout(timer));
async function save(){error.value='';try{await window.labpad.saveShortcuts(JSON.parse(JSON.stringify(validateShortcuts(shortcuts.value))));notice.value='快捷键已保存，主窗口立即生效。';}catch(e){error.value=e instanceof Error?e.message:String(e);}}
function text(id:string){return shortcuts.value[id]?.join('; ')??'';}
function edit(id:string,event:Event){shortcuts.value[id]=(event.target as HTMLInputElement).value.split(';').map(s=>s.trim()).filter(Boolean);}
</script>
<template>
 <div class="app-shell shortcuts-page" :data-theme="theme" @keydown.capture="keydown">
  <header><h2>快捷键</h2><p>点击录制，或直接编辑组合键；多个快捷键用英文分号分开。$mod 表示 Ctrl（macOS 为 ⌘）。</p></header>
  <fieldset :disabled="!ready" class="shortcut-fields"><div v-for="[id,label] in shortcutActions" :key="id" class="shortcut-row"><label :for="'key-'+id">{{label}}</label><input :id="'key-'+id" :aria-label="label+' 快捷键'" :value="text(id)" @input="edit(id,$event)" spellcheck="false"><button @click="record(id)">{{recording===id?'正在录制…':'录制'}}</button><button @click="shortcuts[id]=[]" :aria-label="'清除 '+label">清除</button></div></fieldset>
  <p v-if="error" class="field-error" role="alert">{{error}}</p><p role="status">{{notice}}</p>
  <footer><button @click="shortcuts=defaultShortcuts();error='';notice=''">恢复默认</button><button class="primary" :disabled="!ready||!!recording" @click="save">保存快捷键</button></footer>
 </div>
</template>
<style>
.shortcuts-page{height:100vh;display:flex;flex-direction:column;background:var(--panel,#1e1e1e);color:var(--text,#ddd);padding:24px;gap:16px}.shortcuts-page h2{font-size:22px;margin-bottom:8px}.shortcuts-page header p{font-size:12px}.shortcuts-page .shortcut-fields{border:0;margin:0;padding:0;overflow:auto;flex:1;min-height:0}.shortcut-row{display:grid;grid-template-columns:120px minmax(0,1fr) 80px 50px;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #8883}.shortcut-row label{font-size:12px}.shortcut-row input{width:100%;min-width:0;font:12px Consolas,monospace}.shortcut-row button{font-size:12px;padding:6px}.shortcuts-page footer{height:auto;justify-content:space-between;padding:14px 0 0;background:none;border-top:1px solid #8884}
</style>
