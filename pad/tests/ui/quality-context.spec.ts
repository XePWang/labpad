import { test, expect } from '@playwright/test';
import { qualityFixture as fixture } from './quality-fixture';
import { project } from './selectors.cjs';
async function choose(page: any, lab: string) {
  await project(page).selectOption(lab);
  await expect(page.getByRole('combobox', { name: '实验项目', exact: true })).toHaveAttribute(
    'data-value',
    lab,
  );
  await expect(page.getByRole('combobox', { name: '实验项目', exact: true })).toBeEnabled();
  await expect(page.locator('.tree-file[data-file="' + lab + '.h"]')).toHaveCount(1);
}
async function projects(page: any) {
  await page.evaluate(async () => {
    for (const lab of ['ScopeA', 'ScopeB']) {
      await window.labpad.createLab(lab, 'project');
      await window.labpad.fileOperation(lab, '', {
        action: 'newFile',
        paths: [lab + '.h'],
        content: '// ' + lab + '\n',
      });
    }
  });
  await page.reload();
  await page.locator('.toolbar').waitFor();
  await choose(page, 'ScopeA');
  if (!(await page.locator('.file-tree').isVisible()))
    await page.getByRole('button', { name: '显示文件', exact: true }).click();
}
test('late file opens and file refreshes cannot cross a project or an A-B-A view revision', async () => {
  const { app, page, close } = await fixture();
  try {
    await projects(page);
    await app.evaluate(({ ipcMain }) => {
      const h = (ipcMain as any)._invokeHandlers,
        open = h.get('workspace:open');
      (globalThis as any).__opens = [];
      h.set('workspace:open', async (...args: any[]) => {
        const value = await open(...args);
        if (args[2] === 'ScopeA.h')
          return new Promise((resolve, reject) =>
            (globalThis as any).__opens.push({ resolve, reject, value, args: args.slice(1) }),
          );
        return value;
      });
    });
    await page.locator('.tree-file[data-file="ScopeA.h"]').click();
    await expect.poll(() => app.evaluate(() => (globalThis as any).__opens.length)).toBe(1);
    await choose(page, 'ScopeB');
    await app.evaluate(() =>
      (globalThis as any).__opens[0].resolve((globalThis as any).__opens[0].value),
    );
    await page.waitForTimeout(100);
    await expect(page.locator('.source-tab').filter({ hasText: 'ScopeA.h' })).toHaveCount(0);
    await choose(page, 'ScopeA');
    await page.locator('.tree-file[data-file="ScopeA.h"]').click();
    await expect.poll(() => app.evaluate(() => (globalThis as any).__opens.length)).toBe(2);
    await choose(page, 'ScopeB');
    await choose(page, 'ScopeA');
    await app.evaluate(() => (globalThis as any).__opens[1].reject(Error('OLD_OPEN_FAILURE')));
    await page.waitForTimeout(100);
    await expect(page.locator('.alert.error').filter({ hasText: 'OLD_OPEN_FAILURE' })).toHaveCount(
      0,
    );
    await app.evaluate(({ ipcMain }) => {
      const h = (ipcMain as any)._invokeHandlers,
        old = h.get('workspace:files');
      (globalThis as any).__refresh = undefined;
      h.set('workspace:files', async (...args: any[]) => {
        const value = await old(...args);
        if (args[1] === 'ScopeA' && !(globalThis as any).__refresh)
          return new Promise(
            (resolve) => ((globalThis as any).__refresh = { resolve, value, args: args.slice(1) }),
          );
        return value;
      });
    });
    await page.getByRole('button', { name: '刷新文件', exact: true }).click();
    await expect.poll(() => app.evaluate(() => !!(globalThis as any).__refresh)).toBe(true);
    await choose(page, 'ScopeB');
    await app.evaluate(() => {
      const r = (globalThis as any).__refresh;
      r.resolve(r.value);
    });
    await page.waitForTimeout(100);
    await expect(page.locator('.tree-file[data-file="ScopeB.h"]')).toBeVisible();
    await expect(page.locator('.tree-file[data-file="ScopeA.h"]')).toHaveCount(0);
    const requests = await app.evaluate(() => ({
      open: (globalThis as any).__opens.map((r: any) => r.args),
      refresh: (globalThis as any).__refresh.args,
    }));
    expect(requests.open[0]).toEqual(['ScopeA', 'ScopeA.h', '']);
    expect(requests.refresh).toEqual(['ScopeA', '']);
  } finally {
    await close();
  }
});
test('delayed debug preferences stay with their project and current edits can still be persisted', async () => {
  const { app, page, close } = await fixture();
  try {
    await projects(page);
    await choose(page, 'ScopeB');
    await app.evaluate(({ ipcMain }) => {
      const h = (ipcMain as any)._invokeHandlers,
        old = h.get('native:view');
      (globalThis as any).__prefs = undefined;
      h.set('native:view', async (...args: any[]) => {
        if (args[1] === 'ScopeA' && !args[2])
          return new Promise(
            (resolve, reject) => ((globalThis as any).__prefs = { resolve, reject }),
          );
        return old(...args);
      });
    });
    await choose(page, 'ScopeA');
    await expect.poll(() => app.evaluate(() => !!(globalThis as any).__prefs)).toBe(true);
    await choose(page, 'ScopeB');
    await expect(page.locator('.tree-file[data-file="ScopeB.h"]')).toBeVisible();
    await expect(page.getByRole('combobox', { name: '实验项目', exact: true })).toBeEnabled();
    await page.getByRole('tab', { name: '调试', exact: true }).click();
    await expect(page.locator('.debug-watch-form')).toBeVisible();
    await app.evaluate(() =>
      (globalThis as any).__prefs.resolve({
        breakpoints: [{ path: 'old.c', line: 99, enabled: true }],
        watches: ['OLD_PROJECT_WATCH'],
      }),
    );
    await page.waitForTimeout(100);
    await expect(page.locator('.debug-watch')).toHaveCount(0);
    await expect(page.locator('.native-debug-panel')).not.toContainText('old.c');
    await page.getByRole('textbox', { name: '监视表达式', exact: true }).fill('current_watch');
    await page.getByRole('button', { name: '添加监视', exact: true }).click();
    await expect
      .poll(() => page.evaluate(async () => (await window.labpad.nativeView('ScopeB')).watches))
      .toEqual(['current_watch']);
  } finally {
    await close();
  }
});
test('parameter previews invalidate before the debounce delay, not after a stale reply arrives', async () => {
  const { app, page, close } = await fixture();
  try {
    const time = new Date();
    await page.clock.install({ time });
    await page.clock.pauseAt(time);
    await app.evaluate(({ ipcMain }) => {
      const h = (ipcMain as any)._invokeHandlers,
        old = h.get('build:preview');
      (globalThis as any).__previews = [];
      h.set('build:preview', async (...args: any[]) => {
        const value = await old(...args);
        return new Promise((resolve) => (globalThis as any).__previews.push({ resolve, value }));
      });
    });
    await page.locator('.toolbar button').filter({ hasText: '设置' }).click();
    await page.clock.runFor(200);
    await expect.poll(() => app.evaluate(() => (globalThis as any).__previews.length)).toBe(1);
    await page
      .locator('.settings-dialog summary')
      .filter({ hasText: /^高级编译参数$/ })
      .click();
    await page.getByText('查看生效参数', { exact: false }).click();
    await page.locator('.parameter-settings textarea').first().fill('-std=c17\n-DNEW_INPUT');
    await app.evaluate(() => {
      const p = (globalThis as any).__previews[0];
      p.value.origins = ['STALE_PREVIEW'];
      p.resolve(p.value);
    });
    await page.clock.runFor(10);
    await expect(page.locator('.parameter-preview')).not.toContainText('STALE_PREVIEW');
    await expect(page.locator('.parameter-preview')).toContainText('正在核对');
    await page.clock.runFor(200);
    await expect.poll(() => app.evaluate(() => (globalThis as any).__previews.length)).toBe(2);
    await app.evaluate(() => {
      const p = (globalThis as any).__previews[1];
      p.resolve(p.value);
    });
    await expect(page.locator('.parameter-preview')).toContainText('NEW_INPUT');
    await expect(page.locator('.parameter-preview')).not.toContainText('正在核对');
  } finally {
    await close();
  }
});
