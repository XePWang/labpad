import { UIError } from './i18n';
import type { Language } from './types';
export type SourceTemplates = Partial<Record<Language, string>>;
export function sourceText(value: unknown, label: string): string {
  if (Array.isArray(value)) {
    if (!value.every((s) => typeof s === 'string' && !/[\r\n]/.test(s)))
      throw new UIError('Each entry in the {0} array must be one source line', label);
    return value.join('\n') + '\n';
  }
  if (typeof value !== 'string')
    throw new UIError('{0} must be a string or an array of source lines', label);
  return value;
}
export function parseTemplates(value: unknown): SourceTemplates | undefined {
  if (value === undefined) return undefined;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !['c', 'cpp'].includes(k))
  )
    throw new UIError('Templates must contain only c and cpp entries');
  const templates: SourceTemplates = {};
  for (const key of ['c', 'cpp'] as const)
    if (Object.hasOwn(value, key))
      templates[key] = sourceText(
        (value as Record<string, unknown>)[key],
        'templates.' + key + ' ',
      );
  return templates;
}
