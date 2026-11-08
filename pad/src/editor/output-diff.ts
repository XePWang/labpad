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
      note: '内容较大，仅预览两侧前 50000 个字符；原始输出和判定结果保持完整。',
    };
  const words = diffWordsWithSpace(expected, actual, { timeout: 50, maxEditLength: 2048 });
  if (words) return { parts: words, note: '' };
  const lines = diffLines(expected, actual, { timeout: 25, maxEditLength: 1024 });
  if (lines) return { parts: lines, note: '差异较多，已改为按行显示。' };
  return {
    parts: [
      { value: expected.slice(0, DIFF_PREVIEW_CHARACTERS), removed: true, added: false, count: 1 },
      { value: actual.slice(0, DIFF_PREVIEW_CHARACTERS), added: true, removed: false, count: 1 },
    ],
    note: '差异较多，仅显示两侧预览；原始输出和判定结果保持完整。',
  };
}
