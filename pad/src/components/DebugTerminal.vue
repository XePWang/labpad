<script setup lang="ts">
import {onMounted,onBeforeUnmount,ref,watch,nextTick} from 'vue';
import {Terminal} from '@xterm/xterm';import {FitAddon} from '@xterm/addon-fit';import {Unicode11Addon} from '@xterm/addon-unicode11';
import {terminalCommand} from '../../shared/terminal-keymap';
import {Readline} from '../../vendor/xterm-readline/src/readline';
import '@xterm/xterm/css/xterm.css';
const props=defineProps<{running:boolean;epoch:number;historyBytes:number;scrollback:number;theme:'light'|'dark'}>();
const host=ref<HTMLDivElement>();let terminal:Terminal|undefined,readline:Readline|undefined,fit:FitAddon,observer:ResizeObserver,generation=0,outputTail=Promise.resolve();
const win=/^win/i.test(navigator.platform);
function colors(){return props.theme==='light'?{background:'#ffffff',foreground:'#1f1f1f',cursor:'#0067c0',selectionBackground:'#add6ff'}:{background:'#1e1e1e',foreground:'#d4d4d4',cursor:'#aeafad',selectionBackground:'#264f78'};}
function eof(){window.labpad.debugInput(win?'\x1a\r':'\x04');}
async function readLoop(id:number){
 while(props.running&&id===generation&&readline){
  try{const text=await readline.read('> ');if(!props.running||id!==generation)return;window.labpad.debugInput(text.replace(/\r?\n/g,'\r')+'\r');}
  catch{return;}
 }
}
async function begin(){const id=++generation;readline?.abortRead();await outputTail;await nextTick();if(!props.running||id!==generation||!terminal)return;fit?.fit();terminal.options.disableStdin=false;terminal.options.cursorBlink=true;terminal.focus();terminal.write('',()=>{if(!props.running||id!==generation)return;const start=()=>void readLoop(id);if(terminal!.buffer.active.cursorX)terminal!.write('\r\n',start);else start();});}
function key(event:KeyboardEvent){
 if(event.type!=='keydown'||event.isComposing)return true;
 const selected=terminal?.getSelection()||'',command=terminalCommand(event,navigator.platform,!!selected,!readline?.getLine(),props.running);
 if(!command)return props.running?(readline?.handleKeyEvent(event)??true):true;event.preventDefault();
 if(command==='copy')void window.labpad.copyText(selected);
 if(command==='interrupt')void window.labpad.cancel();
 if(command==='selectAll')terminal?.selectAll();
 if(command==='home'||command==='end')terminal?.input(command==='home'?'\x01':'\x05',true);
 if(command==='wordLeft'||command==='wordRight'||command==='deleteWordLeft'||command==='deleteWordRight')readline?.moveWord(command.endsWith('Left'),command.startsWith('delete'));
 if(command==='eof')eof();return false;
}
onMounted(()=>{
 terminal=new Terminal({allowProposedApi:true,screenReaderMode:false,cursorBlink:false,disableStdin:true,cursorInactiveStyle:'none',scrollback:props.scrollback,fontSize:13,fontFamily:'"Cascadia Code",Consolas,"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",monospace',theme:colors()});
 fit=new FitAddon();terminal.loadAddon(fit);terminal.loadAddon(new Unicode11Addon());terminal.unicode.activeVersion='11';readline=new Readline();terminal.loadAddon(readline);terminal.attachCustomKeyEventHandler(key);terminal.open(host.value!);terminal.textarea?.setAttribute('aria-label','调试输入');
 observer=new ResizeObserver(()=>{if(host.value?.offsetWidth){fit.fit();window.labpad.debugResize(terminal!.cols,terminal!.rows);}});observer.observe(host.value!);
});
watch(()=>props.running,value=>{if(value)void begin();else{const id=++generation;void outputTail.finally(()=>{if(id!==generation)return;readline?.abortRead();if(terminal){terminal.options.disableStdin=true;terminal.options.cursorBlink=false;terminal.blur();}});}});
watch(()=>props.epoch,()=>readline?.resetHistory(props.historyBytes));
watch(()=>props.historyBytes,value=>readline?.setHistoryLimit(value));
watch(()=>props.theme,()=>{if(terminal)terminal.options.theme=colors();});
watch(()=>props.scrollback,value=>{if(terminal)terminal.options.scrollback=value;});
onBeforeUnmount(()=>{generation++;observer?.disconnect();readline?.abortRead();terminal?.dispose();});
defineExpose({write:(data:string,done?:()=>void)=>{outputTail=outputTail.then(()=>readline?.writeAbove(data)).then(()=>{done?.();});void outputTail.catch(()=>done?.());},
 selection:()=>terminal?.getSelection()||'',clear:()=>readline?.clearOutput(),eof});
</script>
<template><div class="debug-terminal" data-testid="terminal"><div ref="host" class="terminal-viewport"></div></div></template>
<style>.debug-terminal,.terminal-viewport{min-height:0;height:100%;overflow:hidden}.terminal-viewport{padding:6px 10px;box-sizing:border-box}.debug-terminal .xterm{height:100%}</style>
