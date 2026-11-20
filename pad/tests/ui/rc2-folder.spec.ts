import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { qualityFixture } from './quality-fixture';

test('folder import uses a separate picker, keeps the workspace on error, and restores an experiment', async () => {
  const { app, page, root, close } = await qualityFixture();
  const outer = path.join(root, '课程资料');
  const project = path.join(outer, '实验题集');
  const wrong = path.join(root, '下载目录');
  try {
    await mkdir(project, { recursive: true });
    await mkdir(wrong);
    await writeFile(path.join(outer, 'Thumbs.db'), '');
    await writeFile(path.join(project, 'main.c'), 'int main(void) { return 7; }\n');
    await writeFile(
      path.join(project, 'labpad.project.json'),
      JSON.stringify({
        schemaVersion: 2,
        kind: 'labpad.project',
        mode: 'problem-set',
        labId: '文件夹实验',
        problems: [
          {
            problemId: '1',
            sourceFile: 'main.c',
            testCases: [{ id: 'sample', input: '', expectedOutput: '' }],
          },
        ],
      }),
    );
    await app.evaluate(({ dialog }, file) => {
      const state = ((globalThis as any).__folderImport = {
        file,
        picker: undefined as Electron.OpenDialogOptions | undefined,
        message: undefined as Electron.MessageBoxOptions | undefined,
      });
      dialog.showOpenDialog = (async (_win, options) => {
        state.picker = options;
        return { canceled: !state.file, filePaths: state.file ? [state.file] : [] };
      }) as typeof dialog.showOpenDialog;
      dialog.showMessageBox = (async (_win, options) => {
        state.message = options;
        return { response: options.cancelId ?? 0, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
    }, wrong);
    const choose = async (name: string) => {
      await page.locator('.toolbar').getByRole('button', { name: '导入', exact: true }).click();
      await page.getByRole('menuitem', { name, exact: true }).click();
    };
    await choose('导入实验文件夹…');
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__folderImport.message?.detail))
      .toContain('labpad.project.json');
    expect(
      await page.evaluate(async () =>
        (await window.labpad.projects()).some((p) => p.labId === '文件夹实验'),
      ),
    ).toBe(false);
    expect(await app.evaluate(() => (globalThis as any).__folderImport.picker.properties)).toEqual([
      'openDirectory',
    ]);
    await app.evaluate((_, file) => {
      (globalThis as any).__folderImport.file = file;
    }, outer);
    await choose('导入实验文件夹…');
    await expect(page.locator('.cm-content')).toContainText('return 7;');
    await expect(page.locator('.case-card')).toHaveCount(1);
    await app.evaluate(() => {
      (globalThis as any).__folderImport.file = '';
    });
    await choose('导入实验项目…');
    await expect
      .poll(() =>
        app.evaluate(() =>
          (globalThis as any).__folderImport.picker.filters?.map((f: any) => f.extensions),
        ),
      )
      .toEqual([['zip', 'json'], ['zip'], ['json']]);
    await expect(page.locator('.cm-content')).toContainText('return 7;');
  } finally {
    await close();
  }
});
