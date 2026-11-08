<script setup lang="ts">
import { t, uiLanguage, setLanguage, msg, errorText, type UIText, UIError } from './i18n';
import type { CompletionFiles } from '../shared/types';
import { isHeaderFile } from '../shared/file-language';
import {
  idle,
  finish,
  taskBusy,
  taskMessage,
  nativeMessage,
  type ExecutionState,
  type TaskKind,
  type Outcome,
} from '../shared/execution';
import { remapPath, replacedPath } from '../shared/file-changes';
import {
  isSourceFile,
  isCodeFile,
  editorLanguage as languageForFile,
} from '../shared/file-language';
import { DialogRoot, DialogContent, DialogTitle } from 'reka-ui';
import { computed, onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue';
import { Splitpanes, Pane, type SplitpanesResizedPayload } from 'splitpanes';
import 'splitpanes/dist/splitpanes.css';
import TypographySettings from './components/TypographySettings.vue';
import { defaultTypography } from '../shared/typography';
import { useTypography } from './typography';
import NativeDebugPanel from './components/NativeDebugPanel.vue';
import type { NativeDebugState, SourceBreakpoint } from '../shared/debug';
import ActionIcon from './components/ActionIcon.vue';
import type { FileRequest } from '../core/files';
import FileTree from './components/FileTree.vue';
import ProjectSelect from './components/ProjectSelect.vue';
import ZoomSelect from './components/ZoomSelect.vue';
import BuildSettings from './components/BuildSettings.vue';
import ParameterSettings from './components/ParameterSettings.vue';
import { parse, editArgument } from '../shared/lpmake';
import type { WorkspaceFile, WorkspaceEdit, ProjectBuildOptions } from '../shared/workspace';
import CodeEditor from './components/CodeEditor.vue';
import DialogActions from './components/DialogActions';
import DiagnosticCounts from './components/DiagnosticCounts.vue';
import { diagnosticCounts, isLpmakeDiagnostic } from '../shared/diagnostics';
import DebugTerminal from './components/DebugTerminal.vue';
import OutputDiff from './components/OutputDiff.vue';
import PathField from './components/PathField.vue';
import SourceTabs from './components/SourceTabs.vue';
import ProblemSelect from './components/ProblemSelect.vue';
import ResultHelp from './components/ResultHelp.vue';
import ExportDialog from './components/ExportDialog.vue';
import { formatShortcut } from '../shared/shortcut-display';
import { operationError } from '../shared/errors';
import { createKeybindingsHandler, parseKeybinding, matchKeybindingPress } from 'tinykeys';
import ActionMenu from './components/ActionMenu.vue';
import type {
  FileEvent,
  Config,
  Draft,
  CaseResult,
  Compilation,
  DebugState,
  Project,
  DetectedCompiler,
  EditorCursor,
  LayoutConfig,
  LoadedDraft,
  SaveResult,
  TestState,
} from '../shared/types';
const api = window.labpad,
  clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const draft = ref<Draft>(),
  config = ref<Config>(),
  settings = ref<Config>(),
  projects = ref<Project[]>([]);
const fileScope = ref('');
const dataRoot = ref(''),
  settingsRoot = ref(''),
  version = ref(''),
  sourcePath = ref<string | null>(null),
  compilerDescription = ref('');
const compilerLabel = computed({
  get: () => {
    const label = compilerDescription.value;
    const match = /^(内置|自定义|Built-in|Custom)\s+(.+)$/.exec(label);
    if (match)
      return t(
        match[1] === '内置' || match[1] === 'Built-in' ? 'Built-in {0}' : 'Custom {0}',
        match[2],
      );
    return label || t('Reading Compiler Information…');
  },
  set: (value: string) => {
    compilerDescription.value = value;
  },
});
const { style: textStyle } = useTypography(() => config.value?.typography);
const typographyValid = ref(true);
const settingsTypography = computed({
  get: () => settings.value?.typography ?? defaultTypography(),
  set: (value) => {
    if (settings.value) settings.value.typography = value;
  },
});
const execution = ref<ExecutionState>(idle());
let executionEpoch = 0;
function beginExecution(kind: TaskKind) {
  if (execution.value.kind !== 'idle') throw new UIError('Stop the current task first.');
  const id = ++executionEpoch;
  execution.value = {
    kind,
    id,
    stage: kind === 'compile' || kind === 'native' || kind === 'terminal' ? 'preparing' : 'running',
  };
  return id;
}
function endExecution(id: number, outcome: Outcome) {
  execution.value = finish(execution.value, id, outcome);
}
function ownsExecution(id: number) {
  return execution.value.kind !== 'idle' && execution.value.id === id;
}
function setIdle(outcome: Outcome) {
  if (execution.value.kind === 'idle') execution.value = idle(outcome);
}
const fileBusy = ref(false),
  blocked = computed(
    () =>
      !!busy.value ||
      fileBusy.value ||
      !!exportKind.value ||
      nativeActive.value ||
      nativeStarting.value,
  );
const busy = computed(() => taskBusy(execution.value)),
  debugRunning = ref(false),
  bottomTab = ref<'output' | 'debug'>('output');
const compiledReady = ref(false),
  diagnostics = ref({ warnings: 0, errors: 0 }),
  diagnosticRevision = ref(0),
  debugEpoch = ref(0);
const logEntries = ref<UIText[]>([]);
const logs = computed(() => logEntries.value.map((entry) => t(entry)).join(''));
const error = ref<UIText>(''),
  notice = ref<UIText>(''),
  saveStatus = ref('已保存'),
  dirty = ref(false),
  ready = ref(false);
const settingsOpen = ref(false),
  settingsSaving = ref(false),
  settingsMessage = ref<UIText>(''),
  pathValidity = ref({ data: true, c: true, cpp: true });
const runningCases = ref<string[]>([]),
  selectedCases = ref<string[]>([]),
  problemStates = ref<Record<string, TestState>>({}),
  closedIds = ref<string[]>([]),
  compilationFailed = ref(false);
const exportKind = ref<'source' | 'project' | null>(null),
  exportCurrent = ref<Draft>(),
  exportBuffers = ref<Draft[]>([]),
  exportDialog = ref<InstanceType<typeof ExportDialog>>();
let checkTimer: ReturnType<typeof setTimeout> | undefined;
const results = ref<Record<string, CaseResult>>({}),
  diffOpen = ref<Record<string, boolean>>({}),
  finished = ref(false);
const phase = computed(() => {
  void uiLanguage.value;
  return nativeActive.value && !nativeStarting.value
    ? nativeMessage(nativeState.value.status)
    : taskMessage(execution.value);
});
const terminal = ref<InstanceType<typeof DebugTerminal>>(),
  editor = ref<InstanceType<typeof CodeEditor>>();
const cursor = ref<EditorCursor>({
    line: 1,
    column: 1,
    selectionChars: 0,
    selectionLines: 0,
    lines: 1,
    focused: false,
  }),
  hintIndex = ref(0);
let hintTimer: ReturnType<typeof setInterval> | undefined,
  noticeTimer: ReturnType<typeof setTimeout> | undefined,
  layoutTail: Promise<unknown> = Promise.resolve();
const footerPulse = ref<UIText>('');
let pulseTimer: ReturnType<typeof setTimeout> | undefined;
function flashFooter(text: UIText) {
  clearTimeout(pulseTimer);
  footerPulse.value = text;
  pulseTimer = setTimeout(() => {
    footerPulse.value = '';
  }, 4000);
}
const currentPlatform = navigator.platform,
  keyLabel = (key: string) => formatShortcut(key, currentPlatform);
function shortcutLabel(id: string) {
  return (config.value?.shortcuts[id] ?? []).map(keyLabel).join(' / ');
}
const tips = computed(() => [
  config.value?.saveMode === 'auto'
    ? t('Auto Save is on. Pause briefly after typing to save.')
    : t('{0} saves the current source file, including an imported copy.', shortcutLabel('save')),
  t('Those dots mark spaces. Your exported code still contains ordinary spaces.'),
  t('Select several lines and press Tab or Shift+Tab to indent them together.'),
  t('With no test cases, a successful compilation takes you to the terminal.'),
  t(
    '{0} formats the code. {1} undoes the whole change.',
    shortcutLabel('format'),
    keyLabel('$mod+KeyZ'),
  ),
  t('Inputs, expected output, and comparison rules are saved with the problem JSON.'),
  t('Start small. Get one example working first.'),
  t('Try one more boundary value. It is a little extra peace of mind.'),
  t('Drag a divider to give the busy side more room.'),
  t('The compiler is very good at finding missing semicolons.'),
  t('Empty input, zero, negatives: boundary values deserve a turn too.'),
  t('All tests passed? Give the problem one more read.'),
  t('If you are stuck, make the problem smaller.'),
  t('I will check the answers. You bring the ideas.'),
  t('Take a break when you need one. The semicolons can wait.'),
  t('A small test can shed light on a lot of code.'),
  t('Select a few lines and press Tab. They will move together.'),
  t('Shift+Tab brings the indentation back.'),
  t('Use {0} to find a name instead of scanning by eye.', keyLabel('$mod+KeyF')),
  t(
    '{0} to undo, {1} to redo. Make yourself at home.',
    keyLabel('$mod+KeyZ'),
    keyLabel('$mod+Shift+KeyZ'),
  ),
  t('After the test input, stdin closes. Your program can finish at EOF.'),
  t('Too much output, or too little? Open Diff to see what changed.'),
  draft.value?.language === 'cpp'
    ? t('A little cout can help you find your way.')
    : t('A little printf can help you find your way.'),
  t('Run once more before exporting. It makes submitting easier.'),
  t('Try an unusual input. You might learn something new.'),
  t('Take your time writing code. Run your tests often.'),
]);
const footerHint = computed(() =>
  formatting.value
    ? t('Formatting Code…')
    : busy.value
      ? phase.value + ' · ' + compilerLabel.value
      : fileBusy.value
        ? t('Preparing Files…')
        : notice.value ||
          footerPulse.value ||
          (cursor.value.selectionChars
            ? t(
                'Selected: {0} characters across {1} lines. Tab / Shift+Tab adjusts the whole block.',
                cursor.value.selectionChars,
                cursor.value.selectionLines,
              )
            : tips.value[hintIndex.value % tips.value.length]),
);
interface SourceTab {
  missing?: boolean;
  id: string;
  document: LoadedDraft;
  savedSource: string;
  dirty: boolean;
  revision: number;
  status: string;
}
const tabs = ref<SourceTab[]>([]),
  activeId = ref('');
let savedRules = '';
const rulesDirty = ref(false),
  activeTab = computed(() => tabs.value.find((t) => t.id === activeId.value));
const documentEpoch = ref(''),
  formatting = ref(false);
const compilerChoiceOpen = ref(false),
  compilerScanning = ref(false),
  detectedCompilers = ref<DetectedCompiler[]>([]),
  selectedCompiler = ref(''),
  compilerDialog = ref<HTMLElement>();
const workspaceMode = computed(
  () => projects.value.find((p) => p.labId === draft.value?.problem.labId)?.mode === 'project',
);
const includedSources = ref<string[] | null>(null),
  membershipMessage = ref('');
let membershipTimer: ReturnType<typeof setTimeout> | undefined;
const fileEntries = ref<WorkspaceFile[]>([]),
  expanded = ref<string[]>([]),
  sidebarWidth = ref(190),
  sidebarCollapsed = ref(false),
  newMode = ref<'problem-set' | 'project'>('problem-set');
const fileTree = ref<InstanceType<typeof FileTree>>();
const buildSettings = ref<{ source: string; revision: number }>(),
  buildDocument = ref(''),
  buildConflict = ref('');
const useRecommended = ref(true),
  parameterConfigured = ref(false),
  parameterExpanded = ref(false),
  parameterLab = ref(''),
  parameterWorkspace = ref(false);
let buildReturnFocus: HTMLElement | undefined;
const projectMenu = ref<InstanceType<typeof ProjectSelect>>();
const projectOptions = ref<ProjectBuildOptions>({
  inheritDefaults: true,
  cArgs: [],
  cppArgs: [],
  linkArgs: [],
});
const inactiveSource = computed(
  () =>
    workspaceMode.value &&
    draft.value?.file &&
    isSourceFile(draft.value.file) &&
    includedSources.value !== null &&
    !includedSources.value.includes(draft.value.file),
);
const canFormat = computed(() => !draft.value?.file || isCodeFile(draft.value.file));
let viewTimer: ReturnType<typeof setTimeout> | undefined;
const rightCollapsed = ref(false),
  rightTab = ref<'tests' | 'debug'>('tests'),
  summaryMode = ref<'selected' | 'result'>('selected');
const nativeState = ref<NativeDebugState>({
  status: 'idle',
  frames: [],
  scopes: [],
  variables: [],
  breakpoints: [],
  conditionalBreakpoints: true,
});
const nativeStarting = computed(() => execution.value.kind === 'native'),
  sourceBreakpoints = ref<SourceBreakpoint[]>([]),
  watches = ref<string[]>([]),
  sessionSources = ref<Record<string, string>>({});
const nativeActive = computed(() =>
  ['starting', 'running', 'paused', 'stop-failed'].includes(nativeState.value.status),
);
const nativeChanged = computed(
  () =>
    nativeActive.value &&
    tabs.value.some(
      (t) =>
        t.document.file &&
        Object.hasOwn(sessionSources.value, t.document.file) &&
        t.document.source !== sessionSources.value[t.document.file],
    ),
);
const displayPoints = computed(() =>
  sourceBreakpoints.value.map((b) =>
    nativeActive.value &&
    (tabs.value.find((t) => t.document.file === b.path)?.document.source ??
      sessionSources.value[b.path]) === sessionSources.value[b.path]
      ? (nativeState.value.breakpoints.find(
          (n) =>
            n.path === b.path &&
            n.line === b.line &&
            n.enabled === b.enabled &&
            n.condition === b.condition,
        ) ?? b)
      : { ...b, verified: false },
  ),
);
const activeFrame = computed(() =>
  nativeState.value.frames.find((f) => f.id === nativeState.value.selectedFrameId),
);
const executionLine = computed(() =>
  nativeState.value.status === 'paused' &&
  activeFrame.value?.path === draft.value?.file &&
  sessionSources.value[draft.value!.file!] === draft.value?.source
    ? activeFrame.value?.line
    : undefined,
);
const conditionDialog = ref<{ path: string; line: number; value: string }>();
let loadingDebugPrefs = false,
  debugPrefsRevision = 0;
const completionContext = ref<CompletionFiles>({
  files: {},
  includeDirs: ['.'],
});
let completionTimer: ReturnType<typeof setTimeout> | undefined;
const completionFiles = computed(() => ({
  ...completionContext.value,
  files: {
    ...completionContext.value.files,
    ...Object.fromEntries(
      tabs.value
        .filter((t) => t.document.file && isHeaderFile(t.document.file))
        .map((t) => [t.document.file!, t.document.source]),
    ),
  },
  includeDirs: completionContext.value.includeDirs,
}));
async function refreshCompletion(request = ++completionRevision) {
  if (!draft.value) return;
  const token = viewToken();
  try {
    const value = await api.completionFiles(token.lab, token.problem);
    if (ownsView(token) && request === completionRevision) completionContext.value = value;
  } catch (error) {
    if (ownsView(token) && request === completionRevision) throw error;
  }
}
function changeBreakpoints(values: SourceBreakpoint[]) {
  sourceBreakpoints.value = values;
  if (nativeActive.value)
    void action(async () => {
      await api.nativeBreakpoints(clone(values));
    });
}
function breakpoint(line: number, condition = false, path = draft.value!.file!) {
  if (!path) return;
  if (condition) {
    const point = sourceBreakpoints.value.find((b) => b.path === path && b.line === line);
    conditionDialog.value = { path, line, value: point?.condition ?? '' };
    return;
  }
  const index = sourceBreakpoints.value.findIndex((b) => b.path === path && b.line === line);
  changeBreakpoints(
    index < 0
      ? [...sourceBreakpoints.value, { path, line, enabled: true }]
      : sourceBreakpoints.value.filter((_, i) => i !== index),
  );
}
function applyCondition() {
  const point = conditionDialog.value!;
  changeBreakpoints([
    ...sourceBreakpoints.value.filter((b) => b.path !== point.path || b.line !== point.line),
    {
      path: point.path,
      line: point.line,
      enabled: true,
      ...(point.value.trim() ? { condition: point.value.trim() } : {}),
    },
  ]);
  conditionDialog.value = undefined;
}
async function debugLocation(path: string, line: number) {
  if (!fileEntries.value.some((f) => f.path === path && !f.directory)) {
    notice.value = msg('This call is in code outside the project.');
    return;
  }
  await openFile(path);
  await nextTick();
  editor.value?.jumpLine(line);
}
async function selectFrame(id: number) {
  const token = viewToken(),
    request = ++frameRevision;
  const current = () =>
    ownsView(token) && request === frameRevision && nativeState.value.status === 'paused';
  try {
    const state = await api.nativeFrame(id);
    if (!current()) return;
    nativeState.value = state;
    const frame = state.frames.find((f) => f.id === id);
    if (frame?.path) await debugLocation(frame.path, frame.line);
  } catch (error) {
    if (current() && nativeState.value.selectedFrameId === id) throw error;
  }
}
async function startNative(restart = false) {
  if (nativeStarting.value || busy.value) return;
  const id = beginExecution('native');
  try {
    clearTimeout(saveTimer);
    await saveTail;
    if (!ownsExecution(id)) return;
    const state = await api.compileState(snapshot());
    if (!ownsExecution(id)) return;
    if (tabs.value.some((tab) => tab.dirty) || !state.saved) {
      if (!(await (restart ? api.confirmRestart() : api.confirmCompile()))) return;
      await saveAll();
      if (!ownsExecution(id)) return;
    }
    if (restart) await api.nativeStop();
    if (!ownsExecution(id)) return;
    rightTab.value = 'debug';
    rightCollapsed.value = false;
    bottomTab.value = 'debug';
    debugEpoch.value++;
    const result = await api.nativeStart(snapshot(), clone(sourceBreakpoints.value));
    if (!ownsExecution(id)) return;
    if (result.compilation) showCompilation(result.compilation);
    if (result.needsBuild) {
      endExecution(id, 'ready');
      await openBuildSettings();
      return;
    }
    if (result.sources) sessionSources.value = result.sources;
    if (!result.started) {
      bottomTab.value = 'output';
      endExecution(id, 'native-not-started');
    }
  } catch (error) {
    if (!ownsExecution(id)) return;
    endExecution(id, 'native-failed');
    throw error;
  } finally {
    endExecution(
      id,
      nativeState.value.status === 'ended'
        ? 'native-ended'
        : nativeState.value.status === 'error'
          ? 'native-failed'
          : 'ready',
    );
    queueChecks();
  }
}

async function nativeControl(action: 'continue' | 'pause' | 'next' | 'stepIn' | 'stepOut') {
  nativeState.value = await api.nativeControl(action);
}
async function interruptTerminal() {
  if (nativeActive.value && nativeState.value.status === 'running') await nativeControl('pause');
  else if (!nativeActive.value) await stop();
}
async function synchronizeTerminal() {
  return api.terminalContext(snapshot());
}
async function executeTerminal(text: string) {
  const scope = fileScope.value;
  try {
    let result = await api.terminalCommand(snapshot(), text);
    if (scope !== fileScope.value) return result;
    if (result.needsSave) {
      if (!(await api.confirmCompile())) return { ...result, output: t('Canceled.') };
      if (scope !== fileScope.value) return result;
      await saveAll();
      result = await api.terminalCommand(snapshot(), text);
    }
    if (scope === fileScope.value) await refreshFiles();
    return result;
  } catch (error) {
    if (scope !== fileScope.value || !showLpmakeDiagnostic(message(error))) throw error;
    return { ...(await api.terminalContext(snapshot())), output: t('Build failed. See Output.') };
  }
}

const runHint = computed(() =>
  selectedCases.value.length === draft.value?.problem.testCases.length
    ? t('Run All Test Cases')
    : t('Run Selected Test Cases ({0})', selectedCases.value.length),
);
const testSummary = computed(() =>
  busy.value === 'judge'
    ? t(
        '{0}/{1} completed',
        runningCases.value.filter((id) => results.value[id]).length,
        runningCases.value.length,
      )
    : summaryMode.value === 'result'
      ? t('{0}/{1} passed', passed.value, draft.value?.problem.testCases.length ?? 0)
      : t(
          '{0}/{1} selected',
          selectedCases.value.length,
          draft.value?.problem.testCases.length ?? 0,
        ),
);
const summaryAllPassed = computed(
  () =>
    !busy.value &&
    summaryMode.value === 'result' &&
    passed.value > 0 &&
    passed.value === draft.value?.problem.testCases.length,
);
function toggleAllTests() {
  summaryMode.value = 'selected';
  selectedCases.value =
    selectedCases.value.length === draft.value!.problem.testCases.length
      ? []
      : draft.value!.problem.testCases.map((t) => t.id);
}

const mainToolbar = ref<HTMLElement>();
const toolbarWidth = ref(0);
const compactToolbar = computed(() => toolbarWidth.value < 1150);
const toolbarItems = computed(() => [
  ...(!workspaceMode.value
    ? [
        { label: t('C Source (.c)'), value: 'new:c', disabled: blocked.value },
        { label: t('C++ Source (.cpp)'), value: 'new:cpp', disabled: blocked.value },
      ]
    : []),
  {
    label: t('Import Source'),
    value: 'import:source',
    separator: !workspaceMode.value,
    disabled: blocked.value,
  },
  { label: t('Import Test Cases'), value: 'import:io', disabled: blocked.value },
  { label: t('Import Experiment'), value: 'import:project', disabled: blocked.value },
  { label: t('Export Source'), value: 'export:source', separator: true, disabled: blocked.value },
  { label: t('Export Experiment'), value: 'export:project', disabled: blocked.value },
  { label: t('Export Current Test Cases'), value: 'export:currentTests', disabled: blocked.value },
  {
    label: t('Export Experiment Test Cases'),
    value: 'export:projectTests',
    disabled: blocked.value,
  },
  { label: t('Settings'), value: 'settings', separator: true, disabled: fileBusy.value },
]);
async function chooseToolbarAction(value: string) {
  if (value === 'settings') return openSettings();
  const [kind, id] = value.split(':');
  if (kind === 'new') return fileAction(() => newSource(id));
  if (kind === 'import') return chooseImport(id);
  if (kind === 'export') return chooseExport(id);
}
watch(
  mainToolbar,
  (element, _previous, onCleanup) => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const focused =
        document.activeElement instanceof HTMLElement &&
        (element.contains(document.activeElement) ||
          document.activeElement.closest('[data-owner="toolbar"]'))
          ? document.activeElement
          : undefined;
      toolbarWidth.value = entry.contentRect.width;
      if (focused)
        nextTick(() => {
          if (!focused.isConnected || !focused.getClientRects().length)
            element
              .querySelector<HTMLButtonElement>(
                compactToolbar.value ? '.toolbar-more-trigger' : '.settings-button',
              )
              ?.focus();
        });
    });
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  },
  { flush: 'post' },
);

