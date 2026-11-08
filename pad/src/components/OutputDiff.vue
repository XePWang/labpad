<script setup lang="ts">
import { t } from '../i18n';

import { computed } from 'vue';
import { outputDiff } from '../editor/output-diff';
const props = defineProps<{ expected: string; actual: string }>();
const view = computed(() => outputDiff(props.expected, props.actual));
</script>
<template>
  <p v-if="view.note" class="muted diff-note" role="status">{{ view.note }}</p>
  <pre
    class="diff-view"
  ><template v-for="(part,i) in view.parts" :key="i"><span :class="{added:part.added,removed:part.removed}">{{(part.added||part.removed)?part.value.replace(/ /g,'·').replace(/\t/g,'→').replace(/\r/g,'␍').replace(/\n/g,'↵\n'):part.value}}</span></template><span v-if="!view.parts.length" class="muted">{{t('(empty output)')}}</span></pre>
</template>
