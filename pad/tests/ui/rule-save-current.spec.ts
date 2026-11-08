import { test, expect, _electron } from '@playwright/test';
import { withFixtures, closeApplication } from './legacy-flow.cjs';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
test('a clean rule tab saves form-only changes with Save Current and as the only tab with Save All', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-rule-current-'));
  const app = await withFixtures(_electron).launch({
    executablePath: process.env.LABPAD_TEST_EXECUTABLE,
    cwd: process.cwd(),
    args: process.env.LABPAD_TEST_EXECUTABLE ? [] : ['.'],
    env: { ...process.env, LABPAD_DATA_DIR: path.join(root, 'data'), LABPAD_SKIP_WARMUP: '1' },
  });
  try {
    const page = await app.firstWindow();
    await page.locator('.toolbar').waitFor();
    const file = await page.evaluate(async () => {
      await window.labpad.createLab('RuleCurrent', 'problem-set');
      const d = await window.labpad.createProblem('RuleCurrent', 'one', 'c');
      d.problem.testCases = [{ id: 'one', input: '', expectedOutput: 'OLD' }];
      await window.labpad.saveProblem(d.problem);
      await window.labpad.loadDraft('RuleCurrent', 'one', 'c');
      return (await window.labpad.bootstrap()).sourcePath!.replace(/\.c$/, '.json');
    });
    await page.reload();
    await page.locator('.toolbar').waitFor();
    if (!(await page.locator('.file-tree').isVisible()))
      await page.getByRole('button', { name: '显示文件', exact: true }).click();
    await page.locator('.tree-file[data-file="one.json"]').click();
    await page.locator('.io-pair textarea').nth(1).fill('CURRENT');
    await expect(page.locator('.tab-dirty')).toHaveCount(0);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
    await expect(page.locator('.cm-content')).toContainText('"CURRENT"');
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(JSON.parse(await readFile(file, 'utf8')).testCases[0].expectedOutput).toBe('CURRENT');
    await page.locator('.source-tab').filter({ hasText: 'one.json' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: '关闭其他', exact: true }).click();
    await expect(page.locator('.source-tab')).toHaveCount(1);
    await page.locator('.io-pair textarea').nth(1).fill('ALL');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('menuitem', { name: '保存全部', exact: true }).click();
    await expect(page.locator('.cm-content')).toContainText('"ALL"');
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(JSON.parse(await readFile(file, 'utf8')).testCases[0].expectedOutput).toBe('ALL');
  } finally {
    await closeApplication(app);
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
