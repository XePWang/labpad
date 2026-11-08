<script setup lang="ts">
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
  compilerLabel = ref('正在读取编译器…');
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
  if (execution.value.kind !== 'idle') throw Error('请先停止当前任务。');
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
const logs = ref(''),
  error = ref(''),
  notice = ref(''),
  saveStatus = ref('已保存'),
  dirty = ref(false),
  ready = ref(false);
const settingsOpen = ref(false),
  settingsSaving = ref(false),
  settingsMessage = ref(''),
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
const phase = computed(() =>
  nativeActive.value && !nativeStarting.value
    ? nativeMessage(nativeState.value.status)
    : taskMessage(execution.value),
);
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
const footerPulse = ref('');
let pulseTimer: ReturnType<typeof setTimeout> | undefined;
function flashFooter(text: string) {
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
    ? '自动保存已开启，写完稍停即可保存。'
    : shortcutLabel('save') + ' 保存当前源码；导入副本也会保存在这里。',
  '空格小点只负责指路，导出的仍是普通空格。',
  '选中多行后按 Tab / Shift+Tab，整块调整缩进。',
  '没有测试点时，编译通过就会进入终端。',
  shortcutLabel('format') + ' 整理代码；' + keyLabel('$mod+KeyZ') + ' 可整次撤销。',
  '测试输入、预期输出和比较规则随题目 JSON 保存。',
  '别急，先让一个小例子跑通。',
  '多测一个边界值，心里就多一点底。',
  '分隔线可以拖，给忙碌的一边多一点位置。',
  '分号藏得再好，编译器也会认真找。',
  '空输入、零、负数：边界值也想拥有姓名。',
  '测试点通过以后，别忘了再读一遍题目。',
  '思路卡住时，先把问题缩小一点。',
  '我负责对答案，你负责奇思妙想。',
  '累了就停一下，分号不会自己长出来。',
  '一个小测试，也能照亮一大段代码。',
  '选中几行按 Tab，大家一起挪一挪。',
  'Shift+Tab 往回走，缩进也有回头路。',
  keyLabel('$mod+KeyF') + ' 找一找，变量名不用靠眼力。',
  keyLabel('$mod+KeyZ') + ' 撤销、' + keyLabel('$mod+Shift+KeyZ') + ' 重做，放心整理代码。',
  '输入跑完会关闭 stdin，读到 EOF 就可以收工。',
  '输出多了少了？点开 Diff 看看差在哪。',
  draft.value?.language === 'cpp'
    ? '一个 cout，也能帮思路探探路。'
    : '一个 printf，也能帮思路探探路。',
  '导出前再跑一次，让提交更踏实。',
  '给测试点一个特别的输入，也许会有新发现。',
  '代码可以慢慢写，测试记得常常跑。',
]);
const footerHint = computed(() =>
  formatting.value
    ? '正在整理代码格式…'
    : busy.value
      ? phase.value + ' · ' + compilerLabel.value
      : fileBusy.value
        ? '正在准备文件…'
        : notice.value ||
          footerPulse.value ||
          (cursor.value.selectionChars
            ? '已选 ' +
              cursor.value.selectionChars +
              ' 个字符 · ' +
              cursor.value.selectionLines +
              ' 行；Tab / Shift+Tab 可整块缩进。'
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
    notice.value = '该调用位于项目外部代码中。';
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
      if (!(await api.confirmCompile())) return { ...result, output: '已取消。' };
      if (scope !== fileScope.value) return result;
      await saveAll();
      result = await api.terminalCommand(snapshot(), text);
    }
    if (scope === fileScope.value) await refreshFiles();
    return result;
  } catch (error) {
    if (scope !== fileScope.value || !showLpmakeDiagnostic(message(error))) throw error;
    return { ...(await api.terminalContext(snapshot())), output: '构建失败，请查看“输出”。' };
  }
}

