<script setup lang="ts">
import {computed} from 'vue';
import {diffWordsWithSpace} from 'diff';
const props=defineProps<{expected:string;actual:string}>();
const parts=computed(()=>diffWordsWithSpace(props.expected,props.actual));
</script>
<template><pre class="diff-view"><template v-for="(part,i) in parts" :key="i"><span :class="{added:part.added,removed:part.removed}">{{(part.added||part.removed)?part.value.replace(/ /g,'·').replace(/\t/g,'→').replace(/\r/g,'␍').replace(/\n/g,'↵\n'):part.value}}</span></template><span v-if="!parts.length" class="muted">（空输出）</span></pre></template>
