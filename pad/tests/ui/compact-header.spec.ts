import { test, expect } from '@playwright/test';
import { qualityFixture } from './quality-fixture';

for (const mode of ['problem-set', 'project'] as const)
  test('compact header keeps primary actions in one row for ' + mode, async () => {
    const { app, page, root, close } = await qualityFixture();
    try {
      await page.evaluate(async (mode) => {
        await window.labpad.createLab('Compact Header', mode);
        if (mode === 'problem-set')
          await window.labpad.createProblem('Compact Header', 'Long Problem Name 1', 'c');
      }, mode);
      await page.reload();
      await page.locator('.toolbar').waitFor();
      for (const [width, height] of [
        [640, 380],
        [640, 480],
        [683, 380],
        [683, 480],
      ]) {
        await app.evaluate(
          ({ BrowserWindow }, size) =>
            BrowserWindow.getAllWindows()
              .find((w) => !w.isDestroyed())!
              .setContentSize(size.width, size.height),
          { width, height },
        );
        await expect(page.locator('.toolbar')).toHaveClass(/is-compact/);
        await expect(page.locator('.brandbar')).toBeHidden();
        const geometry = await page.locator('.toolbar').evaluate((node) => {
          const r = node.getBoundingClientRect();
          return {
            height: r.height,
            buttons: Array.from(node.querySelectorAll<HTMLElement>('button'))
              .filter((b) => b.getClientRects().length)
              .map((b) => {
                const r = b.getBoundingClientRect();
                return {
                  x: r.x,
                  y: r.y,
                  right: r.right,
                  bottom: r.bottom,
                  text: b.getAttribute('aria-label') || b.textContent,
                };
              }),
            width: innerWidth,
          };
        });
        expect(geometry.height).toBe(40);
        for (const b of geometry.buttons) {
          expect(b.x).toBeGreaterThanOrEqual(0);
          expect(b.right).toBeLessThanOrEqual(geometry.width);
          expect(b.bottom - b.y).toBeLessThanOrEqual(40);
        }
        for (const name of ['编译', '停止', '保存'])
          await expect(
            page.locator('.toolbar').getByRole('button', { name, exact: true }),
          ).toBeVisible();
        await page.locator('.toolbar-more-trigger').click();
        const menu = page.locator('.action-menu[data-owner="toolbar"]');
        await expect(menu).toBeVisible();
        await page.keyboard.press('End');
        await expect(page.getByRole('menuitem', { name: '设置', exact: true })).toBeFocused();
        const rect = await page.getByRole('menuitem', { name: '设置', exact: true }).boundingBox();
        expect(rect!.y + rect!.height).toBeLessThanOrEqual(height + 1);
        await page.keyboard.press('Enter');
        await expect(page.locator('.settings-dialog')).toBeVisible();
        await page
          .locator('.settings-dialog')
          .getByRole('button', { name: '取消', exact: true })
          .click();
        await expect(page.locator('.settings-dialog')).toHaveCount(0);
      }
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => !w.isDestroyed())!
          .setContentSize(1440, 900),
      );
      await expect(page.locator('.brandbar')).toBeVisible();
      await expect(page.locator('.settings-button')).toBeVisible();
      await page.locator('.settings-button').focus();
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => !w.isDestroyed())!
          .setContentSize(640, 380),
      );
      await expect(page.locator('.toolbar-more-trigger')).toBeFocused();
      await page.screenshot({ path: root + '/compact-header-' + mode + '.png' });
    } finally {
      await close();
    }
  });
