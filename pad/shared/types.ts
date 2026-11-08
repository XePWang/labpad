import type { Typography } from './typography';
import type { WorkspaceSnapshot, WorkspaceFile, ProjectBuildOptions } from './workspace';
export type Language = 'c' | 'cpp';
export type Verdict = 'AC' | 'WA' | 'CE' | 'RE' | 'TLE' | 'OLE';
export type Comparison =
  | { type: 'strictText'; ignoreTrailingSpaces?: boolean; ignoreFinalNewlines?: boolean }
  | { type: 'wcmp' }
  | { type: 'floatTokens'; absoluteTolerance?: number; relativeTolerance?: number };
export interface TestCase {
  id: string;
  input: string;
  expectedOutput: string;
  comparison?: Comparison;
}
export interface Problem {
  schemaVersion: 1;
  labId: string;
  problemId: string;
  title: string;
  timeLimitMs: number;
  outputLimitBytes: number;
  comparison: Comparison;
  testCases: TestCase[];
}
export interface CompilerConfig {
  mode: 'builtin' | 'custom';
  kind: 'zig' | 'gcc' | 'clang';
  cPath: string;
  cppPath: string;
  cArgs: string[];
  cppArgs: string[];
  linkArgs: string[];
}
export interface DetectedCompiler {
  id: string;
  name: string;
  version: string;
  target: string;
  compiler: CompilerConfig;
}
export interface LayoutConfig {
  editorPercent: number;
  outputPercent: number;
}
export interface EditorCursor {
  line: number;
  column: number;
  selectionChars: number;
  selectionLines: number;
  lines: number;
  focused: boolean;
}
export interface Config {
  typography?: Typography;
  schemaVersion: 1;
  classId: string;
  name: string;
  studentId: string;
  currentLab: string;
  currentProblem: string;
  language: Language;
  compiler: CompilerConfig;
  debugTimeLimitMs: number | null;
  terminalBufferLines: number;
  terminalHistoryBytes: number;
  saveMode: 'manual' | 'auto';
  sourceFile: string | null;
  indentSize: 1 | 2 | 4;
  theme: 'light' | 'dark';
  formatOnSave: boolean;
  completionEnabled?: boolean;
  layout: LayoutConfig;
  zoomFactor: number;
  shortcuts: Record<string, string[]>;
}
export type BuildTarget =
  | { mode: 'problem-set'; labId: string; problemId: string; documentId: string }
  | { mode: 'project'; labId: string };
export interface Draft {
  /** Explicit execution target; auxiliary editor tabs do not change it. */
  target?: BuildTarget;
  sourceFiles?: WorkspaceSnapshot;
  auxiliary?: boolean;
  file?: string;
  workspace?: WorkspaceSnapshot;
  documentId?: string;
  source: string;
  language: Language;
  problem: Problem;
}
export interface LoadedDraft extends Draft {
  sourceFile?: string;
  sourceEncoding?: string;
  warning?: string;
  name?: string;
}
export interface Project {
  labId: string;
  problems: string[];
  mode?: 'problem-set' | 'project';
}
export interface ProcessResult {
  code: number | null;
  signal: string | null;
  stdout: Buffer;
  stderr: Buffer;
  elapsedMs: number;
  reason?: 'timeout' | 'output' | 'cancelled';
  stderrTruncated: boolean;
}
export interface Compilation {
  status: 'success' | 'CE' | 'cancelled';
  stdout: string;
  stderr: string;
  command: string[];
  commands?: string[][];
  elapsedMs: number;
}
export interface CaseResult {
  id: string;
  verdict?: Exclude<Verdict, 'CE'>;
  status: 'completed' | 'cancelled' | 'error';
  elapsedMs: number;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  message: string;
}
export interface JudgeResult {
  status: 'completed' | 'cancelled' | 'error';
  compilation?: Compilation;
  cases: CaseResult[];
  error?: string;
  compiler: string;
  comparison: Comparison;
  selectedCaseIds?: string[];
}
export type JudgeEvent =
  | { type: 'compilation'; compilation: Compilation }
  | { type: 'case'; index: number; result: CaseResult };
