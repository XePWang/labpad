import { test, expect } from '@playwright/test';
import { qualityFixture } from './quality-fixture';
test('closing menus keeps newly focused code while Escape alone still restores the trigger', async () => {
  const { page, close } = await qualityFixture();
  try {
    await page.evaluate(() => window.labpad.createLab('MenuFocus', 'project'));
    await page.reload();
    await page.locator('.toolbar').waitFor();
    const editor = page.locator('.cm-content');
    const cases = [
      {
        open: () => page.locator('.source-tab.active').click({ button: 'right' }),
        menu: '.tab-context',
      },
      {
        open: () => page.locator('.tree-file[data-file="main.c"]').click({ button: 'right' }),
        menu: '.tab-context',
      },
      {
        open: () => page.getByRole('button', { name: '保存', exact: true }).click(),
        menu: '.action-menu',
      },
      {
        open: () => page.getByRole('combobox', { name: '实验项目', exact: true }).click(),
        menu: '.problem-options',
      },
    ];
    for (const [i, item] of cases.entries()) {
      await item.open();
      await expect(page.locator(item.menu + '[data-state="open"]')).toBeVisible();
      await page.keyboard.press('Escape');
      await editor.fill('int main(void) { return 0; }\n// new focus ' + i);
      await expect(page.locator(item.menu)).toHaveCount(0);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(editor).toBeFocused();
      await page.keyboard.press('End');
      await page.keyboard.type('x');
      await expect(editor).toContainText('// new focus ' + i + 'x');
    }
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeFocused();
  } finally {
    await close();
  }
});
