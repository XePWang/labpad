<script setup lang="ts">
import { errorText } from '../i18n';
import { t } from '../i18n';

import { ref, watch, computed, onBeforeUnmount } from 'vue';
import type { NativeDebugState, SourceBreakpoint, DebugVariable } from '../../shared/debug';
import DebugVariables from './DebugVariables.vue';
import ActionIcon from './ActionIcon.vue';
const props = defineProps<{
  state: NativeDebugState;
  breakpoints: SourceBreakpoint[];
  watches: string[];
  changed: boolean;
  busy: boolean;
}>();
const emit = defineEmits<{
  start: [];
  build: [];
  frame: [id: number];
  location: [path: string, line: number];
  breakpoints: [values: SourceBreakpoint[]];
  condition: [path: string, line: number];
  watches: [values: string[]];
}>();
const expression = ref(''),
  watchValues = ref<DebugVariable[]>([]),
  watchErrors = ref<Record<string, string>>({}),
  selectedScope = ref(0),
  scopeVariables = ref<DebugVariable[]>([]),
  scopeError = ref('');
const paused = computed(() => props.state.status === 'paused');
const inspectionContext = computed(
  () =>
    props.state.inspectionId ??
    [props.state.scope, props.state.status, props.state.selectedFrameId].join(':'),
);
let watchEpoch = 0,
  scopeEpoch = 0;
onBeforeUnmount(() => {
  watchEpoch++;
  scopeEpoch++;
});
watch(
  () => [props.state.status, inspectionContext.value, props.watches] as const,
  async () => {
    const epoch = ++watchEpoch;
    watchValues.value = [];
    watchErrors.value = {};
    if (!paused.value) return;
    for (const text of props.watches) {
      try {
        const value = await window.labpad.nativeWatch(text, props.state.inspectionId);
        if (epoch !== watchEpoch) return;
        watchValues.value.push(value);
      } catch (e) {
        if (epoch !== watchEpoch) return;
        watchErrors.value[text] = t(errorText(e));
      }
    }
  },
  { deep: true, immediate: true, flush: 'sync' },
);
watch(
  () => [inspectionContext.value, props.state.scopes, props.state.variables],
  () => {
    scopeEpoch++;
    scopeError.value = '';
    selectedScope.value =
      props.state.scopes.find((s) => !s.expensive)?.variablesReference ??
      props.state.scopes[0]?.variablesReference ??
      0;
    scopeVariables.value = props.state.variables;
  },
  { immediate: true, flush: 'sync' },
);
async function changeScope() {
  const epoch = ++scopeEpoch,
    inspection = inspectionContext.value;
  const scope = selectedScope.value;
  const current = () =>
    epoch === scopeEpoch &&
    paused.value &&
    inspection === inspectionContext.value &&
    scope === selectedScope.value;
  scopeVariables.value = [];
  scopeError.value = '';
  try {
    const values = await window.labpad.nativeVariables(scope, 0, props.state.inspectionId);
    if (current()) scopeVariables.value = values;
  } catch (error) {
    if (current()) scopeError.value = t(errorText(error));
  }
}
function addWatch() {
  const text = expression.value.trim();
  if (!text || props.watches.includes(text)) return;
  emit('watches', [...props.watches, text]);
  expression.value = '';
}
function toggle(index: number) {
  emit(
    'breakpoints',
    props.breakpoints.map((b, i) => (i === index ? { ...b, enabled: !b.enabled } : b)),
  );
}
</script>
<template>
  <div class="native-debug-panel">
    <div v-if="changed" class="debug-source-changed" role="status">
      {{
        t(
          'The source has changed since this debug session started. Click Restart to recompile and debug.',
        )
      }}
    </div>
    <div v-if="['idle', 'ended', 'error'].includes(state.status)" class="native-debug-empty">
      <p>
        {{
          state.status === 'error'
            ? t('Debugging could not continue. Check Output or Build Settings.')
            : state.status === 'ended'
              ? t('The debug session has ended.')
              : t('Set breakpoints beside the line numbers and step through your program.')
        }}
      </p>
    </div>
    <div
      v-if="state.message"
      class="native-state-message"
      :class="{ error: state.status === 'error' }"
    >
      {{
        ['breakpoint', 'step', 'pause', 'entry', 'exception'].includes(state.message)
          ? t(state.message)
          : state.message
      }}
    </div>
    <details open>
      <summary>
        {{ t('Variables')
        }}<select
          v-if="state.scopes.length > 1"
          v-model="selectedScope"
          :aria-label="t('Variable Scope')"
          :disabled="!paused"
          @click.stop
          @change="changeScope"
        >
          <option v-for="scope in state.scopes" :value="scope.variablesReference">
            {{
              ['Locals', 'Globals', 'Registers', 'Arguments'].includes(scope.name)
                ? t(scope.name)
                : scope.name
            }}
          </option>
        </select>
      </summary>
      <DebugVariables
        v-if="paused"
        :values="scopeVariables"
        :enabled="paused"
        :context="inspectionContext + ':' + selectedScope"
        :inspection-id="state.inspectionId"
      />
      <p v-else class="debug-placeholder">{{ t('Pause to inspect variables.') }}</p>
      <p v-if="scopeError" class="field-error">{{ scopeError }}</p>
    </details>
    <details open>
      <summary>{{ t('Watch') }}</summary>
      <form class="debug-watch-form" @submit.prevent="addWatch">
        <input
          v-model="expression"
          :aria-label="t('Watch Expression')"
          :placeholder="t('Variable or read-only expression')"
          maxlength="1024"
        /><button class="icon-action" :aria-label="t('Add Watch')" :disabled="!expression.trim()">
          <ActionIcon name="plus" />
        </button>
      </form>
      <div v-for="text in watches" :key="text" class="debug-watch">
        <DebugVariables
          :values="watchValues.filter((v) => v.name === text)"
          :enabled="paused"
          :context="inspectionContext"
          :inspection-id="state.inspectionId"
        /><code v-if="!watchValues.some((v) => v.name === text)">{{ text }}</code
        ><button
          class="icon-action"
          :aria-label="t('Remove Watch {0}', text)"
          @click="
            emit(
              'watches',
              watches.filter((w) => w !== text),
            )
          "
        >
          ×
        </button>
        <p v-if="watchErrors[text]" class="field-error">{{ watchErrors[text] }}</p>
      </div>
    </details>
    <details open>
      <summary>{{ t('Call Stack') }}</summary>
      <p v-if="!state.frames.length" class="debug-placeholder">
        {{ t('Pause to inspect the call stack.') }}
      </p>
      <button
        v-for="frame in state.frames"
        :key="frame.id"
        class="debug-stack-frame"
        :class="{ selected: frame.id === state.selectedFrameId }"
        @click="emit('frame', frame.id)"
      >
        <strong>{{ frame.name }}</strong
        ><span>{{ frame.path?.split('/').pop() || t('(external code)') }}:{{ frame.line }}</span>
      </button>
    </details>
    <details open>
      <summary>
        {{ t('Breakpoints') }}<span class="counter">{{ breakpoints.length }}</span>
      </summary>
      <p v-if="!breakpoints.length" class="debug-placeholder">
        {{ t('Click beside a line number to add a breakpoint. Right-click to set a condition.') }}
      </p>
      <div
        v-for="(point, index) in breakpoints"
        :key="point.path + ':' + point.line"
        class="debug-breakpoint"
      >
        <input
          type="checkbox"
          :checked="point.enabled"
          :aria-label="t('Enable Breakpoint {0}:{1}', point.path, point.line)"
          @change="toggle(index)"
        /><button
          class="debug-breakpoint-location"
          :title="point.message || point.path"
          @click="emit('location', point.path, point.line)"
        >
          <span
            :class="[
              'source-breakpoint',
              point.enabled ? (point.verified ? 'verified' : 'pending') : 'disabled',
              { conditional: point.condition },
            ]"
          ></span
          >{{ point.path }}:{{ point.line
          }}<small>{{
            point.condition || (point.verified ? t('Verified') : t('Unverified'))
          }}</small></button
        ><button
          class="icon-action"
          :title="t('Edit Condition')"
          :aria-label="t('Edit Breakpoint Condition')"
          @click="emit('condition', point.path, point.line)"
        >
          …</button
        ><button
          class="icon-action"
          :aria-label="t('Remove Breakpoint')"
          @click="
            emit(
              'breakpoints',
              breakpoints.filter((_, i) => i !== index),
            )
          "
        >
          ×
        </button>
        <p v-if="point.message" class="debug-breakpoint-message">{{ point.message }}</p>
      </div>
    </details>
  </div>
