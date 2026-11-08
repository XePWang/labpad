import {
  t as localize,
  setLanguage as setUILanguage,
  UIError,
  currentLanguage,
  type UILanguage,
} from '../shared/i18n';
import { readEditableFile } from '../core/read-file';
import { managePty } from '../core/pty-session';
import { remapPath, replacedPath } from '../shared/file-changes';
import { isCodeFile, isHeaderFile, isSourceFile, sourceExtensions } from '../shared/file-language';
import { directorySnapshot, hasUnsavedSnapshotFiles } from '../core/workspace-files';
import { createHash } from 'node:crypto';
import { NativeDebugger } from '../core/debug/session';
import { CommandTerminal } from '../core/terminal';
import { cleanBuildDirectory } from '../core/artifacts';
import { draftPlan } from '../core/build/plan';
import { killTree } from '../core/process';
import type { SourceBreakpoint } from '../shared/debug';
import type { Prepared } from '../core/compiler';
import { FileConflict, under, type FileRequest, type FileChange } from '../core/files';
import { nativeButtonOrder, type DesktopPlatform } from '../shared/dialog-actions';
import { previewPlan } from '../core/build/plan';
import { assertParameters } from '../shared/parameters';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  nativeImage,
  nativeTheme,
  clipboard,
} from 'electron';
import { cleanInactiveRuntime } from '../core/runtime';
import { validateShortcuts } from '../shared/shortcuts';
import { Formatter } from '../core/formatter';
import { detectCompilers } from '../core/toolchains';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { mkdirSync, rmSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  rm,
  stat,
  access,
  realpath,
  rename,
} from 'node:fs/promises';
import type { IPty } from 'node-pty';
import { createRequire } from 'node:module';
import { Compiler } from '../core/compiler';
import writeFileAtomic from '../core/atomic-file';
import { parse as parseMake } from '../shared/lpmake';
import { resolve as resolveBuild } from '../core/build/resolve';
import { compileDraft, copyResources, clearWorkspaceCache } from '../core/build';
import {
  parseWorkspacePackage,
  workspacePackage,
  workspacePath,
  effectiveCompiler,
  type ProjectBuildOptions,
} from '../shared/workspace';
import { parseLabPackage, parseTestCases } from '../shared/project-format';
import {
  parseIOPatch,
  parseProjectTests,
  mergeTests,
  exportIO,
  exportProjectTests,
} from '../shared/test-import';
import { readProjectArchive } from '../core/project-archive';
import {
  prepareWorkspaceProject,
  prepareSource,
  prepareProject,
  submissionZip,
  fingerprint,
  compilationFingerprint,
  checkRecord,
  coverage,
  storedCheck,
  exportChoices,
  type Submission,
} from '../core/submission';
import { CompiledProgram } from '../core/compiled-program';
import { judge } from '../core/judge';
import { Storage, readJSON, importPairs, exists, writeSource, decodeText } from '../core/storage';
import {
  filePart,
  selection,
  validateConfig,
  validateDraft,
  validateLayout,
  validateProblem,
} from '../shared/validate';
import type {
  CompilerConfig,
  Config,
  Draft,
  DebugState,
  JudgeEvent,
  Language,
  LoadedDraft,
  PathKind,
  SaveResult,
  WorkspaceEdits,
} from '../shared/types';
app.setName('LabPad');
if (process.platform === 'win32') app.setAppUserModelId('cn.xep.labpad');
const root = path.resolve(__dirname, '../../..'),
  chromeData = path.join(tmpdir(), 'labpad-ui-' + process.pid);
mkdirSync(chromeData, { recursive: true });
app.setPath('userData', chromeData);
app.setPath('sessionData', chromeData);
app.on('quit', () => {
  try {
    rmSync(chromeData, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
  } catch {}
});
const pty = (
  app.isPackaged
    ? require(
        path.join(process.resourcesPath, 'app.asar.unpacked/node_modules/node-pty/lib/index.js'),
      )
    : createRequire(path.join(root, 'pad/package.json'))('node-pty')
) as typeof import('node-pty');
const platform =
  process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
const resourceRoot = app.isPackaged ? process.resourcesPath : path.join(root, '.work');
const toolchain = app.isPackaged
  ? path.join(resourceRoot, 'toolchain')
  : path.join(resourceRoot, 'toolchains', platform + '-' + process.arch);
const checkers = app.isPackaged
  ? path.join(resourceRoot, 'checkers')
  : path.join(resourceRoot, 'checkers', platform + '-' + process.arch);
const iconPath = app.isPackaged
  ? path.join(resourceRoot, 'icon.png')
  : path.join(root, 'pad/assets/icon.png');
function dataLocation() {
  if (process.env.LABPAD_DATA_DIR) return path.resolve(process.env.LABPAD_DATA_DIR);
  if (!app.isPackaged) return path.join(root, '.work', 'dev-run', 'labpad');
  const base =
    process.platform === 'darwin'
      ? path.resolve(path.dirname(process.execPath), '../../..')
      : path.dirname(
          process.env.APPIMAGE || process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
        );
  return path.join(base, 'labpad');
}
const defaultRoot = dataLocation(),
  locationFile = path.join(defaultRoot, 'location.json');
let storage = new Storage(defaultRoot);
const formatterRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked/package.json')
  : path.join(root, 'pad/package.json');
const formatter = new Formatter(
  app.isPackaged
    ? path.join(process.resourcesPath, 'formatter-worker.cjs')
    : path.join(__dirname, 'formatter-worker.cjs'),
  createRequire(formatterRoot).resolve('@wasm-fmt/clang-format/node'),
);
const compiler = new Compiler({
  toolchain,
  checkers,
  cacheDirectory: process.env.LABPAD_CACHE_DIR,
  processHost: process.platform === 'win32' ? path.join(checkers, 'process-host.exe') : undefined,
});
const compiledProgram = new CompiledProgram(compiler);
let shortcutWindow: BrowserWindow | undefined,
  openBuffers: Draft[] = [];
let pendingEdits: WorkspaceEdits | undefined;
let warmController: AbortController | undefined,
  warmTask: Promise<unknown> | undefined,
  warmTimer: ReturnType<typeof setTimeout> | undefined;
let debugSession = 0,
  acknowledge: ((id: number, size: number) => void) | undefined;
let win: BrowserWindow,
  config: Config,
  currentDocument: Draft | undefined,
  documentDirty = false;
let activeStop: (() => Promise<void>) | undefined;
let nativeCleanup: (() => Promise<void>) | undefined;
let controller: AbortController | undefined,
  active: Promise<unknown> | undefined,
  terminal: IPty | undefined;
let fileSequence = 0;
let closing = false,
  initialized = false,
  saves: Promise<unknown> = Promise.resolve();
const send = (channel: string, value: unknown) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, value);
};
const debugState = (state: DebugState) => send('debug:state', state),
  judgeEvent = (event: JudgeEvent) => send('judge:event', event);
function requireIdle() {
  if (active) throw new UIError('Stop the running task first');
}
async function reserveExecution<T>(run: (abort: AbortController) => Promise<T>): Promise<T> {
  requireIdle();
  const abort = new AbortController();
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => (release = resolve));
  active = barrier;
  controller = abort;
  try {
    return await run(abort);
  } finally {
    if (active === barrier) {
      active = undefined;
      controller = undefined;
    }
    release();
  }
}
async function stop() {
  controller?.abort();
  if (nativeCleanup) {
    await nativeSession?.stop();
    await nativeCleanup?.();
  } else {
    await activeStop?.();
    if (nativeSession && nativeActive()) await nativeSession.stop();
  }
  await active;
}

