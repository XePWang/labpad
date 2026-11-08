<script setup lang="ts">
import { errorText } from '../i18n';
import { t } from '../i18n';

import { ref, watch, onBeforeUnmount } from 'vue';
import type { DebugVariable } from '../../shared/debug';
import ActionIcon from './ActionIcon.vue';
const props = defineProps<{
  values: DebugVariable[];
  enabled: boolean;
  context?: string;
  inspectionId?: string;
}>();
const expanded = ref<Record<number, DebugVariable[]>>({}),
  errors = ref<Record<number, string>>({}),
  loading = ref<Record<number, boolean>>({});
let epoch = 0;
watch(
  () => [props.context, props.inspectionId, props.values, props.enabled],
  () => {
    epoch++;
    expanded.value = {};
    errors.value = {};
    loading.value = {};
  },
  { flush: 'sync' },
);
onBeforeUnmount(() => {
  epoch++;
});
async function toggle(value: DebugVariable) {
  const id = value.variablesReference;
  if (expanded.value[id]) {
    delete expanded.value[id];
    return;
  }
  await more(value, 0);
}
async function more(value: DebugVariable, start: number) {
  if (!props.enabled || loading.value[value.variablesReference]) return;
  const id = value.variablesReference,
    request = epoch;
  loading.value[id] = true;
  delete errors.value[id];
  try {
    const list = await window.labpad.nativeVariables(id, start, props.inspectionId);
    if (request === epoch && props.enabled)
      expanded.value[id] = start ? [...(expanded.value[id] ?? []), ...list] : list;
  } catch (error) {
    if (request === epoch && props.enabled) errors.value[id] = t(errorText(error));
  } finally {
    if (request === epoch) loading.value[id] = false;
  }
}
</script>
<template>
  <ul class="debug-variable-list">
    <li v-for="(value, index) in values" :key="value.name + index">
      <div class="debug-variable-row">
        <button
          class="debug-expander icon-action"
          :aria-label="
            t(expanded[value.variablesReference] ? 'Collapse {0}' : 'Expand {0}', value.name)
          "
          :disabled="!enabled || !value.variablesReference || loading[value.variablesReference]"
          @click="toggle(value)"
        >
          <ActionIcon
            name="chevronRight"
            :size="12"
            :class="{ expanded: expanded[value.variablesReference] }"
          /></button
        ><code class="debug-variable-name" :title="value.type">{{ value.name }}</code
        ><span class="debug-variable-value" :title="value.value">{{ value.value }}</span>
      </div>
      <p v-if="errors[value.variablesReference]" class="field-error">
        {{ errors[value.variablesReference] }}
      </p>
      <template v-if="expanded[value.variablesReference]"
        ><DebugVariables
          :values="expanded[value.variablesReference]"
          :enabled="enabled"
          :context="context"
          :inspection-id="inspectionId"
        /><button
          v-if="
            expanded[value.variablesReference].length <
            (value.indexedVariables ?? value.namedVariables ?? 0)
          "
          :disabled="loading[value.variablesReference]"
          @click="more(value, expanded[value.variablesReference].length)"
        >
          {{ t('Show More') }}
        </button></template
      >
    </li>
  </ul>
</template>
<style>
.debug-variable-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.debug-variable-list .debug-variable-list {
  padding-left: 14px;
}
.debug-variable-row {
  display: flex;
  align-items: baseline;
  min-width: 0;
  gap: 5px;
  padding: 3px 0;
  font:
    12px/1.5 Consolas,
    monospace;
}
.debug-expander {
  align-self: center;
  padding: 0;
  width: 16px !important;
  height: 18px !important;
  flex: none;
}
.debug-expander:disabled {
  visibility: hidden;
}
.debug-expander svg.expanded {
  transform: rotate(90deg);
}
.debug-variable-name {
  color: var(--text);
  flex: none;
}
.debug-variable-value {
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.debug-variable-row > .debug-variable-value::before {
  content: ': ';
  color: var(--muted);
}
</style>
