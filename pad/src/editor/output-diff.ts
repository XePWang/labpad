import { t } from '../i18n';
import { diffLines, diffWordsWithSpace, type Change } from 'diff';
export const DIFF_INPUT_CHARACTERS = 200_000;
export const DIFF_PREVIEW_CHARACTERS = 50_000;
export function outputDiff(expected: string, actual: string): { parts: Change[]; note: string } {
  if (expected.length + actual.length > DIFF_INPUT_CHARACTERS)
    return {
      parts: [
        {
          value: expected.slice(0, DIFF_PREVIEW_CHARACTERS),
          removed: true,
          added: false,
          count: 1,
        },
        { value: actual.slice(0, DIFF_PREVIEW_CHARACTERS), added: true, removed: false, count: 1 },
      ],
      note: t(
        'Large output: showing the first 50,000 characters on each side. The full output and verdict are retained.',
      ),
    };
  const words = diffWordsWithSpace(expected, actual, { timeout: 50, maxEditLength: 2048 });
  if (words) return { parts: words, note: '' };
  const lines = diffLines(expected, actual, { timeout: 25, maxEditLength: 1024 });
  if (lines)
    return { parts: lines, note: t('Many differences found. Showing a line-by-line comparison.') };
  return {
    parts: [
      { value: expected.slice(0, DIFF_PREVIEW_CHARACTERS), removed: true, added: false, count: 1 },
      { value: actual.slice(0, DIFF_PREVIEW_CHARACTERS), added: true, removed: false, count: 1 },
    ],
    note: t(
      'Many differences found. Showing previews of both sides. The full output and verdict are retained.',
    ),
  };
}
