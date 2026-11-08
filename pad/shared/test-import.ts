import { t as localize, UIError } from './i18n';
import { defaultProblem } from './defaults';
import { filePart, validateProblem } from './validate';
import type { Problem, TestCase } from './types';
export type ProjectMode = 'problem-set' | 'project';
export type TestPatch = Partial<
  Pick<Problem, 'comparison' | 'timeLimitMs' | 'outputLimitBytes' | 'testCases'>
>;
export interface ProjectTests {
  schemaVersion: 2;
  kind: 'labpad.projectTests';
  mode: ProjectMode;
  labId: string;
  problems?: { problemId: string; rules: TestPatch }[];
  tests?: TestPatch;
}
const fields = ['comparison', 'timeLimitMs', 'outputLimitBytes', 'testCases'] as const;
export function testPatch(value: unknown, lab = '', problem = ''): TestPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new UIError('Invalid test rule format');
  const p = value as Record<string, unknown>,
    patch: Record<string, unknown> = {};
  for (const key of fields)
    if (Object.hasOwn(p, key)) {
      if (p[key] === undefined) throw new UIError('{0} must not be empty', key);
      patch[key] = p[key];
    }
  validateProblem({ ...defaultProblem(lab, problem), ...patch });
  return structuredClone(patch) as TestPatch;
}
export function parseIOPatch(value: unknown, current: Problem): TestPatch {
  const p = value as any;
  if (p?.kind === 'labpad.project' || p?.kind === 'labpad.projectTests')
    throw new UIError('This is an experiment file. Choose Import → Import Experiment.');
  if (!p || p.schemaVersion !== 1 || (p.kind !== undefined && p.kind !== 'labpad.testCases'))
    throw new UIError('Choose a test case JSON file (kind: labpad.testCases, schemaVersion: 1)');
  if (p.labId !== undefined && p.labId !== current.labId)
    throw new UIError(
      'Experiment name mismatch: the current experiment is “{0}”, but the file specifies “{1}”.',
      current.labId,
      p.labId,
    );
  if (p.problemId !== undefined && p.problemId !== current.problemId)
    throw new UIError(
      'Problem ID mismatch: the current problem is “{0}”, but the file specifies “{1}”.',
      current.problemId,
      p.problemId,
    );
  const patch = testPatch(p, current.labId, current.problemId);
  if (!patch.testCases) throw new UIError('The test case file is missing testCases');
  return patch;
}
export function parseProjectTests(value: unknown): ProjectTests {
  const p = value as any;
  if (
    !p ||
    !['labpad.project', 'labpad.projectTests'].includes(p.kind) ||
    ![1, 2].includes(p.schemaVersion)
  )
    throw new UIError('Choose an experiment or experiment test case JSON file');
  const labId = filePart(p.labId, localize('Experiment Name')),
    mode: ProjectMode = p.mode ?? 'problem-set';
  if (
    !['problem-set', 'project'].includes(mode) ||
    (p.schemaVersion === 1 && mode !== 'problem-set')
  )
    throw new UIError('Invalid experiment mode');
  if (mode === 'project')
    return {
      schemaVersion: 2,
      kind: 'labpad.projectTests',
      mode,
      labId,
      tests: testPatch(p.tests, labId, ''),
    };
  if (!Array.isArray(p.problems) || !p.problems.length)
    throw new UIError('Experiment test cases must include at least one problem');
  const seen = new Set<string>();
  return {
    schemaVersion: 2,
    kind: 'labpad.projectTests',
    mode,
    labId,
    problems: p.problems.map((item: any) => {
      const problemId = filePart(item?.problemId, localize('Problem')),
        key = problemId.normalize('NFC').toLowerCase();
      if (seen.has(key)) throw new UIError('Duplicate problem ID: {0}', problemId);
      seen.add(key);
      return { problemId, rules: testPatch(item, labId, problemId) };
    }),
  };
}
export function mergeTests(
  current: Problem,
  patch: TestPatch,
  mode: 'replace' | 'append',
  adoptLimits = false,
) {
  const renamed: { from: string; to: string }[] = [];
  let problem: Problem;
  if (mode === 'replace')
    problem = validateProblem({ ...structuredClone(current), ...structuredClone(patch) });
  else {
    const ids = new Set(current.testCases.map((t) => t.id)),
      incoming: TestCase[] = (patch.testCases ?? []).map((t) => {
        const next = structuredClone(t),
          base = t.id;
        let n = 2;
        while (ids.has(next.id)) next.id = base + '-' + n++;
        if (next.id !== base) renamed.push({ from: base, to: next.id });
        ids.add(next.id);
        next.comparison ??= structuredClone(patch.comparison ?? current.comparison);
        return next;
      });
    problem = validateProblem({
      ...structuredClone(current),
      ...(adoptLimits && patch.timeLimitMs !== undefined ? { timeLimitMs: patch.timeLimitMs } : {}),
      ...(adoptLimits && patch.outputLimitBytes !== undefined
        ? { outputLimitBytes: patch.outputLimitBytes }
        : {}),
      testCases: [...structuredClone(current.testCases), ...incoming],
    });
  }
  return { problem: structuredClone(problem), renamed };
}
export function exportIO(problem: Problem) {
  return {
    schemaVersion: 1,
    kind: 'labpad.testCases',
    labId: problem.labId,
    problemId: problem.problemId,
    ...rulesOf(problem),
  };
}
export function rulesOf(p: Problem) {
  return structuredClone({
    comparison: p.comparison,
    timeLimitMs: p.timeLimitMs,
    outputLimitBytes: p.outputLimitBytes,
    testCases: p.testCases,
  });
}
export function exportProjectTests(labId: string, problems: Problem[]): unknown {
  return {
    schemaVersion: 2,
    kind: 'labpad.projectTests',
    mode: 'problem-set',
    labId,
    problems: problems.map((p) => ({ problemId: p.problemId, ...rulesOf(p) })),
  };
}
