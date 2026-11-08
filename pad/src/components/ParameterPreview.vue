<script setup lang="ts">
import { t } from '../i18n';

import type { BuildPreview } from '../../core/build/plan';
defineProps<{ value?: BuildPreview; loading?: boolean }>();
const label = (v: string) => (v === 'c' ? 'C' : 'C++');
const summary = (value: BuildPreview['units'][number]['summary']) =>
  [
    value.standard,
    value.optimization,
    value.symbols,
    value.ndebug === undefined ? undefined : 'NDEBUG: ' + value.ndebug,
  ]
    .filter(Boolean)
    .join(' · ');
</script>
<template>
  <details class="parameter-preview">
    <summary>
      {{ t('Show Effective Arguments') }}<span v-if="loading">{{ t('· Checking…') }}</span>
    </summary>
    <template v-if="value"
      ><p>{{ value.origins.join(' → ') }}</p>
      <p>
        {{ t('Compile Directory:') }}{{ value.workDirectories.compile }}<br />{{
          t('Link Directory:')
        }}{{ value.workDirectories.link }}
      </p>
      <template v-for="language in ['c', 'cpp']" :key="language"
        ><section v-if="value.units.some((u) => u.language === language)">
          <h4>
            {{ label(language) }} ·
            {{
              value.units
                .filter((u) => u.language === language)
                .map((u) => u.path)
                .join('、')
            }}
          </h4>
          <p>{{ summary(value.units.find((u) => u.language === language)!.summary) }}</p>
          <div
            v-for="group in value.layers.find((g) => g.language === language)!.groups"
            :key="group.label"
          >
            <h5>{{ group.label }}</h5>
            <pre>{{ group.args.map((v) => JSON.stringify(v)).join('\n') }}</pre>
          </div>
        </section></template
      >
      <h4>{{ t('Linker Arguments') }}</h4>
      <div v-for="group in value.linkLayers" :key="group.label">
        <h5>{{ group.label }}</h5>
        <pre>{{
          group.args.map((v) => JSON.stringify(v)).join('\n') || t('(no extra linker arguments)')
        }}</pre>
      </div>
      <p>
        {{
          t('Each line is one argument. LabPad adds source files, object files, and output paths.')
        }}
      </p></template
    >
  </details>
</template>
<style>
.parameter-preview {
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 8px 10px;
  font-size: 12px;
}
.parameter-preview summary {
  cursor: pointer;
  color: var(--text);
}
.parameter-preview pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--bg);
  padding: 10px;
  border-radius: 4px;
  max-height: 200px;
  overflow: auto;
  color: var(--text);
}
.parameter-preview h4 {
  margin: 10px 0 4px;
}
.parameter-preview p {
  margin: 6px 0;
  color: var(--muted);
  line-height: 1.6;
}
</style>
