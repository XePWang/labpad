import { test, expect, _electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
test('sandboxed preload starts with language bridge and no page errors', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-language-start-'));
  const app = await _electron.launch({
    executablePath: process.env.LABPAD_TEST_EXECUTABLE,
    args: process.env.LABPAD_TEST_EXECUTABLE ? [] : ['.'],
    env: { ...process.env, LABPAD_DATA_DIR: root, LABPAD_SKIP_WARMUP: '1' },
  });
  try {
    const failures: string[] = [];
    app.on('window', (page) => page.on('pageerror', (e) => failures.push(String(e))));
    const page = await app.firstWindow();
    await expect(page.locator('.toolbar')).toBeVisible();
    expect(await page.evaluate(() => window.labpad.interfaceLanguage())).toBe('zh-CN');
    expect(failures).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
