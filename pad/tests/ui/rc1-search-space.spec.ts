import { test, expect } from '@playwright/test';
import { qualityFixture } from './quality-fixture';
test('native search keeps visible code and reachable replacement controls at compact size', async () => {
  const { app, page, close } = await qualityFixture();
  try {
    await page.evaluate(async () => {
      await window.labpad.createLab('SearchSpace', 'project');
      const b = await window.labpad.bootstrap();
      await window.labpad.saveLayout({ ...b.config.layout, editorPercent: 20 });
      await window.labpad.fileView('SearchSpace', { sidebarWidth: 420, sidebarCollapsed: false });
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(640, 380),
    );
    await page.reload();
    await page.locator('.toolbar').waitFor();
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+f');
    const search = page.locator('.cm-search');
    await expect(search).toBeVisible();
    await expect
      .poll(() => page.locator('.cm-scroller').evaluate((e) => e.getBoundingClientRect().height))
      .toBeGreaterThanOrEqual(36);
    for (const name of ['search', 'replace'])
      await search.locator('input[name=' + name + ']').fill('a');
    await search.locator('button[name=replaceAll]').click();
    console.log(
      'SEARCH_SPACE ' +
        JSON.stringify(
          await page.evaluate(() =>
            Object.fromEntries(
              ['.work-layout', '.workspace', '.cm-editor', '.cm-scroller', '.cm-search'].map(
                (s) => [s, document.querySelector(s)!.getBoundingClientRect().toJSON()],
              ),
            ),
          ),
        ),
    );
    await app.evaluate(async ({ BrowserWindow }) => {
      const fs = process.getBuiltinModule('fs/promises')!,
        p = process.getBuiltinModule('path')!;
      await fs.writeFile(
        p.resolve('../.work/rc1-final-audit/search-space-' + process.platform + '.png'),
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG(),
      );
    });
    await search.locator('button[name=close]').click();
    await expect(search).toHaveCount(0);
  } finally {
    await close();
  }
});
