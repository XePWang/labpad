<script setup lang="ts">
import {computed,ref,onMounted,onBeforeUnmount,watch,nextTick} from 'vue';
import {TreeRoot,TreeItem,ContextMenuRoot,ContextMenuTrigger,ContextMenuPortal,ContextMenuContent,ContextMenuItem,ContextMenuSeparator} from 'reka-ui';
import ActionIcon from './ActionIcon.vue';import {operationError} from '../../shared/errors';
import type {WorkspaceFile,WorkspaceEdit} from '../../shared/workspace';
import type {FileRequest} from '../../core/files';
interface Node extends WorkspaceFile{children?:Node[]}
const props=defineProps<{files:WorkspaceFile[];expanded:string[];active:string;disabled:boolean;theme:string;labId:string;project:boolean;cutPaths?:string[];canPaste?:boolean;commit:(edit:WorkspaceEdit)=>Promise<void>}>();
const emit=defineEmits<{open:[files:string[]];expand:[files:string[]];action:[action:string,files:string[]];request:[request:FileRequest];resize:[width:number]}>();
const host=ref<HTMLElement>(),input=ref<HTMLInputElement>(),itemsHost=ref<HTMLElement>(),selected=ref<string[]>([]),rootSelected=ref(false);
const edit=ref<{action:WorkspaceEdit['action'];file:string;parent:string;name:string;directory:boolean;template:boolean;syncReferences:boolean;error:string}>(),saving=ref(false),dropTarget=ref<string|null>(null);
let observer:ResizeObserver|undefined,dragPaths:string[]=[],hoverTimer:ReturnType<typeof setTimeout>|undefined,hoverFolder='';
const parentOf=(file:string)=>file.includes('/')?file.slice(0,file.lastIndexOf('/')):'';
onMounted(()=>{observer=new ResizeObserver(entries=>{const width=Math.round(entries[0].borderBoxSize[0].inlineSize);if(width>=120&&width<=420)emit('resize',width);});if(host.value)observer.observe(host.value);});
watch(()=>props.active,value=>{if(value&&!selected.value.includes(value)){selected.value=[value];anchor=value;rootSelected.value=false;}});
watch(()=>props.files,()=>{selected.value=selected.value.filter(p=>props.files.some(f=>f.path===p));});
const nodes=computed(()=>{const map=new Map<string,Node>();for(const f of props.files)map.set(f.path,{...f,...(f.directory?{children:[]}: {})});const roots:Node[]=[];for(const node of map.values()){const parent=map.get(parentOf(node.path));if(parent?.children)parent.children.push(node);else roots.push(node);}
 const sort=(values:Node[])=>{values.sort((a,b)=>Number(b.directory)-Number(a.directory)||(a.path<b.path?-1:1));for(const node of values)if(node.children)sort(node.children);};sort(roots);return roots;});
