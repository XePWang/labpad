<script setup lang="ts">
import DialogActions from './DialogActions';
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { DialogRoot, DialogContent, DialogTitle } from 'reka-ui';
import ParameterPreview from './ParameterPreview.vue';
import type { BuildPreview } from '../../core/build/plan';
import { parse, editSingle, editList, type Command } from '../../shared/lpmake';
const props = defineProps<{
    source: string;
    revision: number;
    lab: string;
    compilerLabel: string;
    conflict?: string;
    preview: (source: string) => Promise<BuildPreview>;
  }>(),
  emit = defineEmits<{ apply: [text: string, revision: number]; close: [] }>();
const error = ref(''),
  original = props.source,
  version = props.revision,
  previewValue = ref<BuildPreview>(),
  previewBusy = ref(false),
  applying = ref(false);
let initial: ReturnType<typeof parse> | undefined;
try {
  initial = parse(original);
} catch (e) {
  error.value = String(e);
}
const target = ref(initial?.spec.target ?? ''),
  language = ref(initial?.spec.language === 'cpp' ? 'c++' : (initial?.spec.language ?? '')),
  cStandard = ref(initial?.spec.standards.c ?? ''),
  cppStandard = ref(initial?.spec.standards.cpp ?? ''),
  mode = ref(initial?.calls.some((c) => c.name === 'set_mode') ? initial.spec.mode : ''),
  optimize = ref(initial?.spec.optimize ?? '');
const lists: { command: Command; label: string; value: string }[] = initial
  ? [
      ['add_files', '源文件 / Glob', initial.spec.sources],
      ['remove_files', '排除文件', initial.spec.exclude],
      ['add_includedirs', '包含目录', initial.spec.includeDirs],
      ['add_defines', '宏定义', initial.spec.defines],
      ['add_linkdirs', '库目录', initial.spec.linkDirs],
      ['add_links', '链接库', initial.spec.links],
      ['add_cflags', 'C 参数', initial.spec.cflags],
      ['add_cxxflags', 'C++ 参数', initial.spec.cxxflags],
      ['add_ldflags', '链接参数', initial.spec.ldflags],
    ].map(([command, label, values]) => ({
      command: command as Command,
      label: label as string,
      value: (values as string[]).join('\n'),
    }))
  : [];
const fields = ref(lists),
  valid = computed(() => !!initial);
function currentText() {
  let text = editSingle(original, 'target', target.value);
  text = editSingle(text, 'set_language', language.value || undefined);
  text = editSingle(text, 'set_standard', cStandard.value || undefined, 'c');
  text = editSingle(text, 'set_standard', cppStandard.value || undefined, 'cpp');
  text = editSingle(text, 'set_mode', mode.value || undefined);
  text = editSingle(text, 'set_optimize', optimize.value || undefined);
  for (const field of fields.value)
    text = editList(text, field.command, field.value.split(/\r?\n/).filter(Boolean));
  parse(text);
  return text;
}
let timer: ReturnType<typeof setTimeout> | undefined,
  request = 0;
async function refresh() {
  const id = ++request;
  previewBusy.value = true;
  try {
    const value = await props.preview(currentText());
    if (id === request) {
      previewValue.value = value;
      error.value = '';
    }
  } catch (e) {
    if (id === request) {
      previewValue.value = undefined;
      error.value = e instanceof Error ? e.message : String(e);
    }
  } finally {
    if (id === request) previewBusy.value = false;
  }
}
watch(
  () =>
    JSON.stringify([
      target.value,
      language.value,
      cStandard.value,
      cppStandard.value,
      mode.value,
      optimize.value,
      fields.value,
    ]),
  () => {
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 180);
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  clearTimeout(timer);
  request++;
});
async function apply() {
  if (applying.value) return;
  applying.value = true;
  try {
    const text = currentText();
    await props.preview(text);
    emit('apply', text, version);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    applying.value = false;
  }
}
function notes(field: string) {
  return previewValue.value?.issues.filter((i) => i.field === field) ?? [];
}
const fieldKey = (command: string) =>
  command === 'add_cflags'
    ? 'c'
    : command === 'add_cxxflags'
      ? 'cpp'
      : command === 'add_ldflags'
        ? 'link'
        : command;