export interface SaveResult {
  path: string;
  source: string;
  formatWarning?: string;
}
export interface SettingsResult {
  config: Config;
  dataRoot: string;
  compilerLabel: string;
  projects: Project[];
}
export interface Bootstrap extends SettingsResult {
  draft: LoadedDraft;
  sourcePath: string | null;
  version: string;
  warning?: string;
  documents: LoadedDraft[];
  workspace?: {
    files: WorkspaceFile[];
    expanded: string[];
    sidebarWidth: number;
    sidebarCollapsed: boolean;
    rightCollapsed?: boolean;
  };
}
export interface DebugState {
  status: 'compiling' | 'running' | 'exited' | 'stopped' | 'error';
  message?: string;
}
export type PathKind = 'directory' | 'executable';
export interface ExportVersion extends LoadedDraft {
  modifiedAt: number;
}
export interface ExportProblem {
  problemId: string;
  versions: ExportVersion[];
}
export interface ExportPreview {
  kind: 'source' | 'project';
  name: string;
  labId: string;
  files: { name: string; source: string; encoding?: 'base64' }[];
  warnings: string[];
}
export type TestState = '未测' | '部分已测' | '通过' | '未通过' | '需重测' | '运行中';
export interface Coverage {
  state: TestState;
  cases: CaseResult[];
}
export interface FileEvent {
  id: number;
  lab: string;
  changes: import('./file-changes').FileChange[];
  warnings?: string[];
  files: WorkspaceFile[];
}
export interface Bridge {
  terminalCommand(
    draft: Draft,
    text: string,
  ): Promise<{ cwd: string; output: string; clear?: boolean; needsSave?: boolean }>;
  terminalComplete(text: string): Promise<string[]>;
  nativeStart(
    draft: Draft,
    breakpoints: import('./debug').SourceBreakpoint[],
  ): Promise<{
    started: boolean;
    needsBuild?: boolean;
    compilation?: Compilation;
    sources?: Record<string, string>;
  }>;
  nativeControl(
    action: 'continue' | 'pause' | 'next' | 'stepIn' | 'stepOut',
  ): Promise<import('./debug').NativeDebugState>;
  nativeStop(): Promise<void>;
  nativeFrame(id: number): Promise<import('./debug').NativeDebugState>;
  nativeVariables(reference: number, start?: number): Promise<import('./debug').DebugVariable[]>;
  nativeWatch(expression: string): Promise<import('./debug').DebugVariable>;
  nativeBreakpoints(
    values: import('./debug').SourceBreakpoint[],
  ): Promise<import('./debug').NativeDebugState | undefined>;
  nativeView(
    lab: string,
    value?: { breakpoints: import('./debug').SourceBreakpoint[]; watches: string[] },
  ): Promise<{ breakpoints: import('./debug').SourceBreakpoint[]; watches: string[] }>;
  onNativeState(callback: (state: import('./debug').NativeDebugState) => void): () => void;
  onNativeDiagnostic(callback: (data: string) => void): () => void;

  completionFiles(
    lab: string,
    problem: string,
  ): Promise<{ files: Record<string, string>; includeDirs: string[] }>;
  fileContext(
    lab: string,
    problem: string,
    files: string[],
    action: 'copy' | 'relative' | 'reveal',
  ): Promise<string[]>;
  confirmExternal(file: string): Promise<boolean>;
  droppedFilePath(file: File): string;
  fileView(
    lab: string,
    value: {
      expanded?: string[];
      sidebarWidth?: number;
      sidebarCollapsed?: boolean;
      rightCollapsed?: boolean;
    },
  ): Promise<void>;
  fileOperation(
    lab: string,
    problem: string,
    request: import('../core/files').FileRequest,
  ): Promise<FileEvent>;
  onFiles(callback: (event: FileEvent) => void): () => void;
  buildPreview(
    draft: Draft,
    options?: ProjectBuildOptions,
    machine?: CompilerConfig,
  ): Promise<import('../core/build/plan').BuildPreview>;
  resetZoom(): Promise<void>;
  onZoom(callback: (value: number) => void): () => void;
  workspaceSources(lab: string, lpmake: string): Promise<string[]>;
  workspaceFiles(lab: string): Promise<WorkspaceFile[]>;
  workspaceOpen(lab: string, file: string): Promise<LoadedDraft>;

  workspaceView(
    lab: string,
    value: {
      openFiles?: string[];
      activeFile?: string;
      expanded?: string[];
      sidebarWidth?: number;
      sidebarCollapsed?: boolean;
      rightCollapsed?: boolean;
    },
  ): Promise<void>;
  projectBuildOptions(lab: string): Promise<ProjectBuildOptions | undefined>;
  saveProjectBuildOptions(lab: string, value: ProjectBuildOptions): Promise<void>;
  deleteProject(lab: string): Promise<boolean>;

