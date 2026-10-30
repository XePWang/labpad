<script setup lang="ts">
import {SelectRoot,SelectTrigger,SelectValue,SelectPortal,SelectContent,SelectViewport,SelectItem,SelectItemText,SelectItemIndicator} from 'reka-ui';
import type {TestState} from '../../shared/types';
defineProps<{value:string;problems:string[];states:Record<string,TestState>;disabled:boolean;canCreate:boolean;theme:string}>();
const emit=defineEmits<{(e:'select',value:string):void}>();
</script>
<template>
 <SelectRoot :model-value="value||'@none'" :disabled="disabled" @update:model-value="emit('select',String($event)==='@none'?'':String($event))">
  <SelectTrigger class="problem-trigger" :data-value="value" aria-label="题号"><SelectValue/><span aria-hidden="true">⌄</span></SelectTrigger>
  <SelectPortal><SelectContent class="problem-options" :data-theme="theme" position="popper" :side-offset="5" :collision-padding="10"><SelectViewport>
   <SelectItem value="@none" class="problem-option"><SelectItemText>&lt;无&gt;</SelectItemText></SelectItem>
   <SelectItem v-for="problem in problems" :key="problem" :value="problem" class="problem-option"><SelectItemText>{{problem}}</SelectItemText><small :data-state="states[problem]||'未测'">{{states[problem]||'未测'}}</small><SelectItemIndicator>✓</SelectItemIndicator></SelectItem>
   <SelectItem value="@new:problem" :disabled="!canCreate" class="problem-option"><SelectItemText>＋ 新建题号…</SelectItemText></SelectItem>
  </SelectViewport></SelectContent></SelectPortal>
 </SelectRoot>
</template>
<style>
.problem-trigger{display:flex;gap:10px;align-items:center;justify-content:space-between;min-width:150px}.problem-trigger>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.problem-options{z-index:50;max-height:min(55vh,420px);min-width:220px;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:4px;box-shadow:0 8px 24px #0005;overflow:auto}
.problem-option{display:flex;align-items:center;gap:14px;justify-content:space-between;padding:9px 10px;cursor:default;font-size:12px;outline:none;border-radius:3px}.problem-option[data-highlighted]{background:var(--raised);outline:1px solid var(--accent);outline-offset:-1px}.problem-option[data-disabled]{opacity:.5}
.problem-option small{margin-left:auto;font-size:11px;color:var(--muted)}.problem-option small[data-state="通过"]{color:var(--success)}.problem-option small[data-state="未通过"]{color:var(--failure)}.problem-option small[data-state="需重测"]{color:var(--warning)}
</style>