const selection=computed({get:()=>props.files.filter(f=>selected.value.includes(f.path)),set:(values:WorkspaceFile[])=>selected.value=values.map(v=>v.path)});
const visible=computed(()=>{const result:WorkspaceFile[]=[];const visit=(list:Node[])=>{for(const n of list){result.push(n);if(n.children&&props.expanded.includes(n.path))visit(n.children);}};visit(nodes.value);return result;});
const minimal=()=>selected.value.filter(p=>!selected.value.some(other=>other!==p&&p.startsWith(other+'/')));
let anchor='',openingMenuEdit=false;
function selectRange(end:string,add=false){const paths=visible.value.map(f=>f.path),a=paths.indexOf(anchor),b=paths.indexOf(end);if(a<0||b<0){selected.value=[end];anchor=end;return;}const range=paths.slice(Math.min(a,b),Math.max(a,b)+1);selected.value=add?[...new Set([...selected.value,...range])]:range;}
function selectRow(event:CustomEvent<any>,file:WorkspaceFile){event.preventDefault();const e=event.detail.originalEvent as MouseEvent|KeyboardEvent;rootSelected.value=false;
 if(e.shiftKey)selectRange(file.path,e.ctrlKey||e.metaKey);else if(e.ctrlKey||e.metaKey){selected.value=selected.value.includes(file.path)?selected.value.filter(p=>p!==file.path):[...selected.value,file.path];anchor=file.path;}
 else{selected.value=[file.path];anchor=file.path;}
 if(!file.directory&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey)emit('open',[file.path]);
}
function context(file:WorkspaceFile){rootSelected.value=false;if(!selected.value.includes(file.path)){selected.value=[file.path];anchor=file.path;}}
function baseFolder(file?:string){const target=file===undefined?rootSelected.value?'':selected.value.at(-1)||props.active:file;return props.files.find(f=>f.path===target)?.directory?target:parentOf(target);}
function expandParents(file:string){if(!file)return;const parts=file.split('/');emit('expand',[...new Set([...props.expanded,...parts.map((_,i)=>parts.slice(0,i+1).join('/'))])]);}
async function begin(action:WorkspaceEdit['action'],file?:string,language?:'c'|'cpp'){
 if(props.disabled||saving.value)return;if(action==='rename'&&props.project&&file==='LPMake.txt')return;
 const folder=action==='rename'?parentOf(file!):baseFolder(file),directory=action==='newFolder'||action==='rename'&&!!props.files.find(f=>f.path===file)?.directory;
 let name=action==='rename'?file!.split('/').pop()!:language?'new.'+language:'';
 if(language){let n=2;const stem=name.slice(0,name.lastIndexOf('.')),ext=name.slice(name.lastIndexOf('.'));while(props.files.some(f=>f.path===(folder?folder+'/':'')+name))name=stem+(n++)+ext;}
 edit.value={action,file:file??'',parent:folder,name,directory,template:!!language,syncReferences:true,error:''};expandParents(folder);await nextTick();input.value?.focus();const dot=name.lastIndexOf('.');input.value?.setSelectionRange(0,!directory&&dot>0?dot:name.length);
}
function setInput(element:unknown){input.value=element instanceof HTMLInputElement?element:undefined;}
function cancel(){if(!saving.value)edit.value=undefined;}
async function submit(){const value=edit.value;if(!value||saving.value)return;if(!value.name.trim()){value.error='请输入'+(value.directory?'文件夹名':'文件名');return;}const name=(value.parent?value.parent+'/':'')+value.name;
 saving.value=true;value.error='';try{await props.commit({action:value.action,file:value.file,name,template:value.template,syncReferences:value.syncReferences});selected.value=[name];anchor=name;expandParents(parentOf(name));edit.value=undefined;}catch(error){value.error=operationError(error);await nextTick();input.value?.focus();}finally{saving.value=false;}}
