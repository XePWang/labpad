import { ref, watch, onBeforeUnmount } from 'vue';
import fontUrl from '../assets/fonts/JetBrainsMono-Regular.woff2?url';
import { defaultTypography, validateTypography, type Typography } from '../shared/typography';

export interface TextStyle {
  family: string;
  fontSize: number;
  lineHeight: number;
  terminalLineHeight: number;
  letterSpacing: number;
}

export const fallbackTextStyle: TextStyle = {
  family: 'monospace',
  fontSize: 14,
  lineHeight: 1.7,
  terminalLineHeight: 1.3,
  letterSpacing: 0,
};

const chineseFallbacks = [
  'Microsoft YaHei',
  'PingFang SC',
  'Noto Sans CJK SC',
  'WenQuanYi Micro Hei',
  'SimSun',
  'Noto Sans SC',
];
const chineseRange = 'U+2E80-9FFF,U+F900-FAFF,U+FE10-FE1F,U+FE30-FE4F,U+FF00-FFEF,U+20000-3134F';
let sequence = 0;

export async function prepareTypography(preferences: Typography) {
  const profile = validateTypography(preferences);
  const id = ++sequence;
  const latinName = 'LabPad Latin ' + id,
    chineseName = 'LabPad Chinese ' + id;
  const latinSource =
    profile.englishFamily.trim() === 'JetBrains Mono'
      ? 'url(' + JSON.stringify(fontUrl) + ') format("woff2")'
      : 'local(' + JSON.stringify(profile.englishFamily.trim()) + ')';
  const latin = new FontFace(latinName, latinSource);
  const chinese = new FontFace(
    chineseName,
    (profile.chineseFamily.trim() ? [profile.chineseFamily.trim()] : chineseFallbacks)
      .map((name) => 'local(' + JSON.stringify(name) + ')')
      .join(', '),
    {
      unicodeRange: chineseRange,
      sizeAdjust: (profile.chineseSize / profile.englishSize) * 100 + '%',
    } as FontFaceDescriptors & { sizeAdjust: string },
  );
  try {
    await latin.load();
  } catch {
    throw new Error(
      '未找到英文字体“' + profile.englishFamily + '”，请选择本机已安装的字体或 JetBrains Mono。',
    );
  }
  const faces = [latin];
  let warning = '';
  try {
    await chinese.load();
    faces.push(chinese);
  } catch {
    if (profile.chineseFamily.trim() || profile.chineseSize !== profile.englishSize) {
      throw new Error('未找到中文字体，请填写本机已安装的中文字体名称。');
    }
    warning = '中文使用系统回退字体；单独调整中文字号时请选择已安装的中文字体。';
  }
  for (const face of faces) document.fonts.add(face);
  const family =
    (faces.length > 1 ? [chineseName, latinName] : [latinName])
      .map((name) => JSON.stringify(name))
      .join(', ') + ', monospace, "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji"';
  const context = document.createElement('canvas').getContext('2d')!;
  context.font = profile.englishSize + 'px ' + family;
  const latinWidth = Math.max(context.measureText('W').width, context.measureText('M').width);
  const chineseWidth = context.measureText('中').width;
  const latinMetrics = context.measureText('W');
  const glyphHeight = latinMetrics.fontBoundingBoxAscent + latinMetrics.fontBoundingBoxDescent;
  const lineHeightPx = Math.max(profile.englishSize, profile.chineseSize) * 1.7;
  const style: TextStyle = {
    family,
    fontSize: profile.englishSize,
    lineHeight: lineHeightPx / profile.englishSize,
    // Xterm scales measured glyph height; CSS scales font size. Normalize the
    // option to the same pixel line box without changing Xterm's renderer.
    terminalLineHeight: Math.max(1, lineHeightPx / (glyphHeight || profile.englishSize)),
    // Xterm keeps a fixed cell grid. Reserve enough width for two-cell Chinese glyphs.
    letterSpacing: Math.max(0, Math.ceil(chineseWidth / 2 - latinWidth)),
  };
  return {
    style,
    warning,
    dispose: () => {
      for (const face of faces) document.fonts.delete(face);
    },
  };
}

export function useTypography(read: () => Typography | undefined) {
  const style = ref<TextStyle>({ ...fallbackTextStyle }),
    error = ref(''),
    warning = ref(''),
    loading = ref(false);
  let current: Awaited<ReturnType<typeof prepareTypography>> | undefined;
  watch(
    () => JSON.stringify(read() ?? defaultTypography()),
    async (serialized, _old, onCleanup) => {
      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
      });
      loading.value = true;
      try {
        const next = await prepareTypography(JSON.parse(serialized));
        if (cancelled) {
          next.dispose();
          return;
        }
        const previous = current;
        current = next;
        style.value = next.style;
        warning.value = next.warning;
        error.value = '';
        previous?.dispose();
      } catch (failure) {
        if (!cancelled) error.value = failure instanceof Error ? failure.message : String(failure);
      } finally {
        if (!cancelled) loading.value = false;
      }
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    current?.dispose();
  });
  return { style, error, warning, loading };
}
