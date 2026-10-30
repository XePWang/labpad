<script setup lang="ts">
import {onMounted,onBeforeUnmount,ref,watch,nextTick} from 'vue';
import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
const props=defineProps<{running:boolean;scrollback:number;theme:'light'|'dark'}>();
function colors(){return props.theme==='light'?{background:'#ffffff',foreground:'#1f1f1f',cursor:'#007acc',selectionBackground:'#add6ff'}:{background:'#1e1e1e',foreground:'#d4d4d4',cursor:'#aeafad',selectionBackground:'#264f78'};}
const host=ref<HTMLDivElement>(),input=ref<HTMLTextAreaElement>(),pending=ref('');
let terminal:Terminal|undefined,fit:FitAddon,observer:ResizeObserver;
function submit(event:KeyboardEvent){
 if(event.key!=='Enter'||event.shiftKey||event.isComposing||!props.running)return;
 event.preventDefault();window.labpad.debugInput(pending.value.replace(/\r?\n/g,'\r')+'\r');pending.value='';
}
onMounted(()=>{
 terminal=new Terminal({convertEol:false,cursorBlink:false,disableStdin:true,cursorInactiveStyle:'none',
  scrollback:props.scrollback,fontSize:13,fontFamily:'"Cascadia Code",Consolas,monospace',theme:colors()});
 fit=new FitAddon();terminal.loadAddon(fit);terminal.open(host.value!);
 observer=new ResizeObserver(()=>{if(host.value?.offsetWidth){fit.fit();window.labpad.debugResize(terminal!.cols,terminal!.rows);}});
 observer.observe(host.value!);
});
watch(()=>props.running,async value=>{pending.value='';if(value){await nextTick();fit?.fit();input.value?.focus();}});
watch(()=>props.theme,()=>{if(terminal)terminal.options.theme=colors();});
watch(()=>props.scrollback,value=>{if(terminal)terminal.options.scrollback=value;});
onBeforeUnmount(()=>{observer?.disconnect();terminal?.dispose();});
defineExpose({write:(data:string,done?:()=>void)=>{if(terminal)terminal.write(data,done);else done?.();},
 selection:()=>{const selected=input.value===document.activeElement?pending.value.slice(input.value.selectionStart,input.value.selectionEnd):'';return selected||terminal?.getSelection()||'';},
 clear:()=>terminal?.write('\x1b[2J\x1b[3J\x1b[H'),
 eof:()=>window.labpad.debugInput(navigator.platform.toLowerCase().includes('win')?'\x1a\r':'\x04')});
</script>
<template>
 <div class="debug-terminal" data-testid="terminal">
  <div ref="host" class="terminal-viewport"></div>
  <div class="debug-prompt" :class="{inactive:!running}"><span aria-hidden="true">&gt;</span><textarea ref="input" v-model="pending" rows="1" aria-label="调试输入" :disabled="!running" :placeholder="running?'输入后按 Enter 发送；Shift+Enter 换行':'程序运行后可输入'" spellcheck="false" @keydown="submit"></textarea></div>
 </div>
</template>
<style>
.debug-terminal{display:flex;flex-direction:column;min-height:0;height:100%}.terminal-viewport{flex:1;min-height:0;overflow:hidden}
.debug-prompt{display:flex;align-items:flex-start;gap:10px;border-top:1px solid var(--border);padding:8px 12px;color:var(--text);font:13px/1.6 Consolas,monospace}.debug-prompt>span{color:var(--accent);font-weight:700}.debug-prompt.inactive>span{color:var(--muted)}
.app-shell[data-theme] .debug-prompt textarea{flex:1;min-height:22px;max-height:90px;resize:vertical;background:transparent;border:0;box-shadow:none;padding:0;font:inherit;color:var(--text);caret-color:var(--accent)}.debug-prompt textarea:focus{outline:none}
</style>
