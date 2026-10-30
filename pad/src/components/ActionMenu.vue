<script setup lang="ts">
import {DropdownMenuRoot,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from 'reka-ui';
defineProps<{label:string;items:{label:string;value:string}[];disabled?:boolean}>();
const emit=defineEmits<{select:[value:string]}>();
</script>
<template>
 <DropdownMenuRoot>
  <DropdownMenuTrigger :disabled="disabled" class="action-menu-trigger"><span>{{label}}</span><svg class="menu-chevron" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" focusable="false"><path d="m3 5 4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></DropdownMenuTrigger>
  <DropdownMenuContent class="action-menu" align="end" :side-offset="6" :collision-padding="8">
   <DropdownMenuItem v-for="item in items" :key="item.value" class="action-menu-item" @select="emit('select',item.value)">{{item.label}}</DropdownMenuItem>
  </DropdownMenuContent>
 </DropdownMenuRoot>
</template>
<style>
.action-menu{min-width:174px;padding:5px;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;box-shadow:0 8px 26px #0005;z-index:40;outline:none}
.action-menu-item{padding:9px 13px;border-radius:3px;font-size:12px;cursor:default;outline:none;user-select:none}
.action-menu-item[data-highlighted]{background:var(--accent);color:#fff}
.action-menu-trigger{display:inline-flex;align-items:center;justify-content:center;gap:8px}
.action-menu-trigger>span{display:block}.menu-chevron{display:block;flex-shrink:0;align-self:center}

.empty-editor-actions{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap}
.app-shell[data-theme] .empty-editor-actions .action-menu-trigger{background:var(--accent);border-color:var(--accent);color:#fff}
</style>
