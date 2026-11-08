import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Socket } from 'node:net';
import { EventEmitter } from 'node:events';
import { DapConnection, type DapMessage } from './connection';
import { killTree } from '../process';
import type {
  NativeDebugState,
  SourceBreakpoint,
  DebugVariable,
  DebugFrame,
} from '../../shared/debug';
export interface DebugLaunch {
  adapter: string;
  program: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  sourceMap?: Record<string, string>;
  breakpoints: SourceBreakpoint[];
  runInTerminal?: (args: {
    args: string[];
    cwd: string;
    env?: Record<string, string | null>;
  }) => Promise<{ processId: number; shellProcessId?: number }>;
}
export class NativeDebugger extends EventEmitter {
  state: NativeDebugState = {
    status: 'idle',
    frames: [],
    scopes: [],
    variables: [],
    breakpoints: [],
    conditionalBreakpoints: false,
  };
  readonly finished: Promise<void>;
  private finish!: () => void;
  private done = false;
  private connection?: DapConnection;
  private child?: ChildProcess;
  private inspection = 0;
  private log = '';
  private disposing = false;
  private disposal?: Promise<void>;
  constructor() {
    super();
    this.finished = new Promise((resolve) => (this.finish = resolve));
  }
  private update(value: Partial<NativeDebugState>) {
    this.state = { ...this.state, ...value };
    this.emit('state', structuredClone(this.state));
  }
  private end(status: 'ended' | 'error', message?: string) {
    if (this.done) return;
    this.done = true;
    this.inspection++;
    this.update({
      status,
      message: message ?? this.state.message,
      frames: [],
      scopes: [],
      variables: [],
    });
    this.finish();
  }
  async start(options: DebugLaunch) {
    if (this.state.status !== 'idle') throw Error('Debugger session has already started.');
    this.update({ status: 'starting', breakpoints: options.breakpoints });
    const server = createServer();
    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const connected = new Promise<Socket>((resolve, reject) => {
        server.once('connection', (socket) => {
          if (connectTimer) clearTimeout(connectTimer);
          resolve(socket);
          server.close();
        });
        connectTimer = setTimeout(
          () => reject(Error('Debugger startup timed out. ' + this.log)),
          15000,
        );
      });
      const port = (server.address() as { port: number }).port;
      const child = (this.child = spawn(options.adapter, ['--connect', String(port)], {
        cwd: options.cwd,
        env: { ...options.env, PYTHONDONTWRITEBYTECODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      }));
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      const log = (data: string) => {
        this.log = (this.log + data).slice(-65536);
      };
      child.stdout?.on('data', log);
      child.stderr?.on('data', log);
      child.once('error', (error) => this.end('error', error.message));
      child.once('exit', (code) => {
        if (!this.disposing)
          this.end(code === 0 ? 'ended' : 'error', this.log || 'Debugger exited with code ' + code);
      });
      const socket = await connected;
      const connection = (this.connection = new DapConnection(socket, async (command, args) => {
        if (command !== 'runInTerminal' || !options.runInTerminal)
          throw Error('Unsupported debugger request: ' + command);
        if (
          !args ||
          !Array.isArray(args.args) ||
          !args.args.length ||
          !args.args.every((v: unknown) => typeof v === 'string')
        )
          throw Error('Invalid debugger terminal launch.');
        return options.runInTerminal(args);
      }));
      connection.on('closed', (error: Error) => {
        if (!this.disposing && !this.done) this.end('error', error.message);
      });
      let initialized!: () => void;
      const initialization = new Promise<void>((resolve) => (initialized = resolve));
      connection.on('event', (event: DapMessage) => {
        if (event.event === 'initialized') initialized();
        void this.event(event);
      });
      const capabilities = await connection.request('initialize', {
        clientID: 'labpad',
        clientName: 'LabPad',
        adapterID: 'lldb',
        pathFormat: 'path',
        linesStartAt1: true,
        columnsStartAt1: true,
        supportsVariableType: true,
        supportsVariablePaging: true,
        supportsRunInTerminalRequest: !!options.runInTerminal,
      });
      this.update({ conditionalBreakpoints: capabilities.supportsConditionalBreakpoints === true });
      const launch = connection.request('launch', {
        program: options.program,
        cwd: options.cwd,
        env: options.env,
        terminal: options.runInTerminal ? 'integrated' : 'console',
        expressions: 'native',
        sourceLanguages: ['c', 'cpp'],
        sourceMap: options.sourceMap,
        stopOnEntry: false,
      });
      void launch.catch(() => {});
      await Promise.race([
        initialization,
        launch.then(
          () => {},
          (error) => Promise.reject(error),
        ),
      ]);
      await this.setBreakpoints(options.breakpoints);
      await connection.request('configurationDone');
      await launch;
      if ((this.state as NativeDebugState).status === 'starting')
        this.update({ status: 'running' });
    } catch (error) {
      this.end('error', error instanceof Error ? error.message : String(error));
      await this.dispose();
      throw error;
    } finally {
      if (connectTimer) clearTimeout(connectTimer);
      server.close();
    }
  }
  private async event(message: DapMessage) {
    const body = message.body ?? {};
    if (message.event === 'output') {
      this.emit(
        body.category === 'stdout' || body.category === 'stderr' ? 'output' : 'diagnostic',
        String(body.output ?? ''),
      );
      return;
    }
    if (message.event === 'process') {
      this.update({ processId: body.systemProcessId });
      return;
    }
    if (message.event === 'continued') {
      this.inspection++;
      this.update({ status: 'running', frames: [], scopes: [], variables: [] });
      return;
    }
    if (message.event === 'terminated') {
      this.end('ended');
      return;
    }
    if (message.event === 'exited') {
      this.update({ message: 'Exit code ' + body.exitCode });
      return;
    }
    if (message.event === 'breakpoint' && body.breakpoint) {
      const b = body.breakpoint,
        items = this.state.breakpoints.map((p) =>
          p.adapterId === b.id
            ? { ...p, verified: !!b.verified, resolvedLine: b.line ?? p.line, message: b.message }
            : p,
        );
      this.update({ breakpoints: items });
      return;
    }
    if (message.event === 'stopped') {
      this.update({
        status: 'paused',
        threadId: body.threadId,
        message: body.description ?? body.text ?? body.reason,
      });
      try {
        const stack = await this.connection!.request('stackTrace', {
          threadId: body.threadId,
          startFrame: 0,
          levels: 40,
        });
        if (this.state.status !== 'paused') return;
        const frames: DebugFrame[] = (stack.stackFrames ?? []).map((f: any) => ({
          id: f.id,
          name: f.name,
          path: f.source?.path,
          line: f.line,
          column: f.column,
        }));
        this.update({ frames });
        if (frames[0]) await this.selectFrame(frames[0].id);
      } catch (error) {
        if (this.state.status === 'paused')
          this.update({ message: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  async selectFrame(id: number) {
    if (this.state.status !== 'paused') throw Error('The program is not paused.');
    const epoch = ++this.inspection;
    const result = await this.connection!.request('scopes', { frameId: id });
    if (epoch !== this.inspection || this.state.status !== 'paused') return;
    const scopes = (result.scopes ?? []).map((s: any) => ({
      name: s.name,
      variablesReference: s.variablesReference,
      expensive: !!s.expensive,
    }));
    this.update({ selectedFrameId: id, scopes, variables: [] });
    const first = scopes.find((s: any) => !s.expensive) ?? scopes[0];
    if (first) {
      const variables = await this.variables(first.variablesReference);
      if (epoch === this.inspection && this.state.status === 'paused') this.update({ variables });
    }
  }
  async variables(reference: number, start = 0): Promise<DebugVariable[]> {
    if (this.state.status !== 'paused') throw Error('The program is not paused.');
    const result = await this.connection!.request('variables', {
      variablesReference: reference,
      start,
      count: 100,
    });
    return (result.variables ?? [])
      .slice(0, 100)
      .map((v: any) => ({
        name: v.name,
        value: v.value,
        type: v.type,
        variablesReference: v.variablesReference,
        namedVariables: v.namedVariables,
        indexedVariables: v.indexedVariables,
        evaluateName: v.evaluateName,
      }));
  }
  async evaluate(expression: string): Promise<DebugVariable> {
    if (this.state.status !== 'paused') throw Error('The program is not paused.');
    // Watch refreshes read expressions only; user functions and mutation are explicit debugger operations.
    if (
      !expression.trim() ||
      /[;{}]|(?:^|[^=!<>])=(?!=)|(?:\+\+|--)|[A-Za-z_]\w*\s*\(/.test(expression)
    )
      throw Error('Use a read-only expression such as value, item.member or values[index].');
    const value = await this.connection!.request('evaluate', {
      expression,
      frameId: this.state.selectedFrameId,
      context: 'watch',
    });
    return {
      name: expression,
      value: value.result,
      type: value.type,
      variablesReference: value.variablesReference,
      namedVariables: value.namedVariables,
      indexedVariables: value.indexedVariables,
    };
  }
  async setBreakpoints(values: SourceBreakpoint[], deferred: string[] = []) {
    if (values.some((v) => !Number.isSafeInteger(v.line) || v.line < 1))
      throw Error('Invalid breakpoint line.');
    const previous = this.state.breakpoints;
    this.update({
      breakpoints: values.map((v) => ({ ...v, verified: false, adapterId: undefined })),
    });
    if (!this.connection) return;
    const paths = new Set([...previous, ...values].map((v) => v.path)),
      items = this.state.breakpoints.map((v) => ({ ...v }));
    for (const file of paths) {
      const selected = items.filter((v) => v.path === file && v.enabled);
      if (deferred.includes(file)) {
        for (const p of selected) p.message = 'Source changed; restart to apply this breakpoint.';
        continue;
      }
      if (selected.some((v) => !!v.condition) && !this.state.conditionalBreakpoints)
        throw Error('The debugger does not support conditional breakpoints.');
      const result = await this.connection.request('setBreakpoints', {
        source: { path: file },
        breakpoints: selected.map((v) => ({
          line: v.line,
          ...(v.condition ? { condition: v.condition } : {}),
        })),
        sourceModified: false,
      });
      for (const [i, p] of selected.entries()) {
        const b = result.breakpoints?.[i];
        p.verified = !!b?.verified;
        p.adapterId = b?.id;
        p.resolvedLine = b?.line;
        p.message = b?.message;
      }
    }
    this.update({ breakpoints: items });
  }
  async control(action: 'continue' | 'pause' | 'next' | 'stepIn' | 'stepOut') {
    if (!this.connection || this.done) throw Error('No active debugger session.');
    let threadId = this.state.threadId;
    if (action === 'pause') {
      const result = await this.connection.request('threads');
      threadId = result.threads?.[0]?.id ?? threadId;
    } else if (this.state.status !== 'paused') throw Error('The program is not paused.');
    const before = this.state,
      epoch = ++this.inspection;
    if (action !== 'pause')
      this.update({ status: 'running', frames: [], scopes: [], variables: [] });
    try {
      return await this.connection.request(action, { threadId: threadId ?? 0 });
    } catch (error) {
      if (epoch === this.inspection) this.update(before);
      throw error;
    }
  }
  async stop() {
    if (this.connection && !this.done)
      try {
        await this.connection.request(
          'disconnect',
          { restart: false, terminateDebuggee: true },
          2500,
        );
      } catch {}
    this.end('ended', 'Debugging stopped.');
    await this.dispose();
  }
  async dispose() {
    if (this.disposal) return this.disposal;
    this.disposing = true;
    this.disposal = (async () => {
      this.connection?.close();
      this.connection = undefined;
      const child = this.child;
      this.child = undefined;
      if (child?.pid) {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill();
          await Promise.race([
            new Promise<void>((r) => child.once('exit', () => r())),
            new Promise<void>((r) => setTimeout(r, 500)),
          ]);
        }
        await killTree(child.pid).catch(() => {});
      }
      this.end('ended');
      this.removeAllListeners();
    })();
    return this.disposal;
  }
}
