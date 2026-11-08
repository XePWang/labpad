import { openSettings } from './settings-helper.cjs';
import { test, expect } from '@playwright/test';
import { qualityFixture } from './quality-fixture';
test('cached editor states follow theme changes at rendered frames; record panel header geometry', async () => {
  const { page, close } = await qualityFixture();
  try {
    await page.evaluate(async () => {
      await window.labpad.createLab('ThemeAudit', 'project');
      await window.labpad.fileOperation('ThemeAudit', '', {
        action: 'newFile',
        paths: ['helper.c'],
        content: 'int helper(void){return 1;}\n',
      });
    });
    await page.reload();
    await page.locator('.toolbar').waitFor();
    if (!(await page.locator('.file-tree').isVisible()))
      await page.getByRole('button', { name: '显示文件', exact: true }).click();
    await page.locator('.tree-file[data-file="helper.c"]').click();
    await expect(page.locator('.source-tab.active')).toContainText('helper.c');
    await page.locator('.source-tab').filter({ hasText: 'main.c' }).click();
    await page.evaluate(() => {
      const w = window as any;
      w.__themeFrames = [];
      const root = document.querySelector('.app-shell')!;
      new MutationObserver(() => {
        let count = 0;
        const sample = () => {
          const editor = document.querySelector('.cm-editor')!;
          w.__themeFrames.push({
            theme: root.getAttribute('data-theme'),
            background: getComputedStyle(editor).backgroundColor,
            classes: editor.className,
          });
          if (++count < 8) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    });
    const evidence = [];
    for (const theme of ['light', 'dark', 'light', 'dark'] as const) {
      await openSettings(page);
      await page.getByRole('combobox', { name: '主题', exact: true }).selectOption(theme);
      await page.getByRole('button', { name: '保存设置', exact: true }).click();
      await expect(page.locator('.settings-dialog')).toHaveCount(0);
      await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', theme);
      for (const file of ['helper.c', 'main.c']) {
        await page.locator('.source-tab').filter({ hasText: file }).click();
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        const bg = await page
          .locator('.cm-editor')
          .evaluate((el) => getComputedStyle(el).backgroundColor);
        evidence.push({ theme, file, bg });
        expect(bg).toBe(theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(30, 30, 30)');
      }
    }
    const frames = await page.evaluate(() => (window as any).__themeFrames);
    console.log('THEME_FRAMES ' + JSON.stringify(frames));
    console.log('THEME_TABS ' + JSON.stringify(evidence));
    const wrong = frames.filter(
      (f: any) => f.background !== (f.theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(30, 30, 30)'),
    );
    expect(wrong).toEqual([]);
    const sizes = await page.evaluate(() =>
      Object.fromEntries(
        ['.tree-heading', '.source-strip', '.cases-heading', '.bottom-heading'].map((s) => {
          const el = document.querySelector(s)!;
          return [
            s,
            { height: el.getBoundingClientRect().height, top: el.getBoundingClientRect().top },
          ];
        }),
      ),
    );
    console.log('HEADERS ' + JSON.stringify(sizes));
    for (const v of Object.values(sizes)) expect(v.height).toBe(40);
    await page.screenshot({
      path: '../.work/rc1-final-audit/header-fixed-' + process.platform + '.png',
    });
  } finally {
    await close();
  }
});
