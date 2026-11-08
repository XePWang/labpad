import { test, expect, _electron } from '@playwright/test';
import { withFixtures, closeApplication } from './legacy-flow.cjs';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
async function launch(root: string) {
  return withFixtures(_electron).launch({
    executablePath: process.env.LABPAD_TEST_EXECUTABLE,
    cwd: process.cwd(),
    args: process.env.LABPAD_TEST_EXECUTABLE ? [] : ['.'],
    env: { ...process.env, LABPAD_DATA_DIR: path.join(root, 'data'), LABPAD_SKIP_WARMUP: '1' },
  });
}
async function stop(app: Awaited<ReturnType<typeof launch>>) {
  await closeApplication(app);
}
async function fixture(app: Awaited<ReturnType<typeof launch>>) {
  const page = await app.firstWindow();
  await page.locator('.toolbar').waitFor();
  const files = await page.evaluate(async () => {
    const s = await window.labpad.bootstrap();
    s.config.formatOnSave = false;
    if (navigator.platform.includes('Linux'))
      s.config.compiler = {
        ...s.config.compiler,
        mode: 'custom',
        kind: 'gcc',
        cPath: '/usr/bin/gcc',
        cppPath: '/usr/bin/g++',
      };
    await window.labpad.saveConfig(s.config, s.dataRoot);
    await window.labpad.createLab('RuleFixture', 'problem-set');
    const d = await window.labpad.createProblem('RuleFixture', 'one', 'c');
    d.source = '#include <stdio.h>\nint main(void){puts("NEW");return 0;}\n';
    d.problem.testCases = [{ id: 'one', input: '', expectedOutput: 'OLD' }];
    await window.labpad.saveDraft(d);
    await window.labpad.saveProblem(d.problem);
    await window.labpad.fileOperation('RuleFixture', 'one', {
      action: 'newFile',
      paths: ['helper.h'],
      content: '// header\n',
    });
    await window.labpad.loadDraft('RuleFixture', 'one', 'c');
    const file = (await window.labpad.bootstrap()).sourcePath!;
    return { source: file, rule: file.replace(/\.c$/, '.json') };
  });
  await page.reload();
  await page.locator('.toolbar').waitFor();
  if (!(await page.locator('.file-tree').isVisible()))
    await page.getByRole('button', { name: '显示文件', exact: true }).click();
  return { page, files };
}
test('rule JSON saves update the test panel; source saving and clean auxiliary views retain current rules/results', async () => {
  test.setTimeout(120000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-rule-ui-'));
  const app = await launch(root);
  try {
    const { page, files } = await fixture(app);
    await page.locator('.tree-file[data-file="one.json"]').click();
    await expect(page.locator('.source-tab.active')).toContainText('one.json');
    await expect(page.locator('.cm-content')).toContainText('"expectedOutput": "OLD"');
    await expect(page.getByRole('combobox', { name: '实验项目', exact: true })).toBeEnabled();
    const original = await page.locator('.cm-content').innerText();
    const changed = original.replace('"OLD"', '"NEW"');
    await page.locator('.cm-content').fill(changed);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
    await expect(page.locator('.tab-dirty')).toHaveCount(0);
    await expect(page.locator('.io-pair textarea').nth(1)).toHaveValue('NEW');
    expect(JSON.parse(await readFile(files.rule, 'utf8')).testCases[0].expectedOutput).toBe('NEW');
    await page.locator('.source-tab').filter({ hasText: 'one.c' }).click();
    await expect(page.locator('.source-tab.active')).toContainText('one.c');
    await expect(page.locator('.cm-content')).toContainText('#include');
    await expect(page.getByRole('combobox', { name: '实验项目', exact: true })).toBeEnabled();
    const source = await page.locator('.cm-content').innerText();
    await page.locator('.cm-content').fill(source + '\n// source edit\n');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
    await expect(page.locator('.tab-dirty')).toHaveCount(0);
    expect(JSON.parse(await readFile(files.rule, 'utf8')).testCases[0].expectedOutput).toBe('NEW');
    await page.getByRole('button', { name: '编译', exact: true }).click();
    const run = page.locator('.cases-heading .run-test-icon');
    await expect(run).toBeEnabled({ timeout: 60000 });
    await run.click();
    await expect(page.locator('.verdict.ac')).toHaveCount(1);
    await expect(page.locator('.phase')).toHaveText('测试完成');
    const phase = await page.locator('.phase').innerText();
    for (const name of ['helper.h', 'one.json', 'one.c']) {
      if (name === 'helper.h') await page.locator('.tree-file[data-file="helper.h"]').click();
      else await page.locator('.source-tab').filter({ hasText: name }).click();
      await expect(page.locator('.phase')).toHaveText(phase);
      await expect(page.locator('.verdict.ac')).toHaveCount(1);
      await expect(run).toBeEnabled();
      await expect(page.locator('.tab-dirty')).toHaveCount(0);
    }
    await page.locator('.source-tab').filter({ hasText: 'one.json' }).click();
    await expect(page.locator('.cm-content')).toContainText('"schemaVersion"');
    await page.locator('.cm-content').fill('{broken');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
    await expect(page.getByRole('alert')).toBeVisible();
    expect(JSON.parse(await readFile(files.rule, 'utf8')).testCases[0].expectedOutput).toBe('NEW');
    await page.locator('.cm-content').fill(changed.replace('"NEW"', '"JSON_EDIT"'));
    await page.locator('.io-pair textarea').nth(1).fill('FORM_EDIT');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
    await expect(page.getByRole('alert')).toContainText('均有修改');
    expect(JSON.parse(await readFile(files.rule, 'utf8')).testCases[0].expectedOutput).toBe('NEW');
    await expect(page.locator('.cm-content')).toContainText('JSON_EDIT');
    await expect(page.locator('.io-pair textarea').nth(1)).toHaveValue('FORM_EDIT');
  } finally {
    await stop(app);
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
test('saving form changes updates a clean rule tab and closing saves only the actual pending edits', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-rule-close-'));
  const app = await launch(root);
  try {
    const { page, files } = await fixture(app);
    await page.locator('.tree-file[data-file="one.json"]').click();
    await expect(page.locator('.source-tab.active')).toContainText('one.json');
    await expect(page.locator('.cm-content')).toContainText('"expectedOutput": "OLD"');
    await expect(page.getByRole('combobox', { name: '实验项目', exact: true })).toBeEnabled();
    await page.locator('.io-pair textarea').nth(1).fill('NEW');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('menuitem', { name: '保存全部', exact: true }).click();
    await expect(page.locator('.tab-dirty')).toHaveCount(0);
    await expect(page.locator('.cm-content')).toContainText('"NEW"');
    await page.locator('.io-pair textarea').nth(1).fill('CLOSE_EDIT');
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (...args: any[]) => {
        const o = args.at(-1);
        return { response: Math.max(0, o.buttons.indexOf('保存')), checkboxChecked: false };
      };
    });
    // Wait until the renderer's pending-rule baseline has reached the main process.
    await page.evaluate(() => window.labpad.bootstrap());
    const closed = app.waitForEvent('close');
    await app
      .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
      .catch(() => {});
    await closed;
    expect(JSON.parse(await readFile(files.rule, 'utf8')).testCases[0].expectedOutput).toBe(
      'CLOSE_EDIT',
    );
  } finally {
    await stop(app);
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
test('an existing Git directory remains hidden across refresh and a real application restart', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-git-start-'));
  let app = await launch(root);
  try {
    const page = await app.firstWindow();
    await page.locator('.toolbar').waitFor();
    const directory = await page.evaluate(async () => {
      await window.labpad.createLab('GitFixture', 'project');
      return (await window.labpad.bootstrap()).workspace!.scope;
    });
    await mkdir(path.join(directory, '.git'));
    await writeFile(path.join(directory, '.git/config'), '[core]\nrepositoryformatversion = 0\n');
    await stop(app);
    app = await launch(root);
    const reopened = await app.firstWindow();
    await reopened.locator('.toolbar').waitFor();
    await expect(reopened.getByRole('alert')).toHaveCount(0);
    if (!(await reopened.locator('.file-tree').isVisible()))
      await reopened.getByRole('button', { name: '显示文件', exact: true }).click();
    expect(await reopened.locator('.tree-file[data-file="main.c"]').count()).toBe(1);
    expect(await reopened.locator('.tree-file[data-file^=".git"]').count()).toBe(0);
    await reopened.getByRole('button', { name: '刷新文件', exact: true }).click();
    await expect(reopened.getByRole('alert')).toHaveCount(0);
  } finally {
    await stop(app);
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
