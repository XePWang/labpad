import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import writeAtomic from '../core/atomic-file';
async function fixture(run: (file: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-atomic-retry-'));
  try {
    const file = path.join(root, 'state.json');
    await writeFile(file, 'original');
    await run(file);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test('Windows transient rename retries preserve submission order across the whole atomic write', async () =>
  fixture(async (file) => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!,
      rename = fs.rename;
    let attempts = 0;
    try {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      (fs as any).rename = (...args: any[]) => {
        attempts++;
        const done = args.at(-1);
        if (attempts <= 3)
          queueMicrotask(() =>
            done(Object.assign(Error('temporarily locked'), { code: 'EPERM', syscall: 'rename' })),
          );
        else (rename as any)(...args);
      };
      const first = writeAtomic(file, 'first'),
        second = writeAtomic(file, 'second');
      await Promise.all([first, second]);
      assert.equal(await readFile(file, 'utf8'), 'second');
      assert.equal(attempts, 5);
      assert.deepEqual(await readdir(path.dirname(file)), ['state.json']);
    } finally {
      Object.defineProperty(process, 'platform', descriptor);
      fs.rename = rename;
    }
  }));
test('persistent Windows rename failures retain original bytes, reject within a fixed retry budget and allow later saves', async () =>
  fixture(async (file) => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!,
      rename = fs.rename;
    let attempts = 0;
    try {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      (fs as any).rename = (...args: any[]) => {
        attempts++;
        queueMicrotask(() =>
          args.at(-1)(Object.assign(Error('still locked'), { code: 'EACCES', syscall: 'rename' })),
        );
      };
      await assert.rejects(writeAtomic(file, 'replacement'), (e: any) => e.code === 'EACCES');
      assert.equal(attempts, 5);
      assert.equal(await readFile(file, 'utf8'), 'original');
      assert.deepEqual(await readdir(path.dirname(file)), ['state.json']);
      fs.rename = rename;
      await writeAtomic(file, 'retry');
      assert.equal(await readFile(file, 'utf8'), 'retry');
    } finally {
      Object.defineProperty(process, 'platform', descriptor);
      fs.rename = rename;
    }
  }));
test('POSIX failures and non-rename Windows errors do not retry', async () =>
  fixture(async (file) => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!,
      rename = fs.rename;
    let attempts = 0;
    try {
      for (const [platform, syscall] of [
        ['linux', 'rename'],
        ['win32', 'open'],
      ]) {
        attempts = 0;
        Object.defineProperty(process, 'platform', { value: platform });
        (fs as any).rename = (...args: any[]) => {
          attempts++;
          queueMicrotask(() =>
            args.at(-1)(Object.assign(Error('failure'), { code: 'EPERM', syscall })),
          );
        };
        await assert.rejects(writeAtomic(file, 'replacement'));
        assert.equal(attempts, 1);
        assert.equal(await readFile(file, 'utf8'), 'original');
      }
    } finally {
      Object.defineProperty(process, 'platform', descriptor);
      fs.rename = rename;
    }
  }));