function blur(event:FocusEvent){if(event.relatedTarget instanceof Element&&event.relatedTarget.closest('.tree-inline-edit'))return;if(edit.value&&!saving.value&&!openingMenuEdit){if(edit.value.name.trim())void submit();else cancel();}}
function menu(action:string,file?:WorkspaceFile){if(file)context(file);if(action==='newFile'||action==='newFolder'){openingMenuEdit=true;void begin(action,file?.path);}else if(action==='rename'&&selected.value.length===1){openingMenuEdit=true;void begin('rename',selected.value[0]);}else emit('action',action,action==='paste'?[baseFolder(file?.path)]:minimal());}
function key(event:KeyboardEvent){if((event.target as Element).closest('.tree-inline-edit')||props.disabled)return;const mod=event.ctrlKey||event.metaKey;
 if(mod&&['a','c','x','v'].includes(event.key.toLowerCase())){event.preventDefault();event.stopPropagation();const command=event.key.toLowerCase();if(command==='a')selected.value=visible.value.map(f=>f.path);else menu(command==='c'?'copy':command==='x'?'cut':'paste');return;}
 if(event.key==='F2'){const focused=(event.target as HTMLElement).closest<HTMLElement>('[data-file]')?.dataset.file;if(focused&&!selected.value.includes(focused)){selected.value=[focused];anchor=focused;}event.preventDefault();event.stopPropagation();if(selected.value.length===1)void begin('rename',selected.value[0]);}
 if(event.key==='Delete'||event.metaKey&&event.key==='Backspace'){event.preventDefault();event.stopPropagation();menu('delete');}
 if(event.shiftKey&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){if(!anchor)anchor=(event.target as HTMLElement).dataset.file??'';requestAnimationFrame(()=>{const file=(document.activeElement as HTMLElement)?.dataset.file;if(file&&host.value?.contains(document.activeElement))selectRange(file,mod);});}
}
const rows=computed(()=>{const result:({file:WorkspaceFile}|{parent:string})[]=[];const visit=(list:Node[],parent='')=>{const current=edit.value;if(current?.parent===parent&&current.action!=='rename')result.push({parent});for(const file of list){if(current?.action==='rename'&&current.file===file.path)result.push({parent});else result.push({file});if(file.children&&props.expanded.includes(file.path)&&!(current?.action==='rename'&&current.file===file.path))visit(file.children,file.path);}};visit(nodes.value);return result;});
function dragStart(event:DragEvent,file:WorkspaceFile){if(props.disabled||edit.value){event.preventDefault();return;}context(file);dragPaths=minimal();event.dataTransfer!.effectAllowed='copyMove';event.dataTransfer!.setData('application/x-labpad-files',JSON.stringify({labId:props.labId,paths:dragPaths}));}
function dragOver(event:DragEvent,file?:WorkspaceFile){if(props.disabled)return;const external=event.dataTransfer?.types.includes('Files'),internal=event.dataTransfer?.types.includes('application/x-labpad-files');if(!external&&!internal)return;event.preventDefault();event.stopPropagation();const folder=file?baseFolder(file.path):'';dropTarget.value=folder;
 const copy=external||(/mac/i.test(navigator.platform)?event.altKey:event.ctrlKey);event.dataTransfer!.dropEffect=copy?'copy':'move';
 if(hoverFolder!==(file?.directory?file.path:'')){clearTimeout(hoverTimer);hoverFolder=file?.directory?file.path:'';if(hoverFolder&&!props.expanded.includes(hoverFolder))hoverTimer=setTimeout(()=>expandParents(hoverFolder),600);}
}
function dragEnd(){dragPaths=[];dropTarget.value=null;clearTimeout(hoverTimer);hoverFolder='';}
function drop(event:DragEvent,file?:WorkspaceFile){event.preventDefault();event.stopPropagation();if(props.disabled)return;const destination=file?baseFolder(file.path):'',text=event.dataTransfer?.getData('application/x-labpad-files');
 if(text){try{const value=JSON.parse(text);if(value.labId!==props.labId){emit('action','crossLabDrop',[]);return;}emit('request',{action:(/mac/i.test(navigator.platform)?event.altKey:event.ctrlKey)?'copy':'move',paths:value.paths,destination});}catch{emit('action','invalidDrop',[]);}}
 else if(event.dataTransfer?.files.length)emit('request',{action:'import',paths:Array.from(event.dataTransfer.files).map(file=>window.labpad.droppedFilePath(file)).filter(Boolean),destination});
 dragEnd();
}
const box=ref<{left:number;top:number;width:number;height:number}>();let boxStart:{x:number;y:number;baseline:string[]}|undefined,suppressClick=false;
function boxMove(event:PointerEvent){if(!boxStart||!itemsHost.value)return;const root=itemsHost.value,r=root.getBoundingClientRect(),x=event.clientX-r.left+root.scrollLeft,y=event.clientY-r.top+root.scrollTop;
 const left=Math.min(x,boxStart.x),top=Math.min(y,boxStart.y),width=Math.abs(x-boxStart.x),height=Math.abs(y-boxStart.y);if(width+height<4)return;
 suppressClick=true;box.value={left,top,width,height};const hits=Array.from(root.querySelectorAll<HTMLElement>('.tree-file')).filter(el=>{const b=el.getBoundingClientRect(),l=b.left-r.left+root.scrollLeft,t=b.top-r.top+root.scrollTop;return l<left+width&&l+b.width>left&&t<top+height&&t+b.height>top;}).map(el=>el.dataset.file!);
 selected.value=[...new Set([...boxStart.baseline,...hits])];if(event.clientY>r.bottom-16)root.scrollTop+=12;else if(event.clientY<r.top+16)root.scrollTop-=12;
}
function boxEnd(){box.value=undefined;boxStart=undefined;window.removeEventListener('pointermove',boxMove);window.removeEventListener('pointerup',boxEnd);}
function boxBegin(event:PointerEvent){if(event.button!==0||props.disabled||(event.target as Element).closest('.tree-file,.tree-inline-edit'))return;const root=itemsHost.value!;const r=root.getBoundingClientRect();boxStart={x:event.clientX-r.left+root.scrollLeft,y:event.clientY-r.top+root.scrollTop,baseline:event.ctrlKey||event.metaKey?[...selected.value]:[]};rootSelected.value=true;window.addEventListener('pointermove',boxMove);window.addEventListener('pointerup',boxEnd,{once:true});}
function contextClosed(event:Event){event.preventDefault();nextTick(()=>{if(edit.value)input.value?.focus();else{const file=selected.value.at(-1);Array.from(host.value?.querySelectorAll<HTMLElement>('.tree-file')??[]).find(row=>row.dataset.file===file)?.focus();}openingMenuEdit=false;});}
function blankClick(){if(suppressClick){suppressClick=false;return;}selected.value=[];rootSelected.value=true;cancel();}
const protectedSelected=computed(()=>props.project&&selected.value.includes('LPMake.txt'));
onBeforeUnmount(()=>{observer?.disconnect();boxEnd();clearTimeout(hoverTimer);});
defineExpose({selectedFolder:()=>baseFolder(),newSource:(language:'c'|'cpp')=>begin('newFile',undefined,language)});
</script>
<template>
 <aside ref="host" class="file-tree" aria-label="文件区">
  <div class="tree-heading"><strong>文件</strong><small v-if="selected.length>1" class="tree-selection-count">{{selected.length}}</small>
   <button title="新建文件" aria-label="新建文件" :disabled="disabled||saving" @click="begin('newFile')"><ActionIcon name="filePlus"/></button>
   <button title="新建文件夹" aria-label="新建文件夹" :disabled="disabled||saving" @click="begin('newFolder')"><ActionIcon name="folderPlus"/></button>
   <button title="刷新文件" aria-label="刷新文件" :disabled="saving" @click="emit('action','refresh',[])"><ActionIcon name="refresh"/></button>
   <button title="折叠全部文件夹" aria-label="折叠全部文件夹" :disabled="saving||!expanded.length" @click="cancel();emit('expand',[])"><ActionIcon name="collapse"/></button>
  </div>
  <ContextMenuRoot><ContextMenuTrigger as-child>
   <div ref="itemsHost" class="tree-items" :class="{'root-drop':dropTarget===''}" @pointerdown="boxBegin" @click="!($event.target as Element).closest('.tree-file,.tree-inline-edit')&&blankClick()" @contextmenu="!($event.target as Element).closest('.tree-file,.tree-inline-edit')&&(rootSelected=true)" @dragover="dragOver($event)" @drop="drop($event)">
    <TreeRoot as="div" class="tree-root" v-model="selection" :items="nodes" :get-key="item=>item.path" :expanded="expanded" @update:expanded="emit('expand',$event)" multiple selection-behavior="replace" :disabled="disabled||saving" @keydown.capture="key">
     <template v-for="row in rows" :key="'file' in row?row.file.path:'@edit'">
      <div v-if="!('file' in row)&&edit" class="tree-inline-edit" :style="{paddingLeft:(10+(row.parent?row.parent.split('/').length:0)*14)+'px'}" @keydown.stop>
       <div class="tree-edit-row"><span class="tree-icon" aria-hidden="true"><ActionIcon :name="edit.directory?'folderPlus':'filePlus'" :size="14"/></span><input :ref="setInput" v-model="edit.name" aria-label="项目内路径" :placeholder="edit.directory?'文件夹名':'文件名'" :disabled="saving" :aria-invalid="!!edit.error" :aria-describedby="edit.error?'tree-edit-error':undefined" @input="edit.error=''" @keydown.enter.prevent="submit" @keydown.esc.prevent="cancel" @contextmenu.stop @blur="blur"></div>
       <label v-if="edit.action==='rename'&&project" class="tree-edit-option"><input v-model="edit.syncReferences" type="checkbox" @blur="blur">同步构建引用</label>
       <p v-if="edit.error" id="tree-edit-error" class="tree-edit-error" :class="{'source-diagnostic':edit.error.startsWith('LPMake.txt:')}" role="alert">{{edit.error}}</p>
      </div>
      <ContextMenuRoot v-else-if="'file' in row"><ContextMenuTrigger as-child>
       <TreeItem :value="row.file" :level="row.file.path.split('/').length" as-child @select="selectRow($event,row.file)" @toggle="($event.detail.originalEvent.ctrlKey||$event.detail.originalEvent.metaKey||$event.detail.originalEvent.shiftKey)&&$event.preventDefault()">
        <button class="tree-file" :data-file="row.file.path" :class="{active:active===row.file.path,cut:cutPaths?.includes(row.file.path),'drop-folder':row.file.directory&&dropTarget===row.file.path}" :style="{paddingLeft:(10+(row.file.path.split('/').length-1)*14)+'px'}" :title="row.file.path" @contextmenu.stop="context(row.file)" :draggable="!disabled&&!saving" @dragstart="dragStart($event,row.file)" @dragend="dragEnd" @dragover="dragOver($event,row.file)" @drop="drop($event,row.file)">
         <span class="tree-icon"><ActionIcon v-if="row.file.directory" name="chevronRight" :size="14" :class="{expanded:expanded.includes(row.file.path)}"/><template v-else>{{row.file.path.split('/').pop()==='LPMake.txt'?'⚙':/\.(c|cpp|cc|cxx|h|hpp)$/i.test(row.file.path)?'C':'·'}}</template></span><span>{{row.file.path.split('/').pop()}}</span>
        </button>
       </TreeItem>
      </ContextMenuTrigger><ContextMenuPortal><ContextMenuContent class="tab-context" :data-theme="theme" @close-auto-focus="contextClosed">
       <ContextMenuItem class="tab-menu-item" @select="menu('open',row.file)">打开</ContextMenuItem>
       <ContextMenuItem v-if="row.file.directory" class="tab-menu-item" @select="menu('newFile',row.file)">新建文件…</ContextMenuItem>
       <ContextMenuItem v-if="row.file.directory" class="tab-menu-item" @select="menu('newFolder',row.file)">新建文件夹…</ContextMenuItem>
       <ContextMenuSeparator class="tab-menu-separator"/>
       <ContextMenuItem class="tab-menu-item" @select="menu('copy',row.file)">复制</ContextMenuItem>
       <ContextMenuItem class="tab-menu-item" :disabled="protectedSelected" @select="menu('cut',row.file)">剪切</ContextMenuItem>
       <ContextMenuItem class="tab-menu-item" :disabled="!canPaste" @select="menu('paste',row.file)">粘贴</ContextMenuItem>
       <ContextMenuItem class="tab-menu-item" :disabled="selected.length!==1||protectedSelected" @select="menu('rename',row.file)">重命名…</ContextMenuItem>
       <ContextMenuSeparator class="tab-menu-separator"/>
       <ContextMenuItem class="tab-menu-item" @select="menu('copyPath',row.file)">复制路径</ContextMenuItem>
       <ContextMenuItem class="tab-menu-item" @select="menu('copyRelative',row.file)">复制相对路径</ContextMenuItem>
       <ContextMenuItem class="tab-menu-item" @select="menu('reveal',row.file)">在文件管理器中显示</ContextMenuItem>
       <ContextMenuSeparator class="tab-menu-separator"/>
       <ContextMenuItem class="tab-menu-item" :disabled="protectedSelected" @select="menu('delete',row.file)">删除…</ContextMenuItem>
      </ContextMenuContent></ContextMenuPortal></ContextMenuRoot>
     </template>
    </TreeRoot>
    <div v-if="box" class="tree-selection-box" :style="{left:box.left+'px',top:box.top+'px',width:box.width+'px',height:box.height+'px'}"></div>
   </div>
  </ContextMenuTrigger><ContextMenuPortal><ContextMenuContent class="tab-context" :data-theme="theme" @close-auto-focus="contextClosed">
   <ContextMenuItem class="tab-menu-item" @select="rootSelected=true;menu('newFile')">新建文件…</ContextMenuItem>
   <ContextMenuItem class="tab-menu-item" @select="rootSelected=true;menu('newFolder')">新建文件夹…</ContextMenuItem>
   <ContextMenuItem class="tab-menu-item" :disabled="!canPaste" @select="rootSelected=true;menu('paste')">粘贴</ContextMenuItem>
   <ContextMenuSeparator class="tab-menu-separator"/>
   <ContextMenuItem class="tab-menu-item" @select="emit('action','refresh',[])">刷新文件</ContextMenuItem>
   <ContextMenuItem class="tab-menu-item" @select="emit('expand',[])">折叠全部文件夹</ContextMenuItem>
   <ContextMenuItem class="tab-menu-item" @select="emit('action','reveal',[])">在文件管理器中显示</ContextMenuItem>
  </ContextMenuContent></ContextMenuPortal></ContextMenuRoot>
 </aside>
