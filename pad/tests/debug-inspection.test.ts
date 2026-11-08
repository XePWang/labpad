import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeDebugger } from '../core/debug/session';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
test('variables and watch replies are bound to a unique session and selected-frame inspection', async () => {
  const session = new NativeDebugger();
  let delayed: ReturnType<typeof deferred<any>> | undefined;
  let command = '';
  (session as any).connection = {
    request: async (name: string, args: any) => {
      if (name === command && delayed) {
        const pending = delayed;
        delayed = undefined;
        return pending.promise;
      }
      if (name === 'scopes')
        return { scopes: [{ name: 'Local', variablesReference: args.frameId, expensive: false }] };
      if (name === 'variables')
        return {
          variables: [
            { name: 'CURRENT_' + args.variablesReference, value: 'ok', variablesReference: 0 },
          ],
        };
      return { result: 'current', variablesReference: 0 };
    },
  };
  session.state.status = 'paused';
  await session.selectFrame(1);
  const old = session.state.inspectionId!;
  const pending = deferred<any>();
  delayed = pending;
  command = 'variables';
  const variables = session.variables(1, 0, old);
  const rejected = assert.rejects(variables, /Debug context has changed/);
  await session.selectFrame(2);
  pending.resolve({ variables: [{ name: 'OLD', value: 'stale' }] });
  await rejected;
  assert.equal(session.state.variables[0].name, 'CURRENT_2');
  await assert.rejects(session.variables(1, 0, old), /Debug context has changed/);
  const watchPending = deferred<any>();
  delayed = watchPending;
  command = 'evaluate';
  const watch = session.evaluate('value', session.state.inspectionId);
  const watchRejected = assert.rejects(watch, /Debug context has changed/);
  await session.selectFrame(1);
  assert.notEqual(session.state.inspectionId, old);
  watchPending.resolve({ result: 'OLD', variablesReference: 0 });
  await watchRejected;
  const other = new NativeDebugger();
  (other as any).connection = (session as any).connection;
  other.state.status = 'paused';
  await other.selectFrame(1);
  assert.notEqual(other.state.inspectionId, session.state.inspectionId);
  await assert.rejects(
    other.variables(1, 0, session.state.inspectionId),
    /Debug context has changed/,
  );
});
test('a delayed stack trace from an earlier pause cannot replace the latest frames', async () => {
  const session = new NativeDebugger(),
    old = deferred<any>();
  (session as any).connection = {
    request: async (command: string, args: any) => {
      if (command === 'stackTrace')
        return args.threadId === 1
          ? old.promise
          : { stackFrames: [{ id: 2, name: 'CURRENT', line: 2, column: 1 }] };
      if (command === 'scopes') return { scopes: [] };
      return {};
    },
  };
  const first = (session as any).event({ event: 'stopped', body: { threadId: 1 } });
  await (session as any).event({ event: 'continued', body: {} });
  await (session as any).event({ event: 'stopped', body: { threadId: 2 } });
  old.resolve({ stackFrames: [{ id: 1, name: 'OLD', line: 1, column: 1 }] });
  await first;
  assert.equal(session.state.selectedFrameId, 2);
  assert.equal(session.state.frames[0].name, 'CURRENT');
});
