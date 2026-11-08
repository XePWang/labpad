import * as l10n from '@vscode/l10n';
import chinese from './locales/zh-CN.json';

export type UILanguage = 'zh-CN' | 'en-US';
export const supportedLanguages = ['zh-CN', 'en-US'] as const;
let activeLanguage: UILanguage = 'zh-CN';
export function setLanguage(language: UILanguage) {
  activeLanguage = language;
  l10n.config({ contents: language === 'zh-CN' ? chinese : {} });
}
export function currentLanguage(): UILanguage {
  return activeLanguage;
}
export function t(message: string, ...values: unknown[]): string {
  return l10n.t(
    message,
    ...values.map((value) =>
      typeof value === 'number' || typeof value === 'boolean' ? value : String(value ?? ''),
    ),
  );
}
setLanguage('zh-CN');

export interface Message {
  key: string;
  args: MessageArgument[];
}
export type MessageArgument = string | number | boolean | Message;
export type UIText = string | Message;
export function msg(key: string, ...args: unknown[]): Message {
  return {
    key,
    args: args.map((value) =>
      isMessage(value)
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? value
          : String(value ?? ''),
    ),
  };
}
export function isMessage(value: unknown): value is Message {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as Message).key === 'string' &&
    Array.isArray((value as Message).args)
  );
}
export function renderMessage(value: UIText): string {
  return isMessage(value)
    ? t(value.key, ...value.args.map((arg) => (isMessage(arg) ? renderMessage(arg) : arg)))
    : value;
}
export class UIError extends Error {
  readonly localization: Message;
  readonly originalMessage: string;
  constructor(key: string, ...args: unknown[]) {
    const value = msg(key, ...args);
    super(renderMessage(value));
    this.name = 'UIError';
    this.localization = value;
    this.originalMessage = this.message;
  }
}
export function errorText(error: unknown): UIText {
  if (
    error &&
    typeof error === 'object' &&
    isMessage((error as { localization?: unknown }).localization)
  )
    return (error as { localization: Message }).localization;
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === 'object' &&
    typeof (error as { message?: unknown }).message === 'string'
  )
    return (error as { message: string }).message;
  return String(error);
}