</template>
<style>
.native-debug-panel {
  flex: 1;
  overflow: auto;
  padding: 8px 10px;
  font-size: 12px;
}
.native-debug-panel details {
  border-bottom: 1px solid var(--border);
  padding: 6px 0;
}
.native-debug-panel summary {
  cursor: pointer;
  font-weight: 600;
  padding: 5px 2px;
}
.native-debug-panel summary select {
  float: right;
  max-width: 60%;
  padding: 0 4px;
  font-size: 11px;
}
.native-debug-panel p {
  line-height: 1.6;
}
.debug-placeholder {
  color: var(--muted);
  padding: 0 8px;
}
.native-debug-empty {
  padding: 8px;
}
.native-debug-empty button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-right: 6px;
}
.debug-watch-form {
  display: flex;
  gap: 4px;
}
.debug-watch-form input {
  min-width: 0;
  flex: 1;
  font:
    12px Consolas,
    monospace;
  padding: 5px 7px;
}
.debug-watch {
  position: relative;
  padding-right: 22px;
  min-height: 25px;
}
.debug-watch > .icon-action {
  position: absolute;
  right: 0;
  top: 0;
}
.debug-stack-frame {
  border: 0;
  background: transparent;
  display: flex;
  width: 100%;
  text-align: left;
  gap: 6px;
  padding: 5px 8px;
}
.debug-stack-frame strong {
  font-weight: 400;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.debug-stack-frame span {
  color: var(--muted);
  margin-left: auto;
  white-space: nowrap;
}
.debug-stack-frame.selected {
  background: var(--input);
}
.debug-breakpoint {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding: 3px 0;
}
.debug-breakpoint-location {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 0;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
}
.debug-breakpoint-location small {
  color: var(--muted);
  margin-left: auto;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.debug-breakpoint-message {
  width: 100%;
  margin: 0 0 3px 23px;
  color: var(--muted);
}
.debug-source-changed {
  padding: 9px;
  border-left: 2px solid var(--warning);
  background: color-mix(in srgb, var(--warning) 9%, transparent);
  line-height: 1.6;
}
.native-state-message {
  padding: 6px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--muted);
}
</style>
