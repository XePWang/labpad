import { UIError, t as localize } from './i18n';
import type { Comparison } from './types';
export function validateComparison(
  value: unknown,
  label = localize('Comparison Rules'),
): Comparison {
  const rule = value as Comparison;
  if (!rule || !['wcmp', 'floatTokens', 'strictText'].includes(rule.type))
    throw new UIError('{0}: type must be wcmp, floatTokens, or strictText', label);
  if (rule.type === 'floatTokens') {
    const values = [rule.absoluteTolerance, rule.relativeTolerance];
    if (
      values.every((v) => v === undefined) ||
      values.some((v) => v !== undefined && (!Number.isFinite(v) || v < 0))
    )
      throw new UIError(
        '{0}: set at least one finite, nonnegative absoluteTolerance or relativeTolerance',
        label,
      );
  }
  if (rule.type === 'strictText')
    for (const key of ['ignoreTrailingSpaces', 'ignoreFinalNewlines'] as const) {
      if (rule[key] !== undefined && typeof rule[key] !== 'boolean')
        throw new UIError('{0}: {1} must be a boolean', label, key);
    }
  return rule;
}
export function strictText(
  actual: string,
  expected: string,
  rule: Extract<Comparison, { type: 'strictText' }>,
) {
  const normalize = (text: string) => {
    text = text.replace(/\r\n/g, '\n');
    if (rule.ignoreTrailingSpaces) text = text.replace(/[ \t]+(?=\n|$)/g, '');
    if (rule.ignoreFinalNewlines) text = text.replace(/\n+$/, '');
    return text;
  };
  const a = normalize(actual),
    e = normalize(expected);
  if (a === e) return { accepted: true, message: localize('Output matches the exact-text rules') };
  let offset = 0;
  while (offset < Math.min(a.length, e.length) && a[offset] === e[offset]) offset++;
  const before = e.slice(0, offset).split('\n'),
    line = before.length,
    column = before.at(-1)!.length + 1;
  const show = (char: string | undefined) =>
    char === undefined
      ? localize('end of file')
      : char === ' '
        ? localize('space')
        : char === '\t'
          ? 'Tab'
          : char === '\n'
            ? localize('newline')
            : char === '\r'
              ? localize('carriage return')
              : JSON.stringify(char);
  return {
    accepted: false,
    message: localize(
      'Difference at line {0}, column {1}: expected {2}, got {3}',
      line,
      column,
      show(e[offset]),
      show(a[offset]),
    ),
  };
}