const rightHeader = ref<HTMLElement>();
const rightHeaderWidth = ref(0);
const fullHeader = computed(() => rightHeaderWidth.value >= 560);
const showTestSummary = computed(() => rightHeaderWidth.value >= 360);
const showRightTabs = computed(() => rightHeaderWidth.value >= 190);
const showBothRightTabs = computed(() => rightHeaderWidth.value >= 250);
watch(
  rightHeader,
  (element, _previous, onCleanup) => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const focused =
        document.activeElement instanceof HTMLElement && element.contains(document.activeElement)
          ? document.activeElement
          : undefined;
      rightHeaderWidth.value = entry.contentRect.width;
      if (focused)
        nextTick(() => {
          if (focused.isConnected && !focused.getClientRects().length)
            element.querySelector<HTMLButtonElement>('.action-menu-trigger')?.focus();
        });
    });
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  },
  { flush: 'post' },
);
const testHeaderItems = computed(() => [
  ...(!showBothRightTabs.value && workspaceMode.value
    ? [{ label: t('Switch to Debug'), value: 'tab' }]
    : []),
  ...(!showTestSummary.value
    ? [
        {
          label: testSummary.value,
          value: 'all',
          disabled: !!busy.value,
          checked:
            selectedCases.value.length === draft.value?.problem.testCases.length &&
            selectedCases.value.length > 0
              ? true
              : selectedCases.value.length
                ? ('indeterminate' as const)
                : false,
        },
      ]
    : []),
  { label: t('Go to Failed Test'), value: 'locate', disabled: !failedIds.value.length },
  {
    label: t('Rerun Failed Tests'),
    value: 'failed',
    disabled: blocked.value || !compiledReady.value || !failedIds.value.length,
  },
  ...(!fullHeader.value
    ? [
        { label: t('Problem File'), value: 'rule', separator: true, disabled: blocked.value },
        { label: t('Reload'), value: 'reload', disabled: blocked.value },
        { label: t('Add Test Case'), value: 'add', disabled: blocked.value },
      ]
    : []),
]);
const debugHeaderItems = computed(() => [
  ...(!showBothRightTabs.value ? [{ label: t('Switch to Test Cases'), value: 'tab' }] : []),
  ...(!fullHeader.value
    ? [
        {
          label: t('Build Settings…'),
          value: 'build',
          disabled: blocked.value || nativeActive.value,
        },
      ]
    : []),
]);
async function testHeaderAction(value: string) {
  if (value === 'tab') rightTab.value = 'debug';
  else if (value === 'all') toggleAllTests();
  else if (value === 'locate') locateFailed();
  else if (value === 'failed') await run(failedIds.value);
  else if (value === 'rule') await api.showProblemFile(snapshot());
  else if (value === 'reload') await fileAction(reload);
  else if (value === 'add') addCase();
}

const clipboardFiles = ref<{ lab: string; paths: string[]; absolute: string[]; cut: boolean }>();
const fileEvents = new Map<number, Promise<void>>();
let fileEventTail: Promise<void> = Promise.resolve();
let viewEpoch = 0,
  fileRefreshRevision = 0,
  fileOpenRevision = 0,
  completionRevision = 0,
  frameRevision = 0,
  compilerScanRevision = 0;
const debugPrefTimers = new Map<string, ReturnType<typeof setTimeout>>();
function viewToken() {
  return {
    epoch: viewEpoch,
    lab: draft.value?.problem.labId ?? '',
    problem: draft.value?.problem.problemId ?? '',
    workspace: workspaceMode.value,
  };
}
function ownsView(token: ReturnType<typeof viewToken>) {
  return (
    token.epoch === viewEpoch &&
    token.lab === draft.value?.problem.labId &&
    token.problem === draft.value?.problem.problemId &&
    token.workspace === workspaceMode.value
  );
}
async function refreshFiles(reconcile = false) {
  const token = viewToken(),
    request = ++fileRefreshRevision,
    input = snapshot();
  const current = () => ownsView(token) && request === fileRefreshRevision;
  try {
    const context = await api.terminalContext(input);
    if (!current()) return;
    const entries = await api.workspaceFiles(token.lab, token.problem);
    if (!current()) return;
    fileScope.value = context.scope;
    fileEntries.value = entries;
    if (!reconcile) return;
    const present = new Set(entries.filter((f) => !f.directory).map((f) => f.path));
    for (const tab of [...tabs.value]) {
      const file = tab.document.file,
        revision = tab.revision;
      if (!file) continue;
      if (!present.has(file)) {
        tab.missing = true;
        tab.status = '文件已移除';
        continue;
      }
      const loaded = await api.workspaceOpen(token.lab, file, token.problem);
      if (!current()) return;
      const same = () =>
        tabs.value.includes(tab) && tab.document.file === file && tab.revision === revision;
      if (!same() || loaded.source === tab.savedSource) continue;
      if (tab.dirty && !(await api.confirmExternal(file))) continue;
      if (!current()) return;
      if (!same()) continue;
      tab.savedSource = loaded.source;
      tab.document = { ...loaded, documentId: tab.id };
      tab.missing = false;
      if (tab.id === activeId.value) {
        pauseSave = true;
        draft.value = { ...clone(tab.document), problem: clone(draft.value!.problem) };
        editor.value?.applyText(loaded.source);
        pauseSave = false;
      }
    }
    if (current()) {
      refreshDirty();
      invalidate();
      recordState();
    }
  } catch (error) {
    if (current()) throw error;
  }
}
async function openFile(file: string) {
  const token = viewToken(),
    request = ++fileOpenRevision;
  const current = () => ownsView(token) && request === fileOpenRevision;
  const found = tabs.value.find((t) => t.document.file === file);
  if (found) {
    activateTab(found.id);
    return;
  }
  try {
    const loaded = await api.workspaceOpen(token.lab, file, token.problem);
    if (!current()) return;
    if (!workspaceMode.value && loaded.problem.problemId !== token.problem && !loaded.auxiliary) {
      await fileAction(async () => {
        if (!current() || !(await beforeChange()) || !current()) return;
        await api.loadDraft(loaded.problem.labId, loaded.problem.problemId, loaded.language);
        applyBootstrap(await api.bootstrap());
        addDocument(loaded);
      });
      return;
    }
    addDocument(loaded);
  } catch (error) {
    if (current()) throw error;
  }
}
async function openFiles(files: string[]) {
  for (const file of files) {
    if (fileEntries.value.find((f) => f.path === file)?.directory) {
      expanded.value = [...new Set([...expanded.value, file])];
      continue;
    }
    await openFile(file);
  }
}
function editTab(id: string, text: string) {
  const tab = tabs.value.find((t) => t.id === id);
  if (!tab) return;
  if (id === activeId.value) {
    editor.value?.applyText(text);
  } else {
    tab.document.source = text;
    tab.revision++;
    tab.dirty = tabDirty(tab);
    tab.status = tab.dirty ? '未保存' : '已保存';
    revision++;
    invalidate();
    recordState();
  }
}
function applyFileEvent(event: FileEvent): Promise<void> {
  if (event.lab !== draft.value?.problem.labId || event.scope !== fileScope.value)
    return Promise.resolve();
  const existing = fileEvents.get(event.id);
  if (existing) return existing;
  const task = fileEventTail.then(() =>
    event.lab === draft.value?.problem.labId && event.scope === fileScope.value
      ? applyFileChanges(event)
      : undefined,
  );
  fileEventTail = task.catch(() => {});
  fileEvents.set(event.id, task);
  if (fileEvents.size > 64) fileEvents.delete(fileEvents.keys().next().value!);
  return task;
}
async function applyFileChanges(event: FileEvent) {
  const lab = draft.value!.problem.labId,
    scope = fileScope.value;
  const remap = (file: string) => remapPath(file, event.changes);
  const targetFile = tabs.value.find((tab) => tab.id === targetSourceId.value)?.document.file;
  const targetRemoved =
    !!targetFile && (remap(targetFile) === undefined || replacedPath(targetFile, event.changes));
  const moving = new Set(
    tabs.value
      .filter((tab) => tab.document.file && remap(tab.document.file) !== tab.document.file)
      .map((tab) => tab.id),
  );
  const reload = new Map(
    await Promise.all(
      tabs.value.flatMap((tab) => {
        const file = tab.document.file,
          next = file && remap(file);
        return file && next && (next !== file || replacedPath(file, event.changes))
          ? [api.workspaceOpen(event.lab, next).then((loaded) => [tab.id, loaded] as const)]
          : [];
      }),
    ),
  );
  const nextProjects = await api.projects();
  const clip = clipboardFiles.value;
  const clipPaths =
    clip?.lab === event.lab
      ? clip.paths.map(remap).filter((file): file is string => file !== undefined)
      : undefined;
  const absolute = clipPaths?.length
    ? await api.fileContext(event.lab, draft.value!.problem.problemId, clipPaths, 'copy')
    : [];
  if (draft.value?.problem.labId !== lab || scope !== fileScope.value) return;

  // Read all committed metadata before publishing the new tree and editor state.
  expanded.value = expanded.value.map(remap).filter((file): file is string => file !== undefined);
  sourceBreakpoints.value = sourceBreakpoints.value.flatMap((point) => {
    const next = remap(point.path);
    return next ? [{ ...point, path: next, verified: false }] : [];
  });
  for (const tab of [...tabs.value]) {
    const file = tab.document.file;
    if (!file) continue;
    const next = remap(file),
      moved = next !== file,
      replaced = replacedPath(file, event.changes);
    if (!next) {
      tabs.value = tabs.value.filter((current) => current !== tab);
      continue;
    }
    const loaded = reload.get(tab.id);
    if ((moved || replaced) && loaded) {
      const source = moved ? tab.document.source : loaded.source;
      tab.document = { ...loaded, source, documentId: tab.id };
      if (replaced && !moved) tab.savedSource = source;
      if (tab.id === activeId.value) {
        pauseSave = true;
        draft.value = { ...clone(tab.document), problem: clone(draft.value!.problem) };
        sourcePath.value = loaded.sourceFile ?? null;
        editor.value?.applyText(source);
        pauseSave = false;
      }
    }
  }
  const seen = new Set<string>();
  tabs.value = tabs.value.filter((tab) => {
    const file = tab.document.file;
    if (!file) return true;
    if (
      !moving.has(tab.id) &&
      tabs.value.some(
        (other) => other.id !== tab.id && moving.has(other.id) && other.document.file === file,
      )
    )
      return false;
    if (seen.has(file)) return false;
    seen.add(file);
    return true;
  });
  if (!tabs.value.some((tab) => tab.id === activeId.value)) {
    activeId.value = '';
    const was = fileBusy.value;
    fileBusy.value = false;
    if (tabs.value[0] && !targetRemoved) activateTab(tabs.value[0].id);
    else {
      documentEpoch.value = '';
      if (targetRemoved) targetSourceId.value = undefined;
    }
    fileBusy.value = was;
  }
  if (clipboardFiles.value === clip && clipPaths) {
    if (clipPaths.length) {
      clip!.paths = clipPaths;
      clip!.absolute = absolute;
    } else clipboardFiles.value = undefined;
  }
  fileEntries.value = event.files;
  projects.value = nextProjects;
  void terminal.value?.refreshDirectory();
  if (event.warnings?.length) notice.value = event.warnings.join('\n');
  refreshDirty();
  revision++;
  invalidate();
  recordState();
}

