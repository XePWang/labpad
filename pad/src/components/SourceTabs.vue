<script setup lang="ts">
import { t, saveStateText } from '../i18n';

import { rememberMenuFocus, restoreMenuFocus } from '../menu-focus';
import { nextTick, watch, ref, computed } from 'vue';
import {
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuPortal,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from 'reka-ui';
const props = defineProps<{
  tabs: { id: string; name: string; path: string; dirty: boolean; status: string }[];
  active: string;
  disabled: boolean;
  theme: string;
  formatting: boolean;
  workspace?: boolean;
  filesEnabled?: boolean;
  sidebarCollapsed?: boolean;
  canFormat?: boolean;
}>();
const emit = defineEmits<{
  (e: 'activate', id: string): void;
  (e: 'action', value: string, id: string): void;
  (e: 'format'): void;
  (e: 'sidebar'): void;
}>();
const row = ref<HTMLElement>();
watch(
  () => props.active,
  () =>
    nextTick(() =>
      row.value
        ?.querySelector('[aria-selected="true"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' }),
    ),
);
const items = computed(() => [
  ['close', t('Close')],
  ['others', t('Close Others')],
  ['right', t('Close Tabs to the Right')],
  ['saved', t('Close Saved')],
  ['all', t('Close All')],
  ['version', t('Save as New Version')],
  ['copyPath', t('Copy Path')],
  ['copyRelativePath', t('Copy Relative Path')],
  ['reveal', t('Reveal in File Manager')],
]);
</script>
<template>
  <div class="source-strip">
    <button
      v-if="filesEnabled || workspace"
      class="source-sidebar-toggle"
      :aria-label="sidebarCollapsed ? t('Show Files') : t('Collapse Sidebar')"
      :title="sidebarCollapsed ? t('Show File Sidebar') : t('Collapse File Sidebar')"
      :aria-expanded="!sidebarCollapsed"
      @click="emit('sidebar')"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        :class="{ expanded: !sidebarCollapsed }"
      >
        <path
          d="m6 3.5 4.5 4.5-4.5 4.5"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
    <div ref="row" class="source-tabs" role="tablist" :aria-label="t('Source Tabs')">
      <ContextMenuRoot v-for="tab in tabs" :key="tab.id">
        <ContextMenuTrigger as-child :disabled="disabled"
          ><div
            class="source-tab"
            :class="{ active: tab.id === active }"
            :title="tab.path"
            role="tab"
            :aria-selected="tab.id === active"
            :tabindex="tab.id === active ? 0 : -1"
            @click="!disabled && emit('activate', tab.id)"
            @keydown.enter.prevent="!disabled && emit('activate', tab.id)"
            @keydown.space.prevent="!disabled && emit('activate', tab.id)"
            @keydown.right.prevent="
              !disabled &&
              emit('activate', tabs[(tabs.findIndex((t) => t.id === active) + 1) % tabs.length].id)
            "
            @keydown.left.prevent="
              !disabled &&
              emit(
                'activate',
                tabs[(tabs.findIndex((t) => t.id === active) - 1 + tabs.length) % tabs.length].id,
              )
            "
          >
            <span class="file-icon">{{
              tab.name.split('/').pop() === 'LPMake.txt'
                ? '⚙'
                : /\.(cpp|cc|cxx|hpp|hh|hxx)$/i.test(tab.name)
                  ? 'C++'
                  : /\.c$/i.test(tab.name)
                    ? 'C'
                    : /\.h$/i.test(tab.name)
                      ? 'H'
                      : '·'
            }}</span
            ><span>{{ tab.name }}</span
            ><span v-if="tab.dirty" class="tab-dirty" :aria-label="t('Unsaved')">●</span
            ><span v-if="tab.id === active" class="sr-only save-status" aria-live="polite">{{
              saveStateText(tab.status)
            }}</span
            ><button
              :aria-label="t('Close {0}', tab.name)"
              :disabled="disabled"
              @click.stop="emit('action', 'close', tab.id)"
            >
              ×
            </button>
          </div></ContextMenuTrigger
        >
        <ContextMenuPortal
          ><ContextMenuContent
            @open-auto-focus="rememberMenuFocus"
            @close-auto-focus="restoreMenuFocus"
            class="tab-context"
            :data-theme="theme"
            :collision-padding="8"
            ><template
              v-for="([id, label], i) in items.filter(([id]) => !workspace || id !== 'version')"
              :key="id"
              ><ContextMenuSeparator
                v-if="id === 'copyPath'"
                class="tab-menu-separator"
              /><ContextMenuItem
                class="tab-menu-item"
                :disabled="disabled || (id === 'reveal' && !tab.path)"
                @select="emit('action', id, tab.id)"
                >{{ label }}</ContextMenuItem
              ></template
            ></ContextMenuContent
          ></ContextMenuPortal
        >
      </ContextMenuRoot>
    </div>
    <div v-if="canFormat !== false" class="tab-format">
      <button class="format-button" :disabled="disabled || formatting" @click="emit('format')">
        {{ formatting ? t('Formatting…') : t('Format Code') }}
      </button>
    </div>
  </div>
