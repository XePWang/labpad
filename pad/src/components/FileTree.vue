<script setup lang="ts">
import {computed,ref,onMounted,onBeforeUnmount,watch,nextTick} from 'vue';
import {ContextMenuRoot,ContextMenuTrigger,ContextMenuPortal,ContextMenuContent,ContextMenuItem} from 'reka-ui';
import {operationError} from '../../shared/errors';
import type {WorkspaceFile,WorkspaceEdit} from '../../shared/workspace';
const props=defineProps<{files:WorkspaceFile[];expanded:string[];active:string;disabled:boolean;theme:string;commit:(edit:WorkspaceEdit)=>Promise<void>}>();
const emit=defineEmits<{open:[file:string];expand:[files:string[]];action:[action:string,file:string];resize:[width:number]}>();
const host=ref<HTMLElement>(),input=ref<HTMLInputElement>(),selected=ref(props.active),rootSelected=ref(false);
const edit=ref<{action:WorkspaceEdit['action'];file:string;parent:string;name:string;directory:boolean;template:boolean;syncReferences:boolean;error:string}>(),saving=ref(false);
let observer:ResizeObserver|undefined;
onMounted(()=>{observer=new ResizeObserver(entries=>{const width=Math.round(entries[0].borderBoxSize[0].inlineSize);if(width>=120&&width<=420)emit('resize',width);});if(host.value)observer.observe(host.value);});
onBeforeUnmount(()=>observer?.disconnect());
watch(()=>props.active,value=>{if(value){selected.value=value;rootSelected.value=false;}});
watch(()=>props.files,()=>{if(selected.value&&!props.files.some(f=>f.path===selected.value))selected.value=props.active;});
const parentOf=(file:string)=>file.includes('/')?file.slice(0,file.lastIndexOf('/')):'';
function baseFolder(file?:string){const target=file===undefined?rootSelected.value?'':selected.value||props.active:file;return props.files.find(f=>f.path===target)?.directory?target:parentOf(target);}
function expandParents(file:string){if(!file)return;const parts=file.split('/'),parents=parts.map((_,i)=>parts.slice(0,i+1).join('/'));emit('expand',[...new Set([...props.expanded,...parents])]);}
async function begin(action:WorkspaceEdit['action'],file?:string,language?:'c'|'cpp'){
 if(props.disabled||saving.value)return;
 if(action==='rename'&&file==='LPMake.txt')return;
 const folder=action==='rename'?parentOf(file!):baseFolder(file),directory=action==='newFolder'||(action==='rename'&&!!props.files.find(f=>f.path===file)?.directory);
 let name=action==='rename'?file!.split('/').pop()!:language?'new.'+(language==='c'?'c':'cpp'):'';
 if(language){let n=2;const stem=name.slice(0,name.lastIndexOf('.')),ext=name.slice(name.lastIndexOf('.'));while(props.files.some(f=>f.path===(folder?folder+'/':'')+name))name=stem+(n++)+ext;}
 edit.value={action,file:file??'',parent:folder,name,directory,template:!!language,syncReferences:true,error:''};if(folder)expandParents(folder);
 await nextTick();input.value?.focus();const dot=name.lastIndexOf('.');input.value?.setSelectionRange(0,!directory&&dot>0?dot:name.length);
}
defineExpose({newSource:(language:'c'|'cpp')=>begin('newFile',undefined,language)});
function cancel(){if(!saving.value)edit.value=undefined;}
async function submit(){
 const value=edit.value;if(!value||saving.value)return;
 if(!value.name.trim()){value.error='请输入'+(value.directory?'文件夹名':'文件名');return;}
 const name=(value.parent?value.parent+'/':'')+value.name;
 saving.value=true;value.error='';
 try{await props.commit({action:value.action,file:value.file,name,template:value.template,syncReferences:value.syncReferences});selected.value=name;expandParents(parentOf(name));edit.value=undefined;}
 catch(error){value.error=operationError(error);await nextTick();input.value?.focus();}
 finally{saving.value=false;}
}
function setInput(element:unknown){input.value=element instanceof HTMLInputElement?element:undefined;}
function blur(event:FocusEvent){if(event.relatedTarget instanceof Element&&event.relatedTarget.closest('.tree-inline-edit'))return;if(!edit.value||saving.value)return;if(edit.value.name.trim())void submit();else cancel();}
function toggle(file:WorkspaceFile){rootSelected.value=false;selected.value=file.path;if(file.directory)emit('expand',props.expanded.includes(file.path)?props.expanded.filter(f=>f!==file.path):[...props.expanded,file.path]);else emit('open',file.path);}
function menu(action:string,file:WorkspaceFile){rootSelected.value=false;selected.value=file.path;if(action==='newFile'||action==='newFolder'||action==='rename')void begin(action,file.path);else emit('action',action,file.path);}
const rows=computed(()=>{
 const children=new Map<string,WorkspaceFile[]>();for(const file of props.files){const parent=parentOf(file.path);children.set(parent,[...(children.get(parent)??[]),file]);}
 for(const list of children.values())list.sort((a,b)=>Number(b.directory)-Number(a.directory)||(a.path.normalize('NFC')<b.path.normalize('NFC')?-1:1));
 const result:({kind:'file';file:WorkspaceFile}|{kind:'edit';parent:string})[]=[];
 function visit(parent:string){
  const current=edit.value,list=children.get(parent)??[];
  if(current&&current.parent===parent&&current.action!=='rename')result.push({kind:'edit',parent});
  for(const file of list){
   if(current?.action==='rename'&&current.file===file.path)result.push({kind:'edit',parent});
   else result.push({kind:'file',file});
   if(file.directory&&props.expanded.includes(file.path)&&!(current?.action==='rename'&&current.file===file.path))visit(file.path);
  }
 }
 visit('');return result;
});
function navigate(event:KeyboardEvent){
 const buttons=Array.from(host.value?.querySelectorAll<HTMLButtonElement>('.tree-file')??[]),index=buttons.indexOf(event.target as HTMLButtonElement);if(index<0)return;
 const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:event.key==='ArrowDown'?Math.min(index+1,buttons.length-1):Math.max(0,index-1);buttons[next]?.focus();selected.value=buttons[next]?.dataset.file??selected.value;
}
</script>
<template>
 <aside ref="host" class="file-tree" aria-label="项目文件">
  <div class="tree-heading"><strong>文件</strong>
   <button title="新建文件" aria-label="新建项目文件" :disabled="disabled||saving" @click="begin('newFile')">＋</button>
   <button title="新建文件夹" aria-label="新建文件夹" :disabled="disabled||saving" @click="begin('newFolder')">▱</button>
   <button title="折叠全部文件夹" aria-label="折叠全部文件夹" :disabled="disabled||saving||!expanded.length" @click="cancel();emit('action','collapseAll','')"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3h7v7M3 6h7v7H3V6Zm2 3.5h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
  </div>
  <div class="tree-items" role="tree" @click.self="selected='';rootSelected=true;cancel()" @keydown.down.prevent="navigate($event)" @keydown.up.prevent="navigate($event)" @keydown.home.prevent="navigate($event)" @keydown.end.prevent="navigate($event)">
   <template v-for="row in rows" :key="row.kind==='file'?row.file.path:'@edit'">
    <div v-if="row.kind==='edit'&&edit" class="tree-inline-edit" :style="{paddingLeft:(10+(row.parent?row.parent.split('/').length:0)*14)+'px'}" @keydown.stop>
     <div class="tree-edit-row"><span class="tree-icon" aria-hidden="true">{{edit.directory?'▱':'·'}}</span><input  :ref="setInput" v-model="edit.name" aria-label="项目内路径" :placeholder="edit.directory?'文件夹名':'文件名'" :disabled="saving" :aria-invalid="!!edit.error" :aria-describedby="edit.error?'tree-edit-error':undefined" @input="edit.error=''" @keydown.enter.prevent="submit" @keydown.esc.prevent="cancel" @blur="blur"></div>
     <label v-if="edit.action==='rename'" class="tree-edit-option"><input v-model="edit.syncReferences" type="checkbox" @blur="blur">同步构建引用</label>
     <p v-if="edit.error" id="tree-edit-error" class="tree-edit-error" :class="{'source-diagnostic':edit.error.startsWith('LPMake.txt:')}" role="alert">{{edit.error}}</p>
    </div>
    <ContextMenuRoot v-else-if="row.kind==='file'"><ContextMenuTrigger as-child>
     <button role="treeitem" class="tree-file" :data-file="row.file.path" :class="{selected:selected===row.file.path,active:active===row.file.path}" :style="{paddingLeft:(10+(row.file.path.split('/').length-1)*14)+'px'}" :aria-expanded="row.file.directory?expanded.includes(row.file.path):undefined" :aria-selected="selected===row.file.path" :disabled="disabled||saving" :title="row.file.path" @contextmenu="selected=row.file.path" @click="toggle(row.file)" @keydown.f2.prevent="begin('rename',row.file.path)" @keydown.delete.prevent="row.file.path!=='LPMake.txt'&&emit('action','delete',row.file.path)" @keydown.right.prevent="row.file.directory&&!expanded.includes(row.file.path)&&toggle(row.file)" @keydown.left.prevent="row.file.directory&&expanded.includes(row.file.path)&&toggle(row.file)">
      <span class="tree-icon"><svg v-if="row.file.directory" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" :class="{expanded:expanded.includes(row.file.path)}"><path d="m6 3.5 4.5 4.5-4.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><template v-else>{{row.file.path==='LPMake.txt'?'⚙':/\.(c|cpp|cc|cxx|h|hpp)$/i.test(row.file.path)?'C':'·'}}</template></span><span>{{row.file.path.split('/').pop()}}</span>
     </button>
    </ContextMenuTrigger><ContextMenuPortal><ContextMenuContent class="tab-context" :data-theme="theme" @close-auto-focus="$event.preventDefault()">
     <ContextMenuItem v-if="row.file.directory" class="tab-menu-item" @select="menu('newFile',row.file)">新建文件…</ContextMenuItem>
     <ContextMenuItem v-if="row.file.directory" class="tab-menu-item" @select="menu('newFolder',row.file)">新建文件夹…</ContextMenuItem>
     <ContextMenuItem class="tab-menu-item" :disabled="row.file.path==='LPMake.txt'" @select="menu('rename',row.file)">重命名…</ContextMenuItem>
     <ContextMenuItem class="tab-menu-item" @select="menu('reveal',row.file)">在文件管理器中显示</ContextMenuItem>
     <ContextMenuItem class="tab-menu-item" :disabled="row.file.path==='LPMake.txt'" @select="menu('delete',row.file)">删除…</ContextMenuItem>
    </ContextMenuContent></ContextMenuPortal></ContextMenuRoot>
   </template>
  </div>
  <button class="tree-build-settings" :disabled="disabled||saving" @click="emit('action','build','LPMake.txt')">项目构建设置…</button>
 </aside>