  recentSource(lab: string, problem: string, closed: string[]): Promise<LoadedDraft | null>;
  exportChoices(buffers: Draft[]): Promise<ExportProblem[]>;
  exportPreview(
    kind: 'source' | 'project',
    drafts: Draft[],
    includeConfig?: boolean,
  ): Promise<ExportPreview>;
  writeExport(value: ExportPreview): Promise<string | null>;
  checkState(draft: Draft): Promise<Coverage>;
  problemStates(draft: Draft, buffers: Draft[]): Promise<Record<string, TestState>>;
  saveProblem(problem: Problem): Promise<void>;
  bootstrap(): Promise<Bootstrap>;
  reloadDocument(): Promise<Bootstrap>;
  saveDraft(draft: Draft): Promise<SaveResult>;
  formatCode(source: string, language: Language, indentSize: number): Promise<string>;
  documentState(draft: Draft, dirty: boolean): void;
  loadDraft(
    labId: string,
    problemId: string,
    language: Language,
    preferStored?: boolean,
  ): Promise<LoadedDraft>;
  projects(): Promise<Project[]>;
  createLab(name: string, mode?: 'problem-set' | 'project'): Promise<Draft>;
  createProblem(lab: string, name: string, language: Language): Promise<Draft>;
  openDocuments(lab: string, problem: string, language: Language): Promise<LoadedDraft[]>;
  activateDocument(id: string, file?: string): Promise<void>;
  newVersion(draft: Draft, fromTemplate?: boolean): Promise<LoadedDraft>;
  copyPath(value: string, relative: boolean): Promise<void>;
  copyText(value: string): Promise<void>;
  workspaceState(drafts: Draft[], dirty: boolean): void;
  openShortcuts(): Promise<void>;
  shortcutSettings(): Promise<{
    shortcuts: Record<string, string[]>;
    theme: 'light' | 'dark';
    platform: string;
  }>;
  saveShortcuts(value: Record<string, string[]>): Promise<void>;
  onShortcuts(callback: (value: Record<string, string[]>) => void): () => void;
  clearCache(): Promise<number>;
  saveConfig(
    config: Config,
    dataRoot: string,
    project?: { lab: string; options: ProjectBuildOptions },
  ): Promise<SettingsResult>;
  compilerInfo(config: CompilerConfig): Promise<string>;
  detectCompilers(): Promise<DetectedCompiler[]>;
  saveLayout(layout: LayoutConfig): Promise<LayoutConfig>;
  importSource(destination?: string): Promise<{
    source: string;
    language: Language;
    encoding: string;
    path: string;
    document: LoadedDraft;
    reused?: boolean;
  } | null>;
  confirmUnsaved(): Promise<'save' | 'discard' | 'cancel'>;
  validatePath(
    value: string,
    kind: PathKind,
    allowEmpty?: boolean,
  ): Promise<{ valid: boolean; message: string }>;
  choosePath(kind: PathKind, current: string): Promise<string | null>;
  revealPath(value: string, kind: PathKind): Promise<void>;
  revealSource(file: string): Promise<void>;
  importIO(labId: string, problemId: string): Promise<Problem | null>;
  importProject(): Promise<
    (Bootstrap & { updatedProblems?: Problem[]; editBuild?: boolean }) | null
  >;
  exportTests(kind: 'current' | 'project', problem: Problem): Promise<string | null>;
  showProblemFile(draft: Draft): Promise<void>;
  compile(draft: Draft): Promise<Compilation>;
  compileState(draft: Draft): Promise<{ saved: boolean; ready: boolean }>;
  confirmCompile(): Promise<boolean>;
  confirmRestart(): Promise<boolean>;
  judge(draft: Draft, ids?: string[]): Promise<JudgeResult>;
  cancel(): Promise<void>;
  debugStart(draft: Draft): Promise<void>;
  debugInput(data: string): void;
  debugResize(cols: number, rows: number): void;
  debugStop(): Promise<void>;
  onJudge(callback: (event: JudgeEvent) => void): () => void;
  onDebugData(callback: (data: string, ack: () => void) => void): () => void;
  onDebugState(callback: (state: DebugState) => void): () => void;
}
