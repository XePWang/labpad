export interface Typography {
  englishFamily: string;
  chineseFamily: string;
  englishSize: number;
  chineseSize: number;
}

export function defaultTypography(): Typography {
  return { englishFamily: 'JetBrains Mono', chineseFamily: '', englishSize: 14, chineseSize: 14 };
}

export function validateTypography(value: unknown): Typography {
  const input = value as Typography;
  if (!input || typeof input.englishFamily !== 'string' || !input.englishFamily.trim() ||
      typeof input.chineseFamily !== 'string') throw new Error('请填写有效的字体名称');
  for (const name of [input.englishFamily, input.chineseFamily]) {
    if (name.length > 100 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('字体名称过长或包含控制字符');
  }
  for (const size of [input.englishSize, input.chineseSize]) {
    if (!Number.isInteger(size) || size < 8 || size > 40) throw new Error('字号应为 8 至 40 的整数');
  }
  return input;
}
