<script setup lang="ts">
import { t, setLanguage, errorText, msg, type UIText } from './i18n';
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { formatShortcut, parseShortcutLabel } from '../shared/shortcut-display';
import { shortcutActions, defaultShortcuts, validateShortcuts } from '../shared/shortcuts';
const ready = ref(false),
  platform = ref(navigator.platform),
  fields = ref<Record<string, string>>({});
function syncFields() {
  fields.value = Object.fromEntries(
    shortcutActions.map(([id]) => [
      id,
      (shortcuts.value[id] ?? []).map((key) => formatShortcut(key, platform.value)).join('; '),
    ]),
  );
}
function defaults() {
  shortcuts.value = defaultShortcuts(platform.value);
  syncFields();
  error.value = '';
  notice.value = '';
}
const shortcuts = ref<Record<string, string[]>>(defaultShortcuts()),
  theme = ref('dark'),
  error = ref<UIText>(''),
  notice = ref<UIText>(''),
  recording = ref(''),
  strokes = ref<string[]>([]);
let timer: ReturnType<typeof setTimeout> | undefined;
let stopLanguage: undefined | (() => void);
function changeLanguage(language: 'zh-CN' | 'en-US') {
  const pristine = shortcutActions
    .filter(([id]) => fields.value[id] === text(id))
    .map(([id]) => id);
  setLanguage(language);
  for (const id of pristine) fields.value[id] = text(id);
}
onMounted(async () => {
  stopLanguage = window.labpad.onLanguage(changeLanguage);
  const state = await window.labpad.shortcutSettings();
  setLanguage(state.uiLanguage ?? 'zh-CN');
  shortcuts.value = state.shortcuts;
  platform.value = state.platform;
  theme.value = state.theme;
  syncFields();
  ready.value = true;
});
function record(id: string) {
  clearTimeout(timer);
  recording.value = id;
  strokes.value = [];
  notice.value = msg('Press a shortcut, or enter a two-part chord. Press Esc to cancel.');
}
function keydown(event: KeyboardEvent) {
  if (!recording.value) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'Escape') {
    clearTimeout(timer);
    strokes.value = [];
    recording.value = '';
    notice.value = '';
    return;
  }
  if (event.repeat || ['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
  const key = [
    ...(event.ctrlKey ? ['Control'] : []),
    ...(event.metaKey ? ['Meta'] : []),
    ...(event.altKey ? ['Alt'] : []),
    ...(event.shiftKey ? ['Shift'] : []),
    event.code,
  ].join('+');
  strokes.value.push(key);
  clearTimeout(timer);
  const finish = () => {
    shortcuts.value[recording.value] = [strokes.value.join(' ')];
    fields.value[recording.value] = text(recording.value);
    recording.value = '';
    notice.value = '';
  };
  if (strokes.value.length === 2) finish();
  else timer = setTimeout(finish, 1100);
}
onBeforeUnmount(() => {
  clearTimeout(timer);
  stopLanguage?.();
});
async function save() {
  error.value = '';
  const proposed: Record<string, string[]> = {};
  try {
    const value = proposed;
    for (const [id, label] of shortcutActions) {
      if (fields.value[id] === text(id)) {
        value[id] = shortcuts.value[id] ?? [];
        continue;
      }
      try {
        value[id] = (fields.value[id] ?? '')
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => parseShortcutLabel(s, platform.value));
      } catch (e) {
        throw new Error(t(label) + ': ' + t(errorText(e)));
      }
    }
    validateShortcuts(value, platform.value);
    await window.labpad.saveShortcuts(JSON.parse(JSON.stringify(value)));
    shortcuts.value = value;
    syncFields();
    notice.value = msg('Shortcuts saved. They are now active in the main window.');
  } catch (e) {
    let message = t(errorText(e));
    for (const keys of Object.values({ ...shortcuts.value, ...proposed }))
      for (const key of keys)
        message = message.replaceAll(key, formatShortcut(key, platform.value));
    error.value = message;
  }
}
function text(id: string) {
  return (shortcuts.value[id] ?? []).map((key) => formatShortcut(key, platform.value)).join('; ');
}
function clear(id: string) {
  shortcuts.value[id] = [];
  fields.value[id] = '';
}
</script>
<template>
  <div class="app-shell shortcuts-page" :data-theme="theme" @keydown.capture="keydown">
    <header>
      <h2>{{ t('Keyboard Shortcuts') }}</h2>
      <p>
        {{
          t(
            'Click Record or type the keys used on your system. Separate alternative shortcuts with semicolons and chord steps with spaces.',
          )
        }}
      </p>
    </header>
    <fieldset :disabled="!ready" class="shortcut-fields">
      <div v-for="[id, label] in shortcutActions" :key="id" class="shortcut-row">
        <label :for="'key-' + id">{{ t(label) }}</label
        ><input
          :id="'key-' + id"
          :aria-label="t('{0} Shortcut', t(label))"
          v-model="fields[id]"
          spellcheck="false"
        /><button @click="record(id)">{{ recording === id ? t('Recording…') : t('Record') }}</button
        ><button @click="clear(id)" :aria-label="t('Clear {0}', t(label))">{{ t('Clear') }}</button>
      </div>
    </fieldset>
    <p v-if="error" class="field-error" role="alert">{{ t(error) }}</p>
    <p role="status">{{ t(notice) }}</p>
    <footer>
      <button @click="defaults">{{ t('Reset to Defaults') }}</button
      ><button class="primary" :disabled="!ready || !!recording" @click="save">
        {{ t('Save Shortcuts') }}
      </button>
    </footer>
  </div>
</template>
<style>
.shortcuts-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--panel, #1e1e1e);
  color: var(--text, #ddd);
  padding: 24px;
  gap: 16px;
}
.shortcuts-page h2 {
  font-size: 22px;
  margin-bottom: 8px;
}
.shortcuts-page header p {
  font-size: 12px;
}
.shortcuts-page .shortcut-fields {
  border: 0;
  margin: 0;
  padding: 0;
  overflow: auto;
  flex: 1;
  min-height: 0;
}
.shortcut-row {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr) 80px 50px;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid #8883;
}
.shortcut-row label {
  font-size: 12px;
}
.shortcut-row input {
  width: 100%;
  min-width: 0;
  font:
    12px Consolas,
    monospace;
}
.shortcut-row button {
  font-size: 12px;
  padding: 6px;
}
.shortcuts-page footer {
  height: auto;
  justify-content: space-between;
  padding: 14px 0 0;
  background: none;
  border-top: 1px solid #8884;
}
</style>
