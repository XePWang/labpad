import type { Language } from './types';

const extensions: Record<string, { kind: 'source' | 'header'; language?: Language }> = {
  c: { kind: 'source', language: 'c' },
  cpp: { kind: 'source', language: 'cpp' },
  cc: { kind: 'source', language: 'cpp' },
  cxx: { kind: 'source', language: 'cpp' },
  h: { kind: 'header' },
  hpp: { kind: 'header', language: 'cpp' },
  hh: { kind: 'header', language: 'cpp' },
  hxx: { kind: 'header', language: 'cpp' },
};
const extension = (file: string) =>
  file.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase() ?? '';
export const sourceExtensions = Object.keys(extensions).filter(
  (name) => extensions[name].kind === 'source',
);
export const isSourceFile = (file: string) => extensions[extension(file)]?.kind === 'source';
export const isHeaderFile = (file: string) => extensions[extension(file)]?.kind === 'header';
export const isCodeFile = (file: string) => !!extensions[extension(file)];
export const isLpmake = (file: string) => file.split(/[\\/]/).pop() === 'LPMake.txt';
export function sourceLanguage(file: string, forced?: Language): Language | undefined {
  return isSourceFile(file) ? (forced ?? extensions[extension(file)].language) : undefined;
}
export function editorLanguage(
  file: string | undefined,
  fallback: Language = 'c',
  forced?: Language,
): Language {
  return file && isCodeFile(file)
    ? (forced ?? extensions[extension(file)].language ?? fallback)
    : fallback;
}