const runHint = computed(() =>
  selectedCases.value.length === draft.value?.problem.testCases.length
    ? '运行全部测试点'
    : '运行已选的' + selectedCases.value.length + '个测试点',
);
const testSummary = computed(() =>
  busy.value === 'judge'
    ? runningCases.value.filter((id) => results.value[id]).length +
      '/' +
      runningCases.value.length +
      ' 已完成'
    : summaryMode.value === 'result'
      ? passed.value + '/' + (draft.value?.problem.testCases.length ?? 0) + ' 通过'
      : selectedCases.value.length + '/' + (draft.value?.problem.testCases.length ?? 0) + ' 已选',
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
        { label: 'C 源码（.c）', value: 'new:c', disabled: blocked.value },
        { label: 'C++ 源码（.cpp）', value: 'new:cpp', disabled: blocked.value },
      ]
    : []),
  {
    label: '导入源码',
    value: 'import:source',
    separator: !workspaceMode.value,
    disabled: blocked.value,
  },
  { label: '导入测试点', value: 'import:io', disabled: blocked.value },
  { label: '导入实验项目', value: 'import:project', disabled: blocked.value },
  { label: '导出源码', value: 'export:source', separator: true, disabled: blocked.value },
  { label: '导出实验项目', value: 'export:project', disabled: blocked.value },
  { label: '导出当前测试点', value: 'export:currentTests', disabled: blocked.value },
  { label: '导出项目测试点', value: 'export:projectTests', disabled: blocked.value },
  { label: '设置', value: 'settings', separator: true, disabled: fileBusy.value },
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
    ? [{ label: '切换到调试', value: 'tab' }]
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
  { label: '定位未通过', value: 'locate', disabled: !failedIds.value.length },
  {
    label: '重测未通过',
    value: 'failed',
    disabled: blocked.value || !compiledReady.value || !failedIds.value.length,
  },
  ...(!fullHeader.value
    ? [
        { label: '题目文件', value: 'rule', separator: true, disabled: blocked.value },
        { label: '重新加载', value: 'reload', disabled: blocked.value },
        { label: '新增测试点', value: 'add', disabled: blocked.value },
      ]
    : []),
]);
const debugHeaderItems = computed(() => [
  ...(!showBothRightTabs.value ? [{ label: '切换到测试点', value: 'tab' }] : []),
  ...(!fullHeader.value
    ? [{ label: '构建设置…', value: 'build', disabled: blocked.value || nativeActive.value }]
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
  if (busy.value) throw Error('请先停止当前任务');
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
  if (value === 'crossLabDrop') throw Error('请先复制文件，再切换实验粘贴。');
  if (value === 'invalidDrop') throw Error('拖动的文件信息无效，请重试。');
}
async function commitTreeEdit(form: WorkspaceEdit) {
  if (busy.value || fileBusy.value) throw Error('请等待当前任务完成');
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
      : (document.querySelector<HTMLElement>('[aria-label="实验项目"]') ?? undefined);
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
    document.querySelector<HTMLSelectElement>('[aria-label="参数来源"]')?.focus();
  }
}
function applyBuildSettings(text: string, version: number) {
  const tab = tabs.value.find((t) => t.id === buildDocument.value);
  if (!tab || tab.revision !== version) {
    buildConflict.value = '构建配置已变化，请保留本次内容，重新打开构建设置核对。';
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
  notice.value = '已删除项目：' + lab;
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
  logs.value = 'LPMake 配置检查\n\n' + text + '\n';
  diagnostics.value = diagnosticCounts(text);
  diagnosticRevision.value++;
  bottomTab.value = 'output';
  return true;
}
function reportOperationError(reason: unknown) {
  const text = message(reason);
  if (!showLpmakeDiagnostic(text)) error.value = text;
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
  } else notice.value = '还没有可恢复的源码，可以先新建一份。';
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
  if (!tab) return Promise.reject(new Error('请先新建或导入源码'));
  if (tab.document.ruleFile && !tab.dirty)
    return Promise.resolve({ path: tab.document.sourceFile ?? '', source: tab.savedSource });
  if (tab.document.ruleFile && rulesDirty.value)
    return Promise.reject(new Error('测试点面板与题目文件均有修改，请先保留一处修改后再保存。'));
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
      flashFooter('已保存 · ' + result.path);
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
    throw new Error('测试点面板与题目文件均有修改，请先保留一处修改后再保存。');
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
    throw new Error('测试点面板与题目文件均有修改，请先保留一处修改后再保存。');
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
        throw new Error('测试点面板与题目文件均有修改，请先保留一处修改后再保存。');
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
  flashFooter('已新建 · ' + created.sourceFile);
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
  notice.value = '已导入 ' + value.path + ' · ' + value.encoding;
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
  notice.value = '已导入 ' + problem.testCases.length + ' 个测试点';
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
        notice.value = '代码或缩进设置已改变，请重新格式化';
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
    notice.value = '项目测试点已更新，源码保留。';
  } else {
    applyBootstrap(result);
    notice.value = '已导入项目：' + result.draft.problem.labId;
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
    if (file) notice.value = '已导出：' + file;
    return;
  }
  if (value === 'source' && !activeTab.value) throw new Error('请先新建或导入源码');
  if (value === 'project' && !draft.value!.problem.labId) throw new Error('请先选择实验项目');
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
  notice.value = '已导出：' + file;
}
function showCompilation(c: Compilation) {
  compilationFailed.value = c.status === 'CE';
  diagnostics.value = diagnosticCounts(c.stdout, c.stderr);
  diagnosticRevision.value++;
  logs.value =
    '编译命令\n' +
    (c.commands ?? [c.command])
      .map((command) => command.map((s) => (/\s/.test(s) ? JSON.stringify(s) : s)).join(' '))
      .join('\n') +
    '\n\n' +
    (c.stdout ? 'stdout\n' + c.stdout + '\n' : '') +
    (c.stderr ? 'stderr\n' + c.stderr + '\n' : '') +
    '\n编译状态：' +
    c.status +
    ' · ' +
    c.elapsedMs +
    ' ms\n';
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
    logs.value = '';
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
      logs.value = message(error);
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
    notice.value = '请先保存并编译。';
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
    notice.value = '请先保存并编译。';
    return;
  }
  const chosen =
    ids ??
    selectedCases.value.filter((id) =>
      draft.value!.problem.testCases.some((test) => test.id === id),
    );
  if (!chosen.length) {
    notice.value = '请至少选择一个测试点';
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
      logs.value += '\n[清理未完成] ' + result.cleanupWarnings.join('；');
    const coverage = await api.checkState(snapshot());
    if (!ownsExecution(id)) return;
    problemStates.value[draft.value!.problem.problemId] = coverage.state;
    if (result.status === 'error') {
      error.value = result.error || '评测任务失败';
      endExecution(id, 'task-failed');
    } else endExecution(id, result.status === 'cancelled' ? 'stopped' : 'tested');
    for (const c of result.cases) results.value[c.id] = c;
    logs.value +=
      '\n' +
      result.cases
        .map(
          (c) =>
            '测试点 ' +
            c.id +
            ' · ' +
            (c.verdict || c.status) +
            ' · ' +
            c.elapsedMs +
            ' ms' +
            (c.exitCode !== null ? ' · 退出码 ' + c.exitCode : '') +
            (c.signal ? ' · ' + c.signal : '') +
            (c.message ? '\n' + c.message : '') +
            (c.stderr ? '\nstderr\n' + c.stderr : ''),
        )
        .join('\n\n');
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
          ? '数据目录：' + dataRoot.value
          : oldCompiler !== compilerLabel.value
            ? compilerLabel.value
            : '设置已保存';
  } catch (e) {
    settingsMessage.value = message(e);
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
      error.value = '布局未保存：' + message(e);
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
    if (state.status === 'stop-failed') error.value = state.message ?? '程序尚未退出，请重试停止。';
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
    error.value = state.message || '调试启动失败';
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
            [...document.querySelectorAll<HTMLButtonElement>('.toolbar-actions button')]
              .find((b) => b.textContent?.includes('新建源码'))
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
const cacheMessage = ref(''),
  clearingCache = ref(false);
async function clearCache() {
  clearingCache.value = true;
  cacheMessage.value = '';
  try {
    const size = await api.clearCache();
    compiledReady.value = false;
    cacheMessage.value = '已清理 ' + (size / 1024 ** 2).toFixed(1) + ' MB，下一次编译会重建缓存。';
  } catch (e) {
    cacheMessage.value = message(e);
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
        else document.querySelector<HTMLButtonElement>('[aria-label="实验项目"]')?.focus();
      });
  },
);
onMounted(async () => {
  if (!api) {
    error.value = '请在 LabPad 桌面窗口中打开此页面';
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
      logs.value += data;
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
      document.querySelector<HTMLButtonElement>('[aria-label="实验项目"]')?.focus();
    });
});
watch(settingsOpen, (open, old) => {
  if (old && !open) {
    compilerScanRevision++;
    compilerScanning.value = false;
    compilerChoiceOpen.value = false;
  }
  if (old && !open && exportKind.value && !settingsSaving.value)
    exportDialog.value?.cancelSettings();
  if (open && exportKind.value)
    nextTick(() => document.querySelector<HTMLInputElement>('[aria-label="班号"]')?.focus());
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
      <span :class="{ 'source-diagnostic': error.startsWith('LPMake.txt:') }">{{ error }}</span
      ><button @click="error = ''">关闭</button>
    </div>
    <div v-if="!ready" class="loading">
      <h2>正在准备工作区</h2>
      <p>加载配置、源码与本地编译器。</p>
    </div>
    <template v-if="ready && draft && config">
      <section
        ref="mainToolbar"
        class="toolbar"
        :class="{ 'is-compact': compactToolbar, 'hide-select-labels': toolbarWidth < 800 }"
      >
        <div class="project-select">
          <label
            ><span class="select-label">实验项目</span
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
              ><span class="select-label">题号</span
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
                :title="nativeState.status === 'paused' ? '继续（F5）' : '暂停'"
                :aria-label="nativeState.status === 'paused' ? '继续调试' : '暂停调试'"
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
                  ['next', '单步跳过', 'F10'],
                  ['stepIn', '单步进入', 'F11'],
                  ['stepOut', '单步跳出', 'Shift+F11'],
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
                title="重启调试"
                aria-label="重启调试"
                :disabled="nativeStarting"
                @click="action(() => startNative(true))"
              >
                <ActionIcon name="restart" /></button
              ><button
                class="icon-action debug-stop"
                title="停止调试"
                aria-label="停止调试"
                :disabled="nativeStarting"
                @click="action(() => api.nativeStop())"
              >
                <ActionIcon name="stop" /></button></template
            ><template v-else
              ><button
                class="primary"
                :disabled="blocked || (!activeTab && !workspaceMode)"
                :title="'编译（' + shortcutLabel('run') + '）'"
                @click="action(compile)"
              >
                <ActionIcon name="build" />编译</button
              ><button
                class="stop"
                title="停止"
                aria-label="停止"
                :disabled="!busy"
                @click="action(stop)"
              >
                <ActionIcon name="stop" /><span class="stop-label">停止</span>
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
              label="新建源码"
              @close-auto-focus="keepTreeEditFocus"
              :items="[
                { label: 'C 源码（.c）', value: 'c' },
                { label: 'C++ 源码（.cpp）', value: 'cpp' },
              ]"
              :disabled="blocked"
              @select="action(() => fileAction(() => newSource($event)))"
            />
            <ActionMenu
              owner="toolbar"
              :theme="config.theme"
              label="导入"
              :items="[
                { label: '导入源码', value: 'source' },
                { label: '导入测试点', value: 'io' },
                { label: '导入实验项目', value: 'project' },
              ]"
              :disabled="blocked"
              @select="action(() => chooseImport($event))"
            />
            <ActionMenu
              owner="toolbar"
              :theme="config.theme"
              label="导出"
              :items="[
                { label: '导出源码', value: 'source' },
                { label: '导出实验项目', value: 'project' },
                { label: '导出当前测试点', value: 'currentTests', separator: true },
                { label: '导出项目测试点', value: 'projectTests' },
              ]"
              :disabled="blocked"
              @select="action(() => chooseExport($event))"
            />
            <button class="settings-button" :disabled="fileBusy" @click="openSettings">
              ⚙ 设置
            </button>
          </div>
          <ActionMenu
            owner="toolbar"
            :theme="config.theme"
            label="保存"
            :items="[
              { label: '保存当前', value: 'current' },
              { label: '保存全部', value: 'all' },
            ]"
            :disabled="fileBusy || (!tabs.length && !rulesDirty)"
            @select="action(() => chooseSave($event))"
          />
          <ActionMenu
            owner="toolbar"
            v-if="compactToolbar"
            :theme="config.theme"
            label="更多"
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
                      <strong>代码在这里等你</strong>
                      <p>新建一份源码，或导入已有文件，继续编写。</p>
                      <div class="empty-editor-actions">
                        <ActionMenu
                          :theme="config.theme"
                          label="新建源码"
                          @close-auto-focus="keepTreeEditFocus"
                          :items="[
                            { label: 'C 源码（.c）', value: 'c' },
                            { label: 'C++ 源码（.cpp）', value: 'cpp' },
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
                          最近源码
                        </button>
                      </div>
                    </div>
                    <div class="editor-status">
                      <span
                        v-if="inactiveSource"
                        class="build-excluded"
                        title="检查 LPMake 的 add_files 与 remove_files"
                        >当前源码未参与构建</span
                      ><span
                        v-else-if="workspaceMode && membershipMessage"
                        class="build-excluded"
                        :title="membershipMessage"
                        >请检查 LPMake</span
                      ><span v-else
                        >{{ draft.language === 'c' ? 'C' : 'C++' }} · 空格：{{
                          config.indentSize
                        }}</span
                      ><span>{{ config.saveMode === 'auto' ? '自动保存' : '手动保存' }}</span>
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
                    title="收起右区"
                    aria-label="收起右区"
                    @click="foldRight(true)"
                  >
                    <ActionIcon name="chevronRight" />
                  </button>
                  <div v-show="showRightTabs" class="right-tabs" role="tablist" aria-label="右区">
                    <button
                      v-show="showBothRightTabs || rightTab === 'tests'"
                      role="tab"
                      :aria-selected="rightTab === 'tests'"
                      :class="{ active: rightTab === 'tests' }"
                      @click="rightTab = 'tests'"
                    >
                      测试点</button
                    ><button
                      v-if="workspaceMode"
                      v-show="showBothRightTabs || rightTab === 'debug'"
                      role="tab"
                      :aria-selected="rightTab === 'debug'"
                      :class="{ active: rightTab === 'debug' }"
                      @click="rightTab = 'debug'"
                    >
                      调试<i v-if="nativeActive" class="live-dot"></i>
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
                      aria-label="选择全部测试点"
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
                      :title="compiledReady ? runHint : '请先保存并编译'"
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
                          title="比较规则与时限保存在此 JSON 中"
                          @click="action(() => api.showProblemFile(snapshot()))"
                        >
                          题目文件</button
                        ><button :disabled="blocked" @click="action(() => fileAction(reload))">
                          重新加载</button
                        ><button :disabled="blocked" @click="addCase">＋ 新增</button></span
                      ><ActionMenu
                        :theme="config.theme"
                        label="更多"
                        :compact="!fullHeader"
                        :items="testHeaderItems"
                        @select="(value) => action(() => testHeaderAction(value))"
                      /></div></template
                  ><template v-else
                    ><div class="debug-header-actions">
                      <button
                        class="run-test-icon primary icon-action"
                        aria-label="开始调试"
                        :title="'开始调试（' + shortcutLabel('debugStart') + '）'"
                        :disabled="blocked || nativeActive"
                        @click="action(() => startNative())"
                      >
                        <ActionIcon name="play" /></button
                      ><button
                        v-show="fullHeader"
                        :disabled="blocked || nativeActive"
                        @click="action(openBuildSettings)"
                      >
                        构建设置…
                      </button>
                      <ActionMenu
                        :theme="config.theme"
                        v-if="debugHeaderItems.length"
                        label="更多调试操作"
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
                    <h3>直接运行，或添加测试点</h3>
                    <p>
                      没有测试点时，编译成功后进入下方终端。<br />需要比较输出时，导入测试点
                      或新增测试点。
                    </p>
                    <button :disabled="blocked" @click="addCase">＋ 新增测试点</button>
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
                          :aria-label="'选择测试点 ' + test.id"
                          :disabled="blocked"
                        /><span class="case-number">{{ index + 1 }}</span
                        >测试点 {{ test.id }}</strong
                      >
                      <div>
                        <button
                          :disabled="blocked || !compiledReady"
                          :aria-label="'运行测试点 ' + test.id"
                          @click="action(() => run([test.id]))"
                        >
                          <ActionIcon name="play" :size="13" /></button
                        ><span class="verdict" :class="results[test.id]?.verdict?.toLowerCase()">{{
                          results[test.id]?.verdict ||
                          (results[test.id]?.status === 'cancelled'
                            ? '已停止'
                            : finished
                              ? '未运行'
                              : busy === 'judge'
                                ? '等待中'
                                : '未运行')
                        }}</span
                        ><ResultHelp v-if="results[test.id]?.verdict" :theme="config.theme" /><span
                          v-if="results[test.id]"
                          class="elapsed"
                          >{{ results[test.id].elapsedMs }} ms</span
                        ><button
                          class="delete"
                          :disabled="blocked"
                          aria-label="删除测试点"
                          @click="draft.problem.testCases.splice(index, 1)"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    <div class="io-pair">
                      <label
                        >标准输入 <span>stdin</span
                        ><textarea
                          v-model="test.input"
                          :disabled="blocked"
                          :aria-label="'标准输入 ' + test.id"
                          placeholder="允许空输入"
                          spellcheck="false"
                        ></textarea></label
                      ><label
                        >预期输出 <span>expected</span
                        ><textarea
                          v-model="test.expectedOutput"
                          :disabled="blocked"
                          :aria-label="'预期输出 ' + test.id"
                          placeholder="填写完整标准输出"
                          spellcheck="false"
                        ></textarea>
                      </label>
                    </div>
                    <div class="actual-heading">
                      <span>实际输出</span
                      ><button
                        v-if="results[test.id]"
                        @click="diffOpen[test.id] = !diffOpen[test.id]"
                      >
                        {{ diffOpen[test.id] ? '查看原文' : '查看 Diff' }}
                      </button>
                    </div>
                    <OutputDiff
                      v-if="diffOpen[test.id] && results[test.id]"
                      :expected="test.expectedOutput"
                      :actual="results[test.id].stdout"
                    />
                    <pre v-else class="actual-output">{{
                      results[test.id] ? results[test.id].stdout || '（空输出）' : '（尚无输出）'
                    }}</pre>
                    <pre v-if="results[test.id]?.message" class="checker-message">{{
                      results[test.id].message
                    }}</pre>
                  </article>
                </div>
              </Pane>
            </Splitpanes>
            <aside v-if="rightCollapsed" class="right-rail" aria-label="已收起的右区">
              <button
                class="icon-action"
                aria-label="展开右区"
                title="展开右区"
                @click="foldRight(false)"
              >
                <ActionIcon name="chevronLeft" /></button
              ><template v-if="rightTab === 'tests'"
                ><button
                  class="run-test-icon primary icon-action"
                  :title="compiledReady ? runHint : '请先保存并编译'"
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
                    ? '调试已暂停'
                    : nativeActive
                      ? '调试运行中'
                      : '调试未运行'
                }}
              </button>
            </aside>
          </div></Pane
        ><Pane :size="config.layout.outputPercent" :min-size="12" :max-size="65">
          <section class="bottom-panel">
            <div class="bottom-heading">
              <div class="bottom-tabs">
                <button :class="{ active: bottomTab === 'output' }" @click="bottomTab = 'output'">
                  输出</button
                ><button :class="{ active: bottomTab === 'debug' }" @click="bottomTab = 'debug'">
                  终端 <i v-if="debugRunning" class="live-dot"></i>
                </button>
              </div>
              <DiagnosticCounts
                :warnings="diagnostics.warnings"
                :errors="diagnostics.errors"
                :revision="diagnosticRevision"
              />
              <div v-show="bottomTab === 'debug'" class="small-actions">
                <button :disabled="blocked || !compiledReady" @click="action(debug)">
                  运行程序</button
                ><button :disabled="!debugRunning" @click="terminal?.eof()">发送 EOF</button
                ><button :disabled="!busy" @click="action(stop)">■ 停止程序</button
                ><button @click="terminal?.clear()">清空显示</button>
              </div>
              <div v-show="bottomTab === 'output'" class="small-actions">
                <ResultHelp v-if="compilationFailed" :theme="config.theme" /><button
                  @click="logs = ''"
                >
                  清空显示
                </button>
              </div>
            </div>
            <pre v-show="bottomTab === 'output'" class="output-log" data-testid="output">{{
              logs || '点击“编译”。有测试点时再选择“运行全部测试点”；没有测试点时自动进入终端。'
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
        <div class="status-hint" role="status" :title="footerHint">
          <Transition name="status-slide" mode="out-in"
            ><span :key="footerHint">{{ footerHint }}</span></Transition
          >
        </div>
        <span class="cursor-position" aria-label="光标位置"
          >行 {{ cursor.line }} · 列 {{ cursor.column
          }}<span v-if="cursor.selectionChars"> · 已选 {{ cursor.selectionChars }}</span></span
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
                <span class="eyebrow">PREFERENCES</span
                ><DialogTitle as-child><h2 id="settings-title">设置</h2></DialogTitle>
              </div>
              <button
                class="close-button"
                aria-label="关闭设置"
                :disabled="settingsSaving"
                @click="settingsOpen = false"
              >
                ×
              </button>
            </div>
            <div v-if="settingsMessage" class="settings-message" role="alert">
              {{ settingsMessage }}
            </div>
            <fieldset class="settings-scroll" :disabled="settingsSaving">
              <section>
                <h3>个人信息</h3>
                <p>填写学号后，导出的文件名会自动加上学号。留空也可以导出。</p>
                <div class="field-grid">
                  <label
                    >班号<input
                      v-model="settings.classId"
                      aria-label="班号"
                      placeholder="例如 9527" /></label
                  ><label
                    >姓名<input
                      v-model="settings.name"
                      aria-label="姓名"
                      placeholder="例如 马冬梅" /></label
                  ><label
                    >学号<input
                      v-model="settings.studentId"
                      aria-label="学号"
                      placeholder="例如 7355608"
                  /></label>
                </div>
              </section>
              <section>
                <h3>编辑与保存</h3>
                <div class="field-grid two">
                  <label
                    >保存方式<select v-model="settings.saveMode" aria-label="保存方式">
                      <option value="manual">手动保存（默认）</option>
                      <option value="auto">自动保存</option>
                    </select></label
                  ><label
                    >源码语言<select v-model="settings.language" aria-label="源码语言">
                      <option value="c">C（.c）</option>
                      <option value="cpp">C++（.cpp）</option>
                    </select></label
                  ><label
                    >Tab / 缩进空格数<select
                      v-model.number="settings.indentSize"
                      aria-label="Tab / 缩进空格数"
                    >
                      <option :value="1">1 个空格</option>
                      <option :value="2">2 个空格</option>
                      <option :value="4">4 个空格（默认）</option>
                    </select></label
                  ><label
                    >主题<select v-model="settings.theme" aria-label="主题">
                      <option value="dark">暗色 · VS Code</option>
                      <option value="light">亮色 · VS Code</option>
                    </select></label
                  >
                </div>
                <label class="checkbox-field"
                  ><input
                    v-model="settings.formatOnSave"
                    type="checkbox"
                    aria-label="保存时自动格式化"
                  />保存时自动格式化（clang-format）</label
                ><label class="checkbox-field"
                  ><input v-model="settings.completionEnabled" type="checkbox" />基础代码补全</label
                >
                <div class="field-grid two">
                  <label
                    >界面缩放<ZoomSelect
                      v-model="settings.zoomFactor"
                      :theme="settings.theme" /></label
                  ><label
                    >快捷键<button
                      aria-label="设置快捷键…"
                      @click="action(() => api.openShortcuts())"
                    >
                      设置快捷键…
                    </button></label
                  >
                </div>
                <p>导入的源码保存在数据目录；保存更新当前副本。</p>
                <TypographySettings
                  v-model="settingsTypography"
                  @valid="typographyValid = $event"
                />
              </section>
              <section>
                <h3>数据位置</h3>
                <PathField
                  v-model="settingsRoot"
                  label="数据保存位置"
                  kind="directory"
                  @valid="pathValidity.data = $event"
                />
                <p>请选择已存在的文件夹。更换位置时复制现有资料，原目录保留。</p>
              </section>
              <section>
                <div class="settings-section-heading">
                  <h3>编译器</h3>
                  <button
                    v-if="settings.compiler.mode === 'custom'"
                    :disabled="compilerScanning || !!busy"
                    @click="action(detectInstalledCompilers)"
                  >
                    {{ compilerScanning ? '正在检测…' : '自动检测' }}
                  </button>
                </div>
                <p>内置 Zig 启动时静默预热，自动使用可用核心；缓存超过 2 GB 时自动回收。</p>
                <div class="field-grid">
                  <label
                    >使用方式<select v-model="settings.compiler.mode" aria-label="编译器使用方式">
                      <option value="builtin">内置 Zig</option>
                      <option value="custom">自定义编译器</option>
                    </select></label
                  ><label v-if="settings.compiler.mode === 'custom'"
                    >编译器类型<select v-model="settings.compiler.kind" aria-label="编译器类型">
                      <option value="zig">Zig</option>
                      <option value="gcc">GCC</option>
                      <option value="clang">Clang</option>
                    </select></label
                  >
                </div>
                <div v-if="settings.compiler.mode === 'custom'" class="compiler-paths">
                  <PathField
                    v-model="settings.compiler.cPath"
                    label="C 编译器路径"
                    kind="executable"
                    @valid="pathValidity.c = $event"
                  /><PathField
                    v-model="settings.compiler.cppPath"
                    label="C++ 编译器路径"
                    kind="executable"
                    :allow-empty="settings.compiler.kind === 'zig' || settings.language === 'c'"
                    @valid="pathValidity.cpp = $event"
                  />
                </div>
                <div class="cache-controls">
                  <button :disabled="!!busy || clearingCache" @click="clearCache">
                    {{ clearingCache ? '正在清理…' : '清理编译缓存' }}</button
                  ><span role="status">{{ cacheMessage }}</span>
                </div>
              </section>
              <section>
                <details
                  class="default-parameters"
                  :open="parameterExpanded"
                  @toggle="parameterExpanded = ($event.target as HTMLDetailsElement).open"
                >
                  <summary>高级编译参数</summary>
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
                <h3>终端</h3>
                <div class="field-grid two">
                  <label
                    >程序时限（毫秒，留空则手动停止）<input
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
                    >终端显示缓冲（行）<input
                      v-model.number="settings.terminalBufferLines"
                      type="number"
                      min="100"
                      max="100000" /></label
                  ><label
                    >输入历史上限（字节）<input
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
                ><button :disabled="settingsSaving" @click="settingsOpen = false">取消</button
                ><button
                  class="primary"
                  :disabled="!!busy || settingsSaving || !validSettingsPaths"
                  @click="saveSettings"
                >
                  {{ settingsSaving ? '保存中…' : '保存设置' }}
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
            <h2 id="compiler-picker-title">自动检测编译器</h2>
            <template v-if="detectedCompilers.length"
              ><p>选择后填写类型和路径，保存设置后生效。</p>
              <label class="checkbox-field"
                ><input
                  v-model="useRecommended"
                  type="checkbox"
                />同时使用推荐参数（更新全局配置）</label
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
                      }}<small v-if="!candidate.compiler.cppPath"> · 仅 C</small></strong
                    ><span>{{ candidate.version }}</span
                    ><code>{{ candidate.compiler.cPath }}</code
                    ><small v-if="candidate.target">{{ candidate.target }}</small></span
                  ></label
                >
              </div></template
            >
            <p v-else class="compiler-not-found">LabPad在常用路径未找到可支持的编译器</p>
            <DialogActions class="compiler-picker-actions"
              ><button @click="compilerChoiceOpen = false">
                {{ detectedCompilers.length ? '取消' : '关闭' }}</button
              ><button
                v-if="detectedCompilers.length"
                class="primary"
                :disabled="!selectedCompiler"
                @click="useDetectedCompiler"
              >
                使用此编译器
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
                {{ newKind === 'lab' ? '新建项目' : '新建题号' }}
              </h2></DialogTitle
            ><label v-if="newKind === 'lab'"
              >项目类型<select v-model="newMode" aria-label="项目类型">
                <option value="problem-set">题集 · 单文件练习</option>
                <option value="project">项目 · 一个程序</option>
              </select></label
            ><label
              >{{ newKind === 'lab' ? '项目名称' : '题号'
              }}<input
                ref="newNameInput"
                v-model="newName"
                :aria-label="newKind === 'lab' ? '项目名称' : '新题号'"
                :placeholder="newKind === 'lab' ? '例如 实验2' : '例如 Lab 2-1'"
                :disabled="newSaving"
                @keydown.enter="createItem"
                autofocus
            /></label>
            <p v-if="newMessage" class="field-error" role="alert">{{ newMessage }}</p>
            <DialogActions class="create-actions"
              ><button :disabled="newSaving" @click="newKind = null">取消</button
              ><button class="primary" :disabled="newSaving || !newName.trim()" @click="createItem">
                新建
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
            <DialogTitle as-child><h2 id="condition-title">条件断点</h2></DialogTitle>
            <p>{{ conditionDialog.path }}:{{ conditionDialog.line }}</p>
            <label
              >条件表达式<input
                v-model="conditionDialog.value"
                aria-label="断点条件"
                placeholder="例如 i == 10"
                maxlength="1024"
                @keydown.enter.prevent="applyCondition"
            /></label>
            <p>条件成立时暂停；留空改为普通断点。</p>
            <DialogActions class="create-actions"
              ><button @click="conditionDialog = undefined">取消</button
              ><button class="primary" @click="applyCondition">应用</button></DialogActions
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
