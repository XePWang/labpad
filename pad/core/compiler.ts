import { snapshotEntries } from './workspace-files';
import type { WorkspaceSnapshot } from '../shared/workspace';
import { usedLanguages, standaloneSource, type CompilerContext } from './build/plan';
import { parse } from '../shared/lpmake';
import { assertParameters } from '../shared/parameters';
import { withDefaultStandard } from '../shared/defaults';
import { mkdtemp, mkdir, writeFile, readFile, access, rm, stat, realpath } from 'node:fs/promises';
import { CompilerCache } from './cache';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runProcess } from './process';
import { compilerEnvironment } from './toolchains';
import type { CompilerConfig, Language, Compilation, Draft } from '../shared/types';
export interface RuntimePaths {
  toolchain: string;
  checkers: string;
  processHost?: string;
  cacheDirectory?: string;
  workDirectory?: string;
  isolation?: 'bubblewrap' | 'none';
}
export interface Prepared {
  resources?: Record<string, string>;
  binaryResources?: Record<string, string>;
  snapshotRoot?: string;
  buildDirectory?: string;
  runDirectory?: string;
  compilation: Compilation;
  executable: string;
  directory: string;
  cleanup(): Promise<void>;
}
export class Compiler {
  private readonly targets = new Map<string, Promise<string>>();
  readonly session: Promise<string>;
  readonly cache: CompilerCache;
  constructor(readonly paths: RuntimePaths) {
    this.session = (async () => {
      const base = paths.workDirectory ?? tmpdir();
      await mkdir(base, { recursive: true });
      return mkdtemp(path.join(base, 'labpad-runtime-' + process.pid + '-'));
    })();
    this.cache = new CompilerCache(
      this.paths.cacheDirectory ??
        path.join(tmpdir(), 'labpad-compiler-cache-' + (process.getuid?.() ?? 'user')),
    );
  }
  async environment(config?: CompilerConfig): Promise<NodeJS.ProcessEnv> {
    const root = await this.session;
    const cache = this.cache.directory;
    await mkdir(cache, { recursive: true });
    return {
      ...(config ? compilerEnvironment(process.env, config) : process.env),
      LANG: process.platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8',
      LC_ALL: process.platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8',
      ZIG_GLOBAL_CACHE_DIR: cache,
      ZIG_LOCAL_CACHE_DIR: path.join(cache, 'local'),
    };
  }
  resolve(config: CompilerConfig, language: Language): { program: string; prefix: string[] } {
    const zig = config.mode === 'builtin' || config.kind === 'zig';
    const program =
      config.mode === 'builtin'
        ? path.join(this.paths.toolchain, process.platform === 'win32' ? 'zig.exe' : 'zig')
        : language === 'c'
          ? config.cPath
          : config.cppPath || (config.kind === 'zig' ? config.cPath : '');
    if (!program)
      throw new Error('请在设置中指定' + (language === 'c' ? 'C' : 'C++') + '编译器可执行文件');
    return { program, prefix: zig ? [language === 'c' ? 'cc' : 'c++'] : [] };
  }
  async identity(config: CompilerConfig, language: Language): Promise<string> {
    try {
      const file = await realpath(this.resolve(config, language).program),
        info = await stat(file);
      return JSON.stringify([file, info.size, info.mtimeMs]);
    } catch {
      return 'unavailable';
    }
  }
  async identityFor(draft: Draft, config: CompilerConfig): Promise<string> {
    const languages = usedLanguages(draft);
    if (languages.length === 1) return this.identity(config, languages[0]);
    return JSON.stringify(
      await Promise.all(
        languages.map(async (language) => [language, await this.identity(config, language)]),
      ),
    );
  }
  async info(config: CompilerConfig, language: Language = 'c'): Promise<string> {
    const { program } = this.resolve(config, language);
    const kind = config.mode === 'builtin' ? 'zig' : config.kind;
    const r = await runProcess(program, kind === 'zig' ? ['version'] : ['--version'], {
      cwd: await this.session,
      timeLimitMs: 10000,
      outputLimitBytes: 32768,
      env: await this.environment(config),
      processHost: this.paths.processHost,
    });
    if (r.reason || r.code !== 0)
      throw new Error('无法读取编译器版本：' + r.stderr.toString('utf8'));
    return (
      (config.mode === 'builtin' ? '内置 Zig ' : '自定义 ') +
      (r.stdout.toString('utf8').split(/\r?\n/)[0] || kind)
    );
  }
  async assertNative(config: CompilerConfig, language: Language, args: string[]) {
    if (config.mode !== 'builtin' && config.kind !== 'zig') return;
    const program = this.resolve(config, language).program;
    let marker: any;
    try {
      marker = JSON.parse(
        await readFile(path.join(path.dirname(program), 'labpad-native.json'), 'utf8'),
      );
    } catch {
      return;
    }
    if (!marker.nativeOnly) return;
    const allowed: Record<string, RegExp> = {
      'win-x64': /^x86_64-(?:windows|w64-mingw32|pc-windows)(?:-|$)/,
      'linux-x64': /^x86_64-(?:unknown-)?linux(?:-|$)/,
      'mac-arm64': /^(?:aarch64|arm64)-(?:apple-)?(?:macos|darwin)(?:-|$)/,
    };
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      let target: string | undefined;
      if (arg === '-target' || arg === '--target') target = args[++i];
      else if (/^--?target=/.test(arg)) target = arg.slice(arg.indexOf('=') + 1);
      if (target && target !== 'native' && !allowed[marker.target]?.test(target))
        throw Error(
          '内置工具链仅支持本机目标（' +
            marker.target +
            '）。交叉编译请在设置中选择完整的自定义 Zig 工具链。',
        );
    }
  }
  async forDraft(draft: Draft, config: CompilerConfig): Promise<CompilerContext> {
    if (!draft.workspace) return config;
    let spec: ReturnType<typeof parse>['spec'];
    try {
      spec = parse(standaloneSource(draft, config)).spec;
    } catch {
      return config;
    }
    if (!spec.links.includes('m')) return config;
    let explicit: string | undefined;
    for (let i = 0; i < spec.ldflags.length; i++) {
      const value = spec.ldflags[i];
      if (value === '-target' || value === '--target') explicit = spec.ldflags[++i];
      else if (value.startsWith('--target=') || value.startsWith('-target='))
        explicit = value.slice(value.indexOf('=') + 1);
    }
    if (explicit) return { ...config, linkTarget: explicit };
    const language = usedLanguages(draft).includes('cpp') ? 'cpp' : 'c',
      key = await this.identity(config, language);
    if (!this.targets.has(key))
      this.targets.set(
        key,
        (async () => {
          try {
            const driver = this.resolve(config, language),
              result = await runProcess(driver.program, [...driver.prefix, '-dumpmachine'], {
                cwd: await this.session,
                timeLimitMs: 5000,
                outputLimitBytes: 4096,
                env: await this.environment(config),
                processHost: this.paths.processHost,
              });
            return result.code === 0 ? result.stdout.toString('utf8').trim() : '';
          } catch {
            return '';
          }
        })(),
      );
    return { ...config, linkTarget: explicit ?? (await this.targets.get(key)) };
  }
  async compile(
    source: string,
    language: Language,
    config: CompilerConfig,
    signal?: AbortSignal,
    input?: { snapshot: WorkspaceSnapshot; file: string },
  ): Promise<Prepared> {
    await this.assertNative(config, language, [
      ...(language === 'c' ? config.cArgs : config.cppArgs),
      ...config.linkArgs,
    ]);
    assertParameters(
      language === 'c' ? config.cArgs : config.cppArgs,
      language === 'c' ? 'C 参数' : 'C++ 参数',
    );
    assertParameters(config.linkArgs, '链接参数');
    const directory = await mkdtemp(path.join(await this.session, 'run-'));
    const executable = path.join(
      directory,
      process.platform === 'win32' ? 'program.exe' : 'program',
    );
    const cleanup = () =>
      rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    let release: (() => Promise<void>) | undefined;
    try {
      if (config.mode === 'builtin' || config.kind === 'zig') {
        release = await this.cache.acquire(signal);
        await this.cache.trim();
      }
      signal?.throwIfAborted();
      if (input)
        for (const [name, bytes] of Object.entries(snapshotEntries(input.snapshot))) {
          const file = path.join(directory, name);
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(file, bytes);
        }
      const sourcePath = path.join(
        directory,
        input?.file ?? 'main.' + (language === 'c' ? 'c' : 'cpp'),
      );
      await mkdir(path.dirname(sourcePath), { recursive: true });
      await writeFile(sourcePath, source.replace(/^\uFEFF/, ''), 'utf8');
      const { program, prefix } = this.resolve(config, language);
      const args = [
        ...prefix,
        ...withDefaultStandard(language === 'c' ? config.cArgs : config.cppArgs, language),
        '-x',
        language === 'c' ? 'c' : 'c++',
        sourcePath,
        '-x',
        'none',
        ...config.linkArgs,
        '-o',
        executable,
      ];
      const r = await runProcess(program, args, {
        cwd: directory,
        timeLimitMs: 120000,
        outputLimitBytes: 524288,
        signal,
        env: await this.environment(config),
        processHost: this.paths.processHost,
      });
      if (r.reason && r.reason !== 'cancelled')
        throw new Error(r.reason === 'timeout' ? '编译工具运行超时' : '编译工具输出超过上限');
      const compilation: Compilation = {
        status: r.reason === 'cancelled' ? 'cancelled' : r.code === 0 ? 'success' : 'CE',
        stdout: r.stdout.toString('utf8'),
        stderr: r.stderr.toString('utf8') + (r.stderrTruncated ? '\n[stderr 已截断]' : ''),
        command: [program, ...args],
        elapsedMs: r.elapsedMs,
      };
      if (compilation.status === 'success') {
        try {
          await access(executable);
        } catch {
          throw new Error('编译器没有生成可执行文件，请检查编译参数');
        }
      }
      return {
        compilation,
        executable,
        directory,
        cleanup,
        ...(input
          ? {
              resources: input.snapshot.files,
              binaryResources: input.snapshot.binaryFiles,
              snapshotRoot: directory,
            }
          : {}),
      };
    } catch (error) {
      await cleanup();
      throw error;
    } finally {
      await release?.();
    }
  }
  async dispose() {
    await rm(await this.session, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
