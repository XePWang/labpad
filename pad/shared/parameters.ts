import { t as localize } from './i18n';
import type { Language } from './types';
export interface ParameterIssue {
  severity: 'error' | 'warning' | 'info';
  field: string;
  message: string;
  reason?: string;
  hint?: string;
  index?: number;
  language?: Language;
}
export interface ArgumentToken {
  key: string;
  value?: string;
  index: number;
}
export interface ArgumentSummary {
  standard?: string;
  optimization?: string;
  symbols?: string;
  ndebug?: string;
}
const values = new Set([
  '-o',
  '--output',
  '-x',
  '--language',
  '-I',
  '-L',
  '-l',
  '-include',
  '-imacros',
  '-isystem',
  '-iquote',
  '-idirafter',
  '-D',
  '-U',
  '--std',
  '-isysroot',
  '--sysroot',
  '-target',
  '--target',
  '-MF',
  '-MT',
  '-MQ',
  '-Xclang',
  '-Xlinker',
  '-Xpreprocessor',
  '-Xassembler',
  '-object-file-name',
  '-B',
  '-arch',
]);
const reserved = new Set([
  '-o',
  '--output',
  '-c',
  '-S',
  '-E',
  '--compile',
  '--assemble',
  '--preprocess',
  '-M',
  '-MM',
  '--dependencies',
  '--user-dependencies',
  '-x',
  '--language',
  '-xc',
  '-xc++',
  '-xnone',
]);
export function argumentTokens(args: readonly string[]): ArgumentToken[] {
  const result: ArgumentToken[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i],
      index = i;
    if (values.has(arg)) {
      result.push({ key: arg, value: args[++i], index });
      continue;
    }
    const eq =
      /^(--(?:output|language|std|sysroot|target)|-std|-fsanitize|-fno-sanitize|-fsanitize-trap|-fno-sanitize-trap|-flto|-fopenmp)=(.*)$/s.exec(
        arg,
      );
    if (eq) {
      result.push({ key: eq[1], value: eq[2], index });
      continue;
    }
    const joined = /^(-I|-L|-D|-U)(.+)$/s.exec(arg);
    if (joined) {
      result.push({ key: joined[1], value: joined[2], index });
      continue;
    }
    result.push({ key: arg, index });
  }
  return result;
}
export function parameterErrors(args: readonly string[], field: string): ParameterIssue[] {
  const result: ParameterIssue[] = [];
  for (const t of argumentTokens(args)) {
    if (reserved.has(t.key)) {
      const language = ['-x', '--language', '-xc', '-xc++', '-xnone'].includes(t.key);
      result.push({
        severity: 'error',
        field,
        index: t.index,
        message: language
          ? localize(
              'The source language is managed by its dedicated setting. Remove this argument.',
            )
          : localize('LabPad manages output paths and compilation stages. Remove this argument.'),
        reason: language
          ? 'Input language is managed by LabPad.'
          : 'Output selection and compilation stages are managed by LabPad.',
        hint: language
          ? 'Remove this argument. Set the project language with set_language(), or select the source language in problem-set mode.'
          : 'Remove this argument and its value, if any. LabPad supplies the build stages and output paths.',
      });
    } else if (values.has(t.key) && (t.value === undefined || t.value === '')) {
      result.push({
        severity: 'error',
        field,
        index: t.index,
        message: localize('{0} requires a value. Put the value on the next line.', t.key),
        reason: 'Missing value after ' + JSON.stringify(t.key) + '.',
        hint: 'Add the value as the next argument. Each line or string represents one process argument.',
      });
    }
  }
  return result;
}
export function assertParameters(args: readonly string[], field: string) {
  const issue = parameterErrors(args, field)[0];
  if (issue) throw new Error(field + '：' + issue.message);
}
export function argumentSummary(args: readonly string[]): ArgumentSummary {
  const result: ArgumentSummary = {};
  for (const t of argumentTokens(args)) {
    if (t.key === '-std' || t.key === '--std') result.standard = t.value;
    else if (t.key === '-ansi' || t.key === '--ansi') result.standard = 'ANSI';
    else if (/^-O(?:[0-3sgz]|fast)?$/.test(t.key))
      result.optimization = t.key === '-O' ? '-O1' : t.key;
    else if (t.key === '-g' || /^-g[0-3]$/.test(t.key)) result.symbols = t.key;
    else if ((t.key === '-D' || t.key === '-U') && t.value?.split('=')[0] === 'NDEBUG')
      result.ndebug =
        t.key === '-U'
          ? localize('undefined')
          : t.value.includes('=')
            ? t.value.split('=').slice(1).join('=')
            : '1';
  }
  return result;
}
function switches(args: readonly string[]) {
  const tokens = argumentTokens(args),
    keys = new Set(tokens.map((t) => t.key)),
    sanitizers = new Set<string>();
  let lto = false,
    openmp = false,
    trap = false,
    coverage = false;
  for (const t of tokens) {
    if (t.key === '-fsanitize' || t.key === '-fno-sanitize')
      for (const value of (t.value ?? '').split(',')) {
        if (t.key === '-fsanitize') sanitizers.add(value);
        else if (value === 'all') sanitizers.clear();
        else sanitizers.delete(value);
      }
    if (['--coverage', '-coverage', '-fprofile-arcs'].includes(t.key)) coverage = true;
    if (t.key === '-fno-profile-arcs') coverage = false;
    if (t.key === '-flto') lto = true;
    if (t.key === '-fno-lto') lto = false;
    if (t.key === '-fopenmp') openmp = true;
    if (t.key === '-fno-openmp') openmp = false;
    if (t.key === '-fsanitize-trap' || t.key === '-fsanitize-undefined-trap-on-error') trap = true;
    if (t.key === '-fno-sanitize-trap') trap = false;
  }
  return { tokens, keys, sanitizers, lto, openmp, trap, coverage };
}
export function parameterAdvice(
  compiles: { language: Language; args: string[] }[],
  linkArgs: string[],
  kind: string,
): ParameterIssue[] {
  const issues: ParameterIssue[] = [],
    link = switches(linkArgs),
    linkKeys = link.keys;
  const note = (message: string, severity: 'warning' | 'info' = 'warning') => {
    if (!issues.some((i) => i.message === message))
      issues.push({ severity, field: 'link', message });
  };
  for (const unit of compiles) {
    const flags = switches(unit.args);
    if (flags.keys.has('-pthread') && !linkKeys.has('-pthread') && !linkKeys.has('-lpthread'))
      note(
        localize(
          'Projects compile and link separately. Usually, -pthread also belongs in Extra Linker Arguments.',
        ),
      );
    if (
      flags.openmp &&
      !link.openmp &&
      !['-lgomp', '-lomp', '-liomp5'].some((k) => linkKeys.has(k))
    )
      note(
        localize(
          'OpenMP is enabled. Check the linker arguments and this toolchain’s OpenMP runtime.',
        ),
      );
    if (flags.keys.has('-pg') && !linkKeys.has('-pg'))
      note(localize('Usually, -pg is needed for both compilation and linking.'));
    const coverage = flags.coverage;
    if (coverage && !link.coverage && !linkKeys.has('-lgcov'))
      note(
        localize(
          'Coverage instrumentation is enabled. Check the coverage options or runtime in Extra Linker Arguments.',
        ),
      );
    const missing = [...flags.sanitizers].filter((s) => s && !link.sanitizers.has(s));
    if (missing.length) {
      const explicitLibrary = [...linkKeys].some((k) =>
        /^-l(?:asan|ubsan|tsan|msan|lsan|clang_rt)/.test(k),
      );
      note(
        flags.trap || explicitLibrary
          ? localize(
              'Sanitizer trap mode or an explicit runtime is configured. Check the effective compiler and linker arguments together.',
            )
          : localize(
              'Sanitizers {0} are enabled for compilation without matching linker options. Check the linker arguments.',
              missing.join(', '),
            ),
        flags.trap || explicitLibrary ? 'info' : 'warning',
      );
    }
    if (flags.lto && !link.lto)
      note(
        linkKeys.has('-fno-lto')
          ? localize(
              'LTO is explicitly disabled for linking. The compiler’s LTO setting does not carry over automatically.',
            )
          : kind === 'gcc'
            ? localize(
                'GCC can enable link-time optimization from LTO objects. The actual linker arguments are shown below.',
              )
            : localize('LTO is enabled. Check this toolchain’s linker and link options.'),
        'info',
      );
  }
  return issues;
}
export function relativePathAdvice(args: readonly string[], field: string): ParameterIssue[] {
  const result: ParameterIssue[] = [];
  for (const t of argumentTokens(args)) {
    if (
      !['-I', '-L', '-include', '-imacros', '-isystem', '-iquote', '-idirafter'].includes(t.key) ||
      !t.value ||
      /^(?:[\\/]|[a-z]:[\\/])/i.test(t.value)
    )
      continue;
    const message =
      t.key === '-L'
        ? localize(
            'Relative library paths use the link working directory. Prefer the Library Directories field.',
          )
        : t.key === '-include' || t.key === '-imacros'
          ? localize(
              'Forced includes use the compile working directory. Check this relative file path.',
            )
          : localize(
              'Relative include paths use the compile working directory. Prefer the Include Directories field.',
            );
    if (!result.some((i) => i.message === message))
      result.push({ severity: 'info', field, message });
  }
  return result;
}
