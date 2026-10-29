<script setup lang="ts">
import {onMounted,onBeforeUnmount,ref,watch} from 'vue';
import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
const props=defineProps<{running:boolean;scrollback:number}>();
const host=ref<HTMLDivElement>();let terminal:Terminal|undefined,fit:FitAddon,observer:ResizeObserver;
onMounted(()=>{
 terminal=new Terminal({convertEol:false,cursorBlink:true,disableStdin:!props.running,
  scrollback:props.scrollback,fontSize:13,fontFamily:'"Cascadia Code",Consolas,monospace',
  theme:{background:'#0b1018',foreground:'#dbe4f0',cursor:'#82d7bd',selectionBackground:'#36546c'}});
 fit=new FitAddon();terminal.loadAddon(fit);terminal.open(host.value!);
 terminal.onData(data=>{if(props.running)window.labpad.debugInput(data);});
 observer=new ResizeObserver(()=>{if(host.value?.offsetWidth){fit.fit();window.labpad.debugResize(terminal!.cols,terminal!.rows);}});
 observer.observe(host.value!);
});
watch(()=>props.running,value=>{if(terminal){terminal.options.disableStdin=!value;if(value){fit.fit();terminal.focus();}}});
watch(()=>props.scrollback,value=>{if(terminal)terminal.options.scrollback=value;});
onBeforeUnmount(()=>{observer?.disconnect();terminal?.dispose();});
defineExpose({write:(data:string)=>terminal?.write(data),clear:()=>terminal?.clear(),
 eof:()=>window.labpad.debugInput(navigator.platform.toLowerCase().includes('win')?'\x1a\r':'\x04')});
</script>
<template><div ref="host" class="debug-terminal" data-testid="terminal"></div></template>
