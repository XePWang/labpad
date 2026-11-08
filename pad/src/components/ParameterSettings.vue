<script setup lang="ts">
import { t, uiLanguage, errorText, type UIText } from '../i18n';

import { computed, ref, watch, onBeforeUnmount } from 'vue';
import ParameterPreview from './ParameterPreview.vue';
import type { CompilerConfig } from '../../shared/types';
import type { ProjectBuildOptions } from '../../shared/workspace';
import type { BuildPreview } from '../../core/build/plan';
import { parameterErrors } from '../../shared/parameters';
const props = defineProps<{
    lab: string;
    workspace: boolean;
    machine: CompilerConfig;
    options: ProjectBuildOptions;
    configured: boolean;
    preview: (options: ProjectBuildOptions) => Promise<BuildPreview>;
  }>(),
  emit = defineEmits<{
    'update:options': [value: ProjectBuildOptions];
    'update:configured': [value: boolean];
    edit: [];
  }>();
const source = computed({
  get: () => (props.workspace || !props.options.inheritDefaults ? 'project' : 'global'),
  set: (value) => {
    const options =
      !props.configured && value === 'project'
        ? {
            inheritDefaults: false,
            cArgs: [...props.machine.cArgs],
            cppArgs: [...props.machine.cppArgs],
            linkArgs: [...props.machine.linkArgs],
          }
        : { ...props.options, inheritDefaults: value === 'global' };
    if (value === 'project') emit('update:configured', true);
    emit('update:options', options);
  },
});
const current = computed(() => (source.value === 'global' ? props.machine : props.options)),
  fields = [
    ['cArgs', 'C Arguments'],
    ['cppArgs', 'C++ Arguments'],
    ['linkArgs', 'Linker Arguments'],
  ] as const;
function update(key: (typeof fields)[number][0], value: string) {
  const args = value.split(/\r?\n/).filter(Boolean);
  if (source.value === 'global') props.machine[key] = args;
  else emit('update:options', { ...props.options, [key]: args });
}
const value = ref<BuildPreview>(),
  error = ref<UIText>(''),
  loading = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined,
  revision = 0;
async function refresh(id: number) {
  loading.value = true;
  try {
    if (!props.workspace)
      for (const [key, label] of fields) {
        const issue = parameterErrors(current.value[key], t(label))[0];
        if (issue) throw Error(t(label) + ': ' + issue.message);
      }
    const next = await props.preview(props.options);
    if (id === revision) {
      value.value = next;
      error.value = '';
    }
  } catch (e) {
    if (id === revision) {
      value.value = undefined;
      error.value = errorText(e);
    }
  } finally {
    if (id === revision) loading.value = false;
  }
}
watch(
  () => JSON.stringify([props.machine, props.options, props.workspace, uiLanguage.value]),
  () => {
    clearTimeout(timer);
    const id = ++revision;
    value.value = undefined;
    loading.value = true;
    timer = setTimeout(() => void refresh(id), 180);
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  clearTimeout(timer);
  revision++;
});
</script>
<template>
  <div class="parameter-settings">
    <label
      >{{ t('Argument Source')
      }}<select
        v-model="source"
        :aria-label="t('Argument Source')"
        data-parameter-source
        :disabled="workspace"
      >
        <option v-if="!workspace" value="global">{{ t('Global Defaults') }}</option>
        <option v-if="lab" value="project">{{ t('Current Experiment ·') }}{{ lab }}</option>
      </select></label
    >
    <template v-if="workspace"
      ><p>{{ t('Build arguments are managed by LPMake.txt.') }}</p>
      <button type="button" @click="emit('edit')">
        {{ t('Edit Build Configuration…') }}
      </button></template
    >
    <template v-else
      ><p>
        {{
          source === 'global'
            ? t(
                'Saving switches this problem set to global arguments and keeps its project arguments.',
              )
            : t('Saving switches this problem set to its own arguments and keeps global defaults.')
        }}{{ t('One argument per line.') }}
      </p>
      <div class="field-grid">
        <label v-for="[key, label] in fields" :key="key"
          >{{ t(label)
          }}<textarea
            :value="current[key].join('\n')"
            :aria-label="t(label)"
            rows="5"
            spellcheck="false"
            @input="update(key, ($event.target as HTMLTextAreaElement).value)"
          ></textarea>
        </label></div
    ></template>
    <p v-if="error" class="field-error source-diagnostic" role="alert">{{ t(error) }}</p>
    <ParameterPreview :value="value" :loading="loading" />
  </div>
</template>
<style>
.parameter-settings {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.parameter-settings > label {
  max-width: 420px;
}
.parameter-settings > button {
  align-self: flex-start;
}
</style>
