<script setup lang="ts">
import {nextTick,watch,ref} from 'vue';
import {ContextMenuRoot,ContextMenuTrigger,ContextMenuPortal,ContextMenuContent,ContextMenuItem,ContextMenuSeparator} from 'reka-ui';
const props=defineProps<{tabs:{id:string;name:string;path:string;dirty:boolean;status:string}[];active:string;disabled:boolean;theme:string;formatVisible:boolean;formatting:boolean}>();
const emit=defineEmits<{(e:'activate',id:string):void;(e:'action',value:string,id:string):void;(e:'browse'):void;(e:'format'):void}>();
const row=ref<HTMLElement>();
watch(()=>props.active,()=>nextTick(()=>row.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest',inline:'nearest'})));
const items=[['close','关闭'],['others','关闭其他'],['right','关闭右侧标签页'],['saved','关闭已保存'],['all','全部关闭'],['version','另存为新版本'],['copyPath','复制路径'],['copyRelativePath','复制相对路径']];
</script>
<template>
 <div class="source-strip"><div ref="row" class="source-tabs" role="tablist" aria-label="源码标签" @pointerenter="emit('browse')" @focusin="emit('browse')">
  <ContextMenuRoot v-for="tab in tabs" :key="tab.id">
   <ContextMenuTrigger as-child :disabled="disabled"><div class="source-tab" :class="{active:tab.id===active}" :title="tab.path" role="tab" :aria-selected="tab.id===active" :tabindex="tab.id===active?0:-1" @click="!disabled&&emit('activate',tab.id)" @keydown.enter.prevent="!disabled&&emit('activate',tab.id)" @keydown.space.prevent="!disabled&&emit('activate',tab.id)" @keydown.right.prevent="!disabled&&emit('activate',tabs[(tabs.findIndex(t=>t.id===active)+1)%tabs.length].id)" @keydown.left.prevent="!disabled&&emit('activate',tabs[(tabs.findIndex(t=>t.id===active)-1+tabs.length)%tabs.length].id)">
    <span class="file-icon">{{tab.name.endsWith('.cpp')?'C++':'C'}}</span><span>{{tab.name}}</span><span v-if="tab.dirty" class="tab-dirty" aria-label="未保存">●</span><span v-if="tab.id===active" class="sr-only save-status" aria-live="polite">{{tab.status}}</span><button :aria-label="'关闭 '+tab.name" :disabled="disabled" @click.stop="emit('action','close',tab.id)">×</button>
   </div></ContextMenuTrigger>
   <ContextMenuPortal><ContextMenuContent class="tab-context" :data-theme="theme" :collision-padding="8"><template v-for="([id,label],i) in items" :key="id"><ContextMenuSeparator v-if="i===5||i===6" class="tab-menu-separator"/><ContextMenuItem class="tab-menu-item" :disabled="disabled" @select="emit('action',id,tab.id)">{{label}}</ContextMenuItem></template></ContextMenuContent></ContextMenuPortal>
  </ContextMenuRoot>
 </div><div class="tab-format" :class="{visible:formatVisible}"><button class="format-button" :disabled="disabled||formatting" @click="emit('format')">{{formatting?'格式化中…':'格式化代码'}}</button></div></div>
</template>
<style>
.source-strip{display:flex;align-items:stretch;flex-shrink:0;min-height:36px;background:var(--panel);border-bottom:1px solid var(--border)}.source-tabs{flex:1;min-width:0;display:flex;flex-shrink:0;overflow-x:auto;min-height:36px;max-width:100%;border-bottom:1px solid var(--line,#333);background:var(--panel,#252526);scrollbar-width:thin}
.source-tab{display:flex;align-items:center;gap:8px;padding:5px 8px 5px 12px;flex-shrink:0;min-width:100px;max-width:240px;border-right:1px solid var(--line,#333);cursor:pointer;font-size:12px;color:var(--muted,#999);border-top:2px solid transparent}
.source-tab.active{background:var(--editor,#1e1e1e);color:var(--text,#ddd);border-top-color:#007acc}.source-tab>span:nth-child(2){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.source-tab button{border:0;background:transparent;padding:0 4px;font-size:17px;color:inherit;border-radius:3px}.source-tab button:hover{background:#8883}.tab-dirty{font-size:8px;color:#a8c9be}
.tab-context{min-width:200px;background:var(--panel,#252526);color:var(--text,#ddd);padding:5px;border:1px solid var(--line,#454545);border-radius:6px;box-shadow:0 6px 22px #0006;z-index:60}.tab-menu-item{padding:7px 20px;border-radius:4px;font-size:12px;outline:none;cursor:default}.tab-menu-item[data-highlighted]{background:#007acc;color:white}.tab-menu-separator{height:1px;background:#7775;margin:5px}.editor-heading{height:34px}.editor-empty{display:flex;flex:1;align-items:center;justify-content:center;flex-direction:column;gap:12px}.cache-controls{display:flex;gap:12px;align-items:center;margin-top:16px;font-size:11px}.editor-pane{overflow:hidden}.toolbar{flex-shrink:0}
.tab-format{display:flex;align-items:center;flex-shrink:0;padding:0 10px;opacity:0;transform:translateY(-3px);transition:opacity .14s,transform .14s;pointer-events:none}.tab-format.visible,.tab-format:focus-within{opacity:1;transform:none;pointer-events:auto}.tab-format button{font-size:11px;padding:4px 8px}.sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(prefers-reduced-motion:reduce){.tab-format{transition:none;transform:none}}
</style>
