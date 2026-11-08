import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { Compiler } from '../core/compiler';
import { runProcess } from '../core/process';
import { defaultCompilerConfig } from '../shared/defaults';

test('single-source language flags stop before object inputs without trailing resets for library options', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-link inputs-'));
  const compiler = new Compiler({
    toolchain: '',
    checkers: '',
    workDirectory: root,
    cacheDirectory: path.join(root, 'cache'),
  });
  const config = {
    ...defaultCompilerConfig('gcc'),
    mode: 'custom' as const,
    cPath: '/usr/bin/gcc',
    cppPath: '/usr/bin/g++',
  };
  try {
    const library = await compiler.compile('int main(void){return 0;}', 'c', {
      ...config,
      linkArgs: ['-L', root, '-l', 'm'],
    });
    try {
      assert.equal(library.compilation.status, 'success', library.compilation.stderr);
      assert.equal(
        library.compilation.command.includes('none'),
        false,
        'a library-only link must not emit a redundant language reset',
      );
    } finally {
      await library.cleanup();
    }
    const source = path.join(root, 'answer.c'),
      object = path.join(root, 'answer.o');
    await writeFile(source, 'int answer(void){return 42;}');
    const built = spawnSync(config.cPath, ['-c', source, '-o', object], { encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    const linked = await compiler.compile(
      'int answer(void);int main(void){return answer()==42?0:1;}',
      'c',
      { ...config, linkArgs: [object, '-lm'] },
    );
    try {
      assert.equal(linked.compilation.status, 'success', linked.compilation.stderr);
      assert.ok(linked.compilation.command.includes('none'));
      assert.ok(
        linked.compilation.command.indexOf('none') < linked.compilation.command.indexOf(object),
      );
      const result = await runProcess(linked.executable, [], {
        cwd: linked.directory,
        timeLimitMs: 5000,
        outputLimitBytes: 4096,
      });
      assert.equal(result.code, 0, result.stderr.toString());
    } finally {
      await linked.cleanup();
    }
  } finally {
    await compiler.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
