<script setup lang="ts">
import {onMounted,onBeforeUnmount,ref,watch} from 'vue';
import {basicSetup} from 'codemirror';
import {EditorView} from '@codemirror/view';
import {cpp} from '@codemirror/lang-cpp';
import {oneDark} from '@codemirror/theme-one-dark';
import {Compartment,EditorState} from '@codemirror/state';
const props=defineProps<{modelValue:string;disabled?:boolean}>();
const emit=defineEmits<{(e:'update:modelValue',value:string):void}>();
const host=ref<HTMLDivElement>();let view:EditorView|undefined;const readOnly=new Compartment();
onMounted(()=>{
 view=new EditorView({parent:host.value,doc:props.modelValue,extensions:[basicSetup,cpp(),oneDark,readOnly.of(EditorState.readOnly.of(!!props.disabled)),
  EditorView.theme({'&':{height:'100%',backgroundColor:'#101722'},'.cm-scroller':{overflow:'auto',fontFamily:'"Cascadia Code","JetBrains Mono",Consolas,monospace',fontSize:'14px',lineHeight:'1.7'},
   '.cm-gutters':{backgroundColor:'#101722',border:'none',color:'#5c6c84'},'.cm-content':{padding:'16px 0'},'.cm-activeLine':{backgroundColor:'#182233'}}),
  EditorView.updateListener.of(update=>{if(update.docChanged)emit('update:modelValue',update.state.doc.toString());})]});
});
watch(()=>props.modelValue,text=>{
 if(view&&view.state.doc.toString()!==text)view.dispatch({changes:{from:0,to:view.state.doc.length,insert:text}});
});
watch(()=>props.disabled,value=>view?.dispatch({effects:readOnly.reconfigure(EditorState.readOnly.of(!!value))}));
onBeforeUnmount(()=>view?.destroy());
</script>
<template><div ref="host" class="code-editor" data-testid="editor"></div></template>
