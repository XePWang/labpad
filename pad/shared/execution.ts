import type { NativeDebugStatus } from './debug';
export type TaskKind = 'compile' | 'judge' | 'terminal' | 'native';
export type Outcome =
  | 'ready'
  | 'changed'
  | 'compiled'
  | 'ce'
  | 'compile-failed'
  | 'compile-not-started'
  | 'stopped'
  | 'tested'
  | 'task-failed'
  | 'terminal-ended'
  | 'terminal-failed'
  | 'native-ended'
  | 'native-failed'
  | 'native-not-started';
export type ExecutionState =
  | { kind: 'idle'; outcome: Outcome }
  | { kind: TaskKind; id: number; stage: 'preparing' | 'running' | 'stopping' | 'stop-failed' };
export const idle = (outcome: Outcome = 'ready'): ExecutionState => ({ kind: 'idle', outcome });
export function finish(state: ExecutionState, id: number, outcome: Outcome): ExecutionState {
  return state.kind !== 'idle' && state.id === id ? idle(outcome) : state;
}
export function taskBusy(state: ExecutionState): 'compile' | 'judge' | 'debug' | null {
  return state.kind === 'idle' || state.kind === 'native'
    ? null
    : state.kind === 'terminal'
      ? 'debug'
      : state.kind;
}
export function taskMessage(state: ExecutionState): string {
  if (state.kind === 'idle')
    return {
      ready: '准备就绪',
      changed: '内容已修改',
      compiled: '编译成功',
      ce: '编译失败 · CE',
      'compile-failed': '编译失败',
      'compile-not-started': '编译未启动',
      stopped: '已停止',
      tested: '测试完成',
      'task-failed': '任务错误',
      'terminal-ended': '调试结束',
      'terminal-failed': '编译或调试失败',
      'native-ended': '调试结束',
      'native-failed': '调试错误',
      'native-not-started': '调试未启动',
    }[state.outcome];
  if (state.stage === 'stopping') return '正在停止…';
  if (state.stage === 'stop-failed') return '停止失败，请重试';
  if (state.kind === 'compile') return state.stage === 'preparing' ? '准备编译…' : '编译中…';
  if (state.kind === 'judge') return '运行测试点…';
  return state.kind === 'native' || state.stage === 'preparing' ? '正在启动调试…' : '调试运行中';
}
export function nativeMessage(status: NativeDebugStatus) {
  return status === 'paused'
    ? '调试已暂停'
    : status === 'running'
      ? '调试运行中'
      : status === 'stop-failed'
        ? '停止失败，请重试'
        : '正在启动调试…';
}
