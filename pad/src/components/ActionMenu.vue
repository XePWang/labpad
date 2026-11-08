<script setup lang="ts">
import { rememberMenuFocus, restoreMenuFocus } from '../menu-focus';
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from 'reka-ui';
import ActionIcon from './ActionIcon.vue';
defineProps<{
  label: string;
  items: {
    label: string;
    value: string;
    separator?: boolean;
    disabled?: boolean;
    checked?: boolean | 'indeterminate';
  }[];
  disabled?: boolean;
  theme?: string;
  compact?: boolean;
  triggerClass?: string;
}>();
const emit = defineEmits<{ select: [value: string]; closeAutoFocus: [event: Event] }>();
function closeMenu(event: Event) {
  emit('closeAutoFocus', event);
  restoreMenuFocus(event);
}
</script>
<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger
      :disabled="disabled"
      class="action-menu-trigger"
      :class="[triggerClass, { 'is-compact': compact }]"
      :aria-label="label"
      :title="label"
    >
      <ActionIcon v-if="compact" name="more" />
      <template v-else
        ><span>{{ label }}</span
        ><svg
          class="menu-chevron"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="m3 5 4 4 4-4"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          /></svg
      ></template>
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        @open-auto-focus="rememberMenuFocus"
        @close-auto-focus="closeMenu"
        class="action-menu"
        :data-theme="theme"
        align="end"
        :side-offset="6"
        :collision-padding="8"
      >
        <template v-for="item in items" :key="item.value">
          <DropdownMenuSeparator v-if="item.separator" class="menu-separator" />
          <DropdownMenuCheckboxItem
            v-if="item.checked !== undefined"
            class="action-menu-item"
            :checked="item.checked"
            :disabled="item.disabled"
            @select="emit('select', item.value)"
          >
            <span class="menu-check" aria-hidden="true">{{
              item.checked === 'indeterminate' ? '−' : item.checked ? '✓' : ''
            }}</span
            >{{ item.label }}
          </DropdownMenuCheckboxItem>
          <DropdownMenuItem
            v-else
            class="action-menu-item"
            :disabled="item.disabled"
            @select="emit('select', item.value)"
            >{{ item.label }}</DropdownMenuItem
          >
        </template>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
<style>
.action-menu {
  min-width: min(174px, calc(100vw - 16px));
  max-width: min(320px, calc(100vw - 16px));
  max-height: min(var(--reka-dropdown-menu-content-available-height), calc(100vh - 16px));
  overflow: auto;
  overscroll-behavior: contain;
  padding: 5px;
  background: var(--panel);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 8px 26px #0005;
  z-index: 60;
  outline: none;
  transform-origin: var(--reka-dropdown-menu-content-transform-origin);
}
.menu-separator {
  height: 1px;
  margin: 5px;
  background: var(--border);
}
.action-menu-item {
  position: relative;
  padding: 9px 13px;
  border-radius: 3px;
  font-size: 12px;
  cursor: default;
  outline: none;
  user-select: none;
  overflow-wrap: anywhere;
}
.action-menu-item[role='menuitemcheckbox'] {
  padding-left: 29px;
}
.menu-check {
  position: absolute;
  left: 10px;
}
.action-menu-item[data-highlighted] {
  background: var(--accent);
  color: #fff;
}
.action-menu-item[data-disabled] {
  opacity: 0.45;
  pointer-events: none;
}
.action-menu-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.action-menu-trigger > span {
  display: block;
}
.menu-chevron {
  display: block;
  flex-shrink: 0;
  align-self: center;
}
.action-menu-trigger.is-compact {
  width: 28px;
  height: 28px;
  padding: 4px;
  flex: none;
}
.empty-editor-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
}
.app-shell[data-theme] .empty-editor-actions .action-menu-trigger {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
</style>
