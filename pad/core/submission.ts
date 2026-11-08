import { t as localize, UIError } from '../shared/i18n';
import { buildOptionsSignature } from './build/plan';
import { ConfigError } from '../shared/lpmake';
import { workspacePath, workspacePackage } from '../shared/workspace';
import { rulesOf } from '../shared/test-import';
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import { defaultSource } from '../shared/defaults';
import { filePart, validateDraft } from '../shared/validate';
import { Storage, exportName } from './storage';
import type {
  CompilerConfig,
  Config,
  Draft,
  JudgeResult,
  Language,
  ExportPreview,
  ExportProblem,
  Coverage,
} from '../shared/types';
import type { CheckRecord } from '../shared/project-format';
export type Submission = ExportPreview;
export interface SubmissionServices {
  resolve?(draft: Draft): Promise<{ draft: Draft; compiler: CompilerConfig; identity: string }>;
  identity(language: Language): Promise<string>;
  format(source: string, language: Language): Promise<string>;
}
export function fingerprint(draft: Draft, compiler: CompilerConfig, identity: string) {
  const p = draft.problem,
    options = buildOptionsSignature(draft, compiler),
    snapshot = draft.workspace ?? draft.sourceFiles,
    files = snapshot
      ? Object.fromEntries(
          Object.entries(snapshot.files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : undefined;
  return createHash('sha256')
    .update(
      JSON.stringify([
        draft.workspace ? 'workspace' : draft.language,
        snapshot
          ? [
              files,
              Object.entries(snapshot.binaryFiles ?? {}).sort(([a], [b]) =>
                a < b ? -1 : a > b ? 1 : 0,
              ),
            ]
          : draft.source.replace(/^\uFEFF/, ''),
        p.labId,
        p.problemId,
        p.timeLimitMs,
        p.outputLimitBytes,
        p.comparison,
        p.testCases.map((t) => [t.id, t.input, t.expectedOutput, t.comparison ?? p.comparison]),
        options,
        identity,
      ]),
    )
    .digest('hex');
}
export function compilationFingerprint(draft: Draft, compiler: CompilerConfig, identity: string) {
  const d = {
    ...draft,
    problem: {
      ...draft.problem,
      timeLimitMs: 1,
      outputLimitBytes: 1,
      comparison: { type: 'wcmp' as const },
      testCases: [],
    },
  };
  return createHash('sha256')
    .update(fingerprint(d, compiler, identity))
    .update(draft.workspace ? '' : (draft.documentId ?? ''))
    .digest('hex');
}
export function checkRecord(
  draft: Draft,
  hash: string,
  result?: JudgeResult,
  previous?: CheckRecord,
): CheckRecord {
  const total = draft.problem.testCases.length,
    selected = new Set(result?.selectedCaseIds ?? draft.problem.testCases.map((t) => t.id));
  const old = previous?.fingerprint === hash ? (previous.cases ?? []) : [];
  const cases = result
    ? [
        ...old.filter((c) => !selected.has(c.id)),
        ...(result.compilation?.status === 'success' ? result.cases : []),
      ]
    : old;
  const ordered = draft.problem.testCases.flatMap((t) => cases.filter((c) => c.id === t.id));
  const passed = ordered.filter((c) => c.status === 'completed' && c.verdict === 'AC').length;
  const status: CheckRecord['status'] = !result
    ? 'running'
    : result.status === 'error'
      ? 'error'
      : result.status === 'cancelled'
        ? 'cancelled'
        : total > 0 &&
            result.compilation?.status === 'success' &&
            ordered.length === total &&
            passed === total
          ? 'passed'
          : 'failed';
  return {
    fingerprint: hash,
    passed,
    total,
    status,
    checkedAt: new Date().toISOString(),
    compilationStatus: result?.compilation?.status,
    cases: ordered,
  };
}
export async function storedCheck(storage: Storage, draft: Draft) {
  if (draft.workspace) return (await storage.workspace.read(draft.problem.labId)).check;
  const state = await storage.projectState(
    draft.problem.labId,
    draft.problem.problemId,
    draft.language,
  );
  return draft.documentId
    ? state.documents?.find((v) => v.id === draft.documentId)?.check
    : state.checks[draft.language];
}
export async function coverage(
  storage: Storage,
  draft: Draft,
  config: Config,
  identity: string,
): Promise<Coverage> {
  const record = await storedCheck(storage, draft),
    total = draft.problem.testCases.length;
  if (!total || !record) return { state: '未测', cases: [] };
  if (record.fingerprint !== fingerprint(draft, config.compiler, identity))
    return { state: '需重测', cases: [] };
  if (record.compilationStatus === 'CE') return { state: '未通过', cases: record.cases ?? [] };
  if (record.status === 'running') return { state: '运行中', cases: record.cases ?? [] };
  if (record.status === 'passed' && record.passed === total && record.cases?.length === total)
    return { state: '通过', cases: record.cases };
  const cases = record.cases ?? [];
  return {
    state:
      cases.some((c) => c.verdict && c.verdict !== 'AC') || record.status === 'error'
        ? '未通过'
        : cases.length < total
          ? '部分已测'
          : '未通过',
    cases,
  };
}
export function identityWarning(config: Config) {
  const missing = [
    [localize('Class'), config.classId],
    [localize('Name'), config.name],
    [localize('Student ID'), config.studentId],
  ]
    .filter(([, value]) => !value.trim())
    .map(([label]) => label);
  return missing.length ? localize('Missing personal information: {0}.', missing.join('、')) : '';
}
export function submissionFolder(config: Config, labId: string) {
  const values = [
    config.classId.trim() || localize('Class Not Set'),
    config.name.trim() || localize('Name Not Set'),
    config.studentId.trim() || localize('Student ID Not Set'),
    labId,
  ];
  values.forEach((value, i) =>
    filePart(
      value,
      [localize('Class'), localize('Name'), localize('Student ID'), localize('Experiment Name')][i],
    ),
  );
  return values.join('_');
}
async function testStatus(storage: Storage, draft: Draft, config: Config, identity: string) {
  if (!draft.problem.testCases.length) return localize('No Test Cases');
  const record = await storedCheck(storage, draft);
  if (!record) return localize('Not Yet Tested');
  if (record.fingerprint !== fingerprint(draft, config.compiler, identity))
    return localize('The source or compiler changed; run the tests again');
  if (
    record.status === 'passed' &&
    record.total === draft.problem.testCases.length &&
    record.passed === record.total
  )
    return '';
  if (record.status === 'running' || record.status === 'cancelled')
    return localize('Testing Incomplete');
  if (record.status === 'error') return localize('Test Execution Failed');
  return localize('{0}/{1} test cases passed', record.passed, record.total);
}
export async function prepareSource(
  storage: Storage,
  value: Draft,
  config: Config,
  services: SubmissionServices,
): Promise<Submission> {
  const draft = structuredClone(validateDraft(value)),
    context = await services.resolve?.(draft),
    warnings: string[] = [],
    status = await testStatus(
      storage,
      context?.draft ?? draft,
      context ? { ...config, compiler: context.compiler } : config,
      context?.identity ?? (await services.identity(draft.language)),
    );
  if (status)
    warnings.push(
      localize('Not all tests passed: {0} ({1}).', draft.problem.problemId || '空项目', status),
    );
  const missing = identityWarning(config);
  if (missing) warnings.push(missing);
  return {
    kind: 'source',
    name: exportName(draft, config.studentId),
    labId: draft.problem.labId,
    files: [{ name: exportName(draft, config.studentId), source: draft.source }],
    warnings,
  };
}
export async function exportChoices(
  storage: Storage,
  current: Draft,
  buffers: Draft[],
): Promise<ExportProblem[]> {
  const labId = filePart(current.problem.labId, localize('Experiment')),
    project = (await storage.projects()).find((p) => p.labId === labId);
  if (!project?.problems.length)
    throw new UIError('This experiment has no problems. Create or import a problem first.');
  const overlays = new Map(
    buffers.filter((d) => d.problem.labId === labId).map((d) => [d.documentId, d]),
  );
  return Promise.all(
    project.problems.map(async (problemId) => ({
      problemId,
      versions: (await storage.allDocuments(labId, problemId, 'c')).map((d) => ({
        ...d,
        ...(overlays.get(d.documentId) ?? {}),
        modifiedAt: d.modifiedAt,
      })),
    })),
  );
}
export async function prepareProject(
  storage: Storage,
  value: Draft,
  config: Config,
  services: SubmissionServices,
  chosen?: Draft[],
  includeConfig = false,
): Promise<Submission> {
  const current = structuredClone(validateDraft(value)),
    labId = filePart(current.problem.labId, localize('Experiment'));
  let drafts: Draft[];
  if (chosen) drafts = chosen.map((d) => structuredClone(validateDraft(d)));
  else {
    const project = (await storage.projects()).find((lab) => lab.labId === labId),
      ids = [...(project?.problems ?? [])];
    if (current.problem.problemId && !ids.includes(current.problem.problemId))
      ids.push(current.problem.problemId);
    drafts = [];
    for (const id of ids) {
      if (id !== current.problem.problemId) await storage.openDocuments(labId, id, 'c');
      drafts.push(
        id === current.problem.problemId ? current : await storage.load(labId, id, 'c', true),
      );
    }
  }
  if (!drafts.length) throw new UIError('Select at least one source file');
  const known = (await storage.projects()).find((p) => p.labId === labId)?.problems ?? [];
  const unique = new Set<string>();
  for (const d of drafts) {
    if (d.problem.labId !== labId || !d.problem.problemId || !known.includes(d.problem.problemId))
      throw new UIError('The selected source files do not belong to the current experiment');
    const key = d.documentId ?? d.problem.problemId + ':' + d.language;
    if (unique.has(key)) throw new UIError('A source version cannot be exported twice');
    unique.add(key);
  }
  const templates: Record<string, import('../shared/templates').SourceTemplates> = {},
    mapping: Record<string, { file: string; language: Language }[]> = {};
  const files: Submission['files'] = [],
    unedited: string[] = [],
    unpassed: string[] = [],
    warnings: string[] = [],
    counts = new Map<string, number>(),
    names = new Set<string>();
  const identities = new Map<Language, string>();
  for (const draft of drafts) {
    const id = draft.problem.problemId,
      state = await storage.projectState(labId, id, draft.language),
      version = state.documents?.find((v) => v.id === draft.documentId),
      starter = version?.starter ?? state.starters[draft.language] ?? defaultSource(draft.language);
    templates[id] = state.starters;
    const multi = drafts.filter((d) => d.problem.problemId === id).length > 1,
      label = multi ? id + ' / ' + (version?.file ?? draft.documentId) : id;
    let same = draft.source.replace(/\r\n/g, '\n').trim() === starter.replace(/\r\n/g, '\n').trim();
    if (!same) {
      try {
        same =
          (await services.format(draft.source, draft.language)).trim() ===
          (await services.format(starter, draft.language)).trim();
      } catch {}
    }
    if (same || !draft.source.trim()) unedited.push(label);
    if (!identities.has(draft.language))
      identities.set(draft.language, await services.identity(draft.language));
    const context = await services.resolve?.(draft),
      status = await testStatus(
        storage,
        context?.draft ?? draft,
        context ? { ...config, compiler: context.compiler } : config,
        context?.identity ?? identities.get(draft.language)!,
      );
    if (status) unpassed.push(label + '（' + status + '）');
    const n = (counts.get(id) ?? 0) + 1;
    counts.set(id, n);
    const name = exportName(draft, config.studentId).replace(
        /\.(c|cpp)$/,
        (ext) => (n > 1 ? '_v' + n : '') + ext,
      ),
      key = name.normalize('NFC').toLowerCase();
    if (names.has(key))
      throw new UIError(
        'Export filename conflict: {0}. Change the problem ID or selected versions.',
        name,
      );
    names.add(key);
    files.push({ name, source: draft.source });
    (mapping[id] ??= []).push({ file: name, language: draft.language });
  }
  if (unedited.length)
    warnings.unshift(localize('Source files have not been edited: {0}.', unedited.join('、')));
  if (unpassed.length) warnings.push(localize('Not all tests passed: {0}.', unpassed.join('、')));
  if (!current.problem.problemId)
    warnings.push(
      localize(
        'The current source has no problem ID and is not included in the experiment export.',
      ),
    );
  const missing = identityWarning(config);
  if (missing) warnings.push(missing);
  if (includeConfig) {
    const ids = [...new Set(drafts.map((d) => d.problem.problemId))];
    files.push({
      name: 'labpad.project.json',
      source:
        JSON.stringify(
          {
            schemaVersion: 2,
            kind: 'labpad.project',
            mode: 'problem-set',
            labId,
            buildOptions: await storage.buildOptions(labId),
            problems: ids.map((id) => {
              const d = drafts.find((d) => d.problem.problemId === id)!;
              return {
                problemId: id,
                title: d.problem.title,
                language: d.language,
                templates: templates[id],
                ...rulesOf(d.problem),
                sourceFile: mapping[id][0].file,
                versions: mapping[id],
              };
            }),
          },
          null,
          2,
        ) + '\n',
    });
  }
  return {
    kind: 'project',
    name: submissionFolder(config, labId) + '.zip',
    labId,
    files,
    warnings,
  };
}
export function submissionZip(submission: Submission): Uint8Array {
  const folder = submission.name.replace(/\.zip$/i, ''),
    files: Record<string, Uint8Array> = {};
  filePart(folder, localize('Submission Folder'));
  for (const file of submission.files) {
    if (file.name !== 'labpad.project.json') workspacePath(file.name);
    const name = folder + '/' + file.name;
    if (Object.hasOwn(files, name)) throw new UIError('Duplicate export file: {0}', file.name);
    files[name] =
      file.encoding === 'base64'
        ? Buffer.from(file.source, 'base64')
        : strToU8(file.source.replace(/^\uFEFF/, ''));
  }
  return zipSync(files, { level: 6 });
}

export async function prepareWorkspaceProject(
  storage: Storage,
  current: Draft,
  config: Config,
  buffers: Draft[],
  includeConfig = true,
  services?: SubmissionServices,
): Promise<Submission> {
  const labId = filePart(current.problem.labId, localize('Experiment Name')),
    snapshot = await storage.workspace.snapshot(labId, buffers),
    missing = identityWarning(config),
    warnings: string[] = [];
  const state = await storage.workspace.read(labId),
    record = state.check;
  if (state.starters) {
    const sources = Object.keys(snapshot.files).filter((f) =>
      /\.(c|cpp|cc|cxx|h|hpp|hh|hxx)$/i.test(f),
    );
    let unchanged = sources.length === Object.keys(state.starters).length;
    for (const name of sources) {
      const original = state.starters[name];
      if (original === undefined) {
        unchanged = false;
        break;
      }
      let left = snapshot.files[name],
        right = original;
      if (services && left.trim() !== right.trim())
        try {
          const language = /\.(cpp|cc|cxx|hpp|hh|hxx)$/i.test(name) ? 'cpp' : 'c';
          left = await services.format(left, language);
          right = await services.format(right, language);
        } catch {}
      if (left.replace(/\r\n/g, '\n').trim() !== right.replace(/\r\n/g, '\n').trim()) {
        unchanged = false;
        break;
      }
    }
    if (unchanged)
      warnings.push(localize('Project source files have not been edited: {0}.', labId));
  }
  if (!current.problem.testCases.length || !record || record.status !== 'passed')
    warnings.push(
      localize('Not all tests passed: {0}. Run the tests again before exporting.', labId),
    );
  if (missing) warnings.push(missing);
  const files: Submission['files'] = [
    ...Object.entries(snapshot.files).map(([name, source]) => ({ name, source })),
    ...Object.entries(snapshot.binaryFiles ?? {}).map(([name, source]) => ({
      name,
      source,
      encoding: 'base64' as const,
    })),
  ];
  if (!files.some((f) => f.name === 'LPMake.txt'))
    throw new ConfigError(
      '',
      0,
      'The project is missing LPMake.txt.',
      'Include LPMake.txt in the project root.',
    );
  if (includeConfig) {
    const pkg: any = workspacePackage(labId, snapshot, current.problem, state.templates);
    pkg.files = pkg.files.map((f: any) => ({ path: f.path }));
    files.push({ name: 'labpad.project.json', source: JSON.stringify(pkg, null, 2) + '\n' });
  }
  return {
    kind: 'project',
    labId,
    name: submissionFolder(config, labId) + '.zip',
    files,
    warnings,
  };
}
