import { test, expect, _electron } from '@playwright/test';
import { withFixtures, closeApplication } from './legacy-flow.cjs';
import { project } from './selectors.cjs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-async-ui-'));
  const app = await withFixtures(_electron).launch({
    executablePath: process.env.LABPAD_TEST_EXECUTABLE,
    cwd: process.cwd(),
    args: process.env.LABPAD_TEST_EXECUTABLE ? [] : ['.'],
    env: { ...process.env, LABPAD_DATA_DIR: path.join(root, 'data'), LABPAD_SKIP_WARMUP: '1' },
  });
  const page = await app.firstWindow();
  await page.locator('.toolbar').waitFor();
  return {
    app,
    page,
    close: async () => {
      await closeApplication(app);
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}
const terminalText = (page: any) => page.locator('.xterm-rows').innerText();
async function settle(page: any) {
  // Allow the intentionally delayed IPC reply and its renderer microtasks to drain.
  await page.waitForTimeout(100);
}
test('terminal completions cannot cross projects, prompt sessions, or same-text input revisions', async () => {
  const { app, page, close } = await fixture();
  try {
    await page.evaluate(async () => {
      await window.labpad.createLab('ScopeA', 'project');
      await window.labpad.createLab('ScopeB', 'project');
    });
    await page.reload();
    await page.locator('.toolbar').waitFor();
    await project(page).selectOption('ScopeA');
    await expect.poll(() => project(page).inputValue()).toBe('ScopeA');
    const scopeA = await page.evaluate(
      async () => (await window.labpad.bootstrap()).workspace!.scope,
    );
    await page.getByRole('button', { name: '终端', exact: true }).click();
    await expect(page.getByRole('combobox', { name: '实验项目', exact: true })).toBeEnabled();
    await expect.poll(() => terminalText(page)).toContain('>');
    await app.evaluate(({ ipcMain }) => {
      (globalThis as any).__completions = [];
      (ipcMain as any)._invokeHandlers.set(
        'terminal:complete',
        (_: unknown, text: string, context: any) =>
          new Promise((resolve, reject) =>
            (globalThis as any).__completions.push({ text, context, resolve, reject }),
          ),
      );
    });
    const input = page.locator('.terminal-viewport textarea');
    async function request(index: number) {
      await input.focus();
      await page.keyboard.press('Tab');
      await expect
        .poll(() => app.evaluate(() => (globalThis as any).__completions.length))
        .toBe(index + 1);
    }
    await input.focus();
    await page.keyboard.insertText('cat al');
    await request(0);
    await project(page).selectOption('ScopeB');
    await expect.poll(() => project(page).inputValue()).toBe('ScopeB');
    const scopeB = await page.evaluate(
      async () => (await window.labpad.bootstrap()).workspace!.scope,
    );
    await expect(page.getByRole('combobox', { name: '实验项目', exact: true })).toBeEnabled();
    await input.focus();
    await page.keyboard.insertText('cat al');
    await app.evaluate(() =>
      (globalThis as any).__completions[0].resolve(['cat "alpha-from-A.c"']),
    );
    await settle(page);
    expect(await terminalText(page)).not.toContain('alpha-from-A.c');
    await request(1);
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText('l');
    await app.evaluate(() =>
      (globalThis as any).__completions[1].resolve(['cat "stale-after-edit.c"']),
    );
    await settle(page);
    expect(await terminalText(page)).not.toContain('stale-after-edit.c');
    await request(2);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    await app.evaluate(() =>
      (globalThis as any).__completions[2].resolve(['cat "stale-after-cursor.c"']),
    );
    await settle(page);
    expect(await terminalText(page)).not.toContain('stale-after-cursor.c');
    await request(3);
    await page.keyboard.press('Control+c');
    await expect.poll(() => terminalText(page)).toContain('^C');
    await input.focus();
    await page.keyboard.insertText('cat al');
    await app.evaluate(() =>
      (globalThis as any).__completions[3].reject(Error('OLD_COMPLETION_ERROR')),
    );
    await settle(page);
    expect(await terminalText(page)).not.toContain('OLD_COMPLETION_ERROR');
    await request(4);
    await app.evaluate(() =>
      (globalThis as any).__completions[4].resolve(['cat "alpha-current.c"']),
    );
    await expect.poll(() => terminalText(page)).toContain('alpha-current.c');
    const contexts = await app.evaluate(() =>
      (globalThis as any).__completions.map((r: any) => r.context),
    );
    expect(contexts[0].scope).toBe(scopeA);
    expect(contexts[1].scope).toBe(scopeB);
    expect(scopeA).not.toBe(scopeB);
    expect(contexts[1].cwd).toBe('');
  } finally {
    await close();
  }
});
test('late variable successes, failures and finally blocks never update a newer paused frame', async () => {
  const { app, page, close } = await fixture();
  try {
    await page.evaluate(() => window.labpad.createLab('DebugRace', 'project'));
    await page.reload();
    await page.locator('.toolbar').waitFor();
    const scope = (await page.evaluate(() => window.labpad.bootstrap())).workspace!.scope;
    const state = (frame: number, variables: any[], local: number, global: number) => ({
      scope,
      inspectionId: 'session:' + frame,
      status: 'paused',
      threadId: 1,
      frames: [],
      scopes: [
        { name: 'Local', variablesReference: local, expensive: false },
        { name: 'Global', variablesReference: global, expensive: true },
      ],
      variables,
      breakpoints: [],
      selectedFrameId: frame,
      conditionalBreakpoints: true,
    });
    const emit = (value: any) =>
      app.evaluate(
        ({ BrowserWindow }, data) =>
          BrowserWindow.getAllWindows()[0].webContents.send('native:state', data),
        value,
      );
    await emit(state(1, [{ name: 'current', value: '1', variablesReference: 0 }], 1, 2));
    await page.getByRole('tab', { name: '调试', exact: true }).click();
    await expect(page.locator('.debug-variable-name')).toHaveText(['current']);
    await app.evaluate(({ ipcMain }) => {
      (globalThis as any).__variables = [];
      (ipcMain as any)._invokeHandlers.set(
        'native:variables',
        (_: unknown, reference: number, start: number, inspection: string) =>
          new Promise((resolve, reject) =>
            (globalThis as any).__variables.push({ reference, start, inspection, resolve, reject }),
          ),
      );
    });
    const requests = () => app.evaluate(() => (globalThis as any).__variables.length);
    await page.getByRole('combobox', { name: '变量作用域', exact: true }).selectOption('2');
    await expect.poll(requests).toBe(1);
    await emit(state(2, [{ name: 'new_frame', value: '2', variablesReference: 0 }], 11, 12));
    await app.evaluate(() =>
      (globalThis as any).__variables[0].resolve([
        { name: 'OLD_GLOBAL', value: 'stale', variablesReference: 0 },
      ]),
    );
    await settle(page);
    await expect(page.getByRole('combobox', { name: '变量作用域', exact: true })).toHaveValue('11');
    await expect(page.locator('.debug-variable-name')).toHaveText(['new_frame']);
    await expect(page.locator('.native-debug-panel .debug-placeholder').first()).not.toContainText(
      '暂停后查看变量',
    );
    await emit(
      state(3, [{ name: 'node', value: '{}', variablesReference: 7, namedVariables: 1 }], 21, 22),
    );
    await page.getByRole('button', { name: '展开 node', exact: true }).click();
    await expect.poll(requests).toBe(2);
    await emit(
      state(4, [{ name: 'node', value: '{}', variablesReference: 7, namedVariables: 1 }], 31, 32),
    );
    const expand = page.locator('.debug-expander[aria-label="展开 node"]');
    await expect(expand).toBeEnabled();
    await expand.click();
    await expect.poll(requests).toBe(3);
    await app.evaluate(() =>
      (globalThis as any).__variables[1].resolve([
        { name: 'OLD_CHILD', value: 'stale', variablesReference: 0 },
      ]),
    );
    await settle(page);
    await expect(expand).toBeDisabled();
    await expect(page.locator('.debug-variable-name')).toHaveText(['node']);
    await app.evaluate(() =>
      (globalThis as any).__variables[2].resolve([
        { name: 'NEW_CHILD', value: 'current', variablesReference: 0 },
      ]),
    );
    await expect(page.locator('.debug-variable-name')).toHaveText(['node', 'NEW_CHILD']);
    await page.getByRole('combobox', { name: '变量作用域', exact: true }).selectOption('32');
    await expect.poll(requests).toBe(4);
    await emit(state(5, [{ name: 'latest', value: '5', variablesReference: 0 }], 41, 42));
    await app.evaluate(() => (globalThis as any).__variables[3].reject(Error('OLD_SCOPE_FAILURE')));
    await settle(page);
    await expect(page.locator('.debug-variable-name')).toHaveText(['latest']);
    await expect(page.locator('.native-debug-panel')).not.toContainText('OLD_SCOPE_FAILURE');
    const inspections = await app.evaluate(() =>
      (globalThis as any).__variables.map((r: any) => r.inspection),
    );
    expect(inspections).toEqual(['session:1', 'session:3', 'session:4', 'session:4']);
    await app.evaluate(({ ipcMain }) => {
      (ipcMain as any)._invokeHandlers.set(
        'native:watch',
        () =>
          new Promise((resolve) => {
            (globalThis as any).__watchReply = resolve;
          }),
      );
    });
    await page.getByRole('textbox', { name: '监视表达式', exact: true }).fill('watched');
    await page.getByRole('button', { name: '添加监视', exact: true }).click();
    await expect
      .poll(() => app.evaluate(() => typeof (globalThis as any).__watchReply))
      .toBe('function');
    await emit({ ...state(5, [], 41, 42), status: 'stop-failed' });
    await app.evaluate(() =>
      (globalThis as any).__watchReply({
        name: 'watched',
        value: 'OLD_WATCH',
        variablesReference: 0,
      }),
    );
    await settle(page);
    await expect(page.locator('.native-debug-panel')).not.toContainText('OLD_WATCH');
  } finally {
    await close();
  }
});
