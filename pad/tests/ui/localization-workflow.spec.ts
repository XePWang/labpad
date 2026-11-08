import { test, expect } from '@playwright/test';
import { qualityFixture } from './quality-fixture';
import { writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

test('English project import, judging, error recovery, terminal and export stay usable', async () => {
  const { app, page, root, close } = await qualityFixture();
  try {
    const input = path.join(root, 'english.project.json'),
      output = path.join(root, 'submission.zip');
    await writeFile(
      input,
      JSON.stringify({
        schemaVersion: 2,
        kind: 'labpad.project',
        mode: 'project',
        labId: 'English Lab',
        build: { system: 'lpmake', file: 'LPMake.txt' },
        files: [
          {
            path: 'LPMake.txt',
            content: 'target("app")\nset_standard("c17")\nset_mode("debug")\nadd_files("./*.c")\n',
          },
          { path: 'main.c', content: '#include <stdio.h>\nint main(void){puts("0");return 0;}\n' },
        ],
        tests: { testCases: [{ id: 'answer', input: '', expectedOutput: '42\n' }] },
      }),
    );
    await app.evaluate(
      ({ dialog }, files) => {
        (globalThis as any).__englishInput = files.input;
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [(globalThis as any).__englishInput],
        });
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: files.output });
        dialog.showMessageBox = async (...args: any[]) => {
          const buttons = args.at(-1).buttons as string[];
          const copy = buttons.findIndex((label) => /copy/i.test(label));
          const confirm = buttons.findIndex((label) =>
            ['Import', 'Save and Compile', 'Don’t Save'].includes(label),
          );
          return {
            response: copy >= 0 ? copy : confirm >= 0 ? confirm : (args.at(-1).defaultId ?? 0),
            checkboxChecked: false,
          };
        };
      },
      { input, output },
    );
    await page.locator('.settings-button').click();
    await page.getByLabel('界面语言', { exact: true }).selectOption('en-US');
    for (const [label, value] of [
      ['Class', '9527'],
      ['Name', 'Alex Chen'],
      ['Student ID', '7355608'],
    ])
      await page.getByLabel(label, { exact: true }).fill(value);
    await page
      .locator('.settings-dialog')
      .getByRole('button', { name: 'Save Settings', exact: true })
      .click();
    async function menu(name: string, item: string) {
      await page.getByRole('button', { name, exact: true }).click();
      await page.getByRole('menuitem', { name: item, exact: true }).click();
    }
    await menu('Import', 'Import Experiment');
    const compile = page.getByRole('button', { name: 'Compile', exact: true });
    await expect(page.locator('[data-lab-selector]')).toHaveText('English Lab');
    await expect(compile).toBeEnabled();
    await page
      .locator('.cm-content')
      .fill('#include <stdio.h>\nint main(void){puts("42");return 0;}\n');
    await menu('Save', 'Save All');
    await expect(page.locator('.tab-dirty')).toHaveCount(0);
    await compile.click();
    const run = page.locator('.cases-heading .run-test-icon');
    await expect(run).toBeEnabled({ timeout: 150000 });
    await run.click();
    await expect(page.locator('.verdict.ac')).toHaveCount(1);
    await expect(compile).toBeEnabled();
    await menu('Import', 'Import Test Cases');
    await expect(page.getByRole('alert')).toContainText('Import Experiment');
    expect(await page.getByRole('alert').innerText()).not.toMatch(
      /[\u4e00-\u9fff]|Error invoking remote method/,
    );
    await page.getByRole('alert').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(run).toBeEnabled();
    await page.getByRole('button', { name: 'Terminal', exact: true }).click();
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.insertText('help');
    await page.keyboard.press('Enter');
    await expect(page.locator('.terminal-viewport')).toContainText('Quote paths');
    await menu('Export', 'Export Experiment');
    await expect(page.locator('.export-dialog')).toBeVisible();
    expect(await page.locator('.export-dialog').innerText()).not.toMatch(/[\u4e00-\u9fff]/);
    await page.locator('.export-dialog').getByRole('button', { name: 'Next', exact: true }).click();
    const force = page.getByRole('button', { name: 'Export Anyway', exact: true });
    if (await force.isVisible()) await force.click();
    await expect
      .poll(() =>
        stat(output)
          .then((s) => s.size)
          .catch(() => 0),
      )
      .toBeGreaterThan(100);
  } finally {
    await close();
  }
});