function fallback(language: 'c' | 'cpp') {
  return (
    previewValue.value?.units.find((u) => u.language === language)?.summary.standard ??
    (language === 'c' ? 'c17' : 'c++20')
  );
}
</script>
<template>
  <DialogRoot :open="true" @update:open="!$event && !applying && emit('close')"
    ><div class="modal-backdrop">
      <DialogContent as-child @close-auto-focus.prevent @interact-outside.prevent
        ><section
          class="build-settings"
          @keydown.esc.stop.prevent="!applying && emit('close')"
          role="dialog"
          aria-modal="true"
          aria-label="项目构建设置"
        >
          <DialogTitle as-child
            ><h2>构建设置 · {{ lab }}</h2></DialogTitle
          >
          <p>{{ compilerLabel }} · 修改应用到 LPMake 标签，保存该标签或保存全部后落盘。</p>
          <fieldset class="build-inputs" :disabled="applying">
            <p
              v-if="error || conflict"
              class="field-error"
              :class="{ 'source-diagnostic': error.startsWith('LPMake.txt:') }"
              role="alert"
            >
              {{ conflict || error }}
            </p>
            <div v-if="valid" class="build-settings-fields">
              <div class="field-grid two">
                <label
                  >编译语言<select v-model="language">
                    <option value="">按文件扩展名</option>
                    <option value="c">C（覆盖扩展名）</option>
                    <option value="c++">C++（覆盖扩展名）</option>
                  </select></label
                >
                <label
                  >构建模式<select v-model="mode">
                    <option value="">默认 · debug</option>
                    <option value="debug">debug</option>
                    <option value="release">release</option></select
                  ><small v-for="i in notes('mode')" :key="i.message" class="parameter-note">{{
                    i.message
                  }}</small></label
                >
                <label
                  >C 标准<input
                    v-model="cStandard"
                    :placeholder="'默认 · ' + fallback('c')"
                  /><small
                    v-for="i in notes('cStandard')"
                    :key="i.message"
                    class="parameter-note"
                    >{{ i.message }}</small
                  ></label
                >
                <label
                  >C++ 标准<input
                    v-model="cppStandard"
                    :placeholder="'默认 · ' + fallback('cpp')"
                  /><small
                    v-for="i in notes('cppStandard')"
                    :key="i.message"
                    class="parameter-note"
                    >{{ i.message }}</small
                  ></label
                >
                <label
                  >优化<select v-model="optimize">
                    <option value="">跟随模式</option>
                    <option v-for="v in ['O0', 'O1', 'O2', 'O3', 'Os']" :value="v">
                      {{ v }}
                    </option></select
                  ><small v-for="i in notes('optimize')" :key="i.message" class="parameter-note">{{
                    i.message
                  }}</small></label
                >
              </div>
              <details open class="build-group">
                <summary>文件与目录</summary>
                <label>目标名称<input v-model="target" /></label>
                <div class="field-grid two">
                  <label
                    v-for="field in fields.filter((f) =>
                      ['add_files', 'remove_files', 'add_includedirs'].includes(f.command),
                    )"
                    :key="field.command"
                    >{{ field.label
                    }}<textarea v-model="field.value" rows="3" spellcheck="false"></textarea>
                  </label>
                </div>
              </details>
              <details class="build-group">
                <summary>高级</summary>
                <p>每行一个路径或参数；额外参数按声明顺序传入。</p>
                <div class="field-grid two">
                  <label
                    v-for="field in fields.filter(
                      (f) => !['add_files', 'remove_files', 'add_includedirs'].includes(f.command),
                    )"
                    :key="field.command"
                    >{{
                      field.command === 'add_cflags'
                        ? '额外 C 编译参数'
                        : field.command === 'add_cxxflags'
                          ? '额外 C++ 编译参数'
                          : field.command === 'add_ldflags'
                            ? '额外链接参数'
                            : field.label
                    }}<textarea v-model="field.value" rows="3" spellcheck="false"></textarea
                    ><small
                      v-for="i in notes(fieldKey(field.command))"
                      :key="i.message"
                      class="parameter-note"
                      :class="i.severity"
                      >{{ i.message }}</small
                    ></label
                  >
                </div>
              </details>
              <ParameterPreview :value="previewValue" :loading="previewBusy" />
            </div>
          </fieldset>
          <DialogActions class="create-actions"
            ><button :disabled="applying" @click="emit('close')">取消</button
            ><button v-if="valid" class="primary" :disabled="applying" @click="apply">
              {{ applying ? '正在核对…' : '应用' }}
            </button></DialogActions
          >
        </section></DialogContent
      >
    </div></DialogRoot
  >
</template>
<style>
.build-inputs {
  display: contents;
}
.build-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 86vh;
  width: min(760px, 92vw);
  background: var(--panel);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 24px;
}
.build-settings-fields {
  overflow: auto;
  min-height: 0;
  padding: 2px;
}
.build-settings p {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.6;
}
.build-group {
  border-top: 1px solid var(--border);
  padding-top: 10px;
  margin-top: 12px;
}
.build-group summary {
  font-size: 13px;
  cursor: pointer;
  margin-bottom: 10px;
}
.build-group > label {
  margin-bottom: 10px;
}
.build-group + .parameter-preview {
  margin-top: 12px;
}
.parameter-note {
  display: block;
  font-size: 11px;
  line-height: 1.5;
  font-weight: normal;
  color: var(--muted);
}
.parameter-note.warning {
  color: var(--warning, var(--muted));
}
</style>
