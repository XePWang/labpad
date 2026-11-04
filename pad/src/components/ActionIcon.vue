<script setup lang="ts">
defineProps<{name:string;size?:number}>();
const paths:Record<string,string[]>={
 build:['M6.2 2.5 9 5.3 7.2 7.1 4.4 4.3 6.2 2.5Z','m8.2 6.1 4.6 4.6a1.2 1.2 0 0 1-1.7 1.7L6.5 7.8','m3 13 3.2-3.2'],
 play:['M5 3.5 12.5 8 5 12.5V3.5Z'],pause:['M5.5 3.5v9m5-9v9'],stop:['M4.5 4.5h7v7h-7v-7Z'],
 next:['m3 4 5 4-5 4V4Z','M11.5 3v10'],stepIn:['M8 2.5v6m-3-3 3 3 3-3','M3 12.5h10'],stepOut:['M8 9V2.5m-3 3 3-3 3 3','M3 12.5h10'],
 restart:['M12.4 6A4.8 4.8 0 1 0 13 9','M12.7 2.8v3.5H9.2'],
 refresh:['M12.4 5.5A4.8 4.8 0 1 0 12.8 9','M12.8 2.5v3.5H9.3'],
 filePlus:['M4 2.5h5l3 3v8H4v-11Z','M9 2.5v3h3','M8 7.5v4m-2-2h4'],
 folderPlus:['M2 4h4l1.5 1.5H14v7H2V4Z','M8 7v4m-2-2h4'],
 collapse:['M5 2.5h8v8','M2.5 5.5h8v8h-8v-8Z','M5 9.5h3'],
 chevronLeft:['m10 3.5-4.5 4.5 4.5 4.5'],chevronRight:['m6 3.5 4.5 4.5-4.5 4.5'],
 plus:['M8 3v10M3 8h10'],more:['M3 8h.1M8 8h.1M13 8h.1'],breakpoint:['M8 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z'],
 check:['m3.5 8 3 3 6-6']
};
</script>
<template><svg :width="size||16" :height="size||16" viewBox="0 0 16 16" fill="none" aria-hidden="true" class="action-icon"><path v-for="(d,i) in paths[name]||paths.more" :key="i" :d="d" :fill="name==='play'?'currentColor':'none'" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></template>
<style>.action-icon{display:block;flex-shrink:0;pointer-events:none}</style>
