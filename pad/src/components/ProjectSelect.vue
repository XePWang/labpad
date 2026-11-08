<script setup lang="ts">
import { computed as localeComputed } from 'vue';
const noneLabel = localeComputed(() => t('<None>'));
import { t } from '../i18n';

import { rememberMenuFocus, restoreMenuFocus } from '../menu-focus';
import { ref, watch, computed } from 'vue';
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuPortal,
  ContextMenuContent,
  ContextMenuItem,
} from 'reka-ui';
import type { Project } from '../../shared/types';
const props = defineProps<{
  value: string;
  projects: Project[];
  disabled: boolean;
  theme: string;
  suspended?: boolean;
}>();
const emit = defineEmits<{
    select: [value: string];
    delete: [value: string];
    build: [value: string];
  }>(),
  open = ref(false),
  bodyOpen = ref(false),
  contextTarget = ref('');
const contextOpen = computed(() => bodyOpen.value || !!contextTarget.value);
function closeFocus(event: Event) {
  if (props.suspended) event.preventDefault();
  else restoreMenuFocus(event);
}
function closeMenus() {
  open.value = false;
  bodyOpen.value = false;
  contextTarget.value = '';
}
defineExpose({ closeMenus });
watch(() => [props.value, props.disabled, props.suspended], closeMenus);
function body(value: boolean) {
  if (value && !props.disabled && !props.suspended && props.value) {
    open.value = false;
    contextTarget.value = '';
    bodyOpen.value = true;
  } else bodyOpen.value = false;
}
function item(value: boolean, lab: string) {
  if (value && !props.suspended) {
    bodyOpen.value = false;
    contextTarget.value = lab;
    open.value = true;
  } else if (contextTarget.value === lab) contextTarget.value = '';
}
function change(value: string) {
  closeMenus();
  emit('select', value);
}
function build(lab: string) {
  closeMenus();
  emit('build', lab);
}
function remove(lab: string) {
  closeMenus();
  emit('delete', lab);
}
</script>
<template>
  <ContextMenuRoot :open="bodyOpen" :modal="false" @update:open="body"
    ><ContextMenuTrigger as-child :disabled="disabled || suspended || !value"
      ><span class="project-context-host"
        ><DropdownMenuRoot
          :open="open"
          :modal="false"
          @update:open="!contextOpen && !suspended && (open = $event)"
        >
          <DropdownMenuTrigger
            role="combobox"
            data-lab-selector
            :aria-label="t('Experiment')"
            aria-haspopup="listbox"
            :aria-expanded="open"
            :data-value="value"
            :disabled="disabled || suspended"
            class="problem-trigger"
            ><span>{{ value || noneLabel }}</span
            ><svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="m3 5 4 4 4-4"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              /></svg
          ></DropdownMenuTrigger>
          <DropdownMenuContent
            @open-auto-focus="rememberMenuFocus"
            class="problem-options"
            role="listbox"
            :data-theme="theme"
            align="start"
            :side-offset="5"
            @focus-outside="contextOpen && $event.preventDefault()"
            @interact-outside="contextOpen && $event.preventDefault()"
            @close-auto-focus="closeFocus"
          >
            <DropdownMenuItem
              role="option"
              :aria-selected="!value"
              class="problem-option"
              @select="change('')"
              >{{ noneLabel }}</DropdownMenuItem
            >
            <ContextMenuRoot
              v-for="p in projects"
              :key="p.labId"
              :open="contextTarget === p.labId"
              @update:open="item($event, p.labId)"
              ><ContextMenuTrigger as-child @contextmenu.stop
                ><DropdownMenuItem
                  role="option"
                  :aria-selected="p.labId === value"
                  class="problem-option"
                  @select="change(p.labId)"
                  ><span>{{ p.labId }}</span
                  ><small>{{
                    p.mode === 'project' ? t('Project') : t('Problem Set')
                  }}</small></DropdownMenuItem
                ></ContextMenuTrigger
              ><ContextMenuPortal
                ><ContextMenuContent
                  @open-auto-focus="rememberMenuFocus"
                  @close-auto-focus="restoreMenuFocus"
                  class="tab-context"
                  :data-theme="theme"
                  ><ContextMenuItem class="tab-menu-item" @select="build(p.labId)">{{
                    t('Build Settings…')
                  }}</ContextMenuItem
                  ><ContextMenuItem class="tab-menu-item" @select="remove(p.labId)">{{
                    t('Delete Experiment…')
                  }}</ContextMenuItem></ContextMenuContent
                ></ContextMenuPortal
              ></ContextMenuRoot
            >
            <DropdownMenuSeparator class="project-actions-separator" /><DropdownMenuItem
              class="problem-option"
              :disabled="!value"
              @select="build(value)"
              >{{ t('Build Settings…') }}</DropdownMenuItem
            >
            <DropdownMenuItem
              role="option"
              :aria-selected="false"
              class="problem-option"
              @select="change('@new:lab')"
              >{{ t('+ New Experiment…') }}</DropdownMenuItem
            >
          </DropdownMenuContent></DropdownMenuRoot
        ></span
      ></ContextMenuTrigger
    ><ContextMenuPortal
      ><ContextMenuContent
        @open-auto-focus="rememberMenuFocus"
        @close-auto-focus="restoreMenuFocus"
        class="tab-context"
        :data-theme="theme"
        ><ContextMenuItem
          class="tab-menu-item"
          :disabled="disabled || !value"
          @select="build(value)"
          >{{ t('Build Settings…') }}</ContextMenuItem
        ><ContextMenuItem
          class="tab-menu-item"
          :disabled="disabled || !value"
          @select="remove(value)"
          >{{ t('Delete Experiment…') }}</ContextMenuItem
        ></ContextMenuContent
      ></ContextMenuPortal
    ></ContextMenuRoot
  >
</template>
<style>
.project-context-host {
  display: inline-flex;
  max-width: 100%;
}
.project-actions-separator {
  height: 1px;
  background: var(--border);
  margin: 5px 4px;
}
</style>
