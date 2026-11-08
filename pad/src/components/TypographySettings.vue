<script setup lang="ts">
import { watch } from 'vue';
import type { Typography } from '../../shared/typography';
import { useTypography } from '../typography';

const props = defineProps<{ modelValue: Typography }>();
const emit = defineEmits<{ 'update:modelValue': [value: Typography]; valid: [value: boolean] }>();
const { style, error, warning, loading } = useTypography(() => props.modelValue);
function update(key: keyof Typography, event: Event) {
  const value = (event.target as HTMLInputElement).value;
  emit('update:modelValue', {
    ...props.modelValue,
    [key]: key.endsWith('Size') ? Number(value) : value,
  });
}
watch([error, loading], () => emit('valid', !error.value && !loading.value), { immediate: true });
</script>

<template>
  <div class="typography-settings">
    <div class="field-grid two">
      <label
        >英文字体<input
          :value="modelValue.englishFamily"
          aria-label="英文字体"
          list="latin-fonts"
          @input="update('englishFamily', $event)"
      /></label>
      <label
        >英文字号<input
          :value="modelValue.englishSize"
          aria-label="英文字号"
          type="number"
          min="8"
          max="40"
          @input="update('englishSize', $event)"
      /></label>
      <label
        >中文字体<input
          :value="modelValue.chineseFamily"
          aria-label="中文字体"
          placeholder="系统默认"
          list="chinese-fonts"
          @input="update('chineseFamily', $event)"
      /></label>
      <label
        >中文字号<input
          :value="modelValue.chineseSize"
          aria-label="中文字号"
          type="number"
          min="8"
          max="40"
          @input="update('chineseSize', $event)"
      /></label>
    </div>
    <datalist id="latin-fonts">
      <option
        v-for="name in [
          'JetBrains Mono',
          'Cascadia Code',
          'Consolas',
          'Menlo',
          'DejaVu Sans Mono',
          'Liberation Mono',
        ]"
        :value="name"
        :key="name"
      />
    </datalist>
    <datalist id="chinese-fonts">
      <option
        v-for="name in ['Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', 'SimSun']"
        :value="name"
        :key="name"
      />
    </datalist>
    <p>
      用于代码编辑器、补全提示和终端。JetBrains Mono
      已内置；其他字体需在本机安装，英文字体建议选择等宽字体。
    </p>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <p v-else-if="warning" class="muted">{{ warning }}</p>
    <pre
      class="font-preview"
      aria-label="字体预览"
      :style="{
        fontFamily: style.family,
        fontSize: style.fontSize + 'px',
        lineHeight: style.lineHeight,
      }"
    >
int main(void) { // 中英文字体预览 0123456789
    return 0;
}</pre>
  </div>
</template>

<style>
.typography-settings {
  margin-top: 16px;
}
.font-preview {
  margin: 10px 0 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--editor);
  color: var(--text);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.typography-settings > p {
  margin-top: 8px;
}
</style>
