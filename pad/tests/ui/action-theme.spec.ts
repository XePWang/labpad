import { test, expect, _electron } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { withFixtures, closeApplication } from './legacy-flow.cjs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
test('portaled export actions share normal, hover, focus and disabled styles in both themes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-action-theme-'));
  const app = await withFixtures(_electron).launch({
    executablePath: process.env.LABPAD_TEST_EXECUTABLE,
    cwd: process.cwd(),
    args: process.env.LABPAD_TEST_EXECUTABLE ? [] : ['.'],
    env: { ...process.env, LABPAD_DATA_DIR: path.join(root, 'data'), LABPAD_SKIP_WARMUP: '1' },
  });
  try {
    const page = await app.firstWindow();
    await page.locator('.toolbar').waitFor();
    await page.evaluate(() => window.labpad.createLab('ThemeFixture', 'project'));
    await page.reload();
    await page.locator('.toolbar').waitFor();
    async function styles(button: Locator) {
      return button.evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          background: s.backgroundColor,
          color: s.color,
          border: s.borderColor,
          outline: s.outlineColor,
          outlineStyle: s.outlineStyle,
          outlineWidth: s.outlineWidth,
          opacity: s.opacity,
          cursor: s.cursor,
          action: s.getPropertyValue('--action-bg').trim(),
        };
      });
    }
    async function states(button: Locator, normal: string, hover: string, disabled: string) {
      await page.mouse.move(0, 0);
      await expect
        .poll(() => button.evaluate((el) => getComputedStyle(el).backgroundColor))
        .toBe(normal);
      const base = await styles(button);
      await button.hover();
      await expect
        .poll(() => button.evaluate((el) => getComputedStyle(el).backgroundColor))
        .toBe(hover);
      const hovered = await styles(button);
      await page.keyboard.press('Tab');
      await button.focus();
      const focus = await styles(button);
      expect(focus.outlineStyle).toBe('solid');
      await button.evaluate((el) => ((el as HTMLButtonElement).disabled = true));
      await expect
        .poll(() => button.evaluate((el) => getComputedStyle(el).backgroundColor))
        .toBe(disabled);
      const inactive = await styles(button);
      await button.evaluate((el) => ((el as HTMLButtonElement).disabled = false));
      return {
        base,
        hovered,
        focus: { outline: focus.outline, style: focus.outlineStyle, width: focus.outlineWidth },
        inactive,
      };
    }
    for (const theme of ['dark', 'light'] as const) {
      await page.locator('.settings-button').click();
      await page.getByRole('combobox', { name: '主题', exact: true }).selectOption(theme);
      await page.getByRole('button', { name: '保存设置', exact: true }).click();
      await expect(page.locator('.settings-dialog')).toHaveCount(0);
      const colors =
        theme === 'dark'
          ? ['rgb(14, 99, 156)', 'rgb(17, 119, 187)', 'rgb(37, 37, 38)']
          : ['rgb(0, 103, 192)', 'rgb(0, 95, 184)', 'rgb(243, 243, 243)'];
      const ordinary = await states(
        page.getByRole('button', { name: '编译', exact: true }),
        colors[0],
        colors[1],
        colors[2],
      );
      await page.getByRole('button', { name: '导出', exact: true }).click();
      await page.getByRole('menuitem', { name: '导出实验项目', exact: true }).click();
      const exported = await states(
        page.locator('.export-dialog button.primary'),
        colors[0],
        colors[1],
        colors[2],
      );
      expect(exported).toEqual(ordinary);
      expect(exported.base.action).not.toBe('');
      await page.getByRole('button', { name: '取消导出', exact: true }).click();
    }
  } finally {
    await closeApplication(app);
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
