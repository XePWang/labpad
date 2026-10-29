<script setup lang="ts">
import {onMounted,onBeforeUnmount,ref,watch} from 'vue';
import {basicSetup} from 'codemirror';
import {EditorView,highlightWhitespace,keymap} from '@codemirror/view';
import {cpp} from '@codemirror/lang-cpp';
import {indentWithTab,isolateHistory,redo} from '@codemirror/commands';
import {indentUnit} from '@codemirror/language';
import {openSearchPanel} from '@codemirror/search';
import {diff} from '@codemirror/merge';
import {vscodeDark,vscodeLight} from '@uiw/codemirror-theme-vscode';
import {Compartment,EditorState,Transaction} from '@codemirror/state';
const props=defineProps<{modelValue:string;disabled?:boolean;documentId:number;indentSize:1|2|4;theme:'light'|'dark'}>();
const emit=defineEmits<{(e:'update:modelValue',value:string):void;(e:'format'):void}>();
const host=ref<HTMLDivElement>();let view:EditorView|undefined;
const readOnly=new Compartment(),indentation=new Compartment(),colorTheme=new Compartment();
function indentConfig(){return [EditorState.tabSize.of(props.indentSize),indentUnit.of(' '.repeat(props.indentSize))];}
function colors(){
 return [props.theme==='dark'?vscodeDark:vscodeLight,EditorView.theme({
  '.cm-highlightSpace':{background:'radial-gradient(circle at center, '+(props.theme==='dark'?'rgba(212,212,212,0.35)':'rgba(31,31,31,0.35)')+' 1px, transparent 1px) 0 0 / 1ch 100% repeat-x'},
  '.cm-highlightTab':{opacity:'0.35'}
 })];
}
function extensions(){
 return [basicSetup,cpp(),highlightWhitespace(),keymap.of([indentWithTab,{key:'Mod-Shift-z',run:redo,preventDefault:true},{key:'Mod-h',run:openSearchPanel,scope:'editor search-panel'},{key:'Shift-Alt-f',run:()=>{emit('format');return true;}}]),
  indentation.of(indentConfig()),colorTheme.of(colors()),readOnly.of(EditorState.readOnly.of(!!props.disabled)),
  EditorView.contentAttributes.of({'aria-label':'源码编辑器'}),
  EditorView.theme({'&':{height:'100%'},'.cm-scroller':{overflow:'auto',fontFamily:'"Cascadia Code","JetBrains Mono",Consolas,monospace',fontSize:'14px',lineHeight:'1.7'},
   '.cm-gutters':{border:'none'},'.cm-content':{padding:'16px 0'}}),
  EditorView.updateListener.of(update=>{if(update.docChanged)emit('update:modelValue',update.state.doc.toString());})];
}
function applyText(text:string){
 if(!view)return;
 const current=view.state.doc.toString();if(current===text)return;
 const changes=diff(current,text,{scanLimit:1000,timeout:50}).map(c=>({from:c.fromA,to:c.toA,insert:text.slice(c.fromB,c.toB)}));
 view.dispatch({changes,annotations:[isolateHistory.of('full'),Transaction.userEvent.of('input.format')]});
}
onMounted(()=>{view=new EditorView({parent:host.value,state:EditorState.create({doc:props.modelValue,extensions:extensions()})});});
watch(()=>[props.documentId,props.modelValue] as const,([id,text],[previousId])=>{
 if(!view)return;
 if(id!==previousId)view.setState(EditorState.create({doc:text,extensions:extensions()}));
 else if(view.state.doc.toString()!==text)applyText(text);
});
watch(()=>[props.indentSize,props.theme],()=>view?.dispatch({effects:[indentation.reconfigure(indentConfig()),colorTheme.reconfigure(colors())]}));
watch(()=>props.disabled,value=>view?.dispatch({effects:readOnly.reconfigure(EditorState.readOnly.of(!!value))}));
onBeforeUnmount(()=>view?.destroy());
defineExpose({applyText,focus:()=>view?.focus()});
</script>
<template><div ref="host" class="code-editor" data-testid="editor"></div></template>
