import { syntaxTree } from '@codemirror/language';
import { cppLanguage } from '@codemirror/lang-cpp';
import type { SyntaxNode } from '@lezer/common';
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
export interface CompletionFiles {
  files: Record<string, string>;
  includeDirs: string[];
}
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
function scope(node: SyntaxNode) {
  for (let p = node.parent; p; p = p.parent)
    if (
      [
        'CompoundStatement',
        'ForStatement',
        'ClassSpecifier',
        'StructSpecifier',
        'NamespaceDefinition',
      ].includes(p.name)
    )
      return p;
  return undefined;
}
export function declarations(text: string, pos = text.length): Completion[] {
  const tree = cppLanguage.parser.parse(text),
    result: Completion[] = [];
  tree.iterate({
    enter(ref) {
      const node = ref.node;
      if (
        !['Identifier', 'TypeIdentifier', 'FieldIdentifier'].includes(node.name) ||
        node.from > pos
      )
        return;
      let p = node.parent,
        owner: SyntaxNode | undefined,
        param = false;
      while (p) {
        if (/Expression$|ArgumentList|InitializerList|BinaryExpression|Number|String/.test(p.name))
          return;
        if (p.name === 'InitDeclarator' && node.from !== (p.firstChild?.from ?? -1)) return;
        if (p.name === 'ParameterDeclaration') {
          owner = p;
          param = true;
          break;
        }
        if (
          ['Declaration', 'TypeDefinition', 'FunctionDefinition', 'Enumerator'].includes(p.name)
        ) {
          owner = p;
          break;
        }
        if (
          ['StructSpecifier', 'ClassSpecifier', 'EnumSpecifier'].includes(p.name) &&
          p.getChild('TypeIdentifier')?.from === node.from
        ) {
          owner = p;
          break;
        }
        p = p.parent;
      }
      if (!owner) return;
      let boundary = scope(owner);
      if (param) {
        let f = owner.parent;
        while (f && f.name !== 'FunctionDefinition') f = f.parent;
        if (!f) return;
        boundary = f;
      }
      if (boundary && (pos < boundary.from || pos > boundary.to)) return;
      const label = text.slice(node.from, node.to);
      if (!/^[A-Za-z_]\w*$/.test(label)) return;
      const functionName =
        (owner.name === 'FunctionDefinition' && !param) ||
        node.parent?.name === 'FunctionDeclarator';
      result.push({
        label,
        type: functionName ? 'function' : owner.name === 'TypeDefinition' ? 'type' : 'variable',
        detail: text
          .slice(owner.from, Math.min(owner.to, owner.from + 180))
          .split('{')[0]
          .trim(),
      });
    },
  });
  for (const match of text.slice(0, pos).matchAll(/^\s*#\s*define\s+([A-Za-z_]\w*)/gm))
    result.push({ label: match[1], type: 'constant', detail: 'macro' });
  return result;
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
export function includedOptions(
  source: string,
  file: string,
  context: CompletionFiles,
): Completion[] {
  const options: Completion[] = [],
    seen = new Set<string>(),
    headers = new Set<string>();
  function visit(text: string, current: string) {
    for (const match of text.matchAll(/^\s*#\s*include\s*([<"])([^>"]+)[>"]/gm)) {
      const name = match[2],
        base = current.includes('/') ? current.slice(0, current.lastIndexOf('/')) : '';
      const paths = [...(match[1] === '"' ? [base] : []), ...context.includeDirs, ''].map((dir) =>
        normalize(dir + '/' + name),
      );
      const local = paths.find((p) => p !== undefined && Object.hasOwn(context.files, p));
      if (local !== undefined) {
        if (seen.has(local)) continue;
        seen.add(local);
        const text = context.files[local];
        options.push(...declarations(text));
        visit(text, local);
      } else headers.add(name);
    }
  }
  visit(source, file);
  for (const header of headers) {
    const mapped =
      header.startsWith('c') && standard[header.slice(1) + '.h'] ? header.slice(1) + '.h' : header;
    for (const signature of standard[mapped] ?? []) {
      const label = signature.slice(0, signature.indexOf('('));
      options.push({
        label,
        type: 'function',
        detail: signature,
        info: '#include <' + header + '>',
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
  const node = syntaxTree(context.state).resolveInner(context.pos, -1);
  if (/Comment|String|CharLiteral/.test(node.name)) return null;
  const word = context.matchBefore(/(?:std::)?[A-Za-z_]\w*/);
  if (!word && !context.explicit) return null;
  const text = context.state.doc.toString(),
    options: Completion[] = [
      ...(language === 'c' ? keywordsC : keywordsCpp).map((label) => ({ label, type: 'keyword' })),
      ...includedOptions(text.slice(0, context.pos), file, files),
      ...declarations(text, context.pos),
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
  const unique = new Map<string, Completion>();
  for (const option of options) unique.set(option.label, option);
  for (const s of snippets) unique.set(s.label, s);
  return {
    from: word?.from ?? context.pos,
    options: [...unique.values()],
    validFor: /^(?:std::)?\w*$/,
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
