import { isSourceFile, isCodeFile, editorLanguage } from '../shared/file-language';
import { directorySnapshot } from './workspace-files';
import { independentMake } from './build/plan';
import { ConfigError, parse } from '../shared/lpmake';
import { mkdir, readFile, readdir, lstat, rename, rm, writeFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import writeFileAtomic from 'write-file-atomic';
import {
  workspacePath,
  workspaceTemplate,
  parseWorkspacePackage,
  uniquePaths,
  type WorkspaceState,
  type WorkspaceFile,
  type WorkspaceSnapshot,
} from '../shared/workspace';
import { defaultProblem, defaultSource, defaultConfig } from '../shared/defaults';
import { filePart, validateProblem } from '../shared/validate';
import type { LoadedDraft, Draft, Language, Problem } from '../shared/types';
import { decodeText, readJSON, exists, sourceBytes } from './storage';
export class WorkspaceStore {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(readonly dataRoot: string) {}
  root(lab: string) {
    return path.join(this.dataRoot, 'projects', filePart(lab, '项目名称'));
  }
  metadata(lab: string) {
    return path.join(this.root(lab), '.labpad-project.json');
  }
  async isProject(lab: string) {
    return !!lab && (await exists(this.metadata(lab)));
  }
  private enqueue<T>(fn: () => Promise<T>) {
    const task = this.tail.then(fn, fn);
    this.tail = task.catch(() => {});
    return task;
  }
  async read(lab: string): Promise<WorkspaceState> {
    await this.tail;
    let value = (await readJSON(this.metadata(lab))) as WorkspaceState;
    if (value && Object.hasOwn(value, 'inheritDefaults')) {
      await this.migrate(lab);
      value = (await readJSON(this.metadata(lab))) as WorkspaceState;
    }
    if (
      value?.schemaVersion !== 2 ||
      value.mode !== 'project' ||
      value.labId !== lab ||
      (value.inheritDefaults !== undefined && typeof value.inheritDefaults !== 'boolean')
    )
      throw new Error('项目状态格式无效');
    validateProblem(value.tests);
    if (value.tests.labId !== lab || value.tests.problemId !== '')
      throw new Error('工作区测试目标不符');
    return value;
  }
  private async write(lab: string, state: WorkspaceState) {
    await writeFileAtomic(this.metadata(lab), JSON.stringify(state, null, 2) + '\n');
  }
  private async legacyDefaults() {
    const file = path.join(this.dataRoot, 'config.json'),
      config = (await exists(file))
        ? ((await readJSON(file)) as ReturnType<typeof defaultConfig>)
        : defaultConfig();
    return {
      c: config.compiler.cArgs,
      cpp: config.compiler.cppArgs,
      link: config.compiler.linkArgs,
    };
  }
  private async commitSource(lab: string, target: string, source: string, state: WorkspaceState) {
    const oldSource = await readFile(target),
      oldMetadata = await readFile(this.metadata(lab));
    try {
      const bytes = sourceBytes(source, decodeText(oldSource).encoding);
      if (!oldSource.equals(bytes)) await writeFileAtomic(target, bytes);
      await this.write(lab, state);
    } catch (error) {
      const restore = async (file: string, original: Buffer) => {
        const current = await readFile(file).catch(() => undefined);
        if (!current?.equals(original)) await writeFileAtomic(file, original);
      };
      const restored = await Promise.allSettled([
        restore(target, oldSource),
        restore(this.metadata(lab), oldMetadata),
      ]);
      if (restored.some((r) => r.status === 'rejected'))
        throw new AggregateError(
          [
            error,
            ...restored
              .filter((r) => r.status === 'rejected')
              .map((r) => (r as PromiseRejectedResult).reason),
          ],
          '保存失败，恢复原文件时也发生错误；编辑草稿仍保留。',
        );
      throw error;
    }
  }
  private async migrate(lab: string) {
    return this.enqueue(async () => {
      const state = (await readJSON(this.metadata(lab))) as WorkspaceState;
      if (!Object.hasOwn(state, 'inheritDefaults')) return;
      const target = await this.path(lab, 'LPMake.txt'),
        text = decodeText(await readFile(target)).text;
      let source = text;
      if (state.inheritDefaults)
        try {
          source = independentMake(text, await this.legacyDefaults());
        } catch (error) {
          if (error instanceof ConfigError) return;
          throw error;
        }
      delete state.inheritDefaults;
      await this.commitSource(lab, target, source, state);
    });
  }
  async path(lab: string, file: string, allowMissing = false) {
    const root = this.root(lab),
      parts = workspacePath(file).split('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]);
      try {
        if ((await lstat(current)).isSymbolicLink())
          throw new Error('项目文件不支持符号链接：' + file);
      } catch (e: any) {
        if (e.code === 'ENOENT' && allowMissing) break;
        throw e;
      }
    }
    return path.join(root, ...parts);
  }
  async list(lab: string): Promise<WorkspaceFile[]> {
    await this.tail;
    const root = this.root(lab),
      result: WorkspaceFile[] = [];
    async function walk(dir: string, prefix = '') {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (!prefix && entry.name === '.labpad-project.json') continue;
        const file = prefix + entry.name;
        workspacePath(file);
        if (entry.isSymbolicLink()) throw new Error('项目文件不支持符号链接：' + file);
        result.push({ path: file, directory: entry.isDirectory() });
        if (entry.isDirectory()) await walk(path.join(dir, entry.name), file + '/');
      }
    }
    await walk(root);
    uniquePaths(result.filter((e) => !e.directory).map((e) => e.path));
    return result.sort((a, b) => (a.path.normalize('NFC') < b.path.normalize('NFC') ? -1 : 1));
  }
  async create(lab: string, language: Language = 'c', value?: unknown) {
    const pkg = value ? parseWorkspacePackage(value) : undefined,
      root = this.root(lab);
    await mkdir(path.dirname(root), { recursive: true });
    if (await exists(root)) throw new Error('项目已存在');
    const temporary = await mkdtemp(path.join(this.dataRoot, '.workspace-'));
    try {
      const files = pkg
        ? Object.fromEntries(pkg.files.map((f) => [f.path, f.content]))
        : workspaceTemplate(language);
      const binary = new Set(
        pkg?.files.filter((f) => f.encoding === 'base64').map((f) => f.path) ?? [],
      );
      if (pkg?.build.inheritDefaults === true)
        files['LPMake.txt'] = independentMake(files['LPMake.txt'], await this.legacyDefaults());
      for (const [file, content] of Object.entries(files)) {
        const target = path.join(temporary, workspacePath(file));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(
          target,
          binary.has(file) ? Buffer.from(content, 'base64') : content,
          'utf8',
        );
      }
      const first = Object.keys(files).find((f) => isSourceFile(f)) ?? 'LPMake.txt';
      const state: WorkspaceState = {
        schemaVersion: 2,
        mode: 'project',
        labId: lab,
        tests: { ...(pkg?.tests ?? defaultProblem(lab, '')), labId: lab, problemId: '' },
        templates: pkg?.templates,
        starters: Object.fromEntries(Object.entries(files).filter(([f]) => isCodeFile(f))),
        activeFile: first,
        openFiles: [first],
        expanded: [],
        sidebarWidth: 190,
        sidebarCollapsed: false,
      };
      await writeFile(
        path.join(temporary, '.labpad-project.json'),
        JSON.stringify(state, null, 2) + '\n',
      );
      await rename(temporary, root);
    } catch (e) {
      await rm(temporary, { recursive: true, force: true });
      throw e;
    }
    return this.open(lab, (await this.read(lab)).activeFile!);
  }
  async open(lab: string, file: string): Promise<LoadedDraft> {
    const state = await this.read(lab),
      target = await this.path(lab, file),
      bytes = await readFile(target);
    if (
      bytes.includes(0) &&
      !((bytes[0] === 255 && bytes[1] === 254) || (bytes[0] === 254 && bytes[1] === 255))
    )
      throw Error('这是二进制文件，请在文件管理器中查看。');
    const decoded = decodeText(bytes);
    let forced: Language | undefined;
    try {
      forced = parse(await readFile(await this.path(lab, 'LPMake.txt'), 'utf8')).spec.language;
    } catch {
      /* A broken build configuration must remain editable. */
    }
    return {
      file,
      documentId: 'file:' + file,
      name: file,
      sourceFile: target,
      sourceEncoding: decoded.encoding,
      source: decoded.text,
      language: editorLanguage(file, 'c', forced),
      problem: state.tests,
    };
  }
  async documents(lab: string) {
    const state = await this.read(lab),
      files = await this.list(lab),
      paths = new Set(files.filter((f) => !f.directory).map((f) => f.path));
    const wanted = (state.openFiles ?? [state.activeFile ?? 'LPMake.txt']).filter((f) =>
      paths.has(f),
    );
    if (!wanted.length && paths.size)
      wanted.push(paths.has('LPMake.txt') ? 'LPMake.txt' : [...paths][0]);
    return Promise.all(wanted.map((f) => this.open(lab, f)));
  }
  async snapshot(lab: string, buffers: Draft[] = []): Promise<WorkspaceSnapshot> {
    const state = await this.read(lab),
      snapshot = await directorySnapshot(this.root(lab)),
      files = snapshot.files;
    for (const d of buffers)
      if (d.problem.labId === lab && d.file) {
        workspacePath(d.file);
        if (Object.hasOwn(files, d.file)) files[d.file] = d.source;
        else if (Object.hasOwn(snapshot.binaryFiles ?? {}, d.file))
          snapshot.binaryFiles![d.file] = sourceBytes(
            d.source,
            decodeText(Buffer.from(snapshot.binaryFiles![d.file], 'base64')).encoding,
          ).toString('base64');
        else if (!(await exists(await this.path(lab, d.file, true))))
          throw new Error('编辑文件已不存在：' + d.file);
      }
    return {
      ...snapshot,
      files,
      ...(state.inheritDefaults === true ? { inheritDefaults: true } : {}),
    };
  }
  async save(draft: Draft) {
    if (!draft.file) throw new Error('请选择项目文件');
    const lab = draft.problem.labId,
      target = await this.path(lab, draft.file);
    return this.enqueue(async () => {
      const state = (await readJSON(this.metadata(lab))) as WorkspaceState;
      state.tests = structuredClone(validateProblem(draft.problem));
      let source = draft.source;
      if (draft.file === 'LPMake.txt' && Object.hasOwn(state, 'inheritDefaults')) {
        if (state.inheritDefaults) source = independentMake(source, await this.legacyDefaults());
        delete state.inheritDefaults;
      }
      await this.commitSource(lab, target, source, state);
      return source;
    });
  }
  async update(lab: string, values: Partial<WorkspaceState>) {
    await this.tail;
    return this.enqueue(async () => {
      const state = (await readJSON(this.metadata(lab))) as WorkspaceState;
      await this.write(lab, {
        ...state,
        ...structuredClone(values),
        schemaVersion: 2,
        mode: 'project',
        labId: lab,
      });
    });
  }

  async flush() {
    await this.tail;
  }
}