async function stopWarmup() {
  clearTimeout(warmTimer);
  warmController?.abort();
  await warmTask?.catch(() => {});
  warmTask = undefined;
  warmController = undefined;
}
function scheduleWarmup() {
  clearTimeout(warmTimer);
  if (process.env.LABPAD_SKIP_WARMUP || config.compiler.mode !== 'builtin') return;
  warmTimer = setTimeout(() => {
    const abort = new AbortController();
    warmController = abort;
    warmTask = (async () => {
      for (const language of ['c', 'cpp'] as Language[]) {
        if (abort.signal.aborted) return;
        const prepared = await compiler.compile(
          language === 'c'
            ? '#include <stdio.h>\nint main(void){puts("labpad");return 0;}'
            : '#include <iostream>\nint main(){std::cout << "labpad";}',
          language,
          config.compiler,
          abort.signal,
        );
        await prepared.cleanup();
      }
    })().catch(() => {});
  }, 800);
}
function handle(channel: string, fn: (...args: any[]) => any) {
  ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== win.webContents) throw new UIError('Invalid window');
    return Promise.resolve()
      .then(() => fn(...args))
      .catch((error) => {
        if (error instanceof UIError && error.message === error.originalMessage)
          return {
            $labpadError: {
              name: error.name,
              message: error.message,
              localization: error.localization,
            },
          };
        throw error;
      });
  });
}
async function validatePath(value: string, kind: PathKind, allowEmpty = false) {
  if (!value.trim())
    return { valid: allowEmpty, message: allowEmpty ? '' : localize('Enter a path') };
  if (!path.isAbsolute(value.trim()))
    return { valid: false, message: localize('Enter an absolute path') };
  try {
    const info = await stat(value.trim());
    if (kind === 'directory' ? !info.isDirectory() : !info.isFile())
      return {
        valid: false,
        message:
          kind === 'directory'
            ? localize('Choose a folder')
            : localize('Choose a compiler executable'),
      };
    await access(value.trim(), kind === 'directory' ? constants.W_OK : constants.X_OK);
    return { valid: true, message: '' };
  } catch (e: any) {
    return {
      valid: false,
      message:
        e.code === 'ENOENT'
          ? localize('Path not found. Choose or enter another path.')
          : e.code === 'EACCES'
            ? localize('You do not have permission to access this path')
            : localize('Cannot access the path: {0}', e.message),
    };
  }
}
async function requirePath(value: string, kind: PathKind) {
  const result = await validatePath(value, kind);
  if (!result.valid) throw new Error(result.message);
}
async function inputIdentity(d: Draft, options: CompilerConfig) {
  return compiler.identityFor(d, options);
}
async function draftOptions(d: Draft) {
  const base = d.workspace
    ? structuredClone(config.compiler)
    : effectiveCompiler(
        config.compiler,
        d.problem.labId ? await storage.buildOptions(d.problem.labId) : undefined,
      );
  return compiler.forDraft(d, base);
}
async function targetInput(value: Draft) {
  return storage.buildTarget(value, openBuffers);
}
async function buildInput(value: Draft) {
  const d = await targetInput(value);
  delete d.sourceFiles;
  if (await storage.workspace.isProject(d.problem.labId))
    d.workspace = await storage.workspace.snapshot(d.problem.labId, [...openBuffers, d]);
  else {
    delete d.workspace;
    const data = await storage.sourceSnapshot(d, openBuffers);
    d.sourceFiles = data.snapshot;
    d.file = data.file;
  }
  return d;
}
// Enumerated versions own their identity; they must not inherit the editor's locked target.
async function buildDocumentInput(value: Draft) {
  if (
    !value.auxiliary &&
    value.documentId &&
    !(await storage.workspace.isProject(value.problem.labId))
  )
    value = {
      ...value,
      target: {
        mode: 'problem-set',
        labId: value.problem.labId,
        problemId: value.problem.problemId,
        documentId: value.documentId,
      },
    };
  return buildInput(value);
}
async function savedBuildInput(value: Draft) {
  await saves;
  const d = await targetInput(value);
  let saved = true;
  delete d.sourceFiles;
  if (await storage.workspace.isProject(d.problem.labId)) {
    d.workspace = await storage.workspace.snapshot(d.problem.labId, []);
    if (
      hasUnsavedSnapshotFiles(
        d.workspace,
        openBuffers.filter((buffer) => buffer.problem.labId === d.problem.labId),
      )
    )
      saved = false;
    if (d.file) d.source = d.workspace.files[d.file] ?? '';
  } else {
    const state = await storage.projectState(d.problem.labId, d.problem.problemId, d.language),
      version = state.documents?.find((v) => v.id === d.documentId);
    const file = version
      ? storage.documentPath(d.problem.labId, d.problem.problemId, version)
      : storage.paths(d.problem.labId, d.problem.problemId, d.language).source;
    if (!(await exists(file))) saved = false;
    else {
      const text = decodeText(await readEditableFile(file)).text;
      saved = text === d.source;
      d.source = text;
    }
    const data = await storage.sourceSnapshot(d);
    d.sourceFiles = data.snapshot;
    d.file = data.file;
    for (const buffer of openBuffers)
      if (buffer.problem.labId === d.problem.labId) {
        if (buffer.documentId === d.documentId && buffer.source !== d.source) saved = false;
        if (buffer.auxiliary && hasUnsavedSnapshotFiles(data.snapshot, [buffer])) saved = false;
      }
  }
  return { draft: d, saved };
}
async function programContext(
  value: Draft,
  savedInput?: Awaited<ReturnType<typeof savedBuildInput>>,
) {
  const input = savedInput ?? (await savedBuildInput(value)),
    options = await draftOptions(input.draft);
  return {
    ...input,
    options,
    key: compilationFingerprint(input.draft, options, await inputIdentity(input.draft, options)),
  };
}
async function workspaceBootstrap() {
  const lab = config.currentLab,
    state = await storage.workspace.read(lab),
    documents = await storage.workspace.documents(lab);
  let draft =
    documents.find((d) => d.file === currentDocument?.file) ??
    documents.find((d) => d.file === state.activeFile) ??
    documents[0];
  if (!draft) {
    const source = await storage.workspace.open(lab, 'LPMake.txt');
    documents.push(source);
    draft = source;
  }
  if (currentDocument?.file && currentDocument.problem.labId === lab) {
    const current = currentDocument;
    try {
      const fresh = await storage.workspace.open(lab, current.file!);
      draft = {
        ...fresh,
        source: current.source,
        problem: current.problem,
        target: current.target,
      };
      const index = documents.findIndex((d) => d.file === current.file);
      if (index >= 0) documents[index] = draft;
      else documents.push(draft);
    } catch (error) {
      // A committed deletion can precede the renderer's next state notification.
      // Fall back to the surviving stored document, never revive the deleted buffer.
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      documentDirty = false;
    }
  } else documentDirty = false;
  currentDocument = draft;
  return {
    ...(await settingsResult()),
    draft,
    documents,
    sourcePath: draft.sourceFile ?? null,
    version: app.getVersion(),
    ...(state.inheritDefaults !== undefined
      ? {
          warning: localize(
            'Legacy build settings have not been migrated. Fix the errors in LPMake.txt and save it first.',
          ),
        }
      : {}),
    workspace: {
      scope: storage.workspace.root(lab),
      files: await storage.workspace.list(lab),
      expanded: state.expanded ?? [],
      sidebarWidth: state.sidebarWidth ?? 190,
      sidebarCollapsed: state.sidebarCollapsed ?? false,
      rightCollapsed: state.rightCollapsed ?? false,
    },
  };
}
async function persist(value: Draft): Promise<SaveResult> {
  const snapshot = structuredClone(validateDraft(value)),
    original = JSON.stringify(snapshot),
    options = structuredClone(config);
  const task = saves
    .catch(() => {})
    .then(async () => {
      if (snapshot.file && (await storage.workspace.isProject(snapshot.problem.labId))) {
        let formatWarning: string | undefined;
        if (options.formatOnSave && isCodeFile(snapshot.file))
          try {
            snapshot.source = await formatter.format(
              snapshot.source,
              snapshot.language,
              options.indentSize,
            );
          } catch (e) {
            formatWarning = localize(
              'Formatting failed. The original text was saved: {0}',
              String(e),
            );
          }
        snapshot.source = await storage.workspace.save(snapshot, { rules: false });
        if (
          currentDocument?.documentId === snapshot.documentId &&
          JSON.stringify(currentDocument) === original
        ) {
          currentDocument = structuredClone(snapshot);
          documentDirty = false;
        }
        return {
          path: await storage.workspace.path(snapshot.problem.labId, snapshot.file),
          source: snapshot.source,
          formatWarning,
        };
      }
      if (snapshot.auxiliary && snapshot.file) {
        const service = await storage.fileService(
            snapshot.problem.labId,
            snapshot.problem.problemId,
          ),
          target = await service.resolve(snapshot.file);
        const encoding = (snapshot as LoadedDraft).sourceEncoding ?? 'UTF-8';
        let source = snapshot.source;
        if (options.formatOnSave && isCodeFile(snapshot.file))
          source = await formatter.format(source, snapshot.language, options.indentSize);
        if (
          path.resolve(target) ===
          path.resolve(
            storage.paths(snapshot.problem.labId, snapshot.problem.problemId, snapshot.language)
              .problem,
          )
        ) {
          const problem = await storage.saveRuleFile(snapshot.problem, source);
          if (
            currentDocument?.problem.labId === problem.labId &&
            currentDocument.problem.problemId === problem.problemId
          )
            currentDocument.problem = structuredClone(problem);
          return { path: target, source, problem };
        }
        await writeSource(target, source, encoding);
        return { path: target, source };
      }
      let formatWarning: string | undefined;
      if (options.formatOnSave) {
        try {
          snapshot.source = await formatter.format(
            snapshot.source,
            snapshot.language,
            options.indentSize,
          );
        } catch (e) {
          formatWarning = localize(
            'Formatting failed. The original text was saved: {0}',
            e instanceof Error ? e.message : String(e),
          );
        }
      }
      await storage.save(snapshot, { rules: false });
      config = {
        ...config,
        currentLab: snapshot.problem.labId,
        currentProblem: snapshot.problem.problemId,
        language: snapshot.language,
      };
      await storage.saveConfig(config);
      if (
        currentDocument &&
        (JSON.stringify(currentDocument) === original ||
          JSON.stringify(currentDocument) === JSON.stringify(snapshot))
      ) {
        currentDocument = structuredClone(snapshot);
        documentDirty = false;
      }
      const state = await storage.projectState(
          snapshot.problem.labId,
          snapshot.problem.problemId,
          snapshot.language,
        ),
        version = state.documents?.find((v) => v.id === snapshot.documentId);
      return {
        path: version
          ? storage.documentPath(snapshot.problem.labId, snapshot.problem.problemId, version)
          : storage.paths(snapshot.problem.labId, snapshot.problem.problemId, snapshot.language)
              .source,
        source: snapshot.source,
        formatWarning,
      };
    });
  saves = task.catch(() => {});
  return task;
}
async function selectDraft(lab: string, problem: string, language: Language, preferStored = true) {
  requireIdle();
  selection(lab, problem);
  if (!['c', 'cpp'].includes(language)) throw new UIError('Invalid language');
  await saves;
  await storage.flush();
  if (await storage.workspace.isProject(lab)) {
    config = { ...config, currentLab: lab, currentProblem: '', sourceFile: null };
    await storage.saveConfig(config);
    currentDocument = undefined;
    openBuffers = [];
    return (await workspaceBootstrap()).draft;
  }
  const initial = await storage.load(lab, problem, language, preferStored);
  let documents = await storage.openDocuments(lab, problem, language),
    draft =
      documents.find((d) => d.documentId === initial.documentId) ??
      documents.find((d) => preferStored || d.language === language);
  if (!draft) draft = await storage.newVersion(initial);
  config = {
    ...config,
    currentLab: lab,
    currentProblem: problem,
    language: draft.language,
    sourceFile: null,
  };
  await storage.saveConfig(config);
  currentDocument = draft;
  openBuffers = [draft];
  documentDirty = false;
  return draft;
}
async function settingsResult() {
  return {
    config,
    dataRoot: storage.root,
    projects: await storage.projects(),
    compilerLabel: await compiler
      .info(config.compiler)
      .catch((e: Error) => localize('Compiler is not ready: {0}', e.message)),
  };
}
async function bootstrap() {
  if (await storage.workspace.isProject(config.currentLab)) return workspaceBootstrap();
  if (!currentDocument) {
    if (
      config.sourceFile &&
      !config.currentLab &&
      !(await storage.projectState('', '', config.language)).documents?.length &&
      (await exists(config.sourceFile))
    )
      await storage.importSource('', '', config.sourceFile);
    const initial = await storage.load(
        config.currentLab,
        config.currentProblem,
        config.language,
        true,
      ),
      documents = await storage.openDocuments(
        config.currentLab,
        config.currentProblem,
        config.language,
      );
    currentDocument = documents.find((d) => d.documentId === initial.documentId) ?? documents[0];
    documentDirty = false;
    if (config.sourceFile) {
      config = { ...config, sourceFile: null };
      await storage.saveConfig(config);
    }
  }
  const documents = await storage.openDocuments(
    currentDocument!.problem.labId,
    currentDocument!.problem.problemId,
    currentDocument!.language,
  );
  const current =
    documents.find((d) => d.documentId === currentDocument!.documentId) ??
    (currentDocument as LoadedDraft);
  currentDocument = { ...current, ...currentDocument };
  return {
    ...(await settingsResult()),
    draft: structuredClone(currentDocument),
    documents,
    sourcePath: current.sourceFile ?? null,
    version: app.getVersion(),
    workspace: {
      scope: (await storage.fileService(config.currentLab, config.currentProblem)).root,
      files: await (await storage.fileService(config.currentLab, config.currentProblem)).list(),
      ...(await storage.fileView(config.currentLab)),
    },
  };
}
function submissionServices() {
  const options = structuredClone(config.compiler);
  return {
    resolve: async (value: Draft) => {
      const draft = await buildDocumentInput(value),
        effective = await draftOptions(draft);
      return { draft, compiler: effective, identity: await inputIdentity(draft, effective) };
    },
    identity: (language: Language) => compiler.identity(options, language),
    format: (source: string, language: Language) => formatter.format(source, language, 4),
  };
}
async function messageBox(options: Electron.MessageBoxOptions) {
  const order = nativeButtonOrder(
    options.buttons?.length ?? 1,
    options.cancelId ?? 0,
    process.platform as DesktopPlatform,
  );
  const result = await dialog.showMessageBox(win, {
    ...options,
    buttons: order.map((i) => options.buttons?.[i] ?? localize('OK')),
    defaultId: order.indexOf(options.defaultId ?? 0),
    cancelId: order.indexOf(options.cancelId ?? 0),
  });
  return { ...result, response: order[result.response] };
}
async function confirmUnsaved() {
  const result = await messageBox({
    type: 'question',
    title: localize('Save Changes'),
    message: localize('Source files, build settings, or test cases have unsaved changes.'),
    buttons: [localize('Save'), localize('Don’t Save'), localize('Cancel')],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  return (['save', 'discard', 'cancel'] as const)[result.response];
}
async function startDebug(value: Draft, abort: AbortController) {
  const context = await programContext(value);
  if (!context.saved) throw new UIError('Save the files included in the build before compiling.');
  const program = compiledProgram.require(context.key),
    settings = structuredClone(config);
  const task = (async () => {
    let directory: string | undefined, io: Awaited<ReturnType<typeof terminalProcess>> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const kill = () => {
      void io
        ?.stop()
        .catch((error) => debugState({ status: 'stop-failed', message: String(error) }));
    };
    try {
      directory = await mkdtemp(path.join(program.directory, 'debug-'));
      await copyResources(program.resources, directory, program.binaryResources);
      abort.signal.throwIfAborted();
      io = await terminalProcess(
        [program.executable],
        directory,
        await compiler.environment(context.options),
        undefined,
        false,
        false,
      );
      activeStop = io.stop;
      abort.signal.addEventListener('abort', kill, { once: true });
      if (settings.debugTimeLimitMs)
        timer = setTimeout(() => abort.abort(), settings.debugTimeLimitMs);
      if (abort.signal.aborted) kill();
      const result = await io.finished;
      return {
        status: abort.signal.aborted ? 'stopped' : 'exited',
        message: abort.signal.aborted
          ? localize('Program Stopped')
          : localize('Exit code {0}', result.exitCode),
      } as DebugState;
    } catch (error) {
      return {
        status: abort.signal.aborted ? 'stopped' : 'error',
        message: abort.signal.aborted ? localize('Program Stopped') : String(error),
      } as DebugState;
    } finally {
      if (timer) clearTimeout(timer);
      abort.signal.removeEventListener('abort', kill);
      if (activeStop === io?.stop) activeStop = undefined;
      if (directory)
        try {
          await rm(directory, { recursive: true, force: true });
        } catch (error) {
          send(
            'native:diagnostic',
            'Temporary run files could not be removed: ' + String(error) + '\n',
          );
        }
    }
  })();
  active = task;
  void task.then(
    (outcome) => {
      if (active === task) {
        active = undefined;
        controller = undefined;
        debugState(outcome);
      }
    },
    (error) => {
      if (active === task) {
        active = undefined;
        controller = undefined;
      }
      debugState({ status: 'error', message: String(error) });
    },
  );
}

let nativeSession: NativeDebugger | undefined,
  nativePrepared: Prepared | undefined,
  nativeLab = '',
  nativeScope = '',
  nativeSnapshot: Record<string, string> = {};
let terminalShell: CommandTerminal | undefined,
  terminalShellKey = '',
  terminalTargets = new Map<string, { key: string; program: Prepared; checksum: string }>();
const debuggerRoot = app.isPackaged
  ? path.join(resourceRoot, 'debugger')
  : path.join(resourceRoot, 'debuggers', platform + '-' + process.arch);
const nativeActive = () =>
  !!nativeSession && !['ended', 'error', 'idle'].includes(nativeSession.state.status);
function nativeView() {
  const state = nativeSession?.state ?? {
    status: 'idle',
    frames: [],
    scopes: [],
    variables: [],
    breakpoints: [],
    conditionalBreakpoints: true,
  };
  const base = nativeScope || storage.workspace.root(nativeLab || config.currentLab);
  const relative = (file: string | undefined) => {
    if (!file) return file;
    for (const root of [base, nativePrepared?.snapshotRoot])
      if (root) {
        const rel = path.relative(root, file);
        if (rel && !rel.startsWith('..') && !path.isAbsolute(rel))
          return rel.split(path.sep).join('/');
      }
    return file;
  };
  return {
    ...state,
    scope: base,
    frames: state.frames.map((f) => ({ ...f, path: relative(f.path) })),
    breakpoints: state.breakpoints.map((b) => ({ ...b, path: relative(b.path)! })),
  };
}
async function nativeFileGuard(lab: string, files: string[]) {
  if (!nativeActive() || nativeLab !== lab) return;
  if (files.some((file) => Object.keys(nativeSnapshot).some((source) => under(source, file))))
    throw new UIError(
      'This file is in the current debug session. Stop debugging before moving, renaming, deleting, or replacing it.',
    );
}
function emitFileChanges(
  lab: string,
  changes: FileChange[],
  files: import('../shared/workspace').WorkspaceFile[],
  scope: string,
  warnings: string[] = [],
) {
  const event = { id: ++fileSequence, lab, changes, files, warnings, scope };
  send('files:changed', event);
  return event;
}
async function terminalProcess(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  onExit?: () => void,
  reportExit = true,
  publishExit = true,
) {
  if (terminal) throw new UIError('A program is already running in the terminal.');
  const session = ++debugSession;
  const executable = process.platform === 'win32' ? compiler.paths.processHost! : '/bin/sh';
  const command =
    process.platform === 'win32'
      ? ['--terminal-no-echo', ...args]
      : ['-c', 'stty -echo || exit 125; exec "$@"', 'labpad-terminal', ...args];
  const child = pty.spawn(executable, command, {
    name: 'xterm-256color',
    cols: 100,
    rows: 18,
    cwd,
    env: Object.fromEntries(
      Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
  });
  terminal = child;
  const processSession = managePty(child, {
    data: (data) => send('debug:data', { session, data }),
    terminate: async () => {
      try {
        await killTree(child.pid);
      } finally {
        try {
          child.kill();
        } catch {}
      }
    },
  });
  acknowledge = (id, size) => {
    if (id === session) processSession.acknowledge(size);
  };
  const finished = processSession.finished.then((result) => {
    if (terminal === child) {
      terminal = undefined;
      acknowledge = undefined;
    }
    if (publishExit)
      debugState({
        status: 'exited',
        ...(reportExit ? { message: localize('Exit code {0}', result.exitCode) } : {}),
      });
    onExit?.();
    return result;
  });
  debugState({ status: 'running' });
  return { pid: child.pid, finished, stop: processSession.stop };
}

async function beginNative(value: Draft, breakpoints: SourceBreakpoint[], abort: AbortController) {
  await stopWarmup();
  const context = await programContext(value);
  if (!context.draft.workspace)
    throw new UIError('Breakpoint debugging is available for projects only.');
  if (!context.saved) throw new UIError('Save the source files and build configuration first.');
  const plan = draftPlan(context.draft, context.options),
    optimized = plan.units.some((u) => u.args.some((a) => /^-(O[123s]|Ofast|g0)$/.test(a)));
  if (optimized || plan.units.some((u) => !u.args.some((a) => /^(-g|-[g]gdb\d*)$/.test(a)))) {
    const answer = await messageBox({
      type: 'warning',
      title: localize('Check Debug Configuration'),
      message: localize('The current arguments may affect breakpoints and variable inspection.'),
      detail: localize('Use Debug mode in Project Build Settings and keep -g and -O0.'),
      buttons: [
        localize('Continue Debugging'),
        localize('Open Build Settings'),
        localize('Cancel'),
      ],
      defaultId: 1,
      cancelId: 2,
      noLink: true,
    });
    if (answer.response !== 0) return { needsBuild: answer.response === 1, started: false };
  }
  const task = (async () => {
    let prepared: Prepared | undefined,
      session: NativeDebugger | undefined,
      io: Awaited<ReturnType<typeof terminalProcess>> | undefined;
    let handedOff = false;
    try {
      prepared = await compileDraft(compiler, context.draft, context.options, abort.signal);
      judgeEvent({ type: 'compilation', compilation: prepared.compilation });
      if (prepared.compilation.status !== 'success' || abort.signal.aborted)
        return { started: false, compilation: prepared.compilation };
      nativePrepared = prepared;
      nativeLab = context.draft.problem.labId;
      nativeScope = storage.workspace.root(nativeLab);
      nativeSnapshot = { ...context.draft.workspace!.files };
      const runDirectory = await mkdtemp(path.join(prepared.directory, 'native-'));
      await copyResources(prepared.resources, runDirectory, prepared.binaryResources);
      session = nativeSession = new NativeDebugger();
      session.on('state', () => {
        if (!['ended', 'error'].includes(session!.state.status)) send('native:state', nativeView());
      });
      session.on('output', (data) => send('debug:data', { session: debugSession, data }));
      session.on('diagnostic', (data) => send('native:diagnostic', data));
      const root = storage.workspace.root(nativeLab),
        env = await compiler.environment(context.options);
      abort.signal.throwIfAborted();
      const stopSession = () => {
        void session!.stop().catch((error) => send('native:diagnostic', String(error) + '\n'));
      };
      abort.signal.addEventListener('abort', stopSession, { once: true });
      let settled = false,
        cleaning: Promise<void> | undefined;
      let complete!: () => void;
      const finish = new Promise<void>((resolve) => (complete = resolve));
      const cleanup = async () => {
        if (settled) return;
        if (cleaning) return cleaning;
        const task = (async () => {
          try {
            await io?.stop();
            await session?.dispose();
          } catch (error) {
            session?.stopFailed(error);
            send('native:state', nativeView());
            throw error;
          }
          try {
            await prepared?.cleanup();
          } catch (error) {
            send(
              'native:diagnostic',
              'Temporary debug files could not be removed: ' + String(error) + '\n',
            );
          } finally {
            settled = true;
            abort.signal.removeEventListener('abort', stopSession);
            nativePrepared = undefined;
            if (nativeCleanup === cleanup) nativeCleanup = undefined;
            if (active === finish) {
              active = undefined;
              controller = undefined;
            }
            debugState({ status: 'exited' });
            send('native:state', nativeView());
            complete();
          }
        })();
        cleaning = task;
        try {
          await task;
        } finally {
          if (cleaning === task) cleaning = undefined;
        }
      };
      handedOff = true;
      nativeCleanup = cleanup;
      active = finish;
      void session.finished.then(() =>
        cleanup().catch((error) => send('native:diagnostic', String(error) + '\n')),
      );
      await session.start({
        adapter: path.join(
          debuggerRoot,
          'adapter',
          process.platform === 'win32' ? 'codelldb.exe' : 'codelldb',
        ),
        program: prepared.executable,
        cwd: runDirectory,
        env,
        sourceMap: prepared.snapshotRoot ? { [prepared.snapshotRoot]: root } : undefined,
        breakpoints: breakpoints.map((b) => ({
          ...b,
          path: path.join(root, workspacePath(b.path)),
        })),
        runInTerminal: async (options) => {
          io = await terminalProcess(
            options.args,
            options.cwd,
            {
              ...env,
              ...(Object.fromEntries(
                Object.entries(options.env ?? {}).filter(([, v]) => v !== null),
              ) as Record<string, string>),
            },
            undefined,
            false,
          );
          return { processId: io.pid, shellProcessId: io.pid };
        },
      });
      return { started: true, compilation: prepared.compilation, sources: nativeSnapshot };
    } catch (error) {
      if (session) {
        try {
          await session.stop();
          await nativeCleanup?.();
        } catch (cleanup) {
          send('native:diagnostic', String(cleanup) + '\n');
        }
      }
      throw error;
    } finally {
      if (!handedOff && prepared) {
        try {
          await prepared.cleanup();
        } catch (cleanup) {
          send('native:diagnostic', String(cleanup) + '\n');
        }
        if (nativePrepared === prepared) nativePrepared = undefined;
      }
    }
  })();
  active = task;
  try {
    return await task;
  } finally {
    if (active === task) {
      active = undefined;
      controller = undefined;
    }
  }
}
async function shellFor(value: Draft) {
  const draft = validateDraft(value),
    store = storage;
  const files = await store.fileService(draft.problem.labId, draft.problem.problemId);
  const key = JSON.stringify([files.root, await store.workspace.isProject(draft.problem.labId)]);
  if (store !== storage) throw new UIError('The data folder changed. Try again.');
  if (!terminalShell || terminalShellKey !== key) {
    requireIdle();
    for (const target of terminalTargets.values()) {
      try {
        await target.program.cleanup();
      } catch (error) {
        send('native:diagnostic', 'Terminal cleanup: ' + String(error));
      }
    }
    terminalTargets.clear();
    terminalShellKey = key;
    terminalShell = new CommandTerminal(
      files,
      (request) => performFiles(draft.problem.labId, draft.problem.problemId, request),
      makeCommand,
    );
  }
  return terminalShell;
}
async function makeCommand(action: 'help' | 'build' | 'run' | 'clean', cwd: string) {
  if (action === 'help') return 'lpmake build / run / clean（b / r / c）';
  return reserveExecution((abort) => runMakeCommand(action, cwd, abort));
}
async function runMakeCommand(
  action: 'build' | 'run' | 'clean',
  cwd: string,
  abort: AbortController,
) {
  await stopWarmup();
  const shell = terminalShell!,
    directory = await shell.files.resolve(cwd),
    snapshot = await directorySnapshot(directory),
    draft: Draft = {
      source: '',
      language: 'c',
      file: 'LPMake.txt',
      workspace: snapshot,
      problem: currentDocument!.problem,
    };
  const options = await compiler.forDraft(draft, config.compiler),
    identity = await compiler.identityFor(draft, options),
    key = createHash('sha256')
      .update(JSON.stringify([snapshot, identity, draftPlan(draft, options)]))
      .digest('hex'),
    owner = 'lpmake:' + cwd,
    target = path.join(directory, 'build');
  const previous = terminalTargets.get(directory);
  if (action === 'clean') {
    await previous?.program.cleanup();
    terminalTargets.delete(directory);
    await cleanBuildDirectory(target, owner);
    return localize('Build outputs for this configuration were removed.');
  }
  if (action === 'build') {
    terminalTargets.delete(directory);
    await previous?.program.cleanup();
    const task = compileDraft(compiler, draft, options, abort.signal, {
      directory: target,
      owner,
      cwd: directory,
    });
    active = task;
    try {
      const prepared = await task;
      judgeEvent({ type: 'compilation', compilation: prepared.compilation });
      if (prepared.compilation.status !== 'success') {
        await prepared.cleanup();
        return prepared.compilation.status === 'cancelled'
          ? localize('Build Stopped.')
          : localize('Build failed. See Output.');
      }
      const checksum = createHash('sha256')
        .update(await readFile(prepared.executable))
        .digest('hex');
      terminalTargets.set(directory, { key, program: prepared, checksum });
      return localize(
        'Build complete: ./{0}',
        path.posix.join(cwd, 'build', path.basename(prepared.executable)),
      );
    } finally {
      if (active === task) {
        active = undefined;
        controller = undefined;
      }
    }
  }
  if (
    !previous ||
    previous.key !== key ||
    !(await exists(previous.program.executable)) ||
    createHash('sha256')
      .update(await readFile(previous.program.executable))
      .digest('hex') !== previous.checksum
  )
    throw new UIError(
      'This configuration has not been built, or its files changed. Run lpmake build first.',
    );
  abort.signal.throwIfAborted();
  const io = await terminalProcess(
      [previous.program.executable],
      directory,
      await compiler.environment(options),
    ),
    kill = () => {
      void io
        .stop()
        .catch((error) => debugState({ status: 'stop-failed', message: String(error) }));
    };
  activeStop = io.stop;
  abort.signal.addEventListener('abort', kill, { once: true });
  const task = io.finished.finally(() => {
    abort.signal.removeEventListener('abort', kill);
    if (activeStop === io.stop) activeStop = undefined;
    if (active === task) {
      active = undefined;
      controller = undefined;
    }
  });
  active = task;
  return '';
}

async function performFiles(lab: string, problem: string, request: FileRequest) {
  if (!nativeActive()) requireIdle();
  await saves;
  const store = storage;
  selection(lab, problem);
  const service = await store.fileService(lab, problem);
  if (request.action === 'delete') {
    const result = await messageBox({
      type: 'warning',
      title: localize('Delete Files'),
      message: localize('Delete the {0} selected items?', request.paths.length),
      detail: localize(
        'Includes files inside the selected folders and unsaved changes. This cannot be undone.',
      ),
      buttons: [localize('Delete'), localize('Cancel')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (result.response !== 0)
      return {
        id: ++fileSequence,
        lab,
        scope: service.root,
        changes: [],
        files: await service.list(),
      };
  }
  let result;
  try {
    result = await store.operateFiles(lab, problem, request, (files) =>
      nativeFileGuard(
        lab,
        request.action === 'copy' ? files.filter((p) => !request.paths.includes(p)) : files,
      ),
    );
  } catch (error) {
    if (!(error instanceof FileConflict)) throw error;
    if (['newFile', 'newFolder', 'rename'].includes(request.action))
      throw new UIError(
        'That name already exists. Choose a different name: {0}',
        error.files.join('、'),
      );
    const answer = await messageBox({
      type: 'warning',
      title: localize('Filename Conflict'),
      message: localize('Files with the same names already exist at the destination.'),
      detail: localize(
        '{0}\nReplacing will overwrite the destination files and their unsaved changes.',
        error.files.join('\n'),
      ),
      buttons: [localize('Replace'), localize('Keep Both'), localize('Skip'), localize('Cancel')],
      defaultId: 3,
      cancelId: 3,
      noLink: true,
    });
    if (answer.response === 3)
      return {
        id: ++fileSequence,
        lab,
        scope: service.root,
        changes: [],
        files: await service.list(),
      };
    result = await store.operateFiles(
      lab,
      problem,
      { ...request, conflict: (['replace', 'keepBoth', 'skip'] as const)[answer.response] },
      (files) =>
        nativeFileGuard(
          lab,
          request.action === 'copy' ? files.filter((p) => !request.paths.includes(p)) : files,
        ),
    );
  }
  if (terminalShell?.files.root === service.root) await terminalShell.reconcile(result.changes);
  const translate = (d: Draft) => {
    if (d.problem.labId !== lab || !d.file) return d;
    const file = remapPath(d.file, result.changes);
    if (!file || replacedPath(d.file, result.changes)) return;
    return { ...d, file };
  };
  openBuffers = openBuffers.flatMap((d) => {
    const next = translate(d);
    return next ? [next] : [];
  });
  if (currentDocument) currentDocument = translate(currentDocument);
  const event = { ...result, lab, scope: service.root, id: ++fileSequence };
  send('files:changed', event);
  return event;
}
async function initialize() {
  if (await exists(locationFile)) {
    const value = (await readJSON(locationFile)) as { dataDirectory: string };
    await requirePath(value.dataDirectory, 'directory');
    storage = new Storage(await realpath(value.dataDirectory));
  }
  config = await storage.init();
  setUILanguage(config.uiLanguage ?? 'zh-CN');
  installApplicationMenu();
  initialized = true;
  win.webContents.setZoomFactor(config.zoomFactor);
  void cleanInactiveRuntime();
  nativeTheme.themeSource = config.theme;
  win.setBackgroundColor(config.theme === 'light' ? '#ffffff' : '#1e1e1e');
  const projects = await storage.projects();
  if (!projects.some((p) => p.labId === config.currentLab)) {
    config.currentLab = '';
    config.currentProblem = '';
  } else if (
    !projects.find((p) => p.labId === config.currentLab)!.problems.includes(config.currentProblem)
  )
    config.currentProblem = '';
  handle('bootstrap', bootstrap);
  handle('draft:save', persist);
  handle('draft:load', selectDraft);
  handle('draft:reload', async () => {
    requireIdle();
    await saves;
    currentDocument = undefined;
    documentDirty = false;
    return bootstrap();
  });
  handle('workspace:sources', async (lab: string, text: string) => {
    if (typeof text !== 'string' || !(await storage.workspace.isProject(lab)))
      throw new UIError('Invalid experiment');
    return (await resolveBuild(parseMake(text).spec, storage.workspace.root(lab))).units.map(
      (u) => u.path,
    );
  });
  handle('workspace:files', async (lab: string, problem = config.currentProblem) =>
    (await storage.fileService(lab, problem)).list(),
  );
  handle('workspace:open', (lab: string, file: string, problem = config.currentProblem) =>
    storage.openFile(lab, problem, file, config.language),
  );
  handle('workspace:view', async (lab: string, value: any) => {
    if (!(await storage.workspace.isProject(lab))) throw new UIError('Select a project');
    const update: any = {};
    for (const key of [
      'activeFile',
      'openFiles',
      'expanded',
      'sidebarWidth',
      'sidebarCollapsed',
      'rightCollapsed',
    ])
      if (Object.hasOwn(value, key)) update[key] = value[key];
    if (update.openFiles) {
      if (!Array.isArray(update.openFiles)) throw new UIError('Invalid open-file list');
      update.openFiles.forEach(workspacePath);
    }
    if (update.activeFile) workspacePath(update.activeFile);
    if (update.expanded) update.expanded.forEach(workspacePath);
    if (
      update.sidebarWidth !== undefined &&
      (!Number.isFinite(update.sidebarWidth) ||
        update.sidebarWidth < 120 ||
        update.sidebarWidth > 420)
    )
      throw new UIError('Invalid sidebar width');
    await storage.workspace.update(lab, update);
  });
  handle('files:view', async (lab: string, value: any) => {
    const update: any = {};
    for (const key of ['expanded', 'sidebarWidth', 'sidebarCollapsed', 'rightCollapsed'])
      if (Object.hasOwn(value, key)) update[key] = value[key];
    if (update.expanded) {
      if (!Array.isArray(update.expanded)) throw new UIError('Invalid folder list');
      update.expanded.forEach(workspacePath);
    }
    if (
      update.sidebarWidth !== undefined &&
      (!Number.isFinite(update.sidebarWidth) ||
        update.sidebarWidth < 120 ||
        update.sidebarWidth > 420)
    )
      throw new UIError('Invalid sidebar width');
    for (const k of ['sidebarCollapsed', 'rightCollapsed'])
      if (update[k] !== undefined && typeof update[k] !== 'boolean')
        throw new UIError('Invalid view state');
    await storage.saveFileView(lab, update);
  });
  handle('completion:files', async (lab: string, problem: string) => {
    const service = await storage.fileService(lab, problem),
      project = await storage.workspace.isProject(lab),
      snapshot = await directorySnapshot(
        service.root,
        (name) => isHeaderFile(name) || (project && name === 'LPMake.txt'),
      );
    let includeDirs = ['.'];
    let forcedLanguage: Language | undefined;
    if (snapshot.files['LPMake.txt'])
      try {
        const spec = parseMake(snapshot.files['LPMake.txt']).spec;
        includeDirs = spec.includeDirs;
        forcedLanguage = spec.language;
      } catch {}
    const files = Object.fromEntries(
      Object.entries(snapshot.files).filter(([name]) => isHeaderFile(name)),
    );
    for (const [name, bytes] of Object.entries(snapshot.binaryFiles ?? {}))
      if (isHeaderFile(name)) files[name] = decodeText(Buffer.from(bytes, 'base64')).text;
    return { scope: service.root, files, includeDirs, forcedLanguage };
  });
  handle('files:context', async (lab: string, problem: string, files: string[], action: string) => {
    const service = await storage.fileService(lab, problem),
      names = files.length ? files : [''],
      paths = await Promise.all(names.map((file) => service.resolve(file)));
    if (action === 'copy' || action === 'relative')
      clipboard.writeText((action === 'copy' ? paths : names).join('\n'));
    else if (action === 'reveal') {
      if (files.length) shell.showItemInFolder(paths[0]);
      else await shell.openPath(paths[0]);
    } else throw new UIError('Invalid file operation');
    return paths;
  });
  handle(
    'files:external',
    async (file: string) =>
      (
        await messageBox({
          type: 'question',
          title: localize('File Changed on Disk'),
          message: localize('{0} was changed by another program.', file),
          detail: localize('Reloading replaces the unsaved content in the editor.'),
          buttons: [localize('Reload'), localize('Keep Editor Contents')],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        })
      ).response === 0,
  );
  handle('files:operate', performFiles);
  handle(
    'build:preview',
    async (value: Draft, options?: ProjectBuildOptions, machine?: CompilerConfig) => {
      const d = await buildInput(value),
        selected = machine
          ? structuredClone(validateConfig({ ...config, compiler: machine })).compiler
          : config.compiler,
        base = d.workspace
          ? structuredClone(selected)
          : options
            ? effectiveCompiler(selected, options)
            : effectiveCompiler(
                selected,
                d.problem.labId ? await storage.buildOptions(d.problem.labId) : undefined,
              );
      return previewPlan(d, await compiler.forDraft(d, base));
    },
  );
  handle('project:build:get', async (lab: string) =>
    (await storage.workspace.isProject(lab)) ? undefined : storage.buildOptions(lab),
  );
  handle('project:build:save', async (lab: string, value: ProjectBuildOptions) => {
    requireIdle();
    await saves;
    if (await storage.workspace.isProject(lab))
      throw new UIError(
        'Project build arguments are managed by LPMake.txt. Edit the build configuration.',
      );
    if (!value.inheritDefaults) {
      assertParameters(value.cArgs, localize('C Arguments'));
      assertParameters(value.cppArgs, localize('C++ Arguments'));
      assertParameters(value.linkArgs, localize('Linker Arguments'));
    }
    await storage.saveBuildOptions(lab, value);
  });
  handle('project:delete', async (lab: string) => {
    await saves;
    filePart(lab, localize('Experiment Name'));
    const project = (await storage.projects()).find((p) => p.labId === lab);
    if (!project) throw new UIError('The experiment no longer exists');
    let files = 0,
      tests = 0;
    if (project.mode === 'project') {
      files = (await storage.workspace.list(lab)).filter((f) => !f.directory).length;
      tests = (await storage.workspace.read(lab)).tests.testCases.length;
    } else
      for (const id of project.problems) {
        files += (await storage.allDocuments(lab, id, 'c')).length;
        tests += (await storage.load(lab, id, 'c', true)).problem.testCases.length;
      }
    const choice = await messageBox({
      type: 'warning',
      title: localize('Delete Experiment'),
      message: localize('Delete “{0}”?', lab),
      detail: localize(
        'This deletes {0} files, {1} test cases, settings, and local records from this experiment.{2}{3}\nThis cannot be undone. Original imported files and other experiments are kept.',
        files,
        tests,
        documentDirty && currentDocument?.problem.labId === lab
          ? localize('\nIncludes unsaved changes.')
          : '',
        active && currentDocument?.problem.labId === lab
          ? localize('\nThe running task will be stopped.')
          : '',
      ),
      buttons: [localize('Cancel'), localize('Delete Entire Experiment')],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (choice.response !== 1) return false;
    if (active) {
      if (currentDocument?.problem.labId !== lab)
        throw new UIError('Wait for the current task to finish before deleting the experiment');
      await stop();
    }
    await stopWarmup();
    await clearWorkspaceCache(compiler, lab);
    await storage.deleteLab(lab);
    if (config.currentLab === lab) {
      config = { ...config, currentLab: '', currentProblem: '' };
      await storage.saveConfig(config);
      currentDocument = undefined;
      openBuffers = [];
      documentDirty = false;
    }
    return true;
  });
  handle('zoom:reset', async () => {
    win.webContents.setZoomFactor(1);
    config = { ...config, zoomFactor: 1 };
    await storage.saveConfig(config);
    send('zoom:changed', 1);
  });
  handle('projects', () => storage.projects());
  handle('source:recent', async (lab: string, problem: string, closed: string[]) => {
    selection(lab, problem);
    if (await storage.workspace.isProject(lab)) {
      const files = await storage.workspace.list(lab);
      const file =
        closed
          .map((id) => id.replace(/^file:/, ''))
          .find((f) => files.some((e) => !e.directory && e.path === f)) ??
        files.find((f) => !f.directory)?.path;
      return file ? storage.workspace.open(lab, file) : null;
    }
    return storage.recentDocument(lab, problem, closed);
  });
  handle('check:state', async (value: Draft) => {
    const d = await buildInput(value),
      options = await draftOptions(d);
    return coverage(storage, d, { ...config, compiler: options }, await inputIdentity(d, options));
  });
  handle('check:problems', async (value: Draft, buffers: Draft[]) => {
    const current = validateDraft(value);
    if (await storage.workspace.isProject(current.problem.labId)) return {};
    const project = (await storage.projects()).find((p) => p.labId === current.problem.labId),
      states: Record<string, string> = {};
    const identities = new Map<Language, string>();
    for (const id of project?.problems ?? []) {
      const value =
          id === current.problem.problemId
            ? current
            : (buffers.find(
                (b) => b.problem.problemId === id && b.problem.labId === current.problem.labId,
              ) ?? (await storage.load(current.problem.labId, id, 'c', true))),
        d = await buildInput(value);
      const options = await draftOptions(d);
      if (!identities.has(d.language))
        identities.set(d.language, await compiler.identity(options, d.language));
      states[id] = (
        await coverage(
          storage,
          d,
          { ...config, compiler: options },
          await inputIdentity(d, options),
        )
      ).state;
    }
    return states;
  });
  handle('export:choices', async (buffers: Draft[]) => {
    requireIdle();
    await saves;
    if (!currentDocument) throw new UIError('Select an experiment first');
    return exportChoices(storage, currentDocument, buffers.map(validateDraft));
  });
  handle('export:preview', async (kind: string, values: Draft[], includeConfig = false) => {
    requireIdle();
    await saves;
    if (!values.length) throw new UIError('Select at least one source file');
    const drafts = values.map(validateDraft);
    if (await storage.workspace.isProject(drafts[0].problem.labId)) {
      if (kind === 'project') {
        const d = await buildInput(drafts[0]),
          options = await draftOptions(d),
          preview = await prepareWorkspaceProject(
            storage,
            d,
            { ...structuredClone(config), compiler: options },
            [...openBuffers, ...drafts],
            includeConfig,
            submissionServices(),
          ),
          record = (await storage.workspace.read(d.problem.labId)).check;
        if (
          d.problem.testCases.length &&
          (!record ||
            record.fingerprint !== fingerprint(d, options, await inputIdentity(d, options)) ||
            record.total !== d.problem.testCases.length) &&
          !preview.warnings.some((w) => w.startsWith(localize('Not All Tests Passed')))
        )
          preview.warnings.unshift(
            localize('Not all tests passed: the source or rules changed. Run the tests again.'),
          );
        return preview;
      }
      const d = await buildInput(drafts[0]);
      if (!d.file) throw new UIError('Select a file first');
      const name = path.basename(d.file),
        preview = await prepareWorkspaceProject(
          storage,
          d,
          structuredClone(config),
          [...openBuffers, ...drafts],
          false,
          submissionServices(),
        ),
        record = (await storage.workspace.read(d.problem.labId)).check;
      if (
        record?.fingerprint !==
          fingerprint(d, await draftOptions(d), await inputIdentity(d, await draftOptions(d))) &&
        !preview.warnings.some((w) => w.startsWith(localize('Not All Tests Passed')))
      )
        preview.warnings.unshift(localize('Not all tests passed: test the current project first.'));
      return {
        kind: 'source',
        name,
        labId: d.problem.labId,
        files: [{ name, source: d.source }],
        warnings: preview.warnings,
      };
    }
    const source = kind === 'source' ? await targetInput(drafts[0]) : drafts[0];
    return kind === 'project'
      ? prepareProject(
          storage,
          drafts[0],
          { ...structuredClone(config), compiler: await draftOptions(drafts[0]) },
          submissionServices(),
          drafts,
          includeConfig,
        )
      : prepareSource(
          storage,
          source,
          { ...structuredClone(config), compiler: await draftOptions(source) },
          submissionServices(),
        );
  });
  handle('export:write', async (value: Submission) => {
    requireIdle();
    if (
      !value ||
      !['source', 'project'].includes(value.kind) ||
      !Array.isArray(value.files) ||
      !value.files.length
    )
      throw new UIError('Invalid export contents');
    filePart(value.name, localize('Export Filename'));
    for (const f of value.files) {
      if (f.name !== 'labpad.project.json') workspacePath(f.name);
      if (typeof f.source !== 'string') throw new UIError('Invalid export contents');
    }
    const ext =
      value.kind === 'project' ? 'zip' : path.extname(value.files[0].name).slice(1) || 'txt';
    const selected = await dialog.showSaveDialog(win, {
      title:
        value.kind === 'project'
          ? localize('Export Experiment · Choose Save Location')
          : localize('Export Source · Choose Save Location'),
      defaultPath: value.name,
      filters: [
        {
          name: value.kind === 'project' ? localize('ZIP Archive') : localize('Source Files'),
          extensions: [ext],
        },
      ],
    });
    if (selected.canceled || !selected.filePath) return null;
    const file = path.extname(selected.filePath)
      ? selected.filePath
      : selected.filePath + '.' + ext;
    if (path.extname(file).toLowerCase() !== '.' + ext)
      throw new UIError('Choose a .{0} file', ext);
    if (value.kind === 'project')
      await writeFileAtomic(
        file,
        Buffer.from(submissionZip({ ...value, name: path.basename(file) })),
      );
    else await writeSource(file, value.files[0].source);
    return file;
  });
  handle('project:create', async (name: string, mode = 'problem-set') => {
    requireIdle();
    await saves;
    if (mode === 'project') {
      await storage.workspace.create(name, config.language);
      return selectDraft(name, '', config.language);
    }
    if (mode !== 'problem-set') throw new UIError('Invalid experiment type');
    const carry = currentDocument && structuredClone(currentDocument);
    await storage.createLab(name);
    const next = await selectDraft(name, '', config.language);
    if (carry) {
      const copy = await storage.newVersion({
        ...next,
        source: carry.source,
        language: carry.language,
      });
      currentDocument = copy;
      return copy;
    }
    return next;
  });
  handle('problem:create', async (lab: string, name: string, language: Language) => {
    requireIdle();
    await saves;
    const carry =
      currentDocument && !currentDocument.problem.problemId
        ? structuredClone(currentDocument)
        : undefined;
    const next = await storage.createProblem(lab, name, language);
    if (carry) await storage.save({ ...next, source: carry.source, language: carry.language });
    return selectDraft(lab, name, carry?.language ?? language);
  });
  ipcMain.on('document:state', (event, value: Draft, dirty: boolean) => {
    if (event.sender === win.webContents) {
      currentDocument = structuredClone(validateDraft(value));
      documentDirty = !!dirty;
    }
  });
  ipcMain.on(
    'workspace:state',
    (event, values: Draft[], dirty: boolean, edits?: WorkspaceEdits) => {
      if (event.sender === win.webContents) {
        openBuffers = values.map((d) => structuredClone(validateDraft(d)));
        pendingEdits = edits
          ? {
              dirtyDocuments: edits.dirtyDocuments.filter((id) => typeof id === 'string'),
              ...(edits.rules
                ? {
                    rules: {
                      problem: structuredClone(validateProblem(edits.rules.problem)),
                      expected: structuredClone(validateProblem(edits.rules.expected)),
                    },
                  }
                : {}),
            }
          : undefined;
        documentDirty = !!dirty;
      }
    },
  );
  handle('documents:open', async (lab: string, problem: string, language: Language) =>
    (await storage.workspace.isProject(lab))
      ? storage.workspace.documents(lab)
      : storage.openDocuments(lab, problem, language),
  );
  handle('document:activate', async (id: string, file?: string) => {
    if (!currentDocument) throw new UIError('No file is open');
    if (
      currentDocument.file &&
      (await storage.workspace.isProject(currentDocument.problem.labId))
    ) {
      await storage.workspace.update(currentDocument.problem.labId, {
        activeFile: file ?? currentDocument.file,
      });
      return;
    }
    await storage.activateDocument(
      currentDocument.problem.labId,
      currentDocument.problem.problemId,
      id,
    );
    const state = await storage.projectState(
        currentDocument.problem.labId,
        currentDocument.problem.problemId,
        currentDocument.language,
      ),
      version = state.documents?.find((v) => v.id === id);
    if (version) {
      config = { ...config, language: version.language, sourceFile: null };
      await storage.saveConfig(config);
    }
  });
  handle('source:version', (value: Draft, fromTemplate: boolean) => {
    requireIdle();
    return storage.newVersion(value, fromTemplate === true);
  });
  handle('clipboard:write', (text: string) => {
    if (typeof text !== 'string') throw new UIError('Invalid clipboard content');
    clipboard.writeText(text);
  });
  handle('path:show-file', async (file: string) => {
    if (typeof file !== 'string' || !path.isAbsolute(file))
      throw new UIError('Choose a saved source file');
    try {
      if (!(await stat(file)).isFile()) throw new Error();
      await access(file, constants.R_OK);
    } catch {
      throw new UIError('The file is missing or inaccessible. Save the source first.');
    }
    shell.showItemInFolder(file);
  });
  handle('path:copy', (file: string, relative: boolean) => {
    clipboard.writeText(relative ? path.relative(storage.root, file) : file);
  });
  handle('cache:clear', async () => {
    requireIdle();
    await stopWarmup();
    await compiledProgram.clear();
    return compiler.cache.clear();
  });
  handle('shortcuts:open', async () => {
    if (shortcutWindow && !shortcutWindow.isDestroyed()) {
      shortcutWindow.focus();
      return;
    }
    shortcutWindow = new BrowserWindow({
      parent: win,
      width: 760,
      height: 750,
      minWidth: 540,
      minHeight: 480,
      title: localize('LabPad · Keyboard Shortcuts'),
      icon: iconPath,
      backgroundColor: config.theme === 'light' ? '#ffffff' : '#1e1e1e',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    shortcutWindow.setMenuBarVisibility(false);
    shortcutWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    shortcutWindow.webContents.on('will-navigate', (e) => e.preventDefault());
    shortcutWindow.on('closed', () => {
      shortcutWindow = undefined;
    });
    if (process.env.VITE_DEV_SERVER_URL)
      await shortcutWindow.loadURL(process.env.VITE_DEV_SERVER_URL + '#shortcuts');
    else
      await shortcutWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
        hash: 'shortcuts',
      });
  });
  ipcMain.handle('shortcuts:get', (event) => {
    if (event.sender !== shortcutWindow?.webContents) throw new UIError('Invalid window');
    return {
      uiLanguage: currentLanguage(),
      shortcuts: config.shortcuts,
      theme: config.theme,
      platform: process.platform,
    };
  });
  ipcMain.handle('shortcuts:save', async (event, value: unknown) => {
    if (event.sender !== shortcutWindow?.webContents) throw new UIError('Invalid window');
    const shortcuts = structuredClone(validateShortcuts(value));
    await saves;
    config = { ...config, shortcuts };
    await storage.saveConfig(config);
    send('shortcuts:changed', shortcuts);
  });
  handle('document:confirm', confirmUnsaved);
  handle('path:validate', validatePath);
  handle('path:choose', async (kind: PathKind, current: string) => {
    const result = await dialog.showOpenDialog(win, {
      title:
        kind === 'directory'
          ? localize('Choose Data Folder')
          : localize('Choose Compiler Executable'),
      defaultPath: current || undefined,
      properties: kind === 'directory' ? ['openDirectory'] : ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('path:reveal', async (value: string, kind: PathKind) => {
    await requirePath(value, kind);
    if (kind === 'directory') {
      const error = await shell.openPath(value);
      if (error) throw new Error(error);
    } else shell.showItemInFolder(value);
  });
  handle(
    'config:save',
    async (
      value: Config,
      dataRoot: string,
      project?: { lab: string; options: ProjectBuildOptions },
    ) => {
      requireIdle();
      await stopWarmup();
      await saves;
      const next = structuredClone(
        validateConfig({
          ...value,
          currentLab: config.currentLab,
          currentProblem: config.currentProblem,
          sourceFile: config.sourceFile,
          layout: config.layout,
          shortcuts: config.shortcuts,
        }),
      );
      if (project) {
        filePart(project.lab, localize('Experiment Name'));
        if (project.lab !== config.currentLab || (await storage.workspace.isProject(project.lab)))
          throw new UIError('The current experiment changed. Reopen Settings.');
      }
      await requirePath(dataRoot, 'directory');
      const target = await realpath(dataRoot.trim());
      if (next.compiler.mode === 'custom') {
        next.compiler.cPath = next.compiler.cPath.trim();
        next.compiler.cppPath = next.compiler.cppPath.trim();
        await requirePath(next.compiler.cPath, 'executable');
        if (next.compiler.cppPath) await requirePath(next.compiler.cppPath, 'executable');
        else if (next.language === 'cpp' && next.compiler.kind !== 'zig')
          throw new UIError('Enter the C++ compiler path');
      }
      await compiler.info(next.compiler);
      if (target !== (await realpath(storage.root))) {
        await storage.copyDataTo(target);
        const replacement = new Storage(target);
        await replacement.saveSettings(next, project);
        await mkdir(defaultRoot, { recursive: true });
        await writeFile(
          locationFile + '.tmp',
          JSON.stringify({ dataDirectory: target }, null, 2) + '\n',
          'utf8',
        );
        await rename(locationFile + '.tmp', locationFile);
        storage = replacement;
      } else await storage.saveSettings(next, project);
      config = next;
      setUILanguage(next.uiLanguage ?? 'zh-CN');
      installApplicationMenu();
      win.webContents.setZoomFactor(next.zoomFactor);
      scheduleWarmup();
      nativeTheme.themeSource = next.theme;
      win.setBackgroundColor(next.theme === 'light' ? '#ffffff' : '#1e1e1e');
      return settingsResult();
    },
  );
  handle('source:format', (source: string, language: Language, indentSize: number) => {
    if (typeof source !== 'string' || !['c', 'cpp'].includes(language))
      throw new UIError('Invalid source data');
    return formatter.format(source, language, indentSize);
  });
  handle('layout:save', async (value: unknown) => {
    const layout = validateLayout(value);
    await saves;
    config = { ...config, layout };
    await storage.saveConfig(config);
    return layout;
  });
  handle('compiler:detect', async () => {
    requireIdle();
    return detectCompilers({
      cwd: await compiler.session,
      exclude: [toolchain],
      processHost: compiler.paths.processHost,
    });
  });
  handle('compiler:info', (value: CompilerConfig) =>
    compiler.info(validateConfig({ ...config, compiler: value }).compiler),
  );
  handle('source:import', async (destination?: string) => {
    requireIdle();
    await saves;
    const selected = await dialog.showOpenDialog(win, {
      title: localize('Import Source File'),
      properties: ['openFile'],
      filters: [{ name: localize('C / C++ Source Files'), extensions: sourceExtensions }],
    });
    if (selected.canceled) return null;
    const file = selected.filePaths[0];
    if (await storage.workspace.isProject(config.currentLab)) {
      const service = await storage.fileService(config.currentLab, ''),
        relative = path.relative(await realpath(service.root), await realpath(file)),
        owned = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
      if (owned) {
        const document = await storage.workspace.open(
          config.currentLab,
          relative.split(path.sep).join('/'),
        );
        return {
          source: document.source,
          encoding: document.sourceEncoding!,
          path: document.sourceFile!,
          language: document.language,
          document,
          reused: true,
        };
      }
      const folder = destination ? workspacePath(destination) : '',
        name = workspacePath((folder ? folder + '/' : '') + path.basename(file)),
        target = await storage.workspace.path(config.currentLab, name, true),
        decoded = (await import('../core/storage')).decodeText(await readEditableFile(file));
      if ((await exists(target)) && (await realpath(file)) === (await realpath(target))) {
        const document = await storage.workspace.open(config.currentLab, name);
        return {
          source: document.source,
          encoding: document.sourceEncoding!,
          path: document.sourceFile!,
          language: document.language,
          document,
          reused: true,
        };
      }
      if (await exists(target)) {
        const choice = await messageBox({
          type: 'question',
          title: localize('Replace Project File'),
          message: localize('“{0}” already exists. Replace it?', name),
          detail: localize(
            'The current file and its unsaved changes will be replaced. The original imported file is kept.',
          ),
          buttons: [localize('Cancel'), localize('Replace')],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (choice.response !== 1) return null;
      }
      await performFiles(config.currentLab, '', {
        action: 'newFile',
        paths: [name],
        content: decoded.text,
        conflict: 'replace',
      });
      const document = await storage.workspace.open(config.currentLab, name);
      currentDocument = document;
      openBuffers = openBuffers.filter((d) => d.file !== name);
      return {
        source: document.source,
        encoding: document.sourceEncoding!,
        path: document.sourceFile!,
        language: document.language,
        document,
      };
    }
    if (!isSourceFile(file)) throw new UIError('Choose a C / C++ source file');
    const document = await storage.importSource(config.currentLab, config.currentProblem, file);
    currentDocument = document;
    config = { ...config, sourceFile: null, language: document.language };
    await storage.saveConfig(config);
    return {
      source: document.source,
      encoding: document.sourceEncoding!,
      path: document.sourceFile!,
      language: document.language,
      document,
    };
  });
  handle('problem:save', async (value: unknown, expected?: unknown) => {
    const problem = structuredClone(validateProblem(value));
    await saves;
    if (await storage.workspace.isProject(problem.labId))
      await storage.workspace.update(problem.labId, { tests: problem });
    else
      await storage.saveProblem(
        problem,
        expected === undefined ? undefined : validateProblem(expected),
      );
    if (
      currentDocument?.problem.labId === problem.labId &&
      currentDocument.problem.problemId === problem.problemId
    )
      currentDocument.problem = problem;
  });
  handle('problem:import', async (lab: string, problem: string) => {
    requireIdle();
    selection(lab, problem);
    await saves;
    const current =
      currentDocument?.problem.labId === lab && currentDocument.problem.problemId === problem
        ? structuredClone(currentDocument)
        : await storage.load(lab, problem, config.language);
    const selected = await dialog.showOpenDialog(win, {
      title: localize('Import Test Cases · Current Problem'),
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: localize('Standard I/O'), extensions: ['json', 'in', 'out', 'ans'] }],
    });
    if (selected.canceled) return null;
    const patch =
      selected.filePaths.length === 1 &&
      path.extname(selected.filePaths[0]).toLowerCase() === '.json'
        ? parseIOPatch(await readJSON(selected.filePaths[0]), current.problem)
        : { testCases: (await importPairs(selected.filePaths, lab, problem)).testCases };
    const choice = await messageBox({
      type: 'question',
      title: localize('Import Test Cases'),
      message: localize('Import Test Cases ({0})', patch.testCases!.length),
      detail: localize(
        'There are {0} existing test cases. Replace overwrites them; Append keeps them and their comparison rules.',
        current.problem.testCases.length,
      ),
      buttons: [localize('Cancel'), localize('Replace Existing Test Cases'), localize('Append')],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (!choice.response) return null;
    const mode = choice.response === 1 ? 'replace' : 'append';
    let adoptLimits = false;
    if (
      mode === 'append' &&
      ((patch.timeLimitMs !== undefined && patch.timeLimitMs !== current.problem.timeLimitMs) ||
        (patch.outputLimitBytes !== undefined &&
          patch.outputLimitBytes !== current.problem.outputLimitBytes))
    ) {
      const answer = await messageBox({
        type: 'question',
        title: localize('Test Limits'),
        message: localize('The imported file specifies a different time limit or output limit.'),
        detail: localize(
          'These limits apply to the whole problem. When appending test cases, you can keep the current limits.',
        ),
        buttons: [
          localize('Cancel'),
          localize('Keep Current Limits'),
          localize('Use Imported Limits'),
        ],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
      });
      if (!answer.response) return null;
      adoptLimits = answer.response === 2;
    }
    const imported = mergeTests(current.problem, patch, mode, adoptLimits);
    const confirm = await messageBox({
      type: 'question',
      title: localize('Confirm Import'),
      message: localize(
        '{0}: {1} test cases',
        mode === 'replace' ? localize('After replacing') : localize('After appending'),
        imported.problem.testCases.length,
      ),
      detail: localize(
        '{0}\nRun the tests again after importing.',
        (mode === 'append'
          ? localize('Existing test cases and their comparison rules are kept.')
          : localize(
              'Replaces the test cases and rules explicitly supplied in the file. Source files are kept.',
            )) +
          (imported.renamed.length
            ? localize('\nConflicting IDs were renamed: ') +
              imported.renamed.map((x) => x.from + ' → ' + x.to).join('、')
            : ''),
      ),
      buttons: [localize('Cancel'), localize('Import')],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    });
    if (confirm.response !== 1) return null;
    if (await storage.workspace.isProject(lab))
      await storage.workspace.update(lab, { tests: imported.problem });
    else await storage.saveProblem(imported.problem);
    if (currentDocument?.problem.labId === lab && currentDocument.problem.problemId === problem)
      currentDocument.problem = imported.problem;
    return imported.problem;
  });
  handle('project:import', async () => {
    requireIdle();
    await saves;
    const selected = await dialog.showOpenDialog(win, {
      title: localize('Import Experiment'),
      properties: ['openFile'],
      filters: [{ name: localize('Experiment JSON'), extensions: ['json', 'zip'] }],
    });
    if (selected.canceled) return null;
    const value = (
        path.extname(selected.filePaths[0]).toLowerCase() === '.zip'
          ? await readProjectArchive(selected.filePaths[0])
          : await readJSON(selected.filePaths[0])
      ) as any,
      target = (await storage.projects()).find((p) => p.labId === value?.labId),
      testsOnly = value?.kind === 'labpad.projectTests';
    let update = testsOnly;
    if (target && !testsOnly) {
      const choice = await messageBox({
        type: 'question',
        title: localize('Import Experiment'),
        message: localize('“{0}” already exists.', target.labId),
        detail: localize('Updating test cases keeps source files, templates, and unsaved edits.'),
        buttons: [localize('Cancel'), localize('Update Test Cases'), localize('Import Copy')],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
      });
      if (!choice.response) return null;
      update = choice.response === 1;
    }
    if (update) {
      const incoming = parseProjectTests(value);
      if (!target)
        throw new UIError(
          'Experiment “{0}” was not found. Import the complete experiment first.',
          incoming.labId,
        );
      if (incoming.mode !== (target.mode ?? 'problem-set'))
        throw new UIError('The experiment modes do not match. Test cases cannot be updated.');
      if (incoming.mode === 'project') {
        const current =
          currentDocument?.problem.labId === target.labId
            ? currentDocument.problem
            : (await storage.workspace.read(target.labId)).tests;
        const tests = mergeTests(current, incoming.tests!, 'replace').problem;
        const answer = await messageBox({
          type: 'question',
          title: localize('Update Experiment Test Cases'),
          message: localize(
            'Update Test Cases for “{0}” ({1})',
            target.labId,
            tests.testCases.length,
          ),
          detail: localize(
            'Source files, LPMake, and unsaved edits are kept. An empty test set clears the existing test cases.',
          ),
          buttons: [localize('Cancel'), localize('Update Test Cases')],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (answer.response !== 1) return null;
        await storage.workspace.update(target.labId, { tests });
        if (currentDocument?.problem.labId === target.labId) currentDocument.problem = tests;
        return { ...(await bootstrap()), updatedProblems: [tests] };
      }
      const missing = incoming.problems!.filter((p) => !target.problems.includes(p.problemId));
      if (missing.length)
        throw new UIError(
          'These problem IDs were not found: {0}',
          missing.map((p) => p.problemId).join('、'),
        );
      const rules = await Promise.all(
        incoming.problems!.map(async (p) => {
          const current =
            currentDocument?.problem.labId === target.labId &&
            currentDocument.problem.problemId === p.problemId
              ? currentDocument.problem
              : (await storage.load(target.labId, p.problemId, 'c', true)).problem;
          return mergeTests(current, p.rules, 'replace').problem;
        }),
      );
      const choice = await messageBox({
        type: 'question',
        title: localize('Update Experiment Test Cases'),
        message: localize('Update Problems in “{0}” ({1})', target.labId, rules.length),
        detail: localize(
          '{0}\nSource files and unsaved edits are kept. Problems not listed here stay unchanged.',
          rules
            .map(
              (p) =>
                p.problemId +
                '：' +
                p.testCases.length +
                localize(' test cases') +
                (!p.testCases.length ? localize(' (will be cleared)') : ''),
            )
            .join('\n'),
        ),
        buttons: [localize('Cancel'), localize('Update Test Cases')],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (choice.response !== 1) return null;
      await storage.updateProjectTests(target.labId, rules);
      const current = rules.find(
        (p) =>
          p.problemId === currentDocument?.problem.problemId &&
          p.labId === currentDocument.problem.labId,
      );
      if (current && currentDocument) currentDocument.problem = current;
      return { ...(await bootstrap()), updatedProblems: rules };
    }
    const workspace = value?.mode === 'project' ? parseWorkspacePackage(value) : undefined,
      lab = workspace ?? parseLabPackage(value),
      name = await storage.nextLabName(lab.labId);
    if (documentDirty) {
      const choice = await confirmUnsaved();
      if (choice === 'cancel') return null;
      if (choice === 'save')
        for (const d of openBuffers.length ? openBuffers : currentDocument ? [currentDocument] : [])
          await persist(d);
    }
    const imported = workspace
      ? await storage.workspace.create(name, config.language, workspace)
      : undefined;
    if (imported) await selectDraft(name, '', imported.language);
    else {
      const created = await storage.importProject(lab, name);
      await selectDraft(created.labId, created.problemId, created.language);
    }
    let editBuild = false;
    if (workspace?.templateFilled) {
      const answer = await messageBox({
        type: 'info',
        title: localize('Project Build Configuration'),
        message: localize(
          'The experiment did not include LPMake.txt. A default template has been added.',
        ),
        detail: localize(
          'You can edit the source patterns, include directories, and compiler arguments. Ignore keeps the default template; use the build diagnostics to adjust it later.',
        ),
        buttons: [localize('Edit Configuration'), localize('Ignore')],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      editBuild = answer.response === 0;
    }
    return { ...(await bootstrap()), ...(editBuild ? { editBuild: true } : {}) };
  });
  handle('tests:export', async (kind: string, value: unknown) => {
    requireIdle();
    await saves;
    const problem = validateProblem(value);
    let content: unknown = exportIO(problem),
      name = (problem.problemId || problem.labId || localize('Test Cases')) + '.io.json';
    if (kind === 'project') {
      const target = (await storage.projects()).find((p) => p.labId === problem.labId);
      if (!target) throw new UIError('Select an experiment first');
      if (target.mode === 'project') {
        content = {
          schemaVersion: 2,
          kind: 'labpad.projectTests',
          mode: 'project',
          labId: problem.labId,
          tests: exportIO(problem),
        };
        name = problem.labId + '.tests.json';
      } else {
        const rules = await Promise.all(
          target.problems.map(async (id) =>
            id === problem.problemId
              ? problem
              : (await storage.load(problem.labId, id, 'c', true)).problem,
          ),
        );
        content = exportProjectTests(problem.labId, rules);
        name = problem.labId + '.tests.json';
      }
    } else if (kind !== 'current') throw new UIError('Invalid export type');
    const file = await dialog.showSaveDialog(win, {
      title:
        kind === 'project'
          ? localize('Export Experiment Test Cases')
          : localize('Export Current Test Cases'),
      defaultPath: name,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (file.canceled || !file.filePath) return null;
    const target = file.filePath.endsWith('.json') ? file.filePath : file.filePath + '.json';
    await writeFileAtomic(target, JSON.stringify(content, null, 2) + '\n');
    return target;
  });
  handle('problem:show', async (value: Draft) => {
    const d = validateDraft(value);
    if (await storage.workspace.isProject(d.problem.labId)) {
      shell.showItemInFolder(storage.workspace.metadata(d.problem.labId));
      return;
    }
    const file = storage.paths(d.problem.labId, d.problem.problemId, d.language).problem;
    if (!(await exists(file)))
      throw new UIError('Save the current problem before opening its rule file');
    shell.showItemInFolder(file);
  });
  ipcMain.handle('ui:language:get', (event) => {
    if (event.sender !== win.webContents && event.sender !== shortcutWindow?.webContents)
      throw new UIError('Invalid window');
    return currentLanguage();
  });
  handle('ui:language', (language: UILanguage) => {
    if (!['zh-CN', 'en-US'].includes(language)) throw new Error('Invalid interface language.');
    setUILanguage(language);
    installApplicationMenu();
    for (const window of BrowserWindow.getAllWindows())
      if (window !== win && !window.isDestroyed()) {
        window.webContents.send('ui:language', language);
        window.setTitle(localize('LabPad · Keyboard Shortcuts'));
      }
  });
  handle('compile:state', async (value: Draft) => {
    let saved = false;
    try {
      const input = await savedBuildInput(value);
      saved = input.saved;
      const context = await programContext(value, input);
      return { saved, ready: saved && compiledProgram.matches(context.key) };
    } catch {
      return { saved, ready: false };
    }
  });
  handle('compile:confirm', async () => {
    const result = await messageBox({
      type: 'question',
      title: localize('Save Before Compiling'),
      message: localize('There are unsaved changes.'),
      detail: localize('Compilation uses saved files.'),
      buttons: [localize('Save and Compile'), localize('Cancel')],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    return result.response === 0;
  });
  handle('compile', async (value: Draft) =>
    reserveExecution(async (abort) => {
      await stopWarmup();
      await compiledProgram.clear();
      const context = await programContext(value);
      if (!context.saved)
        throw new UIError('Save the files included in the build before compiling.');
      const task = compiledProgram.compile(
        context.key,
        context.draft,
        context.options,
        abort.signal,
      );
      active = task;
      try {
        const result = await task;
        judgeEvent({ type: 'compilation', compilation: result });
        return result;
      } finally {
        if (active === task) {
          active = undefined;
          controller = undefined;
        }
      }
    }),
  );
  handle('judge', async (value: Draft, ids?: string[]) =>
    reserveExecution(async (abort) => {
      const context = await programContext(value);
      if (!context.saved)
        throw new UIError('Save the files included in the build before compiling.');
      const d = context.draft,
        options = context.options,
        program = compiledProgram.require(context.key);
      const task = (async () => {
        const hash = fingerprint(d, options, await inputIdentity(d, options));
        const previous = await storedCheck(storage, d);
        await storage.recordCheck(d, checkRecord(d, hash, undefined, previous));
        const result = await judge(compiler, d, options, abort.signal, judgeEvent, ids, program);
        await storage.recordCheck(d, checkRecord(d, hash, result, previous));
        return result;
      })();
      active = task;
      try {
        return await task;
      } finally {
        if (active === task) {
          active = undefined;
          controller = undefined;
        }
      }
    }),
  );
  handle('terminal:context', async (value: Draft) => (await shellFor(value)).context());
  handle('terminal:command', async (value: Draft, text: string) => {
    if (active && nativeSession && !nativeActive()) await active;
    if (typeof text !== 'string' || Buffer.byteLength(text) > 1048576)
      throw new UIError('The command is too long.');
    const draft = validateDraft(value),
      shell = await shellFor(draft);
    await shell.context();
    if (
      /^[Ll][Pp][Mm][Aa][Kk][Ee]\s+(?:b|build|r|run)\s*$/.test(text) &&
      (await exists(await shell.files.resolve('LPMake.txt', true, shell.cwd))) &&
      !(await programContext(draft)).saved
    )
      return { ...(await shell.context()), output: '', needsSave: true };
    const result = await shell.execute(text);
    if (result.filesChanged)
      emitFileChanges(draft.problem.labId, [], await shell.files.list(), shell.files.root);
    return { ...result, scope: shell.files.root };
  });
  handle('terminal:complete', async (text: string, expected?: { scope: string; cwd: string }) => {
    const shell = terminalShell;
    if (!shell) return [];
    const current = await shell.context();
    if (expected && (expected.scope !== current.scope || expected.cwd !== current.cwd)) return [];
    const values = await shell.complete(text);
    if (shell !== terminalShell || shell.cwd !== current.cwd) return [];
    return values;
  });
  handle(
    'native:confirm-restart',
    async () =>
      (
        await messageBox({
          type: 'question',
          title: localize('Save and Restart'),
          message: localize('Source files or build configuration have unsaved changes.'),
          detail: localize(
            'After saving, the current debug session stops. The project is then recompiled and restarted.',
          ),
          buttons: [localize('Save and Restart'), localize('Cancel')],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        })
      ).response === 0,
  );
  handle('native:start', (value: Draft, points: SourceBreakpoint[]) =>
    reserveExecution((abort) => beginNative(value, points, abort)),
  );
  handle('native:control', async (action: string) => {
    if (!nativeSession || !['continue', 'pause', 'next', 'stepIn', 'stepOut'].includes(action))
      throw new UIError('No active debug session');
    await nativeSession.control(action as 'continue');
    return nativeView();
  });
  handle('native:stop', stop);
  handle('native:frame', async (id: number) => {
    if (!Number.isSafeInteger(id) || !nativeSession) throw new UIError('Invalid stack frame');
    await nativeSession.selectFrame(id);
    return nativeView();
  });
  handle('native:variables', async (ref: number, start = 0, inspectionId?: string) => {
    if (!Number.isSafeInteger(ref) || ref < 1 || !nativeSession)
      throw new UIError('Invalid variable');
    return nativeSession.variables(ref, start, inspectionId);
  });
  handle('native:watch', async (expression: string, inspectionId?: string) => {
    if (typeof expression !== 'string' || expression.length > 1024 || !nativeSession)
      throw new UIError('Invalid watch expression');
    return nativeSession.evaluate(expression, inspectionId);
  });
  handle('native:breakpoints', async (values: SourceBreakpoint[]) => {
    if (!nativeSession || !nativeActive()) return;
    const base = storage.workspace.root(nativeLab),
      deferred = openBuffers
        .filter(
          (d) => d.file && d.problem.labId === nativeLab && nativeSnapshot[d.file] !== d.source,
        )
        .map((d) => path.join(base, d.file!));
    await nativeSession.setBreakpoints(
      values.map((b) => ({ ...b, path: path.join(base, workspacePath(b.path)) })),
      deferred,
    );
    return nativeView();
  });
  handle(
    'native:view',
    async (lab: string, value?: { breakpoints: SourceBreakpoint[]; watches: string[] }) => {
      if (!(await storage.workspace.isProject(lab))) return { breakpoints: [], watches: [] };
      if (value) {
        if (
          !Array.isArray(value.breakpoints) ||
          value.breakpoints.length > 256 ||
          !Array.isArray(value.watches) ||
          value.watches.length > 100
        )
          throw new UIError('Invalid debug view settings');
        const breakpoints = value.breakpoints.map((b) => {
          workspacePath(b.path);
          if (
            !Number.isSafeInteger(b.line) ||
            b.line < 1 ||
            typeof b.enabled !== 'boolean' ||
            (b.condition !== undefined &&
              (typeof b.condition !== 'string' || b.condition.length > 1024))
          )
            throw new UIError('Invalid breakpoint settings');
          return {
            path: b.path,
            line: b.line,
            enabled: b.enabled,
            ...(b.condition ? { condition: b.condition } : {}),
          };
        });
        if (value.watches.some((w) => typeof w !== 'string' || w.length > 1024))
          throw new UIError('Invalid watch settings');
        await storage.workspace.update(lab, { debugView: { breakpoints, watches: value.watches } });
      }
      return (await storage.workspace.read(lab)).debugView ?? { breakpoints: [], watches: [] };
    },
  );
  handle('cancel', stop);
  handle('debug:stop', stop);
  handle('debug:start', (value: Draft) => reserveExecution((abort) => startDebug(value, abort)));
  ipcMain.on('debug:ack', (event, id: number, size: number) => {
    if (
      event.sender === win.webContents &&
      Number.isSafeInteger(id) &&
      Number.isSafeInteger(size) &&
      size > 0
    )
      acknowledge?.(id, size);
  });
  ipcMain.on('debug:input', (event, data: unknown) => {
    if (event.sender === win.webContents && typeof data === 'string') terminal?.write(data);
  });
  ipcMain.on('debug:resize', (event, cols: number, rows: number) => {
    if (
      event.sender === win.webContents &&
      Number.isSafeInteger(cols) &&
      Number.isSafeInteger(rows) &&
      cols > 0 &&
      rows > 0
    )
      try {
        terminal?.resize(Math.min(cols, 500), Math.min(rows, 200));
      } catch {}
  });
}
function installApplicationMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin'
        ? [
            {
              label: 'LabPad',
              submenu: [
                { role: 'about' as const, label: localize('About LabPad') },
                { type: 'separator' as const },
                { role: 'services' as const, label: localize('Services') },
                { type: 'separator' as const },
                { role: 'hide' as const, label: localize('Hide LabPad') },
                { role: 'hideOthers' as const, label: localize('Hide Others') },
                { role: 'unhide' as const, label: localize('Show All') },
                { type: 'separator' as const },
                { role: 'quit' as const, label: localize('Quit LabPad') },
              ],
            },
          ]
        : []),
      {
        label: localize('Edit'),
        submenu: [
          { role: 'undo', label: localize('Undo') },
          { role: 'redo', label: localize('Redo') },
          { type: 'separator' },
          { role: 'cut', label: localize('Cut') },
          { role: 'copy', label: localize('Copy') },
          { role: 'paste', label: localize('Paste') },
          { role: 'selectAll', label: localize('Select All') },
        ],
      },
      {
        label: localize('View'),
        submenu: [
          {
            label: localize('Actual Size'),
            accelerator: 'CommandOrControl+0',
            click: () => {
              win.webContents.setZoomFactor(1);
              if (config) {
                config = { ...config, zoomFactor: 1 };
                void storage.saveConfig(config);
                send('zoom:changed', 1);
              }
            },
          },
          { role: 'zoomIn', label: localize('Zoom In') },
          { role: 'zoomOut', label: localize('Zoom Out') },
          {
            role: 'togglefullscreen',
            label: localize('Toggle Full Screen'),
            accelerator: process.platform === 'darwin' ? 'Control+Command+F' : 'Control+Shift+F11',
          },
        ],
      },
    ] as Electron.MenuItemConstructorOptions[]),
  );
}
app.whenReady().then(async () => {
  installApplicationMenu();
  const icon = nativeImage.createFromPath(iconPath);
  if (process.platform === 'darwin' && !icon.isEmpty()) app.dock?.setIcon(icon);
  win = new BrowserWindow({
    width: 1440,
    height: 950,
    minWidth: 640,
    minHeight: 380,
    title: 'LabPad',
    icon,
    backgroundColor: '#0c111b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (process.platform !== 'darwin') {
    win.setAutoHideMenuBar(false);
    win.setMenuBarVisibility(false);
  }
  win.webContents.on('before-input-event', (event, input) => {
    if (
      (process.platform === 'darwin' ? input.meta : input.control) &&
      !input.alt &&
      input.type === 'keyDown' &&
      (input.key === '0' || input.code === 'Digit0')
    ) {
      event.preventDefault();
      win.webContents.setZoomFactor(1);
      if (config) {
        config = { ...config, zoomFactor: 1 };
        void storage.saveConfig(config);
        send('zoom:changed', 1);
      }
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  try {
    await initialize();
  } catch (e) {
    dialog.showErrorBox(
      localize('Cannot Open the LabPad Data Folder'),
      storage.root + '\n\n' + String(e),
    );
    await compiler.dispose();
    await formatter.dispose();
    win.destroy();
    app.quit();
    return;
  }
  win.on('close', (event) => {
    if (closing) return;
    event.preventDefault();
    closing = true;
    void (async () => {
      try {
        if (documentDirty && currentDocument) {
          const choice = config.saveMode === 'auto' ? 'save' : await confirmUnsaved();
          if (choice === 'cancel') {
            closing = false;
            return;
          }
          if (choice === 'save') {
            const edits = pendingEdits ? structuredClone(pendingEdits) : undefined;
            for (const buffer of openBuffers)
              if (!edits || edits.dirtyDocuments.includes(buffer.documentId ?? ''))
                await persist(buffer);
            if (edits?.rules) {
              const { problem, expected } = edits.rules;
              if (await storage.workspace.isProject(problem.labId))
                await storage.workspace.update(problem.labId, { tests: problem });
              else await storage.saveProblem(problem, expected);
            }
          }
        }
        await stopWarmup();
        await stop();
        await saves;
        if (initialized) await storage.flush();
        await compiledProgram.clear();
        await compiler.dispose();
        await formatter.dispose();
        shortcutWindow?.destroy();
        win.destroy();
        app.quit();
      } catch (e) {
        closing = false;
        dialog.showErrorBox(localize('Not Saved'), String(e));
      }
    })();
  });
  if (process.env.VITE_DEV_SERVER_URL) await win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else await win.loadFile(path.join(__dirname, '../renderer/index.html'));
  scheduleWarmup();
});
app.on('window-all-closed', () => app.quit());