</template>
<style>
.file-tree{box-sizing:border-box;display:flex;flex-direction:column;flex-shrink:0;min-width:150px;max-width:420px;background:var(--panel);border-right:1px solid var(--border);overflow:hidden;resize:horizontal;width:190px}
.tree-heading{display:flex;align-items:center;height:36px;gap:1px;padding:0 5px 0 9px;font-size:12px;border-bottom:1px solid var(--border);flex-shrink:0}.tree-heading strong{margin-right:auto}.tree-selection-count{color:var(--muted);font-size:10px;margin-right:2px}
.app-shell[data-theme] .tree-heading button{display:flex;align-items:center;justify-content:center;width:25px;height:26px;padding:3px;border:1px solid transparent;background:transparent;color:var(--secondary);border-radius:4px}
.app-shell[data-theme] .tree-heading button:hover:not(:disabled),.app-shell[data-theme] .tree-heading button:focus-visible{background:var(--raised);border-color:var(--border);color:var(--text)}
.tree-items{overflow:auto;flex:1;min-height:40px;position:relative;user-select:none}.tree-root{min-height:100%;outline:none}.tree-items.root-drop{box-shadow:inset 0 0 0 1px var(--accent)}
.app-shell[data-theme] .tree-file{display:flex;align-items:center;gap:6px;width:100%;border:0;background:transparent;color:var(--text);border-radius:0;padding:6px 10px;text-align:left;font-size:12px;white-space:nowrap}.tree-file>span:last-child{overflow:hidden;text-overflow:ellipsis}
.app-shell[data-theme] .tree-file[data-selected]{background:color-mix(in srgb,var(--accent) 15%,var(--panel))}.app-shell[data-theme] .file-tree:focus-within .tree-file[data-selected]{background:color-mix(in srgb,var(--accent) 24%,var(--panel))}
.tree-file.active{box-shadow:inset 2px 0 var(--accent)}.tree-file:focus-visible{outline:1px solid var(--accent);outline-offset:-1px}.tree-file.cut{opacity:.48}.tree-file.drop-folder{outline:1px solid var(--accent);outline-offset:-1px}
.tree-icon{display:flex;align-items:center;justify-content:center;width:16px;flex-shrink:0;color:var(--muted);font-size:11px}.tree-icon svg.expanded{transform:rotate(90deg)}
.tree-selection-box{position:absolute;pointer-events:none;border:1px solid var(--accent);background:color-mix(in srgb,var(--accent) 14%,transparent);z-index:2}
.tree-inline-edit{padding:3px 8px 3px 10px;font-size:12px}.tree-edit-row{display:flex;align-items:center;gap:6px}.tree-edit-row input{min-width:0;width:100%;padding:3px 4px;font-size:12px;border:1px solid var(--accent);border-radius:0;outline:none;user-select:text}
.tree-edit-row input[aria-invalid=true]{border-color:var(--failure,#f14c4c)}.tree-edit-error{margin:5px 0 0 22px;color:var(--failure,#f14c4c);font-size:11px;overflow-wrap:anywhere}.tree-edit-option{display:flex;align-items:center;gap:4px;font-size:10px;margin:5px 0 0 22px;color:var(--muted)}.tree-edit-option input{width:12px;height:12px;margin:0}
.editor-workspace{display:flex;flex:1;min-height:0;min-width:0;overflow:hidden}.editor-content{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0}.editor-content>.code-editor{flex:1;min-height:0}
</style>
