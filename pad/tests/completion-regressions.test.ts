import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { cpp, cppLanguage } from '@codemirror/lang-cpp';
import { syntaxTree } from '@codemirror/language';
import { CompletionContext } from '@codemirror/autocomplete';
import { declarations, includedOptions, sourceCompletions } from '../src/editor/completion';
const empty = { files: {}, includeDirs: ['.'] };
function complete(input: string, files = empty, language: 'c' | 'cpp' = 'cpp') {
  const pos = input.indexOf('|'),
    doc = input.replace('|', ''),
    state = EditorState.create({ doc, extensions: [cpp()] });
  return sourceCompletions(new CompletionContext(state, pos, true), 'main.cpp', files, language);
}
function names(input: string) {
  const pos = input.indexOf('|'),
    doc = input.replace('|', ''),
    state = EditorState.create({ doc, extensions: [cpp()] });
  return declarations(doc, pos, syntaxTree(state));
}
test('declaration collection excludes references and keeps parameters in an unfinished function', () => {
  const source = 'int global; int helper(int number){ int count=0; return cou|; }';
  const symbols = names(source);
  assert.ok(!symbols.some((symbol) => symbol.label === 'cou'));
  assert.equal(symbols.find((symbol) => symbol.label === 'count')?.type, 'variable');
  assert.equal(symbols.find((symbol) => symbol.label === 'number')?.type, 'variable');
  assert.equal(symbols.find((symbol) => symbol.label === 'helper')?.type, 'function');
  const incomplete = names('int helper(int number){\n int count=0;\n num|');
  assert.ok(incomplete.some((symbol) => symbol.label === 'number'));
  assert.ok(incomplete.some((symbol) => symbol.label === 'count'));
});
test('typedef aliases, pointers and parenthesized function declarators retain their categories', () => {
  const symbols = names(
    'typedef Existing Alias; typedef int A,*B; int (*callback)(int); int (wrapped)(void); |',
  );
  assert.ok(!symbols.some((symbol) => symbol.label === 'Existing'));
  for (const alias of ['Alias', 'A', 'B'])
    assert.equal(symbols.find((symbol) => symbol.label === alias)?.type, 'type');
  assert.equal(symbols.find((symbol) => symbol.label === 'callback')?.type, 'variable');
  assert.equal(symbols.find((symbol) => symbol.label === 'wrapped')?.type, 'function');
});
test('headers export file and namespace declarations without leaking inline parameters or locals', () => {
  const files = {
    'api.h':
      'inline int helper(int number){int local=number;return local;}\nint top;\nnamespace course{inline int solve(int input){int hidden;return input;}}',
  };
  const symbols = includedOptions('#include "api.h"', 'main.cpp', { files, includeDirs: ['.'] });
  assert.ok(symbols.some((symbol) => symbol.label === 'helper'));
  assert.ok(symbols.some((symbol) => symbol.label === 'top'));
  assert.ok(symbols.some((symbol) => symbol.label === 'course::solve'));
  for (const name of ['number', 'local', 'course::input', 'course::hidden'])
    assert.ok(!symbols.some((symbol) => symbol.label === name));
});
test('namespace completion replaces only the unqualified word and filters other namespaces', () => {
  for (const input of ['#include <algorithm>\nstd::|', '#include <algorithm>\nstd::so|']) {
    const result = complete(input)!;
    assert.ok(result.options.some((option) => option.label === 'sort'));
    assert.ok(
      !result.options.some(
        (option) =>
          option.label === 'std::sort' || option.label === 'const' || option.label === 'for',
      ),
    );
    assert.equal(result.from, input.indexOf('|') - (input.includes('std::so') ? 2 : 0));
  }
  const result = complete('#include "api.h"\ncourse::|', {
    files: { 'api.h': 'namespace course{int solve(int input){return input;}}' },
    includeDirs: ['.'],
  })!;
  assert.deepEqual(
    result.options.map((option) => option.label),
    ['solve'],
  );
});
test('member access, comments and string literals do not suggest unrelated globals', () => {
  for (const input of [
    'int count; void f(){ item.c|; }',
    'int count; void f(){ item->c|; }',
    '// cou|',
    '"cou|',
    '/* cou| */',
  ])
    assert.equal(complete(input), null);
});
test('local declarations beat keyword candidates while exact keywords retain priority', () => {
  const result = complete('int count; void f(){ int counter; co|; }')!;
  const local = result.options.find((option) => option.label === 'counter')!,
    keyword = result.options.find((option) => option.label === 'const')!;
  assert.ok(local.boost! > keyword.boost!);
  const exact = complete('void f(){int constant; const|; }')!;
  assert.ok(
    exact.options.find((option) => option.label === 'const')!.boost! >
      exact.options.find((option) => option.label === 'constant')!.boost!,
  );
});
test('include discovery uses syntax nodes, preserving quoted-header shadowing and ignoring commented directives', () => {
  const result = includedOptions('/*\n#include <math.h>\n*/\n#include "stdio.h"', 'main.c', {
    files: { 'stdio.h': 'int course_print(void);' },
    includeDirs: ['.'],
  });
  assert.ok(result.some((option) => option.label === 'course_print'));
  assert.ok(!result.some((option) => option.label === 'sqrt' || option.label === 'printf'));
});
test('cached identical header text resolves nested includes relative to each actual path', () => {
  const files = {
    'a/api.h': '#include "detail.h"\nint api;',
    'b/api.h': '#include "detail.h"\nint api;',
    'a/detail.h': 'int first;',
    'b/detail.h': 'int second;',
  };
  const first = includedOptions('#include "api.h"', 'main.c', { files, includeDirs: ['a', 'b'] });
  assert.ok(first.some((option) => option.label === 'first'));
  const second = includedOptions('#include "api.h"', 'main.c', { files, includeDirs: ['b', 'a'] });
  assert.ok(second.some((option) => option.label === 'second'));
  assert.ok(!second.some((option) => option.label === 'first'));
});
test('active completion consumes the editor tree without manually parsing the active source', () => {
  const source = 'void f(){int count; co;}',
    pos = source.indexOf('co;') + 2,
    state = EditorState.create({ doc: source, extensions: [cpp()] });
  const parser = cppLanguage.parser,
    original = parser.parse;
  (parser as any).parse = () => {
    throw Error('Unexpected manual active parse');
  };
  try {
    assert.ok(
      sourceCompletions(
        new CompletionContext(state, pos, true),
        'main.c',
        empty,
        'c',
      )?.options.some((option) => option.label === 'count'),
    );
  } finally {
    (parser as any).parse = original;
  }
});
test('header parses are reused by content and released when workspace scope changes', () => {
  const header = 'int unique_header_fixture(void);',
    parser = cppLanguage.parser,
    original = parser.parse;
  let count = 0;
  (parser as any).parse = function (...args: any[]) {
    if (args[0] === header) count++;
    return (original as any).apply(this, args);
  };
  try {
    for (const scope of ['first', 'first', 'second'])
      includedOptions('#include "api.h"', 'main.c', {
        scope,
        files: { 'api.h': header },
        includeDirs: ['.'],
      });
    assert.equal(count, 2);
  } finally {
    (parser as any).parse = original;
  }
});

test('C++ c-prefixed standard headers expose guaranteed std namespace functions', () => {
  const result = complete('#include <cmath>\nstd::sq|')!;
  assert.ok(result.options.some((option) => option.label === 'sqrt'));
  const ordinary = complete('#include <cstdio>\npri|')!;
  assert.ok(ordinary.options.some((option) => option.label === 'std::printf'));
});
