import test from 'node:test';
import assert from 'node:assert/strict';
import type { IPty } from 'node-pty';
import { managePty, type PtyExit } from '../core/pty-session';
function fake() {
  const data = new Set<(value: string) => void>(),
    exit = new Set<(value: PtyExit) => void>();
  let pauses = 0,
    resumes = 0;
  const child = {
    pid: 123,
    onData: (listener: (value: string) => void) => {
      data.add(listener);
      return { dispose: () => data.delete(listener) };
    },
    onExit: (listener: (value: PtyExit) => void) => {
      exit.add(listener);
      return { dispose: () => exit.delete(listener) };
    },
    pause: () => pauses++,
    resume: () => resumes++,
  } as unknown as IPty;
  return {
    child,
    data: (text: string) => [...data].forEach((fn) => fn(text)),
    exit: () => [...exit].forEach((fn) => fn({ exitCode: 0 })),
    counts: () => ({ pauses, resumes, data: data.size, exit: exit.size }),
  };
}
test('PTY output batching, acknowledgement and exit cleanup use the same lifecycle', async () => {
  const process = fake(),
    chunks: string[] = [];
  let kills = 0;
  const managed = managePty(process.child, {
    data: (text) => chunks.push(text),
    terminate: async () => {
      kills++;
      process.exit();
    },
  });
  process.data('x'.repeat(270000));
  assert.equal(process.counts().pauses, 1);
  managed.acknowledge(270000);
  assert.equal(process.counts().resumes, 1);
  process.data('last');
  process.exit();
  assert.equal((await managed.finished).exitCode, 0);
  assert.equal(chunks.join(''), 'x'.repeat(270000) + 'last');
  assert.equal(process.counts().data, 0);
  assert.equal(process.counts().exit, 0);
  await managed.stop();
  assert.equal(kills, 0);
  managed.acknowledge(1);
  assert.equal(process.counts().resumes, 1);
});
test('a failed PTY stop remains owned and can be retried without a rejected queue tail', async () => {
  const process = fake();
  let attempts = 0;
  const managed = managePty(process.child, {
    data: () => {},
    terminate: async () => {
      if (++attempts === 1) throw Error('Injected stop failure');
      process.exit();
    },
  });
  await assert.rejects(managed.stop(), /Injected/);
  assert.equal(process.counts().exit, 1);
  await Promise.all([managed.stop(), managed.stop()]);
  assert.equal(attempts, 2);
  await managed.finished;
});
test('a successful kill request without an exit notification is not treated as stopped', async () => {
  const process = fake();
  const managed = managePty(process.child, {
    data: () => {},
    terminate: async () => {},
    stopTimeoutMs: 5,
  });
  await assert.rejects(managed.stop(), /尚未退出/);
  assert.equal(process.counts().exit, 1);
  process.exit();
  await managed.stop();
  assert.equal(process.counts().exit, 0);
});
