<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../i18n';

import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent, PopoverClose } from 'reka-ui';
defineProps<{ theme: string }>();
const definitions = computed(() => [
  [
    t('AC · Accepted'),
    t('The program finished normally and its output matches this test case’s comparison rules.'),
  ],
  [
    t('WA · Wrong Answer'),
    t('The output differs from the expected result. Open Diff to compare them.'),
  ],
  [
    t('CE · Compilation Error'),
    t('No executable was produced. Check the compiler diagnostics in Output.'),
  ],
  [t('TLE · Time Limit Exceeded'), t('The program exceeded this problem’s time limit.')],
  [t('RE · Runtime Error'), t('The program crashed or returned a nonzero exit code.')],
  [t('OLE · Output Limit Exceeded'), t('The program exceeded this problem’s output byte limit.')],
]);
</script>
<template>
  <PopoverRoot
    ><PopoverTrigger class="result-help" :aria-label="t('Result Guide')">?</PopoverTrigger
    ><PopoverPortal
      ><PopoverContent
        class="result-help-content"
        :data-theme="theme"
        :collision-padding="12"
        :side-offset="6"
        :aria-label="t('Test Result Guide')"
        ><div class="help-heading">
          <strong>{{ t('Result Guide') }}</strong
          ><PopoverClose :aria-label="t('Close Result Guide')">×</PopoverClose>
        </div>
        <dl>
          <template v-for="[title, body] in definitions" :key="title"
            ><dt>{{ title }}</dt>
            <dd>{{ body }}</dd></template
          >
        </dl></PopoverContent
      ></PopoverPortal
    ></PopoverRoot
  >
</template>
<style>
.result-help {
  font-size: 11px !important;
  min-width: 22px;
  min-height: 22px;
  border-radius: 50% !important;
  padding: 1px 5px !important;
}
.result-help-content {
  z-index: 70;
  max-width: min(360px, 90vw);
  max-height: min(var(--reka-popover-content-available-height), calc(100vh - 24px));
  overflow: auto;
  overscroll-behavior: contain;
  padding: 16px;
  background: var(--panel);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 30px #0005;
  font-size: 12px;
  line-height: 1.6;
}
.help-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.result-help-content dt {
  font-weight: 600;
  margin-top: 10px;
}
.result-help-content dd {
  margin: 2px 0 0;
  color: var(--secondary);
}
</style>
