import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { visibleDeclarations, declaredNames, includeDirectives, type Candidate } from './symbols';
import type { Tree } from '@lezer/common';
import { cppLanguage } from '@codemirror/lang-cpp';
import {
  autocompletion,
  completionStatus,
  currentCompletions,
  selectedCompletionIndex,
  setSelectedCompletion,
  acceptCompletion,
  closeCompletion,
  moveCompletionSelection,
  startCompletion,
  nextSnippetField,
  prevSnippetField,
  snippetCompletion,
  type Completion,
  type CompletionContext,
} from '@codemirror/autocomplete';
import { keymap, ViewPlugin } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { indentMore, indentLess } from '@codemirror/commands';
import type { CompletionFiles } from '../../shared/types';
export type { CompletionFiles } from '../../shared/types';
const keywordsC =
  'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while _Alignas _Alignof _Atomic _Bool _Complex _Generic _Imaginary _Noreturn _Static_assert _Thread_local'.split(
    ' ',
  );
const keywordsCpp =
  'alignas alignof and and_eq asm auto bitand bitor bool break case catch char char8_t char16_t char32_t class compl concept const consteval constexpr constinit const_cast continue co_await co_return co_yield decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not not_eq nullptr operator or or_eq private protected public register reinterpret_cast requires return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor xor_eq'.split(
    ' ',
  );
const standard: Record<string, string[]> = {
  'stdio.h': [
    'printf(const char *format, ...)',
    'scanf(const char *format, ...)',
    'puts(const char *text)',
    'putchar(int ch)',
    'getchar(void)',
    'fgets(char *buffer, int size, FILE *stream)',
    'fprintf(FILE *stream, const char *format, ...)',
    'fscanf(FILE *stream, const char *format, ...)',
    'fopen(const char *path, const char *mode)',
    'fclose(FILE *stream)',
    'fread(void *data, size_t size, size_t count, FILE *stream)',
    'fwrite(const void *data, size_t size, size_t count, FILE *stream)',
    'sprintf(char *buffer, const char *format, ...)',
    'snprintf(char *buffer, size_t size, const char *format, ...)',
  ],
  'stdlib.h': [
    'malloc(size_t size)',
    'calloc(size_t count, size_t size)',
    'realloc(void *ptr, size_t size)',
    'free(void *ptr)',
    'abs(int value)',
    'strtol(const char *text, char **end, int base)',
    'atoi(const char *text)',
    'rand(void)',
    'srand(unsigned int seed)',
    'qsort(void *base, size_t count, size_t size, int (*compare)(const void *, const void *))',
    'exit(int status)',
  ],
  'string.h': [
    'strlen(const char *text)',
    'strcmp(const char *left, const char *right)',
    'strncmp(const char *left, const char *right, size_t count)',
    'strcpy(char *dest, const char *source)',
    'strncpy(char *dest, const char *source, size_t count)',
    'strcat(char *dest, const char *source)',
    'memcpy(void *dest, const void *source, size_t size)',
    'memmove(void *dest, const void *source, size_t size)',
    'memset(void *dest, int value, size_t size)',
    'strchr(const char *text, int ch)',
    'strstr(const char *text, const char *pattern)',
  ],
  'math.h': [
    'sqrt(double value)',
    'pow(double base, double exponent)',
    'fabs(double value)',
    'sin(double radians)',
    'cos(double radians)',
    'tan(double radians)',
    'floor(double value)',
    'ceil(double value)',
    'round(double value)',
    'log(double value)',
    'exp(double value)',
    'fmod(double value, double divisor)',
  ],
  'ctype.h': [
    'isdigit(int ch)',
    'isalpha(int ch)',
    'isalnum(int ch)',
    'isspace(int ch)',
    'toupper(int ch)',
    'tolower(int ch)',
  ],
  'time.h': ['time(time_t *result)', 'clock(void)', 'difftime(time_t end, time_t begin)'],
  algorithm: [
    'std::sort(first, last)',
    'std::find(first, last, value)',
    'std::max(left, right)',
    'std::min(left, right)',
    'std::reverse(first, last)',
  ],
  utility: ['std::swap(left, right)', 'std::move(value)'],
  iostream: ['std::getline(std::istream &input, std::string &text)'],
  string: [
    'std::getline(std::istream &input, std::string &text)',
    'std::stoi(const std::string &text)',
    'std::to_string(value)',
  ],
};
export function declarations(text: string, pos: number, tree: Tree): Completion[] {
  return visibleDeclarations(tree, text, pos);
}
const normalize = (value: string) => {
  const parts: string[] = [];
  for (const p of value.split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(p);
  }
  return parts.join('/');
};
const headerCache = new Map<
  string,
  { symbols: Candidate[]; includes: { name: string; quoted: boolean }[] }
