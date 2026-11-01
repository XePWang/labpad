<script setup lang="ts">
import {ref,watch} from 'vue';
const props=defineProps<{warnings:number;errors:number;revision:number}>();
const pulse=ref(0);watch(()=>props.revision,()=>pulse.value++);
</script>
<template><span class="diagnostic-counts" aria-label="编译诊断"><span :key="'w'+pulse" class="diagnostic-count" :class="{warning:warnings>0,refresh:pulse>0}" :aria-label="'警告 '+warnings" title="本次编译警告"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.7 3.3 2.1 15a1.5 1.5 0 0 0 1.3 2.2h13.2A1.5 1.5 0 0 0 18 15L11.3 3.3a1.5 1.5 0 0 0-2.6 0Z"/><path d="M10 7v4.5m0 2.5v.1"/></svg><span>{{warnings}}</span></span><span :key="'e'+pulse" class="diagnostic-count" :class="{'diagnostic-error':errors>0,refresh:pulse>0}" :aria-label="'错误 '+errors" title="本次编译错误"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="m7.3 7.3 5.4 5.4m0-5.4-5.4 5.4"/></svg><span>{{errors}}</span></span></span></template>
<style>
.diagnostic-counts{display:inline-flex;align-items:center;gap:14px;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}.diagnostic-count{display:inline-flex;gap:5px;align-items:center;background:transparent;border-radius:3px}.diagnostic-count svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.diagnostic-count.warning{color:var(--diagnostic-warning)}.diagnostic-count.diagnostic-error{color:var(--diagnostic-error)}.diagnostic-count.refresh{animation:diagnostic-refresh .65s ease-out}
@keyframes diagnostic-refresh{0%{opacity:.35;filter:brightness(1.5)}45%{opacity:1;filter:brightness(1.15)}100%{opacity:1;filter:brightness(1)}}
@media(prefers-reduced-motion:reduce){.diagnostic-count.refresh{animation:none}}
</style>