</template>
<style>
.file-tree{box-sizing:border-box;display:flex;flex-direction:column;flex-shrink:0;min-width:120px;max-width:420px;background:var(--panel);border-right:1px solid var(--border);overflow:hidden;resize:horizontal;width:190px}
.tree-heading{display:flex;align-items:center;height:36px;gap:3px;padding:0 8px;font-size:12px;border-bottom:1px solid var(--border)}.tree-heading strong{margin-right:auto}.tree-heading button{padding:2px 4px;border:0;background:transparent;color:var(--muted)}
.tree-items{overflow:auto;flex:1;min-height:40px}.tree-file{display:flex;align-items:center;gap:6px;width:100%;border:0;background:transparent;color:var(--text);border-radius:0;padding:6px 10px;text-align:left;font-size:12px;white-space:nowrap}.tree-file>span:last-child{overflow:hidden;text-overflow:ellipsis}.tree-file.selected{background:var(--raised)}.tree-file.active{box-shadow:inset 2px 0 var(--accent)}.tree-file:focus-visible{outline:1px solid var(--accent);outline-offset:-1px}
.tree-icon{display:flex;align-items:center;justify-content:center;width:16px;flex-shrink:0;color:var(--muted);font-size:11px}.tree-icon svg.expanded{transform:rotate(90deg)}
.tree-inline-edit{padding:3px 8px 3px 10px;font-size:12px}.tree-edit-row{display:flex;align-items:center;gap:6px}.tree-edit-row input{min-width:0;width:100%;padding:3px 4px;font-size:12px;border:1px solid var(--accent);border-radius:0;outline:none}.tree-edit-row input[aria-invalid=true]{border-color:var(--failure)}.tree-edit-error{margin:5px 0 0 22px;color:var(--failure);font-size:11px;overflow-wrap:anywhere}.tree-edit-option{display:flex;align-items:center;gap:4px;font-size:10px;margin:5px 0 0 22px;color:var(--muted)}.tree-edit-option input{width:12px;height:12px;margin:0}
.tree-build-settings{font-size:11px;padding:8px;border:0;border-top:1px solid var(--border);background:transparent;color:var(--muted)}
.editor-workspace{display:flex;flex:1;min-height:0;min-width:0;overflow:hidden}.editor-content{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0}.editor-content>.code-editor{flex:1;min-height:0}
</style>
