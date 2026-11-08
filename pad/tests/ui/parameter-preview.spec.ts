import { openSettings } from './settings-helper.cjs';
import { test, expect, _electron } from '@playwright/test';
import { withFixtures } from './legacy-flow.cjs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

for (const mode of ['problem-set', 'project'] as const)
  test('settings parameter preview serializes reactive options in ' + mode, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-preview-'));
    const app = await withFixtures(_electron).launch({
      executablePath: process.env.LABPAD_TEST_EXECUTABLE,
      cwd: process.cwd(),
      args: process.env.LABPAD_TEST_EXECUTABLE ? [] : ['.'],
      env: { ...process.env, LABPAD_DATA_DIR: path.join(root, 'data'), LABPAD_SKIP_WARMUP: '1' },
    });
    try {
      const page = await app.firstWindow();
      await page.locator('.toolbar').waitFor();
      await page.evaluate(async (mode) => {
        const state = await window.labpad.bootstrap();
        if (navigator.platform.includes('Linux'))
          state.config.compiler = {
            ...state.config.compiler,
            mode: 'custom',
            kind: 'gcc',
            cPath: '/usr/bin/gcc',
            cppPath: '/usr/bin/g++',
          };
        await window.labpad.saveConfig(state.config, state.dataRoot);
        await window.labpad.createLab('PreviewFixture', mode);
        if (mode === 'problem-set') await window.labpad.createProblem('PreviewFixture', 'one', 'c');
      }, mode);
      await page.reload();
      await page.locator('.toolbar').waitFor();
      const before = await page.evaluate(() => window.labpad.bootstrap());
      await openSettings(page);
      const settings = page.getByRole('dialog', { name: '设置', exact: true });
      await settings.locator('summary').filter({ hasText: '高级编译参数' }).click();
      const panel = settings.locator('.parameter-settings'),
        preview = panel.locator('.parameter-preview');
      await preview.locator('summary').click();
      await expect(preview).toContainText('c17');
      await expect(preview).toContainText('-Wall');
      await expect(panel.locator('.source-diagnostic')).toHaveCount(0);
      const source = panel.getByRole('combobox', { name: '参数来源', exact: true });
      if (mode === 'problem-set') {
        await expect(source).toHaveValue('global');
        await panel
          .getByRole('textbox', { name: 'C 参数', exact: true })
          .fill('-std=c11\n-DPREVIEW_ONLY=7');
        await expect(preview).toContainText('-DPREVIEW_ONLY=7');
        await expect(preview).toContainText('c11');
        await source.selectOption('project');
        await panel
          .getByRole('textbox', { name: 'C 参数', exact: true })
          .fill('-std=c17\n-DPROJECT_PREVIEW=9');
        await expect(preview).toContainText('-DPROJECT_PREVIEW=9');
        await expect(preview).not.toContainText('-DPREVIEW_ONLY=7');
      } else {
        await expect(source).toBeDisabled();
        await expect(source).toHaveValue('project');
        await expect(panel.getByRole('textbox', { name: 'C 参数', exact: true })).toHaveCount(0);
        await expect(preview).toContainText('LPMake.txt');
      }
      await expect(panel.locator('.source-diagnostic')).toHaveCount(0);
      await settings.getByRole('button', { name: '取消', exact: true }).click();
      const after = await page.evaluate(() => window.labpad.bootstrap());
      expect(after.config.compiler).toEqual(before.config.compiler);
    } finally {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await app.close().catch(() => {});
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
