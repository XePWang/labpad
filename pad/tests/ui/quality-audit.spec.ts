import { qualityFixture as fixture } from './quality-fixture';
import { test, expect, _electron } from '@playwright/test';
import { withFixtures, closeApplication } from './legacy-flow.cjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('closing settings invalidates delayed compiler detection success and failure', async () => {
  const { app, page, close } = await fixture();
  try {
    for (const fail of [false, true]) {
      await page.locator('.toolbar button').filter({ hasText: '设置' }).click();
      await page
        .locator('.settings-dialog select:has(option[value=custom])')
        .selectOption('custom');
      await app.evaluate(({ ipcMain }) => {
        (globalThis as any).__scan = undefined;
        (ipcMain as any)._invokeHandlers.set(
          'compiler:detect',
          () =>
            new Promise((resolve, reject) => ((globalThis as any).__scan = { resolve, reject })),
        );
      });
      await page.getByRole('button', { name: /自动检测/ }).click();
      await expect.poll(() => app.evaluate(() => !!(globalThis as any).__scan)).toBe(true);
      await page.getByRole('button', { name: '关闭设置', exact: true }).click();
      await app.evaluate((_, fail) => {
        const s = (globalThis as any).__scan;
        if (fail) s.reject(Error('stale scan error'));
        else s.resolve([]);
      }, fail);
      await page.waitForTimeout(100);
      await expect(page.locator('.compiler-picker-backdrop')).toHaveCount(0);
      await expect(page.locator('.alert.error').filter({hasText:'stale scan error'})).toHaveCount(0);
    }
  } finally {
    await close();
  }
});
test('native completion ranking and dialog action semantics remain consistent', async () => {
  const { app, page, close } = await fixture();
  try {
    const samples = [
      '#include <stdio.h>\nint previous_entry;\nint main(void){ int profileResult; pri',
      '#include <stdio.h>\nint printfExtra;\nint main(void){ int privateValue; printf',
      'int return_value;\nint main(void){ int reticulated; return',
    ];
    const evidence = [];
    for (const code of samples) {
      const input = page.locator('.cm-content');
      await input.click();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.insertText(code);
      await page.keyboard.press('Control+Space');
      await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible();
      const labels = await page
        .locator('.cm-tooltip-autocomplete .cm-completionLabel')
        .allTextContents();
      evidence.push({ prefix: code.match(/\w+$/)![0], top3: labels.slice(0, 3) });
      expect(labels[0].toLowerCase().startsWith(code.match(/\w+$/)![0].toLowerCase())).toBe(true);
      await page.keyboard.press('Escape');
    }
    console.log('TOP3 ' + JSON.stringify(evidence));
    await page.locator('.toolbar button').filter({ hasText: '设置' }).click();
    const buttons = page.locator('.settings-dialog .dialog-actions button');
    const labels = await buttons.allTextContents();
    const windows = process.platform === 'win32';
    expect(labels.map((s) => s.trim())).toEqual(
      windows ? ['保存设置', '取消'] : ['取消', '保存设置'],
    );
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings-dialog')).toHaveCount(0);
  } finally {
    await close();
  }
});
