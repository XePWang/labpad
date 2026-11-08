import { ref } from 'vue';
import {
  t as translate,
  setLanguage as configure,
  isMessage,
  renderMessage,
  type UILanguage,
  type UIText,
} from '../shared/i18n';
export const uiLanguage = ref<UILanguage>('zh-CN');
export function setLanguage(language: UILanguage) {
  configure(language);
  uiLanguage.value = language;
  document.documentElement.lang = language;
}
export function t(message: UIText, ...values: unknown[]): string {
  void uiLanguage.value;
  return isMessage(message) ? renderMessage(message) : translate(message, ...values);
}

export { msg, errorText, UIError, type UIText, type Message } from '../shared/i18n';

export function saveStateText(value: string) {
  const keys: Record<string, string> = {
    已保存: 'Saved',
    未保存: 'Unsaved',
    '保存中…': 'Saving…',
    保存失败: 'Save Failed',
    文件已移除: 'File Removed',
  };
  return t(keys[value] ?? value);
}
export function testStateText(value: string) {
  const keys: Record<string, string> = {
    部分已测: 'Partly Tested',
    未通过: 'Failed',
    未测: 'Not Tested',
    通过: 'Passed',
    需重测: 'Needs Retest',
    运行中: 'Running',
  };
  return t(keys[value] ?? value);
}
