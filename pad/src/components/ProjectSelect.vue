<script setup lang="ts">
import {ref} from 'vue';
import {DropdownMenuRoot,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem,ContextMenuRoot,ContextMenuTrigger,ContextMenuPortal,ContextMenuContent,ContextMenuItem} from 'reka-ui';
import type {Project} from '../../shared/types';
defineProps<{value:string;projects:Project[];disabled:boolean;theme:string}>();
const emit=defineEmits<{select:[value:string];delete:[value:string]}>(),open=ref(false),contextOpen=ref(false);
function change(value:string){open.value=false;emit('select',value);}
</script>
<template><DropdownMenuRoot :open="open" :modal="false" @update:open="!contextOpen&&(open=$event)">
 <DropdownMenuTrigger role="combobox" aria-label="实验项目" aria-haspopup="listbox" :aria-expanded="open" :data-value="value" :disabled="disabled" class="problem-trigger"><span>{{value||'&lt;无&gt;'}}</span><svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="m3 5 4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></DropdownMenuTrigger>
 <DropdownMenuContent class="problem-options" role="listbox" :data-theme="theme" align="start" :side-offset="5" @focus-outside="contextOpen&&$event.preventDefault()" @interact-outside="contextOpen&&$event.preventDefault()">
 <DropdownMenuItem role="option" :aria-selected="!value" class="problem-option" @select="change('')">&lt;无&gt;</DropdownMenuItem>
 <ContextMenuRoot v-for="p in projects" :key="p.labId" @update:open="contextOpen=$event"><ContextMenuTrigger as-child><DropdownMenuItem role="option" :aria-selected="p.labId===value" class="problem-option" @select="change(p.labId)"><span>{{p.labId}}</span><small>{{p.mode==='project'?'项目':'题集'}}</small></DropdownMenuItem></ContextMenuTrigger><ContextMenuPortal><ContextMenuContent class="tab-context" :data-theme="theme"><ContextMenuItem class="tab-menu-item" @select="open=false;emit('delete',p.labId)">删除项目…</ContextMenuItem></ContextMenuContent></ContextMenuPortal></ContextMenuRoot>
 <DropdownMenuItem role="option" :aria-selected="false" class="problem-option" @select="change('@new:lab')">＋ 新建项目…</DropdownMenuItem>
 </DropdownMenuContent></DropdownMenuRoot></template>
