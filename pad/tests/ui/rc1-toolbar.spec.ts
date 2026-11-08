import { test, expect } from '@playwright/test';
import { qualityFixture } from './quality-fixture';
test('fixed headers keep primary controls visible while overflow menus escape narrow panels', async () => {
  const { app, page, close } = await qualityFixture();
  const nativeShot = async (name: string) =>
    app.evaluate(async ({ BrowserWindow }, name) => {
      const fs = process.getBuiltinModule('fs/promises')!,
        path = process.getBuiltinModule('path')!;
      const file = path.resolve('../.work/rc1-final-audit', name + '-' + process.platform + '.png');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(
        file,
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG(),
      );
    }, name);
  try {
    await page.evaluate(() => window.labpad.createLab('Adaptive', 'project'));
    await page.reload();
    await page.locator('.toolbar').waitFor();
    const records = [];
    for (const zoom of [1, 2, 4])
      for (const editorPercent of [20, 50, 80]) {
        await page.evaluate(
          async ({ zoom, editorPercent }) => {
            const b = await window.labpad.bootstrap();
            b.config.zoomFactor = zoom;
            await window.labpad.saveConfig(b.config, b.dataRoot);
            await window.labpad.saveLayout({ ...b.config.layout, editorPercent });
          },
          { zoom, editorPercent },
        );
        await page.reload();
        await page.locator('.toolbar').waitFor();
        const header = page.locator('.cases-heading');
        await header.scrollIntoViewIfNeeded();
        await expect
          .poll(() => header.evaluate((el) => Math.round(el.getBoundingClientRect().height)))
          .toBe(40);
        const metrics = await header.evaluate((el) => ({
          width: el.clientWidth,
          scroll: el.scrollWidth,
          viewport: innerWidth,
        }));
        await expect
          .poll(() => header.evaluate((el) => el.scrollWidth - el.clientWidth))
          .toBeLessThanOrEqual(1);
        for (const selector of ['.right-collapse', '.run-test-icon', '.action-menu-trigger']) {
          const node = header.locator(selector);
          await expect(node).toBeVisible();
          await node.scrollIntoViewIfNeeded();
          await expect
            .poll(
              () =>
                node.evaluate((el) => {
                  const r = el.getBoundingClientRect(),
                    p = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
                  return !!p && (p === el || el.contains(p));
                }),
              {
                message:
                  selector +
                  ' not hit-testable at ' +
                  JSON.stringify({ zoom, editorPercent, metrics }),
              },
            )
            .toBe(true);
        }
        await header.getByRole('button', { name: '更多', exact: true }).click();
        const menu = page.locator('.action-menu[data-state="open"]');
        await expect(menu).toBeVisible();
        const bounds = await menu.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return {
            left: r.left,
            right: r.right,
            bottom: r.bottom,
            top: r.top,
            width: r.width,
            viewportWidth: innerWidth,
            viewportHeight: innerHeight,
            clippedAncestor: !!el.closest('.cases-pane'),
          };
        });
        expect(bounds.clippedAncestor).toBe(false);
        expect(bounds.left).toBeGreaterThanOrEqual(7);
        expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth - 7);
        expect(bounds.top).toBeGreaterThanOrEqual(7);
        expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight - 7);
        if (zoom === 2 && editorPercent === 80) await nativeShot('overflow-menu');
        records.push({ zoom, editorPercent, ...metrics, menuWidth: bounds.width });
        await page.keyboard.press('Escape');
        await expect(header.getByRole('button', { name: '更多', exact: true })).toBeFocused();
      }
    console.log('ADAPTIVE_HEADERS ' + JSON.stringify(records));
    await page.evaluate(async () => {
      const b = await window.labpad.bootstrap();
      b.config.zoomFactor = 4;
      await window.labpad.saveConfig(b.config, b.dataRoot);
      await window.labpad.saveLayout({ ...b.config.layout, editorPercent: 80 });
    });
    await page.reload();
    await page.locator('.toolbar').waitFor();
    let header = page.locator('.cases-heading');
    await header.scrollIntoViewIfNeeded();
    await header.getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('menuitem', { name: '切换到调试', exact: true }).click();
    await expect(header.getByRole('button', { name: '开始调试', exact: true })).toBeVisible();
    await header.getByRole('button', { name: '更多调试操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '构建设置…', exact: true }).click();
    await expect(page.locator('.build-settings')).toBeVisible();
    await page.keyboard.press('Escape');
    await nativeShot('adaptive-narrow');
    // A native state event reproduces the UI's active-task scope without starting another debugger.
    const scope = await page.evaluate(
      async () => (await window.labpad.bootstrap()).workspace!.scope,
    );
    await app.evaluate(
      ({ BrowserWindow }, scope) =>
        BrowserWindow.getAllWindows()[0].webContents.send('native:state', {
          scope,
          status: 'running',
          frames: [],
          scopes: [],
          variables: [],
          breakpoints: [],
          conditionalBreakpoints: true,
        }),
      scope,
    );
    await expect(header.getByRole('button', { name: '开始调试', exact: true })).toBeDisabled();
    await header.getByRole('button', { name: '更多调试操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '切换到测试点', exact: true }).click();
    await header.getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('menuitem', { name: '切换到调试', exact: true }).click();
    await expect(header.getByRole('button', { name: '开始调试', exact: true })).toBeVisible();
  } catch (error) {
    console.log(
      'WORKSPACE_GEOMETRY',
      await page.evaluate(() =>
        Object.fromEntries(
          [
            '.app-shell',
            '.work-layout',
            '.workspace',
            '.cases-pane',
            '.cases-heading',
            '.bottom-heading',
            '.statusbar',
          ].map((selector) => {
            const el = document.querySelector(selector)!;
            return [
              selector,
              {
                rect: el.getBoundingClientRect().toJSON(),
                minHeight: getComputedStyle(el).minHeight,
                overflow: getComputedStyle(el).overflow,
                scroll: el.scrollTop,
              },
            ];
          }),
        ),
      ),
    );
    await page.screenshot({ path: '../.work/rc1-final-audit/header-failure.png' });
    throw error;
  } finally {
    await close();
  }
});
test('overflow menus scroll within short windows and preserve keyboard access to their last action', async () => {
  const { app, page, close } = await qualityFixture();
  try {
    await page.evaluate(() => window.labpad.createLab('ShortMenu', 'project'));
    await page.evaluate(async () => {
      const b = await window.labpad.bootstrap();
      b.config.zoomFactor = 2;
      await window.labpad.saveConfig(b.config, b.dataRoot);
      await window.labpad.saveLayout({ ...b.config.layout, editorPercent: 80 });
    });
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setMinimumSize(640, 240);
      win.setBounds({ width: 1000, height: 400 });
    });
    await page.reload();
    await page.locator('.toolbar').waitFor();
    const header = page.locator('.cases-heading');
    await header.scrollIntoViewIfNeeded();
    await header.getByRole('button', { name: '更多', exact: true }).click();
    const menu = page.locator('.action-menu[data-state="open"]');
    await expect(menu).toBeVisible();
    const metrics = await menu.evaluate((el) => ({
      client: el.clientHeight,
      scroll: el.scrollHeight,
      height: innerHeight,
    }));
    console.log('SHORT_MENU ' + JSON.stringify(metrics));
    expect(metrics.scroll).toBeGreaterThan(metrics.client);
    await page.keyboard.press('End');
    const last = menu.getByRole('menuitem', { name: '新增测试点', exact: true });
    await expect(last).toBeFocused();
    const hit = await last.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    expect(hit).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.locator('.case-card')).toHaveCount(1);
  } finally {
    await close();
  }
});