</template>
<style>
.source-strip {
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
  height: var(--pane-header-height);
  min-height: var(--pane-header-height);
  background: var(--panel);
  border-bottom: 1px solid var(--border);
}
.source-sidebar-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  flex-shrink: 0;
  padding: 0;
  border: 0;
  border-right: 1px solid var(--border);
  border-radius: 0;
  background: var(--panel);
  color: var(--secondary);
}
.source-sidebar-toggle:hover {
  background: var(--raised);
  color: var(--text);
}
.source-sidebar-toggle:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -3px;
}
.source-sidebar-toggle svg.expanded {
  transform: rotate(180deg);
}
.source-sidebar-toggle + .source-tabs {
  padding-left: 4px;
}
.source-tabs {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-shrink: 0;
  overflow-x: auto;
  min-height: 0;
  max-width: 100%;
  background: var(--panel, #252526);
  scrollbar-width: thin;
}
.source-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px 5px 12px;
  flex-shrink: 0;
  min-width: 100px;
  max-width: 240px;
  border-right: 1px solid var(--line, #333);
  cursor: pointer;
  font-size: 12px;
  color: var(--muted, #999);
  border-top: 2px solid transparent;
}
.source-tab.active {
  background: var(--editor, #1e1e1e);
  color: var(--text, #ddd);
  border-top-color: #007acc;
}
.source-tab > span:nth-child(2) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.source-tab button {
  border: 0;
  background: transparent;
  padding: 0 4px;
  font-size: 17px;
  color: inherit;
  border-radius: 3px;
}
.source-tab button:hover {
  background: #8883;
}
.tab-dirty {
  font-size: 8px;
  color: #a8c9be;
}
.tab-context {
  min-width: 200px;
  background: var(--panel, #252526);
  color: var(--text, #ddd);
  padding: 5px;
  border: 1px solid var(--line, #454545);
  border-radius: 6px;
  box-shadow: 0 6px 22px #0006;
  z-index: 60;
}
.tab-menu-item {
  padding: 7px 20px;
  border-radius: 4px;
  font-size: 12px;
  outline: none;
  cursor: default;
}
.tab-menu-item[data-highlighted] {
  background: #007acc;
  color: white;
}
.tab-menu-separator {
  height: 1px;
  background: #7775;
  margin: 5px;
}
.editor-empty {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 12px;
}
.cache-controls {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-top: 16px;
  font-size: 11px;
}
.editor-pane {
  overflow: hidden;
}
.toolbar {
  flex-shrink: 0;
}
.tab-format {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0 10px;
}
.tab-format button {
  font-size: 11px;
  padding: 4px 8px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
@media (prefers-reduced-motion: reduce) {
  .tab-format {
    transition: none;
    transform: none;
  }
}
</style>
