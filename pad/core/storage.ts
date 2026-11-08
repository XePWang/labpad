import { isSourceFile, sourceLanguage, editorLanguage } from '../shared/file-language';
import { defaultTypography } from '../shared/typography';
import { directorySnapshot, managedBuild } from './workspace-files';
import { FileService, under, type FileRequest, type FileChange } from './files';
import { workspacePath } from '../shared/workspace';
import { WorkspaceStore } from './workspace';
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  access,
  readdir,
  cp,
  stat,
  mkdtemp,
  rm,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import iconv from 'iconv-lite';
import writeFileAtomic from 'write-file-atomic';
import { migrateShortcuts } from '../shared/shortcuts';
import { defaultConfig, defaultProblem, defaultSource } from '../shared/defaults';
import {
  filePart,
  selection,
  validateConfig,
  validateDraft,
  validateProblem,
} from '../shared/validate';
import { parseLabPackage, labDraft } from '../shared/project-format';
import type { CheckRecord, LabState, ProblemState, SourceDocument } from '../shared/project-format';
import type { Config, Draft, LoadedDraft, Language, Problem, Project } from '../shared/types';
export function decodeText(bytes: Buffer): { text: string; encoding: string } {
  if (
    bytes.length >= 2 &&
    ((bytes[0] === 255 && bytes[1] === 254) || (bytes[0] === 254 && bytes[1] === 255))
  ) {
    const encoding = bytes[0] === 255 ? 'UTF-16 LE' : 'UTF-16 BE';
    if (bytes.length % 2) throw new Error('UTF-16 源文件不完整');
    return {
      text: new TextDecoder(encoding === 'UTF-16 LE' ? 'utf-16le' : 'utf-16be', {
        fatal: true,
      }).decode(bytes),
      encoding,
    };
  }
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      encoding: bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])) ? 'UTF-8 BOM' : 'UTF-8',
    };
  } catch {
    const text = iconv.decode(bytes, 'cp936');
    if (!iconv.encode(text, 'cp936').equals(bytes))
      throw new Error('无法完整识别文件编码，请先将文件另存为 UTF-8');
    return { text, encoding: 'GBK / CP936' };
  }
}
export function sourceBytes(source: string, encoding = 'UTF-8') {
  const text = source.replace(/^\uFEFF/, ''),
    codec =
      encoding === 'GBK / CP936'
        ? 'cp936'
        : encoding === 'UTF-16 LE'
          ? 'utf16le'
          : encoding === 'UTF-16 BE'
            ? 'utf16be'
            : 'utf8';
  let bytes = iconv.encode(text, codec);
  if (codec === 'cp936' && iconv.decode(bytes, codec) !== text)
    throw new Error('源码包含 GBK 无法保存的字符；请先将文件另存为 UTF-8');
  if (encoding === 'UTF-8 BOM') bytes = Buffer.concat([Buffer.from([239, 187, 191]), bytes]);
  if (encoding === 'UTF-16 LE') bytes = Buffer.concat([Buffer.from([255, 254]), bytes]);
  if (encoding === 'UTF-16 BE') bytes = Buffer.concat([Buffer.from([254, 255]), bytes]);
  return bytes;
}
export async function writeSource(file: string, source: string, encoding = 'UTF-8') {
  await writeFileAtomic(file, sourceBytes(source, encoding));
}
export async function readJSON(file: string): Promise<unknown> {
  return JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(await readFile(file)).replace(/^\uFEFF/, ''),
  );
}
export async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch (e: any) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
}
export function exportName(draft: Draft, studentId: string) {
  const name = draft.problem.problemId || '空项目',
    id = studentId.trim();
  filePart(name, '题号');
  if (id) filePart(id, '学号');
  return (id ? id + '_' : '') + name + (draft.language === 'c' ? '.c' : '.cpp');
}
export class Storage {
  private tail: Promise<unknown> = Promise.resolve();
  readonly workspace: WorkspaceStore;
  constructor(readonly root: string) {
    this.workspace = new WorkspaceStore(root);
  }
  private enqueue<T>(task: () => Promise<T>) {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => {});
    return next;
  }
  private async atomic(file: string, content: string) {
    await writeFileAtomic(file, content, { encoding: 'utf8' });
  }
  async init(): Promise<Config> {
    await mkdir(this.root, { recursive: true });
    await access(this.root, constants.W_OK);
    await this.migrateDraftDirectory();
    const file = path.join(this.root, 'config.json');
    if (await exists(file)) {
      const value = (await readJSON(file)) as Config;
      return validateConfig({
        ...value,
        typography: value.typography ?? defaultTypography(),
        saveMode: value.saveMode ?? 'manual',
        sourceFile: value.sourceFile ?? null,
        indentSize: value.indentSize ?? 4,
        theme: value.theme ?? 'dark',
        formatOnSave: value.formatOnSave ?? true,
        completionEnabled: value.completionEnabled ?? true,
        layout: value.layout ?? { editorPercent: 53, outputPercent: 28 },
        zoomFactor: value.zoomFactor ?? 1,
        shortcuts: migrateShortcuts(value.shortcuts),
      });
    }
    const config = defaultConfig();
    await this.saveConfig(config);
    return config;
  }
  saveConfig(config: Config) {
    const snapshot = structuredClone(validateConfig(config));
    return this.enqueue(() =>
      this.atomic(path.join(this.root, 'config.json'), JSON.stringify(snapshot, null, 2) + '\n'),
    );
  }
  async saveSettings(
    config: Config,
    project?: { lab: string; options: import('../shared/workspace').ProjectBuildOptions },
  ) {
    const snapshot = structuredClone(validateConfig(config));
    if (project) {
      filePart(project.lab, '项目名称');
      if (typeof project.options.inheritDefaults !== 'boolean') throw new Error('参数来源无效');
      validateConfig({
        ...snapshot,
        compiler: {
          ...snapshot.compiler,
          cArgs: project.options.cArgs,
          cppArgs: project.options.cppArgs,
          linkArgs: project.options.linkArgs,
        },
      });
    }
    return this.enqueue(async () => {
      const configFile = path.join(this.root, 'config.json'),
        oldConfig = await readFile(configFile).catch((e: NodeJS.ErrnoException) => {
          if (e.code !== 'ENOENT') throw e;
          return undefined;
        }),
        metaFile = project ? this.statePath(project.lab, '_') : undefined,
        oldMeta =
          metaFile &&
          (await readFile(metaFile).catch((e: NodeJS.ErrnoException) => {
            if (e.code !== 'ENOENT') throw e;
            return undefined;
          }));
      const meta = project ? await this.readState(project.lab, '_') : undefined;
      if (meta) meta.buildOptions = structuredClone(project!.options);
      try {
        await this.atomic(configFile, JSON.stringify(snapshot, null, 2) + '\n');
        if (meta) await this.writeState(project!.lab, '_', meta);
      } catch (error) {
        const restore = async (file: string, bytes: Buffer | undefined) => {
          const now = await readFile(file).catch(() => undefined);
          if (bytes) {
            if (!now?.equals(bytes)) await writeFileAtomic(file, bytes);
          } else if (now) await rm(file, { force: true });
        };
        const results = await Promise.allSettled([
          restore(configFile, oldConfig),
          ...(metaFile ? [restore(metaFile, oldMeta || undefined)] : []),
        ]);
        if (results.some((r) => r.status === 'rejected'))
          throw new AggregateError(
            [
              error,
              ...results
                .filter((r) => r.status === 'rejected')
                .map((r) => (r as PromiseRejectedResult).reason),
            ],
            '设置未保存，恢复原配置时也发生错误。',
          );
        throw error;
      }
    });
  }
  paths(labId: string, problemId: string, language: Language) {
    selection(labId, problemId);
    const dir = problemId
        ? path.join(this.root, 'projects', labId)
        : path.join(this.root, 'drafts'),
      base = problemId || '空项目';
    return {
      dir,
      source: path.join(dir, base + (language === 'c' ? '.c' : '.cpp')),
      problem: path.join(dir, base + '.json'),
    };
  }
  private statePath(labId: string, problemId: string) {
    return path.join(this.paths(labId, problemId, 'c').dir, '.labpad');
  }
  private async readState(labId: string, problemId: string): Promise<LabState> {
    if (!problemId) await this.migrateDraftDirectory();
    const file = this.statePath(labId, problemId),
      id = problemId ? labId : '';
    if (!(await exists(file))) return { schemaVersion: 1, labId: id, problems: {} };
    const value = (await readJSON(file)) as LabState;
    if (
      !value ||
      value.schemaVersion !== 1 ||
      value.labId !== id ||
      !value.problems ||
      typeof value.problems !== 'object' ||
      Array.isArray(value.problems)
    )
      throw new Error('项目状态文件格式无效：' + file);
    return value;
  }
  private stateFor(meta: LabState, id: string, language: Language): ProblemState {
    const current = Object.hasOwn(meta.problems, id) ? meta.problems[id] : undefined;
    if (!current) return { language, starters: {}, checks: {}, sources: {} };
    if (!['c', 'cpp'].includes(current.language) || !current.starters || !current.checks)
      throw new Error('题目状态记录格式无效：' + id);
    return { ...current, sources: current.sources ?? {} };
  }
  private async writeState(labId: string, problemId: string, meta: LabState) {
    await mkdir(this.paths(labId, problemId, 'c').dir, { recursive: true });
    await this.atomic(this.statePath(labId, problemId), JSON.stringify(meta, null, 2) + '\n');
  }
  async projectState(labId: string, problemId: string, language: Language) {
    await this.flush();
    return this.stateFor(await this.readState(labId, problemId), problemId, language);
  }
  async load(
    labId: string,
    problemId: string,
    language: Language,
    preferStored = false,
  ): Promise<LoadedDraft> {
    await this.flush();
    let p = this.paths(labId, problemId, language);
    const problem = (await exists(p.problem))
      ? validateProblem(await readJSON(p.problem))
      : defaultProblem(labId, problemId);
    if (!problemId) {
      problem.labId = labId;
      problem.problemId = '';
    } else if (problem.labId !== labId || problem.problemId !== problemId)
      throw new Error('题目文件中的 labId / problemId 与文件位置不一致');
    const meta = await this.readState(labId, problemId),
      stored = Object.hasOwn(meta.problems, problemId)
        ? this.stateFor(meta, problemId, language)
        : undefined;
    if (preferStored && problemId) {
      if (stored) language = stored.language;
      else if (!(await exists(p.source))) {
        const other: Language = language === 'c' ? 'cpp' : 'c';
        if (await exists(this.paths(labId, problemId, other).source)) language = other;
      }
    }
    p = this.paths(labId, problemId, language);
    let warning: string | undefined;
    const binding = problemId ? stored?.sources[language] : undefined;
    if (stored?.documents?.length) {
      const selected =
        stored.documents.find(
          (d) => d.id === stored.activeDocumentId && (preferStored || d.language === language),
        ) ?? stored.documents.find((d) => d.language === language);
      if (selected) return this.readDocument(labId, problemId, selected, problem);
    }
    if (binding) {
      try {
        const decoded = decodeText(await readFile(binding.path));
        return {
          language,
          source: decoded.text,
          problem,
          sourceFile: binding.path,
          sourceEncoding: decoded.encoding,
        };
      } catch {
        warning = '关联源码无法读取：' + binding.path + '；现显示项目内的源码，请检查原文件位置。';
      }
    }
    const draft: LoadedDraft = {
      language,
      source: (await exists(p.source))
        ? decodeText(await readFile(p.source)).text
        : defaultSource(language),
      problem,
    };
    if (warning) draft.warning = warning;
    return draft;
  }
  save(draft: Draft, saveSource = true) {
    const snapshot = structuredClone(validateDraft(draft)),
      p = this.paths(snapshot.problem.labId, snapshot.problem.problemId, snapshot.language);
    return this.enqueue(async () => {
      await mkdir(p.dir, { recursive: true });
      let version: SourceDocument | undefined;
      if (snapshot.documentId) {
        const state = this.stateFor(
          await this.readState(snapshot.problem.labId, snapshot.problem.problemId),
          snapshot.problem.problemId,
          snapshot.language,
        );
        version = state.documents?.find((d) => d.id === snapshot.documentId);
        if (!version) throw new Error('源码版本已不存在，请重新打开');
        if (saveSource && version.externalPath)
          version = await this.managedVersion(
            snapshot.problem.labId,
            snapshot.problem.problemId,
            version,
            state.documents!,
          );
      }
      if (saveSource)
        await writeSource(
          version
            ? this.documentPath(snapshot.problem.labId, snapshot.problem.problemId, version)
            : p.source,
          snapshot.source,
          version?.encoding,
        );
      await this.atomic(p.problem, JSON.stringify(snapshot.problem, null, 2) + '\n');
      if (saveSource) {
        const meta = await this.readState(snapshot.problem.labId, snapshot.problem.problemId),
          state = this.stateFor(meta, snapshot.problem.problemId, snapshot.language);
        state.language = snapshot.language;
        if (version) {
          state.activeDocumentId = version.id;
          state.documents = state.documents!.map((v) => (v.id === version!.id ? version! : v));
        }
        state.starters[snapshot.language] ??= defaultSource(snapshot.language);
        delete state.sources[snapshot.language];
        meta.problems = { ...meta.problems, [snapshot.problem.problemId]: state };
        await this.writeState(snapshot.problem.labId, snapshot.problem.problemId, meta);
      }
    });
  }
  bindSource(labId: string, problemId: string, language: Language, file: string, encoding: string) {
    if (!problemId) return Promise.resolve();
    selection(labId, problemId);
    return this.enqueue(async () => {
      const meta = await this.readState(labId, problemId),
        state = this.stateFor(meta, problemId, language);
      state.language = language;
      state.starters[language] ??= defaultSource(language);
      state.sources[language] = { path: file, encoding };
      meta.problems = { ...meta.problems, [problemId]: state };
      await this.writeState(labId, problemId, meta);
    });
  }
  recordCheck(draft: Draft, record: CheckRecord) {
    const d = structuredClone(validateDraft(draft));
    if (d.workspace)
      return this.workspace.update(d.problem.labId, { check: structuredClone(record) });
    return this.enqueue(async () => {
      const meta = await this.readState(d.problem.labId, d.problem.problemId),
        state = this.stateFor(meta, d.problem.problemId, d.language);
      state.starters[d.language] ??= defaultSource(d.language);
      state.checks[d.language] = structuredClone(record);
      const version = state.documents?.find((v) => v.id === d.documentId);
      if (version) version.check = structuredClone(record);
      meta.problems = { ...meta.problems, [d.problem.problemId]: state };
      await this.writeState(d.problem.labId, d.problem.problemId, meta);
    });
  }
  documentPath(labId: string, problemId: string, version: SourceDocument) {
    workspacePath(version.file);
    return (
      version.externalPath ??
      path.join(this.paths(labId, problemId, version.language).dir, version.file)
    );
  }
  private async readDocument(
    labId: string,
    problemId: string,
    version: SourceDocument,
    problem: Problem,
  ): Promise<LoadedDraft> {
    const file = this.documentPath(labId, problemId, version);
    const decoded = (await exists(file))
      ? decodeText(await readFile(file))
      : { text: version.starter ?? defaultSource(version.language), encoding: version.encoding };
    return {
      file: version.file,
      documentId: version.id,
      source: decoded.text,
      language: version.language,
      problem: structuredClone(problem),
      sourceFile: file,
      sourceEncoding: decoded.encoding,
      name: path.basename(file),
      ...(version.externalPath && !(await exists(file))
        ? { warning: '原关联源码无法读取：' + file + '；请重新导入。当前显示初始模板。' }
        : {}),
    };
  }
  async openDocuments(
    labId: string,
    problemId: string,
    language: Language,
  ): Promise<LoadedDraft[]> {
    const legacy = await this.load(labId, problemId, language, true);
    await this.enqueue(async () => {
      const meta = await this.readState(labId, problemId),
        state = this.stateFor(meta, problemId, legacy.language);
      const uninitialized = state.documents === undefined;
      state.documents ??= [];
      let migrated = false;
      for (let i = 0; i < state.documents.length; i++) {
        const old = state.documents[i];
        if (!old.externalPath || !(await exists(old.externalPath))) continue;
        const adopted = await this.managedVersion(labId, problemId, old, state.documents),
          decoded = decodeText(await readFile(old.externalPath));
        await mkdir(this.paths(labId, problemId, old.language).dir, { recursive: true });
        await writeSource(this.documentPath(labId, problemId, adopted), decoded.text);
        state.documents[i] = adopted;
        migrated = true;
      }
      if (migrated) {
        meta.problems = { ...meta.problems, [problemId]: state };
        await this.writeState(labId, problemId, meta);
      }
      if (uninitialized) {
        for (const lang of ['c', 'cpp'] as Language[]) {
          const p = this.paths(labId, problemId, lang),
            binding = state.sources[lang];
          if (!(await exists(p.source)) && !binding && lang !== legacy.language) continue;
          let file = path.basename(p.source),
            source = defaultSource(lang);
          if (binding) {
            source = (await exists(binding.path))
              ? decodeText(await readFile(binding.path)).text
              : legacy.source;
            file = await this.nextSourceFile(labId, problemId, lang, state.documents);
            await mkdir(p.dir, { recursive: true });
            await writeSource(path.join(p.dir, file), source);
          } else if (await exists(p.source)) source = decodeText(await readFile(p.source)).text;
          state.documents.push({
            id: randomUUID(),
            file,
            language: lang,
            encoding: 'UTF-8',
            starter: state.starters[lang] ?? defaultSource(lang),
            check: binding && labId ? undefined : state.checks[lang],
          });
        }
        state.activeDocumentId = state.documents.find((d) => d.language === legacy.language)?.id;
        delete state.sources.c;
        delete state.sources.cpp;
        meta.problems = { ...meta.problems, [problemId]: state };
        await this.writeState(labId, problemId, meta);
      }
    });
    const state = await this.projectState(labId, problemId, language),
      versions = await Promise.all(
        state.documents!.map(async (v) => ({
          v,
          time: await stat(this.documentPath(labId, problemId, v)).then(
            (s) => s.mtimeMs,
            () => 0,
          ),
        })),
      );
    versions.sort((a, b) => b.time - a.time || a.v.file.localeCompare(b.v.file));
    return Promise.all(
      versions.slice(0, 5).map(({ v }) => this.readDocument(labId, problemId, v, legacy.problem)),
    );
  }
  private async nextSourceFile(
    labId: string,
    problemId: string,
    language: Language,
    versions: SourceDocument[],
  ) {
    const p = this.paths(labId, problemId, language),
      ext = language === 'c' ? '.c' : '.cpp',
      base = problemId || '空项目';
    let n = 1,
      file = base + ext;
    while (
      versions.some((d) => d.file.toLowerCase() === file.toLowerCase()) ||
      (await exists(path.join(p.dir, file)))
    )
      file = base + '.v' + ++n + ext;
    return file;
  }
  private async managedVersion(
    labId: string,
    problemId: string,
    version: SourceDocument,
    versions: SourceDocument[],
  ): Promise<SourceDocument> {
    return {
      ...version,
      file: await this.nextSourceFile(
        labId,
        problemId,
        version.language,
        versions.filter((v) => v.id !== version.id),
      ),
      encoding: 'UTF-8',
      externalPath: undefined,
    };
  }
  async importSource(
    labId: string,
    problemId: string,
    file: string,
    forceCopy = false,
  ): Promise<LoadedDraft> {
    const language: Language = sourceLanguage(file) ?? 'c',
      decoded = decodeText(await readFile(file)),
      legacy = await this.load(labId, problemId, language);
    await this.openDocuments(labId, problemId, language);
    return this.enqueue(async () => {
      const meta = await this.readState(labId, problemId),
        state = this.stateFor(meta, problemId, language);
      const canonical = await (await import('node:fs/promises')).realpath(file);
      let selected: SourceDocument | undefined;
      if (!forceCopy)
        for (const version of state.documents ?? []) {
          if (
            (await (
              await import('node:fs/promises')
            )
              .realpath(this.documentPath(labId, problemId, version))
              .catch(() => null)) === canonical
          ) {
            selected = version;
            break;
          }
        }
      if (!selected) {
        const filename = await this.nextSourceFile(
          labId,
          problemId,
          language,
          state.documents ?? [],
        );
        selected = {
          id: randomUUID(),
          file: filename,
          language,
          encoding: 'UTF-8',
          starter: state.starters[language] ?? defaultSource(language),
        };
        await mkdir(this.paths(labId, problemId, language).dir, { recursive: true });
        await writeSource(this.documentPath(labId, problemId, selected), decoded.text);
        state.documents!.push(selected);
      }
      state.activeDocumentId = selected.id;
      state.language = language;
      meta.problems = { ...meta.problems, [problemId]: state };
      await this.writeState(labId, problemId, meta);
      return this.readDocument(labId, problemId, selected, legacy.problem);
    });
  }
  async newVersion(draft: Draft, fromTemplate = false): Promise<LoadedDraft> {
    const d = structuredClone(validateDraft(draft));
    delete d.auxiliary;
    delete d.sourceFiles;
    delete d.file;
    await this.openDocuments(d.problem.labId, d.problem.problemId, d.language);
    return this.enqueue(async () => {
      const meta = await this.readState(d.problem.labId, d.problem.problemId),
        state = this.stateFor(meta, d.problem.problemId, d.language);
      if (fromTemplate) d.source = state.starters[d.language] ?? defaultSource(d.language);
      const version: SourceDocument = {
        id: randomUUID(),
        file: await this.nextSourceFile(
          d.problem.labId,
          d.problem.problemId,
          d.language,
          state.documents ?? [],
        ),
        language: d.language,
        encoding: 'UTF-8',
        starter: state.starters[d.language] ?? defaultSource(d.language),
      };
      await mkdir(this.paths(d.problem.labId, d.problem.problemId, d.language).dir, {
        recursive: true,
      });
      await writeSource(this.documentPath(d.problem.labId, d.problem.problemId, version), d.source);
      state.documents!.push(version);
      state.activeDocumentId = version.id;
      state.language = d.language;
      meta.problems = { ...meta.problems, [d.problem.problemId]: state };
      await this.writeState(d.problem.labId, d.problem.problemId, meta);
      return {
        ...d,
        file: version.file,
        documentId: version.id,
        sourceFile: this.documentPath(d.problem.labId, d.problem.problemId, version),
        name: version.file,
        sourceEncoding: 'UTF-8',
      };
    });
  }
  activateDocument(labId: string, problemId: string, id: string) {
    return this.enqueue(async () => {
      const meta = await this.readState(labId, problemId),
        state = this.stateFor(meta, problemId, 'c'),
        version = state.documents?.find((d) => d.id === id);
      if (!version) throw new Error('找不到该源码版本');
      state.activeDocumentId = id;
      state.language = version.language;
      meta.problems = { ...meta.problems, [problemId]: state };
      await this.writeState(labId, problemId, meta);
    });
  }
  async allDocuments(
    labId: string,
    problemId: string,
    language: Language,
  ): Promise<(LoadedDraft & { modifiedAt: number })[]> {
    await this.openDocuments(labId, problemId, language);
    const loaded = await this.load(labId, problemId, language, true),
      state = await this.projectState(labId, problemId, language);
    const drafts = await Promise.all(
      (state.documents ?? []).map(async (version) => {
        const file = this.documentPath(labId, problemId, version),
          info = await stat(file).catch(() => null);
        if (!info) throw new Error(problemId + '：源码文件不存在：' + version.file);
        return {
          ...(await this.readDocument(labId, problemId, version, loaded.problem)),
          modifiedAt: info.mtimeMs,
        };
      }),
    );
    return drafts.sort(
      (a, b) => b.modifiedAt - a.modifiedAt || a.documentId!.localeCompare(b.documentId!),
    );
  }
  async recentDocument(
    labId: string,
    problemId: string,
    closed: string[],
  ): Promise<LoadedDraft | null> {
    const state = await this.projectState(labId, problemId, 'c'),
      versions = await Promise.all(
        (state.documents ?? []).map(async (v) => ({
          v,
          time: await stat(this.documentPath(labId, problemId, v)).then(
            (s) => s.mtimeMs,
            () => -1,
          ),
        })),
      );
    versions.sort((a, b) => {
      const ai = closed.indexOf(a.v.id),
        bi = closed.indexOf(b.v.id);
      return (
        (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi) ||
        b.time - a.time ||
        a.v.id.localeCompare(b.v.id)
      );
    });
    const found = versions.find((v) => v.time >= 0);
    if (!found) return null;
    const problem = (await this.load(labId, problemId, found.v.language)).problem;
    return this.readDocument(labId, problemId, found.v, problem);
  }
  async projects(): Promise<Project[]> {
    await this.flush();
    const base = path.join(this.root, 'projects');
    if (!(await exists(base))) return [];
    const result: Project[] = [];
    for (const item of await readdir(base, { withFileTypes: true })) {
      if (!item.isDirectory()) continue;
      try {
        filePart(item.name, '项目');
      } catch {
        continue;
      }
      if (await this.workspace.isProject(item.name)) {
        result.push({ labId: item.name, mode: 'project', problems: [] });
        continue;
      }
      const problems: string[] = [];
      for (const file of await readdir(path.join(base, item.name), { withFileTypes: true })) {
        if (!file.isFile() || !file.name.endsWith('.json')) continue;
        const name = file.name.slice(0, -5);
        try {
          filePart(name, '题号');
          problems.push(name);
        } catch {}
      }
      const order = (await this.readState(item.name, '_')).order ?? [];
      problems.sort((a, b) => {
        const ai = order.indexOf(a),
          bi = order.indexOf(b);
        return (
          (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi) ||
          a.localeCompare(b, undefined, { numeric: true })
        );
      });
      result.push({ labId: item.name, problems });
    }
    return result.sort((a, b) => a.labId.localeCompare(b.labId, undefined, { numeric: true }));
  }
  async updateProjectTests(labId: string, problems: Problem[]) {
    filePart(labId, '项目名称');
    const snapshots = problems.map((p) => structuredClone(validateProblem(p)));
    if (
      snapshots.some((p) => p.labId !== labId || !p.problemId) ||
      new Set(snapshots.map((p) => p.problemId)).size !== snapshots.length
    )
      throw new Error('更新目标无效');
    return this.enqueue(async () => {
      const directory = path.join(this.root, 'projects', labId),
        stage = await mkdtemp(path.join(this.root, '.tests-')),
        backup = stage + '-old';
      let moved = false;
      try {
        await cp(directory, stage, { recursive: true });
        for (const problem of snapshots) {
          const file = path.join(stage, filePart(problem.problemId, '题号') + '.json');
          const previous = validateProblem(await readJSON(file));
          if (previous.labId !== labId || previous.problemId !== problem.problemId)
            throw new Error('题号不符：' + problem.problemId);
          await this.atomic(file, JSON.stringify(problem, null, 2) + '\n');
        }
        await rename(directory, backup);
        moved = true;
        try {
          await rename(stage, directory);
        } catch (e) {
          await rename(backup, directory);
          moved = false;
          throw e;
        }
        moved = false;
        await rm(backup, { recursive: true, force: true });
      } finally {
        if (!moved) await rm(stage, { recursive: true, force: true });
      }
    });
  }
  async buildOptions(labId: string) {
    filePart(labId, '项目名称');
    const meta = await this.readState(labId, '_');
    return meta.buildOptions;
  }
  async saveBuildOptions(labId: string, value: import('../shared/workspace').ProjectBuildOptions) {
    filePart(labId, '项目名称');
    if (
      !value ||
      typeof value.inheritDefaults !== 'boolean' ||
      ![value.cArgs, value.cppArgs, value.linkArgs].every(
        (a) => Array.isArray(a) && a.every((s) => typeof s === 'string'),
      )
    )
      throw new Error('项目编译参数无效');
    return this.enqueue(async () => {
      const meta = await this.readState(labId, '_');
      meta.buildOptions = structuredClone(value);
      await this.writeState(labId, '_', meta);
    });
  }
  async deleteLab(labId: string) {
    filePart(labId, '项目名称');
    await this.flush();
    const root = path.join(this.root, 'projects', labId),
      tombstone = path.join(this.root, '.deleted-' + randomUUID());
    await rename(root, tombstone);
    try {
      await rm(tombstone, { recursive: true, force: true });
    } catch (e) {
      await rename(tombstone, root);
      throw e;
    }
  }
  async nextLabName(name: string) {
    filePart(name, '项目名称');
    const names = new Set(
      (await this.projects()).map((p) => p.labId.normalize('NFC').toLowerCase()),
    );
    let value = name,
      index = 2;
    while (names.has(value.normalize('NFC').toLowerCase())) value = name + ' (' + index++ + ')';
    return value;
  }
  async importProject(value: unknown, targetLabId?: string) {
    const lab = parseLabPackage(value),
      id = filePart(targetLabId ?? lab.labId, '项目名称');
    return this.enqueue(async () => {
      const base = path.join(this.root, 'projects');
      await mkdir(base, { recursive: true });
      const names = await readdir(base);
      if (
        names.some(
          (name) => name.normalize('NFC').toLowerCase() === id.normalize('NFC').toLowerCase(),
        )
      )
        throw new Error('项目已存在，请重新导入并选择副本');
      const destination = path.join(base, id),
        temporary = await mkdtemp(path.join(this.root, '.import-'));
      try {
        const meta: LabState = {
          ...(lab.buildOptions ? { buildOptions: lab.buildOptions } : {}),
          schemaVersion: 1,
          labId: id,
          order: lab.problems.map((p) => p.problemId),
          problems: {},
        };
        for (const item of lab.problems) {
          const draft = labDraft(lab, item, id),
            prefix = path.join(temporary, item.problemId);
          await writeFile(
            prefix + (item.language === 'c' ? '.c' : '.cpp'),
            item.source.replace(/^\uFEFF/, ''),
            'utf8',
          );
          await writeFile(prefix + '.json', JSON.stringify(draft.problem, null, 2) + '\n', 'utf8');
          meta.problems = {
            ...meta.problems,
            [item.problemId]: {
              language: item.language,
              starters: { [item.language]: item.source, ...item.templates },
              checks: {},
              sources: {},
            },
          };
          if (item.versions?.length) {
            const documents: SourceDocument[] = [];
            for (const [n, v] of item.versions.entries()) {
              const file =
                item.problemId + (n ? '.v' + (n + 1) : '') + (v.language === 'c' ? '.c' : '.cpp');
              await writeFile(path.join(temporary, file), v.source, 'utf8');
              documents.push({
                id: randomUUID(),
                file,
                language: v.language,
                encoding: 'UTF-8',
                starter: item.templates?.[v.language] ?? item.source,
              });
            }
            meta.problems[item.problemId].documents = documents;
            meta.problems[item.problemId].activeDocumentId = documents[0].id;
          }
        }
        await writeFile(
          path.join(temporary, '.labpad'),
          JSON.stringify(meta, null, 2) + '\n',
          'utf8',
        );
        await rename(temporary, destination);
        return {
          labId: id,
          problemId: lab.problems[0].problemId,
          language: lab.problems[0].language,
        };
      } catch (error) {
        await rm(temporary, { recursive: true, force: true });
        throw error;
      }
    });
  }
  async createLab(name: string) {
    await this.flush();
    const dir = path.join(this.root, 'projects', filePart(name, '项目名'));
    if (await exists(dir)) throw new Error('项目已存在，请从下拉菜单中选择');
    await mkdir(dir, { recursive: true });
  }
  async createProblem(lab: string, name: string, language: Language) {
    filePart(lab, '项目名');
    filePart(name, '题号');
    await this.flush();
    if (!(await exists(path.join(this.root, 'projects', lab))))
      throw new Error('请先新建或选择实验项目');
    if (await exists(this.paths(lab, name, language).problem))
      throw new Error('题号已存在，请从下拉菜单中选择');
    if (
      (await exists(this.paths(lab, name, 'c').source)) ||
      (await exists(this.paths(lab, name, 'cpp').source))
    )
      throw new Error('题号与现有源码文件名冲突，请更换题号');
    const draft = { source: defaultSource(language), language, problem: defaultProblem(lab, name) };
    await this.save(draft);
    return draft;
  }

  private async migrateDraftDirectory() {
    const dir = path.join(this.root, 'drafts'),
      old = path.join(this.root, '.labpad'),
      target = path.join(dir, '.labpad');
    await mkdir(dir, { recursive: true });
    if (!(await exists(old)) || (await exists(target))) return;
    const meta = (await readJSON(old)) as LabState;
    if (meta?.schemaVersion !== 1 || meta.labId !== '') return;
    const names = new Set([
        '空项目.c',
        '空项目.cpp',
        '空项目.json',
        ...Object.values(meta.problems).flatMap((p) =>
          (p.documents ?? []).filter((v) => !v.externalPath).map((v) => v.file),
        ),
      ]),
      moved: { from: string; to: string }[] = [];
    try {
      for (const name of names) {
        workspacePath(name);
        const from = path.join(this.root, name),
          to = path.join(dir, name);
        if ((await exists(from)) && !(await exists(to))) {
          await mkdir(path.dirname(to), { recursive: true });
          await rename(from, to);
          moved.push({ from, to });
        }
      }
      await rename(old, target);
    } catch (error) {
      for (const item of moved.reverse()) await rename(item.to, item.from);
      throw error;
    }
  }
  fileRoot(lab: string) {
    if (lab) filePart(lab, '项目名称');
    return lab ? path.join(this.root, 'projects', lab) : path.join(this.root, 'drafts');
  }
  async fileService(lab: string, problem: string, guard?: (paths: string[]) => Promise<void>) {
    const project = await this.workspace.isProject(lab),
      root = this.fileRoot(project || problem ? lab : '');
    await mkdir(root, { recursive: true });
    return new FileService(root, {
      protected: project ? ['LPMake.txt'] : [],
      guard,
      commit: (changes) =>
        project
          ? this.reconcileWorkspace(lab, changes)
          : this.reconcileSources(lab, problem, changes),
    });
  }
  private async reconcileWorkspace(lab: string, changes: FileChange[]) {
    const state = await this.workspace.read(lab),
      translate = (file: string) => {
        for (const change of changes)
          if (change.from && !change.copied && under(file, change.from))
            return change.to ? change.to + file.slice(change.from.length) : undefined;
        return file;
      };
    const openFiles = (state.openFiles ?? [])
        .map(translate)
        .filter((v): v is string => v !== undefined),
      activeFile = state.activeFile ? translate(state.activeFile) : undefined,
      expanded = (state.expanded ?? []).map(translate).filter((v): v is string => v !== undefined);
    const starters = state.starters
      ? Object.fromEntries(
          Object.entries(state.starters).flatMap(([name, text]) => {
            const next = translate(name);
            return next ? [[next, text]] : [];
          }),
        )
      : undefined;
    await this.workspace.update(lab, {
      openFiles,
      activeFile,
      expanded,
      ...(starters ? { starters } : {}),
    });
  }
  private async reconcileSources(lab: string, problem: string, changes: FileChange[]) {
    const anchor = problem ? '_' : '',
      meta = await this.readState(lab, anchor),
      root = this.paths(lab, problem, 'c').dir,
      present = new Set(
        (await new FileService(root).list()).filter((f) => !f.directory).map((f) => f.path),
      );
    for (const state of Object.values(meta.problems)) {
      state.documents = (state.documents ?? []).flatMap((version) => {
        for (const change of changes)
          if (
            change.replaced &&
            change.to &&
            under(version.file, change.to) &&
            !(change.from && !change.copied && under(version.file, change.from))
          ) {
            if (!change.copied || !present.has(version.file)) return [];
          }
        for (const change of changes)
          if (change.from && !change.copied && under(version.file, change.from)) {
            if (!change.to) return [];
            const name = change.to + version.file.slice(change.from.length);
            if (!isSourceFile(name)) return [];
            return [
              {
                ...version,
                file: name,
                language: sourceLanguage(name)! as Language,
                externalPath: undefined,
              },
            ];
          }
        return [version];
      });
      if (!state.documents.some((v) => v.id === state.activeDocumentId))
        state.activeDocumentId = state.documents[0]?.id;
    }
    const registered = new Set(
        Object.values(meta.problems).flatMap((s) => (s.documents ?? []).map((v) => v.file)),
      ),
      current = this.stateFor(meta, problem, 'c');
    current.documents ??= [];
    const adopt = async (name: string) => {
      const target = path.join(root, name),
        info = await stat(target);
      if (info.isDirectory()) {
        if (await managedBuild(target)) return;
        for (const entry of await readdir(target)) await adopt(name + '/' + entry);
        return;
      }
      if (!isSourceFile(name) || registered.has(name)) return;
      const language: Language = sourceLanguage(name)!;
      current.documents!.push({
        id: randomUUID(),
        file: name,
        language,
        encoding: decodeText(await readFile(target)).encoding,
        starter: current.starters[language] ?? defaultSource(language),
      });
      registered.add(name);
    };
    for (const change of changes) if (change.to) await adopt(change.to);
    meta.problems = { ...meta.problems, [problem]: current };
    await this.writeState(lab, anchor, meta);
  }
  async operateFiles(
    lab: string,
    problem: string,
    request: FileRequest,
    guard?: (paths: string[]) => Promise<void>,
  ) {
    selection(lab, problem);
    await this.flush();
    return this.enqueue(async () => {
      let value = request;
      if (
        request.action === 'newFile' &&
        request.content === undefined &&
        request.paths.length === 1 &&
        isSourceFile(request.paths[0])
      ) {
        const language: Language = sourceLanguage(request.paths[0])!,
          project = await this.workspace.isProject(lab),
          template = project
            ? (await this.workspace.read(lab)).templates?.[language]
            : this.stateFor(await this.readState(lab, problem ? '_' : ''), problem, language)
                .starters[language];
        value = { ...request, content: template ?? defaultSource(language) };
      }
      const service = await this.fileService(lab, problem, guard);
      return service.operate(value);
    });
  }
  async buildTarget(value: Draft, buffers: Draft[] = []): Promise<Draft> {
    const draft = structuredClone(validateDraft(value));
    const project = await this.workspace.isProject(draft.problem.labId);
    if (draft.target && (draft.target.mode === 'project') !== project)
      throw new Error('编译目标模式已改变，请重新选择实验。');
    if (project) return draft;
    const id =
      draft.target?.mode === 'problem-set'
        ? draft.target.documentId
        : draft.auxiliary
          ? undefined
          : draft.documentId;
    if (!id) {
      if (draft.auxiliary) throw new Error('请先选择或新建一份 C / C++ 源码。');
      return draft;
    }
    const { labId, problemId } = draft.problem;
    const state = await this.projectState(labId, problemId, draft.language);
    const version = state.documents?.find((document) => document.id === id);
    if (!version || !isSourceFile(version.file))
      throw new Error('目标源码已不存在或不属于当前题目，请重新选择源码。');
    const source = await this.readDocument(labId, problemId, version, draft.problem);
    if (!source.sourceFile || !(await exists(source.sourceFile)))
      throw new Error('目标源码文件已不存在，请重新选择或导入源码。');
    const buffer = [draft, ...buffers].find(
      (item) =>
        !item.auxiliary &&
        item.documentId === id &&
        item.problem.labId === labId &&
        item.problem.problemId === problemId,
    );
    if (buffer?.file && buffer.file !== version.file)
      throw new Error('目标源码路径已改变，请刷新文件后重试。');
    return {
      ...source,
      source: buffer?.source ?? source.source,
      target: { mode: 'problem-set', labId, problemId, documentId: id },
    };
  }
  async openFile(
    lab: string,
    problem: string,
    name: string,
    language: Language = 'c',
  ): Promise<LoadedDraft> {
    const service = await this.fileService(lab, problem),
      target = await service.resolve(name);
    name = service.relative(name);
    if (await this.workspace.isProject(lab)) return this.workspace.open(lab, name);
    await this.flush();
    const anchor = problem ? '_' : '',
      meta = await this.readState(lab, anchor);
    for (const [id, state] of Object.entries(meta.problems))
      for (const version of state.documents ?? [])
        if (version.file === name) {
          const rule = (await this.load(lab, id, version.language)).problem;
          return this.readDocument(lab, id, version, rule);
        }
    if (isSourceFile(name)) {
      await this.enqueue(() => this.reconcileSources(lab, problem, [{ to: name }]));
      return this.openFile(lab, problem, name, language);
    }
    const bytes = await readFile(target);
    if (
      bytes.includes(0) &&
      !((bytes[0] === 255 && bytes[1] === 254) || (bytes[0] === 254 && bytes[1] === 255))
    )
      throw Error('这是二进制文件，请在文件管理器中查看。');
    const decoded = decodeText(bytes),
      rule = (await this.load(lab, problem, language)).problem;
    return {
      file: name,
      auxiliary: true,
      documentId: 'aux:' + name,
      name,
      sourceFile: target,
      sourceEncoding: decoded.encoding,
      source: decoded.text,
      language: editorLanguage(name, language),
      problem: rule,
    };
  }

  async sourceSnapshot(draft: Draft, buffers: Draft[] = []) {
    const root = this.paths(draft.problem.labId, draft.problem.problemId, 'c').dir,
      snapshot = await directorySnapshot(root),
      meta = await this.readState(draft.problem.labId, draft.problem.problemId ? '_' : '');
    for (const id of Object.keys(meta.problems)) {
      delete snapshot.files[(id || '空项目') + '.json'];
      delete snapshot.binaryFiles?.[(id || '空项目') + '.json'];
    }
    const state = this.stateFor(meta, draft.problem.problemId, draft.language),
      version = state.documents?.find((v) => v.id === draft.documentId),
      file =
        version?.file ??
        path.basename(
          this.paths(draft.problem.labId, draft.problem.problemId, draft.language).source,
        );
    snapshot.files[file] = draft.source;
    for (const buffer of buffers)
      if (buffer.auxiliary && buffer.file) {
        if (Object.hasOwn(snapshot.files, buffer.file)) snapshot.files[buffer.file] = buffer.source;
        else if (Object.hasOwn(snapshot.binaryFiles ?? {}, buffer.file))
          snapshot.binaryFiles![buffer.file] = sourceBytes(
            buffer.source,
            decodeText(Buffer.from(snapshot.binaryFiles![buffer.file], 'base64')).encoding,
          ).toString('base64');
      }
    const versions = new Set(
        Object.entries(meta.problems).flatMap(([id, state]) => [
          (id || '空项目') + '.c',
          (id || '空项目') + '.cpp',
          ...(state.documents ?? []).map((version) => version.file),
        ]),
      ),
      required = new Set<string>([file]);
    const scan = (name: string, seen = new Set<string>()) => {
      if (seen.has(name)) return false;
      seen.add(name);
      const text = snapshot.files[name] ?? '';
      let dynamic = false;
      for (const match of text.matchAll(/^\s*#\s*include\b\s*([^\n]+)/gm)) {
        const token = match[1].trim(),
          literal = /^[<"]([^>"]+)[>"]/.exec(token);
        if (!literal) {
          dynamic = true;
          continue;
        }
        const included = literal[1].replaceAll('\\', '/'),
          relative = path.posix.normalize(path.posix.join(path.posix.dirname(name), included));
        for (const target of Object.keys(snapshot.files))
          if (
            target.toLowerCase() === relative.toLowerCase() ||
            target.toLowerCase() === included.toLowerCase() ||
            target.toLowerCase().endsWith('/' + included.toLowerCase())
          ) {
            required.add(target);
            if (scan(target, seen)) dynamic = true;
          }
      }
      return dynamic;
    };
    let dynamic = scan(file);
    for (const name of Object.keys(snapshot.files))
      if (/\.(h|hpp|hh|hxx)$/i.test(name) && scan(name)) dynamic = true;
    // Other registered versions are independent translation units, unless explicitly included.
    if (!dynamic)
      for (const name of versions)
        if (name !== file && !required.has(name)) delete snapshot.files[name];
    return { snapshot, file };
  }
  async fileView(lab: string) {
    if (await this.workspace.isProject(lab)) {
      const s = await this.workspace.read(lab);
      return {
        expanded: s.expanded ?? [],
        sidebarWidth: s.sidebarWidth ?? 190,
        sidebarCollapsed: s.sidebarCollapsed ?? false,
        rightCollapsed: s.rightCollapsed ?? false,
      };
    }
    const meta = await this.readState(lab, lab ? '_' : ''),
      view = meta.view ?? {};
    return {
      expanded: view.expanded ?? [],
      sidebarWidth: view.sidebarWidth ?? 190,
      sidebarCollapsed: view.sidebarCollapsed ?? true,
      rightCollapsed: view.rightCollapsed ?? false,
    };
  }
  async saveFileView(
    lab: string,
    value: {
      expanded?: string[];
      sidebarWidth?: number;
      sidebarCollapsed?: boolean;
      rightCollapsed?: boolean;
    },
  ) {
    if (await this.workspace.isProject(lab)) {
      await this.workspace.update(lab, value);
      return;
    }
    return this.enqueue(async () => {
      const anchor = lab ? '_' : '',
        meta = await this.readState(lab, anchor);
      meta.view = { ...meta.view, ...value };
      await this.writeState(lab, anchor, meta);
    });
  }
  async copyDataTo(target: string) {
    await this.flush();
    const names = [
      'projects',
      'drafts',
      '空项目.c',
      '空项目.cpp',
      '空项目.json',
      '.labpad',
      ...(await readdir(this.root)).filter((n) => /^空项目\.v\d+\.(c|cpp)$/.test(n)),
    ];
    for (const name of [...names, 'config.json'])
      if (await exists(path.join(target, name)))
        throw new Error('目标目录已有 LabPad 数据，请选择其他目录，避免覆盖');
    const projects = path.join(this.root, 'projects'),
      relative = path.relative(projects, target);
    if (
      relative === '' ||
      (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
    )
      throw new Error('数据目录不能放在当前 projects 目录内部');
    for (const name of names)
      if (await exists(path.join(this.root, name)))
        await cp(path.join(this.root, name), path.join(target, name), {
          recursive: true,
          force: false,
          errorOnExist: true,
        });
  }
  async flush() {
    await this.tail;
    await this.workspace.flush();
  }
}

export async function importPairs(
  files: string[],
  labId: string,
  problemId: string,
): Promise<Problem> {
  const groups = new Map<string, { input?: string; answers: string[] }>();
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!['.in', '.out', '.ans'].includes(ext))
      throw new Error('请选择 .in 和同名 .out / .ans 文件');
    const key = path.join(path.dirname(file), path.basename(file).slice(0, -ext.length)),
      group = groups.get(key) ?? { answers: [] };
    if (ext === '.in') group.input = file;
    else group.answers.push(file);
    groups.set(key, group);
  }
  const problem = defaultProblem(labId, problemId);
  for (const [key, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    if (!group.input || group.answers.length !== 1)
      throw new Error(path.basename(key) + ' 缺少文件对，或同时存在 .out 与 .ans');
    const id = path.basename(key);
    if (problem.testCases.some((t) => t.id === id))
      throw new Error('不同目录出现同名测试点：' + id);
    problem.testCases.push({
      id,
      input: decodeText(await readFile(group.input)).text,
      expectedOutput: decodeText(await readFile(group.answers[0])).text,
    });
  }
  if (!problem.testCases.length) throw new Error('未找到完整测试点');
  return problem;
}
