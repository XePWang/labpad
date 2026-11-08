<script setup lang="ts">
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
    ['cArgs', 'C 参数'],
    ['cppArgs', 'C++ 参数'],
    ['linkArgs', '链接参数'],
  ] as const;
function update(key: (typeof fields)[number][0], value: string) {
  const args = value.split(/\r?\n/).filter(Boolean);
  if (source.value === 'global') props.machine[key] = args;
  else emit('update:options', { ...props.options, [key]: args });
}
const value = ref<BuildPreview>(),
  error = ref(''),
  loading = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined,
  revision = 0;
async function refresh() {
  const id = ++revision;
  loading.value = true;
  try {
    if (!props.workspace)
      for (const [key, label] of fields) {
        const issue = parameterErrors(current.value[key], label)[0];
        if (issue) throw Error(label + '：' + issue.message);
      }
    const next = await props.preview(props.options);
    if (id === revision) {
      value.value = next;
      error.value = '';
    }
  } catch (e) {
    if (id === revision) {
      value.value = undefined;
      error.value = e instanceof Error ? e.message : String(e);
    }
  } finally {
    if (id === revision) loading.value = false;
  }
}
watch(
  () => JSON.stringify([props.machine, props.options, props.workspace]),
  () => {
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 180);
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
      >参数来源<select v-model="source" aria-label="参数来源" :disabled="workspace">
        <option v-if="!workspace" value="global">全局配置（默认）</option>
        <option v-if="lab" value="project">当前实验项目 · {{ lab }}</option>
      </select></label
    >
    <template v-if="workspace"
      ><p>构建参数由 LPMake.txt 管理。</p>
      <button type="button" @click="emit('edit')">编辑构建配置…</button></template
    >
    <template v-else
      ><p>
        {{
          source === 'global'
            ? '保存后，当前题集使用全局参数；已有项目参数保留。'
            : '保存后，当前题集使用本项目参数；全局参数保留。'
        }}每行一个参数。
      </p>
      <div class="field-grid">
        <label v-for="[key, label] in fields" :key="key"
          >{{ label
          }}<textarea
            :value="current[key].join('\n')"
            :aria-label="label"
            rows="5"
            spellcheck="false"
            @input="update(key, ($event.target as HTMLTextAreaElement).value)"
          ></textarea>
        </label></div
    ></template>
    <p v-if="error" class="field-error source-diagnostic" role="alert">{{ error }}</p>
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
