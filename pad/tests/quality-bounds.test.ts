import { syncBuiltinESMExports } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { Storage } from '../core/storage';
import { readProjectArchive } from '../core/project-archive';
import { collectProjects } from '../cli/projects';
import { Compiler } from '../core/compiler';
import { judge } from '../core/judge';
import { defaultConfig, defaultProblem } from '../shared/defaults';
import { outputDiff } from '../src/editor/output-diff';
import { cleanupAll } from '../core/cleanup';
test('editor source and auxiliary paths reject metadata oversize before reading contents', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'labpad-editor-budget-'));
  try {
    const store = new Storage(root);
    await store.init();
    await store.workspace.create('项目', 'c');
    await store.importProject({
      schemaVersion: 1,
      kind: 'labpad.project',
      labId: '题集',
      problems: [{ problemId: 'one' }],
    });
    for (const file of [
      path.join(store.workspace.root('项目'), 'large.txt'),
      path.join(store.paths('题集', 'one', 'c').dir, 'large.txt'),
      path.join(store.paths('题集', 'one', 'c').dir, 'one.c'),
    ]) {
      const h = await fs.open(file, 'w');
      await h.truncate(8 * 1024 * 1024 + 1);
      await h.close();
    }
    await assert.rejects(store.workspace.open('项目', 'large.txt'), /8 MB/);
    await assert.rejects(store.openFile('题集', 'one', 'large.txt'), /8 MB/);
    await assert.rejects(store.load('题集', 'one', 'c', true), /8 MB/);
    assert.match((await store.workspace.open('项目', 'main.c')).source, /main/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('GUI and CLI project intake reject oversized compressed ZIP before decoding', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'labpad-zip-budget-'));
  try {
    const submit = path.join(root, 'submit');
    await fs.mkdir(submit);
    const file = path.join(submit, '7355608.zip');
    const h = await fs.open(file, 'w');
    await h.truncate(100 * 1024 * 1024 + 1);
    await h.close();
    await assert.rejects(readProjectArchive(file), /100 MB/);
    const value = await collectProjects(
      submit,
      path.join(root, 'src'),
      [{ studentId: '7355608', name: '示例' }] as any,
      '项目',
    );
    assert.equal(value.candidates.length, 0);
    assert.ok(value.issues.some((i) => i.message.includes('100 MB')));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('large or adversarial Diff stays bounded and preserves original strings', () => {
  const expected = Array.from({ length: 6000 }, (_, i) => 'a' + i).join(' '),
    actual = Array.from({ length: 6000 }, (_, i) => 'b' + i).join(' ');
  const before = performance.now(),
    view = outputDiff(expected, actual);
  assert.ok(performance.now() - before < 1500, 'library work budget exceeded');
  assert.ok(view.note);
  const long = 'x'.repeat(300000),
    preview = outputDiff(long, 'y'.repeat(300000));
  assert.match(preview.note, /预览/);
  assert.ok(preview.parts.reduce((n, p) => n + p.value.length, 0) <= 100000);
  assert.equal(long.length, 300000);
  assert.equal(outputDiff('one two', 'one three').note, '');
});
test('cleanup attempts every release even after synchronous and asynchronous failures', async () => {
  const calls: string[] = [];
  const notes = await cleanupAll([
    {
      label: 'a',
      run: () => {
        calls.push('a');
        throw Error('first');
      },
    },
    {
      label: 'b',
      run: async () => {
        calls.push('b');
        throw Error('second');
      },
    },
    {
      label: 'c',
      run: async function () {
        assert.equal(arguments.length,0);
        calls.push('c');
      },
    },
  ]);
  assert.deepEqual(calls, ['a', 'b', 'c']);
  assert.equal(notes.length, 2);
});
test('judging preserves AC or the original checker error when both cleanups fail', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'labpad-judge-release-')),
    rm = fs.rm;
  let released = 0;
  try {
    (fs as any).rm = async (p: any, ...args: any[]) => {
      if (path.basename(String(p)).startsWith('tests-'))
        throw Object.assign(Error('test directory busy'), { code: 'EBUSY' });
      return (rm as any)(p, ...args);
    };
    syncBuiltinESMExports();
    const problem = defaultProblem('audit', 'one');
    problem.testCases = [{ id: 'one', input: '', expectedOutput: '' }];
    problem.comparison = { type: 'strictText' };
    const compiler: any = {
      paths: { isolation: 'none', checkers: path.join(root, 'missing-checker') },
      forDraft: async (_: any, c: any) => c,
      environment: async () => process.env,
      compile: async () => ({
        directory: root,
        executable: process.execPath,
        compilation: {
          status: 'success',
          command: ['fixture'],
          stdout: '',
          stderr: '',
          elapsedMs: 0,
        },
        cleanup: async () => {
          released++;
          throw Error('compile directory busy');
        },
      }),
    };
    let result = await judge(
      compiler,
      { source: '', language: 'c', problem },
      defaultConfig().compiler,
    );
    assert.equal(result.status, 'completed');
    assert.equal(result.cases[0]?.verdict, 'AC');
    assert.equal(result.cleanupWarnings?.length, 2);
    problem.comparison = { type: 'wcmp' };
    result = await judge(
      compiler,
      { source: '', language: 'c', problem },
      defaultConfig().compiler,
    );
    assert.equal(result.status, 'error');
    assert.match(result.error ?? '', /ENOENT/);
    assert.equal(result.cleanupWarnings?.length, 2);
    assert.equal(released, 2);
  } finally {
    (fs as any).rm = rm;
    syncBuiltinESMExports();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('compiler launch failure retains ENOENT while reporting directory and lease cleanup faults', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'labpad-compile-release-')),
    rm = fs.rm;
  const c = new Compiler({
    toolchain: path.join(root, 'missing'),
    checkers: '',
    workDirectory: root,
    cacheDirectory: path.join(root, 'cache'),
  });
  let releases = 0;
  try {
    (c.cache as any).acquire = async () => async () => {
      releases++;
      throw Error('lease release failed');
    };
    (c.cache as any).trim = async () => {};
    (fs as any).rm = async (p: any, ...args: any[]) => {
      if (path.basename(String(p)).startsWith('run-')) throw Error('compile directory busy');
      return (rm as any)(p, ...args);
    };
    syncBuiltinESMExports();
    await assert.rejects(
      c.compile('int main(void){}', 'c', defaultConfig().compiler),
      (error: any) => {
        assert.equal(error.code, 'ENOENT');
        assert.match(error.message, /compile directory busy/);
        assert.match(error.message, /lease release failed/);
        return true;
      },
    );
    assert.equal(releases, 1);
  } finally {
    (fs as any).rm = rm;
    syncBuiltinESMExports();
    await c.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('test-point transaction retains its write error if staging cleanup also fails', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'labpad-test-update-release-')),
    rm = fs.rm;
  const store = new Storage(root);
  await store.init();
  await store.importProject({
    schemaVersion: 1,
    kind: 'labpad.project',
    labId: 'CleanupSet',
    problems: [{ problemId: 'one' }],
  });
  const original = (store as any).atomic;
  let attempts = 0;
  try {
    const draft = await store.load('CleanupSet', 'one', 'c', true);
    draft.problem.timeLimitMs = 2468;
    (store as any).atomic = async () => {
      throw Object.assign(Error('test rules write failed'), { code: 'ENOSPC' });
    };
    (fs as any).rm = async (file: any, ...args: any[]) => {
      if (path.basename(String(file)).startsWith('.tests-')) {
        attempts++;
        throw Error('test stage busy');
      }
      return (rm as any)(file, ...args);
    };
    syncBuiltinESMExports();
    await assert.rejects(store.updateProjectTests('CleanupSet', [draft.problem]), (error: any) => {
      assert.equal(error.code, 'ENOSPC');
      assert.match(error.message, /test rules write failed/);
      assert.match(error.message, /test stage busy/);
      return true;
    });
    assert.equal(attempts, 1);
    (store as any).atomic = original;
    (fs as any).rm = rm;
    syncBuiltinESMExports();
    assert.equal((await store.load('CleanupSet', 'one', 'c', true)).problem.timeLimitMs, 1000);
    await store.updateProjectTests('CleanupSet', [draft.problem]);
    assert.equal((await store.load('CleanupSet', 'one', 'c', true)).problem.timeLimitMs, 2468);
  } finally {
    (store as any).atomic = original;
    (fs as any).rm = rm;
    syncBuiltinESMExports();
    await fs.rm(root, { recursive: true, force: true });
  }
});
