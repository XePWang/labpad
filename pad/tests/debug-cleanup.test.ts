import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { NativeDebugger } from '../core/debug/session';
test('native stop failures retain process ownership and allow a clean retry without exit-listener leaks', async () => {
  const child = Object.assign(new EventEmitter(), {
    pid: 123,
    exitCode: null as number | null,
    signalCode: null,
  });
  let attempts = 0;
  const session = new NativeDebugger(async () => {
    if (++attempts === 1) throw Error('Injected adapter stop failure');
    child.exitCode = 0;
    child.emit('exit', 0);
  });
  (session as any).child = child;
  await assert.rejects(session.stop(), /Injected/);
  assert.equal(session.state.status, 'stop-failed');
  assert.equal((session as any).child, child);
  assert.equal(child.listenerCount('exit'), 0);
  await session.stop();
  await session.finished;
  assert.equal(attempts, 2);
  assert.equal(session.state.status, 'ended');
  assert.equal((session as any).child, undefined);
  assert.equal(child.listenerCount('exit'), 0);
});