async function requestFiles(request: FileRequest) {
  if (busy.value) throw new UIError('Stop the current task first');
  const event = await api.fileOperation(
    draft.value!.problem.labId,
    draft.value!.problem.problemId,
    clone(request),
  );
  await applyFileEvent(event);
}
async function treeAction(value: string, files: string[]) {
  if (value === 'refresh') {
    await refreshFiles(true);
    return;
  }
  if (value === 'open') {
    await openFiles(files);
    return;
  }
  if (value === 'copy' || value === 'cut') {
    const item = {
      lab: draft.value!.problem.labId,
      paths: files,
      absolute: [] as string[],
      cut: value === 'cut',
    };
    clipboardFiles.value = item;
    item.absolute = await api.fileContext(item.lab, draft.value!.problem.problemId, files, 'copy');
    return;
  }
  if (value === 'paste') {
    const clip = clipboardFiles.value;
    if (!clip) return;
    const same = clip.lab === draft.value!.problem.labId;
    await requestFiles({
      action: same ? (clip.cut ? 'move' : 'copy') : 'import',
      paths: same ? clip.paths : clip.absolute,
      destination: files[0] ?? '',
      ...(!clip.cut ? { conflict: 'keepBoth' as const } : {}),
    });
    if (clip.cut) clipboardFiles.value = undefined;
    return;
  }
  if (value === 'delete') {
    await requestFiles({ action: 'delete', paths: files });
    return;
  }
  if (['copyPath', 'copyRelative', 'reveal'].includes(value)) {
    await api.fileContext(
      draft.value!.problem.labId,
      draft.value!.problem.problemId,
      files,
      value === 'copyPath' ? 'copy' : value === 'copyRelative' ? 'relative' : 'reveal',
    );
    return;
  }
  if (value === 'crossLabDrop')
    throw new UIError('Copy files before switching experiments to paste them.');
  if (value === 'invalidDrop')
    throw new UIError('The dragged file information is invalid. Try again.');
}
async function commitTreeEdit(form: WorkspaceEdit) {
  if (busy.value || fileBusy.value) throw new UIError('Wait for the current task to finish');
  const lab = draft.value!.problem.labId,
    make =
      workspaceMode.value && form.action === 'rename'
        ? (tabs.value.find((t) => t.document.file === 'LPMake.txt')?.document.source ??
          (await api.workspaceOpen(lab, 'LPMake.txt')).source)
        : undefined;
  let changed = make;
  if (make && form.syncReferences) {
    const calls = parse(make).calls,
      counts = new Map<string, number>();
    for (const call of calls) {
      const index = counts.get(call.name) ?? 0;
      counts.set(call.name, index + 1);
      if (
        !['add_files', 'remove_files', 'del_files', 'add_includedirs', 'add_linkdirs'].includes(
          call.name,
        )
      )
        continue;
      for (const [n, arg] of call.args.entries())
        if (arg.value === form.file || arg.value.startsWith(form.file + '/'))
          changed = editArgument(
            changed!,
            call.name,
            index,
            n,
            form.name + arg.value.slice(form.file.length),
          );
    }
  }
  await requestFiles({
    action: form.action,
    paths: [form.action === 'rename' ? form.file : form.name],
    ...(form.action === 'rename' ? { destination: form.name } : {}),
    ...(form.action === 'newFile' && !isSourceFile(form.name) ? { content: '' } : {}),
  });
  if (changed !== make) {
    let makeTab = tabs.value.find((t) => t.document.file === 'LPMake.txt');
    if (!makeTab) {
      const document = await api.workspaceOpen(lab, 'LPMake.txt');
      makeTab = {
        id: document.documentId!,
        document: clone(document),
        savedSource: document.source,
        dirty: false,
        revision: 0,
        status: '已保存',
      };
      tabs.value.push(makeTab);
    }
    editTab(makeTab.id, changed!);
  }
  if (form.action === 'newFile') await openFile(form.name);
  expanded.value = [
    ...new Set([
      ...expanded.value,
      ...form.name
        .split('/')
        .slice(0, -1)
        .map((_, i) =>
          form.name
            .split('/')
            .slice(0, i + 1)
            .join('/'),
        ),
    ]),
  ];
  recordState();
}
function tabDirty(tab: SourceTab) {
  return !!tab.missing || tab.document.source !== tab.savedSource;
}
function refreshDirty() {
  for (const tab of tabs.value) {
    tab.dirty = tabDirty(tab);
    if (tab.status !== '保存中…') tab.status = tab.dirty ? '未保存' : '已保存';
  }
  dirty.value = rulesDirty.value || tabs.value.some((t) => t.dirty);
  saveStatus.value = activeTab.value?.status ?? (dirty.value ? '未保存' : '已保存');
}
function scheduleSave() {
  clearTimeout(saveTimer);
  if (dirty.value && config.value?.saveMode === 'auto' && !fileBusy.value)
    saveTimer = setTimeout(() => void action(saveAll), 350);
}
async function openBuildSettings() {
  await openFile('LPMake.txt');
  const tab = activeTab.value!;
  buildDocument.value = tab.id;
  buildConflict.value = '';
  buildSettings.value = { source: tab.document.source, revision: tab.revision };
}
async function openExperimentBuild(lab = draft.value?.problem.labId ?? '') {
  if (blocked.value || !lab) return;
  projectMenu.value?.closeMenus();
  buildReturnFocus =
    document.activeElement instanceof HTMLElement &&
    !document.activeElement.closest('[role="menuitem"],[role="option"]')
      ? document.activeElement
      : (document.querySelector<HTMLElement>('[data-lab-selector]') ?? undefined);
  if (lab !== draft.value?.problem.labId) {
    await fileAction(() => selectLab(lab));
    if (lab !== draft.value?.problem.labId) return;
  }
  if (workspaceMode.value) await openBuildSettings();
  else {
    await openSettings();
    parameterExpanded.value = true;
    await nextTick();
    document.querySelector('.parameter-settings')?.scrollIntoView({ block: 'center' });
    document.querySelector<HTMLSelectElement>('[data-parameter-source]')?.focus();
  }
}
function applyBuildSettings(text: string, version: number) {
  const tab = tabs.value.find((t) => t.id === buildDocument.value);
  if (!tab || tab.revision !== version) {
    buildConflict.value = t(
      'The build configuration has changed. Keep your edits and reopen Build Settings to review them.',
    );
    return;
  }
  const changed = text !== tab.document.source;
  if (changed) editTab(tab.id, text);
  refreshDirty();
  buildSettings.value = undefined;
  if (changed) {
    revision++;
    recordState();
    invalidate();
    scheduleSave();
  }
}
async function previewBuild(source: string) {
  return api.buildPreview({ ...snapshot(), file: 'LPMake.txt', source });
}
async function previewParameters(options: ProjectBuildOptions) {
  return api.buildPreview(snapshot(), clone(options), clone(settings.value!.compiler));
}
async function editSettingsBuild() {
  buildReturnFocus = document.activeElement as HTMLElement;
  await openBuildSettings();
}
async function deleteLab(lab: string) {
  if (!(await api.deleteProject(lab))) return;
  const current = draft.value!.problem.labId === lab;
  projects.value = await api.projects();
  if (current) applyBootstrap(await api.bootstrap());
  notice.value = msg('Experiment deleted: {0}', lab);
}
const newKind = ref<'lab' | 'problem' | null>(null),
  newName = ref(''),
  newNameInput = ref<HTMLInputElement>(),
  newMessage = ref(''),
  newSaving = ref(false);
let pauseSave = true,
  revision = 0,
  saveTail: Promise<unknown> = Promise.resolve(),
  saveTimer: ReturnType<typeof setTimeout> | undefined;
