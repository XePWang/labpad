export interface SourceBreakpoint {
  path: string;
  line: number;
  enabled: boolean;
  condition?: string;
  verified?: boolean;
  resolvedLine?: number;
  message?: string;
  adapterId?: number;
}
export interface DebugFrame {
  id: number;
  name: string;
  path?: string;
  line: number;
  column: number;
}
export interface DebugVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
  namedVariables?: number;
  indexedVariables?: number;
  evaluateName?: string;
}
export interface DebugScope {
  name: string;
  variablesReference: number;
  expensive: boolean;
}
export type NativeDebugStatus =
  'idle' | 'starting' | 'running' | 'paused' | 'ended' | 'error' | 'stop-failed';
export interface NativeDebugState {
  status: NativeDebugStatus;
  processId?: number;
  message?: string;
  threadId?: number;
  frames: DebugFrame[];
  scopes: DebugScope[];
  variables: DebugVariable[];
  breakpoints: SourceBreakpoint[];
  selectedFrameId?: number;
  conditionalBreakpoints: boolean;
}
