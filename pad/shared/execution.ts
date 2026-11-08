import { t as localize } from './i18n';
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
      ready: localize('Ready'),
      changed: localize('Unsaved Changes'),
      compiled: localize('Compilation Successful'),
      ce: localize('Compilation Error · CE'),
      'compile-failed': localize('Compilation Failed'),
      'compile-not-started': localize('Compilation Not Started'),
      stopped: localize('Stopped'),
      tested: localize('Testing Complete'),
      'task-failed': localize('Task Failed'),
      'terminal-ended': localize('Debug Session Ended'),
      'terminal-failed': localize('Compilation or Debugging Failed'),
      'native-ended': localize('Debug Session Ended'),
      'native-failed': localize('Debugging Error'),
      'native-not-started': localize('Debugging Not Started'),
    }[state.outcome];
  if (state.stage === 'stopping') return localize('Stopping…');
  if (state.stage === 'stop-failed') return localize('Stop Failed; Try Again');
  if (state.kind === 'compile')
    return state.stage === 'preparing'
      ? localize('Preparing Compilation…')
      : localize('Compiling…');
  if (state.kind === 'judge') return localize('Running Test Cases…');
  return state.kind === 'native' || state.stage === 'preparing'
    ? localize('Starting Debugging…')
    : localize('Debugging');
}
export function nativeMessage(status: NativeDebugStatus) {
  return status === 'paused'
    ? localize('Debugging Paused')
    : status === 'running'
      ? localize('Debugging')
      : status === 'stop-failed'
        ? localize('Stop Failed; Try Again')
        : localize('Starting Debugging…');
}