const disposers: (() => void)[] = [];
const targetSourceId = ref<string>();
const editorLanguage = computed(() => {
  let forced = workspaceMode.value ? completionContext.value.forcedLanguage : undefined;
  if (workspaceMode.value) {
    const make = tabs.value.find((tab) => tab.document.file === 'LPMake.txt');
    try {
      if (make) forced = parse(make.document.source).spec.language;
    } catch {}
  }
  const target = tabs.value.find((tab) => tab.id === targetSourceId.value)?.document;
  return languageForFile(
    draft.value?.file,
    target?.language ?? draft.value?.language ?? 'c',
    forced,
  );
});
const snapshot = (): Draft => {
  const value = clone(draft.value!);
  if (isCodeFile(value.file ?? '')) value.language = editorLanguage.value;
  if (workspaceMode.value) value.target = { mode: 'project', labId: value.problem.labId };
  else if (targetSourceId.value)
    value.target = {
      mode: 'problem-set',
      labId: value.problem.labId,
      problemId: value.problem.problemId,
      documentId: targetSourceId.value,
    };
  else delete value.target;
  return value;
};
const passed = computed(
  () => Object.values(results.value).filter((c) => c.verdict === 'AC').length,
);
const problems = computed(
  () => projects.value.find((p) => p.labId === draft.value?.problem.labId)?.problems ?? [],
);
function tabName(document: LoadedDraft) {
  const file = document.file;
  if (!file) return document.name || document.sourceFile?.split(/[\\/]/).pop() || '空项目.c';
  const parts = file.split('/');
  for (let n = 1; n <= parts.length; n++) {
    const suffix = parts.slice(-n).join('/');
    if (
      !tabs.value.some(
        (t) =>
          t.document.file !== file && t.document.file?.split('/').slice(-n).join('/') === suffix,
      )
    )
      return suffix;
  }
  return file;
}
const filename = computed(
  () =>
    sourcePath.value?.split(/[\\/]/).pop() ||
    (draft.value?.problem.problemId || '空项目') +
      (draft.value?.language === 'cpp' ? '.cpp' : '.c'),
);
const validSettingsPaths = computed(
  () =>
    typographyValid.value &&
    pathValidity.value.data &&
    (settings.value?.compiler.mode !== 'custom' ||
      (pathValidity.value.c && pathValidity.value.cpp)),
);
function message(e: unknown) {
  return operationError(e);
}
function showLpmakeDiagnostic(text: string): boolean {
  if (!isLpmakeDiagnostic(text)) return false;
  logEntries.value = [msg('LPMake Configuration Check\n\n{0}\n', text)];
  diagnostics.value = diagnosticCounts(text);
  diagnosticRevision.value++;
  bottomTab.value = 'output';
  return true;
}
function reportOperationError(reason: unknown) {
  const text = message(reason);
  if (!showLpmakeDiagnostic(text)) error.value = errorText(reason);
}
async function action(fn: () => Promise<unknown>, clearMessages = true) {
  if (clearMessages) {
    error.value = '';
    notice.value = '';
  }
  try {
    await fn();
  } catch (e) {
    reportOperationError(e);
  }
}
async function fileAction(fn: () => Promise<unknown>) {
  if (blocked.value) return;
  fileBusy.value = true;
  clearTimeout(saveTimer);
  try {
    await saveTail;
    await fn();
  } finally {
    fileBusy.value = false;
    if (dirty.value && config.value?.saveMode === 'auto') {
      saveTimer = setTimeout(() => void action(saveAll), 350);
    }
  }
}
const failedIds = computed(
  () =>
    draft.value?.problem.testCases
      .filter((t) => results.value[t.id]?.verdict && results.value[t.id].verdict !== 'AC')
      .map((t) => t.id) ?? [],
);
function reportCursor(value: EditorCursor) {
  cursor.value = value;
}
function invalidate(outcome: Outcome = 'changed') {
  compiledReady.value = false;
  results.value = {};
  diffOpen.value = {};
  finished.value = false;
  summaryMode.value = 'selected';
  if (!nativeActive.value) setIdle(outcome);
  queueChecks();
}
function queueChecks() {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(
    () =>
      void refreshChecks().catch((e) => {
        reportOperationError(e);
      }),
    300,
  );
}
async function refreshChecks() {
  if (!draft.value || (!activeId.value && !workspaceMode.value) || busy.value) return;
  const d = snapshot(),
    epoch = revision,
    taskEpoch = executionEpoch;
  const compiled = await api.compileState(d),
    state = await api.checkState(d),
    states = await api.problemStates(
      d,
      tabs.value.map((t) => ({ ...clone(t.document), problem: clone(d.problem) })),
    );
  if (
    revision !== epoch ||
    draft.value.documentId !== d.documentId ||
    taskEpoch !== executionEpoch ||
    execution.value.kind !== 'idle'
  )
    return;
  compiledReady.value = compiled.ready && !compileDirty.value;
  results.value = Object.fromEntries(state.cases.map((c) => [c.id, c]));
  finished.value = state.cases.length > 0;
  problemStates.value = states;
}
function locateFailed() {
  const index = draft.value!.problem.testCases.findIndex((t) => failedIds.value.includes(t.id));
  if (index >= 0)
    document.getElementById('test-case-' + index)?.scrollIntoView({
      block: 'nearest',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
}
async function recentSource() {
  const document = await api.recentSource(
    draft.value!.problem.labId,
    draft.value!.problem.problemId,
    clone(closedIds.value),
  );
  if (document) {
    closedIds.value = closedIds.value.filter((id) => id !== document.documentId);
    addDocument(document);
  } else notice.value = msg('No recent source file is available. Create a new one to get started.');
}
function recordState() {
  if (!draft.value) return;
  api.documentState(snapshot(), dirty.value);
  api.workspaceState(
    tabs.value.map((t) => ({ ...clone(t.document), problem: clone(draft.value!.problem) })),
    rulesDirty.value || tabs.value.some((t) => t.dirty),
    {
      dirtyDocuments: tabs.value.filter((t) => t.dirty).map((t) => t.id),
      ...(rulesDirty.value
        ? {
            rules: {
              problem: clone(draft.value.problem),
              expected: JSON.parse(savedRules),
            },
          }
        : {}),
    },
  );
}
function enqueueSave(input: Draft, id: number): Promise<SaveResult> {
  const value = input;
  const tab = tabs.value.find((t) => t.id === value.documentId);
  if (!tab) return Promise.reject(new UIError('Create or import a source file first'));
  if (tab.document.ruleFile && !tab.dirty)
    return Promise.resolve({ path: tab.document.sourceFile ?? '', source: tab.savedSource });
  if (tab.document.ruleFile && rulesDirty.value)
    return Promise.reject(
      new UIError(
        'Both the test panel and problem file have changed. Keep one set of edits before saving.',
      ),
    );
  tab.status = '保存中…';
  if (tab.id === activeId.value) saveStatus.value = tab.status;
  const task = saveTail
    .then(() => api.saveDraft(value))
    .then(async (result) => {
      const current = tabs.value.find((t) => t.id === value.documentId);
      if (current) {
        current.savedSource = result.source;
        current.missing = false;
        current.document.missing = false;
        if (activeId.value === current.id && draft.value && 'missing' in draft.value) {
          const wasPaused = pauseSave;
          pauseSave = true;
          delete draft.value.missing;
          pauseSave = wasPaused;
        }
        current.document.sourceFile = result.path;
        if (current.revision === id || current.document.source === result.source) {
          if (current.document.source !== result.source) {
            revision++;
            invalidate();
          }
          current.document.source = result.source;
          current.dirty = tabDirty(current);
          current.status = current.dirty ? '未保存' : '已保存';
          if (activeId.value === current.id) {
            pauseSave = true;
            editor.value?.applyText(result.source);
            draft.value!.source = result.source;
            sourcePath.value = result.path;
            pauseSave = false;
          }
        } else {
          current.dirty = tabDirty(current);
          current.status = current.dirty ? '未保存' : '已保存';
        }
      }
      if (result.problem) {
        if (JSON.stringify(draft.value!.problem) === JSON.stringify(value.problem)) {
          pauseSave = true;
          draft.value!.problem = clone(result.problem);
          for (const item of tabs.value) item.document.problem = clone(result.problem);
          pauseSave = false;
          selectedCases.value = result.problem.testCases.map((item) => item.id);
          revision++;
          invalidate();
        }
        savedRules = JSON.stringify(result.problem);
        rulesDirty.value = JSON.stringify(draft.value!.problem) !== savedRules;
      }
      refreshDirty();
      recordState();
      if (result.formatWarning) error.value = result.formatWarning;
      flashFooter(msg('Saved · {0}', result.path));
      projects.value = await api.projects();
      return result;
    })
    .catch((e) => {
      if (tab) {
        tab.status = '保存失败';
        tab.dirty = true;
      }
      saveStatus.value = activeTab.value?.status ?? '保存失败';
      reportOperationError(e);
      recordState();
      throw e;
    });
  saveTail = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}
watch(
  draft,
  () => {
    if (pauseSave || !draft.value) return;
    compiledReady.value = false;
    revision++;
    const tab = activeTab.value;
    if (tab) {
      tab.document = {
        ...clone(draft.value),
        sourceFile: sourcePath.value ?? undefined,
        name: tab.document.name,
        sourceEncoding: tab.document.sourceEncoding,
      };
      tab.revision++;
      tab.dirty = tabDirty(tab);
      tab.status = tab.dirty ? '未保存' : '已保存';
    }
    rulesDirty.value = JSON.stringify(draft.value.problem) !== savedRules;
    refreshDirty();
    footerPulse.value = '';
    recordState();
    invalidate();
    clearTimeout(saveTimer);
    if (config.value?.saveMode === 'auto' && !fileBusy.value) {
      saveTimer = setTimeout(() => void action(saveAll), 350);
    }
  },
  { deep: true, flush: 'sync' },
);
function replaceDraft(
  value: LoadedDraft,
  file: string | null = null,
  documents: LoadedDraft[] = [value],
) {
  clearTimeout(saveTimer);
  pauseSave = true;
  const unique = new Map(documents.map((d) => [d.documentId!, d]));
  if (value.documentId) unique.set(value.documentId, value);
  tabs.value = [...unique.values()].map((d) => ({
    id: d.documentId!,
    document: clone(d),
    savedSource: d.source,
    missing: d.missing,
    dirty: !!d.missing,
    revision: 0,
    status: d.missing ? '未保存' : '已保存',
  }));
  targetSourceId.value = !value.auxiliary
    ? value.documentId
    : value.target?.mode === 'problem-set'
      ? value.target.documentId
      : documents.find((document) => !document.auxiliary)?.documentId;
  activeId.value = value.documentId ?? tabs.value[0]?.id ?? '';
  documentEpoch.value = activeId.value;
  draft.value = { ...clone(value), documentId: activeId.value };
  sourcePath.value = file ?? value.sourceFile ?? null;
  dirty.value = tabs.value.some((tab) => tab.dirty);
  rulesDirty.value = false;
  savedRules = JSON.stringify(value.problem);
  revision++;
  if (config.value) {
    config.value.currentLab = value.problem.labId;
    config.value.currentProblem = value.problem.problemId;
    config.value.language = value.language;
  }
  selectedCases.value = value.problem.testCases.map((t) => t.id);
  closedIds.value = [];
  if (value.warning) error.value = value.warning;
  results.value = {};
  diffOpen.value = {};
  finished.value = false;
  saveStatus.value = tabs.value.find((tab) => tab.id === activeId.value)?.status ?? '已保存';
  setIdle('ready');
  pauseSave = false;
  recordState();
  queueChecks();
}
async function loadWorkspace(value: LoadedDraft) {
  applyBootstrap(await api.bootstrap());
}
function activateTab(id: string, focus = true) {
  fileOpenRevision++;
  if (fileBusy.value || busy.value || !!exportKind.value || id === activeId.value) return;
  const tab = tabs.value.find((t) => t.id === id);
  if (!tab) return;
  clearTimeout(saveTimer);
  pauseSave = true;
  const problem = clone(draft.value!.problem);
  const previousTarget = targetSourceId.value;
  activeId.value = id;
  if (!tab.document.auxiliary) targetSourceId.value = id;
  draft.value = { ...clone(tab.document), problem };
  sourcePath.value = tab.document.sourceFile ?? null;
  documentEpoch.value = id;
  refreshDirty();
  revision++;
  config.value!.language = tab.document.language;
  pauseSave = false;
  if (!workspaceMode.value && previousTarget !== targetSourceId.value)
    invalidate(tab.dirty ? 'changed' : 'ready');
  else queueChecks();
  recordState();
  if (!tab.document.auxiliary)
    void action(() => api.activateDocument(id, tab.document.file), false);
  if (focus) nextTick(() => editor.value?.focus());
  if (config.value?.saveMode === 'auto' && (tabs.value.some((t) => t.dirty) || rulesDirty.value))
    saveTimer = setTimeout(() => void action(saveAll), 350);
}
async function saveRules() {
  if (!rulesDirty.value) return;
  if (tabs.value.some((tab) => tab.document.ruleFile && tab.dirty))
    throw new UIError(
      'Both the test panel and problem file have changed. Keep one set of edits before saving.',
    );
  const problem = clone(draft.value!.problem);
  await api.saveProblem(problem, JSON.parse(savedRules));
  savedRules = JSON.stringify(problem);
  rulesDirty.value = JSON.stringify(draft.value!.problem) !== savedRules;
  const source = JSON.stringify(problem, null, 2) + '\n';
  pauseSave = true;
  try {
    for (const tab of tabs.value.filter((item) => item.document.ruleFile && !item.dirty)) {
      tab.document.source = source;
      tab.savedSource = source;
      tab.document.problem = clone(problem);
      if (activeId.value === tab.id) {
        draft.value!.source = source;
        editor.value?.applyText(source);
      }
    }
  } finally {
    pauseSave = false;
  }
  refreshDirty();
  recordState();
}
async function saveNow() {
  clearTimeout(saveTimer);
  await saveTail;
  const result = activeTab.value
    ? await enqueueSave(snapshot(), activeTab.value.revision)
    : undefined;
  if (!result?.problem) await saveRules();
}
async function saveAll() {
  clearTimeout(saveTimer);
  await saveTail;
  if (rulesDirty.value && tabs.value.some((tab) => tab.document.ruleFile && tab.dirty))
    throw new UIError(
      'Both the test panel and problem file have changed. Keep one set of edits before saving.',
    );
  for (const tab of [...tabs.value].filter((item) => item.dirty || tabs.value.length === 1))
    await enqueueSave(
      { ...clone(tab.document), problem: clone(draft.value!.problem) },
      tab.revision,
    );
  await saveRules();
  if (activeId.value && !activeTab.value?.document.auxiliary)
    await api.activateDocument(activeId.value, activeTab.value?.document.file);
}
async function beforeChange() {
  clearTimeout(saveTimer);
  await saveTail;
  if (!rulesDirty.value && !tabs.value.some((t) => t.dirty)) return true;
  if (config.value!.saveMode === 'auto') {
    await saveAll();
    return true;
  }
  const choice = await api.confirmUnsaved();
  if (choice === 'cancel') return false;
  if (choice === 'save') await saveAll();
  return true;
}
async function chooseSave(value: string) {
  await (value === 'all' ? saveAll() : saveNow());
}
async function tabAction(value: string, id = activeId.value) {
  const index = tabs.value.findIndex((t) => t.id === id),
    tab = tabs.value[index];
  if (!tab) return;
  if (value === 'reveal') {
    if (tab.document.sourceFile) await api.revealSource(tab.document.sourceFile);
    return;
  }
  if (value === 'copyPath' || value === 'copyRelativePath') {
    if (value === 'copyRelativePath' && tab.document.file) await api.copyText(tab.document.file);
    else if (tab.document.sourceFile)
      await api.copyPath(tab.document.sourceFile, value === 'copyRelativePath');
    return;
  }
  if (value === 'version') {
    const created = await api.newVersion({
      ...clone(tab.document),
      problem: clone(draft.value!.problem),
    });
    addDocument(created);
    return;
  }
  let targets =
    value === 'others'
      ? tabs.value.filter((t) => t.id !== id)
      : value === 'right'
        ? tabs.value.slice(index + 1)
        : value === 'saved'
          ? tabs.value.filter((t) => !t.dirty)
          : value === 'all'
            ? tabs.value
            : [tab];
  if (!targets.length) return;
  const closesAll = targets.length === tabs.value.length;
  if (targets.some((t) => t.dirty) || (closesAll && rulesDirty.value)) {
    const choice = config.value!.saveMode === 'auto' ? 'save' : await api.confirmUnsaved();
    if (choice === 'cancel') return;
    if (choice === 'save') {
      if (rulesDirty.value && tabs.value.some((item) => item.document.ruleFile && item.dirty))
        throw new UIError(
          'Both the test panel and problem file have changed. Keep one set of edits before saving.',
        );
      for (const t of targets.filter((item) => item.dirty))
        await enqueueSave(
          { ...clone(t.document), problem: clone(draft.value!.problem) },
          t.revision,
        );
      await saveRules();
    } else if (closesAll && workspaceMode.value) {
      const original = await api.workspaceOpen(draft.value!.problem.labId, tab.document.file!);
      pauseSave = true;
      draft.value = clone(original);
      savedRules = JSON.stringify(original.problem);
      rulesDirty.value = false;
      pauseSave = false;
    } else if (closesAll && rulesDirty.value) {
      const original = await api.loadDraft(
        draft.value!.problem.labId,
        draft.value!.problem.problemId,
        draft.value!.language,
      );
      pauseSave = true;
      draft.value!.problem = original.problem;
      savedRules = JSON.stringify(original.problem);
      rulesDirty.value = false;
      pauseSave = false;
    }
  }
  closedIds.value = [
    ...targets
      .map((t) => (workspaceMode.value && t.document.file ? 'file:' + t.document.file : t.id))
      .reverse(),
    ...closedIds.value,
  ].slice(0, 100);
  const ids = new Set(targets.map((t) => t.id));
  tabs.value = tabs.value.filter((t) => !ids.has(t.id));
  if (ids.has(activeId.value)) {
    const next = tabs.value[Math.min(index, tabs.value.length - 1)];
    activeId.value = '';
    if (next) activateTab(next.id);
    else {
      documentEpoch.value = '';
      dirty.value = rulesDirty.value;
      recordState();
    }
  } else recordState();
}
function addDocument(document: LoadedDraft) {
  const found = tabs.value.find(
    (t) => t.id === document.documentId || (document.file && t.document.file === document.file),
  );
  if (!found)
    tabs.value.push({
      id: document.documentId!,
      document: clone(document),
      savedSource: document.source,
      missing: document.missing,
      dirty: !!document.missing,
      revision: 0,
      status: document.missing ? '未保存' : '已保存',
    });
  const was = fileBusy.value;
  fileBusy.value = false;
  activateTab(found?.id ?? document.documentId!);
  fileBusy.value = was;
  recordState();
}
function selectionAction(event: Event, lab: boolean) {
  const control = event.target as HTMLSelectElement,
    value = control.value;
  control.value = lab ? draft.value!.problem.labId : draft.value!.problem.problemId;
  void action(() => fileAction(() => (lab ? selectLab(value) : selectProblem(value))));
}
async function selectLab(value: string) {
  if (value === '@new:lab') {
    newKind.value = 'lab';
    newName.value = '';
    newMessage.value = '';
    return;
  }
  if (!(await beforeChange())) return;
  const problem = projects.value.find((p) => p.labId === value)?.problems[0] ?? '';
  await loadWorkspace(await api.loadDraft(value, problem, draft.value!.language));
}
async function selectProblem(value: string) {
  if (value === '@new:problem') {
    newKind.value = 'problem';
    newName.value = '';
    newMessage.value = '';
    return;
  }
  if (await beforeChange())
    await loadWorkspace(
      await api.loadDraft(draft.value!.problem.labId, value, draft.value!.language),
    );
}
async function createItem() {
  if (newSaving.value) return;
  newSaving.value = true;
  newMessage.value = '';
  try {
    if (!(await beforeChange())) return;
    recordState();
    const value =
      newKind.value === 'lab'
        ? await api.createLab(newName.value, newMode.value)
        : await api.createProblem(draft.value!.problem.labId, newName.value, draft.value!.language);
    projects.value = await api.projects();
    await loadWorkspace(value);
    newKind.value = null;
  } catch (e) {
    newMessage.value = message(e);
  } finally {
    newSaving.value = false;
  }
}
function applyBootstrap(state: Awaited<ReturnType<typeof api.bootstrap>>) {
  viewEpoch++;
  completionRevision++;
  frameRevision++;
  config.value = state.config;
  setLanguage(state.config.uiLanguage ?? 'zh-CN');
  projects.value = state.projects;
  version.value = state.version;
  dataRoot.value = state.dataRoot;
  fileScope.value = state.workspace?.scope ?? '';
  compilerLabel.value = state.compilerLabel;
  fileEntries.value = state.workspace?.files ?? [];
  expanded.value = state.workspace?.expanded ?? [];
  sidebarWidth.value = state.workspace?.sidebarWidth ?? 190;
  sidebarCollapsed.value = state.workspace?.sidebarCollapsed ?? true;
  rightCollapsed.value = state.workspace?.rightCollapsed ?? false;
  rightTab.value = 'tests';
  replaceDraft(state.draft, state.sourcePath, state.documents);
  ready.value = true;
  if (state.warning) error.value = state.warning;
}
async function reload() {
  if (await beforeChange()) applyBootstrap(await api.reloadDocument());
}
function keepTreeEditFocus(event: Event) {
  if (document.querySelector('.tree-inline-edit')) event.preventDefault();
}
async function newSource(value: string) {
  if (value !== 'c' && value !== 'cpp') return;
  if (workspaceMode.value) {
    sidebarCollapsed.value = false;
    await nextTick();
    await fileTree.value?.newSource(value);
    return;
  }
  const created = await api.newVersion(
    { ...snapshot(), documentId: undefined, language: value },
    true,
  );
  addDocument(created);
  setIdle('ready');
  flashFooter(msg('Created · {0}', created.sourceFile));
}
async function importSourceFile() {
  const value = await api.importSource(
    workspaceMode.value ? (fileTree.value?.selectedFolder() ?? '') : undefined,
  );
  if (!value) return;
  const previous = tabs.value.find((t) => t.id === value.document.documentId);
  if (previous && workspaceMode.value && !value.reused) {
    previous.document = clone(value.document);
    previous.savedSource = value.source;
    previous.dirty = false;
    previous.status = '已保存';
    if (activeId.value === previous.id) {
      pauseSave = true;
      draft.value = clone(value.document);
      editor.value?.applyText(value.source);
      pauseSave = false;
    }
  } else addDocument(value.document);
  await refreshFiles();
  notice.value = msg('Imported {0} · {1}', value.path, value.encoding);
}
async function importIO() {
  clearTimeout(saveTimer);
  await saveTail;
  const problem = await api.importIO(draft.value!.problem.labId, draft.value!.problem.problemId);
  if (!problem) return;
  selectedCases.value = problem.testCases.map((t) => t.id);
  const wasDirty = dirty.value;
  pauseSave = true;
  draft.value!.problem = problem;
  revision++;
  savedRules = JSON.stringify(problem);
  rulesDirty.value = false;
  pauseSave = false;
  config.value!.currentLab = problem.labId;
  config.value!.currentProblem = problem.problemId;
  dirty.value = wasDirty;
  saveStatus.value = wasDirty ? '未保存' : '已保存';
  recordState();
  invalidate();
  projects.value = await api.projects();
  if (wasDirty && config.value!.saveMode === 'auto') await saveNow();
  notice.value = msg('Imported test cases: {0}', problem.testCases.length);
}
async function formatCode() {
  if (formatting.value || blocked.value || !canFormat.value) return;
  formatting.value = true;
  const owner = viewToken(),
    documentId = activeId.value,
    id = revision,
    size = config.value!.indentSize,
    language = editorLanguage.value;
  try {
    const formatted = await api.formatCode(draft.value!.source, language, size);
    if (id !== revision || size !== config.value!.indentSize || language !== editorLanguage.value) {
      if (ownsView(owner) && documentId === activeId.value)
        notice.value = msg('The code or indentation settings changed. Format the code again.');
      return;
    }
    editor.value?.applyText(formatted);
    editor.value?.focus();
  } catch (error) {
    if (ownsView(owner) && documentId === activeId.value && id === revision) throw error;
  } finally {
    formatting.value = false;
  }
}
async function importProject() {
  const result = await api.importProject();
  if (!result) return;
  if (result.updatedProblems) {
    const problem = result.updatedProblems.find(
      (p) =>
        p.labId === draft.value!.problem.labId && p.problemId === draft.value!.problem.problemId,
    );
    if (problem) {
      pauseSave = true;
      draft.value!.problem = clone(problem);
      savedRules = JSON.stringify(problem);
      rulesDirty.value = false;
      revision++;
      pauseSave = false;
      selectedCases.value = problem.testCases.map((t) => t.id);
      recordState();
      invalidate();
    }
    projects.value = result.projects;
    queueChecks();
    notice.value = msg('Experiment test cases updated. Your source files are preserved.');
  } else {
    applyBootstrap(result);
    notice.value = msg('Experiment imported: {0}', result.draft.problem.labId);
    if (result.editBuild) await openBuildSettings();
  }
}
async function chooseImport(value: string) {
  await fileAction(
    value === 'source' ? importSourceFile : value === 'project' ? importProject : importIO,
  );
}
async function chooseExport(value: string) {
  if (blocked.value) return;
  if (value === 'currentTests' || value === 'projectTests') {
    const file = await api.exportTests(
      value === 'currentTests' ? 'current' : 'project',
      clone(draft.value!.problem),
    );
    if (file) notice.value = msg('Exported: {0}', file);
    return;
  }
  if (value === 'source' && !activeTab.value)
    throw new UIError('Create or import a source file first');
  if (value === 'project' && !draft.value!.problem.labId)
    throw new UIError('Select an experiment first');
  await saveTail;
  exportCurrent.value = snapshot();
  exportBuffers.value = tabs.value.map((t) => ({
    ...clone(t.document),
    problem: clone(draft.value!.problem),
  }));
  exportKind.value = value === 'project' ? 'project' : 'source';
}
function exportDone(file: string) {
  exportKind.value = null;
  notice.value = msg('Exported: {0}', file);
}
function showCompilation(c: Compilation) {
  compilationFailed.value = c.status === 'CE';
  diagnostics.value = diagnosticCounts(c.stdout, c.stderr);
  diagnosticRevision.value++;
  logEntries.value = [
    msg(
      'Compile Command\n{0}\n\n{1}{2}\nCompilation: {3} · {4} ms\n',
      (c.commands ?? [c.command])
        .map((command) => command.map((s) => (/\s/.test(s) ? JSON.stringify(s) : s)).join(' '))
        .join('\n'),
      c.stdout ? 'stdout\n' + c.stdout + '\n' : '',
      c.stderr ? 'stderr\n' + c.stderr + '\n' : '',
      c.status,
      c.elapsedMs,
    ),
  ];
}
const compileDirty = computed(() =>
  workspaceMode.value
    ? tabs.value.some((t) => t.dirty)
    : tabs.value.some((t) => t.dirty && (t.document.auxiliary || t.id === targetSourceId.value)),
);
async function compile() {
  if (busy.value || nativeStarting.value || nativeActive.value) return;
  const id = beginExecution('compile');
  let started = false,
    runAfter = false;
  try {
    clearTimeout(saveTimer);
    await saveTail;
    if (!ownsExecution(id)) return;
    const state = await api.compileState(snapshot());
    if (!ownsExecution(id)) return;
    if (compileDirty.value || !state.saved) {
      if (!(await api.confirmCompile()) || !ownsExecution(id)) return;
      await saveAll();
      if (!ownsExecution(id)) return;
    }
    if (execution.value.kind !== 'idle' && execution.value.id === id)
      execution.value = { ...execution.value, stage: 'running' };
    compiledReady.value = false;
    compilationFailed.value = false;
    bottomTab.value = 'output';
    logEntries.value = [];
    diagnostics.value = { warnings: 0, errors: 0 };
    debugEpoch.value++;
    started = true;
    const result = await api.compile(snapshot());
    if (!ownsExecution(id)) return;
    showCompilation(result);
    compiledReady.value = result.status === 'success' && (await api.compileState(snapshot())).ready;
    endExecution(
      id,
      result.status === 'success' ? 'compiled' : result.status === 'cancelled' ? 'stopped' : 'ce',
    );
    runAfter = compiledReady.value && !draft.value!.problem.testCases.length;
  } catch (error) {
    if (!ownsExecution(id)) return;
    compiledReady.value = false;
    compilationFailed.value = started;
    endExecution(id, started ? 'compile-failed' : 'compile-not-started');
    if (!showLpmakeDiagnostic(message(error))) {
      logEntries.value = [errorText(error)];
      diagnostics.value = diagnosticCounts(logs.value);
      if (!diagnostics.value.errors) diagnostics.value.errors = 1;
      diagnosticRevision.value++;
      throw error;
    }
  } finally {
    endExecution(id, 'ready');
    queueChecks();
  }
  if (runAfter) await debug();
}
async function debug() {
  if (!compiledReady.value) {
    notice.value = msg('Save and compile first.');
    return;
  }
  const id = beginExecution('terminal');
  debugRunning.value = false;
  bottomTab.value = 'debug';
  try {
    await api.debugStart(snapshot());
  } catch (error) {
    endExecution(id, 'terminal-failed');
    throw error;
  }
}
async function run(ids?: string[]) {
  if (!compiledReady.value) {
    notice.value = msg('Save and compile first.');
    return;
  }
  const chosen =
    ids ??
    selectedCases.value.filter((id) =>
      draft.value!.problem.testCases.some((test) => test.id === id),
    );
  if (!chosen.length) {
    notice.value = msg('Select at least one test case');
    return;
  }
  const id = beginExecution('judge');
  summaryMode.value = 'result';
  runningCases.value = chosen;
  problemStates.value[draft.value!.problem.problemId] = '运行中';
  for (const selected of chosen) delete results.value[selected];
  finished.value = false;
  bottomTab.value = 'output';
  try {
    const result = await api.judge(snapshot(), chosen);
    if (!ownsExecution(id)) return;
    if (result.cleanupWarnings?.length)
      logEntries.value.push(msg('\n[Cleanup Incomplete] {0}', result.cleanupWarnings.join('; ')));
    const coverage = await api.checkState(snapshot());
    if (!ownsExecution(id)) return;
    problemStates.value[draft.value!.problem.problemId] = coverage.state;
    if (result.status === 'error') {
      error.value = result.error || t('Testing Failed');
      endExecution(id, 'task-failed');
    } else endExecution(id, result.status === 'cancelled' ? 'stopped' : 'tested');
    for (const c of result.cases) results.value[c.id] = c;
    logEntries.value.push('\n');
    for (const [index, c] of result.cases.entries()) {
      if (index) logEntries.value.push('\n\n');
      logEntries.value.push(
        msg(
          'Test Case {0} · {1} · {2} ms{3}{4}{5}{6}',
          c.id,
          c.verdict || c.status,
          c.elapsedMs,
          c.exitCode !== null ? msg(' · exit code {0}', c.exitCode) : '',
          c.signal ? ' · ' + c.signal : '',
          c.message ? '\n' + c.message : '',
          c.stderr ? '\nstderr\n' + c.stderr : '',
        ),
      );
    }
  } catch (error) {
    if (!ownsExecution(id)) return;
    endExecution(id, 'task-failed');
    throw error;
  } finally {
    endExecution(id, 'task-failed');
    if (id === executionEpoch) {
      runningCases.value = [];
      finished.value = true;
      if (problemStates.value[draft.value!.problem.problemId] === '运行中')
        delete problemStates.value[draft.value!.problem.problemId];
      queueChecks();
    }
  }
}
async function stop() {
  const state = execution.value;
  if (state.kind !== 'idle') execution.value = { ...state, stage: 'stopping' };
  try {
    await api.cancel();
    if (state.kind !== 'idle') endExecution(state.id, 'stopped');
  } catch (error) {
    if (state.kind !== 'idle' && execution.value.kind !== 'idle' && execution.value.id === state.id)
      execution.value = { ...execution.value, stage: 'stop-failed' };
    throw error;
  }
}

function addCase() {
  const tests = draft.value!.problem.testCases;
  let id = 1;
  while (tests.some((t) => t.id === String(id))) id++;
  tests.push({ id: String(id), input: '', expectedOutput: '' });
  selectedCases.value.push(String(id));
}
async function openSettings() {
  try {
    const lab = draft.value?.problem.labId ?? '',
      workspace = workspaceMode.value,
      options = lab && !workspace ? await api.projectBuildOptions(lab) : undefined;
    parameterLab.value = lab;
    parameterWorkspace.value = workspace;
    parameterConfigured.value = !!options;
    parameterExpanded.value = false;
    projectOptions.value = clone(
      options ?? { inheritDefaults: true, cArgs: [], cppArgs: [], linkArgs: [] },
    );
    settings.value = clone(config.value!);
    settingsRoot.value = dataRoot.value;
    settingsMessage.value = '';
    settingsOpen.value = true;
  } catch (e) {
    reportOperationError(e);
  }
}
function previewLanguage(language: 'zh-CN' | 'en-US') {
  if (!settings.value) return;
  settings.value.uiLanguage = language;
  setLanguage(language);
  void api.previewLanguage(language).catch(reportOperationError);
}
async function saveSettings() {
  if (settingsSaving.value) return;
  settingsSaving.value = true;
  settingsMessage.value = '';
  try {
    const wasAuto = config.value!.saveMode === 'auto',
      oldRoot = dataRoot.value,
      oldCompiler = compilerLabel.value;
    const languageChanged =
      !workspaceMode.value && settings.value!.language !== draft.value!.language;
    const reloadNeeded = settingsRoot.value !== dataRoot.value || languageChanged;
    if (reloadNeeded && !(await beforeChange())) return;
    const result = await api.saveConfig(
      clone(settings.value!),
      settingsRoot.value,
      parameterLab.value && !parameterWorkspace.value && parameterConfigured.value
        ? { lab: parameterLab.value, options: clone(projectOptions.value) }
        : undefined,
    );
    config.value = result.config;
    setLanguage(config.value.uiLanguage ?? 'zh-CN');
    dataRoot.value = result.dataRoot;
    compilerLabel.value = result.compilerLabel;
    projects.value = result.projects;
    if (languageChanged) {
      await loadWorkspace(
        await api.loadDraft(
          config.value.currentLab,
          config.value.currentProblem,
          config.value.language,
          false,
        ),
      );
    } else if (reloadNeeded) applyBootstrap(await api.reloadDocument());
    else if (!wasAuto && config.value.saveMode === 'auto' && dirty.value) await saveAll();
    const resumingExport = !!exportKind.value;
    settingsOpen.value = false;
    if (resumingExport) {
      await nextTick();
      await exportDialog.value?.resumeSettings();
    }
    queueChecks();
    if (!resumingExport)
      notice.value =
        oldRoot !== dataRoot.value
          ? t('Data folder: {0}', dataRoot.value)
          : oldCompiler !== compilerLabel.value
            ? compilerLabel.value
            : t('Settings Saved');
  } catch (e) {
    settingsMessage.value = errorText(e);
  } finally {
    settingsSaving.value = false;
  }
}
async function detectInstalledCompilers() {
  if (compilerScanning.value || !settingsOpen.value || !settings.value) return;
  const request = ++compilerScanRevision,
    owner = settings.value;
  compilerScanning.value = true;
  const current = () =>
    request === compilerScanRevision && settingsOpen.value && settings.value === owner;
  try {
    const found = await api.detectCompilers();
    if (!current()) return;
    detectedCompilers.value = found;
    selectedCompiler.value = '';
    useRecommended.value = true;
    compilerChoiceOpen.value = true;
    await nextTick();
    if (current()) compilerDialog.value?.focus();
  } catch (error) {
    if (current()) throw error;
  } finally {
    if (request === compilerScanRevision) compilerScanning.value = false;
  }
}
function useDetectedCompiler() {
  const chosen = detectedCompilers.value.find((c) => c.id === selectedCompiler.value);
  if (!chosen || !settings.value) return;
  const previous = clone(settings.value.compiler);
  settings.value.compiler = clone(chosen.compiler);
  if (!useRecommended.value) {
    settings.value.compiler.cArgs = previous.cArgs;
    settings.value.compiler.cppArgs = previous.cppArgs;
    settings.value.compiler.linkArgs = previous.linkArgs;
  }
  compilerChoiceOpen.value = false;
}
function resized(axis: keyof LayoutConfig, event: SplitpanesResizedPayload) {
  if (axis === 'editorPercent' && rightCollapsed.value) return;
  if (!config.value || !event.event || event.panes.length !== 2) return;
  const value = Math.round(event.panes[axis === 'editorPercent' ? 0 : 1].size * 10) / 10;
  if (value === config.value.layout[axis]) return;
  const layout = { ...config.value.layout, [axis]: value };
  config.value.layout = layout;
  layoutTail = layoutTail
    .catch(() => {})
    .then(() => api.saveLayout(layout))
    .catch((e) => {
      error.value = t('Layout was not saved: {0}', message(e));
    });
}
function handleDebugState(state: DebugState) {
  if (nativeActive.value || nativeStarting.value) {
    debugRunning.value = state.status === 'running' || state.status === 'stop-failed';
    if (state.message) terminal.value?.write('\r\n[' + state.message + ']\r\n');
    return;
  }
  if (['compiling', 'running', 'stop-failed'].includes(state.status)) {
    if (execution.value.kind === 'idle') beginExecution('terminal');
    if (execution.value.kind !== 'terminal') return;
    execution.value = {
      ...execution.value,
      stage:
        state.status === 'stop-failed'
          ? 'stop-failed'
          : state.status === 'compiling'
            ? 'preparing'
            : 'running',
    };
    debugRunning.value = state.status !== 'compiling';
    bottomTab.value = 'debug';
    if (state.status === 'stop-failed')
      error.value = state.message ?? t('The program has not exited. Try stopping it again.');
    return;
  }
  if (execution.value.kind !== 'terminal') return;
  endExecution(
    execution.value.id,
    state.status === 'stopped'
      ? 'stopped'
      : state.status === 'error'
        ? 'terminal-failed'
        : 'terminal-ended',
  );
  debugRunning.value = false;
  queueChecks();
  if (state.message) terminal.value?.write('\r\n[' + state.message + ']\r\n');
  if (state.status === 'error') {
    error.value = state.message || t('Failed to Start Debugging');
    bottomTab.value = 'output';
  }
}

let keyHandler: (event: KeyboardEvent) => void = () => {};
let prefixes: ReturnType<typeof parseKeybinding>[number][] = [];
function installShortcuts() {
  const bindings: Record<string, (event: KeyboardEvent) => void> = {};
  prefixes = Object.values(config.value?.shortcuts ?? {})
    .flat()
    .filter((key) => key.includes(' '))
    .map((key) => parseKeybinding(key)[0]);
  for (const [id, keys] of Object.entries(config.value?.shortcuts ?? {}))
    for (const key of keys)
      bindings[key] = (event) => {
        if (
          event.repeat ||
          fileBusy.value ||
          settingsOpen.value ||
          newKind.value ||
          compilerChoiceOpen.value ||
          exportKind.value ||
          buildSettings.value ||
          (event.target as Element)?.closest?.('.tree-inline-edit')
        )
          return;
        const inTerminal = (event.target as Element)?.closest?.('.debug-terminal');
        if (id === 'interrupt') {
          if (!inTerminal || (!debugRunning.value && !terminal.value?.selection())) return;
          event.preventDefault();
          event.stopPropagation();
          const text = terminal.value?.selection();
          if (text) void action(() => api.copyText(text));
          else if (debugRunning.value) void action(interruptTerminal);
          return;
        }
        if (id.startsWith('debug')) {
          if (!workspaceMode.value) return;
          event.preventDefault();
          event.stopPropagation();
          const controls: Record<string, () => Promise<unknown>> = {
            debugStart: () =>
              nativeActive.value
                ? nativeControl(nativeState.value.status === 'paused' ? 'continue' : 'pause')
                : startNative(),
            debugNext: () => nativeControl('next'),
            debugInto: () => nativeControl('stepIn'),
            debugOut: () => nativeControl('stepOut'),
            debugRestart: () => startNative(true),
            debugStop: () => api.nativeStop(),
          };
          if (controls[id]) void action(controls[id]);
          return;
        }
        if (
          ['run', 'format', 'close', 'closeSaved', 'closeAll', 'next', 'previous'].includes(id) &&
          blocked.value
        )
          return;
        if (
          !tabs.value.length &&
          !workspaceMode.value &&
          !['saveAll', 'newSource', 'importSource', 'settings', 'reopen'].includes(id)
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const operations: Record<string, () => Promise<unknown> | void> = {
          run: compile,
          save: saveNow,
          saveAll,
          format: formatCode,
          close: () => tabAction('close'),
          closeSaved: () => tabAction('saved'),
          closeAll: () => tabAction('all'),
          next: () =>
            activateTab(
              tabs.value[
                (tabs.value.findIndex((t) => t.id === activeId.value) + 1) % tabs.value.length
              ].id,
            ),
          previous: () =>
            activateTab(
              tabs.value[
                (tabs.value.findIndex((t) => t.id === activeId.value) - 1 + tabs.value.length) %
                  tabs.value.length
              ].id,
            ),
          copyPath: () => tabAction('copyPath'),
          copyRelativePath: () => tabAction('copyRelativePath'),
          reopen: recentSource,
          importSource: () => fileAction(importSourceFile),
          settings: openSettings,
          newSource: () => {
            if (workspaceMode.value) {
              sidebarCollapsed.value = false;
              void nextTick(() => fileTree.value?.newSource(config.value!.language));
              return;
            }
            document
              .querySelector<HTMLButtonElement>(
                '.toolbar-new-source-trigger, .toolbar-more-trigger',
              )
              ?.click();
          },
        };
        installShortcuts();
        const fn = operations[id];
        if (fn)
          void action(async () => {
            await fn();
          });
      };
  keyHandler = createKeybindingsHandler(bindings, {
    ignore: (event) => event.repeat || event.isComposing,
  });
}
function handleShortcut(event: KeyboardEvent) {
  if (
    (event.target as Element)?.closest?.('.debug-terminal') &&
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    ['a', 'e', 'k', 'l', 'u', 'd', 'z'].includes(event.key.toLowerCase())
  )
    return;
  if (
    (navigator.platform.toLowerCase().includes('mac') ? event.metaKey : event.ctrlKey) &&
    !event.altKey &&
    (event.code === 'Digit0' || event.key === '0')
  ) {
    event.preventDefault();
    void action(() => api.resetZoom());
    return;
  }
  if (
    event.isComposing ||
    event.repeat ||
    settingsOpen.value ||
    newKind.value ||
    compilerChoiceOpen.value ||
    fileBusy.value ||
    exportKind.value ||
    buildSettings.value
  )
    return;
  const prefix = prefixes.some((press) => matchKeybindingPress(event, press));
  keyHandler(event);
  if (prefix) {
    event.preventDefault();
    event.stopPropagation();
  }
}
const cacheMessage = ref<UIText>(''),
  clearingCache = ref(false);
async function clearCache() {
  clearingCache.value = true;
  cacheMessage.value = '';
  try {
    const size = await api.clearCache();
    compiledReady.value = false;
    cacheMessage.value = msg(
      'Cleared {0} MB. The cache will be rebuilt when needed.',
      (size / 1024 ** 2).toFixed(1),
    );
  } catch (e) {
    cacheMessage.value = errorText(e);
  } finally {
    clearingCache.value = false;
  }
}
watch(
  () => !!buildSettings.value,
  (open, old) => {
    if (old && !open)
      nextTick(() => {
        projectMenu.value?.closeMenus();
        if (buildReturnFocus?.isConnected) buildReturnFocus.focus();
        else document.querySelector<HTMLButtonElement>('[data-lab-selector]')?.focus();
      });
  },
);
onMounted(async () => {
  if (!api) {
    error.value = t('Open this page in the LabPad desktop application');
    return;
  }
  disposers.push(
    api.onJudge((event) => {
      if (event.type === 'compilation') {
        if (busy.value !== 'compile') showCompilation(event.compilation);
        queueChecks();
      } else results.value[event.result.id] = event.result;
    }),
    api.onNativeState((state) => {
      if (state.scope && state.scope !== fileScope.value) return;
      if (state.status !== 'paused') frameRevision++;
      nativeState.value = state;
      if (state.status === 'ended' || state.status === 'error')
        setIdle(state.status === 'ended' ? 'native-ended' : 'native-failed');
    }),
    api.onNativeDiagnostic((data) => {
      logEntries.value.push(data);
    }),
    api.onFiles((event) => {
      void action(() => applyFileEvent(event), false);
    }),
    api.onDebugData((data, ack) => terminal.value?.write(data, ack)),
    api.onDebugState(handleDebugState),
    api.onZoom((value) => {
      if (config.value) config.value.zoomFactor = value;
      if (settings.value) settings.value.zoomFactor = value;
    }),
  );
  disposers.push(
    api.onLanguage((language) => setLanguage(language)),
    api.onShortcuts((value) => {
      if (config.value) config.value.shortcuts = value;
      installShortcuts();
    }),
  );
  window.addEventListener('keydown', handleShortcut, true);
  hintTimer = setInterval(() => hintIndex.value++, 9000);
  await action(async () => {
    applyBootstrap(await api.bootstrap());
    installShortcuts();
  });
});
watch(
  () => draft.value?.problem.testCases.map((t) => t.id).join('\u0001'),
  () => {
    const ids = draft.value?.problem.testCases.map((t) => t.id) ?? [];
    selectedCases.value = selectedCases.value.filter((id) => ids.includes(id));
  },
);
function focusNewName(event: Event) {
  event.preventDefault();
  nextTick(() => newNameInput.value?.focus());
}
watch(newKind, (open, old) => {
  if (old && !open)
    nextTick(() => {
      projectMenu.value?.closeMenus();
      document.querySelector<HTMLButtonElement>('[data-lab-selector]')?.focus();
    });
});
watch(settingsOpen, (open, old) => {
  if (old && !open && config.value) {
    setLanguage(config.value.uiLanguage ?? 'zh-CN');
    void api.previewLanguage(config.value.uiLanguage ?? 'zh-CN');
  }
  if (old && !open) {
    compilerScanRevision++;
    compilerScanning.value = false;
    compilerChoiceOpen.value = false;
  }
  if (old && !open && exportKind.value && !settingsSaving.value)
    exportDialog.value?.cancelSettings();
  if (open && exportKind.value)
    nextTick(() => document.querySelector<HTMLInputElement>('[data-personal-class]')?.focus());
});
watch(notice, (value) => {
  clearTimeout(noticeTimer);
  if (value)
    noticeTimer = setTimeout(() => {
      notice.value = '';
    }, 4000);
});
let membershipRevision = 0;
watch(
  () =>
    JSON.stringify([
      workspaceMode.value,
      draft.value?.problem.labId,
      fileEntries.value.map((f) => f.path),
      tabs.value.find((t) => t.document.file === 'LPMake.txt')?.document.source,
    ]),
  () => {
    clearTimeout(membershipTimer);
    const request = ++membershipRevision,
      token = viewToken();
    includedSources.value = null;
    membershipMessage.value = '';
    if (!workspaceMode.value) return;
    const make = tabs.value.find((t) => t.document.file === 'LPMake.txt')?.document.source;
    const current = () => ownsView(token) && request === membershipRevision;
    membershipTimer = setTimeout(
      () =>
        void (async () => {
          try {
            const text =
              make ?? (await api.workspaceOpen(token.lab, 'LPMake.txt', token.problem)).source;
            if (!current()) return;
            const sources = await api.workspaceSources(token.lab, text);
            if (current()) {
              includedSources.value = sources;
              membershipMessage.value = '';
            }
          } catch (error) {
            if (current()) membershipMessage.value = message(error);
          }
        })(),
      250,
    );
  },
  { immediate: true },
);
watch(
  () =>
    JSON.stringify([
      workspaceMode.value,
      draft.value?.problem.labId,
      tabs.value.map((t) => t.document.file),
      activeTab.value?.document.file,
      expanded.value,
      sidebarCollapsed.value,
      sidebarWidth.value,
      rightCollapsed.value,
    ]),
  () => {
    clearTimeout(viewTimer);
    viewTimer = setTimeout(() => {
      void (
        workspaceMode.value
          ? api.workspaceView(draft.value!.problem.labId, {
              openFiles: tabs.value.flatMap((t) => (t.document.file ? [t.document.file] : [])),
              activeFile: activeTab.value?.document.file,
              expanded: clone(expanded.value),
              sidebarWidth: sidebarWidth.value,
              sidebarCollapsed: sidebarCollapsed.value,
              rightCollapsed: rightCollapsed.value,
            })
          : api.fileView(draft.value!.problem.labId, {
              expanded: clone(expanded.value),
              sidebarWidth: sidebarWidth.value,
              sidebarCollapsed: sidebarCollapsed.value,
              rightCollapsed: rightCollapsed.value,
            })
      ).catch((e) => reportOperationError(e));
    }, 250);
  },
);
watch(
  () => [draft.value?.problem.labId, draft.value?.problem.problemId],
  async () => {
    const token = viewToken(),
      request = ++debugPrefsRevision;
    const current = () => ownsView(token) && request === debugPrefsRevision;
    clearTimeout(completionTimer);
    const completion = ++completionRevision;
    completionContext.value = { files: {}, includeDirs: ['.'] };
    completionTimer = setTimeout(
      () => void action(() => refreshCompletion(completion), false),
      150,
    );
    loadingDebugPrefs = true;
    sourceBreakpoints.value = [];
    watches.value = [];
    try {
      if (token.workspace) {
        const value = await api.nativeView(token.lab);
        if (current()) {
          sourceBreakpoints.value = value.breakpoints;
          watches.value = value.watches;
        }
      }
    } catch (reason) {
      if (current()) reportOperationError(reason);
    } finally {
      await nextTick();
      if (current()) loadingDebugPrefs = false;
    }
  },
);
watch(
  () =>
    JSON.stringify([
      fileEntries.value,
      tabs.value.filter((t) => t.document.file === 'LPMake.txt').map((t) => t.document.source),
    ]),
  () => {
    clearTimeout(completionTimer);
    const request = ++completionRevision;
    completionTimer = setTimeout(() => void action(() => refreshCompletion(request), false), 250);
  },
);
watch(
  () => [sourceBreakpoints.value, watches.value],
  () => {
    if (loadingDebugPrefs || !workspaceMode.value) return;
    const token = viewToken(),
      value = { breakpoints: clone(sourceBreakpoints.value), watches: clone(watches.value) };
    clearTimeout(debugPrefTimers.get(token.lab));
    debugPrefTimers.set(
      token.lab,
      setTimeout(() => {
        debugPrefTimers.delete(token.lab);
        void api.nativeView(token.lab, value).catch((reason) => {
          if (ownsView(token)) reportOperationError(reason);
        });
      }, 250),
    );
  },
  { deep: true },
);
watch(
  () => [nativeState.value.selectedFrameId, nativeState.value.status],
  () => {
    if (nativeState.value.status === 'paused' && activeFrame.value?.path)
      void action(() => debugLocation(activeFrame.value!.path!, activeFrame.value!.line), false);
  },
);
watch(
  selectedCases,
  () => {
    if (busy.value !== 'judge') summaryMode.value = 'selected';
  },
  { deep: true },
);
onBeforeUnmount(() => {
  for (const timer of debugPrefTimers.values()) clearTimeout(timer);
  viewEpoch++;
  compilerScanRevision++;
  frameRevision++;
  clearTimeout(completionTimer);
  clearTimeout(viewTimer);
  clearTimeout(membershipTimer);
  clearInterval(hintTimer);
  clearTimeout(noticeTimer);
  clearTimeout(pulseTimer);
  clearTimeout(saveTimer);
  clearTimeout(checkTimer);
  disposers.forEach((d) => d());
  window.removeEventListener('keydown', handleShortcut, true);
});
async function foldSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
  await nextTick();
  document.querySelector<HTMLButtonElement>('.source-sidebar-toggle')?.focus();
}
async function foldRight(collapsed: boolean) {
  rightCollapsed.value = collapsed;
  await nextTick();
  document
    .querySelector<HTMLButtonElement>(collapsed ? '.right-rail button' : '.right-collapse')
    ?.focus();
}
</script>
<template>
  <div
    class="app-shell"
    :data-theme="config?.theme || 'dark'"
    :style="{
      '--code-font-family': textStyle.family,
      '--code-font-size': textStyle.fontSize + 'px',
      '--code-line-height': textStyle.lineHeight,
    }"
  >
    <header class="brandbar">
      <div class="brand">
        <span class="brand-mark">L<span>↗</span></span
        ><strong>LabPad</strong
        ><span class="dev-tag">{{ version.includes('-rc.') ? 'RC' : 'DEV' }}</span>
      </div>
      <span class="version">v{{ version || '0.1.0-dev.9' }}</span>
    </header>
    <div v-if="error" class="alert error" role="alert">
      <span :class="{ 'source-diagnostic': t(error).startsWith('LPMake.txt:') }">{{
        t(error)
      }}</span
      ><button @click="error = ''">{{ t('Close') }}</button>
    </div>
    <div v-if="!ready" class="loading">
      <h2>{{ t('Preparing Workspace') }}</h2>
      <p>{{ t('Loading settings, source files, and the local compiler.') }}</p>
    </div>
    <template v-if="ready && draft && config">
      <section
        ref="mainToolbar"
        class="toolbar"
        :class="{ 'is-compact': compactToolbar, 'hide-select-labels': toolbarWidth < 800 }"
      >
        <div class="project-select">
          <label
            ><span class="select-label">{{ t('Experiment') }}</span
            ><ProjectSelect
              ref="projectMenu"
              :suspended="!!buildSettings || settingsOpen || !!newKind"
              :value="draft.problem.labId"
              :projects="projects"
              :disabled="blocked"
              :theme="config.theme"
              @select="(value) => action(() => fileAction(() => selectLab(value)))"
              @delete="(value) => action(() => deleteLab(value))"
              @build="(value) => action(() => openExperimentBuild(value))" /></label
          ><template v-if="!workspaceMode"
            ><span class="path-divider">/</span
            ><label
              ><span class="select-label">{{ t('Problem') }}</span
              ><ProblemSelect
                :value="draft.problem.problemId"
                :problems="problems"
                :states="problemStates"
                :disabled="blocked"
                :can-create="!!draft.problem.labId"
                :theme="config.theme"
                @select="(value) => action(() => fileAction(() => selectProblem(value)))" /></label
          ></template>
          <div class="run-actions">
            <template v-if="workspaceMode && nativeActive"
              ><button
                class="primary icon-action"
                :title="nativeState.status === 'paused' ? t('Continue (F5)') : t('Pause')"
                :aria-label="
                  nativeState.status === 'paused' ? t('Continue Debugging') : t('Pause Debugging')
                "
                :disabled="nativeStarting"
                @click="
                  action(() =>
                    nativeControl(nativeState.status === 'paused' ? 'continue' : 'pause'),
                  )
                "
              >
                <ActionIcon :name="nativeState.status === 'paused' ? 'play' : 'pause'" /></button
              ><button
                v-for="control in [
                  ['next', t('Step Over'), 'F10'],
                  ['stepIn', t('Step Into'), 'F11'],
                  ['stepOut', t('Step Out'), 'Shift+F11'],
                ] as const"
                class="icon-action"
                :aria-label="control[1]"
                :title="control[1] + '（' + control[2] + '）'"
                :disabled="nativeState.status !== 'paused' || nativeStarting"
                @click="action(() => nativeControl(control[0]))"
              >
                <ActionIcon :name="control[0]" /></button
              ><button
                class="icon-action"
                :title="t('Restart Debugging')"
                :aria-label="t('Restart Debugging')"
                :disabled="nativeStarting"
                @click="action(() => startNative(true))"
              >
                <ActionIcon name="restart" /></button
              ><button
                class="icon-action debug-stop"
                :title="t('Stop Debugging')"
                :aria-label="t('Stop Debugging')"
                :disabled="nativeStarting"
                @click="action(() => api.nativeStop())"
              >
                <ActionIcon name="stop" /></button></template
            ><template v-else
              ><button
                class="primary"
                :disabled="blocked || (!activeTab && !workspaceMode)"
                :title="t('Compile ({0})', shortcutLabel('run'))"
                @click="action(compile)"
              >
                <ActionIcon name="build" />{{ t('Compile') }}</button
              ><button
                class="stop"
                :title="t('Stop')"
                :aria-label="t('Stop')"
                :disabled="!busy"
                @click="action(stop)"
              >
                <ActionIcon name="stop" /><span class="stop-label">{{ t('Stop') }}</span>
              </button></template
            ><span
              class="phase"
              :class="{ 'visually-hidden-phase': toolbarWidth < 1320 }"
              aria-live="polite"
              ><i :class="{ pulse: !!busy || nativeActive }"></i>{{ phase }}</span
            >
          </div>
        </div>
        <div class="toolbar-actions">
          <div v-if="!compactToolbar" class="toolbar-secondary">
            <ActionMenu
              owner="toolbar"
              v-if="!workspaceMode"
              :theme="config.theme"
              :label="t('New Source')"
              trigger-class="toolbar-new-source-trigger"
              @close-auto-focus="keepTreeEditFocus"
              :items="[
                { label: t('C Source (.c)'), value: 'c' },
                { label: t('C++ Source (.cpp)'), value: 'cpp' },
              ]"
              :disabled="blocked"
              @select="action(() => fileAction(() => newSource($event)))"
            />
            <ActionMenu
              owner="toolbar"
              :theme="config.theme"
              :label="t('Import')"
              :items="[
                { label: t('Import Source'), value: 'source' },
                { label: t('Import Test Cases'), value: 'io' },
                { label: t('Import Experiment'), value: 'project' },
              ]"
              :disabled="blocked"
              @select="action(() => chooseImport($event))"
            />
            <ActionMenu
              owner="toolbar"
              :theme="config.theme"
              :label="t('Export')"
              :items="[
                { label: t('Export Source'), value: 'source' },
                { label: t('Export Experiment'), value: 'project' },
                { label: t('Export Current Test Cases'), value: 'currentTests', separator: true },
                { label: t('Export Experiment Test Cases'), value: 'projectTests' },
              ]"
              :disabled="blocked"
              @select="action(() => chooseExport($event))"
            />
            <button
              class="settings-button"
              :aria-label="t('Settings')"
              :disabled="fileBusy"
              @click="openSettings"
            >
              {{ t('⚙ Settings') }}
            </button>
          </div>
          <ActionMenu
            owner="toolbar"
            :theme="config.theme"
            :label="t('Save')"
            :items="[
              { label: t('Save Current'), value: 'current' },
              { label: t('Save All'), value: 'all' },
            ]"
            :disabled="fileBusy || (!tabs.length && !rulesDirty)"
            @select="action(() => chooseSave($event))"
          />
          <ActionMenu
            owner="toolbar"
            v-if="compactToolbar"
            :theme="config.theme"
            :label="t('More')"
            compact
            trigger-class="toolbar-more-trigger"
            :items="toolbarItems"
            :disabled="fileBusy"
            @select="action(() => chooseToolbarAction($event))"
          />
        </div>
      </section>
      <Splitpanes
        class="work-layout"
        horizontal
        :maximize-panes="false"
        @resized="resized('outputPercent', $event)"
        ><Pane :size="100 - config.layout.outputPercent" :min-size="35" :max-size="88"
          ><div class="workspace-row">
            <Splitpanes
              class="workspace"
              :class="{ 'right-folded': rightCollapsed, 'files-folded': sidebarCollapsed }"
              :maximize-panes="false"
              @resized="resized('editorPercent', $event)"
            >
              <Pane
                class="editor-pane"
                :size="rightCollapsed ? 100 : config.layout.editorPercent"
                :min-size="rightCollapsed ? 100 : 20"
                :max-size="rightCollapsed ? 100 : 80"
              >
                <div class="editor-workspace">
                  <Transition name="sidebar-fold">
                    <FileTree
                      :key="fileScope"
                      ref="fileTree"
                      :inert="sidebarCollapsed"
                      :aria-hidden="sidebarCollapsed"
                      :commit="commitTreeEdit"
                      v-show="!sidebarCollapsed"
                      :style="{ width: sidebarWidth + 'px' }"
                      :lab-id="draft.problem.labId"
                      :project="workspaceMode"
                      :cut-paths="
                        clipboardFiles?.cut && clipboardFiles.lab === draft.problem.labId
                          ? clipboardFiles.paths
                          : []
                      "
                      :can-paste="!!clipboardFiles"
                      :files="fileEntries"
                      :expanded="expanded"
                      :active="draft.file || ''"
                      :disabled="fileBusy || !!busy"
                      :theme="config.theme"
                      @open="(files) => action(() => openFiles(files))"
                      @request="(request) => action(() => requestFiles(request))"
                      @expand="expanded = $event"
                      @resize="sidebarWidth = $event"
                      @action="(value, file) => action(() => treeAction(value, file))"
                    />
                  </Transition>
                  <div class="editor-content">
                    <SourceTabs
                      files-enabled
                      :workspace="workspaceMode"
                      :sidebar-collapsed="sidebarCollapsed"
                      @sidebar="foldSidebar"
                      :can-format="tabs.length > 0 && canFormat"
                      :formatting="formatting"
                      @format="action(formatCode)"
                      :tabs="
                        tabs.map((t) => ({
                          id: t.id,
                          name: tabName(t.document),
                          path: t.document.sourceFile || '',
                          dirty: t.dirty,
                          status: t.id === activeId ? saveStatus : t.status,
                        }))
                      "
                      :active="activeId"
                      :theme="config.theme"
                      :disabled="fileBusy || !!busy"
                      @activate="activateTab($event)"
                      @action="(value, id) => action(() => tabAction(value, id))"
                    />
                    <CodeEditor
                      :text-style="textStyle"
                      v-if="tabs.length"
                      ref="editor"
                      v-model="draft.source"
                      :file="draft.file"
                      :language="editorLanguage"
                      :completion-enabled="config.completionEnabled"
                      :completion-files="completionFiles"
                      :debug-enabled="workspaceMode"
                      :breakpoints="displayPoints"
                      :execution-line="executionLine"
                      @breakpoint="breakpoint"
                      @breakpoints="changeBreakpoints"
                      :document-id="fileScope + '\0' + documentEpoch"
                      :open-ids="tabs.map((t) => fileScope + '\0' + t.id)"
                      :indent-size="config.indentSize"
                      :theme="config.theme"
                      :disabled="fileBusy || !!exportKind"
                      @cursor="reportCursor"
                    />
                    <div v-else class="editor-empty">
                      <strong>{{ t('Ready for Your Code') }}</strong>
                      <p>
                        {{ t('Create a source file or import an existing one to get started.') }}
                      </p>
                      <div class="empty-editor-actions">
                        <ActionMenu
                          :theme="config.theme"
                          :label="t('New Source')"
                          @close-auto-focus="keepTreeEditFocus"
                          :items="[
                            { label: t('C Source (.c)'), value: 'c' },
                            { label: t('C++ Source (.cpp)'), value: 'cpp' },
                          ]"
                          :disabled="blocked"
                          @select="
                            action(() =>
                              workspaceMode
                                ? newSource($event)
                                : fileAction(() => newSource($event)),
                            )
                          "
                        /><button :disabled="blocked" @click="action(recentSource)">
                          {{ t('Recent Sources') }}
                        </button>
                      </div>
                    </div>
                    <div class="editor-status">
                      <span
                        v-if="inactiveSource"
                        class="build-excluded"
                        :title="t('Check add_files and remove_files in LPMake')"
                        >{{ t('This File Is Not Included in the Build') }}</span
                      ><span
                        v-else-if="workspaceMode && membershipMessage"
                        class="build-excluded"
                        :title="membershipMessage"
                        >{{ t('Check LPMake') }}</span
                      ><span v-else>{{
                        t(
                          '{0} · Spaces: {1}',
                          draft.language === 'c' ? 'C' : 'C++',
                          config.indentSize,
                        )
                      }}</span
                      ><span>{{
                        config.saveMode === 'auto' ? t('Auto Save') : t('Manual Save')
                      }}</span>
                    </div>
                  </div>
                </div></Pane
              >
              <Pane
                class="cases-pane"
                :class="{ 'is-folded': rightCollapsed }"
                :inert="rightCollapsed"
                :aria-hidden="rightCollapsed"
                :size="rightCollapsed ? 0 : 100 - config.layout.editorPercent"
                :min-size="rightCollapsed ? 0 : 20"
                :max-size="rightCollapsed ? 0 : 80"
                ><div ref="rightHeader" class="pane-heading cases-heading">
                  <button
                    class="icon-action right-collapse"
                    :title="t('Collapse Right Panel')"
                    :aria-label="t('Collapse Right Panel')"
                    @click="foldRight(true)"
                  >
                    <ActionIcon name="chevronRight" />
                  </button>
                  <div
                    v-show="showRightTabs"
                    class="right-tabs"
                    role="tablist"
                    :aria-label="t('Right Panel')"
                  >
                    <button
                      v-show="showBothRightTabs || rightTab === 'tests'"
                      role="tab"
                      :aria-selected="rightTab === 'tests'"
                      :class="{ active: rightTab === 'tests' }"
                      @click="rightTab = 'tests'"
                    >
                      {{ t('Test Cases') }}</button
                    ><button
                      v-if="workspaceMode"
                      v-show="showBothRightTabs || rightTab === 'debug'"
                      role="tab"
                      :aria-selected="rightTab === 'debug'"
                      :class="{ active: rightTab === 'debug' }"
                      @click="rightTab = 'debug'"
                    >
                      {{ t('Debug') }}<i v-if="nativeActive" class="live-dot"></i>
                    </button>
                  </div>
                  <template v-if="rightTab === 'tests'"
                    ><button
                      v-show="showTestSummary"
                      class="test-summary"
                      :class="{ 'all-passed': summaryAllPassed }"
                      role="checkbox"
                      :aria-checked="
                        selectedCases.length === draft.problem.testCases.length &&
                        selectedCases.length > 0
                          ? 'true'
                          : selectedCases.length
                            ? 'mixed'
                            : 'false'
                      "
                      :aria-label="t('Select All Test Cases')"
                      :disabled="!!busy"
                      @click="toggleAllTests"
                    >
                      <span
                        class="test-select-box"
                        :class="{
                          checked:
                            selectedCases.length === draft.problem.testCases.length &&
                            selectedCases.length > 0,
                          partial:
                            selectedCases.length > 0 &&
                            selectedCases.length < draft.problem.testCases.length,
                        }"
                      ></span
                      >{{ testSummary }}</button
                    ><button
                      class="run-test-icon primary icon-action"
                      :disabled="blocked || !compiledReady || !selectedCases.length"
                      :title="compiledReady ? runHint : t('Save and compile first')"
                      :aria-label="runHint"
                      @click="action(() => run())"
                    >
                      <ActionIcon name="play" />
                    </button>
                    <div class="small-actions case-header-actions">
                      <ResultHelp :theme="config.theme" /><span
                        v-show="fullHeader"
                        class="case-extra-actions"
                        ><button
                          :disabled="blocked"
                          :title="t('Comparison rules and time limits are saved in this JSON file')"
                          @click="action(() => api.showProblemFile(snapshot()))"
                        >
                          {{ t('Problem File') }}</button
                        ><button :disabled="blocked" @click="action(() => fileAction(reload))">
                          {{ t('Reload') }}</button
                        ><button :disabled="blocked" @click="addCase">
                          {{ t('+ Add') }}
                        </button></span
                      ><ActionMenu
                        :theme="config.theme"
                        :label="t('More')"
                        :compact="!fullHeader"
                        :items="testHeaderItems"
                        @select="(value) => action(() => testHeaderAction(value))"
                      /></div></template
                  ><template v-else
                    ><div class="debug-header-actions">
                      <button
                        class="run-test-icon primary icon-action"
                        :aria-label="t('Start Debugging')"
                        :title="t('Start Debugging ({0})', shortcutLabel('debugStart'))"
                        :disabled="blocked || nativeActive"
                        @click="action(() => startNative())"
                      >
                        <ActionIcon name="play" /></button
                      ><button
                        v-show="fullHeader"
                        :disabled="blocked || nativeActive"
                        @click="action(openBuildSettings)"
                      >
                        {{ t('Build Settings…') }}
                      </button>
                      <ActionMenu
                        :theme="config.theme"
                        v-if="debugHeaderItems.length"
                        :label="t('More Debug Actions')"
                        :compact="!fullHeader"
                        :items="debugHeaderItems"
                        @select="
                          (value) =>
                            action(async () => {
                              if (value === 'tab') rightTab = 'tests';
                              else await openBuildSettings();
                            })
                        "
                      /></div
                  ></template>
                </div>
                <NativeDebugPanel
                  :key="fileScope"
                  v-if="workspaceMode"
                  v-show="rightTab === 'debug'"
                  :state="nativeState"
                  :breakpoints="displayPoints"
                  :watches="watches"
                  :changed="nativeChanged"
                  :busy="!!busy || nativeStarting"
                  @start="action(() => startNative())"
                  @build="action(openBuildSettings)"
                  @frame="(id) => action(() => selectFrame(id))"
                  @location="(path, line) => action(() => debugLocation(path, line))"
                  @breakpoints="changeBreakpoints"
                  @condition="(path, line) => breakpoint(line, true, path)"
                  @watches="watches = $event"
                />
                <div v-show="rightTab === 'tests'" class="cases-list">
                  <div v-if="!draft.problem.testCases.length" class="empty-state">
                    <h3>{{ t('Run Your Program or Add Test Cases') }}</h3>
                    <p>
                      {{
                        t(
                          'With no test cases, a successful compilation starts the program in the terminal.',
                        )
                      }}<br />{{ t('Import or add test cases to compare the output.') }}
                    </p>
                    <button :disabled="blocked" @click="addCase">{{ t('+ Add Test Case') }}</button>
                  </div>
                  <article
                    v-for="(test, index) in draft.problem.testCases"
                    :key="test.id"
                    class="case-card"
                    :id="'test-case-' + index"
                    :data-status="
                      results[test.id]?.verdict?.toLowerCase() ||
                      (busy === 'judge' && runningCases.includes(test.id) ? 'running' : 'neutral')
                    "
                  >
                    <div class="case-heading">
                      <strong
                        ><input
                          v-model="selectedCases"
                          type="checkbox"
                          :value="test.id"
                          :aria-label="t('Select Test Case {0}', test.id)"
                          :disabled="blocked"
                        /><span class="case-number">{{ index + 1 }}</span
                        >{{ t('Test Cases') }}{{ test.id }}</strong
                      >
                      <div>
                        <button
                          :disabled="blocked || !compiledReady"
                          :aria-label="t('Run Test Case {0}', test.id)"
                          @click="action(() => run([test.id]))"
                        >
                          <ActionIcon name="play" :size="13" /></button
                        ><span class="verdict" :class="results[test.id]?.verdict?.toLowerCase()">{{
                          results[test.id]?.verdict ||
                          (results[test.id]?.status === 'cancelled'
                            ? t('Stopped')
                            : finished
                              ? t('Not Run')
                              : busy === 'judge'
                                ? t('Pending')
                                : t('Not Run'))
                        }}</span
                        ><ResultHelp v-if="results[test.id]?.verdict" :theme="config.theme" /><span
                          v-if="results[test.id]"
                          class="elapsed"
                          >{{ results[test.id].elapsedMs }} ms</span
                        ><button
                          class="delete"
                          :disabled="blocked"
                          :aria-label="t('Delete Test Case')"
                          @click="draft.problem.testCases.splice(index, 1)"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    <div class="io-pair">
                      <label
                        >{{ t('Input') }}<span>stdin</span
                        ><textarea
                          v-model="test.input"
                          :disabled="blocked"
                          :aria-label="t('Input {0}', test.id)"
                          :placeholder="t('Empty input is allowed')"
                          spellcheck="false"
                        ></textarea></label
                      ><label
                        >{{ t('Expected Output') }}<span>expected</span
                        ><textarea
                          v-model="test.expectedOutput"
                          :disabled="blocked"
                          :aria-label="t('Expected Output {0}', test.id)"
                          :placeholder="t('Enter the complete expected output')"
                          spellcheck="false"
                        ></textarea>
                      </label>
                    </div>
                    <div class="actual-heading">
                      <span>{{ t('Actual Output') }}</span
                      ><button
                        v-if="results[test.id]"
                        @click="diffOpen[test.id] = !diffOpen[test.id]"
                      >
                        {{ diffOpen[test.id] ? t('Show Original') : t('Show Diff') }}
                      </button>
                    </div>
                    <OutputDiff
                      v-if="diffOpen[test.id] && results[test.id]"
                      :expected="test.expectedOutput"
                      :actual="results[test.id].stdout"
                    />
                    <pre v-else class="actual-output">{{
                      results[test.id]
                        ? results[test.id].stdout || t('(empty output)')
                        : t('(no output yet)')
                    }}</pre>
                    <pre v-if="results[test.id]?.message" class="checker-message">{{
                      results[test.id].message
                    }}</pre>
                  </article>
                </div>
              </Pane>
            </Splitpanes>
            <aside
              v-if="rightCollapsed"
              class="right-rail"
              :aria-label="t('Collapsed Right Panel')"
            >
              <button
                class="icon-action"
                :aria-label="t('Expand Right Panel')"
                :title="t('Expand Right Panel')"
                @click="foldRight(false)"
              >
                <ActionIcon name="chevronLeft" /></button
              ><template v-if="rightTab === 'tests'"
                ><button
                  class="run-test-icon primary icon-action"
                  :title="compiledReady ? runHint : t('Save and compile first')"
                  :aria-label="runHint"
                  :disabled="blocked || !compiledReady || !selectedCases.length"
                  @click="action(() => run())"
                >
                  <ActionIcon name="play" /></button
                ><button class="rail-label" :title="testSummary" @click="foldRight(false)">
                  {{ testSummary }}
                </button></template
              ><button v-else class="rail-label" @click="foldRight(false)">
                <i v-if="nativeActive" class="live-dot"></i
                >{{
                  nativeState.status === 'paused'
                    ? t('Debugging Paused')
                    : nativeActive
                      ? t('Debugging')
                      : t('Not Debugging')
                }}
              </button>
            </aside>
          </div></Pane
        ><Pane :size="config.layout.outputPercent" :min-size="12" :max-size="65">
          <section class="bottom-panel">
            <div class="bottom-heading">
              <div class="bottom-tabs">
                <button :class="{ active: bottomTab === 'output' }" @click="bottomTab = 'output'">
                  {{ t('Output') }}</button
                ><button :class="{ active: bottomTab === 'debug' }" @click="bottomTab = 'debug'">
                  {{ t('Terminal') }}<i v-if="debugRunning" class="live-dot"></i>
                </button>
              </div>
              <DiagnosticCounts
                :warnings="diagnostics.warnings"
                :errors="diagnostics.errors"
                :revision="diagnosticRevision"
              />
              <div v-show="bottomTab === 'debug'" class="small-actions">
                <button :disabled="blocked || !compiledReady" @click="action(debug)">
                  {{ t('Run Program') }}</button
                ><button :disabled="!debugRunning" @click="terminal?.eof()">
                  {{ t('Send EOF') }}</button
                ><button :disabled="!busy" @click="action(stop)">{{ t('■ Stop Program') }}</button
                ><button @click="terminal?.clear()">{{ t('Clear Output') }}</button>
              </div>
              <div v-show="bottomTab === 'output'" class="small-actions">
                <ResultHelp v-if="compilationFailed" :theme="config.theme" /><button
                  @click="logEntries = []"
                >
                  {{ t('Clear Output') }}
                </button>
              </div>
            </div>
            <pre v-show="bottomTab === 'output'" class="output-log" data-testid="output">{{
              logs ||
              t(
                'Click Compile, then run the test cases. With no test cases, the program starts in the terminal.',
              )
            }}</pre>
            <div v-show="bottomTab === 'debug'" class="terminal-wrapper">
              <DebugTerminal
                :text-style="textStyle"
                ref="terminal"
                :running="debugRunning"
                :context="fileScope"
                :synchronize="synchronizeTerminal"
                :execute="executeTerminal"
                :interrupt="interruptTerminal"
                :epoch="debugEpoch"
                :history-bytes="config.terminalHistoryBytes"
                :scrollback="config.terminalBufferLines"
                :theme="config.theme"
              />
            </div></section></Pane
      ></Splitpanes>
      <footer class="statusbar">
        <div class="status-hint" role="status" :title="t(footerHint)">
          <Transition name="status-slide" mode="out-in"
            ><span :key="t(footerHint)">{{ t(footerHint) }}</span></Transition
          >
        </div>
        <span class="cursor-position" :aria-label="t('Cursor Position')"
          >{{ t('Ln {0} · Col {1}', cursor.line, cursor.column)
          }}<span v-if="cursor.selectionChars">{{
            t(' · {0} selected', cursor.selectionChars)
          }}</span></span
        >
      </footer>
    </template>
    <DialogRoot
      :open="settingsOpen && !!settings"
      @update:open="!$event && !settingsSaving && (settingsOpen = false)"
      ><div
        v-if="settingsOpen && settings"
        class="modal-backdrop"
        @mousedown.self="!settingsSaving && (settingsOpen = false)"
      >
        <DialogContent as-child
          ><section
            class="settings-dialog"
            @keydown.esc.stop.prevent="!settingsSaving && (settingsOpen = false)"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <div class="settings-title">
              <div>
                <span class="eyebrow">{{ t('Preferences') }}</span
                ><DialogTitle as-child
                  ><h2 id="settings-title">{{ t('Settings') }}</h2></DialogTitle
                >
              </div>
              <button
                class="close-button"
                :aria-label="t('Close Settings')"
                :disabled="settingsSaving"
                @click="settingsOpen = false"
              >
                ×
              </button>
            </div>
            <div v-if="settingsMessage" class="settings-message" role="alert">
              {{ t(settingsMessage) }}
            </div>
            <fieldset class="settings-scroll" :disabled="settingsSaving">
              <section>
                <h3>{{ t('Personal Information') }}</h3>
                <p>
                  {{
                    t(
                      'Your student ID is added to exported filenames. You can also export without it.',
                    )
                  }}
                </p>
                <div class="field-grid">
                  <label
                    >{{ t('Class')
                    }}<input
                      v-model="settings.classId"
                      :aria-label="t('Class')"
                      data-personal-class
                      :placeholder="t('e.g. 9527')" /></label
                  ><label
                    >{{ t('Name')
                    }}<input
                      v-model="settings.name"
                      :aria-label="t('Name')"
                      :placeholder="t('e.g. Alex Chen')" /></label
                  ><label
                    >{{ t('Student ID')
                    }}<input
                      v-model="settings.studentId"
                      :aria-label="t('Student ID')"
                      :placeholder="t('e.g. 7355608')"
                  /></label>
                </div>
              </section>
              <section>
                <h3>{{ t('Editing and Saving') }}</h3>
                <label
                  >{{ t('Interface Language') }}
                  <select
                    :value="settings.uiLanguage ?? 'zh-CN'"
                    :aria-label="t('Interface Language')"
                    @change="
                      previewLanguage(
                        ($event.target as HTMLSelectElement).value as 'zh-CN' | 'en-US',
                      )
                    "
                  >
                    <option value="zh-CN">{{ t('Simplified Chinese') }}</option>
                    <option value="en-US">{{ t('English') }}</option>
                  </select>
                </label>

                <div class="field-grid two">
                  <label
                    >{{ t('Save Mode')
                    }}<select v-model="settings.saveMode" :aria-label="t('Save Mode')">
                      <option value="manual">{{ t('Manual Save (default)') }}</option>
                      <option value="auto">{{ t('Auto Save') }}</option>
                    </select></label
                  ><label
                    >{{ t('Source Language')
                    }}<select v-model="settings.language" :aria-label="t('Source Language')">
                      <option value="c">{{ t('C (.c)') }}</option>
                      <option value="cpp">{{ t('C++ (.cpp)') }}</option>
                    </select></label
                  ><label
                    >{{ t('Tab / Indent Size')
                    }}<select
                      v-model.number="settings.indentSize"
                      :aria-label="t('Tab / Indent Size')"
                    >
                      <option :value="1">{{ t('1 space') }}</option>
                      <option :value="2">{{ t('2 spaces') }}</option>
                      <option :value="4">{{ t('4 spaces (default)') }}</option>
                    </select></label
                  ><label
                    >{{ t('Theme')
                    }}<select v-model="settings.theme" :aria-label="t('Theme')">
                      <option value="dark">{{ t('Dark · VS Code') }}</option>
                      <option value="light">{{ t('Light · VS Code') }}</option>
                    </select></label
                  >
                </div>
                <label class="checkbox-field"
                  ><input
                    v-model="settings.formatOnSave"
                    type="checkbox"
                    :aria-label="t('Format on Save')"
                  />{{ t('Format on Save (clang-format)') }}</label
                ><label class="checkbox-field"
                  ><input v-model="settings.completionEnabled" type="checkbox" />{{
                    t('Basic Code Completion')
                  }}</label
                >
                <div class="field-grid two">
                  <label
                    >{{ t('Interface Zoom')
                    }}<ZoomSelect v-model="settings.zoomFactor" :theme="settings.theme" /></label
                  ><label
                    >{{ t('Keyboard Shortcuts')
                    }}<button
                      :aria-label="t('Configure Shortcuts…')"
                      @click="action(() => api.openShortcuts())"
                    >
                      {{ t('Configure Shortcuts…') }}
                    </button></label
                  >
                </div>
                <p>
                  {{
                    t(
                      'Imported source files are kept in the data folder. Saving updates the current copy.',
                    )
                  }}
                </p>
                <TypographySettings
                  v-model="settingsTypography"
                  @valid="typographyValid = $event"
                />
              </section>
              <section>
                <h3>{{ t('Data Location') }}</h3>
                <PathField
                  v-model="settingsRoot"
                  :label="t('Data Folder')"
                  kind="directory"
                  @valid="pathValidity.data = $event"
                />
                <p>
                  {{
                    t(
                      'Choose an existing folder. Changing the location copies your data and keeps the original folder.',
                    )
                  }}
                </p>
              </section>
              <section>
                <div class="settings-section-heading">
                  <h3>{{ t('Compiler') }}</h3>
                  <button
                    v-if="settings.compiler.mode === 'custom'"
                    :disabled="compilerScanning || !!busy"
                    @click="action(detectInstalledCompilers)"
                  >
                    {{ compilerScanning ? t('Detecting…') : t('Detect') }}
                  </button>
                </div>
                <p>
                  {{
                    t(
                      'Built-in Zig warms up in the background and uses available CPU cores. Its cache is limited to 2 GB.',
                    )
                  }}
                </p>
                <div class="field-grid">
                  <label
                    >{{ t('Mode')
                    }}<select v-model="settings.compiler.mode" :aria-label="t('Compiler Mode')">
                      <option value="builtin">{{ t('Built-in Zig') }}</option>
                      <option value="custom">{{ t('Custom Compiler') }}</option>
                    </select></label
                  ><label v-if="settings.compiler.mode === 'custom'"
                    >{{ t('Compiler Type')
                    }}<select v-model="settings.compiler.kind" :aria-label="t('Compiler Type')">
                      <option value="zig">Zig</option>
                      <option value="gcc">GCC</option>
                      <option value="clang">Clang</option>
                    </select></label
                  >
                </div>
                <div v-if="settings.compiler.mode === 'custom'" class="compiler-paths">
                  <PathField
                    v-model="settings.compiler.cPath"
                    :label="t('C Compiler Path')"
                    kind="executable"
                    @valid="pathValidity.c = $event"
                  /><PathField
                    v-model="settings.compiler.cppPath"
                    :label="t('C++ Compiler Path')"
                    kind="executable"
                    :allow-empty="settings.compiler.kind === 'zig' || settings.language === 'c'"
                    @valid="pathValidity.cpp = $event"
                  />
                </div>
                <div class="cache-controls">
                  <button :disabled="!!busy || clearingCache" @click="clearCache">
                    {{ clearingCache ? t('Cleaning…') : t('Clear Compiler Cache') }}</button
                  ><span role="status">{{ t(cacheMessage) }}</span>
                </div>
              </section>
              <section>
                <details
                  class="default-parameters"
                  :open="parameterExpanded"
                  @toggle="parameterExpanded = ($event.target as HTMLDetailsElement).open"
                >
                  <summary>{{ t('Advanced Compiler Arguments') }}</summary>
                  <ParameterSettings
                    :lab="parameterLab"
                    :workspace="parameterWorkspace"
                    :machine="settings.compiler"
                    v-model:options="projectOptions"
                    v-model:configured="parameterConfigured"
                    :preview="previewParameters"
                    @edit="action(editSettingsBuild)"
                  />
                </details>
              </section>
              <section>
                <h3>{{ t('Terminal') }}</h3>
                <div class="field-grid two">
                  <label
                    >{{ t('Program Time Limit (ms; leave blank to stop manually)')
                    }}<input
                      :value="settings.debugTimeLimitMs ?? ''"
                      @input="
                        settings.debugTimeLimitMs =
                          ($event.target as HTMLInputElement).value === ''
                            ? null
                            : Number(($event.target as HTMLInputElement).value)
                      "
                      type="number"
                      min="1" /></label
                  ><label
                    >{{ t('Terminal Scrollback (lines)')
                    }}<input
                      v-model.number="settings.terminalBufferLines"
                      type="number"
                      min="100"
                      max="100000" /></label
                  ><label
                    >{{ t('Input History Limit (bytes)')
                    }}<input
                      v-model.number="settings.terminalHistoryBytes"
                      type="number"
                      min="1024"
                      max="1048576"
                      step="1024"
                  /></label>
                </div>
              </section>
            </fieldset>
            <div class="settings-footer">
              <DialogActions
                ><button :disabled="settingsSaving" @click="settingsOpen = false">
                  {{ t('Cancel') }}</button
                ><button
                  class="primary"
                  :disabled="!!busy || settingsSaving || !validSettingsPaths"
                  @click="saveSettings"
                >
                  {{ settingsSaving ? t('Saving…') : t('Save Settings') }}
                </button></DialogActions
              >
            </div>
          </section></DialogContent
        >
      </div></DialogRoot
    >
    <DialogRoot :open="compilerChoiceOpen" @update:open="!$event && (compilerChoiceOpen = false)"
      ><div v-if="compilerChoiceOpen" class="modal-backdrop compiler-picker-backdrop">
        <DialogContent as-child
          ><section
            ref="compilerDialog"
            tabindex="-1"
            class="compiler-picker"
            role="dialog"
            aria-modal="true"
            aria-labelledby="compiler-picker-title"
            @keydown.esc.stop.prevent="compilerChoiceOpen = false"
          >
            <h2 id="compiler-picker-title">{{ t('Detect Compilers') }}</h2>
            <template v-if="detectedCompilers.length"
              ><p>
                {{ t('Choose a compiler to fill in its type and paths, then save the settings.') }}
              </p>
              <label class="checkbox-field"
                ><input v-model="useRecommended" type="checkbox" />{{
                  t('Also use recommended arguments (updates global defaults)')
                }}</label
              >
              <div class="compiler-options">
                <label
                  v-for="candidate in detectedCompilers"
                  :key="candidate.id"
                  class="compiler-option"
                  ><input
                    v-model="selectedCompiler"
                    type="radio"
                    name="detected-compiler"
                    :value="candidate.id"
                    :aria-label="candidate.name + ' ' + candidate.compiler.cPath"
                  /><span
                    ><strong
                      >{{ candidate.name
                      }}<small v-if="!candidate.compiler.cppPath">{{
                        t('· C only')
                      }}</small></strong
                    ><span>{{ candidate.version }}</span
                    ><code>{{ candidate.compiler.cPath }}</code
                    ><small v-if="candidate.target">{{ candidate.target }}</small></span
                  ></label
                >
              </div></template
            >
            <p v-else class="compiler-not-found">
              {{ t('LabPad found no supported compiler in common installation locations.') }}
            </p>
            <DialogActions class="compiler-picker-actions"
              ><button @click="compilerChoiceOpen = false">
                {{ detectedCompilers.length ? t('Cancel') : t('Close') }}</button
              ><button
                v-if="detectedCompilers.length"
                class="primary"
                :disabled="!selectedCompiler"
                @click="useDetectedCompiler"
              >
                {{ t('Use This Compiler') }}
              </button></DialogActions
            >
          </section></DialogContent
        >
      </div></DialogRoot
    >
    <DialogRoot :open="!!newKind" @update:open="!$event && !newSaving && (newKind = null)"
      ><div v-if="newKind" class="modal-backdrop">
        <DialogContent as-child @open-auto-focus="focusNewName"
          ><section
            class="create-dialog"
            @keydown.esc.stop.prevent="!newSaving && (newKind = null)"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-title"
          >
            <DialogTitle as-child
              ><h2 id="create-title">
                {{ newKind === 'lab' ? t('New Experiment') : t('New Problem') }}
              </h2></DialogTitle
            ><label v-if="newKind === 'lab'"
              >{{ t('Experiment Type')
              }}<select v-model="newMode" :aria-label="t('Experiment Type')">
                <option value="problem-set">{{ t('Problem Set · Single-File Exercises') }}</option>
                <option value="project">{{ t('Project · One Program') }}</option>
              </select></label
            ><label
              >{{ newKind === 'lab' ? t('Experiment Name') : t('Problem')
              }}<input
                ref="newNameInput"
                v-model="newName"
                :aria-label="newKind === 'lab' ? t('Experiment Name') : t('New Problem ID')"
                :placeholder="newKind === 'lab' ? t('e.g. Experiment 2') : t('e.g. Lab 2-1')"
                :disabled="newSaving"
                @keydown.enter="createItem"
                autofocus
            /></label>
            <p v-if="newMessage" class="field-error" role="alert">{{ newMessage }}</p>
            <DialogActions class="create-actions"
              ><button :disabled="newSaving" @click="newKind = null">{{ t('Cancel') }}</button
              ><button class="primary" :disabled="newSaving || !newName.trim()" @click="createItem">
                {{ t('Create') }}
              </button></DialogActions
            >
          </section></DialogContent
        >
      </div></DialogRoot
    >

    <BuildSettings
      v-if="buildSettings"
      :source="buildSettings.source"
      :revision="buildSettings.revision"
      :lab="draft!.problem.labId"
      :compiler-label="compilerLabel"
      :preview="previewBuild"
      :conflict="buildConflict"
      @close="buildSettings = undefined"
      @apply="applyBuildSettings"
    />
    <ExportDialog
      v-if="exportKind && exportCurrent && config"
      ref="exportDialog"
      :workspace="workspaceMode"
      :kind="exportKind"
      :current="exportCurrent"
      :buffers="exportBuffers"
      :theme="config.theme"
      :student-id="config.studentId"
      :suspended="settingsOpen"
      @close="exportKind = null"
      @settings="openSettings"
      @done="exportDone"
    />
    <DialogRoot :open="!!conditionDialog" @update:open="!$event && (conditionDialog = undefined)"
      ><div v-if="conditionDialog" class="modal-backdrop">
        <DialogContent as-child
          ><section class="create-dialog" role="dialog" aria-labelledby="condition-title">
            <DialogTitle as-child
              ><h2 id="condition-title">{{ t('Conditional Breakpoint') }}</h2></DialogTitle
            >
            <p>{{ conditionDialog.path }}:{{ conditionDialog.line }}</p>
            <label
              >{{ t('Condition')
              }}<input
                v-model="conditionDialog.value"
                :aria-label="t('Breakpoint Condition')"
                :placeholder="t('e.g. i == 10')"
                maxlength="1024"
                @keydown.enter.prevent="applyCondition"
            /></label>
            <p>
              {{
                t('Pause when the condition is true. Leave it blank for an ordinary breakpoint.')
              }}
            </p>
            <DialogActions class="create-actions"
              ><button @click="conditionDialog = undefined">{{ t('Cancel') }}</button
              ><button class="primary" @click="applyCondition">
                {{ t('Apply') }}
              </button></DialogActions
            >
          </section></DialogContent
        >
      </div></DialogRoot
    >
  </div>
