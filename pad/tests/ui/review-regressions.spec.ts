import { test, expect, _electron } from '@playwright/test';
import { withFixtures } from './legacy-flow.cjs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('explicit target compiles B after activation persistence fails and an auxiliary tab is selected', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-review-target-'));
  const app = await withFixtures(_electron).launch({
    executablePath: process.env.LABPAD_TEST_EXECUTABLE,
    cwd: process.cwd(),
    args: process.env.LABPAD_TEST_EXECUTABLE ? [] : ['.'],
    env: { ...process.env, LABPAD_DATA_DIR: path.join(root, 'data'), LABPAD_SKIP_WARMUP: '1' },
  });
  try {
    const page = await app.firstWindow();
    await page.locator('.toolbar').waitFor();
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (...args: any[]) => {
        const options = args.at(-1);
        return {
          response: Math.max(0, options.buttons.indexOf('保存并编译')),
          checkboxChecked: false,
        };
      };
    });
    const source = await page.evaluate(async () => {
      const state = await window.labpad.bootstrap();
      state.config.formatOnSave = false;
      if (navigator.platform.includes('Linux'))
        state.config.compiler = {
          ...state.config.compiler,
          mode: 'custom',
          kind: 'gcc',
          cPath: '/usr/bin/gcc',
          cppPath: '/usr/bin/g++',
        };
      await window.labpad.saveConfig(state.config, state.dataRoot);
      await window.labpad.createLab('TargetFixture', 'problem-set');
      let a = await window.labpad.createProblem('TargetFixture', 'one', 'c');
      a.source = '#include <stdio.h>\nint main(void){puts("A");return 0;}\n';
      a.problem.testCases = [{ id: 'one', input: '', expectedOutput: 'B\n' }];
      await window.labpad.saveDraft(a);
      a = await window.labpad.loadDraft('TargetFixture', 'one', 'c');
      const b = await window.labpad.newVersion(
        { ...a, source: a.source.replace('"A"', '"B"') },
        false,
      );
      await window.labpad.activateDocument(a.documentId!);
      await window.labpad.loadDraft('TargetFixture', 'one', 'c');
      await window.labpad.fileOperation('TargetFixture', 'one', {
        action: 'newFile',
        paths: ['helper.h'],
        content: '// header\n',
      });
      return { file: b.file!, id: b.documentId! };
    });
    await page.reload();
    await page.locator('.toolbar').waitFor();
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as any)._invokeHandlers,
        original = handlers.get('document:activate');
      handlers.set('document:activate', (...args: any[]) => {
        handlers.set('document:activate', original);
        throw Error('Injected activation write failure');
      });
    });
    await page.locator('.source-tab').filter({ hasText: source.file }).click();
    await expect(page.getByRole('alert')).toContainText('Injected activation write failure');
    if (!(await page.locator('.file-tree').isVisible()))
      await page.getByRole('button', { name: '显示文件', exact: true }).click();
    await page.locator('.tree-file[data-file="helper.h"]').click();
    await page.getByRole('button', { name: '编译', exact: true }).click();
    const run = page.locator('.cases-heading .run-test-icon');
    await expect(run).toBeEnabled({ timeout: 60000 });
    const target = (await page.evaluate(() => window.labpad.bootstrap())).draft.target;
    expect(target?.mode).toBe('problem-set');
    expect(target?.mode === 'problem-set' && target.documentId).toBe(source.id);
    await run.click();
    await expect(page.locator('.verdict.ac')).toHaveCount(1);
    await expect(page.locator('.actual-output')).toHaveText('B\n');
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('dirty file rename preserves editor history and reconciles breakpoint paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-review-paths-'));
  const app = await withFixtures(_electron).launch({
    executablePath: process.env.LABPAD_TEST_EXECUTABLE,
    cwd: process.cwd(),
    args: process.env.LABPAD_TEST_EXECUTABLE ? [] : ['.'],
    env: { ...process.env, LABPAD_DATA_DIR: path.join(root, 'data'), LABPAD_SKIP_WARMUP: '1' },
  });
  try {
    const page = await app.firstWindow();
    await page.locator('.toolbar').waitFor();
    await page.evaluate(async () => {
      const state = await window.labpad.bootstrap();
      state.config.formatOnSave = false;
      await window.labpad.saveConfig(state.config, state.dataRoot);
      await window.labpad.createLab('PathFixture', 'project');
      await window.labpad.nativeView('PathFixture', {
        breakpoints: [{ path: 'main.c', line: 3, enabled: true, condition: 'value==1' }],
        watches: [],
      });
    });
    await page.reload();
    await page.locator('.toolbar').waitFor();
    const editor = page.locator('.cm-content');
    const original = await editor.innerText();
    await editor.fill(original + '\n// unsaved edit');
    await page.evaluate(() =>
      window.labpad.fileOperation('PathFixture', '', {
        action: 'rename',
        paths: ['main.c'],
        destination: 'renamed.c',
      }),
    );
    await expect(page.locator('.source-tab.active')).toContainText('renamed.c');
    await expect(editor).toContainText('// unsaved edit');
    await expect(page.locator('.source-tab.active .tab-dirty')).toHaveCount(1);
    const state = await page.evaluate(() => window.labpad.nativeView('PathFixture'));
    expect(state.breakpoints).toEqual([
      { path: 'renamed.c', line: 3, enabled: true, condition: 'value==1', verified: false },
    ]);
    await page.getByRole('tab', { name: '调试', exact: true }).click();
    await expect(page.locator('.native-debug-panel')).toContainText('renamed.c');
    await editor.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(editor).not.toContainText('// unsaved edit');
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('terminal prompt follows shared topic cwd, directory changes and late command results', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-review-terminal-'));
  const app = await withFixtures(_electron).launch({
    executablePath: process.env.LABPAD_TEST_EXECUTABLE,
    cwd: process.cwd(),
    args: process.env.LABPAD_TEST_EXECUTABLE ? [] : ['.'],
    env: { ...process.env, LABPAD_DATA_DIR: path.join(root, 'data'), LABPAD_SKIP_WARMUP: '1' },
  });
  try {
    const page = await app.firstWindow();
    await page.locator('.toolbar').waitFor();
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (...args: any[]) => {
        const options = args.at(-1);
        return { response: Math.max(0, options.buttons.indexOf('删除')), checkboxChecked: false };
      };
    });
    await page.evaluate(async () => {
      await window.labpad.createLab('TerminalFixture', 'problem-set');
      await window.labpad.createProblem('TerminalFixture', 'one', 'c');
      await window.labpad.createProblem('TerminalFixture', 'two', 'c');
      const first = await window.labpad.loadDraft('TerminalFixture', 'one', 'c');
      await window.labpad.terminalCommand(first, 'mkdir inner');
      await window.labpad.terminalCommand(first, 'cd inner');
      await window.labpad.createLab('OtherFixture', 'problem-set');
      await window.labpad.createProblem('OtherFixture', 'other', 'c');
      await window.labpad.loadDraft('TerminalFixture', 'one', 'c');
    });
    await page.reload();
    await page.locator('.toolbar').waitFor();
    await page.getByRole('button', { name: '终端', exact: true }).click();
    const rows = page.locator('.xterm-rows');
    await expect(rows).toContainText('./inner >');
    await page.getByRole('combobox', { name: '题号', exact: true }).click();
    await page.getByRole('option').filter({ hasText: 'two' }).click();
    await expect(page.getByRole('combobox', { name: '题号', exact: true })).toContainText('two');
    const context = await page.evaluate(async () =>
      window.labpad.terminalContext((await window.labpad.bootstrap()).draft),
    );
    expect(context.cwd).toBe('inner');
    await expect(rows).toContainText('./inner >');
    const input = page.locator('.xterm-helper-textarea');
    await input.focus();
    await page.keyboard.type('touch ');
    await expect(rows).toContainText('./inner > touch');
    await page.evaluate(() =>
      window.labpad.fileOperation('TerminalFixture', 'two', {
        action: 'rename',
        paths: ['inner'],
        destination: 'renamed',
      }),
    );
    await expect(rows).toContainText('./renamed > touch');
    await page.keyboard.type('marker.txt');
    await page.keyboard.press('Enter');
    await expect
      .poll(async () =>
        (await page.evaluate(() => window.labpad.workspaceFiles('TerminalFixture'))).some(
          (file) => file.path === 'renamed/marker.txt',
        ),
      )
      .toBe(true);
    await page.evaluate(() =>
      window.labpad.fileOperation('TerminalFixture', 'two', {
        action: 'delete',
        paths: ['renamed'],
      }),
    );
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(async () =>
              window.labpad.terminalContext((await window.labpad.bootstrap()).draft),
            )
          ).cwd,
      )
      .toBe('');
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as any)._invokeHandlers,
        original = handlers.get('terminal:command');
      (globalThis as any).__lateCommand = false;
      (globalThis as any).__lateStarted = false;
      handlers.set('terminal:command', async (...args: any[]) => {
        if (args.at(-1) === 'pwd') (globalThis as any).__lateStarted = true;
        const result = await original(...args);
        if (args.at(-1) === 'pwd') {
          await new Promise((resolve) => setTimeout(resolve, 700));
          (globalThis as any).__lateCommand = true;
        }
        return result;
      });
    });
    await input.focus();
    await expect
      .poll(async () =>
        (await page.locator('.xterm-rows>div').allTextContents())
          .map((text) => text.trim())
          .filter(Boolean)
          .at(-1),
      )
      .toBe('./ >');
    await page.keyboard.type('pwd');
    await page.keyboard.press('Enter');
    await expect.poll(() => app.evaluate(() => (globalThis as any).__lateStarted)).toBe(true);
    await page.getByRole('combobox', { name: '实验项目', exact: true }).click();
    await page.getByRole('option').filter({ hasText: 'OtherFixture' }).click();
    await expect(page.getByRole('combobox', { name: '实验项目', exact: true })).toContainText(
      'OtherFixture',
    );
    await expect.poll(() => app.evaluate(() => (globalThis as any).__lateCommand)).toBe(true);
    await expect
      .poll(async () =>
        (await page.locator('.xterm-rows>div').allTextContents())
          .map((text) => text.trim())
          .filter(Boolean)
          .at(-1),
      )
      .toBe('./ >');
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('native debugger releases task ownership after temporary cleanup fails', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-review-cleanup-'));
  const app = await withFixtures(_electron).launch({
    executablePath: process.env.LABPAD_TEST_EXECUTABLE,
    cwd: process.cwd(),
    args: process.env.LABPAD_TEST_EXECUTABLE ? [] : ['.'],
    env: { ...process.env, LABPAD_DATA_DIR: path.join(root, 'data'), LABPAD_SKIP_WARMUP: '1' },
  });
  try {
    const page = await app.firstWindow();
    await page.locator('.toolbar').waitFor();
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (...args: any[]) => {
        const options = args.at(-1);
        const label = options.buttons.includes('保存并编译')
          ? '保存并编译'
          : options.buttons.includes('继续调试')
            ? '继续调试'
            : '不保存';
        return { response: Math.max(0, options.buttons.indexOf(label)), checkboxChecked: false };
      };
    });
    await page.evaluate(async () => {
      const state = await window.labpad.bootstrap();
      state.config.formatOnSave = false;
      if (navigator.platform.includes('Linux'))
        state.config.compiler = {
          ...state.config.compiler,
          mode: 'custom',
          kind: 'gcc',
          cPath: '/usr/bin/gcc',
          cppPath: '/usr/bin/g++',
        };
      await window.labpad.saveConfig(state.config, state.dataRoot);
      await window.labpad.createLab('CleanupFixture', 'project');
    });
    await page.reload();
    await page.locator('.toolbar').waitFor();
    await page
      .locator('.cm-content')
      .fill('int main(void){\n int value=1;\n value++;\n return value-2;\n}\n');
    await page.locator('.source-debug-gutter .cm-gutterElement').nth(3).click();
    await page.getByRole('tab', { name: '调试', exact: true }).click();
    await page.getByRole('button', { name: '开始调试', exact: true }).click();
    await expect(page.locator('.phase')).toHaveText('调试已暂停', { timeout: 60000 });
    await app.evaluate(() => {
      const fs = process.getBuiltinModule('node:fs/promises') as any;
      (globalThis as any).__cleanupOriginal = fs.rm;
      (globalThis as any).__cleanupFailures = 0;
      fs.rm = async (...args: any[]) => {
        if (
          !(globalThis as any).__cleanupFailures &&
          String(args[0]).includes('labpad-runtime-') &&
          /[\/]project-[^\/]+$/.test(String(args[0]))
        ) {
          (globalThis as any).__cleanupFailures++;
          throw Error('Injected temporary cleanup failure');
        }
        return (globalThis as any).__cleanupOriginal(...args);
      };
    });
    await page.getByRole('button', { name: '停止调试', exact: true }).click();
    await expect(page.getByRole('button', { name: '编译', exact: true })).toBeEnabled();
    expect(await app.evaluate(() => (globalThis as any).__cleanupFailures)).toBe(1);
    await app.evaluate(() => {
      (process.getBuiltinModule('node:fs/promises') as any).rm = (
        globalThis as any
      ).__cleanupOriginal;
    });
    await page.evaluate(() => window.labpad.nativeStop());
    const compilation = await page.evaluate(async () =>
      window.labpad.compile((await window.labpad.bootstrap()).draft),
    );
    expect(compilation.status).toBe('success');
    await page.getByRole('button', { name: '开始调试', exact: true }).click();
    await expect(page.locator('.phase')).toHaveText('调试已暂停', { timeout: 60000 });
    await page.getByRole('button', { name: '停止调试', exact: true }).click();
    await expect(page.getByRole('button', { name: '编译', exact: true })).toBeEnabled();
  } finally {
    await app
      .evaluate(() => {
        if ((globalThis as any).__cleanupOriginal)
          (process.getBuiltinModule('node:fs/promises') as any).rm = (
            globalThis as any
          ).__cleanupOriginal;
      })
      .catch(() => {});
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
