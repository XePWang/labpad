import { test, expect } from '@playwright/test';
import { qualityFixture } from './quality-fixture';
test('compact left workspace preserves a usable editor beside a manually controlled file tree', async () => {
  const { app, page, close } = await qualityFixture();
  try {
    await page.evaluate(async () => {
      await window.labpad.createLab('Compact', 'project');
      const b = await window.labpad.bootstrap();
      b.config.zoomFactor = 1;
      await window.labpad.saveConfig(b.config, b.dataRoot);
      await window.labpad.saveLayout({ ...b.config.layout, editorPercent: 20 });
      await window.labpad.fileView('Compact', { sidebarWidth: 420, sidebarCollapsed: false });
    });
    const minimum = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0],
        minimum = win.getMinimumSize();
      win.setMinimumSize(1, 1);
      win.setContentSize(640, 380);
      return minimum;
    });
    await page.reload();
    await page.locator('.toolbar').waitFor();
    const geometry = await page.evaluate(() =>
      Object.fromEntries(
        [
          '.app-shell',
          '.workspace',
          '.editor-pane',
          '.editor-content',
          '.file-tree',
          '.cases-pane',
        ].map((s) => [s, document.querySelector(s)!.getBoundingClientRect().toJSON()]),
      ),
    );
    console.log('COMPACT_BASELINE ' + JSON.stringify({ minimum, geometry }));
    await app.evaluate(async ({ BrowserWindow }) => {
      const fs = process.getBuiltinModule('fs/promises')!,
        path = process.getBuiltinModule('path')!;
      const file = path.resolve('../.work/rc1-final-audit', 'compact-' + process.platform + '.png');
      await fs.writeFile(
        file,
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG(),
      );
    });
    expect(geometry['.editor-content'].width).toBeGreaterThanOrEqual(240);
    await expect(page.locator('.cm-content')).toBeVisible();
    await expect(page.getByRole('button', { name: '收起侧栏', exact: true })).toBeVisible();
  } finally {
    await close();
  }
});
