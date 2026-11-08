import { t as localize, UIError } from '../shared/i18n';
import { under, type FileChange } from '../shared/file-changes';
import {
  mkdir,
  readdir,
  lstat,
  realpath,
  rename,
  rm,
  cp,
  writeFile,
  mkdtemp,
} from 'node:fs/promises';
import path from 'node:path';
import { workspacePath, uniquePaths, type WorkspaceFile } from '../shared/workspace';
export type FileAction = 'newFile' | 'newFolder' | 'rename' | 'copy' | 'move' | 'delete' | 'import';
export interface FileRequest {
  action: FileAction;
  paths: string[];
  destination?: string;
  exactDestination?: boolean;
  content?: string;
  conflict?: 'replace' | 'keepBoth' | 'skip';
}
export type { FileChange } from '../shared/file-changes';
export class FileConflict extends Error {
  constructor(readonly files: string[]) {
    super(
      localize('The destination already contains files with these names: {0}', files.join('、')),
    );
  }
}
const key = (s: string) => s.normalize('NFC').toLowerCase();
export { under } from '../shared/file-changes';
export function compactSelection(files: string[]) {
  return [...new Set(files)].filter((p) => !files.some((other) => other !== p && under(p, other)));
}
export class FileService {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    readonly root: string,
    private options: {
      protected?: string[];
      hidden?: string[];
      guard?: (files: string[]) => Promise<void>;
      commit?: (changes: FileChange[]) => Promise<void>;
    } = {},
  ) {}
  relative(value: string, base = '') {
    if (
      typeof value !== 'string' ||
      value.includes('\\') ||
      /^(?:\/|[a-z]:)/i.test(value) ||
      value.includes('\0')
    )
      throw new UIError('Use a path relative to the experiment folder');
    const name = path.posix.normalize(path.posix.join(base, value));
    if (name === '..' || name.startsWith('../'))
      throw new UIError('The path must stay within the current experiment folder');
    if (name === '.') return '';
    workspacePath(name);
    return name;
  }
  private protected(name: string) {
    return (
      name
        .split('/')
        .some(
          (p) => p === '.labpad' || p.startsWith('.labpad-txn-') || p === '.labpad-build.json',
        ) || (this.options.protected ?? []).some((p) => under(name, p) || under(p, name))
    );
  }
  private hidden(name: string) {
    return (
      name
        .split('/')
        .map(key)
        .some(
          (p) =>
            p === '.labpad' ||
            p.startsWith('.labpad-txn-') ||
            [
              '.labpad-project.json',
              '.labpad-build.json',
              'labpad.project.json',
              '.git',
              '.work',
            ].includes(p),
        ) || (this.options.hidden ?? []).some((p) => under(name, p))
    );
  }
  async resolve(value: string, allowMissing = false, base = '') {
    const name = this.relative(value, base),
      root = await realpath(this.root);
    let file = root;
    const parts = name ? name.split('/') : [];
    for (const part of parts) {
      file = path.join(file, part);
      try {
        if ((await lstat(file)).isSymbolicLink())
          throw new UIError('Experiment file operations do not support symbolic links: {0}', name);
      } catch (e: any) {
        if (e.code === 'ENOENT' && allowMissing) break;
        throw e;
      }
    }
    return path.join(root, ...parts);
  }
  async list(): Promise<WorkspaceFile[]> {
    await this.tail;
    const files: WorkspaceFile[] = [];
    const walk = async (dir: string, prefix = '') => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const name = prefix + e.name;
        if (this.hidden(name)) continue;
        // Reject links at the boundary rather than traversing outside the workspace.
        if (e.isSymbolicLink()) continue;
        workspacePath(name);
        files.push({ path: name, directory: e.isDirectory() });
        if (e.isDirectory()) await walk(path.join(dir, e.name), name + '/');
      }
    };
    await walk(this.root);
    uniquePaths(files.filter((f) => !f.directory).map((f) => f.path));
    return files.sort((a, b) => (a.path < b.path ? -1 : 1));
  }
  async operate(
    request: FileRequest,
  ): Promise<{ changes: FileChange[]; files: WorkspaceFile[]; warnings: string[] }> {
    const task = this.tail.then(() => this.apply(request));
    this.tail = task.catch(() => {});
    const result = await task;
    return { ...result, files: await this.list() };
  }
  private async apply(request: FileRequest) {
    if (
      !request ||
      !['newFile', 'newFolder', 'rename', 'copy', 'move', 'delete', 'import'].includes(
        request.action,
      ) ||
      !Array.isArray(request.paths) ||
      !request.paths.every((p) => typeof p === 'string')
    )
      throw new UIError('Invalid file operation');
    if (request.exactDestination && request.paths.length !== 1)
      throw new UIError('An exact destination requires a single source');
    const action = request.action,
      external = action === 'import',
      sources = compactSelection(request.paths);
    if (!sources.length) throw new UIError('Select files or folders');
    const existing: WorkspaceFile[] = [];
    const walk = async (dir: string, prefix = '') => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const name = prefix + e.name;
        if (this.hidden(name)) continue;
        existing.push({ path: name, directory: e.isDirectory() });
        if (e.isDirectory() && !e.isSymbolicLink()) await walk(path.join(dir, e.name), name + '/');
      }
    };
    await walk(this.root);
    const names = new Set(existing.map((f) => key(f.path))),
      plans: { from?: string; to?: string; external?: boolean }[] = [],
      dest = request.destination === undefined ? '' : this.relative(request.destination);
    const keepBoth = (name: string) => {
      const ext = path.posix.extname(name),
        base = name.slice(0, name.length - ext.length);
      let n = 2,
        result = name;
      while (names.has(key(result))) result = base + ' (' + n++ + ')' + ext;
      return result;
    };
    for (const original of sources) {
      const from = external ? path.resolve(original) : this.relative(original);
      if (!from) throw new UIError('The experiment root cannot be modified');
      if (!external && ['rename', 'move', 'delete'].includes(action) && this.protected(from))
        throw new UIError(
          'This file is managed by LabPad and cannot be moved, overwritten, or deleted: {0}',
          from,
        );
      let to =
        action === 'delete'
          ? undefined
          : action === 'rename' || request.exactDestination
            ? dest
            : action === 'newFile' || action === 'newFolder'
              ? from
              : path.posix.join(dest, path.basename(from));
      if (to !== undefined) {
        to = this.relative(to);
        if (!to) throw new UIError('This location is managed by LabPad: {0}', to);
        const parts = to.split('/');
        for (let i = 1; i < parts.length; i++) {
          const parent = parts.slice(0, i).join('/'),
            found = existing.find((e) => key(e.path) === key(parent));
          if (found && (!found.directory || found.path !== parent))
            throw new UIError('Keep the destination folder name and letter case: {0}', found.path);
        }
        if (
          !external &&
          (action === 'move' || action === 'rename' || action === 'copy') &&
          key(to) !== key(from) &&
          under(to, from)
        )
          throw new UIError('A folder cannot be moved into itself');
        const same =
          !external && (action === 'rename' || action === 'move') && key(from) === key(to);
        if (names.has(key(to)) && !same) {
          if (request.conflict === 'skip') continue;
          if (request.conflict === 'keepBoth') to = keepBoth(to);
          else if (request.conflict !== 'replace') throw new FileConflict([to]);
        }
        if (!external && (action === 'copy' || action === 'move') && key(from) === key(to))
          throw new UIError('The source and destination are the same');
        if (this.protected(to)) throw new UIError('This location is managed by LabPad: {0}', to);
        names.add(key(to));
      }
      plans.push({ from, to, external });
    }
    await this.options.guard?.(
      plans.flatMap((p) => [...(p.external ? [] : [p.from!]), ...(p.to ? [p.to] : [])]),
    );
    // Preflight every source and destination before mutating a batch.
    const inspect = async (file: string) => {
      const st = await lstat(file);
      if (st.isSymbolicLink()) throw new UIError('Symbolic links are not supported: {0}', file);
      if (st.isDirectory()) for (const e of await readdir(file)) await inspect(path.join(file, e));
    };
    for (const p of plans) {
      if (action !== 'newFile' && action !== 'newFolder')
        await inspect(p.external ? p.from! : await this.resolve(p.from!));
      if (p.to) await this.resolve(p.to, true);
    }
    const transaction = await mkdtemp(path.join(this.root, '.labpad-txn-')),
      undo: (() => Promise<unknown>)[] = [],
      changes: FileChange[] = [];
    try {
      let n = 0;
      for (const p of plans) {
        const from = p.external
            ? p.from!
            : await this.resolve(p.from!, action === 'newFile' || action === 'newFolder'),
          to = p.to ? await this.resolve(p.to, true) : undefined;
        let replaced = false;
        if (
          to &&
          !(
            (action === 'rename' || action === 'move') &&
            !p.external &&
            key(p.from!) === key(p.to!)
          ) &&
          (await lstat(to).catch(() => undefined))
        ) {
          const backup = path.join(transaction, String(n++));
          await rename(to, backup);
          undo.push(() => rename(backup, to));
          replaced = true;
        }
        if (action === 'delete') {
          const backup = path.join(transaction, String(n++));
          await rename(from, backup);
          undo.push(() => rename(backup, from));
          changes.push({ from: p.from });
        } else if (action === 'newFolder') {
          await mkdir(to!, { recursive: true });
          undo.push(() => rm(to!, { recursive: true, force: true }));
          changes.push({ to: p.to });
        } else if (action === 'newFile') {
          await mkdir(path.dirname(to!), { recursive: true });
          await writeFile(to!, request.content ?? '', { flag: 'wx' });
          undo.push(() => rm(to!, { force: true }));
          changes.push({ to: p.to });
        } else if (action === 'move' || action === 'rename') {
          const intermediate = path.join(transaction, String(n++));
          await rename(from, intermediate);
          // Register recovery before the next I/O: a failed restore must retain this backup.
          let current = intermediate;
          undo.push(() => rename(current, from));
          await mkdir(path.dirname(to!), { recursive: true });
          await rename(intermediate, to!);
          current = to!;
          changes.push({ from: p.from, to: p.to, replaced });
        } else {
          await mkdir(path.dirname(to!), { recursive: true });
          undo.push(() => rm(to!, { recursive: true, force: true }));
          await cp(from, to!, {
            recursive: true,
            errorOnExist: true,
            force: false,
            dereference: false,
          });
          changes.push({ from: p.external ? undefined : p.from, to: p.to, copied: true, replaced });
        }
      }
      await this.options.commit?.(changes);
    } catch (error) {
      const failures = [];
      for (const restore of undo.reverse())
        try {
          await restore();
        } catch (e) {
          failures.push(e);
        }
      if (failures.length)
        throw new AggregateError(
          [error, ...failures],
          localize(
            'The file operation failed, and some files could not be restored. Backups were kept at: {0}',
            transaction,
          ),
        );
      try {
        await rm(transaction, { recursive: true, force: true });
      } catch (cleanup) {
        throw new AggregateError(
          [error, cleanup],
          localize(
            'The file operation failed. Temporary backups could not be removed: {0}',
            transaction,
          ),
        );
      }
      throw error;
    }
    // Metadata and files are committed. Cleanup cannot roll back only one side.
    const warnings: string[] = [];
    try {
      await rm(transaction, { recursive: true, force: true });
    } catch (error) {
      warnings.push(
        localize(
          'Files were updated, but temporary backups could not be removed: {0} ({1})',
          transaction,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
    return { changes, warnings };
  }
}
