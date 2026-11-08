import { test, expect, _electron } from '@playwright/test';
import { withFixtures } from './legacy-flow.cjs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('sidebars preserve state and focus, share motion settings and use the same primary colors', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-interface-'));
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
        return { response: options.buttons.indexOf('保存并编译'), checkboxChecked: false };
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
      await window.labpad.createLab('InterfaceA', 'project');
      await window.labpad.fileOperation('InterfaceA', '', {
        action: 'newFolder',
        paths: ['nested'],
      });
      await window.labpad.fileOperation('InterfaceA', '', {
        action: 'newFile',
        paths: ['nested/helper.h'],
        content: 'int helper;',
      });
      await window.labpad.createLab('InterfaceB', 'project');
      await window.labpad.loadDraft('InterfaceA', '', 'c');
    });
    await page.reload();
    await page.locator('.toolbar').waitFor();
    await page
      .locator('.cm-content')
      .fill('#include <stdio.h>\nint main(void){puts("ok");return 0;}\n');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('menuitem', { name: '保存全部', exact: true }).click();
    await page.getByRole('button', { name: '＋ 新增测试点', exact: true }).click();
    await page.getByRole('textbox', { name: '预期输出 1', exact: true }).fill('ok\n');
    const sidebar = page.locator('.file-tree'),
      panel = page.locator('.cases-pane');
    if (!(await sidebar.isVisible()))
      await page.getByRole('button', { name: '显示文件', exact: true }).click();
    await page.locator('[data-file="nested"]').click();
    await expect(page.locator('[data-file="nested/helper.h"]')).toBeVisible();
    const savedWidth = Math.round((await sidebar.boundingBox())!.width);
    await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
    await expect(sidebar).toBeHidden();
    await expect(page.getByRole('button', { name: '显示文件', exact: true })).toBeFocused();
    await page.getByRole('button', { name: '显示文件', exact: true }).click();
    await expect(page.locator('[data-file="nested/helper.h"]')).toBeVisible();
    await expect
      .poll(async () => Math.round((await sidebar.boundingBox())!.width))
      .toBe(savedWidth);
    await page.getByRole('tab', { name: '调试', exact: true }).click();
    const variables = page.locator('.native-debug-panel details').first();
    await variables.locator('summary').click();
    await expect(variables).not.toHaveAttribute('open', '');
    await page.getByRole('button', { name: '收起右区', exact: true }).click();
    await expect(page.getByRole('button', { name: '展开右区', exact: true })).toBeFocused();
    expect(await panel.count()).toBe(1);
    await expect(panel).toHaveAttribute('inert', '');
    await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(0);
    await page.getByRole('button', { name: '展开右区', exact: true }).click();
    await expect(page.getByRole('button', { name: '收起右区', exact: true })).toBeFocused();
    await expect(variables).not.toHaveAttribute('open', '');
    await expect(panel).not.toHaveAttribute('inert', '');
    const duration = await panel.evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(duration).toContain('0.16s');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect
      .poll(() => panel.evaluate((el) => getComputedStyle(el).transitionDuration))
      .toContain('0s');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('tab', { name: '测试点', exact: true }).click();
    await page.getByRole('button', { name: '编译', exact: true }).click();
    const run = page.locator('.cases-heading .run-test-icon');
    try {
      await expect(run).toBeEnabled({ timeout: 10000 });
    } catch (e) {
      console.log(
        'COMPILE FAILURE',
        await page.locator('.phase').innerText(),
        await page.locator('.output-log').innerText(),
        await page.locator('body').innerText(),
      );
      throw e;
    }
    for (const theme of ['dark', 'light']) {
      // Exercise the semantic palette independently of any platform accent.
      await page
        .locator('.app-shell')
        .evaluate((el, value) => el.setAttribute('data-theme', value), theme);
      await page.mouse.move(0, 0);
      await expect
        .poll(async () => {
          const compileColor = await page
            .getByRole('button', { name: '编译', exact: true })
            .evaluate((el) => getComputedStyle(el).backgroundColor);
          return (
            (await run.evaluate((el) => getComputedStyle(el).backgroundColor)) === compileColor
          );
        })
        .toBe(true);
      expect(await run.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');
      expect(Math.round((await run.boundingBox())!.width)).toBe(28);
      await page.getByRole('button', { name: '编译', exact: true }).hover();
      const hoverColor = await page
        .getByRole('button', { name: '编译', exact: true })
        .evaluate((el) => getComputedStyle(el).getPropertyValue('--action-hover').trim());
      const resolved = await page.evaluate((color) => {
        const el = document.createElement('i');
        el.style.color = color;
        document.body.append(el);
        const result = getComputedStyle(el).color;
        el.remove();
        return result;
      }, hoverColor);
      await run.hover();
      await expect
        .poll(() => run.evaluate((el) => getComputedStyle(el).backgroundColor))
        .toBe(resolved);
    }
    await run.click();
    await expect(page.locator('.verdict.ac')).toHaveCount(1);
    await expect(page.locator('.test-summary')).toHaveClass(/all-passed/);
    await expect
      .poll(async () => {
        const color = await page
          .locator('.test-summary')
          .evaluate((el) => getComputedStyle(el).backgroundColor);
        return (
          color !== 'rgba(0, 0, 0, 0)' &&
          color ===
            (await page
              .locator('.case-card')
              .evaluate((el) => getComputedStyle(el).backgroundColor))
        );
      })
      .toBe(true);
    await page.screenshot({ path: path.resolve('../.work/dev9-repair/interface-state.png') });
    await page.getByRole('combobox', { name: '实验项目', exact: true }).click();
    await page.getByRole('option', { name: /^InterfaceB/ }).click();
    await expect(page.locator('.test-summary')).not.toHaveClass(/all-passed/);
    await expect(page.locator('.verdict.ac')).toHaveCount(0);
    const main = page.locator('.source-tab').filter({ hasText: 'main.c' });
    await main.click();
    await page.locator('.cm-content').fill('int main(void){return 7;}');
    const pending = await page.evaluate(async () =>
      window.labpad.terminalCommand((await window.labpad.bootstrap()).draft, 'lpmake b'),
    );
    expect(pending.needsSave).toBe(true);
    await expect(page.getByRole('button', { name: '编译', exact: true })).toBeEnabled();
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('same relative filenames in different projects cannot share undo history', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-history-scope-'));
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
        return { response: options.buttons.indexOf('不保存'), checkboxChecked: false };
      };
    });
    await page.evaluate(async () => {
      const state = await window.labpad.bootstrap();
      state.config.formatOnSave = false;
      await window.labpad.saveConfig(state.config, state.dataRoot);
      for (const name of ['HistoryA', 'HistoryB']) {
        await window.labpad.createLab(name, 'project');
        const file = await window.labpad.workspaceOpen(name, 'main.c');
        file.source = 'int ' + name + ';\n';
        await window.labpad.saveDraft(file);
      }
      await window.labpad.loadDraft('HistoryA', '', 'c');
    });
    await page.reload();
    await page.locator('.toolbar').waitFor();
    const editor = page.locator('.cm-content');
    if (!(await editor.innerText()).includes('HistoryA'))
      await page.locator('.source-tab').filter({ hasText: 'main.c' }).click();
    await editor.fill('int PRIVATE_TO_A;\n');
    await page.getByRole('combobox', { name: '实验项目', exact: true }).click();
    await page.getByRole('option', { name: 'HistoryB', exact: false }).click();
    await expect(editor).toContainText('HistoryB');
    await editor.focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(editor).toContainText('HistoryB');
    await expect(editor).not.toContainText('PRIVATE_TO_A');
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
