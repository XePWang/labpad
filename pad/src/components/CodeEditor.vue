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
import {Compartment,EditorState,Transaction,countColumn} from '@codemirror/state';
import type {EditorCursor} from '../../shared/types';
const props=defineProps<{modelValue:string;disabled?:boolean;documentId:number;indentSize:1|2|4;theme:'light'|'dark'}>();
const emit=defineEmits<{(e:'update:modelValue',value:string):void;(e:'format'):void;(e:'cursor',value:EditorCursor):void}>();
const host=ref<HTMLDivElement>();let view:EditorView|undefined;
const readOnly=new Compartment(),indentation=new Compartment(),colorTheme=new Compartment();
function indentConfig(){return [EditorState.tabSize.of(props.indentSize),indentUnit.of(' '.repeat(props.indentSize))];}
function colors(){
 return [props.theme==='dark'?vscodeDark:vscodeLight,EditorView.theme({
  '.cm-highlightSpace':{background:'radial-gradient(circle at center, '+(props.theme==='dark'?'rgba(212,212,212,0.35)':'rgba(31,31,31,0.35)')+' 1px, transparent 1px) 0 0 / 1ch 100% repeat-x'},
  '.cm-highlightTab':{opacity:'0.35'}
 })];
}
function reportCursor(state:EditorState){
 const head=state.selection.main.head,line=state.doc.lineAt(head),ranges=state.selection.ranges.filter(r=>!r.empty);
 let selectionLines=0,lastLine=0;
 for(const range of ranges){
  const first=state.doc.lineAt(range.from).number,last=state.doc.lineAt(state.doc.lineAt(range.to).from===range.to?range.to-1:range.to).number;
  selectionLines+=Math.max(0,last-Math.max(first,lastLine+1)+1);lastLine=last;
 }
 emit('cursor',{line:line.number,column:countColumn(line.text.slice(0,head-line.from),state.tabSize)+1,selectionChars:ranges.reduce((n,r)=>n+r.to-r.from,0),selectionLines,lines:state.doc.lines,focused:!!view?.hasFocus});
}
function extensions(){
 return [basicSetup,cpp(),highlightWhitespace(),keymap.of([indentWithTab,{key:'Mod-Shift-z',run:redo,preventDefault:true},{key:'Mod-h',run:openSearchPanel,scope:'editor search-panel'},{key:'Shift-Alt-f',run:()=>{emit('format');return true;}}]),
  indentation.of(indentConfig()),colorTheme.of(colors()),readOnly.of([EditorState.readOnly.of(!!props.disabled),EditorView.editable.of(!props.disabled)]),
  EditorView.contentAttributes.of({'aria-label':'源码编辑器'}),
  EditorView.theme({'&':{height:'100%'},'.cm-scroller':{overflow:'auto',fontFamily:'"Cascadia Code","JetBrains Mono",Consolas,monospace',fontSize:'14px',lineHeight:'1.7'},
   '.cm-gutters':{border:'none'},'.cm-content':{padding:'16px 0'}}),
  EditorView.updateListener.of(update=>{if(update.docChanged)emit('update:modelValue',update.state.doc.toString());if(update.docChanged||update.selectionSet||update.focusChanged)reportCursor(update.state);})];
}
function applyText(text:string){
 if(!view)return;
 const current=view.state.doc.toString();if(current===text)return;
 const changes=diff(current,text,{scanLimit:1000,timeout:50}).map(c=>({from:c.fromA,to:c.toA,insert:text.slice(c.fromB,c.toB)}));
 view.dispatch({changes,annotations:[isolateHistory.of('full'),Transaction.userEvent.of('input.format')]});
}
onMounted(()=>{view=new EditorView({parent:host.value,state:EditorState.create({doc:props.modelValue,extensions:extensions()})});reportCursor(view.state);});
watch(()=>[props.documentId,props.modelValue] as const,([id,text],[previousId])=>{
 if(!view)return;
 if(id!==previousId){view.setState(EditorState.create({doc:text,extensions:extensions()}));reportCursor(view.state);}
 else if(view.state.doc.toString()!==text)applyText(text);
});
watch(()=>[props.indentSize,props.theme],()=>view?.dispatch({effects:[indentation.reconfigure(indentConfig()),colorTheme.reconfigure(colors())]}));
watch(()=>props.disabled,value=>view?.dispatch({effects:readOnly.reconfigure([EditorState.readOnly.of(!!value),EditorView.editable.of(!value)])}));
onBeforeUnmount(()=>view?.destroy());
defineExpose({applyText,focus:()=>view?.focus()});
</script>
<template><div ref="host" class="code-editor" data-testid="editor"></div></template>