>();
let cacheCharacters = 0,
  cacheScope: string | undefined;
function headerData(text: string) {
  const cached = headerCache.get(text);
  if (cached) {
    headerCache.delete(text);
    headerCache.set(text, cached);
    return cached;
  }
  const tree = cppLanguage.parser.parse(text);
  const entry = {
    symbols: declaredNames(tree, text)
      .filter((symbol) => !symbol.scope)
      .map((symbol) => ({
        label: symbol.qualified,
        qualified: symbol.qualified,
        type: symbol.type,
        detail: symbol.detail,
        boost: 1,
      })),
    includes: includeDirectives(tree, text),
  };
  if (text.length <= 1048576) {
    headerCache.set(text, entry);
    cacheCharacters += text.length;
    while (headerCache.size > 64 || cacheCharacters > 1048576) {
      const oldest = headerCache.keys().next().value!;
      cacheCharacters -= oldest.length;
      headerCache.delete(oldest);
    }
  }
  return entry;
}
export function includedOptions(
  source: string,
  file: string,
  context: CompletionFiles,
  tree = cppLanguage.parser.parse(source),
  upto = source.length,
): Candidate[] {
  if (context.scope !== cacheScope) {
    headerCache.clear();
    cacheCharacters = 0;
    cacheScope = context.scope;
  }
  const options: Candidate[] = [],
    seen = new Set<string>(),
    headers = new Set<string>();
  function visit(includes: { name: string; quoted: boolean }[], current: string) {
    for (const include of includes) {
      const base = current.includes('/') ? current.slice(0, current.lastIndexOf('/')) : '';
      const paths = [...(include.quoted ? [base] : []), ...context.includeDirs, ''].map(
        (directory) => normalize(directory + '/' + include.name),
      );
      const local = paths.find((name) => name !== undefined && Object.hasOwn(context.files, name));
      if (local !== undefined) {
        if (seen.has(local)) continue;
        seen.add(local);
        const entry = headerData(context.files[local]);
        options.push(...entry.symbols);
        visit(entry.includes, local);
      } else headers.add(include.name);
    }
  }
  visit(includeDirectives(tree, source, upto), file);
  for (const header of headers) {
    const mapped =
      header.startsWith('c') && standard[header.slice(1) + '.h'] ? header.slice(1) + '.h' : header;
    for (const signature of standard[mapped] ?? []) {
      const bare = signature.slice(0, signature.indexOf('('));
      const label = mapped !== header && !bare.includes('::') ? 'std::' + bare : bare;
      options.push({
        label,
        qualified: label,
        type: 'function',
        detail: signature,
        info: '#include <' + header + '>',
        boost: 0,
      });
    }
  }
  return options;
}

