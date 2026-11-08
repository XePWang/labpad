import test from 'node:test';
import assert from 'node:assert/strict';
import { finish, taskBusy, taskMessage, type ExecutionState } from '../shared/execution';
test('an old completion cannot clear a new task; idle outcome and controls come from the same state', () => {
  const current: ExecutionState = { kind: 'judge', id: 2, stage: 'running' };
  assert.equal(finish(current, 1, 'stopped'), current);
  assert.equal(taskBusy(current), 'judge');
  assert.equal(taskMessage(current), '运行测试点…');
  const failed = finish(current, 2, 'task-failed');
  assert.equal(taskBusy(failed), null);
  assert.equal(taskMessage(failed), '任务错误');
  const stopping: ExecutionState = { kind: 'terminal', id: 3, stage: 'stop-failed' };
  assert.equal(taskBusy(stopping), 'debug');
  assert.equal(taskMessage(stopping), '停止失败，请重试');
});
