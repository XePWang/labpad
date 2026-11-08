import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import lockfile from 'proper-lockfile';
import { directorySnapshot } from '../core/workspace-files';
import { Compiler } from '../core/compiler';
import { runGrade } from '../cli/grade';

test('directory snapshots enforce actual bytes even if path metadata is stale', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'labpad-snapshot-race-')),
    lstat = fs.lstat;
  try {
    const file = path.join(root, 'data.bin');
    await fs.writeFile(file, Buffer.alloc(8 * 1024 ** 2 + 1, 255));
    (fs as any).lstat = async (p: any, ...args: any[]) => {
      const value = await (lstat as any)(p, ...args);
      if (String(p) === file)
        return new Proxy(value, { get: (t, k) => (k === 'size' ? 1 : Reflect.get(t, k)) });
      return value;
    };
    syncBuiltinESMExports();
    await assert.rejects(directorySnapshot(root), /8 MB|64 ?MB|大小限制|4096/);
  } finally {
    (fs as any).lstat = lstat;
    syncBuiltinESMExports();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('CLI single judge rejects oversized source and ZIP without readFile allocation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'labpad-cli-read-budget-'));
  try {
    const tests = path.join(root, 'tests.json'),
      hook = path.join(root, 'hook.cjs');
    await fs.writeFile(
      tests,
      JSON.stringify({ schemaVersion: 1, kind: 'labpad.testCases', testCases: [] }),
    );
    await fs.writeFile(
      hook,
      `const fs=require('node:fs/promises'),read=fs.readFile;fs.readFile=async function(file,...args){if(String(file)===process.env.PROBE_FILE)throw Error('UNBOUNDED_READ');return read.call(this,file,...args)};require('node:module').syncBuiltinESMExports();`,
    );
    for (const [flag, name, size, reason] of [
      ['--source', 'large.c', 8 * 1024 ** 2 + 1, /8 MB/],
      ['--project', 'large.zip', 100 * 1024 ** 2 + 1, /100 MB/],
    ] as const) {
      const file = path.join(root, name),
        handle = await fs.open(file, 'w');
      await handle.truncate(size);
      await handle.close();
      const result = spawnSync(
        process.execPath,
        [
          '--require',
          hook,
          path.resolve('../.work/build/cli/labpad.cjs'),
          'judge',
          flag,
          file,
          '--tests',
          tests,
        ],
        { env: { ...process.env, PROBE_FILE: file }, encoding: 'utf8', timeout: 10000 },
      );
      assert.equal(result.status, 2, result.stderr);
      assert.doesNotMatch(result.stderr, /UNBOUNDED_READ/);
      assert.match(result.stderr, reason);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('batch cleanup retains the original error and releases grade lock when compiler dispose fails', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'labpad-grade-cleanup-')),
    info = Compiler.prototype.info,
    dispose = Compiler.prototype.dispose;
  try {
    await fs.mkdir(path.join(root, 'submit'));
    await fs.writeFile(
      path.join(root, 'project.json'),
      JSON.stringify({
        schemaVersion: 1,
        kind: 'labpad.project',
        labId: 'Fixture',
        problems: [{ problemId: 'one', testCases: [{ id: 'one', input: '', expectedOutput: '' }] }],
      }),
    );
    await fs.writeFile(path.join(root, 'roster.csv'), '序号,学号,姓名\n1,7355608,示例\n');
    await fs.writeFile(
      path.join(root, 'grade.json'),
      JSON.stringify({
        schemaVersion: 1,
        project: 'project.json',
        roster: 'roster.csv',
        weights: { one: 1 },
        compiler: { kind: 'gcc' },
        isolation: 'none',
      }),
    );
    (Compiler.prototype as any).info = async () => {
      throw Error('primary compiler diagnostic');
    };
    Compiler.prototype.dispose = async function () {
      await dispose.call(this);
      throw Error('cleanup fixture EBUSY');
    };
    let failure: any;
    try {
      await runGrade(root, { toolchain: '', checkers: '' });
    } catch (error) {
      failure = error;
    }
    const locked = await lockfile.check(path.join(root, 'grade.json'));
    if (locked) await lockfile.unlock(path.join(root, 'grade.json'));
    assert.match(failure?.message ?? '', /primary compiler diagnostic/);
    assert.match(failure.message, /cleanup fixture EBUSY/);
    assert.equal(locked, false, 'grade lock was skipped');
  } finally {
    Compiler.prototype.info = info;
    Compiler.prototype.dispose = dispose;
    await fs.rm(root, { recursive: true, force: true });
  }
});
