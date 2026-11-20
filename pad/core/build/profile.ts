import { UIError } from '../../shared/i18n';
import { argumentTokens } from '../../shared/parameters';
import type { BuildProfile, CompilerConfig, Language } from '../../shared/types';
import type { CompilerContext } from './plan';

const optimization = /^(?:-O(?:\d+|fast|[sgz])?|--optimize(?:=.*)?)$/;
const symbols = /^-g(?:\d*|gdb\d*|line-tables-only|mlt|line-directives-only|modules)$/;
const strip = new Set(['-s', '-S', '--strip-all', '--strip-debug', '--strip-discarded']);

function profileArguments(input: string[], profile: BuildProfile, debugSymbols: boolean) {
  const tokens = argumentTokens(input);
  const retained: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const { key, value, index } = tokens[i];
    if (key.startsWith('@') || value?.startsWith('@') || /^-W[lap],(?:[^,]*,)*@/.test(key))
      throw new UIError(
        'Expand the response file argument {0} to use a build profile.',
        input[index],
      );
    if (
      optimization.test(key) ||
      (key === '-Xclang' && value && optimization.test(value)) ||
      (profile === 'debug' && key === '-flto') ||
      (debugSymbols && (symbols.test(key) || (key !== '-S' && strip.has(key)))) ||
      (debugSymbols && key === '-Xclang' && value && symbols.test(value)) ||
      (debugSymbols && key === '-Xlinker' && value && strip.has(value))
    )
      continue;
    if (debugSymbols && key.startsWith('-Wl,')) {
      const link = key
        .slice(4)
        .split(',')
        .filter((option) => !strip.has(option));
      if (link.length) retained.push('-Wl,' + link.join(','));
      continue;
    }
    retained.push(...input.slice(index, tokens[i + 1]?.index));
  }
  return retained;
}

export function problemSetCompiler(
  config: CompilerConfig,
  language: Language,
  profile: BuildProfile,
  debugging = false,
): CompilerContext {
  const debugSymbols = profile === 'debug' || debugging;
  const field = language === 'c' ? 'cArgs' : 'cppArgs';
  return {
    ...config,
    [field]: [
      ...profileArguments(config[field], profile, debugSymbols),
      ...(debugSymbols ? ['-g'] : []),
      profile === 'debug' ? '-O0' : '-O2',
    ],
    linkArgs: profileArguments(config.linkArgs, profile, debugSymbols),
    cacheScope: 'problem-set-' + profile + (debugging ? '-session' : ''),
  };
}
