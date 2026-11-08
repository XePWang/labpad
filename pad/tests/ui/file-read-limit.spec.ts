import { test, expect, _electron } from '@playwright/test';
import { withFixtures, closeApplication } from './legacy-flow.cjs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
test('terminal cat enforces the byte cap in the native process and closes file handles', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-cat-limit-'));
  const app = await withFixtures(_electron).launch({
    executablePath: process.env.LABPAD_TEST_EXECUTABLE,
    cwd: process.cwd(),
    args: process.env.LABPAD_TEST_EXECUTABLE ? [] : ['.'],
    env: { ...process.env, LABPAD_DATA_DIR: path.join(root, 'data'), LABPAD_SKIP_WARMUP: '1' },
  });
  try {
    const page = await app.firstWindow();
    await page.locator('.toolbar').waitFor();
    const directory = await page.evaluate(async () => {
      await window.labpad.createLab('CatLimit', 'project');
      return (await window.labpad.bootstrap()).workspace!.scope;
    });
    await app.evaluate(async (_, directory) => {
      const fs = process.getBuiltinModule('fs/promises') as any;
      const paths = process.getBuiltinModule('path') as any;
      const original = fs.open;
      await fs.writeFile(paths.join(directory, 'large.txt'), Buffer.alloc(8 * 1024 ** 2, 'a'));
      const probe = ((globalThis as any).__readProbe = {
        read: 0,
        closed: 0,
        max: 0,
        hideSize: false,
      });
      (globalThis as any).__restoreOpen = () => {
        fs.open = original;
        process.getBuiltinModule('module')!.syncBuiltinESMExports();
      };
      fs.open = async (...args: any[]) => {
        const file = await original(...args);
        if (paths.basename(String(args[0])) !== 'large.txt') return file;
        const read = file.read.bind(file),
          stat = file.stat.bind(file),
          close = file.close.bind(file);
        file.stat = async () => {
          const info = await stat();
          if (probe.hideSize) info.size = 1;
          return info;
        };
        file.read = async (...values: any[]) => {
          probe.max = Math.max(probe.max, values[2]);
          const result = await read(...values);
          probe.read += result.bytesRead;
          return result;
        };
        file.close = async () => {
          probe.closed++;
          await close();
        };
        return file;
      };
      process.getBuiltinModule('module')!.syncBuiltinESMExports();
    }, directory);
    await page.reload();
    await page.locator('.toolbar').waitFor();
    await page.getByRole('button', { name: '终端', exact: true }).click();
    const input = page.locator('.terminal-viewport textarea');
    await expect.poll(() => page.locator('.xterm-rows').innerText()).toContain('>');
    await input.focus();
    await page.keyboard.insertText('cat large.txt');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.locator('.xterm-rows').innerText()).toContain('文件超过 1 MB');
    let stats = await app.evaluate(() => ({ ...(globalThis as any).__readProbe }));
    expect(stats.read).toBe(0);
    expect(stats.closed).toBe(1);
    await app.evaluate(() => ((globalThis as any).__readProbe.hideSize = true));
    await input.focus();
    await page.keyboard.insertText('cat large.txt');
    await page.keyboard.press('Enter');
    await expect.poll(() => app.evaluate(() => (globalThis as any).__readProbe.closed)).toBe(2);
    stats = await app.evaluate(() => ({ ...(globalThis as any).__readProbe }));
    expect(stats.read).toBe(1024 ** 2 + 1);
    expect(stats.max).toBeLessThanOrEqual(64 * 1024);
  } finally {
    await app.evaluate(() => (globalThis as any).__restoreOpen?.()).catch(() => {});
    await closeApplication(app);
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
