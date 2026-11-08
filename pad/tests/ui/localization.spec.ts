import { test, expect } from '@playwright/test';
import { qualityFixture } from './quality-fixture';

test('language switches search and settings without changing source or query', async ({}, testInfo) => {
  const { app, page, root, close } = await qualityFixture();
  try {
    const editor = page.locator('.cm-content');
    await editor.fill('int main(void) { int value = 1; return value; }');
    await page.keyboard.press('Control+f');
    await page.locator('.cm-search input[name=search]').fill('value');
    await page.locator('.cm-search input[name=search]').press('Tab');
    await page.locator('.cm-search input[name=replace]').fill('result');
    await page.locator('.cm-search input[name=case]').check();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('界面语言', { exact: true }).selectOption('en-US');
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.locator('.toolbar .problem-trigger')).toHaveText(['<None>', '<None>']);
    expect(
      await page.locator('.cm-search').evaluate((node) => {
        const box = node.getBoundingClientRect();
        const front = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return !!front?.closest('.modal-backdrop');
      }),
    ).toBe(true);

    await expect(page.locator('.cm-search input[name=search]')).toHaveAttribute(
      'placeholder',
      'Find',
    );
    await expect(page.locator('.cm-search input[name=search]')).toHaveValue('value');
    await expect(page.locator('.cm-search input[name=replace]')).toHaveValue('result');
    await expect(page.locator('.cm-search input[name=case]')).toBeChecked();
    await expect(editor).toHaveText('int main(void) { int value = 1; return value; }');
    await expect(page.locator('.cm-search button[name=replaceAll]')).toHaveText('Replace All');
    await page.screenshot({ path: testInfo.outputPath('english-settings.png') });
    await page
      .locator('.settings-dialog')
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    await expect(page.locator('.cm-search button[name=replaceAll]')).toHaveText('全部替换');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('界面语言', { exact: true }).selectOption('en-US');
    await page
      .locator('.settings-dialog')
      .getByRole('button', { name: 'Save Settings', exact: true })
      .click();
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en-US');
    const error = await page.evaluate(async () => {
      try {
        await window.labpad.createLab('', 'problem-set');
        return null;
      } catch (e) {
        return e;
      }
    });
    expect(error).toBeTruthy();
    expect(JSON.stringify(error)).not.toMatch(/[\u4e00-\u9fff]/);
  } finally {
    await close();
  }
});

for (const language of ['zh-CN', 'en-US'] as const)
  for (const theme of ['dark', 'light'] as const)
    test(`localized compact controls fit at 640px: ${language} ${theme}`, async ({}, testInfo) => {
      const { app, page, close } = await qualityFixture();
      try {
        await page.locator('.settings-button').click();
        await page.getByLabel('界面语言', { exact: true }).selectOption(language);
        const english = language === 'en-US';
        const dialog = page.locator('.settings-dialog');
        await dialog.getByLabel(english ? 'Theme' : '主题', { exact: true }).selectOption(theme);
        await dialog
          .getByRole('button', { name: english ? 'Save Settings' : '保存设置', exact: true })
          .click();
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].setContentSize(640, 380),
        );
        await expect(page.locator('.toolbar')).toHaveClass(/is-compact/);
        await expect(page.locator('.brandbar')).toBeHidden();
        await expect(page.locator('.toolbar')).toHaveCSS('height', '40px');
        const toolbar = await page.locator('.toolbar').evaluate((el) => ({
          width: el.clientWidth,
          scroll: el.scrollWidth,
          buttons: [...el.querySelectorAll('button')]
            .filter((b) => b.getClientRects().length)
            .map((b) => ({
              name: b.getAttribute('aria-label') || b.textContent,
              right: b.getBoundingClientRect().right,
              y: b.getBoundingClientRect().y,
            })),
        }));
        expect(toolbar.scroll).toBeLessThanOrEqual(toolbar.width + 1);
        for (const b of toolbar.buttons) expect(b.right).toBeLessThanOrEqual(640);
        await page.locator('.cm-content').click();
        await page.keyboard.press('Control+f');
        await expect(page.locator('.cm-search input[name=search]')).toHaveAttribute(
          'placeholder',
          english ? 'Find' : '查找',
        );
        const search = await page.locator('.cm-search').evaluate((el) => ({
          right: el.getBoundingClientRect().right,
          width: el.clientWidth,
          scroll: el.scrollWidth,
        }));
        expect(search.scroll).toBeLessThanOrEqual(search.width + 1);
        expect(search.right).toBeLessThanOrEqual(640);
        await page.locator('.toolbar-more-trigger').click();
        const menu = page.locator('.action-menu[data-owner=toolbar]');
        await expect(menu).toBeVisible();
        const rect = await menu.boundingBox();
        expect(rect!.x).toBeGreaterThanOrEqual(0);
        expect(rect!.x + rect!.width).toBeLessThanOrEqual(641);
        expect(rect!.y + rect!.height).toBeLessThanOrEqual(381);
        await page.keyboard.press('Escape');
        await page.screenshot({ path: testInfo.outputPath(`compact-${language}-${theme}.png`) });
        await page
          .getByRole('button', { name: english ? 'Terminal' : '终端', exact: true })
          .click();
        await expect(page.locator('.xterm-helper-textarea')).toHaveAttribute(
          'aria-label',
          english ? 'Terminal Input' : '终端输入',
        );
      } finally {
        await close();
      }
    });

