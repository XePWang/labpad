import { UIError, t as localize } from '../shared/i18n';
import { remapPath } from '../shared/file-changes';
import { lstat, readdir, utimes } from 'node:fs/promises';
import { readFileLimited } from './read-file';
import path from 'node:path';
import { FileService, type FileRequest, type FileChange } from './files';
import { decodeText } from './storage';
export interface ShellResult {
  cwd: string;
  output: string;
  clear?: boolean;
  filesChanged?: boolean;
}
export function commandWords(text: string) {
  const words: string[] = [];
  let value = '',
    quote = '',
    started = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) {
        quote = '';
        continue;
      }
      if (c === '\\' && quote === '"' && ['"', '\\'].includes(text[i + 1])) value += text[++i];
      else value += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      started = true;
      continue;
    }
    if (c === '\\' && i + 1 < text.length) {
      value += text[++i];
      started = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (started) {
        words.push(value);
        value = '';
        started = false;
      }
      continue;
    }
    if (/[|;&<>`]/.test(c))
      throw new UIError('The terminal does not support pipes, redirection, or scripting syntax.');
    value += c;
    started = true;
  }
  if (quote) throw new UIError('A quoted string is not closed.');
  if (started) words.push(value);
  return words;
}
export class CommandTerminal {
  cwd = '';
  constructor(
    readonly files: FileService,
    private mutate: (request: FileRequest) => Promise<unknown>,
    private make: (action: 'help' | 'build' | 'run' | 'clean', cwd: string) => Promise<string>,
  ) {}
  async context() {
    try {
      if (!(await lstat(await this.files.resolve(this.cwd))).isDirectory()) this.cwd = '';
    } catch (error: any) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      this.cwd = '';
    }
    return { scope: this.files.root, cwd: this.cwd };
  }
  async reconcile(changes: FileChange[]) {
    this.cwd = remapPath(this.cwd, changes) ?? '';
    return this.context();
  }
  async execute(text: string): Promise<ShellResult> {
    await this.context();
    const words = commandWords(text),
      command = words.shift()?.toLowerCase();
    let output = '',
      changed = false;
    const relative = (name: string) => this.files.relative(name, this.cwd);
    const resolve = (name: string, missing = false) => this.files.resolve(name, missing, this.cwd);
    const exact = (min: number, max = min) => {
      if (words.length < min || words.length > max)
        throw new UIError('Incorrect number of arguments. Enter help for usage.');
    };
    if (!command) return { cwd: this.cwd, output };
    if (command === 'pwd') {
      exact(0);
      output = './' + this.cwd;
    } else if (command === 'cd') {
      exact(0, 1);
      const next = relative(words[0] ?? '.'),
        file = await resolve(words[0] ?? '.');
      if (!(await lstat(file)).isDirectory()) throw new UIError('Not a folder: {0}', words[0]);
      this.cwd = next;
    } else if (command === 'ls' || command === 'll') {
      exact(0, 1);
      const file = await resolve(words[0] ?? '.'),
        prefix = relative(words[0] ?? '.'),
        all = await this.files.list();
      if (!(await lstat(file)).isDirectory())
        output = (command === 'll' ? localize('File  ') : '') + path.basename(file);
      else
        output = all
          .filter((f) => path.posix.dirname(f.path) === (prefix || '.'))
          .map(
            (f) =>
              (command === 'll' ? (f.directory ? localize('Dir   ') : localize('File  ')) : '') +
              path.posix.basename(f.path) +
              (f.directory ? '/' : ''),
          )
          .join('\n');
    } else if (command === 'cat') {
      exact(1, 20);
      const chunks = [];
      for (const name of words) {
        const bytes = await readFileLimited(
          await resolve(name),
          1024 ** 2,
          localize('This file exceeds 1 MB. Open it in the editor.'),
        );
        if (bytes.includes(0) && !([254, 255].includes(bytes[0]) && [254, 255].includes(bytes[1])))
          throw new UIError('This is a binary file. View it in the file manager.');
        chunks.push(decodeText(bytes).text);
      }
      output = chunks.join('\n');
    } else if (command === 'mkdir' || command === 'touch') {
      if (words[0] === '-p') words.shift();
      exact(1, 20);
      for (const name of words) {
        const file = await resolve(name, true),
          info = await lstat(file).catch(() => undefined);
        if (info) {
          if (command === 'touch' && !info.isDirectory())
            await utimes(file, new Date(), new Date());
          else if (command === 'mkdir' && !info.isDirectory())
            throw new UIError('A file already uses that name.');
        } else
          await this.mutate({
            action: command === 'mkdir' ? 'newFolder' : 'newFile',
            paths: [relative(name)],
            content: '',
          });
      }
      changed = true;
    } else if (command === 'cp' || command === 'mv') {
      if (['-r', '-R'].includes(words[0])) words.shift();
      exact(2);
      const from = relative(words[0]),
        destination = relative(words[1]),
        target = await resolve(words[1], true),
        directory = (await lstat(target).catch(() => undefined))?.isDirectory();
      await this.mutate({
        action: command === 'cp' ? 'copy' : 'move',
        paths: [from],
        destination,
        exactDestination: !directory,
      });
      changed = true;
    } else if (command === 'rm') {
      const recursive = words[0] === '-r' || words[0] === '-rf' || words[0] === '-R';
      if (recursive) words.shift();
      exact(1, 20);
      for (const name of words)
        if ((await lstat(await resolve(name))).isDirectory() && !recursive)
          throw new UIError('Use rm -r to delete a folder, then confirm the prompt.');
      await this.mutate({ action: 'delete', paths: words.map(relative) });
      changed = true;
    } else if (command === 'clear') {
      exact(0);
      return { cwd: this.cwd, output: '', clear: true };
    } else if (command === 'help') {
      output = localize(
        'pwd \u00b7 ls [directory] \u00b7 ll [directory] \u00b7 cd [directory]\nmkdir [-p] path \u00b7 touch file \u00b7 cat file\ncp [-r] source destination \u00b7 mv source destination \u00b7 rm [-r] path\nlpmake build (b) \u00b7 run (r) \u00b7 clean (c)\nclear \u00b7 help\nQuote paths that contain spaces. File commands are limited to the current experiment.',
      );
    } else if (command === 'lpmake') {
      exact(0, 1);
      const make = await resolve('LPMake.txt', true);
      if (!(await lstat(make).catch(() => undefined))?.isFile())
        throw new UIError('LPMake.txt was not found in the current directory: ./{0}', this.cwd);
      const action = (
        { b: 'build', r: 'run', c: 'clean', build: 'build', run: 'run', clean: 'clean' } as const
      )[words[0] as 'b'];
      if (words.length && !action)
        throw new UIError('Usage: lpmake build / run / clean (b / r / c).');
      output = await this.make(action ?? 'help', this.cwd);
      changed = action === 'build' || action === 'clean';
    } else
      throw new UIError('Unknown command: {0}. Enter help to list available commands.', command);
    return { cwd: this.cwd, output, filesChanged: changed };
  }
  async complete(line: string): Promise<string[]> {
    if (!line.includes(' '))
      return [
        'pwd',
        'ls',
        'll',
        'cd',
        'mkdir',
        'touch',
        'cat',
        'cp',
        'mv',
        'rm',
        'clear',
        'help',
        'lpmake',
      ].filter((v) => v.startsWith(line));
    if (/^lpmake\s+\w*$/i.test(line))
      return ['build', 'run', 'clean']
        .filter((v) => v.startsWith(line.trim().split(/\s+/).at(-1)!))
        .map((v) => line.replace(/\w*$/, v));
    const match = line.match(/(?:^|\s)([^\s"']*)$/);
    if (!match) return [];
    const value = match[1],
      folder = path.posix.dirname(value),
      name = path.posix.basename(value);
    try {
      const prefix = this.files.relative(folder === '.' ? '' : folder, this.cwd),
        entries = await this.files.list();
      return entries
        .filter(
          (f) =>
            path.posix.dirname(f.path) === (prefix || '.') &&
            path.posix.basename(f.path).startsWith(name),
        )
        .slice(0, 40)
        .map(
          (f) =>
            line.slice(0, line.length - value.length) +
            JSON.stringify(
              (folder === '.' ? '' : folder + '/') +
                path.posix.basename(f.path) +
                (f.directory ? '/' : ''),
            ),
        );
    } catch {
      return [];
    }
  }
}
