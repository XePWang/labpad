import type { UIError } from '../shared/i18n';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { NativeDebugger } from '../core/debug/session';
const target =
  (process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux') +
  '-' +
  process.arch;
const adapter = path.resolve(
  '../.work/debuggers',
  target,
  'adapter',
  process.platform === 'win32' ? 'codelldb.exe' : 'codelldb',
);
const wait = async (check: () => boolean, timeout = 15000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error('Debugger state timeout');
};
test(
  'offline debugger pauses on native conditions, reads locals and stops the owned program',
  { skip: !existsSync(adapter), timeout: 45000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-dap-中文 ')),
      debug = new NativeDebugger(),
      source = path.join(root, 'main.c'),
      program = path.join(root, process.platform === 'win32' ? 'program.exe' : 'program');
    const text =
      '#include <stdio.h>\nint main(void){\n int sum=0;\n for(int i=0;i<5;i++){\n  sum+=i;\n  printf("value=%d\\n",sum);\n }\n return 0;\n}\n';
    try {
      await writeFile(source, text);
      execFileSync(
        process.platform === 'win32' ? path.resolve('../.work/toolchains/win-x64/zig.exe') : 'gcc',
        process.platform === 'win32'
          ? ['cc', '-g', '-O0', source, '-o', program]
          : ['-g', '-O0', source, '-o', program],
      );
      await debug.start({
        adapter,
        program,
        cwd: root,
        env: process.env,
        breakpoints: [{ path: source, line: 6, enabled: true, condition: 'i == 3' }],
      });
      await wait(() => debug.state.status === 'paused' && debug.state.variables.length > 0);
      assert.equal(debug.state.conditionalBreakpoints, true);
      assert.ok(debug.state.breakpoints[0].verified);
      assert.equal(debug.state.frames[0].line, 6);
      assert.equal((await debug.evaluate('i')).value, '3');
      assert.equal((await debug.evaluate('sum')).value, '6');
      await assert.rejects(
        debug.evaluate('i++'),
        (error: UIError) =>
          error.localization?.key ===
          'Use a read-only expression such as value, item.member or values[index].',
      );
      assert.equal((await debug.evaluate('i == 3')).value, 'true');
      const pid = debug.state.processId;
      await debug.stop();
      assert.ok(['ended', 'error'].includes(debug.state.status));
      if (pid)
        await wait(() => {
          try {
            process.kill(pid, 0);
            return false;
          } catch {
            return true;
          }
        });
    } finally {
      await debug.dispose();
      await rm(root, { recursive: true, force: true });
    }
  },
);
test(
  'staged offline debugger reads C++ strings with the bundled runtime',
  { skip: !existsSync(adapter) || process.platform !== 'linux', timeout: 45000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-dap-cpp-')),
      debug = new NativeDebugger(),
      source = path.join(root, 'main.cpp'),
      program = path.join(root, 'program');
    try {
      await writeFile(
        source,
        '#include <string>\n#include <iostream>\nint main(){\n std::string text="hello";\n int sum=0;\n for(int i=0;i<5;i++){\n  sum+=i;\n  std::cout << text << sum << std::endl;\n }\n return 0;\n}\n',
      );
      execFileSync('g++', ['-std=c++20', '-g', '-O0', source, '-o', program]);
      await debug.start({
        adapter,
        program,
        cwd: root,
        env: process.env,
        breakpoints: [{ path: source, line: 8, enabled: true, condition: 'i == 2' }],
      });
      await wait(() => debug.state.status === 'paused' && debug.state.variables.length > 0);
      assert.equal((await debug.evaluate('i')).value, '2');
      const value = await debug.evaluate('text');
      assert.match(value.value, /hello/);
      await debug.setBreakpoints([{ path: source, line: 8, enabled: false, condition: 'i == 2' }]);
      await debug.control('next');
      await wait(
        () =>
          debug.state.status === 'paused' &&
          debug.state.frames.length > 0 &&
          debug.state.frames[0].line !== 8,
      );
      await debug.control('continue');
      await debug.finished;
      assert.equal(debug.state.status, 'ended');
    } finally {
      await debug.dispose();
      await rm(root, { recursive: true, force: true });
    }
  },
);
