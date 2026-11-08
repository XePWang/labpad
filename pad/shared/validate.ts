import { UIError, t as localize } from './i18n';
import { validateTypography } from './typography';
import { assertParameters } from './parameters';
import { validateComparison } from './comparison';
import { validateShortcuts } from './shortcuts';
import type { Config, Draft, Problem, LayoutConfig } from './types';
export function filePart(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    /[<>:"/\\|?*\x00-\x1f]/.test(value) ||
    /[. ]$/.test(value) ||
    value === '.' ||
    value === '..' ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(value)
  )
    throw new UIError(
      '{0} must not be empty or contain paths or invalid filename characters',
      label,
    );
  return value;
}
export function selection(lab: unknown, problem: unknown) {
  if (typeof lab !== 'string' || typeof problem !== 'string')
    throw new UIError('Invalid experiment or problem ID');
  if (lab) filePart(lab, localize('Experiment Name'));
  if (problem) {
    if (!lab) throw new UIError('Select an experiment first');
    filePart(problem, localize('Problem'));
  }
}
export function validateProblem(value: unknown): Problem {
  const p = value as Problem;
  if (!p || p.schemaVersion !== 1) throw new UIError('Problem schemaVersion must be 1');
  selection(p.labId, p.problemId);
  if (typeof p.title !== 'string') throw new UIError('Problem title must be a string');
  if (
    !Number.isSafeInteger(p.timeLimitMs) ||
    p.timeLimitMs <= 0 ||
    !Number.isSafeInteger(p.outputLimitBytes) ||
    p.outputLimitBytes <= 0
  )
    throw new UIError('timeLimitMs and outputLimitBytes must be positive integers');
  validateComparison(p.comparison, localize('Problem Comparison Rules'));
  if (!Array.isArray(p.testCases)) throw new UIError('testCases must be an array');
  const ids = new Set<string>();
  for (const t of p.testCases) {
    if (
      !t ||
      typeof t.id !== 'string' ||
      !t.id ||
      ids.has(t.id) ||
      typeof t.input !== 'string' ||
      typeof t.expectedOutput !== 'string'
    )
      throw new UIError(
        'Each test case needs a unique id and string input and expectedOutput fields',
      );
    if (t.comparison !== undefined)
      validateComparison(t.comparison, localize('Comparison rules for Test Case {0}', t.id));
    ids.add(t.id);
  }
  return p;
}
export function validateDraft(value: unknown): Draft {
  const d = value as Draft;
  if (!d || typeof d.source !== 'string' || !['c', 'cpp'].includes(d.language))
    throw new UIError('Invalid source data');
  if (d.target !== undefined) {
    const target = d.target;
    if (
      !target ||
      !['problem-set', 'project'].includes(target.mode) ||
      target.labId !== d.problem.labId ||
      (target.mode === 'problem-set' &&
        (target.problemId !== d.problem.problemId ||
          typeof target.documentId !== 'string' ||
          !target.documentId))
    )
      throw new UIError(
        'The compile target does not match the current experiment or problem. Select the source file again.',
      );
  }
  validateProblem(d.problem);
  return d;
}
export function validateLayout(value: unknown): LayoutConfig {
  const l = value as LayoutConfig;
  if (
    !l ||
    !Number.isFinite(l.editorPercent) ||
    l.editorPercent < 20 ||
    l.editorPercent > 80 ||
    !Number.isFinite(l.outputPercent) ||
    l.outputPercent < 12 ||
    l.outputPercent > 65
  )
    throw new UIError('Layout proportions are outside the supported range');
  return { editorPercent: l.editorPercent, outputPercent: l.outputPercent };
}
export function validateConfig(value: unknown): Config {
  const c = value as Config;
  if (
    !c ||
    c.schemaVersion !== 1 ||
    !['classId', 'name', 'studentId'].every((k) => typeof (c as any)[k] === 'string')
  )
    throw new UIError('Invalid personal settings format');
  if (c.uiLanguage !== undefined && !['zh-CN', 'en-US'].includes(c.uiLanguage))
    throw new UIError('Invalid interface language');
  selection(c.currentLab, c.currentProblem);
  if (
    !['manual', 'auto'].includes(c.saveMode) ||
    !(c.sourceFile === null || typeof c.sourceFile === 'string')
  )
    throw new UIError('Invalid save settings');
  if (!['c', 'cpp'].includes(c.language)) throw new UIError('Invalid source language');
  if (
    ![1, 2, 4].includes(c.indentSize) ||
    !['light', 'dark'].includes(c.theme) ||
    typeof c.formatOnSave !== 'boolean' ||
    (c.completionEnabled !== undefined && typeof c.completionEnabled !== 'boolean')
  )
    throw new UIError('Invalid editor settings');
  validateLayout(c.layout);
  validateShortcuts(c.shortcuts);
  if (!Number.isFinite(c.zoomFactor) || c.zoomFactor < 0.25 || c.zoomFactor > 4)
    throw new UIError('Interface zoom must be between 25% and 400%');
  if (c.typography !== undefined) validateTypography(c.typography);
  const b = c.compiler;
  if (
    !b ||
    !['builtin', 'custom'].includes(b.mode) ||
    !['zig', 'gcc', 'clang'].includes(b.kind) ||
    typeof b.cPath !== 'string' ||
    typeof b.cppPath !== 'string' ||
    ![b.cArgs, b.cppArgs, b.linkArgs].every(
      (a) => Array.isArray(a) && a.every((s) => typeof s === 'string'),
    )
  )
    throw new UIError('Invalid compiler settings. Enter one argument per line.');
  for (const [label, args] of [
    [localize('C Arguments'), b.cArgs],
    [localize('C++ Arguments'), b.cppArgs],
    [localize('Linker Arguments'), b.linkArgs],
  ] as const)
    assertParameters(args, label);
  if (
    c.debugTimeLimitMs !== null &&
    (!Number.isSafeInteger(c.debugTimeLimitMs) || c.debugTimeLimitMs <= 0)
  )
    throw new UIError(
      'Leave the debug time limit blank or enter a positive integer in milliseconds',
    );
  if (
    !Number.isSafeInteger(c.terminalBufferLines) ||
    c.terminalBufferLines < 100 ||
    c.terminalBufferLines > 100000
  )
    throw new UIError('Terminal scrollback must be between 100 and 100,000 lines');
  if (
    !Number.isSafeInteger(c.terminalHistoryBytes) ||
    c.terminalHistoryBytes < 1024 ||
    c.terminalHistoryBytes > 1048576
  )
    throw new UIError('Input history must be between 1,024 and 1,048,576 bytes');
  return c;
}