export function sourceCompletions(
  context: CompletionContext,
  file: string,
  files: CompletionFiles,
  language: 'c' | 'cpp',
) {
  const tree = ensureSyntaxTree(context.state, context.pos, 8) ?? syntaxTree(context.state);
  let node = tree.resolveInner(context.pos, -1);
  for (let current: typeof node | null = node; current; current = current.parent)
    if (/Comment|String|CharLiteral/.test(current.name)) return null;
  const word = context.matchBefore(/[A-Za-z_]\w*/);
  const start = word?.from ?? context.pos;
  const before = context.state.sliceDoc(Math.max(0, start - 512), start);
  if (/(?:\.|->)\s*$/.test(before)) return null;
  const qualifier = before.match(/((?:[A-Za-z_]\w*::)+)$/)?.[1];
  if (!word && !context.explicit && !qualifier) return null;
  const text = context.state.doc.toString();
  const options: Candidate[] = [
    ...visibleDeclarations(tree, text, context.pos),
    ...includedOptions(text, file, files, tree, context.pos),
    ...(qualifier
      ? []
      : (language === 'c' ? keywordsC : keywordsCpp).map((label) => ({
          label,
          type: 'keyword',
          boost: -5,
        }))),
  ];
  const indent = '\t',
    snippets = [
      snippetCompletion('if (' + '\u0024{condition}' + ') {\n' + indent + '\u0024{}' + '\n}', {
        label: 'if',
        detail: 'if (条件) { … }',
        type: 'keyword',
      }),
      snippetCompletion(
        'for (' +
          '\u0024{int i = 0}' +
          '; ' +
          '\u0024{i < count}' +
          '; ' +
          '\u0024{++i}' +
          ') {\n' +
          indent +
          '\u0024{}' +
          '\n}',
        { label: 'for', detail: 'for (初始; 条件; 更新) { … }', type: 'keyword' },
      ),
      snippetCompletion('while (' + '\u0024{condition}' + ') {\n' + indent + '\u0024{}' + '\n}', {
        label: 'while',
        detail: 'while (条件) { … }',
        type: 'keyword',
      }),
      snippetCompletion(
        'switch (' +
          '\u0024{value}' +
          ') {\n' +
          indent +
          'case ' +
          '\u0024{value}' +
          ':\n' +
          indent +
          indent +
          '\u0024{}' +
          '\n' +
          indent +
          indent +
          'break;\n}',
        { label: 'switch', detail: 'switch (值) { case … }', type: 'keyword' },
      ),
    ];
  snippets.push(
    snippetCompletion('if (\u0024{condition}) {\n\t\u0024{}\n} else {\n\t\u0024{}\n}', {
      label: 'ifelse',
      detail: 'if … else …',
      type: 'keyword',
    }),
    snippetCompletion('do {\n\t\u0024{}\n} while (\u0024{condition});', {
      label: 'do',
      detail: 'do … while (条件);',
      type: 'keyword',
    }),
    snippetCompletion('return \u0024{value};', {
      label: 'return',
      detail: 'return 值;',
      type: 'keyword',
    }),
  );
  const unique = new Map<string, Candidate>();
  const candidates = qualifier
    ? options
        .filter((option) => (option.qualified ?? option.label).startsWith(qualifier))
        .map((option) => ({
          ...option,
          label: (option.qualified ?? option.label).slice(qualifier.length),
        }))
    : [...options, ...snippets.map((option) => ({ ...option, boost: -5 }))];
  for (const option of candidates) {
    const previous = unique.get(option.label);
    if (
      !previous ||
      (option.boost ?? 0) > (previous.boost ?? 0) ||
      (option.apply && !previous.apply && (option.boost ?? 0) === (previous.boost ?? 0))
    )
      unique.set(option.label, option);
  }
  const prefix = word?.text ?? '';
  return {
    from: start,
    options: [...unique.values()].map((option) => ({
      ...option,
      boost: Math.min(99, (option.boost ?? 0) + (prefix && option.label === prefix ? 80 : 0)),
    })),
    validFor: /^\w*$/,
  };
}

export function completionExtension(
  source: (context: CompletionContext) => ReturnType<typeof sourceCompletions>,
) {
  let arrowSelected = false;
  const move = (forward: boolean) => (view: any) => {
    if (!completionStatus(view.state)) return false;
    const done = moveCompletionSelection(forward)(view);
    if (done) arrowSelected = true;
    return done;
  };
  return [
    autocompletion({
      override: [source],
      defaultKeymap: false,
      selectOnOpen: false,
      activateOnTyping: true,
      interactionDelay: 0,
    }),
    ViewPlugin.define(() => ({
      update(update) {
        if (update.docChanged || !completionStatus(update.state)) arrowSelected = false;
      },
    })),
    Prec.highest(
      keymap.of([
        { key: 'ArrowDown', run: move(true) },
        { key: 'ArrowUp', run: move(false) },
        {
          key: 'Tab',
          run: (view) => {
            if (currentCompletions(view.state).length) {
              if (selectedCompletionIndex(view.state) === null)
                view.dispatch({ effects: setSelectedCompletion(0) });
              return acceptCompletion(view);
            }
            return nextSnippetField(view) || indentMore(view);
          },
        },
        { key: 'Shift-Tab', run: (view) => prevSnippetField(view) || indentLess(view) },
        {
          key: 'Enter',
          run: (view) => {
            if (arrowSelected && selectedCompletionIndex(view.state) !== null)
              return acceptCompletion(view);
            closeCompletion(view);
            return false;
          },
        },
        { key: 'Escape', run: closeCompletion },
        { key: 'Alt-/', run: startCompletion },
        { key: 'Ctrl-Space', run: startCompletion },
      ]),
    ),
  ];
}
