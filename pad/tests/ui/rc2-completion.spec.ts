import { test, expect, type Page } from '@playwright/test';
import { qualityFixture } from './quality-fixture';

async function setCode(page: Page, code: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(code);
}

test('completion repairs a word in place and expands a statement template only when selected', async () => {
  const { page, close } = await qualityFixture();
  const completion = page.locator('.cm-tooltip-autocomplete');
  const editor = page.locator('.cm-content');
  try {
    for (const [word, right] of [
      ['ret', ' fun(); }'],
      ['retuxn', ' fun(); }'],
      ['return', ' fun(); }'],
    ]) {
      await setCode(page, 'int main(void) { ' + word + right);
      for (let i = 0; i < right.length + (word === 'ret' ? 0 : 2); i++)
        await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Control+Space');
      await expect(completion.locator('.cm-completionLabel').first()).toHaveText('return');
      await page.keyboard.press('Tab');
      await expect(editor).toHaveText('int main(void) { return fun(); }');
    }

    for (const expand of [false, true]) {
      await setCode(page, 'int main(void) {\n    \n}');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('End');
      await page.keyboard.type('fo');
      const rows = completion.getByRole('option');
      const template = rows.filter({ has: page.locator('.cm-completionDetail', { hasText: /for \(/ }) });
      await expect(rows.first()).toHaveText('for');
      await expect(template).toBeVisible();
      if (expand) {
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await expect(editor).toContainText('for (int i = 0; i < count; ++i)');
      } else {
        await page.keyboard.press('Tab');
        await expect(editor).toContainText('    for');
        await expect(editor).not.toContainText('int i = 0');
      }
    }
  } finally {
    await close();
  }
});
