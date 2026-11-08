import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { operationError } from '../shared/errors';
import type { Bridge } from '../shared/types';
function listen(channel: string, callback: (value: any) => void) {
  const handler = (_event: unknown, value: unknown) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
async function invoke(channel: string, ...args: unknown[]) {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (e) {
    throw new Error(operationError(e));
  }
}
const api: Bridge = {
  terminalContext: (d) => invoke('terminal:context', d),
  terminalCommand: (d, t) => invoke('terminal:command', d, t),
  terminalComplete: (t, c) => invoke('terminal:complete', t, c),
  nativeStart: (d, b) => invoke('native:start', d, b),
  nativeControl: (a) => invoke('native:control', a),
  nativeStop: () => invoke('native:stop'),
  nativeFrame: (id) => invoke('native:frame', id),
  nativeVariables: (r, s, c) => invoke('native:variables', r, s, c),
  nativeWatch: (e, c) => invoke('native:watch', e, c),
  nativeBreakpoints: (v) => invoke('native:breakpoints', v),
  nativeView: (l, v) => invoke('native:view', l, v),
  onNativeState: (c) => listen('native:state', c),
  onNativeDiagnostic: (c) => listen('native:diagnostic', c),

  fileContext: (l, p, f, a) => invoke('files:context', l, p, f, a),
  confirmExternal: (f) => invoke('files:external', f),
  completionFiles: (l, p) => invoke('completion:files', l, p),
  droppedFilePath: (file) => webUtils.getPathForFile(file),
  fileView: (lab, value) => invoke('files:view', lab, value),
  fileOperation: (l, p, r) => invoke('files:operate', l, p, r),
  onFiles: (c) => listen('files:changed', c),
  compile: (d) => invoke('compile', d),
  compileState: (d) => invoke('compile:state', d),
  confirmCompile: () => invoke('compile:confirm'),
  confirmRestart: () => invoke('native:confirm-restart'),
  buildPreview: (d, o, m) => invoke('build:preview', d, o, m),
  resetZoom: () => invoke('zoom:reset'),
  onZoom: (c) => listen('zoom:changed', c),
  workspaceSources: (l, s) => invoke('workspace:sources', l, s),
  workspaceFiles: (l, p) => invoke('workspace:files', l, p),
  workspaceOpen: (l, f, p) => invoke('workspace:open', l, f, p),

  workspaceView: (l, v) => invoke('workspace:view', l, v),
  projectBuildOptions: (l) => invoke('project:build:get', l),
  saveProjectBuildOptions: (l, v) => invoke('project:build:save', l, v),
  deleteProject: (l) => invoke('project:delete', l),

  copyText: (text) => invoke('clipboard:write', text),
  recentSource: (a, b, c) => invoke('source:recent', a, b, c),
  exportChoices: (d) => invoke('export:choices', d),
  exportPreview: (k, d, c) => invoke('export:preview', k, d, c),
  writeExport: (p) => invoke('export:write', p),
  checkState: (d) => invoke('check:state', d),
  problemStates: (d, b) => invoke('check:problems', d, b),
  openDocuments: (a, b, c) => invoke('documents:open', a, b, c),
  activateDocument: (id, file) => invoke('document:activate', id, file),
  newVersion: (d, t) => invoke('source:version', d, t),
  copyPath: (v, r) => invoke('path:copy', v, r),
  workspaceState: (d, s, edits) => ipcRenderer.send('workspace:state', d, s, edits),
  openShortcuts: () => invoke('shortcuts:open'),
  shortcutSettings: () => invoke('shortcuts:get'),
  saveShortcuts: (v) => invoke('shortcuts:save', v),
  onShortcuts: (c) => listen('shortcuts:changed', c),
  clearCache: () => invoke('cache:clear'),
  saveProblem: (p, expected) => invoke('problem:save', p, expected),
  bootstrap: () => invoke('bootstrap'),
  reloadDocument: () => invoke('draft:reload'),
  saveDraft: (d) => invoke('draft:save', d),
  formatCode: (s, l, i) => invoke('source:format', s, l, i),
  documentState: (d, s) => ipcRenderer.send('document:state', d, s),
  loadDraft: (a, b, c, p = true) => invoke('draft:load', a, b, c, p),
  projects: () => invoke('projects'),
  createLab: (n, m) => invoke('project:create', n, m),
  createProblem: (a, b, c) => invoke('problem:create', a, b, c),
  saveConfig: (c, p, b) => invoke('config:save', c, p, b),
  compilerInfo: (c) => invoke('compiler:info', c),
  detectCompilers: () => invoke('compiler:detect'),
  saveLayout: (l) => invoke('layout:save', l),
  importSource: (destination) => invoke('source:import', destination),
  confirmUnsaved: () => invoke('document:confirm'),
  validatePath: (p, k, e) => invoke('path:validate', p, k, e),
  choosePath: (k, p) => invoke('path:choose', k, p),
  revealPath: (p, k) => invoke('path:reveal', p, k),
  revealSource: (file) => invoke('path:show-file', file),
  importIO: (a, b) => invoke('problem:import', a, b),
  importProject: () => invoke('project:import'),
  exportTests: (k, p) => invoke('tests:export', k, p),
  showProblemFile: (d) => invoke('problem:show', d),
  judge: (d, ids) => invoke('judge', d, ids),
  cancel: () => invoke('cancel'),
  debugStart: (d) => invoke('debug:start', d),
  debugInput: (d) => ipcRenderer.send('debug:input', d),
  debugResize: (c, r) => ipcRenderer.send('debug:resize', c, r),
  debugStop: () => invoke('debug:stop'),
  onJudge: (c) => listen('judge:event', c),
  onDebugData: (c) =>
    listen('debug:data', (packet) =>
      c(packet.data, () => ipcRenderer.send('debug:ack', packet.session, packet.data.length)),
    ),
  onDebugState: (c) => listen('debug:state', c),
};
contextBridge.exposeInMainWorld('labpad', api);
