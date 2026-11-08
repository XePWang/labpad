import { UIError } from './i18n';
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
  if (
    !input ||
    typeof input.englishFamily !== 'string' ||
    !input.englishFamily.trim() ||
    typeof input.chineseFamily !== 'string'
  )
    throw new UIError('Enter a valid font family name.');
  for (const name of [input.englishFamily, input.chineseFamily]) {
    if (name.length > 100 || /[\x00-\x1f\x7f]/.test(name))
      throw new UIError('The font family name is too long or contains control characters.');
  }
  for (const size of [input.englishSize, input.chineseSize]) {
    if (!Number.isInteger(size) || size < 8 || size > 40)
      throw new UIError('Font size must be an integer from 8 to 40.');
  }
  return input;
}