</template>

<style>
.workspace-row {
  overflow: auto;
  display: flex;
  height: 100%;
  min-width: 0;
  min-height: 0;
}
.workspace-row > .workspace {
  flex: 1;
  min-width: 0;
}
.icon-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 4px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text);
  border-radius: 4px;
  flex-shrink: 0;
}
.app-shell[data-theme] .icon-action:not(.primary) {
  background: transparent;
  border-color: transparent;
  color: var(--text);
}
.app-shell[data-theme] .icon-action:not(.primary):hover:not(:disabled),
.app-shell[data-theme] .icon-action:not(.primary):focus-visible {
  background: var(--input);
  border-color: var(--border);
}
.run-actions > button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.icon-action:disabled {
  color: var(--muted);
  opacity: 0.45;
}
.cases-pane:not(.is-folded) {
  --pane-min-width: var(--right-pane-min-width);
}
.cases-heading {
  --pane-header-padding: 6px;
  gap: 4px;
  flex: none;
  height: var(--pane-header-height);
  min-height: var(--pane-header-height);
  overflow: hidden;
  flex-wrap: nowrap;
  box-sizing: border-box;
}
.right-tabs {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 2px;
}
.app-shell .cases-heading .right-tabs button {
  border: 0;
  background: transparent;
  padding: 5px 7px;
  white-space: nowrap;
  color: var(--muted);
  border-bottom: 2px solid transparent;
  border-radius: 0;
}
.app-shell .cases-heading .right-tabs button.active {
  color: var(--text);
  border-bottom-color: var(--accent);
}
.app-shell .cases-heading .test-summary {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  border: 1px solid transparent;
  background: transparent;
  box-shadow: none;
  color: var(--muted);
  font-size: 11px;
  padding: 4px;
  white-space: nowrap;
}
.test-select-box {
  width: 11px;
  height: 11px;
  border: 1px solid var(--muted);
  border-radius: 2px;
  display: inline-block;
  box-sizing: border-box;
}
.test-select-box.checked,
.test-select-box.partial {
  background: var(--accent);
  border-color: var(--accent);
}
.test-select-box.checked:after {
  content: '✓';
  display: block;
  color: white;
  font-size: 10px;
  line-height: 10px;
}
.test-select-box.partial:after {
  content: '−';
  display: block;
  color: white;
  font-size: 10px;
  line-height: 9px;
}
.case-header-actions {
  flex: none;
  margin-left: auto;
  gap: 4px;
}
.case-extra-actions {
  display: inline-flex;
  gap: 4px;
}
.case-header-actions > .action-menu-trigger {
  font-size: 10px;
  min-width: 0;
}
.case-header-actions > .action-menu-trigger:not(.is-compact) {
  padding: 3px 6px;
}
.right-rail {
  width: 35px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 9px;
  border-left: 1px solid var(--border);
  padding-top: 6px;
  flex: none;
  background: var(--panel);
}
.rail-label {
  writing-mode: vertical-rl;
  border: 0;
  background: transparent;
  font-size: 11px;
  letter-spacing: 1px;
  padding: 5px;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 8px;
}
.right-rail .live-dot {
  display: inline-block;
}
.native-debug-panel {
  min-height: 0;
}
.cases-pane > .cases-list {
  flex: 1;
  min-height: 0;
}
.cases-pane {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
@container (min-width:651px) {
  .case-header-actions > .action-menu-trigger {
    padding: 2px 5px;
  }
}
@container (max-width:350px) {
  .case-header-actions {
    margin-left: 0;
  }
  .test-summary {
    font-size: 10px;
  }
  .right-tabs button {
    padding: 5px 3px;
  }
}
.app-shell .pane-heading.cases-heading {
  justify-content: flex-start;
}
.debug-source-changed {
  border-color: var(--diagnostic-warning);
  background: color-mix(in srgb, var(--diagnostic-warning) 9%, transparent);
}
.debug-stop {
  color: var(--diagnostic-error);
}
.app-shell .cases-heading .test-summary.all-passed {
  background: var(--success-bg);
  border-color: var(--success);
  color: var(--success);
}
.debug-header-actions {
  flex: none;
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}
.debug-header-actions > button {
  height: 28px;
  box-sizing: border-box;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.app-shell .right-tabs > button,
.app-shell .bottom-heading button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}
.app-shell .right-tabs .live-dot,
.app-shell .bottom-heading .live-dot {
  display: block;
  flex: none;
  align-self: center;
  margin: 0;
}
</style>
