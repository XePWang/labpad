import { test, expect, _electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('offline fonts stay consistent in editor, completion and terminal', async () => {
  test.setTimeout(120000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-font-ui-'));
  const app = await _electron.launch({
    executablePath: process.env.LABPAD_TEST_EXECUTABLE,
    args: process.env.LABPAD_TEST_EXECUTABLE ? [] : ['.'],
    cwd: process.cwd(),
    env: { ...process.env, LABPAD_DATA_DIR: path.join(root, 'data'), LABPAD_SKIP_WARMUP: '1' },
  });
  try {
    if (process.env.LABPAD_TEST_RENDERER)
      await app.evaluate(async ({ BrowserWindow }, file) => {
        await BrowserWindow.getAllWindows()[0].loadFile(file);
      }, process.env.LABPAD_TEST_RENDERER);
    const page = await app.firstWindow();
    page.setDefaultTimeout(12000);
    await page.route(/^https?:/, (route) => route.abort());
    await page.locator('.toolbar').waitFor();
    await expect
      .poll(() => page.locator('.cm-scroller').evaluate((el) => getComputedStyle(el).fontFamily))
      .toContain('LabPad Latin');
    expect(await page.locator('.cm-scroller').evaluate((el) => getComputedStyle(el).fontSize)).toBe(
      '14px',
    );
    await page.locator('.cm-content').fill('#include <stdio.h>\nint main(void){\n pri');
    await page.keyboard.press('End');
    await page.keyboard.press('Alt+/');
    await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible();
    const editorFont = await page
      .locator('.cm-scroller')
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(
      await page
        .locator('.cm-tooltip-autocomplete li')
        .first()
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toBe(editorFont);
    expect(
      await page
        .locator('.cm-tooltip-autocomplete li')
        .first()
        .evaluate((el) => getComputedStyle(el).fontSize),
    ).toBe('14px');
    await page.keyboard.press('Escape');
    await page.locator('.settings-button').click();
    await expect(page.getByLabel('英文字体', { exact: true })).toHaveValue('JetBrains Mono');
    await page.getByRole('spinbutton', { name: '英文字号', exact: true }).fill('18');
    await page.getByRole('spinbutton', { name: '中文字号', exact: true }).fill('26');
    await expect(page.getByRole('button', { name: '保存设置', exact: true })).toBeEnabled();
    await page.locator('.typography-settings').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.resolve('../.work/dev9-font-settings-' + process.platform + '.png'),
    });
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(page.locator('.settings-dialog')).toHaveCount(0);
    await expect
      .poll(() => page.locator('.cm-scroller').evaluate((el) => getComputedStyle(el).fontSize))
      .toBe('18px');
    const beforeFontUndo = await page.locator('.cm-content').innerText();
    await page.locator('.cm-content').focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(page.locator('.cm-content')).not.toContainText('pri');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z');
    await expect.poll(() => page.locator('.cm-content').innerText()).toBe(beforeFontUndo);
    await page.keyboard.press('End');
    await page.keyboard.press('Alt+/');
    await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible();
    expect(
      await page
        .locator('.cm-tooltip-autocomplete li')
        .first()
        .evaluate((el) => getComputedStyle(el).fontSize),
    ).toBe('18px');
    await page.keyboard.press('Escape');
    const metrics = await page.evaluate(() => {
      const family = getComputedStyle(document.querySelector('.cm-scroller')!).fontFamily,
        c = document.createElement('canvas').getContext('2d')!;
      c.font = '18px ' + family;
      return {
        latin: c.measureText('W').width,
        chinese: c.measureText('中').width,
        loaded: [...document.fonts]
          .filter((f) => f.family.includes('LabPad '))
          .map((f) => ({ family: f.family, status: f.status })),
      };
    });
    expect(metrics.chinese).toBeGreaterThan(24);
    expect(metrics.chinese).toBeLessThan(29);
    expect(metrics.latin).toBeGreaterThan(9);
    expect(metrics.latin).toBeLessThan(13);
    expect(metrics.loaded).toHaveLength(2);
    expect(metrics.loaded.every((f) => f.status === 'loaded')).toBe(true);
    await page.locator('.bottom-tabs button').filter({ hasText: '终端' }).click();
    await expect
      .poll(() => page.locator('.xterm-rows').evaluate((el) => getComputedStyle(el).fontFamily))
      .toBe(await page.locator('.cm-scroller').evaluate((el) => getComputedStyle(el).fontFamily));
    expect(await page.locator('.xterm-rows').evaluate((el) => getComputedStyle(el).fontSize)).toBe(
      '18px',
    );
    await page.locator('.terminal-viewport textarea').focus();
    await page.keyboard.insertText('pwd');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.locator('.xterm-rows').innerText()).toContain('> pwd');
    await page.locator('.terminal-viewport textarea').focus();
    await page.keyboard.insertText('中文ab');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.locator('.xterm-rows').innerText()).toContain('未知命令：中文b');
    await page.locator('.settings-button').click();
    const customLatin = process.platform === 'win32' ? 'Consolas' : 'DejaVu Sans Mono';
    const customChinese = process.platform === 'win32' ? 'Microsoft YaHei' : 'Noto Sans CJK SC';
    await page.getByLabel('英文字体', { exact: true }).fill(customLatin);
    await page.getByLabel('中文字体', { exact: true }).fill(customChinese);
    await page.getByRole('spinbutton', { name: '英文字号', exact: true }).fill('22');
    await page.getByRole('spinbutton', { name: '中文字号', exact: true }).fill('12');
    await expect(page.getByRole('button', { name: '保存设置', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect
      .poll(() => page.locator('.cm-scroller').evaluate((el) => getComputedStyle(el).fontSize))
      .toBe('22px');
    const smallerChinese = await page.evaluate(() => {
      const c = document.createElement('canvas').getContext('2d')!;
      c.font = '22px ' + getComputedStyle(document.querySelector('.cm-scroller')!).fontFamily;
      return c.measureText('中').width;
    });
    expect(smallerChinese).toBeGreaterThan(10);
    expect(smallerChinese).toBeLessThan(14);
    await page.locator('.settings-button').click();
    await page.getByLabel('英文字体', { exact: true }).fill('LabPad missing font fixture');
    await expect(page.locator('.typography-settings .field-error')).toContainText('未找到英文字体');
    await expect(page.getByRole('button', { name: '保存设置', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    expect(await page.locator('.cm-scroller').evaluate((el) => getComputedStyle(el).fontSize)).toBe(
      '22px',
    );
    await expect
      .poll(() =>
        page.evaluate(() => [...document.fonts].filter((f) => f.family.includes('LabPad ')).length),
      )
      .toBeLessThanOrEqual(2);
    await page.reload();
    await page.locator('.toolbar').waitFor();
    await expect
      .poll(() => page.locator('.cm-scroller').evaluate((el) => getComputedStyle(el).fontSize))
      .toBe('22px');
    const b = await page.evaluate(() => window.labpad.bootstrap());
    expect(b.config.typography?.chineseSize).toBe(12);
    expect(b.config.typography?.englishFamily).toBe(customLatin);
    await page.screenshot({
      path: path.resolve('../.work/dev9-font-' + process.platform + '.png'),
    });
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
