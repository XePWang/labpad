import { withFixtures } from './legacy-flow.cjs';
import { test, expect, _electron } from '@playwright/test';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { clipboardGuard } = createRequire(import.meta.url)('./editor-scenario.cjs');
import os from 'node:os';
import path from 'node:path';
test('dev9 file selection, copy/cut, inline target, internal and external drag', async () => {
  test.setTimeout(90000);
  const restore = await clipboardGuard('LabPad-dev9-files');
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-files-ui-')),
    app = await withFixtures(_electron).launch({
      executablePath: process.env.LABPAD_TEST_EXECUTABLE,
      args: process.env.LABPAD_TEST_EXECUTABLE ? [] : ['.'],
      cwd: process.cwd(),
      env: { ...process.env, LABPAD_DATA_DIR: path.join(root, 'data'), LABPAD_SKIP_WARMUP: '1' },
    });
  try {
    const p = await app.firstWindow();
    p.setDefaultTimeout(10000);
    await p.locator('.toolbar').waitFor();
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (...args: any[]) => {
        const o = args.at(-1);
        const label =
          o.title === '同名文件'
            ? '保留两者'
            : o.title === '保存修改'
              ? '不保存'
              : o.title === '删除文件'
                ? '删除'
                : undefined;
        return {
          response: label ? o.buttons.indexOf(label) : (o.cancelId ?? 0),
          checkboxChecked: false,
        };
      };
    });
    await p.evaluate(async () => {
      await window.labpad.createLab('文件练习', 'project');
      await window.labpad.fileOperation('文件练习', '', {
        action: 'newFile',
        paths: ['a.c'],
        content: 'int a;',
      });
      await window.labpad.fileOperation('文件练习', '', {
        action: 'newFile',
        paths: ['b.c'],
        content: 'int b;',
      });
      await window.labpad.fileOperation('文件练习', '', { action: 'newFolder', paths: ['folder'] });
      await window.labpad.fileOperation('文件练习', '', { action: 'newFolder', paths: ['other'] });
    });
    await p.reload();
    await p.locator('.file-tree').waitFor();
    const node = (file: string) => p.locator('.tree-file[data-file=' + JSON.stringify(file) + ']');
    const area = await p.locator('.tree-items').evaluate((el) => {
        const box = el.getBoundingClientRect();
        return { x: box.x, y: box.y, width: el.clientWidth, height: el.clientHeight };
      }),
      first = await node('folder').boundingBox();
    // The bottom-right corner is the native sidebar resize grip, not the tree.
    const start = { x: area!.x + area!.width / 2, y: area!.y + area!.height - 24 };
    expect(
      await p.evaluate(
        ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.tree-items'),
        start,
      ),
    ).toBe(true);
    await p.mouse.move(start.x, start.y);
    await p.mouse.down();
    await p.mouse.move(area!.x + 3, first!.y + first!.height / 2, { steps: 12 });
    await p.mouse.up();
    await expect(p.locator('.tree-selection-count')).toHaveText(/[2-9]/);
    await node('a.c').click();
    await node('b.c').click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
    await expect(p.locator('.tree-selection-count')).toHaveText('2');
    await node('b.c').click({ button: 'right' });
    await expect(p.getByRole('menuitem', { name: '复制', exact: true })).toBeVisible();
    await p.keyboard.press('Escape');
    await p.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c');
    await node('folder').click();
    await p.keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v');
    await expect(node('folder/a.c')).toBeVisible();
    await node('folder').focus();
    await p.keyboard.press('F2');
    await p.getByRole('textbox', { name: '项目内路径' }).fill('renamed');
    await p.keyboard.press('Enter');
    await expect(node('renamed/a.c')).toBeVisible();
    await expect(node('folder')).toHaveCount(0);
    await node('a.c').click();
    await p.locator('.cm-content').fill('int a = 42;');
    const transfer = await p.evaluateHandle(() => new DataTransfer());
    await node('a.c').dispatchEvent('dragstart', { dataTransfer: transfer });
    await node('renamed').dispatchEvent('dragover', { dataTransfer: transfer });
    await node('renamed').dispatchEvent('drop', { dataTransfer: transfer });
    await expect(node('renamed/a (2).c')).toBeVisible();
    await expect(p.locator('.cm-content')).toContainText('42');
    await p.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(p.locator('.cm-content')).toContainText('int a;');
    const external = path.join(root, '资源.bin');
    await writeFile(external, Buffer.from([0, 255, 128, 1]));
    await p.evaluate(() => {
      const input = document.createElement('input');
      input.type = 'file';
      input.id = 'native-drop-fixture';
      document.body.append(input);
    });
    await p.locator('#native-drop-fixture').setInputFiles(external);
    const ext = await p.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(
        (document.querySelector('#native-drop-fixture') as HTMLInputElement).files![0],
      );
      return data;
    });
    await node('renamed').dispatchEvent('drop', { dataTransfer: ext });
    await expect(node('renamed/资源.bin')).toBeVisible();
    expect(await readFile(path.join(root, 'data/projects/文件练习/renamed/资源.bin'))).toEqual(
      Buffer.from([0, 255, 128, 1]),
    );
    await p.getByRole('button', { name: '新建文件', exact: true }).click();
    await p.getByRole('textbox', { name: '项目内路径' }).fill('child.txt');
    await p.keyboard.press('Enter');
    await expect(node('renamed/child.txt')).toBeVisible();
    await node('renamed/child.txt').click();
    await p.keyboard.press(process.platform === 'darwin' ? 'Meta+x' : 'Control+x');
    await expect(node('renamed/child.txt')).toHaveClass(/cut/);
    await node('other').click();
    await p.keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v');
    await expect(node('other/child.txt')).toBeVisible();
    await expect(node('renamed/child.txt')).toHaveCount(0);
  } finally {
    await app.close();
    await restore();
    await rm(root, { recursive: true, force: true });
  }
});