test('switching UI language retains a compiled program and accepted test results', async () => {
  const { page, close } = await qualityFixture();
  try {
    await page
      .locator('.cm-content')
      .fill('#include <stdio.h>\nint main(void){puts("ready-中文");return 0;}');
    await page.getByRole('button', { name: '＋ 新增测试点', exact: true }).click();
    await page.getByLabel('预期输出 1', { exact: true }).fill('ready-中文\n');
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+s');
    await expect(page.locator('.save-status')).toHaveText('已保存');
    await page.getByRole('button', { name: '编译', exact: true }).click();
    const run = page.locator('.cases-heading .run-test-icon');
    await expect(run).toBeEnabled({ timeout: 150000 });
    await run.click();
    await expect(page.locator('.case-card .verdict')).toHaveText('AC', { timeout: 30000 });
    await page.locator('.settings-button').click();
    await page.getByLabel('界面语言', { exact: true }).selectOption('en-US');
    await page
      .locator('.settings-dialog')
      .getByRole('button', { name: 'Save Settings', exact: true })
      .click();
    await expect(run).toBeEnabled();
    await expect(page.locator('.case-card .verdict')).toHaveText('AC');
    await expect(page.locator('.case-card')).toContainText('ready-中文');
    await page.getByRole('button', { name: 'Output', exact: true }).click();
    await expect(page.locator('.output-log')).toContainText('Compile Command');
    await expect(page.locator('.output-log')).toContainText('ready-中文');
  } finally {
    await close();
  }
});

test('shortcut window follows live language without resetting edited bindings', async () => {
  const { app, page, close } = await qualityFixture();
  try {
    await page.locator('.settings-button').click();
    const childReady = app.waitForEvent('window');
    await page
      .locator('.settings-dialog')
      .getByRole('button', { name: '设置快捷键…', exact: true })
      .click();
    const child = await childReady;
    await expect(child.locator('.shortcut-fields')).toBeEnabled();
    const input = child.locator('.shortcut-row input').first();
    await input.fill('Ctrl+Alt+K');
    await page.getByLabel('界面语言', { exact: true }).selectOption('en-US');
    await expect(
      child.getByRole('heading', { name: 'Keyboard Shortcuts', exact: true }),
    ).toBeVisible();
    await expect(input).toHaveValue('Ctrl+Alt+K');
    expect(await child.locator('body').innerText()).not.toMatch(/[\u4e00-\u9fff]/);
    await page
      .locator('.settings-dialog')
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    await expect(
      child.getByRole('heading', { name: 'Keyboard Shortcuts', exact: true }),
    ).toHaveCount(0);
    await expect(input).toHaveValue('Ctrl+Alt+K');
    await child.close();
  } finally {
    await close();
  }
});
